import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBeacon, group, identify, init, track } from "./index";
import { encodeHandoff, SESSION_KEY, STORAGE_KEY } from "./touch";

/** The beacon against jsdom: what it sends, and when. */
describe("beacon", () => {
  const sent: unknown[] = [];
  beforeEach(() => {
    sent.length = 0;
    localStorage.clear();
    sessionStorage.clear();
    delete window.ballad;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 204 });
      }),
    );
    history.replaceState(null, "", "/");
  });
  afterEach(() => {
    getBeacon()?.destroy();
    vi.unstubAllGlobals();
  });

  it("does nothing without a site token", () => {
    expect(init({ site: "" })).toBeNull();
    expect(sent).toEqual([]);
  });

  it("reports a landing, keeps the touch, then pageviews on navigation", () => {
    history.replaceState(null, "", "/blog/hello?ref=tok123");
    const b = init({ site: "site-1" });
    expect(b?.site).toBe("site-1");
    expect(sent[0]).toEqual({ type: "landing", path: "/blog/hello", ref: "tok123" });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(stored.first.ref).toBe("tok123");
    expect(sessionStorage.getItem(SESSION_KEY)).toBe("1");

    history.pushState(null, "", "/pricing");
    expect(sent[1]).toEqual({ type: "pageview", path: "/pricing" });
    history.pushState(null, "", "/pricing"); // same path: nothing
    expect(sent).toHaveLength(2);
  });

  it("posts to the site's events route on the app origin", () => {
    init({ site: "site-2" });
    const url = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(url).toBe("https://app.balladlabs.com/api/public/sites/site-2/events");
  });

  it("sends a conversion with first and last touch, and honours the queue", () => {
    // A signup handler that ran before the beacon loaded.
    track("signup");
    expect(window.ballad?.q).toEqual([["track", "signup"]]);
    history.replaceState(null, "", "/?ref=first");
    init({ site: "site-3" });
    const conv = sent.find((p) => (p as { type: string }).type === "conversion") as {
      name: string;
      first: { ref?: string };
    };
    expect(conv.name).toBe("signup");
    expect(conv.first.ref).toBe("first");
    // The global stays wired for legacy callers.
    window.ballad?.track("demo_request");
    expect(sent[sent.length - 1]).toMatchObject({ type: "conversion", name: "demo_request" });
    track("bad name!");
    expect(sent[sent.length - 1]).toMatchObject({ name: "demo_request" });
  });

  it("sends an identity with a conversion when given one, and queues it", () => {
    track("signup", { email: "Queued@Example.com", name: "Q" });
    init({ site: "site-6" });
    const queued = sent.find((p) => (p as { type: string }).type === "conversion") as { identity?: unknown };
    expect(queued.identity).toEqual({ email: "queued@example.com", name: "Q" });
    getBeacon()?.track("demo_request", { email: "bad" });
    expect((sent[sent.length - 1] as { identity?: unknown }).identity).toBeUndefined();
    getBeacon()?.track("demo_request");
    expect((sent[sent.length - 1] as { identity?: unknown }).identity).toBeUndefined();
  });

  it("reads the email from a data-ballad-identify form on submit", () => {
    init({ site: "site-7" });
    const form = document.createElement("form");
    form.setAttribute("data-ballad-track", "signup");
    form.setAttribute("data-ballad-identify", "");
    const email = document.createElement("input");
    email.type = "email";
    email.value = "Form@Example.com";
    form.appendChild(email);
    document.body.appendChild(form);
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(sent[sent.length - 1]).toMatchObject({ type: "conversion", name: "signup", identity: { email: "form@example.com" } });
    form.remove();
  });

  it("tracks data-ballad-track clicks", () => {
    init({ site: "site-4" });
    const btn = document.createElement("button");
    btn.setAttribute("data-ballad-track", "signup");
    document.body.appendChild(btn);
    btn.click();
    expect(sent[sent.length - 1]).toMatchObject({ type: "conversion", name: "signup" });
    btn.remove();
  });

  it("never stores a touch under Global Privacy Control", () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    history.replaceState(null, "", "/?ref=tok");
    init({ site: "site-5" });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // The landing itself is still counted (no identifier in it).
    expect(sent[0]).toMatchObject({ type: "landing", ref: "tok" });
    // And an identity the site passes is dropped: the conversion stays anonymous.
    getBeacon()?.track("signup", { email: "ada@example.com" });
    expect(sent[sent.length - 1]).toMatchObject({ type: "conversion", name: "signup" });
    expect((sent[sent.length - 1] as { identity?: unknown }).identity).toBeUndefined();
    Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
  });

  it("identifies a returning visitor with the stored touch, queued or live", () => {
    window.ballad = { track: () => {}, q: [["identify", { email: "Back@Example.com" }]] };
    const b = init({ site: "site-8" });
    const queued = sent.find((p) => (p as { type: string }).type === "identify") as {
      identity?: unknown;
      first?: unknown;
    };
    expect(queued.identity).toEqual({ email: "back@example.com" });
    expect(queued.first).toBeDefined();
    b?.identify({ email: "not an email" });
    expect(sent.filter((p) => (p as { type: string }).type === "identify")).toHaveLength(1);
    b?.identify({ email: "again@example.com", company: "Acme" });
    const last = sent[sent.length - 1] as { type: string; identity?: unknown };
    expect(last.type).toBe("identify");
    expect(last.identity).toEqual({ email: "again@example.com", company: "Acme" });
  });

  it("sends nothing on identify under Global Privacy Control", () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    const b = init({ site: "site-9" });
    const before = sent.length;
    b?.identify({ email: "gpc@example.com" });
    expect(sent.length).toBe(before);
    Object.defineProperty(navigator, "globalPrivacyControl", { value: false, configurable: true });
  });

  it("adopts a handed-off touch from the URL and strips the parameter", () => {
    const rec = {
      first: { ref: "hn1", path: "/blog/why", host: "news.ycombinator.com", at: Date.now() - 5000 },
      last: { path: "/pricing", at: Date.now() - 1000 },
    };
    history.replaceState(null, "", `/signin?bt=${encodeHandoff(rec)}&next=%2Fapp`);
    init({ site: "site-10" });
    expect(location.search).toBe("?next=%2Fapp");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(stored.first).toEqual(rec.first);
    const landing = sent.find((p) => (p as { type: string }).type === "landing");
    expect(landing).toBeDefined();
  });

  it("keeps an existing touch over a handed-off one", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ first: { path: "/here", at: Date.now() - 9000 }, last: { path: "/here", at: Date.now() - 9000 } }),
    );
    history.replaceState(null, "", `/?bt=${encodeHandoff({ first: { path: "/there", at: Date.now() }, last: { path: "/there", at: Date.now() } })}`);
    init({ site: "site-11" });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null").first.path).toBe("/here");
    expect(location.search).toBe("");
  });

  it("carries the touch on links to handoff hosts, and only those", () => {
    init({ site: "site-12", handoff: ["app.example.com"] });
    const to = document.createElement("a");
    to.href = "https://app.example.com/signin?next=%2Fdash";
    const elsewhere = document.createElement("a");
    elsewhere.href = "https://other.example.com/";
    document.body.append(to, elsewhere);
    for (const a of [to, elsewhere]) a.addEventListener("click", (e) => e.preventDefault());
    to.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    elsewhere.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const u = new URL(to.href);
    expect(u.searchParams.get("next")).toBe("/dash");
    expect(u.searchParams.get("bt")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(new URL(elsewhere.href).searchParams.get("bt")).toBeNull();
    to.remove();
    elsewhere.remove();
  });

  it("is idempotent per site and replaceable", () => {
    const a = init({ site: "same" });
    expect(init({ site: "same" })).toBe(a);
    const b = init({ site: "other" });
    expect(b).not.toBe(a);
    expect(getBeacon()).toBe(b);
  });

  it("sends properties with a conversion, and the current group id", () => {
    init({ site: "site-1" });
    sent.length = 0;
    group("ws_1", { name: "Acme", plan: "pro", nested: { no: 1 } });
    // No identity yet: the group waits; the track still carries the id.
    expect(sent).toEqual([]);
    track("published", null, { count: 3, ok: true, "bad key": 1 });
    expect(sent[0]).toMatchObject({
      type: "conversion",
      name: "published",
      properties: { count: 3, ok: true },
      group: "ws_1",
    });
    expect((sent[0] as { properties: object }).properties).not.toHaveProperty("bad key");
  });

  it("sends the group once an identity is known, with lifted name and traits", () => {
    init({ site: "site-1" });
    sent.length = 0;
    group(42, { name: " Acme ", plan: "pro" });
    identify({ email: "A@Example.com" });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      type: "identify",
      path: "/",
      identity: { email: "a@example.com" },
    });
    expect(sent[1]).toEqual({
      type: "group",
      path: "/",
      group: { id: "42", name: "Acme", traits: { plan: "pro" } },
      identity: { email: "a@example.com" },
    });
    // Identity first, then group: sent immediately.
    group("ws_2");
    expect(sent[2]).toMatchObject({ type: "group", group: { id: "ws_2" } });
  });

  it("queues group and track-with-properties before init", () => {
    group("ws_1", { name: "Acme" });
    track("signup", { email: "a@example.com" }, { plan: "pro" });
    init({ site: "site-1" });
    const types = sent.map((p) => (p as { type: string }).type);
    expect(types).toEqual(["landing", "conversion", "group"]);
    expect(sent[1]).toMatchObject({ properties: { plan: "pro" }, group: "ws_1" });
  });

  it("drops a malformed group id and nothing under GPC", () => {
    init({ site: "site-1" });
    sent.length = 0;
    group("has space");
    identify({ email: "a@example.com" });
    expect(sent).toHaveLength(1);
    getBeacon()?.destroy();
    vi.stubGlobal("navigator", { ...navigator, globalPrivacyControl: true });
    init({ site: "site-1" });
    sent.length = 0;
    group("ws_1");
    identify({ email: "a@example.com" });
    track("signup", null, { plan: "pro" });
    expect(sent.map((p) => (p as { type: string }).type)).toEqual(["conversion"]);
    expect(sent[0]).not.toHaveProperty("identity");
  });
});
