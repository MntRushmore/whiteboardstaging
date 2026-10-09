/**
 * The admin console's Referrals reads and writes (GET /api/admin/referrals, PATCH
 * /api/admin/referrals/<id>): one call each to admin_referrals() and admin_referral_mark()
 * (supabase/migrations/20261009110000_referrals.sql) with the service role. The mark and its
 * admin_audit row are written by the database in one transaction, so a reward is never recorded
 * without its audit line.
 *
 * Like the console's other reads these are plain fetches to PostgREST, so the tests replace
 * `deps.fetch`; a failure is a ConsoleQueryError naming the function (the routes answer 502), and a
 * refused move comes back as a result the route answers 404 or 409 with.
 */
import { ConsoleQueryError, QUERY_TIMEOUT_MS, failureOf, type ConsoleDeps } from "@/lib/server/adminConsole/rest";
import { ReferralRpcEntrySchema, ReferralRpcListSchema, toAdminReferral, toAdminReferralList, type AdminReferral, type AdminReferralList, type ReferralMark } from "../admin";

export const LIST_FUNCTION = "admin_referrals";
export const MARK_FUNCTION = "admin_referral_mark";

/** Rows listed at most (newest first); the counts cover every row. */
export const REFERRAL_LIST_LIMIT = 1000;

/** PostgREST's "no such function" and Postgres's undefined_function. */
const MISSING = new Set(["PGRST202", "42883"]);

async function call(deps: ConsoleDeps, fn: string, body: Record<string, unknown>): Promise<Response> {
  const f = deps.fetch ?? fetch;
  try {
    return await f(`${deps.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    throw new ConsoleQueryError(fn, null, name === "TimeoutError" || name === "AbortError" ? "no answer in time" : `network: ${err instanceof Error ? err.message : String(err)}`, fn === MARK_FUNCTION ? "write" : "read");
  }
}

async function errorBody(res: Response): Promise<{ code: string; hint: string; message: string }> {
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { code?: unknown; hint?: unknown; message?: unknown } | null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return { code: str(body?.code), hint: str(body?.hint), message: str(body?.message) };
}

/** Every referral (newest REFERRAL_LIST_LIMIT) with both accounts' emails. Throws ConsoleQueryError. */
export async function listReferrals(deps: ConsoleDeps): Promise<AdminReferralList> {
  const res = await call(deps, LIST_FUNCTION, { p_limit: REFERRAL_LIST_LIMIT });
  if (!res.ok) {
    const err = await errorBody(res);
    if (MISSING.has(err.code)) throw new ConsoleQueryError(LIST_FUNCTION, res.status, "it does not exist (is migration 20261009110000_referrals.sql applied?)");
    throw await failureOf(LIST_FUNCTION, res);
  }
  const parsed = ReferralRpcListSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ConsoleQueryError(LIST_FUNCTION, res.status, "the answer was not a list of referrals");
  return toAdminReferralList(parsed.data);
}

export type MarkResult =
  | { kind: "ok"; referral: AdminReferral }
  /** no referral has that id */
  | { kind: "missing" }
  /**
   * the status does not allow it (rewarded and void are final; only a paid one is rewarded), or a
   * paid one is not rewardable yet: the friend's plan is not active, or its first payment has not
   * settled (hint `referral_unsettled`, 20261009140000_referral_hardening.sql)
   */
  | { kind: "conflict"; message: string };

/**
 * Marks a referral rewarded (rewarded_at, rewarded_by) or void, audited as `referral.reward` /
 * `referral.void` by the database. Throws ConsoleQueryError when the call fails.
 */
export async function markReferral(deps: ConsoleDeps, id: number, mark: ReferralMark, adminId: string): Promise<MarkResult> {
  const res = await call(deps, MARK_FUNCTION, { p_id: id, p_status: mark, p_admin: adminId });
  if (!res.ok) {
    const err = await errorBody(res);
    if (err.hint === "not_found") return { kind: "missing" };
    if (err.hint === "referral_state" || err.hint === "referral_unsettled") return { kind: "conflict", message: err.message || "This referral cannot be changed that way." };
    if (MISSING.has(err.code)) throw new ConsoleQueryError(MARK_FUNCTION, res.status, "it does not exist (is migration 20261009110000_referrals.sql applied?)", "write");
    throw await failureOf(MARK_FUNCTION, res, false, "write");
  }
  const parsed = ReferralRpcEntrySchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ConsoleQueryError(MARK_FUNCTION, res.status, "the answer was not a referral", "write");
  return { kind: "ok", referral: toAdminReferral(parsed.data) };
}
