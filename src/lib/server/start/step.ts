/**
 * The server's half of the steps before the account (POST /api/start/step; the browser's half is
 * src/lib/start/record.ts): the limits, the day's cap for everyone, what of a step's details is
 * kept, and the one call to `record_start_step` with the service role
 * (supabase/migrations/20261013020000_start_steps.sql).
 *
 * Nothing about the visitor is kept but the row: no IP (the per-visitor limit keys this instance's
 * memory with it, `visitorIp`), no log line with the journey or the details, and of the details only
 * what START_EVENTS notes (`cleanStartMeta`).
 */
import { MAX_FOCUS, START_ROLES, type StartEvent, type StartStepRequest } from "@/lib/start/contracts";
import { isCourseId } from "@/lib/onboarding/courseIds";
import { startDailySteps } from "@/lib/env";
import { serviceClient, type RpcClient } from "@/lib/server/billing";
import { GLOBAL_BUDGET_RPC, normalizeRateLimitHit, type RateLimitOptions } from "@/lib/server/rate-limit";
import { startLogger } from "./http";

const HOUR = 60 * 60_000;
export const DAY_MS = 86_400_000;

/**
 * A visitor (by IP, `visitorIp`) records at most `perVisitor` steps an hour: a whole /start is about
 * a dozen, so this is a family going through it several times over, or a few families behind one
 * address. Everyone together records at most `perDay` steps a UTC day (env START_DAILY_STEPS
 * overrides it), so a bot cannot fill the table.
 */
export const START_STEP_LIMITS = {
  perVisitor: { limit: 120, windowMs: HOUR },
  perDay: 20_000,
} as const satisfies { perVisitor: RateLimitOptions; perDay: number };

/** A step's body at most: a uuid, an event and a few short details are ~200 bytes. */
export const START_STEP_MAX_BYTES = 2_048;

/** The day's bucket in `rate_limit_counters` (stored as `global:startSteps`). */
export const START_STEPS_BUCKET = "startSteps";
/** How long a step waits for the day's counter, and then for its own row, before giving up on it. */
export const START_DB_TIMEOUT_MS = 1_500;

/** The service role's RPC that records a step. */
export const RECORD_START_STEP = "record_start_step";

// ------------------------------------------------------------------ the details kept

type Check = (value: unknown) => boolean;

const isWhole = (min: number, max: number): Check => (v) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/**
 * The details each event may keep (START_EVENTS' notes), and what each must be: the role, the grade
 * (0 = Kindergarten to 8) or a high-school course id, how many skills were picked, whether the try
 * was solved and how long the tick took from the pen lifting (whole ms, at most 10 minutes). Every
 * event may also keep `ALL_EVENTS_KEYS` (which app sent it: only "ipad"); nothing else.
 */
const META_KEYS: Readonly<Partial<Record<StartEvent, Readonly<Record<string, Check>>>>> = {
  start_who: { role: (v) => typeof v === "string" && (START_ROLES as readonly string[]).includes(v) },
  start_grade: { grade: isWhole(0, 8), course: isCourseId },
  start_focus: { count: isWhole(0, MAX_FOCUS) },
  start_try_checked: { solved: (v) => typeof v === "boolean", ms: isWhole(0, 600_000) },
};

/** What any event may keep: the iPad app says it is the iPad (the web says nothing). */
const ALL_EVENTS_KEYS: Readonly<Record<string, Check>> = {
  client: (v) => v === "ipad",
};

export type StartMeta = Record<string, string | number | boolean>;

/**
 * The details of a step as the row keeps them, or null: only the keys its event may keep (and
 * `client`), each only when it is what the event says (never a name, never free text). The rest is
 * dropped, not refused: the step still counts.
 */
