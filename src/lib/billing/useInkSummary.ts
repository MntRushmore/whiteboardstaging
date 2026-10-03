"use client";

import { useCallback, useEffect, useReducer } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { describeError } from "@/lib/errorMessage";
import { parseInkSummary, type InkSummary } from "@/lib/billing/inkSummary";
import { initialSection, sectionReducer, type SectionState } from "@/lib/billing/accountState";

export const INK_SUMMARY_FALLBACK = "Couldn't read your ink. Retry in a moment.";

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

export type InkSummaryRpc = () => PromiseLike<{ data: unknown; error: unknown }>;
export type ReadInkSummaryResult = { summary: InkSummary } | { error: string };

/**
 * One ink-summary read, retried once when the failure is a transient auth error.
 * Pure apart from the injected rpc/sleep so it is unit-tested without a browser.
 */
export async function readInkSummary(
  rpc: InkSummaryRpc,
  opts: { retryDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ReadInkSummaryResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delay = opts.retryDelayMs ?? AUTH_RETRY_DELAY_MS;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await rpc();
    if (error) {
      if (attempt === 0 && isRetryableAuthError(error)) {
        await sleep(delay);
        continue;
      }
      return { error: describeError(error, INK_SUMMARY_FALLBACK) };
    }
    const summary = parseInkSummary(data);
    if (summary) return { summary };
    return { error: INK_SUMMARY_FALLBACK };
  }
  return { error: INK_SUMMARY_FALLBACK };
}

/** Window event that makes every mounted useInkSummary re-read (ink bought, or spent elsewhere). */
export const INK_CHANGED_EVENT = "agathon:ink-changed";
/** localStorage key whose `storage` event tells the app's OTHER tabs to re-read (the board, after checkout). */
export const INK_CHANGED_KEY = "agathon:ink-changed";
/** Window event: a Payment Link was just opened, so watch for the ink to arrive. */
export const INK_CHECKOUT_EVENT = "agathon:ink-checkout";

/** After a buy button opens Stripe: re-read this often, for this long, until the balance grows. */
export const CHECKOUT_WATCH_MS = 3_000;
export const CHECKOUT_WATCH_FOR_MS = 10 * 60_000;

/**
 * Tell every ink surface on the page (and in the app's other tabs) to re-read: each useInkSummary
 * is its own request, so one that saw the balance change says so.
 */
export function notifyInkChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INK_CHANGED_EVENT));
  try {
    window.localStorage.setItem(INK_CHANGED_KEY, String(Date.now()));
  } catch {
    /* storage blocked: this tab still knows */
  }
}

/** A buy button opened a Payment Link (in a new tab): watch for the purchase's ink. */
export function watchInkCheckout(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INK_CHECKOUT_EVENT));
}

export type UseInkSummaryOptions = {
  /** Re-read on an interval (ms). 0 / undefined = only on the events below and reload(). */
  pollMs?: number;
  /** Skip the request entirely (e.g. while the caller is not signed in). Default true. */
  enabled?: boolean;
};

/**
 * The signed-in user's ink via the SECURITY DEFINER RPC `ink_summary()`, read with the user's own
 * JWT. Nothing here can add ink; that happens server-side.
 *
 * Re-read on mount, on reload(), when the window regains focus or the tab becomes visible again
 * (the student comes back from the Stripe tab), on INK_CHANGED_EVENT and the other tabs' storage
 * ping, every `pollMs` when set, and every CHECKOUT_WATCH_MS for up to CHECKOUT_WATCH_FOR_MS after
 * a buy button opened checkout (the webhook usually lands within seconds of paying, often after
 * the student is back), so bought ink appears without a reload.
 */
export function useInkSummary(options: UseInkSummaryOptions = {}) {
  const { session } = useAuth();
  const enabled = options.enabled !== false && !!session?.access_token;
  const userId = session?.user?.id ?? null;
  const pollMs = options.pollMs ?? 0;

  const [state, dispatch] = useReducer(
    sectionReducer<InkSummary>,
    undefined,
    (): SectionState<InkSummary> => initialSection<InkSummary>(),
  );
  // Incremented by reload(); the effect below re-runs the request.
  const [attempt, bump] = useReducer((n: number) => n + 1, 0);
  const reload = useCallback(() => bump(), []);

  useEffect(() => {
    if (!enabled || !userId) return;
    let cancelled = false;
    let watch: ReturnType<typeof setInterval> | null = null;
    let watchUntil = 0;
    let watchFrom: number | null = null;

    async function read() {
      const result = await readInkSummary(() => supabase.rpc("ink_summary"));
      if (cancelled) return;
      if ("error" in result) {
        dispatch({ type: "failed", message: result.error });
        return;
      }
      dispatch({ type: "loaded", data: result.summary });
      // The checkout watch ends when the ink has arrived (or its time is up).
      if (watch && (Date.now() > watchUntil || (watchFrom !== null && result.summary.balance > watchFrom))) stopWatch();
      if (watch && watchFrom === null) watchFrom = result.summary.balance;
    }
    function stopWatch() {
      if (watch) clearInterval(watch);
      watch = null;
      watchFrom = null;
    }

    void read();
    const onChange = () => void read();
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === INK_CHANGED_KEY) void read();
    };
    const onCheckout = () => {
      watchUntil = Date.now() + CHECKOUT_WATCH_FOR_MS;
      if (watch) return;
      watch = setInterval(() => void read(), CHECKOUT_WATCH_MS);
      void read(); // the balance before paying, to know when it grew
    };
    window.addEventListener("focus", onChange);
    window.addEventListener(INK_CHANGED_EVENT, onChange);
    window.addEventListener(INK_CHECKOUT_EVENT, onCheckout);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    const interval = pollMs > 0 ? setInterval(() => void read(), pollMs) : null;
    return () => {
      cancelled = true;
      stopWatch();
      window.removeEventListener("focus", onChange);
      window.removeEventListener(INK_CHANGED_EVENT, onChange);
      window.removeEventListener(INK_CHECKOUT_EVENT, onCheckout);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
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
