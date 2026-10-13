import { describe, expect, it, vi } from "vitest";
import {
  earlySignedOutDestination,
  enterRoot,
  hasAuthParams,
  hasStoredSession,
  HOP_KEY,
  HOP_PAUSE_MS,
  LANDING_PATH,
  LANDING_ROUTE,
  prepareRootReload,
  PRODUCTION_ORIGIN,
  ROOT_LANDING_REWRITE,
  ROOT_RELOAD_KEY,
  SESSION_HOP_SCRIPT,
  shouldHop,
  SIGN_IN_HREF,
  SIGN_UP_HREF,
  SIGNED_OUT_GATE_SCRIPT,
  signedOutDestination,
  siteOrigin,
  wantsSignUp,
} from "../links";
import { CookieJar, page, runScript, serveRoot, TabStorage, world } from "./fakeBrowser";

const yes = () => true;
const no = () => false;

describe("where links to the landing page point", () => {
  it("is the site root, rendered by /parents", () => {
    expect(LANDING_PATH).toBe("/");
    expect(LANDING_ROUTE).toBe("/parents");
  });
});

describe("the rewrite of / (judged by Next's own matcher)", () => {
  it("serves the landing page to a request with no session flag and no email link", () => {
    expect(serveRoot("", "")).toBe("landing");
    expect(serveRoot("_ga=GA1.1; theme=light", "?ref=ABC234&utm_source=tiktok")).toBe("landing");
    expect(serveRoot("", "?mode=signup")).toBe("landing");
  });

  it("serves the app once the flag is there", () => {
    expect(serveRoot("agathon_session=1", "")).toBe("app");
    expect(serveRoot("_ga=x; agathon_session=1", "?ref=ABC234")).toBe("app");
  });

  it("serves the app to an email link's query, so supabase-js can sign it in", () => {
    for (const key of ["code", "token_hash", "error", "error_code", "error_description"]) {
      expect(serveRoot("", `?${key}=abc`)).toBe("app");
    }
  });

  it("needs every condition: one present is enough to serve the app", () => {
    expect(serveRoot("agathon_session=1", "?code=abc")).toBe("app");
    // an empty value counts as absent, for the cookie and the query alike
    expect(serveRoot("agathon_session=", "")).toBe("landing");
    expect(serveRoot("", "?code=")).toBe("landing");
  });

  it("is a beforeFiles rule from / to /parents, keyed on the cookie and the email-link parameters", () => {
    expect(ROOT_LANDING_REWRITE.source).toBe("/");
    expect(ROOT_LANDING_REWRITE.destination).toBe("/parents");
    expect(ROOT_LANDING_REWRITE).not.toHaveProperty("has");
    expect(ROOT_LANDING_REWRITE.missing).toContainEqual({ type: "cookie", key: "agathon_session" });
    for (const key of ["code", "token_hash", "error", "error_code", "error_description"]) {
      expect(ROOT_LANDING_REWRITE.missing).toContainEqual({ type: "query", key });
    }
  });
});

describe("signedOutDestination", () => {
  it("sends a signed-out visitor to the landing page at / when the reload is safe, else /parents", () => {
    expect(signedOutDestination("", "", yes)).toBe("/");
    expect(signedOutDestination(null, null, no)).toBe("/parents");
  });

  it("keeps the referral code, the campaign and the hash on the way", () => {
    expect(signedOutDestination("?ref=ABC234&utm_source=tiktok&utm_campaign=fall", "", yes)).toBe("/?ref=ABC234&utm_source=tiktok&utm_campaign=fall");
    expect(signedOutDestination("?ref=ABC234", "#pricing", no)).toBe("/parents?ref=ABC234#pricing");
  });

  it("sends a visitor back from an email link to sign in, as before, without touching the cookie", () => {
    let asked = 0;
    const count = () => {
      asked += 1;
      return true;
    };
    expect(signedOutDestination("?code=abc", "", count)).toBe(SIGN_IN_HREF);
    expect(signedOutDestination("", "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid", count)).toBe("/login");
    expect(signedOutDestination("?ref=ABC234", "#access_token=x&refresh_token=y&type=signup", count)).toBe("/login");
    expect(asked).toBe(0);
  });

  it("knows an email link in the query or the hash", () => {
    expect(hasAuthParams("?token_hash=x&type=signup", "")).toBe(true);
    expect(hasAuthParams("", "#access_token=x")).toBe(true);
    expect(hasAuthParams("?ref=ABC234", "#pricing")).toBe(false);
  });
});

