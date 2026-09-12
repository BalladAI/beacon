/**
 * The pure parts of the beacon: what a touch is, when to record one, and
 * how the payloads are shaped. No DOM here, so all of it is unit-tested;
 * `index.ts` wires these to the page.
 *
 * Wire compatibility: the storage keys and payloads are identical to the
 * script-tag beacon Ballad serves at /b.js, so a site can move from one to
 * the other (or run the package on some pages and the tag on others)
 * without losing a visitor's first touch or double-counting a landing.
 */

/** One touch: how a visitor arrived — a Ballad `?ref=` token if the link
 * carried one, the page, and the external referrer's host. */
export type Touch = {
  ref?: string;
  path: string;
  host?: string;
  at: number;
};

/** First and most recent touch for this visitor, on this site. */
export type TouchRecord = { first: Touch; last: Touch };

export const STORAGE_KEY = "ballad:touch";
export const SESSION_KEY = "ballad:landed";
export const TOUCH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const DEFAULT_ENDPOINT = "https://app.balladlabs.com";

export type LandingPayload = {
  type: "landing";
  path: string;
  ref?: string;
  referrer?: string;
};
export type PageviewPayload = { type: "pageview"; path: string };
/** Who converted, when the site chooses to say: the email its signup form
 * already has, optionally a name and company. Sent only when passed. */
export type Identity = { email: string; name?: string; company?: string };

/** Flat event properties, or an account's traits: strings, numbers and
 * booleans, at most 20 keys. */
export type Properties = Record<string, string | number | boolean>;

/** An account (Segment's `group`): the company, team or workspace the
 * person belongs to in your product, by your own id. */
export type Group = { id: string; name?: string; traits?: Properties };

export type ConversionPayload = {
  type: "conversion";
  name: string;
  path: string;
  first?: Touch;
  last?: Touch;
  identity?: Identity;
  properties?: Properties;
  /** The account the conversion happened in (the id passed to `group`). */
  group?: string;
};
/** The identified person belongs to this account. Nothing is counted. */
export type GroupPayload = {
  type: "group";
  path: string;
  group: Group;
  identity: Identity;
};
/** The identified person left this account (recorded as `left_account`). */
export type UngroupPayload = {
  type: "ungroup";
  path: string;
  group: string;
  identity: Identity;
};
/** Who a returning visitor is (on login). Carries the touch the browser kept
 * so Ballad can backfill the person; nothing is counted. */
export type IdentifyPayload = {
  type: "identify";
  path: string;
  first?: Touch;
  last?: Touch;
  identity: Identity;
};

export type Payload =
  | LandingPayload
  | PageviewPayload
  | ConversionPayload
  | IdentifyPayload
  | GroupPayload
  | UngroupPayload;

/** The events URL for a site token, on Ballad's app origin (or a mirror). */
export function eventsUrl(endpoint: string, site: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return `${base}/api/public/sites/${encodeURIComponent(site)}/events`;
}

/** Hostname of a referrer URL, or "" when it's unparseable or the site's
 * own host (an internal navigation is not a referral). */
export function referrerHost(referrer: string, ownHost: string): string {
  if (!referrer) return "";
  try {
    const host = new URL(referrer).hostname;
    return host === ownHost ? "" : host;
  } catch {
    return "";
  }
}

/** Parse a stored record, dropping it once the first touch has expired. */
export function parseTouchRecord(
  raw: string | null,
  now: number,
): TouchRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<TouchRecord> | null;
    if (!v || !v.first || typeof v.first.at !== "number") return null;
    if (now - v.first.at >= TOUCH_TTL_MS) return null;
    return { first: v.first, last: v.last ?? v.first };
  } catch {
    return null;
  }
}

/**
 * Whether this page load is a touch worth recording: it carried a ref, or
 * came from another site, or is the visitor's very first page here. A
 * visitor with Global Privacy Control on is never recorded.
 */
export function shouldRecordTouch(params: {
  gpc: boolean;
  ref: string | null;
  host: string;
  existing: TouchRecord | null;
}): boolean {
  if (params.gpc) return false;
  return !!params.ref || !!params.host || !params.existing;
}

/** The record after this page load — a new first touch, or a new last. */
export function nextTouchRecord(
  existing: TouchRecord | null,
  touch: Touch,
): TouchRecord {
  if (!existing) return { first: touch, last: touch };
  return { first: existing.first, last: touch };
}

export function landingPayload(params: {
  path: string;
  ref: string | null;
  host: string;
}): LandingPayload {
  return {
    type: "landing",
    path: params.path,
    ...(params.ref ? { ref: params.ref } : {}),
    ...(params.host ? { referrer: params.host } : {}),
  };
}

export function conversionPayload(params: {
  name: string;
  path: string;
  record: TouchRecord | null;
  identity?: Identity | null;
  properties?: Properties | null;
  group?: string | null;
}): ConversionPayload {
  return {
    type: "conversion",
    name: params.name,
    path: params.path,
    ...(params.record ? { first: params.record.first, last: params.record.last } : {}),
    ...(params.identity ? { identity: params.identity } : {}),
    ...(params.properties ? { properties: params.properties } : {}),
    ...(params.group ? { group: params.group } : {}),
  };
}

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/i;
export const GROUP_ID_RE = /^[\w.:@+-]{1,120}$/;

