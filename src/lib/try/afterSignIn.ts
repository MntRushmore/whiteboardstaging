/**
 * After a sign-in, the try board's funnel step (docs/TRY-BOARD.md "Measuring it"): when this device
 * tried the free board at /try (its try marker) and the signed-in account has not had it recorded,
 * record `try_board` with `{ checked, solved }`, once, and remember that for the account.
 *
 * Loaded by AttributionCapture (root layout) in a lazy chunk, only for a signed-in user on a device
 * that holds a marker, so no page carries the recorder (and the Supabase client it needs) in its
 * first load for this.
 */
import { isKidEmail } from "@/lib/family/kidEmail";
import { recordFunnelStep as appRecorder, type RecordFunnelStep } from "@/lib/funnel/record";
import { markTryRecorded, tryBoardDecision, type MarkerStorage, type TryUser } from "./marker";

/** localStorage, or null where it cannot be used (server, private mode, blocked). */
function localStore(): MarkerStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Record `try_board` for `user` if this device tried the board first. Never throws. */
export async function recordTryBoard(user: TryUser, record: RecordFunnelStep = appRecorder, storage: MarkerStorage | null = localStore()): Promise<void> {
  try {
    const decision = tryBoardDecision(storage, user, isKidEmail(user.email));
    if (decision.kind === "skip") {
      markTryRecorded(storage, user.id);
      return;
    }
    if (decision.kind !== "send") return;
    // `record` resolves once the request is handed to fetch (keepalive), and never rejects
    await record("try_board", decision.meta);
    markTryRecorded(storage, user.id);
  } catch {
    // nothing recorded, nothing broken
  }
}