describe("prepareRootReload", () => {
  it("clears the flag and marks the reload", () => {
    const jar = new CookieJar();
    jar.cookie = "agathon_session=1; Path=/";
    const tab = new TabStorage();
    expect(prepareRootReload(jar, "https:", tab)).toBe(true);
    expect(jar.cookie).toBe("");
    expect(tab.getItem(ROOT_RELOAD_KEY)).toBe("1");
  });

  it("says no when the flag cannot be cleared, the tab cannot remember, or a reload already came back to the app", () => {
    expect(prepareRootReload(new CookieJar("stuck"), "https:", new TabStorage())).toBe(false);
    expect(prepareRootReload(new CookieJar(), "https:", null)).toBe(false);
    const came = new TabStorage();
    came.setItem(ROOT_RELOAD_KEY, "1");
    expect(prepareRootReload(new CookieJar(), "https:", came)).toBe(false);
    // and forgets that, so a later visit tries / again
    expect(came.getItem(ROOT_RELOAD_KEY)).toBeNull();
  });
});

describe("the signed-out gate before paint", () => {
  /** Runs SIGNED_OUT_GATE_SCRIPT on a fresh boards home at `url`: where it went, and whether it hid the page. */
  function runGate(keys: string[], url: string, opts: { jar?: CookieJar; tab?: TabStorage | null } = {}) {
    const w = world({ local: keys, jar: opts.jar ?? new CookieJar(), tab: opts.tab === undefined ? new TabStorage() : opts.tab });
    const p = page(w, url);
    runScript(SIGNED_OUT_GATE_SCRIPT, p, w.now);
    const went = p.went();
    const here = p.location.pathname + p.location.search + p.location.hash;
    return { to: went.reload ? here : went.to, hidden: went.hidden, flagged: Boolean(p.window.__agathonLeaving), w };
  }

  const cases: [string[], string][] = [
    [[], "/?ref=ABC234&utm_source=x"],
    [[], "/"],
    [[], "/?ref=ABC234#pricing"],
    [["agathon.attribution", "sb-127-auth-token"], "/?ref=ABC234"],
    [["sb-abcdefgh-auth-token"], "/"],
    [[], "/?code=abc"],
    [[], "/#access_token=x&refresh_token=y&type=signup"],
    [[], "/#error=access_denied&error_code=otp_expired"],
    [["agathon.simpleBoard"], "/?ref=ABC234"],
  ];

  it("leaves for the landing page at / (a reload), query and hash kept, only with no stored session and no email link in the address", () => {
    expect(earlySignedOutDestination([], "?ref=ABC234&utm_source=x", "", yes)).toBe("/?ref=ABC234&utm_source=x");
    expect(earlySignedOutDestination([], "?ref=ABC234", "#pricing", yes)).toBe("/?ref=ABC234#pricing");
    expect(earlySignedOutDestination([], "?ref=ABC234", "#pricing", no)).toBe("/parents?ref=ABC234#pricing");
    expect(earlySignedOutDestination(["sb-127-auth-token"], "?ref=ABC234", "", yes)).toBeNull();
    expect(earlySignedOutDestination([], "?code=abc", "", yes)).toBeNull();
    expect(earlySignedOutDestination([], "", "#access_token=x", yes)).toBeNull();
    expect(hasStoredSession(["agathon.attribution", null])).toBe(false);
  });

  it("the inline script follows the same rules, and hides the page only when it leaves", () => {
    for (const [keys, url] of cases) {
      for (const mode of ["ok", "stuck", "blocked"] as const) {
        const u = new URL(url, "https://agathon.app");
        const want = earlySignedOutDestination(keys, u.search, u.hash, () => prepareRootReload(new CookieJar(mode), "https:", new TabStorage()));
        const got = runGate(keys, url, { jar: new CookieJar(mode) });
        expect({ url, mode, to: got.to, hidden: got.hidden, flagged: got.flagged }).toEqual({ url, mode, to: want, hidden: want !== null, flagged: want !== null });
      }
    }
  });

  it("clears the stale flag and reloads /, so the server serves the landing page there", () => {
    const jar = new CookieJar();
    jar.cookie = "agathon_session=1; Path=/";
    const got = runGate([], "/?ref=ABC234#pricing", { jar });
    expect(got.to).toBe("/?ref=ABC234#pricing");
    expect(jar.cookie).toBe("");
    expect(serveRoot(jar.header, "?ref=ABC234")).toBe("landing");
  });

  it("goes to /parents when it cannot clear the flag, the tab has no storage, or the last reload came back", () => {
    expect(runGate([], "/?ref=A", { jar: new CookieJar("stuck") }).to).toBe("/parents?ref=A");
    expect(runGate([], "/?ref=A", { tab: null }).to).toBe("/parents?ref=A");
    const came = new TabStorage();
    came.setItem(ROOT_RELOAD_KEY, "1");
    expect(runGate([], "/#x", { tab: came }).to).toBe("/parents#x");
  });

  it("does nothing when storage cannot be read: the page's own check decides after auth", () => {
    const w = world();
    const p = page(w, "/");
    Object.defineProperty(p.window, "localStorage", {
      get: () => {
        throw new Error("SecurityError");
      },
    });
    runScript(SIGNED_OUT_GATE_SCRIPT, p, w.now);
    expect(p.went()).toEqual({ reload: false, to: null, hidden: false });
  });
});

