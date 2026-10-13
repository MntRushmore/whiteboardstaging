import { getEngine } from "@/lib/live/engine";
import { tryEnabled } from "@/lib/env";
import { withRequestId } from "@/lib/server/live-route";
import { isMathpixConfigured, recognizeStrokes } from "@/lib/server/mathpix";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { RECOGNIZER_FAILED_STATUS } from "@/lib/server/recognizeHints";
import { errorResponse } from "@/lib/server/request";
import { spendTryRead } from "@/lib/server/try/dailyCap";
import { isSameOrigin, parseJson, readCapped, TRY_CHECK_MAX_BYTES, tryError, tryLogger, visitorIp } from "@/lib/server/try/http";
import { judgeTryLine } from "@/lib/server/try/judge";
import { TRY_LIMITS, TryCheckRequestSchema, TryCheckResponseSchema, type TryCheckResponse } from "@/lib/try/contracts";
import { tryProblem } from "@/lib/try/problems";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * POST /api/try/check — "Try it free" (src/lib/try/contracts.ts, docs/TRY-BOARD.md): one line a
 * signed-out visitor wrote under a try problem, read and checked. One Mathpix strokes read (no vision
 * fallback, no model), then the board's own engine judges it on the server (`judgeTryLine`).
 *
 * PUBLIC BY DESIGN (allow-listed in scripts/lib/routes.mjs): the visitor has no account. In order:
 *  1. `TRY_ENABLED=0` -> 503 `unavailable`;
 *  2. not from our own page (`isSameOrigin`: `Sec-Fetch-Site`, else `Origin`) -> 403 `invalid_request`;
 *  3. a body over 1 MB -> 413 `invalid_request`; not the schema, or a problem id we do not have ->
 *     400 `invalid_request` (the problem's lines are ours, looked up by id, never the page's);
 *  4. no reader configured -> 503 `unavailable` (before anything is counted);
 *  5. this visitor's reads (`TRY_LIMITS.read`, by `cf-connecting-ip`, else x-forwarded-for; in
 *     memory) -> 429 `rate_limited` with `retryAfterMs`;
 *  6. everyone's reads today (`TRY_DAILY_READS`, in the database; fails open: `dailyCap.ts`) -> 429;
 *  7. the read: Mathpix answering that it could not read the ink is a 200 `unread`; Mathpix failing
 *     (credentials, HTTP, timeout, network) is `upstream_error` — with status 503, not the contract's
 *     502, because Cloudflare in front of www swaps every 502 for its own HTML page
 *     (`RECOGNIZER_FAILED_STATUS`) and the page would never see the JSON;
 *  8. 200 `{ latex, verdict, note }`.
 *
 * One info line per read (verdict, band, problem, times; never strokes, never an IP). Nothing about
 * the visitor is stored: the strokes go to Mathpix (which keeps nothing: `improve_mathpix: false`)
 * and are dropped.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const log = tryLogger.child({ requestId, route: "check" });
  const done = (res: Response) => withRequestId(res, requestId);
  try {
    if (!tryEnabled()) return done(tryError(503, "unavailable"));
    if (!isSameOrigin(req)) {
      log.info({ site: req.headers.get("sec-fetch-site"), origin: Boolean(req.headers.get("origin")) }, "try check refused: not from our page");
      return done(tryError(403, "invalid_request"));
    }

    const text = await readCapped(req, TRY_CHECK_MAX_BYTES);
    if (text === null) return done(tryError(413, "invalid_request"));
    const parsed = TryCheckRequestSchema.safeParse(parseJson(text));
    if (!parsed.success) return done(tryError(400, "invalid_request"));
    const { problemId, work, strokes, bounds } = parsed.data;
    const problem = tryProblem(problemId);
    if (!problem) return done(tryError(400, "invalid_request"));
    if (!isMathpixConfigured()) return done(tryError(503, "unavailable"));

    const mine = checkRateLimit(`ip:${visitorIp(req)}:tryCheck`, TRY_LIMITS.read);
    if (!mine.ok) {
      log.info({ band: problem.band, retryAfterMs: mine.retryAfterMs }, "try check: visitor's reads spent");
      return done(tryError(429, "rate_limited", mine.retryAfterMs));
    }
    const day = await spendTryRead();
    if (!day.ok) {
      log.warn({ band: problem.band, retryAfterMs: day.retryAfterMs }, "try check: the day's reads are spent");
      return done(tryError(429, "rate_limited", day.retryAfterMs));
    }

    const readAt = Date.now();
    const read = await recognizeStrokes({ x: strokes.x, y: strokes.y, w: bounds.w, h: bounds.h }, req.signal, { requestId, log });
    const readMs = Date.now() - readAt;
    let body: TryCheckResponse;
    if (read.ok) {
      const engine = await getEngine();
      const judged = judgeTryLine(engine, problem, work, read.latex, { confidence: read.confidence });
      body = TryCheckResponseSchema.parse({ latex: read.latex, verdict: judged.verdict, note: judged.note });
    } else if (read.reason === "api_error") {
      // Mathpix read the strokes and found nothing it could make out: the visitor's to write again
      body = { latex: "", verdict: "unread", note: null };
    } else if (read.reason === "unconfigured") {
      return done(tryError(503, "unavailable"));
    } else {
      log.warn({ reason: read.reason, status: read.status, band: problem.band, readMs }, "try check: the reader failed");
      return done(tryError(RECOGNIZER_FAILED_STATUS, "upstream_error"));
    }

    log.info(
      {
        verdict: body.verdict,
        band: problem.band,
        problem: problem.id,
        lines: work.length,
        strokes: strokes.x.length,
        confidence: read.ok ? Math.round(read.confidence * 100) / 100 : null,
        readMs,
        ms: Date.now() - startedAt,
        dailyCap: day.backend,
      },
      "try read",
    );
    return done(Response.json(body, { headers: { "Cache-Control": "no-store" } }));
  } catch (err) {
    return done(errorResponse(err, log, { ms: Date.now() - startedAt }));
  }
}
