import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { billingEnforced, getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { json } from "@/lib/server/auth";

/**
 * Ink metering for the paid API routes.
 *
 * Ink is the unit (1 ink = 1 of the old monthly credits). It never expires: a student gets
 * 300 starter ink once, buys more in packs, and every AI action below spends some; drawing on
 * your own is free. The balance is all ink granted minus all ink used, stored on the profile
 * (supabase/migrations/20261002000000_ink.sql). Consumption runs AS THE USER: `consumeInk`
 * calls the SECURITY DEFINER RPC `consume_credits(...)` (its name predates ink) with the
 * caller's own JWT, so a user can only ever spend their own ink and nothing here can add
 * any. Ink comes in only through the billing webhook (service role) or SQL.
 *
 * Placement in a route: after auth + rate limit + body validation and BEFORE the
 * upstream provider call. Charging up-front keeps the check atomic; when the paid
 * work then fails, `refundInk` (RPC `refund_credits`) gives the charge back:
 *   - non-streaming routes run their provider call inside `runCharged`, which refunds
 *     whenever the response handed to the client is not a 2xx;
 *   - the SSE routes (live/check, live/solve) refund only when the stream fails before
 *     the first annotation/step was emitted (see `runChargedStream` in live-route.ts).
 * The refund uses the SAME requestId the charge used; the RPC only touches the
 * caller's own usage_events rows younger than 15 minutes.
 */

export const billingLogger = logger.child({ module: "billing" });

/** Ink charged per request, keyed by route path relative to /api/. */
export const ROUTE_COSTS = {
  "live/recognize": 1,
  "live/check": 3,
  "live/solve": 10,
  // A word problem's setup (the model writes the equations, the engine solves them): below solve.
  "live/setup": 2,
  // The second reader for a suspicious read: one line read again, priced like recognize.
  "live/reread": 1,
  // A proof's figure read, or one next row when the engine's planner cannot finish: priced like setup.
  "live/proof": 2,
  // The board chat: one planning call (problems, a graph, a figure spec), plus at most one small
  // figure repair; the engine checks every problem, so no solve model is involved.
  "live/chat": 3,
  // Lecture mode: one MINUTE of the director (recent transcript → what to sketch or update). The
  // route charges the first request of each wall-clock minute of a session and none of the rest
  // (it asks every ~8 s while numbers are coming): 2 ink a minute while someone is talking,
  // which covers the director and the realtime recognizer (~$0.39 an hour) at pack prices.
  "live/lecture": 2,
  // Lecture mode's free drawing: one panel drawn by the illustrator (a picture, or one panel of a
  // comic strip) — a larger model writing a few thousand tokens of vectors, priced above a tick.
  "live/sketch": 4,
  // Lecture mode: one realtime speech-to-text session opened (a single-use recognizer token).
  "live/listen": 1,
  // The operator's OpenRouter balance (GET /api/credits): free, and not about the student's ink.
  credits: 0,
  "config/status": 0,
} as const satisfies Record<string, number>;

export type BillableRoute = keyof typeof ROUTE_COSTS;

export type ConsumeResult =
  | { ok: true; remaining: number }
  | { ok: false; reason: "insufficient_ink"; remaining: number }
  | { ok: false; reason: "unavailable"; message: string };

export type ConsumeInput = {
  /** The caller's verified Supabase access token (from `requireUser`). */
  token: string;
  route: BillableRoute;
  requestId: string;
  /** Provider model id (informational; recorded on the usage event). */
  model?: string | null;
};

/** The subset of a Supabase client `consumeInk` needs (lets tests pass a fake). */
export type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError | null }>;
};

export type RpcError = { message: string; code?: string | null; details?: string | null; hint?: string | null };

/**
 * The SECURITY DEFINER function (supabase/migrations/20261002000000_ink.sql; its name and its
 * reason string are from the monthly-credit days):
 * `consume_credits(p_route text, p_units int, p_request_id text, p_model text) returns jsonb`
 * -> `{ ok: boolean, remaining: int, reason: 'insufficient_credits' | null }`, remaining = ink left.
 */
export const CONSUME_INK_RPC = "consume_credits";

/**
 * The SECURITY DEFINER function (20260917030000_refunds_ratelimit.sql, pointed at the ink
 * balance by 20261002000000_ink.sql):
 * `refund_credits(p_request_id text) returns jsonb` -> `{ refunded: int, remaining: int }`.
 */
export const REFUND_INK_RPC = "refund_credits";

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
const INSUFFICIENT_RE = /insufficient_credits|insufficient credits|insufficient ink|ink_empty/i;

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
  return { ok: false, reason: "insufficient_ink", remaining: Math.max(0, remaining) };
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
    return { ok: false, reason: "insufficient_ink", remaining: Math.max(0, remaining) };
  }
  return { ok: false, reason: "unavailable", message: `consume_credits failed: ${error.message}` };
}

/**
 * Charge `ROUTE_COSTS[route]` ink to the calling user via the RPC.
 * Never throws. A zero-cost route short-circuits without touching the database.
 */
