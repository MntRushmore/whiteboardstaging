import { describe, expect, it } from "vitest";
import { WRITE_SESSION_COOKIE_ES5 } from "../links";
import { hasSessionCookie, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE, sessionCookieString, writeSessionCookie } from "../sessionCookie";
import { CookieJar } from "./fakeBrowser";

describe("the session cookie", () => {
  it("is a flag: 1 for 400 days, Lax, on every path, Secure off plain http", () => {
    expect(SESSION_COOKIE).toBe("agathon_session");
    expect(SESSION_COOKIE_MAX_AGE).toBe(400 * 24 * 60 * 60);
    expect(sessionCookieString(true, true)).toBe("agathon_session=1; Path=/; Max-Age=34560000; SameSite=Lax; Secure");
    expect(sessionCookieString(true, false)).toBe("agathon_session=1; Path=/; Max-Age=34560000; SameSite=Lax");
    expect(sessionCookieString(false, true)).toBe("agathon_session=; Path=/; Max-Age=0; SameSite=Lax; Secure");
  });

  it("is read the way the rewrite reads it: present only with a value", () => {
    expect(hasSessionCookie("agathon_session=1")).toBe(true);
    expect(hasSessionCookie("_ga=x; agathon_session=1; other=2")).toBe(true);
    expect(hasSessionCookie("agathon_session=")).toBe(false);
    expect(hasSessionCookie("agathon_session=; x=1")).toBe(false);
    expect(hasSessionCookie("not_agathon_session=1")).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
    expect(hasSessionCookie(undefined)).toBe(false);
  });

  it("says whether the write took", () => {
    const jar = new CookieJar();
    expect(writeSessionCookie(jar, true, "https:")).toBe(true);
    expect(jar.cookie).toBe("agathon_session=1");
    expect(jar.lastWrite).toContain("; Secure");
    expect(writeSessionCookie(jar, false, "https:")).toBe(true);
    expect(jar.cookie).toBe("");

    expect(writeSessionCookie(new CookieJar("blocked"), true, "https:")).toBe(false);
    // a copy on another Domain: the page cannot clear it
    expect(writeSessionCookie(new CookieJar("stuck"), false, "https:")).toBe(false);
    // a sandboxed frame's document.cookie throws
    const throwing = {
      get cookie(): string {
        throw new Error("SecurityError");
      },
      set cookie(_: string) {
        throw new Error("SecurityError");
      },
    };
    expect(writeSessionCookie(throwing, true, "https:")).toBe(false);
  });

  it("the inline scripts' writer does exactly the same", () => {
    for (const mode of ["ok", "blocked", "stuck"] as const) {
      for (const protocol of ["https:", "http:"]) {
        for (const on of [true, false]) {
          const ts = new CookieJar(mode);
          const es5 = new CookieJar(mode);
          const want = writeSessionCookie(ts, on, protocol);
          const write = new Function("document", "location", `return (${WRITE_SESSION_COOKIE_ES5})`)(es5, { protocol }) as (on: boolean) => boolean;
          expect(write(on)).toBe(want);
          expect(es5.lastWrite).toBe(ts.lastWrite);
          expect(es5.cookie).toBe(ts.cookie);
        }
      }
    }
  });
});
