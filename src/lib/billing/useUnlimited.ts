"use client";

import { NO_UNLIMITED, type UnlimitedState } from "@/lib/billing/unlimited";

/**
 * This user's Agathon Unlimited subscription (`unlimited.ts`), as the Stripe webhook stored it.
 * `loading` until the first read lands; a failed read is "none" (nobody is told they have a plan
 * they may not have).
 *
 * CONTRACT STUB: the subscription backend (feat/unlimited-plan) replaces the body with the real
 * read; the signature stays.
 */
export function useUnlimited(): { state: UnlimitedState; loading: boolean; refresh: () => void } {
  return { state: NO_UNLIMITED, loading: false, refresh: () => undefined };
}
