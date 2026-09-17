import { beforeEach, describe, expect, it, vi } from "vitest";

// The handler logs every rejected signature at warn; keep the 120-request rate-limit test quiet.
vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});
import {
  PROFILE_COLUMNS,
  createWebhookHandler,
  mapBillingEvent,
  type BillingEvent,
  type BillingStore,
  type ProfilePatch,
  type WebhookDeps,
  type WebhookEnv,
} from "@/app/api/billing/webhook/route";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { signStripePayload } from "@/lib/server/webhookSignature";

const USER_ID = "8d2a3f1e-4b6c-4d7e-9f01-23456789abcd";
const SECRET = "whsec_unit";
const NOW = 1_760_000_000;
const PRICE_MAP = { price_plus: "plus", price_pro: "pro" };

function event(type: string, object: Record<string, unknown>, id = "evt_1"): BillingEvent {
  return { id, type, data: { object } };
}

describe("mapBillingEvent", () => {
  it("checkout.session.completed sets the plan from metadata.plan_id on the referenced user", () => {
    const mapped = mapBillingEvent(
      event("checkout.session.completed", {
        client_reference_id: USER_ID,
        customer: "cus_1",
        subscription: "sub_1",
        metadata: { plan_id: "pro" },
      }),
      {},
    );
    expect(mapped).toEqual({
      kind: "update",
      match: { column: "user_id", value: USER_ID },
      patch: { plan_id: "pro", billing_customer_id: "cus_1", billing_subscription_id: "sub_1", billing_status: "active" },
    });
  });

  it("checkout.session.completed falls back to BILLING_PRICE_MAP for the line item price (string or expanded)", () => {
    const viaString = mapBillingEvent(
      event("checkout.session.completed", { client_reference_id: USER_ID, customer: { id: "cus_x" }, line_items: { data: [{ price: "price_plus" }] } }),
      PRICE_MAP,
    );
    expect(viaString).toMatchObject({ kind: "update", patch: { plan_id: "plus", billing_customer_id: "cus_x", billing_subscription_id: null } });

    const viaObject = mapBillingEvent(
      event("checkout.session.completed", { client_reference_id: USER_ID, line_items: { data: [{ price: { id: "price_pro" } }] } }),
      PRICE_MAP,
    );
    expect(viaObject).toMatchObject({ kind: "update", patch: { plan_id: "pro" } });
  });

  it("checkout.session.completed is ignored without a user id, with a non-uuid id, or without a resolvable plan", () => {
    expect(mapBillingEvent(event("checkout.session.completed", { metadata: { plan_id: "plus" } }), {})).toMatchObject({ kind: "ignored", reason: /client_reference_id/ });
    expect(mapBillingEvent(event("checkout.session.completed", { client_reference_id: "not-a-uuid", metadata: { plan_id: "plus" } }), {})).toMatchObject({
      kind: "ignored",
      reason: /not a user id/,
    });
    expect(mapBillingEvent(event("checkout.session.completed", { client_reference_id: USER_ID, line_items: { data: [{ price: "price_unknown" }] } }), PRICE_MAP)).toMatchObject({
      kind: "ignored",
      reason: /BILLING_PRICE_MAP/,
    });
  });

  it("customer.subscription.updated maps status, period end and plan by price id, matched on the subscription", () => {
    const mapped = mapBillingEvent(
      event("customer.subscription.updated", {
        id: "sub_9",
        status: "past_due",
        customer: "cus_9",
        current_period_end: 1_761_000_000,
        items: { data: [{ price: { id: "price_pro" } }] },
      }),
      PRICE_MAP,
    );
    expect(mapped).toEqual({
      kind: "update",
      match: { column: "billing_subscription_id", value: "sub_9" },
      patch: {
        plan_id: "pro",
        billing_status: "past_due",
        current_period_end: new Date(1_761_000_000 * 1000).toISOString(),
        billing_customer_id: "cus_9",
      },
    });
  });

  it("customer.subscription.updated keeps the plan when the price is unknown and reads the item-level period end", () => {
    const mapped = mapBillingEvent(
      event("customer.subscription.updated", { id: "sub_9", status: "active", items: { data: [{ price: "price_mystery", current_period_end: 1_762_000_000 }] } }),
      PRICE_MAP,
    );
    expect(mapped).toMatchObject({ kind: "update", patch: { billing_status: "active", current_period_end: new Date(1_762_000_000 * 1000).toISOString() } });
    expect((mapped as { patch: ProfilePatch }).patch).not.toHaveProperty("plan_id");
  });

  it("customer.subscription.deleted reverts to free / canceled", () => {
    expect(mapBillingEvent(event("customer.subscription.deleted", { id: "sub_9", current_period_end: 1_761_000_000 }), {})).toEqual({
      kind: "update",
      match: { column: "billing_subscription_id", value: "sub_9" },
      patch: { plan_id: "free", billing_status: "canceled", current_period_end: new Date(1_761_000_000 * 1000).toISOString() },
    });
    expect(mapBillingEvent(event("customer.subscription.deleted", {}), {})).toMatchObject({ kind: "ignored" });
  });

  it("ignores unknown event types", () => {
    expect(mapBillingEvent(event("invoice.paid", { id: "in_1" }), {})).toMatchObject({ kind: "ignored", reason: /invoice\.paid/ });
  });

  it("only ever writes the documented profile columns", () => {
    const allowed = new Set<string>(Object.values(PROFILE_COLUMNS));
    const samples = [
      mapBillingEvent(event("checkout.session.completed", { client_reference_id: USER_ID, metadata: { plan_id: "plus" } }), {}),
      mapBillingEvent(event("customer.subscription.updated", { id: "s", status: "active" }), {}),
      mapBillingEvent(event("customer.subscription.deleted", { id: "s" }), {}),
    ];
    for (const s of samples) {
      expect(s.kind).toBe("update");
      for (const key of Object.keys((s as { patch: ProfilePatch }).patch)) expect(allowed.has(key), key).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------------- */
/* Handler with fakes                                                         */
/* ------------------------------------------------------------------------- */

type StoreLog = { recorded: string[]; forgotten: string[]; updates: Array<{ match: { column: string; value: string }; patch: ProfilePatch }> };

function fakeStore(opts: { duplicates?: string[]; recordError?: string; updateError?: string; updateCount?: number } = {}): BillingStore & { log: StoreLog } {
  const log: StoreLog = { recorded: [], forgotten: [], updates: [] };
  return {
    log,
    async recordEvent(ev) {
      if (opts.recordError) return { status: "error", message: opts.recordError };
      if (opts.duplicates?.includes(ev.id) || log.recorded.includes(ev.id)) return { status: "duplicate" };
      log.recorded.push(ev.id);
      return { status: "inserted" };
    },
    async forgetEvent(id) {
      log.forgotten.push(id);
    },
    async updateProfile(match, patch) {
      if (opts.updateError) return { error: opts.updateError };
      log.updates.push({ match, patch });
      return { count: opts.updateCount ?? 1 };
    },
  };
}

const fullEnv: WebhookEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  STRIPE_WEBHOOK_SECRET: SECRET,
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  BILLING_PRICE_MAP: JSON.stringify(PRICE_MAP),
};

function handlerWith(store: BillingStore, env: Partial<WebhookEnv> = {}): (req: Request) => Promise<Response> {
  const deps: WebhookDeps = { getEnv: () => ({ ...fullEnv, ...env }), createStore: () => store, now: () => NOW };
  return createWebhookHandler(deps);
}

async function signedRequest(body: string, opts: { secret?: string; t?: number; header?: string | null; ip?: string } = {}): Promise<Request> {
  const header = opts.header === undefined ? await signStripePayload(body, opts.secret ?? SECRET, opts.t ?? NOW) : opts.header;
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? "203.0.113.9" };
  if (header) headers["stripe-signature"] = header;
  return new Request("http://localhost/api/billing/webhook", { method: "POST", headers, body });
}

const checkoutBody = JSON.stringify(
  event("checkout.session.completed", { client_reference_id: USER_ID, customer: "cus_1", subscription: "sub_1", metadata: { plan_id: "plus" } }, "evt_checkout"),
);

describe("POST /api/billing/webhook", () => {
  beforeEach(() => resetRateLimits());

  it("applies a signed checkout.session.completed to the user's profile", async () => {
    const store = fakeStore();
    const res = await handlerWith(store)(await signedRequest(checkoutBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(store.log.recorded).toEqual(["evt_checkout"]);
    expect(store.log.updates).toEqual([
      {
        match: { column: "user_id", value: USER_ID },
        patch: { plan_id: "plus", billing_customer_id: "cus_1", billing_subscription_id: "sub_1", billing_status: "active" },
      },
    ]);
  });

  it("answers 400 invalid_request 'bad signature' for a missing, wrong-secret, tampered or stale signature", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    for (const req of [
      await signedRequest(checkoutBody, { header: null }),
      await signedRequest(checkoutBody, { secret: "whsec_other" }),
      await signedRequest(checkoutBody, { t: NOW - 3600 }),
      await signedRequest(checkoutBody + " ", { header: await signStripePayload(checkoutBody, SECRET, NOW) }),
    ]) {
      const res = await handler(req);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request", message: "bad signature" });
    }
    expect(store.log.recorded).toEqual([]);
    expect(store.log.updates).toEqual([]);
  });

  it("answers 503 feature_unavailable when the webhook secret or the service role key is missing", async () => {
    const store = fakeStore();
    for (const env of [{ STRIPE_WEBHOOK_SECRET: undefined }, { SUPABASE_SERVICE_ROLE_KEY: undefined }]) {
      const res = await handlerWith(store, env)(await signedRequest(checkoutBody));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: "feature_unavailable" });
    }
    expect(store.log.recorded).toEqual([]);
  });

  it("answers 503 when BILLING_PRICE_MAP is malformed", async () => {
    const res = await handlerWith(fakeStore(), { BILLING_PRICE_MAP: "{not json" })(await signedRequest(checkoutBody));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "feature_unavailable", message: /BILLING_PRICE_MAP/ });
  });

  it("answers 200 duplicate for an event id already recorded and does not touch profiles", async () => {
    const store = fakeStore();
    const handler = handlerWith(store);
    expect((await handler(await signedRequest(checkoutBody))).status).toBe(200);
    const again = await handler(await signedRequest(checkoutBody));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(store.log.updates).toHaveLength(1);
  });

  it("answers 200 ignored for unknown event types (after recording them)", async () => {
    const store = fakeStore();
    const body = JSON.stringify(event("invoice.paid", { id: "in_1" }, "evt_inv"));
    const res = await handlerWith(store)(await signedRequest(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
    expect(store.log.recorded).toEqual(["evt_inv"]);
    expect(store.log.updates).toEqual([]);
  });

  it("answers 200 ignored when no profile matches", async () => {
    const store = fakeStore({ updateCount: 0 });
    const body = JSON.stringify(event("customer.subscription.deleted", { id: "sub_gone" }, "evt_del"));
    const res = await handlerWith(store)(await signedRequest(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, ignored: true });
  });

  it("answers 400 for a signed body that is not JSON or not an event", async () => {
    const handler = handlerWith(fakeStore());
    const notJson = await handler(await signedRequest("hello"));
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ error: "invalid_request" });
    const notEvent = await handler(await signedRequest(JSON.stringify({ id: "evt_x" })));
    expect(notEvent.status).toBe(400);
  });

  it("answers 503 when billing_events cannot be written (migration missing)", async () => {
    const res = await handlerWith(fakeStore({ recordError: 'relation "billing_events" does not exist' }))(await signedRequest(checkoutBody));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "feature_unavailable" });
  });

  it("answers 500 and forgets the event id when the profile update fails, so the provider retry can reprocess it", async () => {
    const store = fakeStore({ updateError: "connection reset" });
    const res = await handlerWith(store)(await signedRequest(checkoutBody));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "internal_error" });
    expect(store.log.forgotten).toEqual(["evt_checkout"]);
  });

  it("rate limits per IP at 120/min with a Retry-After header", async () => {
    const handler = handlerWith(fakeStore());
    for (let i = 0; i < 120; i++) {
      const res = await handler(await signedRequest(checkoutBody, { header: null, ip: "198.51.100.44" }));
      expect(res.status).toBe(400);
    }
    const limited = await handler(await signedRequest(checkoutBody, { header: null, ip: "198.51.100.44" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await handler(await signedRequest(checkoutBody, { header: null, ip: "198.51.100.45" }))).status).toBe(400);
  });
});
