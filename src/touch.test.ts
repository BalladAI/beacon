import { describe, expect, it } from "vitest";
import {
  conversionPayload,
  eventsUrl,
  isValidEventName,
  landingPayload,
  nextTouchRecord,
  parseTouchRecord,
  referrerHost,
  shouldRecordTouch,
  TOUCH_TTL_MS,
} from "./touch";

describe("eventsUrl", () => {
  it("builds the events route on the app origin", () => {
    expect(eventsUrl("https://app.balladlabs.com", "abc")).toBe(
      "https://app.balladlabs.com/api/public/sites/abc/events",
    );
    expect(eventsUrl("https://mirror.example/", "a b")).toBe(
      "https://mirror.example/api/public/sites/a%20b/events",
    );
  });
});

describe("referrerHost", () => {
  it("keeps external hosts and drops the site's own", () => {
    expect(referrerHost("https://news.ycombinator.com/item?id=1", "acme.com")).toBe(
      "news.ycombinator.com",
    );
    expect(referrerHost("https://acme.com/pricing", "acme.com")).toBe("");
    expect(referrerHost("", "acme.com")).toBe("");
    expect(referrerHost("not a url", "acme.com")).toBe("");
  });
});

describe("touch record", () => {
  const now = 1_700_000_000_000;
  it("parses a live record and expires an old first touch", () => {
    const rec = { first: { path: "/", at: now - 1000 }, last: { path: "/b", at: now } };
    expect(parseTouchRecord(JSON.stringify(rec), now)).toEqual(rec);
    const old = { first: { path: "/", at: now - TOUCH_TTL_MS - 1 } };
    expect(parseTouchRecord(JSON.stringify(old), now)).toBeNull();
    expect(parseTouchRecord("nope", now)).toBeNull();
    expect(parseTouchRecord(null, now)).toBeNull();
  });
  it("records a first visit, a ref, or an external referral — never under GPC", () => {
    expect(shouldRecordTouch({ gpc: false, ref: null, host: "", existing: null })).toBe(true);
    const existing = { first: { path: "/", at: now }, last: { path: "/", at: now } };
    expect(shouldRecordTouch({ gpc: false, ref: null, host: "", existing })).toBe(false);
    expect(shouldRecordTouch({ gpc: false, ref: "tok", host: "", existing })).toBe(true);
    expect(shouldRecordTouch({ gpc: false, ref: null, host: "x.com", existing })).toBe(true);
    expect(shouldRecordTouch({ gpc: true, ref: "tok", host: "x.com", existing: null })).toBe(false);
  });
  it("keeps the first touch and moves the last", () => {
    const first = { ref: "a", path: "/", at: now - 5 };
    const later = { path: "/pricing", host: "x.com", at: now };
    expect(nextTouchRecord(null, first)).toEqual({ first, last: first });
    expect(nextTouchRecord({ first, last: first }, later)).toEqual({ first, last: later });
  });
});

describe("payloads", () => {
  it("shape a landing and a conversion the way /b.js does", () => {
    expect(landingPayload({ path: "/blog/x", ref: "tok", host: "x.com" })).toEqual({
      type: "landing",
      path: "/blog/x",
      ref: "tok",
      referrer: "x.com",
    });
    expect(landingPayload({ path: "/", ref: null, host: "" })).toEqual({
      type: "landing",
      path: "/",
    });
    const record = { first: { path: "/", at: 1 }, last: { path: "/p", at: 2 } };
    expect(conversionPayload({ name: "signup", path: "/p", record })).toEqual({
      type: "conversion",
      name: "signup",
      path: "/p",
      first: record.first,
      last: record.last,
    });
  });
  it("accepts short identifiers as event names only", () => {
    expect(isValidEventName("signup")).toBe(true);
    expect(isValidEventName("demo_request")).toBe(true);
    expect(isValidEventName("")).toBe(false);
    expect(isValidEventName("has space")).toBe(false);
    expect(isValidEventName(42)).toBe(false);
  });
});

describe("identity", () => {
  it("normalizes a usable identity and rejects the rest", async () => {
    const { normalizeIdentity, identityFromForm } = await import("./touch");
    expect(normalizeIdentity({ email: " Ada@Example.com ", name: "Ada  L", company: "Analytical" })).toEqual({
      email: "ada@example.com",
      name: "Ada L",
      company: "Analytical",
    });
    expect(normalizeIdentity({ email: "a@b.co" })).toEqual({ email: "a@b.co" });
    expect(normalizeIdentity({ email: "nope" })).toBeNull();
    expect(normalizeIdentity("a@b.co")).toBeNull();
    expect(normalizeIdentity(undefined)).toBeNull();
    const form = {
      querySelector: (sel: string) =>
        sel.includes("email") ? { value: "Form@Example.com" } : sel.includes('name="company"') ? { value: "Acme" } : null,
    };
    expect(identityFromForm(form)).toEqual({ email: "form@example.com", company: "Acme" });
  });
});
