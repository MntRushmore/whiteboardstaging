import { describe, expect, it } from "vitest";
import { CLOCK_SKEW_MESSAGE } from "../errorMessage";
import { LOGIN_COPY, classifyLoginError, loginErrorMessage } from "../loginErrorMessage";

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

  it("names clock skew and falls back to the server message or a calm default", () => {
    expect(loginErrorMessage(authError("JWT issued at future", 401))).toBe(CLOCK_SKEW_MESSAGE);
    expect(loginErrorMessage(new Error("Something specific"))).toBe("Something specific");
    expect(loginErrorMessage(undefined)).toBe(LOGIN_COPY.fallback);
  });

  it("uses calm copy", () => {
    for (const text of Object.values(LOGIN_COPY)) {
      expect(text).not.toMatch(/!/);
      expect(text.toLowerCase()).not.toMatch(/\bwrong\b/);
    }
  });
});
