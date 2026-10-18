/**
 * The service-role writes behind the two Apple routes: apply_apple_subscription()
 * (supabase/migrations/20261017200000_apple_subscriptions.sql) and the billing_events log the Stripe
 * webhook shares (an App Store notification is recorded once, as `apple:<notificationUUID>`, so a
 * redelivery is seen; every write is idempotent, so a redelivery is simply applied again). Behind a
 * small interface so the route tests can fake it.
 */
import { createClient } from "@supabase/supabase-js";
import type { AppleSubscriptionState } from "@/lib/server/apple/state";

export type AppleApplyOutcome =
  | { status: "applied" | "stale"; userId: string | null; subscriptionStatus: string | null; unlimited: boolean; linked: boolean }
  /** a caller's claim that writes nothing: the purchase is another account's (or no account's) */
  | { status: "refused"; reason: "account_mismatch" | "account_unknown" }
  /** a caller's claim on a subscription another family already has */
  | { status: "conflict" }
  | { status: "error"; message: string };

/** One App Store notification, as billing_events keeps it (no signed blobs; no personal data in them anyway). */
export type AppleEventRecord = { id: string; type: string; payload: Record<string, unknown> };

export type AppleStore = {
  apply(state: AppleSubscriptionState, claimUserId: string | null): Promise<AppleApplyOutcome>;
  recordEvent(event: AppleEventRecord): Promise<{ status: "inserted" | "duplicate" } | { status: "error"; message: string }>;
  forgetEvent(id: string): Promise<{ ok: true } | { error: string }>;
};

const UNIQUE_VIOLATION = "23505";

function rowOf(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

/** Read apply_apple_subscription()'s answer. Exported for tests. */
export function applyOutcomeOf(row: Record<string, unknown>): AppleApplyOutcome {
  if (row.refused === "account_mismatch" || row.refused === "account_unknown") return { status: "refused", reason: row.refused };
  if (row.conflict === true) return { status: "conflict" };
  return {
    status: row.stale === true ? "stale" : "applied",
    userId: typeof row.user_id === "string" ? row.user_id : null,
    subscriptionStatus: typeof row.status === "string" ? row.status : null,
    unlimited: row.unlimited === true,
    linked: row.linked === true,
  };
}

export function supabaseAppleStore(url: string, serviceRoleKey: string): AppleStore {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async apply(s, claimUserId) {
      const { data, error } = await client.rpc("apply_apple_subscription", {
        p_original_transaction_id: s.originalTransactionId,
        p_environment: s.environment,
        p_product_id: s.productId,
        p_status: s.status,
        p_event_at: s.eventAt,
        p_app_account_token: s.appAccountToken,
        p_claim_user: claimUserId,
        p_transaction_id: s.transactionId,
        p_trial_end: s.trialEnd,
        p_current_period_end: s.currentPeriodEnd,
        p_cancel_at_period_end: s.cancelAtPeriodEnd,
        p_canceled_at: s.canceledAt,
        p_ended_at: s.endedAt,
        p_price_milliunits: s.priceMilliunits,
        p_currency: s.currency,
      });
      if (error) return { status: "error", message: error.message };
      const row = rowOf(data);
      if (!row) return { status: "error", message: "apply_apple_subscription returned no row" };
      return applyOutcomeOf(row);
    },
    async recordEvent(event) {
      const { error } = await client.from("billing_events").insert({ id: event.id, type: event.type, payload: event.payload });
      if (!error) return { status: "inserted" };
      if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
      return { status: "error", message: error.message };
    },
    async forgetEvent(id) {
      const { error } = await client.from("billing_events").delete().eq("id", id);
      return error ? { error: error.message } : { ok: true };
    },
  };
}
