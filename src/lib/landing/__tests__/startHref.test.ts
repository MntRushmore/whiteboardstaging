/**
 * Join Agathon goes to /start (docs/START-FLOW.md, 2026-10-13), carrying the page's `?ref` and
 * `utm_*`; /login?mode=signup keeps opening the Sign up tab for the links already out there.
 */
import { describe, expect, it } from "vitest";
import { START_PATH } from "@/lib/start/contracts";
import { isKeptJoinParam, SIGN_IN_HREF, SIGN_UP_HREF, START_HREF, startHref, wantsSignUp } from "../links";

describe("START_HREF", () => {
  it("is the onboarding's own path", () => {
    expect(START_HREF).toBe("/start");
    expect(START_HREF).toBe(START_PATH);
  });

  it("leaves Sign in and the old sign-up link as they were", () => {
    expect(SIGN_IN_HREF).toBe("/login");
    expect(SIGN_UP_HREF).toBe("/login?mode=signup");
    expect(wantsSignUp(new URL(SIGN_UP_HREF, "https://www.agathon.app").search)).toBe(true);
  });
});

describe("startHref", () => {
  it("plain /start when the page has nothing to carry", () => {
    expect(startHref("")).toBe("/start");
    expect(startHref(undefined)).toBe("/start");
    expect(startHref(null)).toBe("/start");
    expect(startHref("?")).toBe("/start");
    expect(startHref("?ref=")).toBe("/start");
  });

  it("carries a friend's ?ref and the campaign's utm_*, in order, and nothing else", () => {
    expect(startHref("?ref=ABC234")).toBe("/start?ref=ABC234");
    expect(startHref("?utm_source=tiktok&utm_medium=video&utm_campaign=fall&utm_content=a1&utm_term=math")).toBe(
      "/start?utm_source=tiktok&utm_medium=video&utm_campaign=fall&utm_content=a1&utm_term=math",
    );
    expect(startHref("?mode=signup&ref=ABC234&next=/board/x&code=secret&utm_source=x&email=a%40b.co")).toBe("/start?ref=ABC234&utm_source=x");
  });

  it("keeps the first of a repeated name, and caps a long value", () => {
    expect(startHref("?ref=ONE&ref=TWO")).toBe("/start?ref=ONE");
    const long = startHref(`?utm_campaign=${"x".repeat(500)}`);
    expect(new URL(long, "https://www.agathon.app").searchParams.get("utm_campaign")).toHaveLength(200);
  });

  it("encodes what it carries", () => {
    const href = startHref("?utm_campaign=back%20to%20school&ref=A%26B");
    const url = new URL(href, "https://www.agathon.app");
    expect(url.pathname).toBe("/start");
    expect(url.searchParams.get("utm_campaign")).toBe("back to school");
    expect(url.searchParams.get("ref")).toBe("A&B");
  });

  it("knows which parameters are carried", () => {
    for (const key of ["ref", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) expect(isKeptJoinParam(key), key).toBe(true);
    for (const key of ["mode", "next", "code", "access_token", "a", "utm", "utm_", "reference", "email"]) expect(isKeptJoinParam(key), key).toBe(false);
  });
});
