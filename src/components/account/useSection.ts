"use client";

import { useCallback, useEffect, useReducer } from "react";
import { describeError } from "@/lib/errorMessage";
import { initialSection, sectionReducer, type SectionState } from "@/lib/billing/accountState";

/**
 * Runs `read` once `enabled` and again on retry(); the result lands in a
 * SectionState (loading / error / ready). `read` must be referentially stable
 * (wrap it in useCallback) — it is an effect dependency.
 */
export function useSection<T>(read: () => Promise<T>, enabled: boolean, fallback: string) {
  const [state, dispatch] = useReducer(sectionReducer<T>, undefined, (): SectionState<T> => initialSection<T>());
  const [attempt, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await read();
        if (!cancelled) dispatch({ type: "loaded", data });
      } catch (err) {
        if (cancelled) return;
        console.warn("Account section failed to load:", err);
        dispatch({ type: "failed", message: describeError(err, fallback) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [read, enabled, fallback, attempt]);

  const retry = useCallback(() => {
    dispatch({ type: "load" });
    bump();
  }, []);

  return { state, retry };
}
