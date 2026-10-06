/**
 * The paywall: whether a signed-in page may show, or sends the student to the plan screen. There is
 * no free plan (owner, 2026-10-05): the app is Agathon Unlimited, free for 3 days, then $25 a month
 * (`unlimited.ts`). The guided first board is the one way in without it, and the plan screen comes
 * right after it.
 *
 * Pure: no React, no storage of its own, no network. `usePlanGate` (src/components/billing) feeds
 * it and does the redirect. It fails OPEN on anything it does not know, because a student wrongly
 * sent to the plan screen may pay twice, while one wrongly let in costs a little ink:
 *  - no checkout link on this deployment (local, a preview): nothing to pay with, so open;
 *  - the plan not read yet, or the read failed: `checking` (the page shows as usual);
 *  - back from checkout a moment ago (the webhook may land after the student does): open.
 */
import { hasPlan, type UnlimitedState } from "@/lib/billing/unlimited";
import type { StorageLike } from "@/lib/onboarding/marker";

export type PlanGate = "checking" | "open" | "locked";

export interface PlanGateInput {
  /** false on a page or moment the gate must leave alone: no user yet, the welcome, the guided board */
  enabled: boolean;
  /** the plan can be started on this deployment (`unlimitedLink()` is set) */
  checkoutOpen: boolean;
  /** the server answered about the plan (`useUnlimited().known`) */
  known: boolean;
  state: Pick<UnlimitedState, "status">;
  /** back from the plan's checkout within JUST_PAID_MS (`returnedFromCheckout`) */
  justPaid: boolean;
  /** `is_admin()`: admins look around without a plan. null while it is being asked. */
  admin: boolean | null;
}

export function planGate({ enabled, checkoutOpen, known, state, justPaid, admin }: PlanGateInput): PlanGate {
  if (!enabled || !checkoutOpen || justPaid) return "open";
  if (!known) return "checking";
  if (hasPlan(state)) return "open";
  if (admin === null) return "checking";
  return admin ? "open" : "locked";
}

/** Whether `planGate` needs `is_admin()`: only to lock someone out, never to let a subscriber in. */
export function gateNeedsAdmin(input: Omit<PlanGateInput, "admin">): boolean {
  return planGate({ ...input, admin: false }) === "locked";
}

/* ------------------------------------------------------------------------- */
/* Back from checkout                                                         */
/* ------------------------------------------------------------------------- */

/** How long after the checkout's return the app stays open while the webhook catches up. */
export const JUST_PAID_MS = 10 * 60_000;

const RETURN_KEY = "agathon.plan.returnedAt";

/** The plan's checkout returned to this tab (`?unlimited=started`) at `now`. */
export function markCheckoutReturn(storage: StorageLike | null | undefined, now: number): void {
  try {
    storage?.setItem(RETURN_KEY, String(now));
  } catch {
    /* private mode: the page that saw the return still stays open */
  }
}

/** The checkout returned to this tab less than JUST_PAID_MS ago. */
export function returnedFromCheckout(storage: StorageLike | null | undefined, now: number): boolean {
  try {
    const at = Number(storage?.getItem(RETURN_KEY));
    return Number.isFinite(at) && at > 0 && now >= at && now - at < JUST_PAID_MS;
  } catch {
    return false;
  }
}
