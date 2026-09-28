import { describe, expect, it } from "vitest";
import { CLOCK_SKEW_MESSAGE } from "../errorMessage";
import { LOGIN_COPY, classifyLoginError, loginErrorField, loginErrorMessage } from "../loginErrorMessage";

// Shape of @supabase/auth-js AuthApiError without importing the class.
function authError(message: string, status: number, code?: string) {
  return { name: "AuthApiError", message, status, code };
}

describe("loginErrorMessage", () => {
  it("maps invalid credentials by code and by legacy message", () => {
    expect(loginErrorMessage(authError("Invalid login credentials", 400, "invalid_credentials"))).toBe(
      LOGIN_COPY.invalidCredentials,
    );
    expect(classifyLoginError(authError("Invalid login credentials", 400))).toBe("invalid-credentials");
  });

  it("maps unconfirmed email", () => {
    expect(loginErrorMessage(authError("Email not confirmed", 400, "email_not_confirmed"))).toBe(
      LOGIN_COPY.emailNotConfirmed,
    );
  });

  it("maps network failures (fetch TypeError and AuthRetryableFetchError)", () => {
    expect(loginErrorMessage(new TypeError("Failed to fetch"))).toBe(LOGIN_COPY.network);
    expect(
      loginErrorMessage({ name: "AuthRetryableFetchError", message: "fetch failed", status: 0 }),
    ).toBe(LOGIN_COPY.network);
  });

  it("maps rate limiting, duplicate accounts and weak passwords", () => {
    expect(loginErrorMessage(authError("Request rate limit reached", 429))).toBe(LOGIN_COPY.rateLimited);
    expect(loginErrorMessage(authError("User already registered", 422, "user_already_exists"))).toBe(
      LOGIN_COPY.alreadyRegistered,
    );
    expect(loginErrorMessage(authError("Password should be at least 6 characters", 422, "weak_password"))).toBe(
      LOGIN_COPY.weakPassword,
    );
  });

  it("reads the server's own password minimum instead of assuming 6", () => {
    expect(loginErrorMessage(authError("Password should be at least 8 characters.", 422, "weak_password"))).toBe(
      "Use a password with at least 8 characters.",
    );
  });

  it("explains breached and too-simple passwords from AuthWeakPasswordError.reasons", () => {
    const pwned = { ...authError("Password is known to be weak and easy to guess, please choose a different one.", 422, "weak_password"), reasons: ["pwned"] };
    expect(classifyLoginError(pwned)).toBe("breached-password");
    expect(loginErrorMessage(pwned)).toBe(LOGIN_COPY.breachedPassword);

    const simple = {
      ...authError("Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, 0123456789", 422, "weak_password"),
      reasons: ["characters"],
    };
    expect(loginErrorMessage(simple)).toBe(LOGIN_COPY.complexPassword);
  });

  it("maps reset and sign-up refusals to their own sentences", () => {
    expect(loginErrorMessage(authError("New password should be different from the old password.", 422, "same_password"))).toBe(
      LOGIN_COPY.samePassword,
    );
    expect(loginErrorMessage(authError("Unable to validate email address: invalid format", 400, "email_address_invalid"))).toBe(
      LOGIN_COPY.invalidEmail,
    );
    expect(loginErrorMessage(authError("Signups not allowed for this instance", 422, "signup_disabled"))).toBe(
      LOGIN_COPY.signupDisabled,
    );
    expect(
      loginErrorMessage(
        authError('Email address "kid@school.org" cannot be used as it is not authorized', 400, "email_address_not_authorized"),
      ),
    ).toBe(LOGIN_COPY.emailNotAuthorized);
    expect(loginErrorMessage(authError("Email rate limit exceeded", 429, "over_email_send_rate_limit"))).toBe(
      LOGIN_COPY.rateLimited,
    );
  });

  it("names clock skew and falls back to the server message or a calm default", () => {
    expect(loginErrorMessage(authError("JWT issued at future", 401))).toBe(CLOCK_SKEW_MESSAGE);
    expect(loginErrorMessage(new Error("Something specific"))).toBe("Something specific");
    expect(loginErrorMessage(undefined)).toBe(LOGIN_COPY.fallback);
  });

  it("puts each error under the field it is about", () => {
    // Wrong credentials stay form-level so the message never says which half was wrong.
    expect(loginErrorField(authError("Invalid login credentials", 400, "invalid_credentials"))).toBe("form");
    expect(loginErrorField(authError("User already registered", 422, "user_already_exists"))).toBe("email");
    expect(loginErrorField(authError("Password should be at least 8 characters.", 422, "weak_password"))).toBe("password");
    expect(loginErrorField(authError("New password should be different from the old password.", 422, "same_password"))).toBe(
      "password",
    );
    expect(loginErrorField(new TypeError("Failed to fetch"))).toBe("form");
  });

  it("uses calm copy", () => {
    for (const text of Object.values(LOGIN_COPY)) {
      expect(text).not.toMatch(/!/);
      expect(text.toLowerCase()).not.toMatch(/\bwrong\b/);
    }
  });
});
