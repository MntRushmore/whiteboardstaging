import { describe, expect, it } from "vitest";
import { TERMS_VERSION } from "@/lib/legal";
import {
  FORM_COPY,
  NEW_PASSWORD_MIN_LENGTH,
  afterSignInPath,
  hasFieldErrors,
  hashHasAuthError,
  signInPath,
  signUpRequest,
  validateEmail,
  validateLoginForm,
  validateNewPassword,
} from "../loginForm";

describe("validateEmail", () => {
  it("asks for an email when the field is empty or blank", () => {
    expect(validateEmail("")).toBe(FORM_COPY.emailRequired);
    expect(validateEmail("   ")).toBe(FORM_COPY.emailRequired);
  });

  it("asks for a full address when the shape is off", () => {
    expect(validateEmail("student")).toBe(FORM_COPY.emailInvalid);
    expect(validateEmail("student@school")).toBe(FORM_COPY.emailInvalid);
    expect(validateEmail("a b@school.org")).toBe(FORM_COPY.emailInvalid);
  });

  it("accepts an address with surrounding spaces (the form trims before sending)", () => {
    expect(validateEmail(" qa-student@example.com ")).toBeUndefined();
  });
});

describe("validateNewPassword", () => {
  it("names the minimum when the password is short", () => {
    expect(validateNewPassword("")).toBe(FORM_COPY.passwordRequired);
    expect(validateNewPassword("x".repeat(NEW_PASSWORD_MIN_LENGTH - 1))).toBe(
      `Use a password with at least ${NEW_PASSWORD_MIN_LENGTH} characters.`,
    );
    expect(validateNewPassword("x".repeat(NEW_PASSWORD_MIN_LENGTH))).toBeUndefined();
  });

  it("states the same minimum in the hint", () => {
    expect(FORM_COPY.newPasswordHint).toContain(String(NEW_PASSWORD_MIN_LENGTH));
  });
});

describe("validateLoginForm", () => {
  it("sign-in needs both fields but leaves length to the server", () => {
    expect(validateLoginForm("signin", "", "")).toEqual({
      email: FORM_COPY.emailRequired,
      password: FORM_COPY.passwordRequired,
    });
    expect(validateLoginForm("signin", "qa-student@example.com", "abc")).toEqual({});
  });

  it("sign-up holds a new password to the minimum", () => {
    expect(validateLoginForm("signup", "new@example.com", "short", true).password).toMatch(/at least 8/);
    expect(validateLoginForm("signup", "new@example.com", "password123", true)).toEqual({});
  });

  it("sign-up needs the consent box ticked; sign-in and reset never ask", () => {
    expect(validateLoginForm("signup", "new@example.com", "password123", false)).toEqual({
      consent: FORM_COPY.consentRequired,
    });
    expect(validateLoginForm("signup", "new@example.com", "password123")).toEqual({
      consent: FORM_COPY.consentRequired,
    });
    expect(hasFieldErrors({ consent: FORM_COPY.consentRequired })).toBe(true);
    expect(validateLoginForm("signin", "qa-student@example.com", "abc", false)).toEqual({});
    expect(validateLoginForm("forgot", "qa-student@example.com", "", false)).toEqual({});
  });

  it("forgot-password only looks at the email", () => {
    expect(validateLoginForm("forgot", "qa-student@example.com", "")).toEqual({});
    expect(validateLoginForm("forgot", "nope", "")).toEqual({ email: FORM_COPY.emailInvalid });
  });

  it("hasFieldErrors is true only when a field has a message", () => {
    expect(hasFieldErrors({})).toBe(false);
    expect(hasFieldErrors({ password: FORM_COPY.passwordRequired })).toBe(true);
  });
});

describe("signUpRequest", () => {
  it("sends the Terms version in the new account's metadata, which the database requires", () => {
    expect(signUpRequest("new@example.com", "password123")).toEqual({
      email: "new@example.com",
      password: "password123",
      options: { data: { terms_version: TERMS_VERSION } },
    });
    // the database's format (profiles_terms_version_format, signup_terms_version())
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // ... and in its range: a real date from 2026-01-01, never in the future
    expect(Number.isNaN(Date.parse(`${TERMS_VERSION}T00:00:00Z`))).toBe(false);
    expect(TERMS_VERSION >= "2026-01-01").toBe(true);
    expect(Date.parse(`${TERMS_VERSION}T00:00:00Z`)).toBeLessThanOrEqual(Date.now() + 86_400_000);
  });
});

describe("hashHasAuthError", () => {
  it("spots the error Supabase appends to a spent or expired link", () => {
    expect(
      hashHasAuthError(
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      ),
    ).toBe(true);
  });

  it("is false for a recovery session hash or no hash", () => {
    expect(hashHasAuthError("#access_token=abc&refresh_token=def&type=recovery")).toBe(false);
    expect(hashHasAuthError("")).toBe(false);
  });
});

describe("afterSignInPath", () => {
  it("returns to the board a signed-out visit came from", () => {
    expect(afterSignInPath("?next=%2Fboard%2F2996105e-695e-494b-86ea-3f7eb4dbacc9")).toBe("/board/2996105e-695e-494b-86ea-3f7eb4dbacc9");
    expect(afterSignInPath("?next=/board/abc")).toBe("/board/abc");
  });

  it("goes home without a next, or with anything that is not a board on this site", () => {
    expect(afterSignInPath("")).toBe("/");
    expect(afterSignInPath("?next=")).toBe("/");
    expect(afterSignInPath("?next=https://evil.example/board/x")).toBe("/");
    expect(afterSignInPath("?next=//evil.example/board/x")).toBe("/");
    expect(afterSignInPath("?next=/board/x/../../account")).toBe("/");
    expect(afterSignInPath("?next=/account")).toBe("/");
  });

  it("returns to the weekly report on its week, and to a replay from it (the Sunday email's links)", () => {
    expect(afterSignInPath("?next=%2Freport%3Fweek%3D2026-10-05")).toBe("/report?week=2026-10-05");
    expect(afterSignInPath("?next=%2Freport")).toBe("/report");
    expect(afterSignInPath("?next=%2Freport%2Freplay%2F2996105e-695e-494b-86ea-3f7eb4dbacc9")).toBe("/report/replay/2996105e-695e-494b-86ea-3f7eb4dbacc9");
  });

  it("never follows a report path with anything else in it", () => {
    for (const next of [
      "//evil.example/report",
      "/report?week=x",
      "/report?week=2026-10-05&next=//evil.example",
      "/report?week=2026-10-05#x",
      "/report/../account",
      "/report/replay/x/../../account",
      "/reports",
      "/report/replay/",
      "https://evil.example/report?week=2026-10-05",
      "/\\evil.example/report",
    ]) {
      expect(afterSignInPath(`?next=${encodeURIComponent(next)}`), next).toBe("/");
    }
  });
});

describe("signInPath", () => {
  it("carries a page sign-in returns to, and round-trips through afterSignInPath", () => {
    for (const path of ["/report", "/report?week=2026-10-05", "/report/replay/2996105e-695e-494b-86ea-3f7eb4dbacc9", "/board/abc"]) {
      const login = signInPath(path);
      expect(login.startsWith("/login?next=")).toBe(true);
      expect(afterSignInPath(new URL(login, "https://agathon.app").search)).toBe(path);
    }
  });

  it("is plain /login for anything sign-in would not return to", () => {
    expect(signInPath("/report?week=soon")).toBe("/login");
    expect(signInPath("//evil.example")).toBe("/login");
    expect(signInPath("/account")).toBe("/login");
  });
});
