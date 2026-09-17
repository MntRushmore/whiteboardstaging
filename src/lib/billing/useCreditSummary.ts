"use client";

import { useCallback, useEffect, useReducer } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { describeError } from "@/lib/errorMessage";
import { parseCreditSummary, type CreditSummary } from "@/lib/billing/viewModel";
import { initialSection, sectionReducer, type SectionState } from "@/lib/billing/accountState";

export const CREDIT_SUMMARY_FALLBACK = "Couldn't read your credits. Retry in a moment.";

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
      const { data, error } = await supabase.rpc("credit_summary");
      if (cancelled) return;
      if (error) {
        dispatch({ type: "failed", message: describeError(error, CREDIT_SUMMARY_FALLBACK) });
        return;
      }
      const summary = parseCreditSummary(data);
      if (!summary) {
        dispatch({ type: "failed", message: CREDIT_SUMMARY_FALLBACK });
        return;
      }
      dispatch({ type: "loaded", data: summary });
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
