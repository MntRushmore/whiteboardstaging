import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv, parseBillingPriceMap, type BillingPriceMap } from "@/lib/env";
import { billingLogger } from "@/lib/server/billing";
import { json } from "@/lib/server/auth";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { verifyStripeSignature } from "@/lib/server/webhookSignature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/webhook — Stripe-compatible billing webhook.
 *
 * PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs, reason "signature-verified
 * provider webhook"): the provider has no user JWT. Authentication is the
 * `Stripe-Signature` header (HMAC-SHA256 over `${t}.${rawBody}` with STRIPE_WEBHOOK_SECRET,
 * 5-minute tolerance) verified in src/lib/server/webhookSignature.ts. The body is read
 * as RAW TEXT because the signature covers the exact bytes; the parsed event is then
 * validated with zod. Profile changes use the service role (the only request path that
 * does) because a plan change must bypass the user's own RLS.
 *
 * Idempotency: every event id is inserted into `billing_events` first; a duplicate
 * answers `200 { received: true, duplicate: true }` without touching profiles.
 */

/** Per-IP budget: Stripe retries are sparse; 120/min is far above any legitimate burst. */
const WEBHOOK_LIMIT = { limit: 120, windowMs: 60_000 } as const;
/** Real events are a few KB; refuse anything absurd before hashing it. */
const MAX_BODY_BYTES = 1_000_000;
const SIGNATURE_HEADER = "stripe-signature";

/* ------------------------------------------------------------------------- */
/* Event schema + pure mapping                                                */
/* ------------------------------------------------------------------------- */

const EventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(200),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

export type BillingEvent = z.infer<typeof EventSchema>;

/** Columns on `public.profiles` touched by the webhook (supabase/migrations/20260917020000_accounts_billing.sql). */
export const PROFILE_COLUMNS = {
  id: "user_id",
  planId: "plan_id",
  customerId: "billing_customer_id",
  subscriptionId: "billing_subscription_id",
  status: "billing_status",
  periodEnd: "current_period_end",
} as const;

export type ProfilePatch = Partial<Record<(typeof PROFILE_COLUMNS)[keyof typeof PROFILE_COLUMNS], string | null>>;

export type MappedEvent =
  | { kind: "ignored"; reason: string }
  | { kind: "update"; match: { column: string; value: string }; patch: ProfilePatch };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Stripe fields that are either an id string or an expanded `{ id }` object. */
function idOf(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (v && typeof v === "object") return str((v as { id?: unknown }).id);
  return null;
}

function metadataOf(obj: Record<string, unknown>): Record<string, unknown> {
  const m = obj.metadata;
  return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
}

/** First `price.id` under `line_items.data[]` / `items.data[]`. */
function firstPriceId(obj: Record<string, unknown>): string | null {
  for (const key of ["line_items", "items"]) {
    const list = obj[key];
    const data = list && typeof list === "object" ? (list as { data?: unknown }).data : undefined;
    if (!Array.isArray(data)) continue;
    for (const item of data) {
      const price = item && typeof item === "object" ? (item as { price?: unknown }).price : undefined;
      const id = idOf(price);
      if (id) return id;
    }
  }
  return null;
}

/** `current_period_end` (unix seconds) on the object, or on the first subscription item (newer API). */
function periodEndIso(obj: Record<string, unknown>): string | null {
  let secs: unknown = obj.current_period_end;
  if (typeof secs !== "number") {
    const items = obj.items && typeof obj.items === "object" ? (obj.items as { data?: unknown }).data : undefined;
    const first = Array.isArray(items) ? items[0] : undefined;
    secs = first && typeof first === "object" ? (first as { current_period_end?: unknown }).current_period_end : undefined;
  }
  if (typeof secs !== "number" || !Number.isFinite(secs) || secs <= 0) return null;
  return new Date(secs * 1000).toISOString();
}

/** Plan id from `metadata.plan_id`, else the price map lookup of the first line item's price. */
function planIdOf(obj: Record<string, unknown>, priceMap: BillingPriceMap): string | null {
  const fromMeta = str(metadataOf(obj).plan_id);
  if (fromMeta) return fromMeta;
  const priceId = firstPriceId(obj) ?? str(metadataOf(obj).price_id);
  return priceId ? (priceMap[priceId] ?? null) : null;
}

