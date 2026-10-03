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
 * work then fails, `refundInk` (RPC `refund_ink_for`, SERVICE ROLE ONLY) gives the charge back.
 * The refund never runs as the user: a user allowed to refund their own request ids could get
 * the ink of any call back (every 2xx carries its X-Request-Id), so ink would never run out.
 *   - non-streaming routes run their provider call inside `runCharged`, which refunds
 *     whenever the response handed to the client is not a 2xx;
 *   - the SSE routes (live/check, live/solve) refund only when the stream fails before
 *     the first annotation/step was emitted (see `runChargedStream` in live-route.ts).
 * The refund uses the SAME requestId the charge used and the user `requireUser` verified; the
 * RPC only touches that user's usage_events rows younger than 15 minutes.
 *
 * Agathon Unlimited (supabase/migrations/20261003020000_unlimited.sql): while the caller's
 * subscription is trialing or active, the same `consume_credits` call spends NO ink. It answers
 * ok with the untouched balance and records the action for a fair-use cap instead (one constant
 * in SQL, `unlimited_fair_use_per_day()`, per rolling 24 hours). Over the cap it answers
 * `reason: 'fair_use'`, which `enforceInk` turns into the same `429 rate_limited` (with
 * Retry-After) as any rate limit, never the 402 out-of-ink. Nothing else here changes: the routes
 * call `enforceInk` and `runCharged` as before, and a refund of a subscriber's call gives back 0
 * ink (it spent none), so refunds can never mint ink.
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
  /** `unlimited`: an Agathon Unlimited subscriber's call, which spent nothing (`remaining` is the untouched balance). */
  | { ok: true; remaining: number; unlimited?: true }
  | { ok: false; reason: "insufficient_ink"; remaining: number }
  /** A subscriber over the fair-use cap: a 429, not a 402. */
  | { ok: false; reason: "fair_use"; retryAfterMs: number }
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
 * For an Agathon Unlimited subscriber (20261003020000_unlimited.sql) it adds `unlimited: true`,
 * and over the fair-use cap answers `{ ok: false, reason: 'fair_use', retry_after_ms }`.
 */
export const CONSUME_INK_RPC = "consume_credits";

/**
 * The SECURITY DEFINER function (20261002000000_ink.sql), executable by the service role only:
 * `refund_ink_for(p_user_id uuid, p_request_id text) returns jsonb` -> `{ refunded: int, remaining: int }`.
 * (`refund_credits(p_request_id)`, which a user could call, is no longer executable by them.)
 */
export const REFUND_INK_RPC = "refund_ink_for";

let serviceCache: { key: string; client: SupabaseClient } | null = null;

/**
 * The service-role client refunds use, or null without SUPABASE_SERVICE_ROLE_KEY (then failed
 * calls are not refunded, and each attempt is logged). Never handed a user's request body: it only
 * ever calls `refund_ink_for` with the user id `requireUser` verified.
 */
export function serviceClient(): SupabaseClient | null {
  const env = getServerEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const key = `${env.NEXT_PUBLIC_SUPABASE_URL}|${env.SUPABASE_SERVICE_ROLE_KEY}`;
  if (serviceCache?.key !== key) {
    serviceCache = {
      key,
      client: createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    };
  }
  return serviceCache.client;
}

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

/** A fair-use refusal without a usable `retry_after_ms` waits this long (the window is 24 hours). */
export const FAIR_USE_FALLBACK_RETRY_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Normalise the RPC payload. The function may return a single row (object), a
 * one-row set (array) or jsonb; we accept `{ ok | allowed, remaining }`, plus the Unlimited
 * additions (`unlimited`, and `reason: 'fair_use'` with `retry_after_ms`).
 * Exported for tests.
 */