export async function consumeInk(input: ConsumeInput, client?: RpcClient): Promise<ConsumeResult> {
  const cost = ROUTE_COSTS[input.route];
  if (cost === 0) return { ok: true, remaining: Number.POSITIVE_INFINITY };

  try {
    const rpcClient = client ?? userClient(input.token);
    const { data, error } = await rpcClient.rpc(CONSUME_INK_RPC, {
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
/* Refunds                                                                    */
/* ------------------------------------------------------------------------- */

export type RefundInput = {
  /** The caller's verified Supabase access token (from `requireUser`). */
  token: string;
  /** Must be the very requestId that was passed to `consumeInk` / `enforceInk`. */
  requestId: string;
};

export type RefundResult =
  | { refunded: number; remaining: number }
  | { refunded: 0; reason: string };

/** Minimal logger surface the billing helpers need (pino child loggers satisfy it). */
export type BillingLog = {
  warn: (obj: object, msg: string) => void;
  info?: (obj: object, msg: string) => void;
};

/** Normalise the `refund_credits` payload (object, one-row set or jsonb). Exported for tests. */
export function normalizeRefundResult(data: unknown): RefundResult {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return { refunded: 0, reason: "refund_credits returned no row." };
  const r = row as Record<string, unknown>;
  const refunded = asNumber(r.refunded);
  const remaining = asNumber(r.remaining);
  if (refunded === null || remaining === null) return { refunded: 0, reason: "refund_credits returned an unexpected shape." };
  return { refunded: Math.max(0, refunded), remaining: Math.max(0, remaining) };
}

/**
 * Give back what `consumeInk` charged for `requestId`. Never throws; a refund that
 * cannot happen is logged and reported as `{ refunded: 0, reason }` so the route can
 * still answer the client. With `BILLING_ENFORCE=0` nothing was charged, so nothing
 * is refunded and the database is not touched.
 */
export async function refundInk(input: RefundInput, log: BillingLog = billingLogger, client?: RpcClient): Promise<RefundResult> {
  if (!billingEnforced()) return { refunded: 0, reason: "not_enforced" };

  let result: RefundResult;
  try {
    const rpcClient = client ?? userClient(input.token);
    const { data, error } = await rpcClient.rpc(REFUND_INK_RPC, { p_request_id: input.requestId });
    if (error) {
      const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
      result =
        error.code === "42883" || error.code === "PGRST202" || MISSING_FUNCTION_RE.test(text)
          ? { refunded: 0, reason: "refund_credits RPC is missing (run the migrations)." }
          : { refunded: 0, reason: `refund_credits failed: ${error.message}` };
    } else {
      result = normalizeRefundResult(data);
    }
  } catch (err) {
    result = { refunded: 0, reason: `refund_credits threw: ${err instanceof Error ? err.message : String(err)}` };
  }

  if ("reason" in result) {
    log.warn({ requestId: input.requestId, error: result.reason }, "ink refund failed");
  } else {
    log.info?.({ requestId: input.requestId, refunded: result.refunded, remaining: result.remaining }, "ink refunded");
  }
  return result;
}

const isSuccess = (res: Response) => res.status >= 200 && res.status < 300;

/**
 * Run the paid part of a non-streaming route after `enforceInk` succeeded.
 * `run` returns the Response for the client; a thrown error is turned into one by
 * `onError` (normally `errorResponse`). Whenever that Response is NOT a 2xx — upstream
 * error, the provider's own account out of funds, recognizer failure, timeout, abort — the
 * charge for `input.requestId` is refunded before the Response is returned. A 2xx is never
 * refunded, even when the model answered with text instead of an image.
 */
export async function runCharged(
  input: RefundInput,
  log: BillingLog,
  run: () => Promise<Response>,
  onError: (err: unknown) => Response,
  client?: RpcClient,
): Promise<Response> {
  let res: Response;
  try {
    res = await run();
  } catch (err) {
    res = onError(err);
  }
  if (!isSuccess(res)) await refundInk(input, log, client);
  return res;
}

/* ------------------------------------------------------------------------- */
/* Responses                                                                  */
/* ------------------------------------------------------------------------- */

export const INK_EMPTY_MESSAGE = "You're out of ink. Grab an ink pack to keep going.";
export const BILLING_UNAVAILABLE_MESSAGE = "Billing is not set up on this deployment — run the migrations.";

/** Where the 402 sends the user: the account page, whose ink packs are the way to buy more. */
export const BUY_INK_PATH = "/account";

/**
 * 402 following the shared error contract, with additive `remaining` (the ink left, less than
 * the call costs) and `buyUrl`. It is the only 402 the API sends: the provider's own account
 * running dry is a 503 (request.ts), so a client may read any 402 as "this user is out of ink".
 */
export function inkEmptyResponse(remaining: number): Response {
  return json(402, "ink_empty", INK_EMPTY_MESSAGE, {
    remaining: Math.max(0, remaining),
    buyUrl: BUY_INK_PATH,
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
 * One call for route handlers: charge the route's ink, or produce the response
 * that ends the request.
 *
 *  - `BILLING_ENFORCE=0`: skip the database entirely (logged once per process).
 *  - not enough ink: `402 ink_empty`.
 *  - RPC missing / DB error while enforced: fail closed with `503 feature_unavailable`.
 */
export async function enforceInk(
  input: ConsumeInput,
  log: { warn: (obj: object, msg: string) => void; info?: (obj: object, msg: string) => void } = billingLogger,
  client?: RpcClient,
): Promise<EnforceResult> {
  if (!billingEnforced()) {
    if (!warnedNotEnforced) {
      warnedNotEnforced = true;
      billingLogger.warn({ route: input.route }, "BILLING_ENFORCE=0: ink metering is skipped on this deployment");
    }
    return { remaining: null };
  }

  const result = await consumeInk(input, client);
  if (result.ok) return { remaining: result.remaining };

  if (result.reason === "insufficient_ink") {
    log.warn({ route: input.route, remaining: result.remaining, cost: ROUTE_COSTS[input.route] }, "out of ink");
    return { response: inkEmptyResponse(result.remaining) };
  }

  log.warn({ route: input.route, error: result.message }, "billing unavailable; failing closed");
  return { response: billingUnavailableResponse() };
}
