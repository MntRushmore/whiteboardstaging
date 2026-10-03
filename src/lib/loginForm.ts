import { passwordTooShortMessage } from "@/lib/loginErrorMessage";

/**
 * Checks the login and reset-password forms run before calling Supabase, so an
 * empty or malformed field gets a sentence under that field instead of a round
 * trip or the browser's own bubble. Pure; tested in
 * src/lib/__tests__/loginForm.test.ts.
 */

export type LoginMode = "signin" | "signup" | "forgot";

/**
 * Minimum for a new password (sign-up and reset). Matches the cloud project
 * (docs/RUNBOOK-supabase.md section 3); the local stack accepts 6, so 8 passes
 * both. Sign-in never checks length: the server decides whether it matches.
 */
export const NEW_PASSWORD_MIN_LENGTH = 8;

export const FORM_COPY = {
  emailRequired: "Enter your email address.",
  emailInvalid: "Enter a full email address, like you@example.com.",
  passwordRequired: "Enter your password.",
  newPasswordHint: `Use ${NEW_PASSWORD_MIN_LENGTH} or more characters.`,
} as const;

export type FieldErrors = { email?: string; password?: string };

/**
 * Every form that takes a password posts. A form without `method` is a GET: submitted before
 * React attached onSubmit (a slow load, a quick Enter on an iPad), the browser put
 * `?email=…&password=…` in the URL, and so in history and the server and Vercel logs. `#` posts
 * to the page itself, which reads no body.
 */
export const AUTH_FORM_METHOD = { method: "post", action: "#" } as const;

// Deliberately loose: something@something.tld. Supabase does the real check.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | undefined {
  const value = email.trim();
  if (!value) return FORM_COPY.emailRequired;
  if (!EMAIL_SHAPE.test(value)) return FORM_COPY.emailInvalid;
  return undefined;
}

export function validateNewPassword(password: string): string | undefined {
  if (!password) return FORM_COPY.passwordRequired;
  if (password.length < NEW_PASSWORD_MIN_LENGTH) {
    return passwordTooShortMessage(NEW_PASSWORD_MIN_LENGTH);
  }
  return undefined;
}

/** Per-field errors for the login card; an empty object means "submit". */
export function validateLoginForm(mode: LoginMode, email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  const emailError = validateEmail(email);
  if (emailError) errors.email = emailError;
  if (mode === "signin" && !password) errors.password = FORM_COPY.passwordRequired;
  if (mode === "signup") {
    const passwordError = validateNewPassword(password);
    if (passwordError) errors.password = passwordError;
  }
  return errors;
}

export function hasFieldErrors(errors: FieldErrors): boolean {
  return Boolean(errors.email || errors.password);
}

/**
 * Where to go once signed in: the board a signed-out visit (or an expired session) was sent to
 * /login from (`?next=/board/<id>`), else the boards home. Only a board path on this site is
 * honoured, never an absolute URL or `//host`, so the parameter cannot redirect anywhere else.
 */
export function afterSignInPath(search: string): string {
  const next = new URLSearchParams(search).get("next");
  return next && /^\/board\/[\w-]+$/.test(next) ? next : "/";
}

export const RESET_LINK_COPY = {
  expiredTitle: "This link no longer works",
  expired:
    "Reset links work once and expire after a while. Go back to sign in and choose “Forgot your password?” to get a new one.",
  missingTitle: "Open your reset link",
  missing:
    "Use the link in your password reset email to choose a new password. To get one, go back to sign in and choose “Forgot your password?”",
} as const;

/**
 * A spent or expired email link lands on the page with
 * `#error=access_denied&error_code=otp_expired&error_description=...`
 * instead of a session. True when the URL hash carries such an error.
 */
export function hashHasAuthError(hash: string): boolean {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return Boolean(params.get("error") || params.get("error_code") || params.get("error_description"));
}