export function normalizeConsumeResult(data: unknown): ConsumeResult {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return { ok: false, reason: "unavailable", message: "consume_credits returned no row." };
  }
  const r = row as Record<string, unknown>;
  const okField = typeof r.ok === "boolean" ? r.ok : typeof r.allowed === "boolean" ? r.allowed : null;
  // Checked before `remaining`: the refusal is about the plan's cap, not about ink.
  if (okField === false && r.reason === "fair_use") {
    const retry = asNumber(r.retry_after_ms);
    return { ok: false, reason: "fair_use", retryAfterMs: retry !== null && retry > 0 ? Math.min(DAY_MS, Math.round(retry)) : FAIR_USE_FALLBACK_RETRY_MS };
  }
  const remaining = asNumber(r.remaining);
  if (okField === null || remaining === null) {
    return { ok: false, reason: "unavailable", message: "consume_credits returned an unexpected shape." };
  }
  if (okField) return r.unlimited === true ? { ok: true, remaining: Math.max(0, remaining), unlimited: true } : { ok: true, remaining: Math.max(0, remaining) };
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
  /** The user `requireUser` / `livePreamble` verified: whose charge to give back. */
  userId: string;
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

/** Normalise the `refund_ink_for` payload (object, one-row set or jsonb). Exported for tests. */
export function normalizeRefundResult(data: unknown): RefundResult {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return { refunded: 0, reason: "refund_ink_for returned no row." };
  const r = row as Record<string, unknown>;
  const refunded = asNumber(r.refunded);
  const remaining = asNumber(r.remaining);
  if (refunded === null || remaining === null) return { refunded: 0, reason: "refund_ink_for returned an unexpected shape." };
  return { refunded: Math.max(0, refunded), remaining: Math.max(0, remaining) };
}

/**
 * Give back what `consumeInk` charged for `requestId`, with the service role. Never throws; a
 * refund that cannot happen is logged and reported as `{ refunded: 0, reason }` so the route can
 * still answer the client. With `BILLING_ENFORCE=0` nothing was charged, so nothing is refunded
 * and the database is not touched.
 */
export async function refundInk(input: RefundInput, log: BillingLog = billingLogger, client?: RpcClient): Promise<RefundResult> {
  if (!billingEnforced()) return { refunded: 0, reason: "not_enforced" };

  let result: RefundResult;
  try {
    const rpcClient = client ?? serviceClient();
    if (!rpcClient) {
      result = { refunded: 0, reason: "SUPABASE_SERVICE_ROLE_KEY is not set, so failed calls cannot be refunded." };
    } else {
      const { data, error } = await rpcClient.rpc(REFUND_INK_RPC, { p_user_id: input.userId, p_request_id: input.requestId });
      if (error) {
        const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
        result =
          error.code === "42883" || error.code === "PGRST202" || MISSING_FUNCTION_RE.test(text)
            ? { refunded: 0, reason: "refund_ink_for RPC is missing (run the migrations)." }
            : { refunded: 0, reason: `refund_ink_for failed: ${error.message}` };
      } else {
        result = normalizeRefundResult(data);
      }
    }
  } catch (err) {
    result = { refunded: 0, reason: `refund_ink_for threw: ${err instanceof Error ? err.message : String(err)}` };
  }

  if ("reason" in result) {
    log.warn({ requestId: input.requestId, error: result.reason }, "ink refund failed");
  } else {
    log.info?.({ requestId: input.requestId, refunded: result.refunded, remaining: result.remaining }, "ink refunded");
  }
  return result;
}

const isSuccess = (res: Response) => res.status >= 200 && res.status < 300;

export type RunChargedOptions = {
  /**
   * The request's own signal (`req.signal`). When it has fired, the CLIENT abandoned the request,
   * and a failure that follows is kept, not refunded. For a charge that other requests ride on
   * (lecture mode's minute: every later tick of that minute is served free because this one paid),
   * a refund on abort is free work on demand: send the minute's first tick, send the rest while it
   * is in flight, abort the first, get the ink back (security audit, 2026-10-03).
   */
  keepChargeWhenAborted?: AbortSignal;
};

