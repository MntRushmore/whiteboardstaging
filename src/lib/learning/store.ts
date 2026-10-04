/**
 * STUB (owner: agent "data"). Reads and writes the student's own `learning_attempts` rows with the
 * signed-in Supabase client (RLS: own rows only). Exports are frozen by the contract.
 */
import type { AttemptRecord } from "./contracts";

/** Upsert by id (the attempt's latest state wins). Throws on failure, so the caller can retry. */
export async function saveAttempts(records: readonly AttemptRecord[]): Promise<void> {
  void records;
}

/** The student's attempts, newest first: the last `sinceDays` days, at most `limit`. */
export async function loadAttempts(opts: { sinceDays?: number; limit?: number } = {}): Promise<AttemptRecord[]> {
  void opts;
  return [];
}
