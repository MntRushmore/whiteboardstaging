/**
 * STUB (owner: agent "data"). Records an app event (`app_events`, service role) — what went wrong,
 * for the /admin page and the alerts. Exports are frozen by the contract (`src/lib/admin/contracts.ts`).
 */
import type { AppEventInput } from "@/lib/admin/contracts";

/**
 * Records an event, fire and forget: never throws, never delays the response it is about, and drops
 * events past a per-instance budget (a failing provider must not turn into a flood of writes).
 * A no-op without SUPABASE_SERVICE_ROLE_KEY.
 */
export function recordEvent(event: AppEventInput): void {
  void event;
}

/** The same, awaited (the health route, tests): resolves once written or dropped; never rejects. */
export async function recordEventNow(event: AppEventInput): Promise<void> {
  void event;
}
