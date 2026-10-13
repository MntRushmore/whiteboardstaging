/**
 * STUB (agent "account", 2026-10-13): the steps before the account, counted anonymously by journey.
 * The real module is agent "measure"'s (src/lib/start/record.ts, `POST /api/start/step`); this file
 * only holds its signatures so the account screen compiles, and is replaced on merge.
 */
import type { StartEvent } from "./contracts";

/** Count one step of the journey on this device (fire and forget; never throws). */
export function recordStartStep(event: StartEvent, meta?: Record<string, string | number | boolean | null>): void {
  void event;
  void meta;
}

/** Link this device's journey to the account just made or signed in (never rejects). */
export async function linkStartJourney(userId: string): Promise<void> {
  void userId;
}