/**
 * Run the paid part of a non-streaming route after `enforceInk` succeeded.
 * `run` returns the Response for the client; a thrown error is turned into one by
 * `onError` (normally `errorResponse`). Whenever that Response is NOT a 2xx — upstream
 * error, the provider's own account out of funds, recognizer failure, timeout, abort — the
 * charge for `input.requestId` is refunded before the Response is returned, except after the
 * client abandoned a request whose route asked to keep it (`opts.keepChargeWhenAborted`). A 2xx is
 * never refunded, even when the model answered with text instead of an image.
 */
export async function runCharged(
  input: RefundInput,
  log: BillingLog,
  run: () => Promise<Response>,
  onError: (err: unknown) => Response,
  client?: RpcClient,
  opts: RunChargedOptions = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await run();
  } catch (err) {
    res = onError(err);
  }
  if (!isSuccess(res)) {
    if (opts.keepChargeWhenAborted?.aborted) {
      log.info?.({ requestId: input.requestId, status: res.status }, "request abandoned by the client after it was charged; charge kept");
    } else {
      await refundInk(input, log, client);
    }
  }
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
 * 402 following the shared error contract, with additive `remaining` (the ink left), `cost` (what
 * the refused call needs, so the board knows when the balance covers it again) and `buyUrl`. It is
 * the only 402 the API sends: the provider's own account running dry is a 503 (request.ts), so a
 * client may read any 402 as "this user is out of ink".
 */
export function inkEmptyResponse(remaining: number, cost?: number): Response {
  return json(402, "ink_empty", INK_EMPTY_MESSAGE, {
    remaining: Math.max(0, remaining),
    ...(cost !== undefined ? { cost } : {}),
    buyUrl: BUY_INK_PATH,
  });
}

/** 503 when metering is enforced but the database has no billing schema / the RPC failed. */
export function billingUnavailableResponse(): Response {
  return json(503, "feature_unavailable", BILLING_UNAVAILABLE_MESSAGE);
}

/** "about 3 hours", "about 40 minutes", "about a minute": how long until the tutor is back. */
export function aboutHowLong(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 2) return "about a minute";
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "about an hour" : `about ${hours} hours`;
}

export const FAIR_USE_MESSAGE = (retryAfterMs: number) =>
  `You've reached the daily fair-use limit of Agathon Unlimited. The tutor is back in ${aboutHowLong(retryAfterMs)}.`;

/**
 * 429 for an Agathon Unlimited subscriber over the fair-use cap: the same `rate_limited` code,
 * `retryAfterMs` and Retry-After header as rateLimitedResponse (src/lib/server/rate-limit.ts), so
 * every client handles it as the rate limit it is, plus the additive `reason: "fair_use"`. Never a
 * 402: the student is not out of ink, and the ink dialog must not offer them packs.
 */
export function fairUseResponse(retryAfterMs: number): Response {
  const ms = Math.max(1000, Math.round(retryAfterMs));
  return json(429, "rate_limited", FAIR_USE_MESSAGE(ms), { retryAfterMs: ms, reason: "fair_use" }, { "Retry-After": String(Math.ceil(ms / 1000)) });
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
 *  - an Agathon Unlimited subscriber: passes, nothing spent (the RPC decides).
 *  - not enough ink: `402 ink_empty`.
 *  - a subscriber over the fair-use cap: `429 rate_limited` (fairUseResponse).
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
    return { response: inkEmptyResponse(result.remaining, ROUTE_COSTS[input.route]) };
  }

  if (result.reason === "fair_use") {
    log.warn({ route: input.route, retryAfterMs: result.retryAfterMs }, "Agathon Unlimited fair-use limit reached");
    return { response: fairUseResponse(result.retryAfterMs) };
  }

  log.warn({ route: input.route, error: result.message }, "billing unavailable; failing closed");
  return { response: billingUnavailableResponse() };
}