/** Flat properties only: strings (trimmed, 200 chars), finite numbers and
 * booleans, at most 20 keys with identifier-like names. */
export function normalizeProperties(raw: unknown): Properties | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Properties = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 20) break;
    if (!KEY_RE.test(k)) continue;
    if (typeof v === "string") {
      const s = trim(v, 200);
      if (!s) continue;
      out[k] = s;
    } else if (typeof v === "number") {
      if (!Number.isFinite(v)) continue;
      out[k] = v;
    } else if (typeof v === "boolean") out[k] = v;
    else continue;
    n++;
  }
  return n ? out : null;
}

export function normalizeGroupId(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const id = String(raw).trim();
  return GROUP_ID_RE.test(id) ? id : null;
}

/** `group("ws_1", { name: "Acme", plan: "pro" })`: the name is lifted out,
 * the rest are traits. */
export function normalizeGroup(id: unknown, traits?: unknown): Group | null {
  const gid = normalizeGroupId(id);
  if (!gid) return null;
  const out: Group = { id: gid };
  if (traits && typeof traits === "object") {
    const { name, ...rest } = traits as Record<string, unknown>;
    const n = trim(name, 120);
    if (n) out.name = n;
    const t = normalizeProperties(rest);
    if (t) out.traits = t;
  }
  return out;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const trim = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
};

/** A usable identity, or null: a valid email (lowercased) is required;
 * name and company ride along when present; anything else is dropped. */
export function identifyPayload(params: {
  path: string;
  record: TouchRecord | null;
  identity: Identity;
}): IdentifyPayload {
  const out: IdentifyPayload = {
    type: "identify",
    path: params.path,
    identity: params.identity,
  };
  if (params.record) {
    out.first = params.record.first;
    out.last = params.record.last;
  }
  return out;
}

/* ---------------- Cross-origin handoff ---------------- */

/** The query parameter that carries a touch record to another origin. */
export const HANDOFF_PARAM = "bt";

function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function unb64url(s: string): string {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return decodeURIComponent(escape(atob(t)));
}

function validTouch(t: unknown): t is Touch {
  if (!t || typeof t !== "object") return false;
  const v = t as Record<string, unknown>;
  if (typeof v.path !== "string" || v.path.length > 512) return false;
  if (typeof v.at !== "number" || !Number.isFinite(v.at)) return false;
  if (v.ref != null && (typeof v.ref !== "string" || v.ref.length > 16))
    return false;
  if (v.host != null && (typeof v.host !== "string" || v.host.length > 253))
    return false;
  return true;
}

/** A touch record as a URL-safe string for the `bt` parameter. */
export function encodeHandoff(record: TouchRecord): string {
  return b64url(JSON.stringify({ f: record.first, l: record.last }));
}

/** The record carried by a `bt` parameter, or null when it's malformed,
 * expired, or not ours. */
export function decodeHandoff(raw: string, now: number): TouchRecord | null {
  try {
    const v = JSON.parse(unb64url(raw)) as { f?: unknown; l?: unknown } | null;
    if (!v || !validTouch(v.f)) return null;
    if (now - v.f.at >= TOUCH_TTL_MS || v.f.at > now + 60_000) return null;
    return { first: v.f, last: validTouch(v.l) ? v.l : v.f };
  } catch {
    return null;
  }
}

/** Whether a link's host is one the touch should follow the visitor to. */
export function isHandoffHost(
  hostname: string,
  ownHost: string,
  hosts: readonly string[],
): boolean {
  const h = hostname.toLowerCase();
  if (!h || h === ownHost.toLowerCase()) return false;
  return hosts.some((x) => x.trim().toLowerCase() === h);
}

export function normalizeIdentity(raw: unknown): Identity | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const email = trim(o.email, 254)?.toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return null;
  const name = trim(o.name, 120);
  const company = trim(o.company, 120);
  return { email, ...(name ? { name } : {}), ...(company ? { company } : {}) };
}

/** The identity a form volunteers: its email input, plus name and company
 * inputs when it has them. Only for forms marked `data-ballad-identify`. */
export function identityFromForm(form: {
  querySelector: (sel: string) => { value?: string } | null;
}): Identity | null {
  const val = (sel: string) => form.querySelector(sel)?.value;
  return normalizeIdentity({
    email: val('input[type="email"]') ?? val('input[name="email"]'),
    name: val('input[name="name"]') ?? val('input[autocomplete="name"]'),
    company: val('input[name="company"]') ?? val('input[autocomplete="organization"]'),
  });
}

/** Conversion names are short identifiers; anything else is dropped. */
export function isValidEventName(name: unknown): name is string {
  return typeof name === "string" && /^[a-z][a-z0-9_-]{0,39}$/i.test(name);
}
