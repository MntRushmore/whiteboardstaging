/**
 * /start answers still to be saved to an account, kept on the device in localStorage
 * (`agathon.start.pending` = { answers, userId?, createdAt }), for the ways a sign-up does not end
 * on the account screen itself:
 *
 * - "Already have an account? Sign in": the answers go with the visitor to /login; once they are
 *   signed in, `StartResume` finishes them on that account if it has not been onboarded yet;
 * - a sign-up that came back without a session (email confirmation on): finished on the first
 *   sign-in, for that account only (`userId`);
 * - a sign-up whose page closed while its answers were being saved: finished on the next page.
 *
 * Kept tiny and import-free (types only): `StartResume` is in the root layout and reads
 * `hasStartPending` on every page; the answers are checked (`cleanStartAnswers`) only in the lazy
 * chunk that finishes them (`resume.ts`).
 */
import type { StartAnswers } from "./contracts";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const START_PENDING_KEY = "agathon.start.pending";
/** Unfinished answers older than this are dropped: a week covers a confirmation email opened late. */
export const START_PENDING_TTL_MS = 7 * 24 * 60 * 60_000;

export interface StartPending {
  /** as written; checked again before use (`cleanStartAnswers`) */
  answers: unknown;
  /** the account they belong to, once one exists; absent: whoever signs in next on this device */
  userId?: string;
  createdAt: number;
}

export function startStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Keep `answers` on this device until a signed-in page finishes them. False when storage refused. */
export function writeStartPending(storage: StorageLike | null | undefined, answers: StartAnswers, now: number, userId?: string | null): boolean {
  if (!storage) return false;
  try {
    const value: StartPending = { answers, ...(userId ? { userId } : {}), createdAt: now };
    storage.setItem(START_PENDING_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearStartPending(storage: StorageLike | null | undefined): void {
  try {
    storage?.removeItem(START_PENDING_KEY);
  } catch {
    /* nothing to do */
  }
}

/** Synchronous and cheap: is anything waiting? (No parsing: `readStartPending` does that.) */
export function hasStartPending(storage: StorageLike | null | undefined): boolean {
  try {
    return Boolean(storage?.getItem(START_PENDING_KEY));
  } catch {
    return false;
  }
}

/**
 * What is waiting, for `userId`: null when nothing is, when it belongs to another account, or when it
 * is unreadable or too old (those two are cleared, so they are never read again).
 */
export function readStartPending(storage: StorageLike | null | undefined, userId: string, now: number): StartPending | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(START_PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StartPending> | null;
    const ok = v && typeof v === "object" && typeof v.createdAt === "number" && v.answers && typeof v.answers === "object";
    if (!ok || now - (v.createdAt as number) > START_PENDING_TTL_MS || (v.createdAt as number) - now > START_PENDING_TTL_MS) {
      clearStartPending(storage);
      return null;
    }
    if (typeof v.userId === "string" && v.userId !== userId) return null;
    return { answers: v.answers, ...(typeof v.userId === "string" ? { userId: v.userId } : {}), createdAt: v.createdAt as number };
  } catch {
    clearStartPending(storage);
    return null;
  }
}
