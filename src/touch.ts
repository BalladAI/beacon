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

export type ConversionPayload = {
  type: "conversion";
  name: string;
  path: string;
  first?: Touch;
  last?: Touch;
  identity?: Identity;
};
export type Payload = LandingPayload | PageviewPayload | ConversionPayload;

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
}): ConversionPayload {
  return {
    type: "conversion",
    name: params.name,
    path: params.path,
    ...(params.record ? { first: params.record.first, last: params.record.last } : {}),
    ...(params.identity ? { identity: params.identity } : {}),
  };
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const trim = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
};

/** A usable identity, or null: a valid email (lowercased) is required;
 * name and company ride along when present; anything else is dropped. */
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
