import {
  conversionPayload,
  decodeHandoff,
  DEFAULT_ENDPOINT,
  encodeHandoff,
  eventsUrl,
  type Group,
  HANDOFF_PARAM,
  type Identity,
  identityFromForm,
  type LandingPayload,
  type PageviewPayload,
  identifyPayload,
  isHandoffHost,
  isValidEventName,
  normalizeGroup,
  normalizeGroupId,
  normalizeIdentity,
  normalizeProperties,
  landingPayload,
  nextTouchRecord,
  parseTouchRecord,
  type Payload,
  type Properties,
  referrerHost,
  SESSION_KEY,
  shouldRecordTouch,
  STORAGE_KEY,
  type Touch,
  type TouchRecord,
} from "./touch";

export {
  decodeHandoff,
  encodeHandoff,
  HANDOFF_PARAM,
} from "./touch";
export type {
  ConversionPayload,
  Group,
  GroupPayload,
  Identity,
  IdentifyPayload,
  LandingPayload,
  PageviewPayload,
  Payload,
  Properties,
  Touch,
  TouchRecord,
  UngroupPayload,
} from "./touch";

/**
 * Ballad's site beacon as a package. What it does, in order:
 *
 *  1. on `init`, notes the `?ref=` token and the external referrer, and keeps
 *     the visitor's first and last touch in localStorage on your own domain
 *     (90 days) — unless Global Privacy Control is on;
 *  2. reports a `landing` once per tab and a `pageview` on later navigations
 *     (SPA-aware: pushState / replaceState / popstate);
 *  3. reports a `conversion` on `track("signup")`, or on a click / submit of
 *     any element with `data-ballad-track="signup"` — with the person's
 *     email when the site passes one (`track("signup", { email })`, or a
 *     form marked `data-ballad-identify`), so Ballad can hand the contact
 *     to a CRM. Nothing identifying is sent unless the site chooses to,
 *     and never when the visitor signals Global Privacy Control.
 *
 * Transport is a plain fetch with keepalive, no credentials, no cookies, no
 * user agent or IP kept by Ballad beyond the edge's country. Nothing here
 * can throw into your page.
 */
export type BeaconOptions = {
  /** Your site token, from Settings › Site in Ballad. */
  site: string;
  /** Where events go. Defaults to Ballad's app; only change it for a mirror. */
  endpoint?: string;
  /** Report client-side navigations as pageviews (default true). */
  trackNavigation?: boolean;
  /** Honour Global Privacy Control by never storing a touch (default true). */
  respectGpc?: boolean;
  /** Wire `data-ballad-track` clicks and submits (default true). */
  trackAttributes?: boolean;
  /** Hosts the visitor's touch should follow them to — your app, if it
   * lives on another origin (e.g. `["app.example.com"]`). Links to these
   * hosts get a `bt` parameter carrying the stored touch; a beacon on
   * that origin adopts it on arrival, so a signup there still knows the
   * post that brought the person. Never under Global Privacy Control. */
  handoff?: string[];
};

export type Beacon = {
  /** Report a named conversion ("signup", "demo_request"…), optionally
   * with who converted and flat properties ({plan: "pro"}). */
  track: (
    name: string,
    identity?: Identity | null,
    properties?: Properties | null,
  ) => void;
  /** Say who a returning visitor is (call on login). The touch stored in
   * their browser backfills the person in Ballad; nothing is counted.
   * Under Global Privacy Control nothing is sent. */
  identify: (identity: Identity | null | undefined) => void;
  /** Say which account (company, team, workspace — Segment's `group`) the
   * identified person belongs to, by your own id, with traits set once for
   * everyone in it. Sent with the identity last passed to `identify` or
   * `track` on this page (or as soon as one arrives); every later `track`
   * on the page carries the group id. */
  group: (id: string | number, traits?: Record<string, unknown> | null) => void;
  /** Say the identified person left that account (a self-service "leave
   * team", or deleting it). Sent like `group`; later tracks stop carrying
   * the id. Removals done by someone else belong server-side. */
  ungroup: (id: string | number) => void;
  /** The site token this beacon reports for. */
  site: string;
  /** Stop reporting and remove the navigation hooks. */
  destroy: () => void;
};

