import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBeacon, init, track } from "./index";
import { SESSION_KEY, STORAGE_KEY } from "./touch";

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
    Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
  });

  it("is idempotent per site and replaceable", () => {
    const a = init({ site: "same" });
    expect(init({ site: "same" })).toBe(a);
    const b = init({ site: "other" });
    expect(b).not.toBe(a);
    expect(getBeacon()).toBe(b);
  });
});
