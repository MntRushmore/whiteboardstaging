import { checkRateLimit } from "@/lib/server/rate-limit";
import { isSameOrigin, parseJson, readCapped, startError, startLogger, visitorIp } from "@/lib/server/start/http";
import { cleanStartMeta, recordStartStepRow, spendStartStep, START_STEP_LIMITS, START_STEP_MAX_BYTES } from "@/lib/server/start/step";
import { StartStepRequestSchema } from "@/lib/start/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * POST /api/start/step — one step of the new onboarding before the account (`START_STEP_API`,
 * src/lib/start/contracts.ts), counted anonymously by journey: `record_start_step` with the
 * service role (supabase/migrations/20261013020000_start_steps.sql). The page sends it fire and
 * forget (src/lib/start/record.ts), so nothing here is ever in a family's way.
 *
 * PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs): the visitor has no account yet. In
 * order: not from our page (`isSameOrigin`) -> 403 `invalid_request`; this visitor's
 * `START_STEP_LIMITS.perVisitor` (by IP, `visitorIp`, in memory) -> 429 `rate_limited`; a body over
 * 2 KB -> 413, not `StartStepRequestSchema` -> 400 `invalid_request`; `start_account` -> 400 (only
 * `link_start_journey`, as the new account, records it); the day's `START_DAILY_STEPS` for
 * everyone -> 429 `rate_limited` until midnight UTC (fails open when its counter is unreachable);
 * no service role, or the database failing -> 503 `unavailable`. Then 204, no body.
 *
 * Kept: the row (the journey, the event, when, how often, and of the details only what the event
 * may keep: `cleanStartMeta`). Never the IP, never the body, and no log line names the journey.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const log = startLogger.child({ requestId, route: "start/step" });
  const done = (res: Response) => {
    res.headers.set("X-Request-Id", requestId);
    return res;
  };

  if (!isSameOrigin(req)) {
    log.info({ site: req.headers.get("sec-fetch-site"), origin: Boolean(req.headers.get("origin")) }, "start step refused: not from our page");
    return done(startError(403, "invalid_request"));
  }

  const mine = checkRateLimit(`ip:${visitorIp(req)}:startStep`, START_STEP_LIMITS.perVisitor);
  if (!mine.ok) return done(startError(429, "rate_limited", mine.retryAfterMs));

  const text = await readCapped(req, START_STEP_MAX_BYTES);
  if (text === null) return done(startError(413, "invalid_request"));
  const parsed = StartStepRequestSchema.safeParse(parseJson(text));
  if (!parsed.success) return done(startError(400, "invalid_request"));
  const { journeyId, event, meta } = parsed.data;
  if (event === "start_account") return done(startError(400, "invalid_request"));

  const cap = await spendStartStep();
  if (!cap.ok) {
    log.warn({ event }, "start step refused: the day's steps are spent");
    return done(startError(429, "rate_limited", cap.retryAfterMs));
  }

  const recorded = await recordStartStepRow({ journeyId, event, meta: cleanStartMeta(event, meta) });
  if (!recorded.ok) {
    log[recorded.status === 400 ? "info" : "warn"]({ event, reason: recorded.reason, ms: Date.now() - startedAt }, "start step not recorded");
    return done(startError(recorded.status, recorded.status === 400 ? "invalid_request" : "unavailable"));
  }
  log.debug({ event, dailyCap: cap.backend, ms: Date.now() - startedAt }, "start step");
  return done(new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }));
}
