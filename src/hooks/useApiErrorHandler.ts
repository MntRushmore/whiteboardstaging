"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { isApiError } from "@/lib/api-client";

export const CREDITS_EXHAUSTED_MESSAGE =
  "Account credits depleted — please talk to Rushil to refill your account!";
export const SIGN_IN_AGAIN_MESSAGE = "Please sign in again";
export const RATE_LIMITED_MESSAGE =
  "Slow down a little — try again in a few seconds";

/** True when the error is a fetch abort (user edited the canvas mid-request). */
export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
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
};

/**
 * Uniform handling for errors thrown by `apiJson` / `authedFetch`:
 *   401 -> toast "Please sign in again" and redirect to /login
 *   429 -> toast "Slow down a little — try again in a few seconds"
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

      if (isApiError(err)) {
        if (err.status === 401 || err.code === "unauthorized") {
          toast.error(SIGN_IN_AGAIN_MESSAGE);
          router.replace("/login");
          return SIGN_IN_AGAIN_MESSAGE;
        }
        if (err.status === 429 || err.code === "rate_limited") {
          toast.error(RATE_LIMITED_MESSAGE);
          return RATE_LIMITED_MESSAGE;
        }
        if (err.status === 402 || err.code === "credits_exhausted") {
          // apiJson falls back to the machine code when the server sent no
          // human message; prefer our own copy in that case.
          const hasHumanMessage =
            err.message && err.message !== err.code && !/^Request failed/.test(err.message);
          const msg = hasHumanMessage ? err.message : CREDITS_EXHAUSTED_MESSAGE;
          toast.error(msg, { duration: 8000 });
          return msg;
        }
        const msg = err.message || fallback;
        if (options.toastOthers) toast.error(msg);
        return msg;
      }

      const msg = err instanceof Error && err.message ? err.message : fallback;
      if (options.toastOthers) toast.error(msg);
      return msg;
    },
    [router],
  );
}
