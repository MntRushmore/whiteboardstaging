import { addDays } from "@/lib/sat/day";

/**
 * The mistake deck (docs/SAT-V2.md "Mistake deck", 20261023000000_sat_reviews.sql). Pure: the
 * routes read and write the rows.
 *
 *  - A miss schedules the question (step 1, due tomorrow), or reschedules it: a miss on a review,
 *    due or not, cleared or not, goes back to step 1, due tomorrow. A second miss on the same day
 *    changes nothing (it is already due tomorrow at step 1).
 *  - A right answer on a DUE review (due today or earlier, not cleared) moves it on: step 1 ->
 *    step 2, due 3 days later; step 2 -> cleared. A right answer on a question that is not due
 *    (a retry in the same set, or an exhausted bank asking it early) changes nothing, so a question
 *    missed and then got right on the second try still comes back tomorrow.
 *  - Days are the student's own (YYYY-MM-DD in their time zone).
 */

export type ReviewStep = 1 | 2;
export type ReviewRow = { question_id: string; due_on: string; step: ReviewStep; cleared_at: string | null };
export type ReviewSchedule = { due_on: string; step: ReviewStep; cleared_at: string | null };

/** Days from today until each step's review: step 1 is tomorrow, step 2 three days after step 1's. */
export const REVIEW_GAP_DAYS: Record<ReviewStep, number> = { 1: 1, 2: 3 };

/** Is this review due on `today` (today or overdue, and not cleared)? */
export function isDue(row: Pick<ReviewRow, "due_on" | "cleared_at">, today: string): boolean {
  return row.cleared_at === null && row.due_on <= today;
}

/**
 * What one checked answer does to the question's review: the row to write, or null for no change.
 * `existing` is the student's row for that question (null when there is none).
 */
export function nextReview(existing: ReviewRow | null, correct: boolean, today: string, nowIso: string): ReviewSchedule | null {
  if (!correct) {
    const tomorrow = addDays(today, REVIEW_GAP_DAYS[1]);
    if (existing && existing.cleared_at === null && existing.step === 1 && existing.due_on === tomorrow) return null;
    return { due_on: tomorrow, step: 1, cleared_at: null };
  }
  if (!existing || !isDue(existing, today)) return null;
  if (existing.step === 1) return { due_on: addDays(today, REVIEW_GAP_DAYS[2]), step: 2, cleared_at: null };
  return { due_on: existing.due_on, step: 2, cleared_at: nowIso };
}

/** The reviews due on `today`, oldest due first (then by id, so the order is stable). */
export function dueReviews<T extends Pick<ReviewRow, "question_id" | "due_on" | "cleared_at">>(rows: readonly T[], today: string): T[] {
  return rows.filter((r) => isDue(r, today)).sort((a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : a.question_id < b.question_id ? -1 : a.question_id > b.question_id ? 1 : 0));
}

/** GET /api/sat/progress's `reviews_due` (due today or overdue) and `reviews_waiting` (scheduled for a later day). */
export function countReviews(rows: ReadonlyArray<Pick<ReviewRow, "due_on" | "cleared_at">>, today: string): { reviews_due: number; reviews_waiting: number } {
  let due = 0;
  let waiting = 0;
  for (const r of rows) {
    if (r.cleared_at !== null) continue;
    if (r.due_on <= today) due++;
    else waiting++;
  }
  return { reviews_due: due, reviews_waiting: waiting };
}
