import { describeError, isClockSkewError, isNetworkError, messageOf } from "@/lib/errorMessage";

/**
 * Human copy for Supabase Auth failures on the login and reset-password pages.
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
  alreadyRegistered: "An account with this email already exists. Sign in instead.",
  weakPassword: "Use a password with at least 6 characters.",
  breachedPassword:
    "That password has appeared in a known data breach. Choose a different one.",
  complexPassword: "Choose a stronger password with a mix of letters, numbers and symbols.",
  samePassword: "Your new password must be different from your current one.",
  invalidEmail: "That doesn't look like an email address. Check it and try again.",
  signupDisabled:
    "New accounts can't be created right now. Ask your teacher or school for access.",
  emailNotAuthorized:
    "Emails can't be sent to this address yet. Ask your teacher or school to reset your password.",
  fallback: "Sign-in didn't complete. Try again in a moment.",
  // The database refuses an account whose sign-up did not carry the Terms acceptance
  // (20261003010000_signup_consent.sql): in practice, a page loaded before that release.
  signupRefused: "We couldn't create your account. Reload this page and try again.",
} as const;

export type LoginErrorKind =
  | "invalid-credentials"
  | "email-not-confirmed"
  | "network"
  | "rate-limited"
  | "already-registered"
  | "weak-password"
  | "breached-password"
  | "same-password"
  | "invalid-email"
  | "signup-disabled"
  | "email-not-authorized"
  | "signup-refused"
  | "clock-skew"
  | "other";

/** Which input an error belongs under; "form" when it is about the attempt as a whole. */
export type LoginErrorField = "email" | "password" | "form";

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

/** AuthWeakPasswordError carries `reasons` ("length" | "characters" | "pwned"). */
function weakReasonsOf(err: unknown): string[] {
  if (err && typeof err === "object") {
    const reasons = (err as { reasons?: unknown }).reasons;
    if (Array.isArray(reasons)) return reasons.filter((r): r is string => typeof r === "string");
  }
  return [];
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
  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    msg.includes("already registered")
  ) {
    return "already-registered";
  }
  if (code === "same_password" || msg.includes("should be different from the old password")) {
    return "same-password";
  }
  if (msg.includes("known to be weak") || (code === "weak_password" && weakReasonsOf(err).includes("pwned"))) {
    return "breached-password";
  }
  if (code === "weak_password" || msg.includes("password should")) {
    return "weak-password";
  }
  if (code === "email_address_invalid" || msg.includes("invalid format")) {
    return "invalid-email";
  }
  if (
    code === "signup_disabled" ||
    code === "email_provider_disabled" ||
    msg.includes("signups not allowed")
  ) {
    return "signup-disabled";
  }
  if (code === "email_address_not_authorized" || msg.includes("cannot be used as it is not authorized")) {
    return "email-not-authorized";
  }
  // A database trigger refused the new auth.users row (the sign-up consent): GoTrue passes the
  // trigger's message through ("sign-up refused: ...", seen locally) or, in some versions, says
  // "Database error saving new user".
  if (msg.includes("sign-up refused") || msg.includes("database error saving new user")) {
    return "signup-refused";
  }
  return "other";
}

/**
 * The server states its own minimum ("Password should be at least 8
 * characters."), and the cloud and local projects differ (8 vs 6), so the
 * number is read from the message rather than assumed.
 */
function weakPasswordMessage(err: unknown): string {
  const length = /at least (\d+) characters/i.exec(messageOf(err));
  if (length) return passwordTooShortMessage(Number(length[1]));
  const reasons = weakReasonsOf(err);
  if (reasons.includes("characters") || /at least one character/i.test(messageOf(err))) {
    return LOGIN_COPY.complexPassword;
  }
  return LOGIN_COPY.weakPassword;
}

export function passwordTooShortMessage(min: number): string {
  return `Use a password with at least ${min} characters.`;
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
      return weakPasswordMessage(err);
    case "breached-password":
      return LOGIN_COPY.breachedPassword;
    case "same-password":
      return LOGIN_COPY.samePassword;
    case "invalid-email":
      return LOGIN_COPY.invalidEmail;
    case "signup-disabled":
      return LOGIN_COPY.signupDisabled;
    case "email-not-authorized":
      return LOGIN_COPY.emailNotAuthorized;
    case "signup-refused":
      return LOGIN_COPY.signupRefused;
    case "clock-skew":
    case "other":
      return describeError(err, LOGIN_COPY.fallback);
  }
}

/**
 * The input an error is shown under. Wrong credentials stay on the form as a
 * whole so the message does not reveal which half was wrong.
 */
export function loginErrorField(err: unknown): LoginErrorField {
  switch (classifyLoginError(err)) {
    case "email-not-confirmed":
    case "already-registered":
    case "invalid-email":
    case "email-not-authorized":
      return "email";
    case "weak-password":
    case "breached-password":
    case "same-password":
      return "password";
    default:
      return "form";
  }
}
