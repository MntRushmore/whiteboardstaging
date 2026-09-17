import { json } from "@/lib/server/auth";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { bearerMatches, gcLogger, getGcEnv, runStorageGc, toResponseBody, type GcEnv } from "@/lib/server/storageGc";
import type { GcSummary } from "../../../../../scripts/lib/storageGc.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Listing a big bucket level by level plus paging through whiteboards.data can take a while. */
export const maxDuration = 60;

/**
 * GET|POST /api/admin/gc — Storage garbage collection (Vercel cron, nightly).
 *
 * PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs, reason "Vercel cron; requires
 * Authorization: Bearer CRON_SECRET"): the cron has no user JWT. Authentication is the
 * `Authorization: Bearer <CRON_SECRET>` header Vercel attaches when the CRON_SECRET env
 * var is set, compared in constant time (src/lib/server/storageGc.ts). Without a match
 * the route answers 401 unauthorized; without CRON_SECRET or SUPABASE_SERVICE_ROLE_KEY it
 * answers 503 feature_unavailable (the deployment simply has no GC).
 *
 * Dry run vs collect: an explicit `?dryRun=1` reports orphans and deletes nothing,
 * `?dryRun=0` deletes them. With no query string a Vercel cron invocation COLLECTS and a
 * manual request only reports, so the nightly job actually frees storage while a hand-run
 * curl cannot delete by accident. Cron invocations are identified by the documented
 * markers Vercel sends (`x-vercel-cron-schedule` header, `vercel-cron/1.0` user agent);
 * the bare path in vercel.json needs no query string (cron paths are requested verbatim).
 * The service role is needed because objects span every user's folder. Same planner as
 * scripts/gc-storage.mjs, which stays dry-run-by-default for operators.
 *
 * Body: `{ scanned, orphans, deleted, bytes, dryRun, failed, buckets }` (additive only).
 */

/** Per-IP budget: the cron fires once a day; 10/min stops a leaked URL from being hammered. */
const GC_LIMIT = { limit: 10, windowMs: 60_000 } as const;

export type GcDeps = {
  getEnv: () => GcEnv;
  run: (opts: { url: string; serviceKey: string; dryRun: boolean }) => Promise<GcSummary>;
};

const defaultDeps: GcDeps = {
  getEnv: getGcEnv,
  run: runStorageGc,
};

/** First hop of `x-forwarded-for` (Vercel sets it), else `x-real-ip`, else "unknown". */
function clientIp(req: Request): string {
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * True when a Vercel cron triggered this request. Vercel documents both markers: every
 * cron invocation carries the `vercel-cron/1.0` user agent and an `x-vercel-cron-schedule`
 * header with the expression that fired.
 */
export function isCronRequest(req: Request): boolean {
  if (req.headers.get("x-vercel-cron-schedule")) return true;
  return (req.headers.get("user-agent") ?? "").toLowerCase().startsWith("vercel-cron/");
}

/**
 * `?dryRun=0|false|no` -> collect; any other explicit value -> report only.
 * Without the parameter: collect for a cron invocation, report for a manual request.
 */
export function isDryRun(req: Request): boolean {
  const raw = new URL(req.url).searchParams.get("dryRun");
  if (raw === null) return !isCronRequest(req);
  const v = raw.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "no");
}

const log = gcLogger.child({ route: "admin/gc" });

/** Build the handler; `deps` are only overridden by tests. */
export function createGcHandler(deps: GcDeps = defaultDeps): (req: Request) => Promise<Response> {
  return async function handleGc(req: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const rl = checkRateLimit(`ip:${clientIp(req)}:adminGc`, GC_LIMIT);
    if (!rl.ok) return rateLimitedResponse(rl.retryAfterMs);

    let env: GcEnv;
    try {
      env = deps.getEnv();
    } catch (err) {
      log.error({ requestId, error: err instanceof Error ? err.message : String(err) }, "server env invalid");
      return json(500, "internal_error", "Server is not configured.");
    }
    if (!env.cronSecret) {
      log.warn({ requestId }, "gc called but CRON_SECRET is not set");
      return json(503, "feature_unavailable", "Storage GC is not configured on this deployment (CRON_SECRET).");
    }
    if (!bearerMatches(req.headers.get("authorization"), env.cronSecret)) {
      log.warn({ requestId, ip: clientIp(req) }, "gc called with a missing or wrong cron secret");
      return json(401, "unauthorized", "This endpoint is for the scheduled job.", undefined, { "WWW-Authenticate": "Bearer" });
    }
    if (!env.serviceKey) {
      log.warn({ requestId }, "gc called but SUPABASE_SERVICE_ROLE_KEY is not set");
      return json(503, "feature_unavailable", "Storage GC is not configured on this deployment (SUPABASE_SERVICE_ROLE_KEY).");
    }

    const dryRun = isDryRun(req);
    const startedAt = Date.now();
    let summary: GcSummary;
    try {
      summary = await deps.run({ url: env.url, serviceKey: env.serviceKey, dryRun });
    } catch (err) {
      log.error({ requestId, dryRun, error: err instanceof Error ? err.message : String(err) }, "storage gc failed");
      return json(500, "internal_error", "Storage GC could not complete.");
    }
    const body = toResponseBody(summary);
    log.info(
      { requestId, dryRun, durationMs: Date.now() - startedAt, scanned: body.scanned, orphans: body.orphans, deleted: body.deleted, failed: body.failed, bytes: body.bytes, buckets: body.buckets },
      "storage gc summary",
    );
    if (summary.failures.length) {
      log.warn({ requestId, failures: summary.failures.map((f) => ({ bucket: f.bucket, count: f.names.length, error: f.error })) }, "storage gc: some deletes failed");
    }
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  };
}

const handler = createGcHandler();
export const GET = handler;
export const POST = handler;