type BalladGlobal = {
  track: (
    name: string,
    identity?: Identity | null,
    properties?: Properties | null,
  ) => void;
  identify?: (identity: Identity | null | undefined) => void;
  group?: (id: string | number, traits?: Record<string, unknown> | null) => void;
  ungroup?: (id: string | number) => void;
  /** Calls made before init: `[["track", "signup", { email }]]`,
   * `[["identify", { email }]]`, `[["group", "ws_1", { name }]]`,
   * `[["ungroup", "ws_1"]]`. */
  q: unknown[][];
};

declare global {
  interface Window {
    ballad?: BalladGlobal;
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

let current: Beacon | null = null;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Start the beacon. Idempotent: a second call for the same site returns the
 * running beacon; a call for a different site replaces it. Safe to call on
 * the server (it does nothing there) so a shared layout can import it.
 */
export function init(options: BeaconOptions): Beacon | null {
  if (typeof window === "undefined" || typeof document === "undefined")
    return null;
  const site = options.site?.trim();
  if (!site) return null;
  if (current?.site === site) return current;
  current?.destroy();

  const endpoint = eventsUrl(options.endpoint ?? DEFAULT_ENDPOINT, site);
  const trackNavigation = options.trackNavigation ?? true;
  const respectGpc = options.respectGpc ?? true;
  const trackAttributes = options.trackAttributes ?? true;
  const handoffHosts = (options.handoff ?? []).filter(Boolean);
  const now = () => Date.now();

  const send = (payload: Payload) => {
    safe(() => {
      void fetch(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
        keepalive: true,
        credentials: "omit",
        headers: { "content-type": "text/plain" },
      }).catch(() => {});
    }, undefined);
  };
  const load = (): TouchRecord | null =>
    safe(() => parseTouchRecord(localStorage.getItem(STORAGE_KEY), now()), null);
  const save = (record: TouchRecord) =>
    safe(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(record)), undefined);

  // 1. The touch.
  const ref = safe(() => new URLSearchParams(location.search).get("ref"), null);
  const host = referrerHost(
    safe(() => document.referrer, ""),
    location.hostname,
  );
  const gpc = respectGpc && safe(() => !!navigator.globalPrivacyControl, false);

  // 0. A touch handed over from another origin (the marketing site sending
  // the visitor to the app). Adopted only when this origin has none of its
  // own; the parameter is stripped either way so it never lingers in URLs.
  const handed = safe(() => {
    const u = new URL(location.href);
    const raw = u.searchParams.get(HANDOFF_PARAM);
    if (!raw) return null;
    u.searchParams.delete(HANDOFF_PARAM);
    history.replaceState(history.state, "", u.toString());
    return raw;
  }, null);
  if (handed && !gpc && !load()) {
    const record = decodeHandoff(handed, now());
    if (record) save(record);
  }

  const existing = load();
  if (shouldRecordTouch({ gpc, ref, host, existing })) {
    const touch: Touch = {
      ...(ref ? { ref } : {}),
      path: location.pathname,
      ...(host ? { host } : {}),
      at: now(),
    };
    save(nextTouchRecord(existing, touch));
  }

  // The identity last passed on this page (identify, or a track with one),
  // in memory only. A call queued before init counts, so the landing below
  // can already carry it; every later pageview on the page does too.
  let lastIdentity: Identity | null = null;
  safe(() => {
    for (const call of window.ballad?.q ?? []) {
      if (!Array.isArray(call)) continue;
      const raw = call[0] === "identify" ? call[1] : call[0] === "track" ? call[2] : null;
      const who = raw ? normalizeIdentity(raw) : null;
      if (who) lastIdentity = who;
    }
  }, undefined);
  const withIdentity = (
    p: LandingPayload | PageviewPayload,
  ): LandingPayload | PageviewPayload =>
    lastIdentity && !gpc ? { ...p, identity: lastIdentity } : p;

  // 2. Landing once per tab, pageviews after.
  const landed = safe(() => !!sessionStorage.getItem(SESSION_KEY), false);
  safe(() => sessionStorage.setItem(SESSION_KEY, "1"), undefined);
  if (landed) send(withIdentity({ type: "pageview", path: location.pathname }));
  else send(withIdentity(landingPayload({ path: location.pathname, ref, host })));

  let lastPath = location.pathname;
  const onNavigate = () => {
    safe(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        send(withIdentity({ type: "pageview", path: lastPath }));
      }
    }, undefined);
  };
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  if (trackNavigation) {
    safe(() => {
      history.pushState = function (this: History, ...args) {
        originalPush.apply(this, args);
        onNavigate();
      };
      history.replaceState = function (this: History, ...args) {
        originalReplace.apply(this, args);
        onNavigate();
      };
      window.addEventListener("popstate", onNavigate);
    }, undefined);
  }

  // 3. Conversions.
  let currentGroup: string | null = null;
  let pendingGroup: Group | null = null;
  const pendingUngroups: string[] = [];
  const flushGroup = () => {
    if (!lastIdentity || gpc) return;
    if (pendingGroup) {
      const g = pendingGroup;
      pendingGroup = null;
      send({ type: "group", path: location.pathname, group: g, identity: lastIdentity });
    }
    while (pendingUngroups.length) {
      const id = pendingUngroups.shift() as string;
      send({ type: "ungroup", path: location.pathname, group: id, identity: lastIdentity });
    }
  };
  const track = (
    name: string,
    identity?: Identity | null,
    properties?: Properties | null,
  ) => {
    if (!isValidEventName(name)) return;
    // Under Global Privacy Control nothing identifying leaves the page —
    // not even an identity the site passed. The conversion still counts,
    // anonymously; the site can sync its own signup records server-side.
    const who = gpc ? null : normalizeIdentity(identity);
    if (who) lastIdentity = who;
    send(
      conversionPayload({
        name,
        path: location.pathname,
        record: load(),
        identity: who,
        properties: normalizeProperties(properties),
        group: currentGroup,
      }),
    );
    if (who) flushGroup();
  };
  const identify = (identity: Identity | null | undefined) => {
    if (gpc) return;
    const who = normalizeIdentity(identity);
    if (!who) return;
    lastIdentity = who;
    send(identifyPayload({ path: location.pathname, record: load(), identity: who }));
    flushGroup();
  };
  const group = (id: string | number, traits?: Record<string, unknown> | null) => {
    const g = normalizeGroup(id, traits);
    if (!g) return;
    currentGroup = g.id;
    if (gpc) return;
    pendingGroup = g;
    flushGroup();
  };
  const ungroup = (id: string | number) => {
    const gid = normalizeGroupId(id);
    if (!gid) return;
    if (currentGroup === gid) currentGroup = null;
    if (pendingGroup?.id === gid) pendingGroup = null;
    if (gpc) return;
    pendingUngroups.push(gid);
    flushGroup();
  };
  const onClick = (e: Event) => {
    safe(() => {
      const el = (e.target as Element | null)?.closest?.("[data-ballad-track]");
      if (el && el.tagName !== "FORM")
        track(el.getAttribute("data-ballad-track") ?? "");
    }, undefined);
  };
  const onSubmit = (e: Event) => {
    safe(() => {
      const form = e.target as HTMLFormElement | null;
      const name = form?.getAttribute?.("data-ballad-track");
      if (!name) return;
      const identify = form?.hasAttribute?.("data-ballad-identify");
      track(name, identify && form ? identityFromForm(form) : null);
    }, undefined);
  };
  if (trackAttributes) {
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
  }
  // Links to a handoff host carry the touch across.
  const onHandoffClick = (e: Event) => {
    safe(() => {
      if (gpc) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as
        | HTMLAnchorElement
        | null
        | undefined;
      if (!a) return;
      const u = new URL(a.href, location.href);
      if (!isHandoffHost(u.hostname, location.hostname, handoffHosts)) return;
      const record = load();
      if (!record) return;
      u.searchParams.set(HANDOFF_PARAM, encodeHandoff(record));
      a.href = u.toString();
    }, undefined);
  };
  if (handoffHosts.length)
    document.addEventListener("click", onHandoffClick, true);

  // The `window.ballad` global the script-tag beacon also provides, so
  // `window.ballad.track("signup")` in existing code keeps working, and
  // calls queued before init are replayed.
  const queued = safe(() => window.ballad?.q ?? [], []);
  window.ballad = { track, identify, group, ungroup, q: [] };
  for (const call of queued)
    safe(() => {
      if (!Array.isArray(call)) return;
      if (call[0] === "track")
        track(
          String(call[1]),
          normalizeIdentity(call[2]),
          normalizeProperties(call[3]),
        );
      else if (call[0] === "identify") identify(normalizeIdentity(call[1]));
      else if (call[0] === "group")
        group(call[1] as string, call[2] as Record<string, unknown> | null);
      else if (call[0] === "ungroup") ungroup(call[1] as string);
    }, undefined);

  const beacon: Beacon = {
    site,
    track,
    identify,
    group,
    ungroup,
    destroy: () => {
      safe(() => {
        if (trackNavigation) {
          history.pushState = originalPush;
          history.replaceState = originalReplace;
          window.removeEventListener("popstate", onNavigate);
        }
        if (trackAttributes) {
          document.removeEventListener("click", onClick, true);
          document.removeEventListener("submit", onSubmit, true);
        }
        if (handoffHosts.length)
          document.removeEventListener("click", onHandoffClick, true);
        if (window.ballad?.track === track) delete window.ballad;
      }, undefined);
      if (current === beacon) current = null;
    },
  };
  current = beacon;
  return beacon;
}

