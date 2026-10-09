import { describe, expect, it } from "vitest";
import {
  earlySignedOutDestination,
  hasStoredSession,
  LANDING_PATH,
  PRODUCTION_ORIGIN,
  SIGN_IN_HREF,
  SIGN_UP_HREF,
  SIGNED_OUT_GATE_SCRIPT,
  signedOutDestination,
  siteOrigin,
  wantsSignUp,
} from "../links";

describe("signedOutDestination", () => {
  it("sends a signed-out visitor to the landing page", () => {
    expect(signedOutDestination("", "")).toBe(LANDING_PATH);
    expect(signedOutDestination(null, null)).toBe("/parents");
  });

  it("keeps the referral code and the campaign on the way", () => {
    expect(signedOutDestination("?ref=ABC234&utm_source=tiktok&utm_campaign=fall", "")).toBe(
      "/parents?ref=ABC234&utm_source=tiktok&utm_campaign=fall",
    );
  });

  it("sends a visitor back from an email link to sign in, as before", () => {
    expect(signedOutDestination("?code=abc", "")).toBe(SIGN_IN_HREF);
    expect(signedOutDestination("", "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid")).toBe("/login");
    expect(signedOutDestination("?ref=ABC234", "#access_token=x&refresh_token=y&type=signup")).toBe("/login");
  });

  it("ignores a hash that is not an email link", () => {
    expect(signedOutDestination("?ref=ABC234", "#pricing")).toBe("/parents?ref=ABC234");
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

describe("the signed-out gate before paint", () => {
  /** Runs SIGNED_OUT_GATE_SCRIPT against a fake page: where it went, and whether it hid the page. */
  function runGate(keys: string[], search: string, hash: string) {
    const replaced: string[] = [];
    const style: { visibility?: string } = {};
    const window = { localStorage: { length: keys.length, key: (i: number) => keys[i] ?? null } };
    const location = { search, hash, replace: (to: string) => replaced.push(to) };
    const document = { documentElement: { style } };
    new Function("window", "location", "document", "URLSearchParams", SIGNED_OUT_GATE_SCRIPT)(window, location, document, URLSearchParams);
    return { to: replaced[0] ?? null, hidden: style.visibility === "hidden" };
  }

  const cases: [string[], string, string][] = [
    [[], "?ref=ABC234&utm_source=x", ""],
    [[], "", ""],
    [[], "?ref=ABC234", "#pricing"],
    [["agathon.attribution", "sb-127-auth-token"], "?ref=ABC234", ""],
    [["sb-abcdefgh-auth-token"], "", ""],
    [[], "?code=abc", ""],
    [[], "", "#access_token=x&refresh_token=y&type=signup"],
    [[], "", "#error=access_denied&error_code=otp_expired"],
    [["agathon.simpleBoard"], "?ref=ABC234", ""],
  ];

  it("leaves for the landing page, query and hash kept, only with no stored session and no email link in the address", () => {
    expect(earlySignedOutDestination([], "?ref=ABC234&utm_source=x", "")).toBe("/parents?ref=ABC234&utm_source=x");
    expect(earlySignedOutDestination([], "?ref=ABC234", "#pricing")).toBe("/parents?ref=ABC234#pricing");
    expect(earlySignedOutDestination(["sb-127-auth-token"], "?ref=ABC234", "")).toBeNull();
    expect(earlySignedOutDestination([], "?code=abc", "")).toBeNull();
    expect(earlySignedOutDestination([], "", "#access_token=x")).toBeNull();
    expect(hasStoredSession(["agathon.attribution", null])).toBe(false);
  });

  it("the inline script follows the same rules, and hides the page only when it leaves", () => {
    for (const [keys, search, hash] of cases) {
      const want = earlySignedOutDestination(keys, search, hash);
      expect(runGate(keys, search, hash)).toEqual({ to: want, hidden: want !== null });
    }
  });
});
