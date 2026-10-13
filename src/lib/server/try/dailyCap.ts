/**
 * The try board's cap on reads for everyone together: `TRY_DAILY_READS` (default
 * `TRY_LIMITS.perDay`) handwriting reads a UTC day, however many visitors and however many server
 * instances, so a bot cannot run up the reader's bill.
 *
 * Counted in the database through the service role, with the function read aloud's budget already
 * uses (`global_budget_spend`, supabase/migrations/20261009150000_speech_budget.sql): one fixed
 * window of a day aligned to the Unix epoch (so midnight UTC to midnight UTC) in
 * `rate_limit_counters`, bucket `global:tryReads`, under the nil uuid — a single counter, nothing
 * about any visitor. Each read adds one before the reader is called; a refused read counts too, so a
 * spent day stays spent until it ends. No migration of its own.
 *
 * FAILS OPEN: when the counter cannot be reached (no SUPABASE_SERVICE_ROLE_KEY, the function missing,
 * the database erroring or slower than `TRY_CAP_TIMEOUT_MS`) the read goes ahead — the try board is
 * the front door, and a database hiccup must not close it. The per-visitor limit (in memory, per
 * instance) still holds, and the fail-open is logged (warn, once per process) and on every read's
 * log line (`dailyCap: "open"`).
 */
import { tryDailyReads } from "@/lib/env";
import { serviceClient, type RpcClient } from "@/lib/server/billing";
import { GLOBAL_BUDGET_RPC, normalizeRateLimitHit } from "@/lib/server/rate-limit";
import { TRY_LIMITS } from "@/lib/try/contracts";
import { tryLogger } from "./http";

/** The day's bucket in `rate_limit_counters` (stored as `global:tryReads`). */
export const TRY_READS_BUCKET = "tryReads";
export const DAY_MS = 86_400_000;
/** How long a read waits for the counter before going ahead without it. */
export const TRY_CAP_TIMEOUT_MS = 1_500;

export type DailyCapResult =
  /** counted, within the day's reads */
  | { ok: true; backend: "db"; remaining: number }
  /** not counted (the counter could not be reached): the read goes ahead */
  | { ok: true; backend: "open"; reason: string }
  /** the day's reads are spent */
  | { ok: false; backend: "db"; retryAfterMs: number };

let warned = false;

function open(reason: string): DailyCapResult {
  if (!warned) {
    warned = true;
    tryLogger.warn({ reason }, "try daily cap unavailable; reads go ahead without it (per-visitor limit still holds)");
  }
  return { ok: true, backend: "open", reason };
}

/** Tests only: log the next fail-open again. */
export function resetDailyCapWarning(): void {
  warned = false;
}

/**
 * Spends one read of the day's (see the file comment). `client`: the RPC client (default the
 * service role's; null means none). Never throws.
 */
export async function spendTryRead(client?: RpcClient | null): Promise<DailyCapResult> {
  const limit = tryDailyReads(TRY_LIMITS.perDay);
  const cfg = { limit, windowMs: DAY_MS };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rpcClient = client === undefined ? serviceClient() : client;
    if (!rpcClient) return open("no SUPABASE_SERVICE_ROLE_KEY");
    const call = Promise.resolve(rpcClient.rpc(GLOBAL_BUDGET_RPC, { p_bucket: TRY_READS_BUCKET, p_amount: 1, p_limit: limit, p_window_ms: DAY_MS }));
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), TRY_CAP_TIMEOUT_MS);
    });
    const answer = await Promise.race([call, late]);
    if (answer === "late") return open(`global_budget_spend took over ${TRY_CAP_TIMEOUT_MS} ms`);
    if (answer.error) return open(`global_budget_spend failed: ${answer.error.message}`);
    const hit = normalizeRateLimitHit(answer.data, cfg);
    if (!hit) return open("global_budget_spend returned an unexpected shape");
    return hit.ok ? { ok: true, backend: "db", remaining: hit.remaining } : { ok: false, backend: "db", retryAfterMs: hit.retryAfterMs };
  } catch (err) {
    return open(`global_budget_spend threw: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
