/**
 * The admin Funnel's read (GET /api/admin/funnel): one call to admin_funnel()
 * (supabase/migrations/20261009020000_funnel.sql) with the service role, added up into a
 * FunnelReport (src/lib/funnel/report.ts). Like the console's other reads it is a plain fetch to
 * PostgREST, so the tests replace `deps.fetch`; a failure is a ConsoleQueryError naming the
 * function, which the route answers 502 with.
 */
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import type { FunnelReport } from "@/lib/funnel/contracts";
import { FunnelRpcSchema, buildFunnelReport } from "@/lib/funnel/report";
import { ConsoleQueryError, QUERY_TIMEOUT_MS, failureOf, type ConsoleDeps } from "./rest";

export const FUNNEL_FUNCTION = "admin_funnel";

/** PostgREST's "no such function" and Postgres's undefined_function. */
const MISSING = new Set(["PGRST202", "42883"]);

/** The report for the viewer's zone. Throws ConsoleQueryError when the call or its answer fails. */
export async function buildFunnel(deps: ConsoleDeps, timeZone: string): Promise<FunnelReport> {
  const f = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${deps.url}/rest/v1/rpc/${FUNNEL_FUNCTION}`, {
      method: "POST",
      headers: { apikey: deps.serviceKey, Authorization: `Bearer ${deps.serviceKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_tz: timeZone }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    throw new ConsoleQueryError(FUNNEL_FUNCTION, null, name === "TimeoutError" || name === "AbortError" ? "no answer in time" : `network: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const body = (await res
      .clone()
      .json()
      .catch(() => null)) as { code?: unknown } | null;
    if (typeof body?.code === "string" && MISSING.has(body.code)) {
      throw new ConsoleQueryError(FUNNEL_FUNCTION, res.status, "it does not exist (is migration 20261009020000_funnel.sql applied?)");
    }
    throw await failureOf(FUNNEL_FUNCTION, res);
  }
  const parsed = FunnelRpcSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ConsoleQueryError(FUNNEL_FUNCTION, res.status, "the answer was not a funnel");
  return buildFunnelReport(parsed.data, { monthlyUsd: UNLIMITED_PLAN.monthlyUsd });
}
