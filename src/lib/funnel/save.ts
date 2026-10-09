/**
 * Saves the device's sign-up attribution to the signed-in account (`save_attribution`, which only
 * writes a profile that has none). Loaded with a dynamic import by AttributionCapture once a user is
 * signed in, so no page pays for it on its first load. Never throws.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attribution } from "./contracts";

export type SaveAttributionResult =
  /** the server answered (true: stored; false: the profile already had one): done either way */
  | { done: true }
  /** offline, signed out under us, or the server failed: try again on a later page */
  | { done: false; error: string };

/** Postgres's "invalid parameter": the server will never take this one, so it counts as done. */
const BAD_VALUE = "22023";

/** One call to save_attribution with the caller's session. */
export async function saveAttribution(client: Pick<SupabaseClient, "rpc">, attribution: Attribution): Promise<SaveAttributionResult> {
  try {
    const { error } = await client.rpc("save_attribution", { p: attribution });
    if (!error || error.code === BAD_VALUE) return { done: true };
    return { done: false, error: error.message };
  } catch (err) {
    return { done: false, error: err instanceof Error ? err.message : String(err) };
  }
}