describe("SessionHop, the landing page's first script", () => {
  function runHop(keys: string[], url: string, opts: { jar?: CookieJar; tab?: TabStorage | null; lastHop?: number } = {}) {
    const w = world({ local: keys, jar: opts.jar ?? new CookieJar(), tab: opts.tab === undefined ? new TabStorage() : opts.tab });
    if (opts.lastHop) w.tab?.setItem(HOP_KEY, String(opts.lastHop));
    const p = page(w, url);
    runScript(SESSION_HOP_SCRIPT, p, w.now);
    return { ...p.went(), w };
  }

  it("hops once a device keeps a session (or an email link's tokens are in the hash), on / only", () => {
    const now = 1_800_000_000_000;
    expect(shouldHop("/", ["sb-127-auth-token"], "", 0, now)).toBe(true);
    expect(shouldHop("/", [], "#access_token=x&refresh_token=y", 0, now)).toBe(true);
    expect(shouldHop("/", [], "#error=access_denied", 0, now)).toBe(true);
    expect(shouldHop("/", ["agathon.attribution"], "#pricing", 0, now)).toBe(false);
    expect(shouldHop("/parents", ["sb-127-auth-token"], "", 0, now)).toBe(false);
    expect(shouldHop("/", ["sb-127-auth-token"], "", now - 1000, now)).toBe(false);
    expect(shouldHop("/", ["sb-127-auth-token"], "", now - HOP_PAUSE_MS - 1, now)).toBe(true);
  });

  it("the inline script follows the same rules: the cookie, then a reload with the page hidden", () => {
    const now = 1_800_000_000_000;
    const cases: [string[], string, number][] = [
      [["sb-127-auth-token"], "/", 0],
      [["sb-127-auth-token"], "/?ref=A#pricing", 0],
      [[], "/#access_token=x", 0],
      [[], "/?ref=A", 0],
      [["sb-127-auth-token"], "/parents", 0],
      [["sb-127-auth-token"], "/", now - 5000],
      [["sb-127-auth-token"], "/", now - HOP_PAUSE_MS - 5000],
      [["sb-127-auth-token"], "/", now + 5000],
    ];
    for (const [keys, url, lastHop] of cases) {
      const u = new URL(url, "https://agathon.app");
      const want = shouldHop(u.pathname, keys, u.hash, lastHop, now);
      const got = runHop(keys, url, { lastHop });
      expect({ url, lastHop, reload: got.reload, hidden: got.hidden, to: got.to }).toEqual({ url, lastHop, reload: want, hidden: want, to: null });
      expect(got.w.jar.cookie).toBe(want ? "agathon_session=1" : "");
      if (want) expect(got.w.tab?.getItem(HOP_KEY)).toBe(String(now));
    }
  });

  it("stays put when the cookie cannot be written or the tab cannot remember the hop", () => {
    expect(runHop(["sb-127-auth-token"], "/", { jar: new CookieJar("blocked") }).reload).toBe(false);
    expect(runHop(["sb-127-auth-token"], "/", { tab: null }).reload).toBe(false);
  });

  it("clears the root reload's mark wherever the landing page shows", () => {
    for (const url of ["/", "/parents", "/?ref=A"]) {
      const tab = new TabStorage();
      tab.setItem(ROOT_RELOAD_KEY, "1");
      runHop([], url, { tab });
      expect(tab.getItem(ROOT_RELOAD_KEY)).toBeNull();
    }
  });
});

