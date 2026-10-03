/**
 * Where the plan screen is, and whether it is still due on this device — the small part of the
 * plan screen that the guided board (it opens the screen) and the boards home (it may send the
 * student there) need, apart from the screen's own words and logic (`plan.ts`), so neither carries
 * those.
 *
 * The marker, in localStorage: `agathon.onboarding.plan.<userId>` =
 * - "pending" once the guided board was finished (not skipped): the tour's finish card opens the
 *   plan screen itself, and "pending" covers the student who never got there (a reload on the
 *   finish card), so the home sends them to it once;
 * - "seen" once the plan screen has shown.
 *
 * The profile has no column for it and needs none (no migration): the plan screen follows the
 * tour, which runs once per account, on one device. Apart from `marker.ts` too, which is on the
 * board's first load.
 */
import type { StorageLike } from "./marker";

export const PLAN_PATH = "/welcome/plan";
export const HOME_PATH = "/";

export type PlanMarker = "pending" | "seen";

export const planKey = (userId: string) => `agathon.onboarding.plan.${userId}`;

/** Still to show, already shown, or never due (null). */
export function readPlanMarker(storage: StorageLike | null | undefined, userId: string | null | undefined): PlanMarker | null {
  if (!storage || !userId) return null;
  try {
    const v = storage.getItem(planKey(userId));
    return v === "pending" || v === "seen" ? v : null;
  } catch {
    return null;
  }
}

export function writePlanMarker(storage: StorageLike | null | undefined, userId: string, value: PlanMarker): void {
  try {
    storage?.setItem(planKey(userId), value);
  } catch {
    /* private mode: the tour's own button still opens the plan screen, once */
  }
}

/** The home sends the student to the plan screen only while it is due and has not shown. */
export function planDue(marker: PlanMarker | null): boolean {
  return marker === "pending";
}
