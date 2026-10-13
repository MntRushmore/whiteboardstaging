import { describe, expect, it } from "vitest";
import { CookieJar, visit, world } from "./fakeBrowser";

/**
 * Whole visits to `/` (docs/LANDING-V3.md "Root"): the server's rewrite (Next's matcher, the real
 * rule), the landing page's SessionHop, the boards home's gate, AuthProvider's cookie and the page's
 * own signed-out check, page load after page load until the browser stops. A visit that has not
 * stopped after 25 loads is a loop; every case here must stop within a handful.
 */

const SESSION = "sb-127-auth-token";

describe("a visit to agathon.app/", () => {
  it("a new visitor gets the landing page at /, query kept, in one load", () => {
    expect(visit(world(), "/?ref=ABC234&utm_source=tiktok")).toEqual({
      loads: ["landing /?ref=ABC234&utm_source=tiktok"],
      end: "landing /?ref=ABC234&utm_source=tiktok",
    });
  });

  it("someone signed in gets the app in one load, and keeps the flag", () => {
    const w = world({ local: [SESSION] });
    w.jar.cookie = "agathon_session=1; Path=/";
    expect(visit(w, "/").loads).toEqual(["app /"]);
    expect(w.jar.cookie).toBe("agathon_session=1");
  });

  it("a device signed in before the flag existed hops once, then gets the app at the same address", () => {
    const w = world({ local: [SESSION] });
    expect(visit(w, "/?ref=ABC234#top").loads).toEqual(["landing /?ref=ABC234#top", "app /?ref=ABC234#top"]);
    // and next time, straight in
    expect(visit(w, "/").loads).toEqual(["app /"]);
  });

  it("an email link with its tokens in the hash reaches the app, which signs it in", () => {
    const w = world();
    expect(visit(w, "/#access_token=x&refresh_token=y&type=signup").loads[1]).toBe("app /#access_token=x&refresh_token=y&type=signup");
  });

  it("an email link with an error in the query goes to sign in, as before", () => {
    expect(visit(world(), "/?error=access_denied&error_code=otp_expired").loads).toEqual([
      "app /?error=access_denied&error_code=otp_expired",
      "login /login",
    ]);
  });

  it("a signed-out device with a stale flag reloads / once and gets the landing page there", () => {
    const w = world();
    w.jar.cookie = "agathon_session=1; Path=/";
    expect(visit(w, "/?ref=ABC234").loads).toEqual(["app /?ref=ABC234", "landing /?ref=ABC234"]);
    expect(w.jar.cookie).toBe("");
  });

  it("signing out (the session gone, the flag cleared) leaves / as the landing page", () => {
    const w = world();
    expect(visit(w, "/").loads).toEqual(["landing /"]);
  });

  it("a stored session supabase-js turns down (and leaves behind) costs two extra loads, never a loop", () => {
    const w = world({ local: [SESSION], sessionValid: false });
    const v = visit(w, "/");
    expect(v.loads).toEqual(["landing /", "app /", "landing /"]);
  });
});

describe("never a loop", () => {
  /** [what, the world, starts with the flag set, where it settles] */
  const cases: [string, Parameters<typeof world>[0], boolean, string][] = [
    ["cookies blocked, signed out", { jar: new CookieJar("blocked") }, false, "landing"],
    ["cookies blocked, a stored session", { jar: new CookieJar("blocked"), local: [SESSION] }, false, "landing"],
    ["a flag on another Domain the page cannot clear, signed out", { jar: new CookieJar("stuck") }, true, "landing"],
    ["an HttpOnly flag the page cannot see, signed out", { jar: new CookieJar("invisible") }, false, "landing"],
    ["the tab's storage throws, a stored session, no flag", { tab: null, local: [SESSION] }, false, "landing"],
    ["the tab's storage throws, a stored session, the flag", { tab: null, local: [SESSION] }, true, "app"],
    ["the tab's storage throws, a stale flag", { tab: null }, true, "landing"],
    ["a cache answering / with the app, signed out", { server: "always-app" }, true, "landing"],
    ["a cache answering / with the landing page, signed in", { server: "always-landing", local: [SESSION] }, true, "landing"],
    ["a cache answering / with the app, a turned-down session", { server: "always-app", local: [SESSION], sessionValid: false }, true, "landing"],
    ["a turned-down session with a stuck flag", { jar: new CookieJar("stuck"), local: [SESSION], sessionValid: false }, true, "landing"],
    ["a turned-down session, no flag", { local: [SESSION], sessionValid: false }, false, "landing"],
    ["plain http (localhost), a stored session, no flag", { protocol: "http:", local: [SESSION] }, false, "app"],
  ];

  for (const [name, over, flag, settles] of cases) {
    it(`${name}: settles in a few loads`, () => {
      const w = world(over);
      if (flag) w.jar.cookie = "agathon_session=1; Path=/";
      for (const url of ["/", "/?ref=ABC234#pricing", "/"]) {
        const v = visit(w, url);
        expect(v.loads.length, v.loads.join(" → ")).toBeLessThanOrEqual(4);
        expect(v.end.split(" ")[0], v.loads.join(" → ")).toBe(settles);
      }
    });
  }

  it("/parents never sends anyone anywhere, signed in or not", () => {
    for (const local of [[], [SESSION]]) {
      const w = world({ local });
      expect(visit(w, "/parents?ref=A").loads).toEqual(["landing /parents?ref=A"]);
    }
  });
});