describe("enterRoot, into / after signing in or out", () => {
  function run(path: string, times = 1) {
    const replaced: string[] = [];
    const routed: string[] = [];
    vi.stubGlobal("window", { location: { href: "https://www.agathon.app/login?next=x", replace: (to: string) => replaced.push(to) } });
    try {
      for (let i = 0; i < times; i++) enterRoot(path, (to) => routed.push(to));
    } finally {
      vi.unstubAllGlobals();
    }
    return { replaced, routed };
  }

  it("loads / in full, so the server (which sees the cookie now) picks the page, not the router's cache", () => {
    expect(run("/")).toEqual({ replaced: ["/"], routed: [] });
    expect(run("/?welcome=1")).toEqual({ replaced: ["/?welcome=1"], routed: [] });
  });

  it("loads it once, however many times it is asked (the sign-in handler and the signed-in effect both ask)", () => {
    expect(run("/", 3)).toEqual({ replaced: ["/"], routed: [] });
  });

  it("leaves every other page to the router", () => {
    expect(run("/board/abc")).toEqual({ replaced: [], routed: ["/board/abc"] });
    expect(run("/welcome/plan")).toEqual({ replaced: [], routed: ["/welcome/plan"] });
  });
});

describe("wantsSignUp", () => {
  it("is true only for the landing page's sign-up link", () => {
    expect(wantsSignUp(new URL(SIGN_UP_HREF, "https://agathon.app").search)).toBe(true);
    expect(wantsSignUp("?mode=signup&ref=ABC234")).toBe(true);
    expect(wantsSignUp("?mode=signin")).toBe(false);
    expect(wantsSignUp("?next=/board/abc")).toBe(false);
    expect(wantsSignUp("")).toBe(false);
    expect(wantsSignUp(undefined)).toBe(false);
  });
});

describe("siteOrigin", () => {
  it("uses the deployment's own origin when it is an http(s) URL", () => {
    expect(siteOrigin("https://agathon.app/")).toBe("https://agathon.app");
    expect(siteOrigin("http://localhost:3000/some/path")).toBe("http://localhost:3000");
  });

  it("falls back to production for anything else", () => {
    expect(siteOrigin(undefined)).toBe(PRODUCTION_ORIGIN);
    expect(siteOrigin("  ")).toBe(PRODUCTION_ORIGIN);
    expect(siteOrigin("agathon.app")).toBe(PRODUCTION_ORIGIN);
    expect(siteOrigin("javascript:alert(1)")).toBe(PRODUCTION_ORIGIN);
  });

  it("never puts .env.example's placeholder host in a link preview", () => {
    expect(siteOrigin("https://your-app.up.railway.app")).toBe(PRODUCTION_ORIGIN);
    expect(siteOrigin("https://agathon.app/parents")).toBe("https://agathon.app");
  });
});
