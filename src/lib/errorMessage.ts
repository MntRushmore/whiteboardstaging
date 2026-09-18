/**
 * Pure helpers that turn a thrown value (Error, Supabase PostgrestError /
 * AuthError, fetch TypeError, plain string) into a calm, human sentence.
 * No React, no network — unit-tested in src/lib/__tests__/errorMessage.test.ts.
 */

export const NETWORK_MESSAGE =
  "Can't reach the server. Check your connection and try again.";

/**
 * Supabase rejects a JWT whose `iat` is ahead of the server clock with
 * "JWT issued at future". It is a local clock-skew condition, not an account
 * problem, so we name the fix instead of echoing the raw token error.
 */
export const CLOCK_SKEW_MESSAGE =
  "Your device clock looks a little off, so the sign-in token was refused. Check the date and time on this device, then retry.";

type ErrorLike = {
  message?: unknown;
  name?: unknown;
  status?: unknown;
  code?: unknown;
};

function asErrorLike(err: unknown): ErrorLike {
  if (err && typeof err === "object") return err as ErrorLike;
  return {};
}

/** The raw message carried by any error-ish value, or "" when there is none. */
export function messageOf(err: unknown): string {
  if (typeof err === "string") return err;
  const { message } = asErrorLike(err);
  return typeof message === "string" ? message : "";
}

/** True for the "JWT issued at future" family of clock-skew rejections. */
export function isClockSkewError(err: unknown): boolean {
  const msg = messageOf(err).toLowerCase();
  if (!msg) return false;
  return (
    (msg.includes("issued at") && msg.includes("future")) ||
    msg.includes("issued in the future") ||
    (msg.includes("jwt") && msg.includes("future")) ||
    (msg.includes("token") && msg.includes("clock"))
  );
}

/** True when the request never reached a server (offline, DNS, CORS, abort). */
export function isNetworkError(err: unknown): boolean {
  const e = asErrorLike(err);
  const name = typeof e.name === "string" ? e.name : "";
  if (name === "AuthRetryableFetchError") return true;
  if (e.status === 0) return true;
  const msg = messageOf(err).toLowerCase();
  if (err instanceof TypeError && /fetch|network|load failed/.test(msg)) return true;
  return (
    msg === "failed to fetch" ||
    msg === "fetch failed" ||
    msg === "load failed" ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("network error")
  );
}

/**
 * Human sentence for an error. Order matters: clock skew and network are
 * recognised first, then the error's own message, then the caller's fallback.
 */
export function describeError(err: unknown, fallback: string): string {
  if (isClockSkewError(err)) return CLOCK_SKEW_MESSAGE;
  if (isNetworkError(err)) return NETWORK_MESSAGE;
  const msg = messageOf(err).trim();
  return msg || fallback;
}
