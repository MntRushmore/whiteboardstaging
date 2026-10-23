import { logger } from "@/lib/logger";
import { json } from "@/lib/server/auth";
import { requireAdmin } from "@/lib/server/admin";
import { BoardDrawRequestSchema, MAX_IMAGE_SIDE, MIN_IMAGE_SIDE, type BoardDrawEvent } from "@/lib/server/boardDraw/contracts";
import { recordBoardDraw } from "@/lib/server/boardDraw/events";
import { ndjsonResponse } from "@/lib/server/boardDraw/ndjson";
import { dataUrlBytes, decodeRgb, imageSize, type Rgb } from "@/lib/server/boardDraw/overlay";
import { runBoardDraw, type RunSummary } from "@/lib/server/boardDraw/run";
import { withRequestId } from "@/lib/server/live-route";
import { checkRateLimitDistributed, rateLimitedResponse, type RateLimitBucket } from "@/lib/server/rate-limit";
import { parseJsonBody } from "@/lib/server/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// tutor ≤ 15 s + painter ≤ 30 s + the overlay and its strokes
export const maxDuration = 60;

const log = logger.child({ module: "board", route: "draw" });

/** Checked in this order: a call refused by the 10 minutes is not counted against the day. */
const BUCKETS: readonly RateLimitBucket[] = ["boardDraw", "boardDrawDay"];

/**
 * POST /api/board/draw — the picture tutor (Reed's system, sped up; src/lib/server/boardDraw/run.ts).
 * The contract (the iPad client is built against it) is src/lib/server/boardDraw/contracts.ts:
 * `{ image, mode, source, instructions?, boardId?, clientRunId }` → 200 application/x-ndjson,
 * `status` reading → `status` drawing → `done` | `none` | `error`, one JSON object a line.
 *
 * ADMIN ONLY for now: requireAdmin (requireUser(req) — 401 signed out — then the admins table: 404
 * for everyone else, 503 when that could not be checked). Then the per-user buckets `boardDraw`
 * (30 per 10 minutes) and `boardDrawDay` (200 a day) (429), the body (400), the picture: not an
 * image 400, a long side over 1600 px 413. The client cancels by aborting the request.
 *
 * TODO(open to students): charge for a run like the Live routes do — `enforceInk` before the
 * stream starts and a refund when the run ends in `error` (runChargedStream, src/lib/server/
 * live-route.ts; ROUTE_COSTS in src/lib/server/billing.ts) — and drop the admin gate for
 * requireUser. Nothing is charged while it is admin-only.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const gate = await requireAdmin(req);
  if ("response" in gate) return withRequestId(gate.response, requestId);
  const { user } = gate;
  // requireAdmin has verified this bearer token (requireUser); the limiter acts as the user with it
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization")?.trim() ?? "")?.[1]?.trim() ?? "";
  const rlog = log.child({ requestId, userId: user.id });

  for (const bucket of BUCKETS) {
    const rl = await checkRateLimitDistributed({ token, userId: user.id, bucket });
    if (!rl.ok) {
      rlog.warn({ bucket, retryAfterMs: rl.retryAfterMs, backend: rl.backend }, "board draw rate limited");
      return withRequestId(rateLimitedResponse(rl.retryAfterMs, rl.backend), requestId);
    }
  }

  const parsed = await parseJsonBody(req, BoardDrawRequestSchema);
  if ("response" in parsed) return withRequestId(parsed.response, requestId);
  const body = parsed.data;

  const bytes = dataUrlBytes(body.image);
  const size = await imageSize(bytes);
  if (!size || Math.min(size.width, size.height) < MIN_IMAGE_SIDE) {
    return withRequestId(json(400, "invalid_request", "image: not a picture this server can read.", { requestId }), requestId);
  }
  if (Math.max(size.width, size.height) > MAX_IMAGE_SIDE) {
    return withRequestId(
      json(413, "invalid_request", `image: the long side must be ${MAX_IMAGE_SIDE} px or less (got ${Math.max(size.width, size.height)}).`, { requestId, reason: "image_too_large" }),
      requestId,
    );
  }
  let board: Rgb;
  try {
    board = await decodeRgb(bytes);
  } catch {
    return withRequestId(json(400, "invalid_request", "image: not a picture this server can read.", { requestId }), requestId);
  }

  const runId = crypto.randomUUID();
  const runLog = rlog.child({ runId });
  runLog.info({ mode: body.mode, source: body.source, width: board.width, height: board.height, givenInstructions: body.instructions !== undefined }, "board draw started");

  const response = ndjsonResponse<BoardDrawEvent>(req, async (emit, signal) => {
    let summary: RunSummary;
    try {
      summary = await runBoardDraw({
        runId,
        requestId,
        imageDataUrl: body.image,
        board,
        mode: body.mode,
        source: body.source,
        instructions: body.instructions,
        signal,
        emit,
      });
    } catch (err) {
      runLog.error({ error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }, "board draw crashed");
      emit({ type: "error", message: "Something went wrong drawing on the board.", retryable: true });
      summary = {
        result: signal.aborted ? "aborted" : "error",
        needsHelp: null,
        tutorSkipped: false,
        timings: { tutorMs: 0, paintMs: 0, diffMs: 0, traceMs: 0, totalMs: 0 },
        costUsd: 0,
        instructionsChars: 0,
        errorCode: "internal",
        retryable: true,
      };
    }
    const fields = { result: summary.result, needsHelp: summary.needsHelp, ...summary.timings, costUsd: summary.costUsd, errorCode: summary.errorCode, upstreamStatus: summary.upstreamStatus };
    if (summary.result === "error") runLog.error(fields, "board draw failed");
    else runLog.info(fields, "board draw finished");
    recordBoardDraw({ runId, userId: user.id, boardId: body.boardId, clientRunId: body.clientRunId, mode: body.mode, source: body.source, imageWidth: board.width, imageHeight: board.height, summary });
  });
  return withRequestId(response, requestId);
}
