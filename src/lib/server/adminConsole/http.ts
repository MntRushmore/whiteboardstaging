/**
 * What the console's routes (src/app/api/admin/{users,boards,bugs,issues}) share once the caller is
 * an admin and within the rate limit: the service-role env (503 without the key), the answers for a
 * bad id or query (400), a missing row (404), a look that could not be logged (503) and a read that
 * failed (502, naming the table). Every answer here is no-store and carries the request id.
 */
import type pino from "pino";
import { z } from "zod";
import { json } from "@/lib/server/auth";
import { AuditError } from "./audit";
import { consoleDeps, ConsoleQueryError, type ConsoleDeps } from "./rest";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** A row id in a path: a uuid. */
export const IdSchema = z.string().uuid();

/** The console's deps, or the answer when the server cannot read the tables (500 bad env, 503 no service key). */
export function consoleEnv(log: pino.Logger, requestId: string): { deps: ConsoleDeps } | { response: Response } {
  let deps: ConsoleDeps | null;
  try {
    deps = consoleDeps();
  } catch (err) {
    log.error({ requestId, err: err instanceof Error ? err.message : String(err) }, "admin console: server env invalid");
    return { response: json(500, "internal_error", "The server's environment is not set up.", undefined, NO_STORE) };
  }
  if (!deps) return { response: json(503, "feature_unavailable", "SUPABASE_SERVICE_ROLE_KEY is not set, so the admin console cannot read the tables.", undefined, NO_STORE) };
  return { deps };
}

export function badRequest(message: string, requestId: string): Response {
  return json(400, "invalid_request", message, { requestId }, NO_STORE);
}

export function notFound(message: string, requestId: string): Response {
  return json(404, "not_found", message, { requestId }, NO_STORE);
}

/** The path's row id (a uuid), or the 400 to answer. `what` names the row: "board", "bug report"… */
export async function parseId(params: Promise<{ id: string }>, what: string, requestId: string): Promise<{ id: string } | { response: Response }> {
  const parsed = IdSchema.safeParse((await params).id);
  return parsed.success ? { id: parsed.data } : { response: badRequest(`The ${what} id must be a uuid.`, requestId) };
}

/** Validated query parameters, or the 400 to answer. */
export function parseQuery<S extends z.ZodTypeAny>(req: Request, schema: S, requestId: string): { data: z.infer<S> } | { response: Response } {
  const raw = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { data: parsed.data };
  const issue = parsed.error.issues[0];
  return { response: badRequest(`Invalid query: ${issue?.path.join(".") || "query"}: ${issue?.message ?? "invalid"}`, requestId) };
}

/** A failure after the reads began: 503 when the look could not be logged, else 502 naming what failed. */
export function consoleFailure(err: unknown, ctx: { log: pino.Logger; requestId: string; userId: string; what: string }): Response {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof AuditError) {
    ctx.log.error({ requestId: ctx.requestId, userId: ctx.userId, err: message }, `admin ${ctx.what}: not logged, not shown`);
    return json(503, "feature_unavailable", "This could not be written to the admin audit log, so it is not shown. Try again in a minute.", { requestId: ctx.requestId }, NO_STORE);
  }
  ctx.log.error({ requestId: ctx.requestId, userId: ctx.userId, what: err instanceof ConsoleQueryError ? err.what : null, err: message }, `admin ${ctx.what} failed`);
  return json(502, "upstream_error", err instanceof ConsoleQueryError ? message : `The ${ctx.what} failed: ${message}`, { requestId: ctx.requestId }, NO_STORE);
}
