import { describeError, isClockSkewError, isNetworkError, messageOf } from "@/lib/errorMessage";

/**
 * Human copy for Supabase Auth failures on the login page.
 * Supabase AuthError exposes `code` (e.g. "invalid_credentials"); older
 * servers only send a message, so both are checked.
 */

export const LOGIN_COPY = {
  invalidCredentials:
    "That email and password don't match an account. Check both and try again.",
  emailNotConfirmed:
    "This email hasn't been confirmed yet. Open the confirmation link in your inbox, then sign in.",
  network: "Can't reach the sign-in service. Check your connection and try again.",
  rateLimited: "Too many attempts for now. Wait a minute, then try again.",
  alreadyRegistered:
    "An account with this email already exists. Switch to Sign In to continue.",
  weakPassword: "Use a password with at least 6 characters.",
  fallback: "Sign-in didn't complete. Try again in a moment.",
} as const;

export type LoginErrorKind =
  | "invalid-credentials"
  | "email-not-confirmed"
  | "network"
  | "rate-limited"
  | "already-registered"
  | "weak-password"
  | "clock-skew"
  | "other";

function codeOf(err: unknown): string {
  if (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return "";
}

function statusOf(err: unknown): number | null {
  if (err && typeof err === "object" && typeof (err as { status?: unknown }).status === "number") {
    return (err as { status: number }).status;
  }
  return null;
}

export function classifyLoginError(err: unknown): LoginErrorKind {
  if (isClockSkewError(err)) return "clock-skew";
  if (isNetworkError(err)) return "network";
  const code = codeOf(err);
  const msg = messageOf(err).toLowerCase();
  const status = statusOf(err);

  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) {
    return "invalid-credentials";
  }
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) {
    return "email-not-confirmed";
  }
  if (
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    status === 429 ||
    msg.includes("rate limit")
  ) {
    return "rate-limited";
  }
  if (code === "user_already_exists" || msg.includes("already registered")) {
    return "already-registered";
  }
  if (code === "weak_password" || msg.includes("password should be at least")) {
    return "weak-password";
  }
  return "other";
}

/** Calm, second-person sentence shown under the login form. */
export function loginErrorMessage(err: unknown): string {
  switch (classifyLoginError(err)) {
    case "invalid-credentials":
      return LOGIN_COPY.invalidCredentials;
    case "email-not-confirmed":
      return LOGIN_COPY.emailNotConfirmed;
    case "network":
      return LOGIN_COPY.network;
    case "rate-limited":
      return LOGIN_COPY.rateLimited;
    case "already-registered":
      return LOGIN_COPY.alreadyRegistered;
    case "weak-password":
      return LOGIN_COPY.weakPassword;
    case "clock-skew":
    case "other":
      return describeError(err, LOGIN_COPY.fallback);
  }
}
