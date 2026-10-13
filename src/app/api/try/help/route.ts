import { getEngine } from "@/lib/live/engine";
import { tryEnabled } from "@/lib/env";
import { withRequestId } from "@/lib/server/live-route";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { errorResponse } from "@/lib/server/request";
import { nextTryStep } from "@/lib/server/try/help";
import { isSameOrigin, parseJson, readCapped, TRY_HELP_MAX_BYTES, tryError, tryLogger, visitorIp } from "@/lib/server/try/http";
import { tryInk } from "@/lib/server/try/ink";
import { TRY_LIMITS, TryHelpRequestSchema, TryHelpResponseSchema } from "@/lib/try/contracts";
import { tryProblem } from "@/lib/try/problems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * POST /api/try/help — "Show me a step" on the try board (src/lib/try/contracts.ts): the next line
 * under the visitor's work from the engine's local solve (`nextTryStep`), in the tutor's hand
 * (`tryInk`: SVG paths and a writing schedule; null when the hand cannot write the line). No read,
 * no model: nothing it does costs anything but this server's time.
 *
 * PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs), with the check's guards less the day's
 * cap on reads: `TRY_ENABLED=0` -> 503 `unavailable`; not from our page -> 403 `invalid_request`; a
 * body over 16 KB -> 413, not the schema or an unknown problem id -> 400 `invalid_request`; this
 * visitor's `TRY_LIMITS.help` (in memory) -> 429 `rate_limited`. Then 200 `{ latex, ink, solves }`,
 * `latex` null when the problem is solved already or the engine has no step.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const log = tryLogger.child({ requestId, route: "help" });
  const done = (res: Response) => withRequestId(res, requestId);
  try {
    if (!tryEnabled()) return done(tryError(503, "unavailable"));
    if (!isSameOrigin(req)) {
      log.info({ site: req.headers.get("sec-fetch-site"), origin: Boolean(req.headers.get("origin")) }, "try help refused: not from our page");
      return done(tryError(403, "invalid_request"));
    }

    const text = await readCapped(req, TRY_HELP_MAX_BYTES);
    if (text === null) return done(tryError(413, "invalid_request"));
    const parsed = TryHelpRequestSchema.safeParse(parseJson(text));
    if (!parsed.success) return done(tryError(400, "invalid_request"));
    const problem = tryProblem(parsed.data.problemId);
    if (!problem) return done(tryError(400, "invalid_request"));

    const mine = checkRateLimit(`ip:${visitorIp(req)}:tryHelp`, TRY_LIMITS.help);
    if (!mine.ok) return done(tryError(429, "rate_limited", mine.retryAfterMs));

    const engine = await getEngine();
    const step = nextTryStep(engine, problem, parsed.data.work);
    const ink = step.latex ? tryInk(problem, step.latex) : null;
    const body = TryHelpResponseSchema.parse({ latex: step.latex, ink, solves: step.latex ? step.solves : false });
    log.info({ band: problem.band, problem: problem.id, lines: parsed.data.work.length, step: Boolean(step.latex), ink: Boolean(ink), solves: body.solves, ms: Date.now() - startedAt }, "try help");
    return done(Response.json(body, { headers: { "Cache-Control": "no-store" } }));
  } catch (err) {
    return done(errorResponse(err, log, { ms: Date.now() - startedAt }));
  }
}
