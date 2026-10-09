import { describe, expect, it } from "vitest";
import { LANDING_PATH, PRODUCTION_ORIGIN, SIGN_IN_HREF, SIGN_UP_HREF, signedOutDestination, siteOrigin, wantsSignUp } from "../links";

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
});
