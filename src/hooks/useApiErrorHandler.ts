"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { isApiError } from "@/lib/api-client";

export const CREDITS_EXHAUSTED_MESSAGE =
  "Account credits are used up — ask Rushil to refill your account.";
export const SIGN_IN_AGAIN_MESSAGE = "Please sign in again";
export const RATE_LIMITED_MESSAGE =
  "Slow down a little — try again in a few seconds";
/** The device reports no network (navigator.onLine === false). */
export const OFFLINE_MESSAGE = "You're offline";
/** fetch() rejected before a response arrived (DNS, connection reset, blocked). */
export const NETWORK_MESSAGE =
  "Couldn't reach the tutor. Check your connection and try again.";
/** 5xx without a usable human message from the server. */
export const SERVER_MESSAGE =
  "The tutor is unavailable right now. Try again in a moment.";

/** True when the error is a fetch abort (user edited the canvas mid-request). */
export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

export type ApiErrorKind =
  | "abort"
  | "unauthorized"
  | "credits"
  | "rate-limited"
  | "offline"
  | "network"
  | "server"
  | "request"
  | "other";

export interface ApiErrorDescription {
  /** Human message, ready to show. Empty for an abort. */
  message: string;
  /** Whether re-running the same call has a reasonable chance of succeeding. */
  retryable: boolean;
  /** Present on 429: how long the server asked us to wait. */
  retryAfterMs?: number;
  /** Present on 401: the session is gone, the caller should send the user to /login. */
  signIn?: boolean;
  /** True for a fetch abort (the user edited mid-request) — not an error to show. */
  aborted: boolean;
  kind: ApiErrorKind;
}

export interface DescribeApiErrorOptions {
  /** Message used when the error carries no usable text. */
  fallback?: string;
  /** Overrides `navigator.onLine` (tests, or callers that track it themselves). */
  online?: boolean;
}

const NETWORK_FAILURE =
  /failed to fetch|network ?error|network request failed|load failed|fetch failed|econnrefused|enotfound|socket hang up/i;
const RETRY_HINT = /in (\d+) second/i;

/** The server's own message when it is one (not the machine code or the apiJson fallback). */
function humanMessage(err: { message?: string; code?: string }): string | undefined {
  const m = err.message;
  if (!m || m === err.code || /^Request failed/.test(m)) return undefined;
  return m;
}

/** 429: `retryAfterMs` from the body (top level or `details`) or parsed from the message. */
function readRetryAfterMs(err: { message?: string; details?: unknown }): number | undefined {
  const direct = (err as { retryAfterMs?: unknown }).retryAfterMs;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;
  const details = err.details;
  if (details && typeof details === "object") {
    const nested = (details as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof nested === "number" && Number.isFinite(nested) && nested > 0) return nested;
  }
  const parsed = err.message ? RETRY_HINT.exec(err.message) : null;
  if (parsed) return Number(parsed[1]) * 1000;
  return undefined;
}

function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  return err instanceof Error && NETWORK_FAILURE.test(err.message);
}

/**
 * Pure mapping from anything thrown by `apiJson` / `authedFetch` / `fetch` to what the UI
 * should say and whether a Retry button makes sense:
 *   AbortError           -> aborted (show nothing)
 *   401 / unauthorized   -> "Please sign in again", signIn, not retryable
 *   402 / credits        -> credits message, not retryable
 *   429 / rate_limited   -> the server's hint (with retryAfterMs), retryable
 *   5xx                  -> server message, retryable
 *   other 4xx            -> server message, retryable only for 408/409/425
 *   network TypeError    -> offline or connection message, retryable
 *   anything else        -> its message or the fallback, retryable
 */