/**
 * Pure: provider event -> what to change on which profile. No I/O.
 *
 *  - checkout.session.completed   `client_reference_id` (our user id) gets the plan,
 *                                 customer + subscription ids and status "active".
 *  - customer.subscription.updated matched by subscription id: status, period end,
 *                                 and the plan when the price is in BILLING_PRICE_MAP.
 *  - customer.subscription.deleted matched by subscription id: plan "free", status "canceled".
 *  - anything else                ignored.
 */
export function mapBillingEvent(event: BillingEvent, priceMap: BillingPriceMap): MappedEvent {
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      const userId = str(obj.client_reference_id) ?? str(metadataOf(obj).user_id);
      if (!userId) return { kind: "ignored", reason: "no client_reference_id" };
      if (!UUID_RE.test(userId)) return { kind: "ignored", reason: "client_reference_id is not a user id" };
      const planId = planIdOf(obj, priceMap);
      if (!planId) return { kind: "ignored", reason: "no plan_id in metadata and price not in BILLING_PRICE_MAP" };
      return {
        kind: "update",
        match: { column: PROFILE_COLUMNS.id, value: userId },
        patch: {
          [PROFILE_COLUMNS.planId]: planId,
          [PROFILE_COLUMNS.customerId]: idOf(obj.customer),
          [PROFILE_COLUMNS.subscriptionId]: idOf(obj.subscription),
          [PROFILE_COLUMNS.status]: "active",
        },
      };
    }

    case "customer.subscription.updated": {
      const subscriptionId = str(obj.id);
      if (!subscriptionId) return { kind: "ignored", reason: "subscription has no id" };
      const patch: ProfilePatch = {};
      const planId = planIdOf(obj, priceMap);
      if (planId) patch[PROFILE_COLUMNS.planId] = planId;
      const status = str(obj.status);
      if (status) patch[PROFILE_COLUMNS.status] = status;
      const periodEnd = periodEndIso(obj);
      if (periodEnd) patch[PROFILE_COLUMNS.periodEnd] = periodEnd;
      const customerId = idOf(obj.customer);
      if (customerId) patch[PROFILE_COLUMNS.customerId] = customerId;
      if (Object.keys(patch).length === 0) return { kind: "ignored", reason: "nothing to update" };
      return { kind: "update", match: { column: PROFILE_COLUMNS.subscriptionId, value: subscriptionId }, patch };
    }

    case "customer.subscription.deleted": {
      const subscriptionId = str(obj.id);
      if (!subscriptionId) return { kind: "ignored", reason: "subscription has no id" };
      const periodEnd = periodEndIso(obj);
      return {
        kind: "update",
        match: { column: PROFILE_COLUMNS.subscriptionId, value: subscriptionId },
        patch: {
          [PROFILE_COLUMNS.planId]: "free",
          [PROFILE_COLUMNS.status]: "canceled",
          ...(periodEnd ? { [PROFILE_COLUMNS.periodEnd]: periodEnd } : {}),
        },
      };
    }

    default:
      return { kind: "ignored", reason: `unhandled event type ${event.type}` };
  }
}

/* ------------------------------------------------------------------------- */
/* Persistence (service role) behind a small interface so tests can fake it   */
/* ------------------------------------------------------------------------- */

export type BillingStore = {
  /** Insert the event id; "duplicate" when it was already recorded. */
  recordEvent(event: BillingEvent): Promise<{ status: "inserted" | "duplicate" } | { status: "error"; message: string }>;
  /** Undo `recordEvent` so a failed update can be retried by the provider. */
  forgetEvent(eventId: string): Promise<void>;
  /** Apply `patch` to the profiles matching `match`; returns how many rows changed. */
  updateProfile(match: { column: string; value: string }, patch: ProfilePatch): Promise<{ count: number } | { error: string }>;
};

const UNIQUE_VIOLATION = "23505";

