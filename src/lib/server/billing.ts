import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { billingEnforced, getBillingLinks, getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { json } from "@/lib/server/auth";

/**
 * Credit metering for the paid API routes.
 *
 * Credits are the unit. Each user has a plan with `monthly_credits`; the balance for
 * the current calendar month is `plan.monthly_credits + credit_grants − usage_events`.
 * Consumption runs AS THE USER: `consumeCredits` calls the SECURITY DEFINER RPC
 * `consume_credits(...)` with the caller's own JWT, so a user can only ever spend
 * their own credits and nothing here can add credits. Plan changes happen only via
 * the billing webhook (service role) or SQL.
 *
 * Placement in a route: after auth + rate limit + body validation and BEFORE the
 * upstream provider call. Charging up-front is the simple, documented choice for
 * now; refunding a failed upstream call is a follow-up.
 */

export const billingLogger = logger.child({ module: "billing" });

/** Credits charged per request, keyed by route path relative to /api/. */
export const ROUTE_COSTS = {
  "live/recognize": 1,
  "live/check": 3,
  "live/solve": 10,
  "generate-solution": 25,
  "generate-worksheet": 20,
  "voice/analyze-workspace": 3,
  ocr: 2,
  "check-help-needed": 2,
  credits: 0,
  "config/status": 0,
  "voice/token": 0,
} as const satisfies Record<string, number>;

export type BillableRoute = keyof typeof ROUTE_COSTS;

export type ConsumeResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "insufficient_credits"; remaining: number }
  | { ok: false; reason: "unavailable"; message: string };

export type ConsumeInput = {
  /** The caller's verified Supabase access token (from `requireUser`). */
  token: string;
  route: BillableRoute;
  requestId: string;
  /** Provider model id (informational; recorded on the usage event). */
  model?: string | null;
};

/** The subset of a Supabase client `consumeCredits` needs (lets tests pass a fake). */
export type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError | null }>;
};

export type RpcError = { message: string; code?: string | null; details?: string | null; hint?: string | null };

/**
 * The SECURITY DEFINER function from supabase/migrations/20260917020000_accounts_billing.sql:
 * `consume_credits(p_route text, p_units int, p_request_id text, p_model text) returns jsonb`
 * -> `{ ok: boolean, remaining: int, reason: 'insufficient_credits' | null }`.
 */
export const CONSUME_CREDITS_RPC = "consume_credits";

/**
 * A supabase-js client that acts as the user: anon key + `Authorization: Bearer <token>`,
 * no session persistence. RLS and `auth.uid()` see the caller, never the service role.
 */
export function userClient(token: string): SupabaseClient {
  const env = getServerEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const MISSING_FUNCTION_RE = /could not find the function|function .* does not exist|schema cache/i;
const INSUFFICIENT_RE = /insufficient_credits|insufficient credits|credits_exhausted/i;

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Normalise the RPC payload. The function may return a single row (object), a
 * one-row set (array) or jsonb; we accept `{ ok | allowed, remaining }`.
 * Exported for tests.
 */
export function normalizeConsumeResult(data: unknown): ConsumeResult {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return { ok: false, reason: "unavailable", message: "consume_credits returned no row." };
  }
  const r = row as Record<string, unknown>;
  const okField = typeof r.ok === "boolean" ? r.ok : typeof r.allowed === "boolean" ? r.allowed : null;
  const remaining = asNumber(r.remaining);
  if (okField === null || remaining === null) {
    return { ok: false, reason: "unavailable", message: "consume_credits returned an unexpected shape." };
  }
  if (okField) return { ok: true, remaining: Math.max(0, remaining) };
  return { ok: false, reason: "insufficient_credits", remaining: Math.max(0, remaining) };
}

/** Map a PostgREST/Postgres error to a ConsumeResult. Exported for tests. */
export function consumeErrorToResult(error: RpcError): ConsumeResult {
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  if (error.code === "42883" || error.code === "PGRST202" || MISSING_FUNCTION_RE.test(text)) {
    return { ok: false, reason: "unavailable", message: "consume_credits RPC is missing (run the migrations)." };
  }
  if (INSUFFICIENT_RE.test(text)) {
    // A function that raises instead of returning ok=false may put the balance in details/hint.
    const remaining = asNumber(error.details) ?? asNumber(error.hint) ?? 0;
    return { ok: false, reason: "insufficient_credits", remaining: Math.max(0, remaining) };
  }
  return { ok: false, reason: "unavailable", message: `consume_credits failed: ${error.message}` };
}

