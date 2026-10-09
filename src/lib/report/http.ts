/**
 * What the /api/report routes share once the caller is signed in and within their rate limit: the
 * store (503 without the service role), the query and path checks (400), and the answer for a
 * failure (502). Every answer is no-store and carries the request id: these answers name a family's
 * kids and show their work. Kept out of the route files, which may export only handlers
 * (routeProtection.test.ts).
 */
import type pino from "pino";
import { z } from "zod";
import { json } from "@/lib/server/auth";
import { reportDeps, type ReportStore } from "./server";
import { isReportableWeek, parseWeek, reportTimeZone, weekStartAt } from "./week";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The store, or the answer when the server cannot reach the family's rows. */
export function reportStore(log: pino.Logger, requestId: string): { store: ReportStore } | { response: Response } {
  let store: ReportStore | null;
  try {
    store = reportDeps.store();
  } catch (err) {
    log.error({ requestId, err: err instanceof Error ? err.message : String(err) }, "report: server env invalid");
    return { response: json(500, "internal_error", "The server's environment is not set up.", { requestId }, { ...NO_STORE, "X-Request-Id": requestId }) };
  }
  if (!store) return { response: json(503, "feature_unavailable", "The weekly report is not set up on this deployment (SUPABASE_SERVICE_ROLE_KEY).", { requestId }, { ...NO_STORE, "X-Request-Id": requestId }) };
  return { store };
}

/** A JSON answer, no-store, with the request id. */
export function reportAnswer(body: unknown, requestId: string): Response {
  return Response.json(body, { headers: { ...NO_STORE, "X-Request-Id": requestId } });
}

/** A 4xx in the shared error shape, no-store, with the request id. */
export function reportRefusal(status: 400 | 404, message: string, requestId: string): Response {
  return json(status, status === 404 ? "not_found" : "invalid_request", message, { requestId }, { ...NO_STORE, "X-Request-Id": requestId });
}

/** Something failed after the checks (a read): 502, logged with what. */
export function reportFailure(err: unknown, ctx: { log: pino.Logger; requestId: string; userId: string; what: string }): Response {
  ctx.log.error({ requestId: ctx.requestId, userId: ctx.userId, err: err instanceof Error ? err.message : String(err) }, `report ${ctx.what} failed`);
  return json(502, "upstream_error", "Something went wrong on our side. Try again in a moment.", { requestId: ctx.requestId }, { ...NO_STORE, "X-Request-Id": ctx.requestId });
}

const QuerySchema = z.object({
  /** any date in the week (its Monday is used); this week when absent */
  week: z.string().max(10).optional(),
  /** the browser's IANA zone; DEFAULT_REPORT_TZ when absent or unknown */
  tz: z.string().max(64).optional(),
});

/**
 * GET /api/report's `?week=` and `?tz=`: the week's Monday in the caller's zone (this week when
 * absent), or the 400 for a week that is not a date, is in the future or is over a year back. An
 * unknown zone is not an error: the report is read in DEFAULT_REPORT_TZ.
 */
export function parseReportQuery(req: Request, now: number, requestId: string): { weekStart: string; timeZone: string } | { response: Response } {
  const params = new URL(req.url).searchParams;
  const query = QuerySchema.safeParse({ week: params.get("week") ?? undefined, tz: params.get("tz") ?? undefined });
  if (!query.success) return { response: reportRefusal(400, "The week or the time zone is not readable.", requestId) };
  const timeZone = reportTimeZone(query.data.tz);
  const weekStart = query.data.week === undefined ? weekStartAt(now, timeZone) : parseWeek(query.data.week);
  if (!weekStart) return { response: reportRefusal(400, "The week must be a date, YYYY-MM-DD.", requestId) };
  if (!isReportableWeek(weekStart, now, timeZone)) return { response: reportRefusal(400, "That week is in the future or more than a year back.", requestId) };
  return { weekStart, timeZone };
}

/** A board id in the path: a uuid, or the 400 to answer. */
export async function parseBoardId(params: Promise<{ id: string }>, requestId: string): Promise<{ id: string } | { response: Response }> {
  const parsed = z.string().uuid().safeParse((await params).id);
  return parsed.success ? { id: parsed.data } : { response: reportRefusal(400, "The board id must be a uuid.", requestId) };
}
