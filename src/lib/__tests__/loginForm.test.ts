import { describe, expect, it } from "vitest";
import {
  FORM_COPY,
  NEW_PASSWORD_MIN_LENGTH,
  afterSignInPath,
  hasFieldErrors,
  hashHasAuthError,
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
    expect(validateLoginForm("signup", "new@example.com", "short").password).toMatch(/at least 8/);
    expect(validateLoginForm("signup", "new@example.com", "password123")).toEqual({});
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
});
