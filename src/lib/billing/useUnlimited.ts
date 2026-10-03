"use client";

import { useEffect, useMemo, useRef } from "react";
import { NO_UNLIMITED, isUnlimited, isUnlimitedReturn, parseUnlimitedState, type UnlimitedState } from "@/lib/billing/unlimited";
import { useInkSummary, watchCheckoutResult } from "@/lib/billing/useInkSummary";

/**
 * This user's Agathon Unlimited subscription (`unlimited.ts`), as the Stripe webhook stored it.
 * `loading` until the first read lands; a failed read is "none" (nobody is told they have a plan
 * they may not have).
 *
 * It is the `unlimited` part of `ink_summary()` (supabase/migrations/20261003020000_unlimited.sql),
 * read through useInkSummary's shared store: the ink meter, the account page and this hook make one
 * request per page between them, with the same auth retry, focus and tab-return re-reads.
 *
 * Back from checkout (`?unlimited=started` in the address), it watches for the plan: the webhook
 * usually lands within seconds of the redirect, often just after it, so the page re-reads every few
 * seconds (CHECKOUT_WATCH_MS) until the free week shows up, for up to ten minutes. `refresh()` reads
 * again now; a page that opens the checkout in a new tab can call `watchUnlimitedCheckout()`.
 */
export function useUnlimited(): { state: UnlimitedState; loading: boolean; refresh: () => void } {
  const ink = useInkSummary();
  const raw = ink.summary?.unlimited;
  const state = useMemo(() => (raw === undefined ? NO_UNLIMITED : parseUnlimitedState(raw)), [raw]);
  const on = isUnlimited(state);

  // Once per mount: back from checkout and the plan is not here yet, so watch for it. After
  // useInkSummary's own effect (declared first), so the store is attached to this user already.
  const watched = useRef(false);
  const ready = ink.state.status === "ready";
  useEffect(() => {
    if (watched.current || !ready || on || typeof window === "undefined") return;
    watched.current = true;
    if (isUnlimitedReturn(window.location.search)) watchCheckoutResult();
  }, [ready, on]);

  return { state, loading: ink.loading, refresh: ink.reload };
}

/**
 * The Unlimited checkout was opened in another tab: re-read this page's plan every few seconds
 * until it arrives (or ten minutes pass). Needs a mounted useUnlimited/useInkSummary on the page.
 */
export function watchUnlimitedCheckout(): void {
  watchCheckoutResult();
}