export function describeApiError(
  err: unknown,
  options: DescribeApiErrorOptions = {},
): ApiErrorDescription {
  const fallback = options.fallback ?? "Something went wrong";

  if (isAbortError(err)) {
    return { message: "", retryable: false, aborted: true, kind: "abort" };
  }

  if (isApiError(err)) {
    const human = humanMessage(err);
    if (err.status === 401 || err.code === "unauthorized") {
      return {
        message: SIGN_IN_AGAIN_MESSAGE,
        retryable: false,
        signIn: true,
        aborted: false,
        kind: "unauthorized",
      };
    }
    if (err.status === 402 || err.code === "credits_exhausted") {
      return {
        message: human ?? CREDITS_EXHAUSTED_MESSAGE,
        retryable: false,
        aborted: false,
        kind: "credits",
      };
    }
    if (err.status === 429 || err.code === "rate_limited") {
      const retryAfterMs = readRetryAfterMs(err);
      const sec = retryAfterMs ? Math.max(1, Math.ceil(retryAfterMs / 1000)) : null;
      const message =
        human ??
        (sec ? `Try again in ${sec} second${sec === 1 ? "" : "s"}` : RATE_LIMITED_MESSAGE);
      return {
        message,
        retryable: true,
        ...(retryAfterMs ? { retryAfterMs } : {}),
        aborted: false,
        kind: "rate-limited",
      };
    }
    if (err.status >= 500) {
      return { message: human ?? SERVER_MESSAGE, retryable: true, aborted: false, kind: "server" };
    }
    const transient = err.status === 408 || err.status === 409 || err.status === 425;
    return { message: human ?? fallback, retryable: transient, aborted: false, kind: "request" };
  }

  if (isNetworkFailure(err)) {
    const online =
      options.online ?? (typeof navigator === "undefined" ? true : navigator.onLine !== false);
    return online
      ? { message: NETWORK_MESSAGE, retryable: true, aborted: false, kind: "network" }
      : { message: OFFLINE_MESSAGE, retryable: true, aborted: false, kind: "offline" };
  }

  const message = err instanceof Error && err.message ? err.message : fallback;
  return { message, retryable: true, aborted: false, kind: "other" };
}

type HandleOptions = {
  /** Message used when the error carries no usable text. */
  fallback?: string;
  /**
   * When true, errors that are not one of the well-known codes
   * (401 / 429 / 402) are also surfaced as a toast. Well-known codes
   * always toast regardless of this flag.
   */
  toastOthers?: boolean;
  /**
   * Set to false to skip every toast (the caller shows the message inline);
   * the 401 redirect still happens. Defaults to true.
   */
  toast?: boolean;
};

/**
 * Uniform handling for errors thrown by `apiJson` / `authedFetch`:
 *   401 -> toast "Please sign in again" and redirect to /login
 *   429 -> toast the server's retry hint
 *   402 / credits_exhausted -> the credits toast
 *   anything else -> the server's human message (toasted if `toastOthers`)
 *
 * Returns the human-readable message so callers can also show it inline.
 */
export function useApiErrorHandler() {
  const router = useRouter();

  return useCallback(
    (err: unknown, options: HandleOptions = {}): string => {
      const fallback = options.fallback ?? "Something went wrong";
      const described = describeApiError(err, { fallback });
      if (described.aborted) return fallback;

      const showToast = options.toast !== false;
      if (described.signIn) {
        if (showToast) toast.error(described.message);
        router.replace("/login");
        return described.message;
      }

      const wellKnown = described.kind === "credits" || described.kind === "rate-limited";
      if (showToast && (wellKnown || options.toastOthers)) {
        toast.error(described.message, described.kind === "credits" ? { duration: 8000 } : undefined);
      }
      return described.message;
    },
    [router],
  );
}

/**
 * Like `useApiErrorHandler` but returns the full description for callers that render the
 * error inline (with their own Retry). Redirects to /login on 401; toasts only when asked.
 */
export function useApiErrorDescriber() {
  const router = useRouter();

  return useCallback(
    (err: unknown, options: DescribeApiErrorOptions & { toast?: boolean } = {}): ApiErrorDescription => {
      const described = describeApiError(err, options);
      if (described.aborted) return described;
      if (described.signIn) {
        if (options.toast) toast.error(described.message);
        router.replace("/login");
      } else if (options.toast) {
        toast.error(described.message);
      }
      return described;
    },
    [router],
  );
}