export function cleanStartMeta(event: StartEvent, meta: StartStepRequest["meta"]): StartMeta | null {
  if (!meta) return null;
  const allowed = { ...META_KEYS[event], ...ALL_EVENTS_KEYS };
  const out: StartMeta = {};
  for (const [key, check] of Object.entries(allowed)) {
    const value = meta[key];
    if (value !== null && value !== undefined && check(value)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ------------------------------------------------------------------ the day's cap

export type StartCapResult =
  /** counted, within the day's steps */
  | { ok: true; backend: "db"; remaining: number }
  /** not counted (the counter could not be reached): the step goes ahead */
  | { ok: true; backend: "open"; reason: string }
  /** the day's steps are spent */
  | { ok: false; backend: "db"; retryAfterMs: number };

let warnedCap = false;

function open(reason: string): StartCapResult {
  if (!warnedCap) {
    warnedCap = true;
    startLogger.warn({ reason }, "start daily cap unavailable; steps are recorded without it (per-visitor limit still holds)");
  }
  return { ok: true, backend: "open", reason };
}

/** Tests only: log the next fail-open again. */
export function resetStartCapWarning(): void {
  warnedCap = false;
}

/** The answer of `call`, or "late" after `ms`. */
async function within<T>(call: PromiseLike<T>, ms: number): Promise<T | "late"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), ms);
  });
  try {
    return await Promise.race([Promise.resolve(call), late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Spends one step of the day's `START_DAILY_STEPS` (default `START_STEP_LIMITS.perDay`), for
 * everyone together and every server instance: `global_budget_spend` with the service role
 * (supabase/migrations/20261009150000_speech_budget.sql), one fixed window of a UTC day in
 * `rate_limit_counters` under the nil uuid — a single counter, nothing about any visitor. A refused
 * step counts too, so a spent day stays spent until it ends.
 *
 * FAILS OPEN: when the counter cannot be reached (no SUPABASE_SERVICE_ROLE_KEY, the function
 * missing, the database erroring or slower than START_DB_TIMEOUT_MS) the step goes ahead — counting
 * must never be what breaks, and the per-visitor limit still holds. Logged once per process.
 * `client`: the RPC client (default the service role's; null means none). Never throws.
 */
export async function spendStartStep(client?: RpcClient | null): Promise<StartCapResult> {
  const limit = startDailySteps(START_STEP_LIMITS.perDay);
  try {
    const rpcClient = client === undefined ? serviceClient() : client;
    if (!rpcClient) return open("no SUPABASE_SERVICE_ROLE_KEY");
    const answer = await within(rpcClient.rpc(GLOBAL_BUDGET_RPC, { p_bucket: START_STEPS_BUCKET, p_amount: 1, p_limit: limit, p_window_ms: DAY_MS }), START_DB_TIMEOUT_MS);
    if (answer === "late") return open(`global_budget_spend took over ${START_DB_TIMEOUT_MS} ms`);
    if (answer.error) return open(`global_budget_spend failed: ${answer.error.message}`);
    const hit = normalizeRateLimitHit(answer.data, { limit, windowMs: DAY_MS });
    if (!hit) return open("global_budget_spend returned an unexpected shape");
    return hit.ok ? { ok: true, backend: "db", remaining: hit.remaining } : { ok: false, backend: "db", retryAfterMs: hit.retryAfterMs };
  } catch (err) {
    return open(`global_budget_spend threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ------------------------------------------------------------------ the row

export type RecordResult =
  | { ok: true }
  /** the database refused the step itself (23514, 22023): the request was wrong */
  | { ok: false; status: 400; reason: string }
  /** no service role, the function missing, the database erroring or too slow */
  | { ok: false; status: 503; reason: string };

/** Postgres's check_violation and invalid_parameter_value: what record_start_step refuses a step with. */
const REFUSED = new Set(["23514", "22023"]);

/**
 * Records the step with the service role (`record_start_step`): inserted the first time, counted
 * after. `client`: the RPC client (default the service role's; null means none). Never throws.
 */
export async function recordStartStepRow(step: { journeyId: string; event: StartEvent; meta: StartMeta | null }, client?: RpcClient | null): Promise<RecordResult> {
  try {
    const rpcClient = client === undefined ? serviceClient() : client;
    if (!rpcClient) return { ok: false, status: 503, reason: "no SUPABASE_SERVICE_ROLE_KEY" };
    const answer = await within(rpcClient.rpc(RECORD_START_STEP, { p_journey: step.journeyId, p_event: step.event, p_meta: step.meta }), START_DB_TIMEOUT_MS);
    if (answer === "late") return { ok: false, status: 503, reason: `${RECORD_START_STEP} took over ${START_DB_TIMEOUT_MS} ms` };
    if (answer.error) {
      const code = answer.error.code ?? "";
      return { ok: false, status: REFUSED.has(code) ? 400 : 503, reason: `${RECORD_START_STEP} failed: ${code} ${answer.error.message}`.trim() };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, status: 503, reason: `${RECORD_START_STEP} threw: ${err instanceof Error ? err.message : String(err)}` };
  }
}