export function supabaseBillingStore(url: string, serviceRoleKey: string): BillingStore {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async recordEvent(event) {
      const { error } = await client.from("billing_events").insert({ id: event.id, type: event.type, payload: event });
      if (!error) return { status: "inserted" };
      if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
      return { status: "error", message: error.message };
    },
    async forgetEvent(eventId) {
      await client.from("billing_events").delete().eq("id", eventId);
    },
    async updateProfile(match, patch) {
      const { data, error } = await client.from("profiles").update(patch).eq(match.column, match.value).select(PROFILE_COLUMNS.id);
      if (error) return { error: error.message };
      return { count: Array.isArray(data) ? data.length : 0 };
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Handler                                                                    */
/* ------------------------------------------------------------------------- */

export type WebhookEnv = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  STRIPE_WEBHOOK_SECRET?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  BILLING_PRICE_MAP?: string;
};

export type WebhookDeps = {
  getEnv: () => WebhookEnv;
  createStore: (url: string, serviceRoleKey: string) => BillingStore;
  /** Unix seconds (signature tolerance). */
  now: () => number;
};

const defaultDeps: WebhookDeps = {
  getEnv: () => getServerEnv(),
  createStore: supabaseBillingStore,
  now: () => Math.floor(Date.now() / 1000),
};

/** First hop of `x-forwarded-for` (Vercel sets it), else `x-real-ip`, else "unknown". */
function clientIp(req: Request): string {
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || "unknown";
}

const log = billingLogger.child({ route: "billing/webhook" });

/** Build the POST handler; `deps` are only overridden by tests. */
export function createWebhookHandler(deps: WebhookDeps = defaultDeps): (req: Request) => Promise<Response> {
  return async function handleWebhook(req: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const rl = checkRateLimit(`ip:${clientIp(req)}:billingWebhook`, WEBHOOK_LIMIT);
    if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

    let env: WebhookEnv;
    try {
      env = deps.getEnv();
    } catch (err) {
      log.error({ requestId, error: err instanceof Error ? err.message : String(err) }, "server env invalid");
      return json(500, "internal_error", "Server is not configured.");
    }
    if (!env.STRIPE_WEBHOOK_SECRET || !env.SUPABASE_SERVICE_ROLE_KEY) {
      log.warn({ requestId }, "webhook called but STRIPE_WEBHOOK_SECRET / SUPABASE_SERVICE_ROLE_KEY are not set");
      return json(503, "feature_unavailable", "Billing webhooks are not configured on this deployment.");
    }
    const priceMap = parseBillingPriceMap(env.BILLING_PRICE_MAP);
    if ("error" in priceMap) {
      log.error({ requestId, error: priceMap.error }, "BILLING_PRICE_MAP invalid");
      return json(503, "feature_unavailable", priceMap.error);
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) return json(400, "invalid_request", "Payload too large.");

    const verified = await verifyStripeSignature({
      header: req.headers.get(SIGNATURE_HEADER),
      rawBody,
      secret: env.STRIPE_WEBHOOK_SECRET,
      now: deps.now(),
    });
    if (!verified) {
      log.warn({ requestId, ip: clientIp(req) }, "bad webhook signature");
      return json(400, "invalid_request", "bad signature");
    }

    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      return json(400, "invalid_request", "Request body must be valid JSON.");
    }
    const parsed = EventSchema.safeParse(raw);
    if (!parsed.success) return json(400, "invalid_request", "Unrecognised event shape.");
    const event = parsed.data;
    const eventLog = log.child({ requestId, eventId: event.id, eventType: event.type });
    // The full payload only at debug: it carries customer emails and addresses.
    eventLog.debug({ payload: rawBody.slice(0, 4000) }, "webhook payload");

    const store = deps.createStore(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    const recorded = await store.recordEvent(event);
    if (recorded.status === "duplicate") {
      eventLog.info("duplicate event");
      return Response.json({ received: true, duplicate: true });
    }
    if (recorded.status === "error") {
      eventLog.error({ error: recorded.message }, "billing_events insert failed; is the billing migration applied?");
      return json(503, "feature_unavailable", "Billing is not set up on this deployment — run the migrations.");
    }

    const mapped = mapBillingEvent(event, priceMap.map);
    if (mapped.kind === "ignored") {
      eventLog.info({ reason: mapped.reason }, "event ignored");
      return Response.json({ received: true, ignored: true });
    }

    const result = await store.updateProfile(mapped.match, mapped.patch);
    if ("error" in result) {
      eventLog.error({ error: result.error }, "profile update failed");
      await store.forgetEvent(event.id).catch(() => undefined); // let the provider's retry reprocess it
      return json(500, "internal_error", "Could not apply the billing update.");
    }
    if (result.count === 0) {
      eventLog.warn({ matchColumn: mapped.match.column }, "no profile matched the event");
      return Response.json({ received: true, ignored: true });
    }

    eventLog.info({ matchColumn: mapped.match.column, fields: Object.keys(mapped.patch) }, "profile updated");
    return Response.json({ received: true });
  };
}

export const POST = createWebhookHandler();
