/**
 * The try marker (docs/TRY-BOARD.md "Measuring it"): what this device remembers of a visit to the
 * free board at /try, so that once the visitor has an account the app can record the funnel step
 * `try_board` with `{ checked, solved }`, once per account.
 *
 * - The page writes it on the tutor's first verdict (`writeTryMarker`), and only ever merges
 *   upward: a later `checked` or `solved` turns a flag on, nothing turns one off, and `at` stays the
 *   first time.
 * - After a sign-in (`src/lib/try/afterSignIn.ts`, from AttributionCapture), `tryBoardDecision` says
 *   whether to record it for that account, and `markTryRecorded` remembers the accounts it was
 *   recorded (or ruled out) for, so it never repeats.
 *
 * The key is the contract's `TRY_MARKER_KEY` (src/lib/try/contracts.ts), spelled out here because
 * the contract module brings zod with it, and this one is in the try page's first load; a test
 * pins the two together. Pure apart from the storage passed in; nothing here throws.
 */
import type { TryMarker } from "./contracts";

/** localStorage: the marker (`TRY_MARKER_KEY` in the contract). */
export const TRY_MARKER_STORAGE_KEY = "agathon.try";

/** localStorage: the accounts the marker was recorded (or ruled out) for, newest last. */
export const TRY_RECORDED_KEY = "agathon.try.recorded";

/** At most this many accounts are remembered (a shared family laptop, a few profiles). */
const RECORDED_MAX = 20;

/**
 * An account made more than this long before the try did not come from it: an older account trying
 * the free board later. Its step is not recorded (the Funnel's "tried the board first" would count
 * it). The same allowance as the sign-up attribution's (src/lib/funnel/capture.ts SIGNUP_SLACK_MS):
 * the device's clock running ahead of the server's.
 */
export const TRY_SIGNUP_SLACK_MS = 2 * 60_000;

export type MarkerStorage = Pick<Storage, "getItem" | "setItem">;

/** The device's marker, or null (none, unreadable, or not ours). */
export function readTryMarker(storage: MarkerStorage | null): TryMarker | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(TRY_MARKER_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { at, checked, solved } = parsed as Record<string, unknown>;
    if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return null;
    return { at, checked: checked === true, solved: solved === true };
  } catch {
    return null;
  }
}

/** Remember a verdict: the first one sets `at`; `checked` and `solved` only ever turn on. Answers what is kept. */
export function writeTryMarker(storage: MarkerStorage | null, seen: { checked: boolean; solved: boolean }, now: Date): TryMarker | null {
  if (!storage) return null;
  const before = readTryMarker(storage);
  const marker: TryMarker = {
    at: before?.at ?? now.toISOString(),
    checked: Boolean(before?.checked || seen.checked || seen.solved),
    solved: Boolean(before?.solved || seen.solved),
  };
  try {
    storage.setItem(TRY_MARKER_STORAGE_KEY, JSON.stringify(marker));
    return marker;
  } catch {
    return null; // full or blocked: nothing kept, nothing broken
  }
}

function readRecorded(storage: MarkerStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(TRY_RECORDED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Remember that this account's step was recorded (or does not apply), so it is never sent again. */
export function markTryRecorded(storage: MarkerStorage | null, userId: string): void {
  if (!storage || !userId) return;
  const ids = readRecorded(storage).filter((id) => id !== userId);
  ids.push(userId);
  try {
    storage.setItem(TRY_RECORDED_KEY, JSON.stringify(ids.slice(-RECORDED_MAX)));
  } catch {
    // blocked: the step may be sent again next load, and the server keeps one row per account
  }
}

/** The signed-in account, as Supabase's user has it. */
export interface TryUser {
  id: string;
  email?: string | null;
  /** ISO, when the account was made */
  created_at?: string | null;
}

export type TryBoardDecision =
  /** record `try_board` with this meta for the account, then `markTryRecorded` */
  | { kind: "send"; meta: { checked: boolean; solved: boolean } }
  /** this account did not try the board first: remember it without recording */
  | { kind: "skip" }
  /** nothing to do: no marker, no account, or already recorded */
  | { kind: "none" };

/**
 * Whether to record `try_board` for `user`: there is a marker, it was not recorded for this account
 * yet, and the account is not older than the try (an old account trying the board later: `skip`).
 * `kid`: a kid profile (its grown-up's account is the family's arrival; the Funnel leaves kids out),
 * left alone so the grown-up's sign-in on this device still records it.
 */
export function tryBoardDecision(storage: MarkerStorage | null, user: TryUser | null, kid = false): TryBoardDecision {
  if (!storage || !user?.id || kid) return { kind: "none" };
  const marker = readTryMarker(storage);
  if (!marker) return { kind: "none" };
  if (readRecorded(storage).includes(user.id)) return { kind: "none" };
  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  if (Number.isFinite(created) && created < Date.parse(marker.at) - TRY_SIGNUP_SLACK_MS) return { kind: "skip" };
  return { kind: "send", meta: { checked: marker.checked, solved: marker.solved } };
}
