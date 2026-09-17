"use client";

import { useCallback, useEffect, useReducer } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { describeError } from "@/lib/errorMessage";
import { parseCreditSummary, type CreditSummary } from "@/lib/billing/viewModel";
import { initialSection, sectionReducer, type SectionState } from "@/lib/billing/accountState";

export const CREDIT_SUMMARY_FALLBACK = "Couldn't read your credits. Retry in a moment.";

/** How long to wait before the single retry of a transient auth failure. */
export const AUTH_RETRY_DELAY_MS = 700;

/**
 * True for the auth failures that resolve themselves: a token that was minted moments ago and
 * has not propagated yet (a fresh sign-in, or a background refresh), and PostgREST's PGRST303
 * "JWT issued at future" when its clock trails the auth server's. These used to surface as a
 * 401 in the console on every sign-in, which is noise, not information.
 */
export function isRetryableAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; status?: unknown; message?: unknown };
  if (e.code === "PGRST303" || e.code === "PGRST301") return true;
  if (e.status === 401) return true;
  return typeof e.message === "string" && /\bjwt\b/i.test(e.message);
}

export type CreditSummaryRpc = () => PromiseLike<{ data: unknown; error: unknown }>;
export type ReadCreditSummaryResult = { summary: CreditSummary } | { error: string };

/**
 * One credit-summary read, retried once when the failure is a transient auth error.
 * Pure apart from the injected rpc/sleep so it is unit-tested without a browser.
 */
export async function readCreditSummary(
  rpc: CreditSummaryRpc,
  opts: { retryDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ReadCreditSummaryResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delay = opts.retryDelayMs ?? AUTH_RETRY_DELAY_MS;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await rpc();
    if (error) {
      if (attempt === 0 && isRetryableAuthError(error)) {
        await sleep(delay);
        continue;
      }
      return { error: describeError(error, CREDIT_SUMMARY_FALLBACK) };
    }
    const summary = parseCreditSummary(data);
    if (summary) return { summary };
    return { error: CREDIT_SUMMARY_FALLBACK };
  }
  return { error: CREDIT_SUMMARY_FALLBACK };
}

/** The summary is re-read on mount, on window focus, on reload(), and every `pollMs` when set. */
export type UseCreditSummaryOptions = {
  /** Re-read on an interval (ms). 0 / undefined = only on mount, focus and reload(). */
  pollMs?: number;
  /** Skip the request entirely (e.g. while the caller is not signed in). Default true. */
  enabled?: boolean;
};

/**
 * The signed-in user's credit summary via the SECURITY DEFINER RPC
 * `credit_summary()`, read with the user's own JWT (RLS/definer keeps it to
 * their row). Nothing here can add credits; plan changes happen server-side.
 */
export function useCreditSummary(options: UseCreditSummaryOptions = {}) {
  const { session } = useAuth();
  const enabled = options.enabled !== false && !!session?.access_token;
  const userId = session?.user?.id ?? null;
  const pollMs = options.pollMs ?? 0;

  const [state, dispatch] = useReducer(
    sectionReducer<CreditSummary>,
    undefined,
    (): SectionState<CreditSummary> => initialSection<CreditSummary>(),
  );
  // Incremented by reload(); the effect below re-runs the request.
  const [attempt, bump] = useReducer((n: number) => n + 1, 0);
  const reload = useCallback(() => bump(), []);

  useEffect(() => {
    if (!enabled || !userId) return;
    let cancelled = false;

    async function read() {
      const result = await readCreditSummary(() => supabase.rpc("credit_summary"));
      if (cancelled) return;
      if ("error" in result) {
        dispatch({ type: "failed", message: result.error });
        return;
      }
      dispatch({ type: "loaded", data: result.summary });
    }

    void read();
    const onFocus = () => void read();
    window.addEventListener("focus", onFocus);
    const interval = pollMs > 0 ? setInterval(() => void read(), pollMs) : null;
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      if (interval) clearInterval(interval);
    };
  }, [enabled, userId, pollMs, attempt]);

  return {
    /** Raw section state, for accountPageStateFor(). */
    state,
    summary: state.data,
    /** True until the first read settles (or after reload() until it settles again). */
    loading: enabled && state.status === "loading",
    error: state.status === "error" ? state.error : null,
    reload,
  };
}