/**
 * Report a conversion through the running beacon. Before `init` (or on the
 * server) the call is queued and replayed once the beacon starts, so a
 * signup handler never has to know whether the beacon loaded first.
 */
export function track(
  name: string,
  identity?: Identity | null,
  properties?: Properties | null,
): void {
  if (current) {
    current.track(name, identity, properties);
    return;
  }
  if (typeof window === "undefined") return;
  safe(() => {
    const g = (window.ballad ??= { track: () => {}, q: [] });
    g.q.push(
      properties
        ? ["track", name, identity ?? null, properties]
        : identity
          ? ["track", name, identity]
          : ["track", name],
    );
  }, undefined);
}

/**
 * Say which account the identified person belongs to (Segment's `group`):
 * `group("ws_1", { name: "Acme", plan: "pro" })`. Call `identify` (or a
 * `track` with an identity) on the same page — the group is sent with that
 * identity, before or after. Queued before `init` like `track`.
 */
export function group(
  id: string | number,
  traits?: Record<string, unknown> | null,
): void {
  if (current) {
    current.group(id, traits);
    return;
  }
  if (typeof window === "undefined") return;
  safe(() => {
    const g = (window.ballad ??= { track: () => {}, q: [] });
    g.q.push(traits ? ["group", id, traits] : ["group", id]);
  }, undefined);
}

/**
 * Say who the current visitor is (call on login). Queued before `init`
 * like `track`. Under Global Privacy Control nothing is sent.
 */
export function identify(identity: Identity | null | undefined): void {
  if (current) {
    current.identify(identity);
    return;
  }
  if (typeof window === "undefined") return;
  safe(() => {
    const g = (window.ballad ??= { track: () => {}, q: [] });
    g.q.push(["identify", identity]);
  }, undefined);
}

/**
 * Say the identified person left an account: `ungroup("ws_1")`. The
 * opposite of `group`, for the flows that happen in the leaver's own
 * browser — leaving a team, deleting a workspace. A removal done by an
 * admin belongs server-side (`ungroup_contact`). Queued before `init`.
 */
export function ungroup(id: string | number): void {
  if (current) {
    current.ungroup(id);
    return;
  }
  if (typeof window === "undefined") return;
  safe(() => {
    const g = (window.ballad ??= { track: () => {}, q: [] });
    g.q.push(["ungroup", id]);
  }, undefined);
}

/** The running beacon, if any. */
export function getBeacon(): Beacon | null {
  return current;
}

export const ballad = { init, track, identify, group, ungroup, getBeacon };
export default ballad;