/**
 * Charge `ROUTE_COSTS[route]` credits to the calling user via the RPC.
 * Never throws. A zero-cost route short-circuits without touching the database.
 */
export async function consumeCredits(input: ConsumeInput, client?: RpcClient): Promise<ConsumeResult> {
  const cost = ROUTE_COSTS[input.route];
  if (cost === 0) return { ok: true, remaining: Number.POSITIVE_INFINITY };

  try {
    const rpcClient = client ?? userClient(input.token);
    const { data, error } = await rpcClient.rpc(CONSUME_CREDITS_RPC, {
      p_route: input.route,
      p_units: cost,
      p_request_id: input.requestId,
      p_model: input.model ?? null,
    });
    if (error) return consumeErrorToResult(error);
    return normalizeConsumeResult(data);
  } catch (err) {
    return {
      ok: false,
      reason: "unavailable",
      message: `consume_credits threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/* ------------------------------------------------------------------------- */
/* Responses                                                                  */
/* ------------------------------------------------------------------------- */

export const CREDITS_EXHAUSTED_MESSAGE = "You have used this month's credits. Upgrade your plan or wait until they reset.";
export const BILLING_UNAVAILABLE_MESSAGE = "Billing is not set up on this deployment — run the migrations.";

/** Where the 402 sends the user: the billing portal when configured, else the in-app account page. */
export function upgradeUrl(): string {
  try {
    return getBillingLinks().portal ?? "/account";
  } catch {
    return "/account";
  }
}

/** 402 following the shared error contract, with additive `remaining` / `upgradeUrl` / `periodEnd`. */
export function creditsExhaustedResponse(remaining: number, periodEnd?: string): Response {
  return json(402, "credits_exhausted", CREDITS_EXHAUSTED_MESSAGE, {
    remaining: Math.max(0, remaining),
    upgradeUrl: upgradeUrl(),
    ...(periodEnd ? { periodEnd } : {}),
  });
}

/** 503 when metering is enforced but the database has no billing schema / the RPC failed. */
export function billingUnavailableResponse(): Response {
  return json(503, "feature_unavailable", BILLING_UNAVAILABLE_MESSAGE);
}

export { billingEnforced };

let warnedNotEnforced = false;

/** Tests only. */
export function resetBillingWarnings(): void {
  warnedNotEnforced = false;
}

export type EnforceResult = { response: Response } | { remaining: number | null };

/**
 * One call for route handlers: charge the route's credits, or produce the response
 * that ends the request.
 *
 *  - `BILLING_ENFORCE=0`: skip the database entirely (logged once per process).
 *  - insufficient credits: `402 credits_exhausted`.
 *  - RPC missing / DB error while enforced: fail closed with `503 feature_unavailable`.
 */
export async function enforceCredits(
  input: ConsumeInput,
  log: { warn: (obj: object, msg: string) => void; info?: (obj: object, msg: string) => void } = billingLogger,
  client?: RpcClient,
): Promise<EnforceResult> {
  if (!billingEnforced()) {
    if (!warnedNotEnforced) {
      warnedNotEnforced = true;
      billingLogger.warn({ route: input.route }, "BILLING_ENFORCE=0: credit consumption is skipped on this deployment");
    }
    return { remaining: null };
  }

  const result = await consumeCredits(input, client);
  if (result.ok) return { remaining: result.remaining };

  if (result.reason === "insufficient_credits") {
    log.warn({ route: input.route, remaining: result.remaining, cost: ROUTE_COSTS[input.route] }, "credits exhausted");
    return { response: creditsExhaustedResponse(result.remaining) };
  }

  log.warn({ route: input.route, error: result.message }, "billing unavailable; failing closed");
  return { response: billingUnavailableResponse() };
}
