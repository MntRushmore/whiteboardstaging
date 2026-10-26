/**
 * The picture tutor's app events (public.app_events, src/lib/server/events.ts), for the /admin
 * console, which reads app_events generically (no kind needs registering):
 *
 *  - `board_draw`: one per run. Level info when it drew, said "no help" or was cancelled; error when
 *    it failed (so a failing painter shows in the console's Issues, grouped by code). `meta` has the
 *    run id, mode, source, needsHelp, the timings, the cost, the models and how it ended.
 *  - `board_draw_outcome`: what the kid did with a drawing (accepted, rejected, cancelled, shown).
 *
 * No kid content: never the picture, never the instructions' text (their length only).
 *
 * The event writer writes the same kind + code + message for the same user once per 30 s; an info
 * row's message names its run, so two runs a few seconds apart are two rows. An error's message
 * does not (the Issues tab groups by it); repeats of one failure within 30 s are one row.
 */
import { recordEvent } from "@/lib/server/events";
import { BOARD_DRAW_EVENT, BOARD_DRAW_MODELS, BOARD_DRAW_OUTCOME_EVENT, type BoardDrawMode, type BoardDrawOutcome, type BoardDrawSource } from "./contracts";
import type { RunSummary } from "./run";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** app_events.user_id / board_id are uuids: anything else would void the whole event. */
const uuidOrUndefined = (id: string | undefined) => (id && UUID.test(id) ? id : undefined);

export const BOARD_DRAW_ROUTE = "/api/board/draw";

export function recordBoardDraw(ctx: {
  runId: string;
  userId: string;
  boardId?: string;
  clientRunId: string;
  mode: BoardDrawMode;
  source: BoardDrawSource;
  imageWidth: number;
  imageHeight: number;
  summary: RunSummary;
}): void {
  const s = ctx.summary;
  const failed = s.result === "error";
  recordEvent({
    source: "server",
    level: failed ? "error" : "info",
    kind: BOARD_DRAW_EVENT,
    code: failed ? (s.errorCode ?? "internal") : s.result,
    message: failed ? `Picture tutor run failed: ${s.errorCode ?? "internal"}` : `Picture tutor run ${ctx.runId}: ${s.result}`,
    route: BOARD_DRAW_ROUTE,
    userId: uuidOrUndefined(ctx.userId),
    boardId: uuidOrUndefined(ctx.boardId),
    requestId: ctx.runId,
    meta: {
      runId: ctx.runId,
      clientRunId: ctx.clientRunId.slice(0, 100),
      mode: ctx.mode,
      source: ctx.source,
      ok: s.result === "done" || s.result === "none",
      result: s.result,
      needsHelp: s.needsHelp,
      tutorSkipped: s.tutorSkipped,
      ...s.timings,
      costUsd: s.costUsd,
      tutorModel: s.tutorSkipped ? null : (s.tutorModel ?? null),
      painterModel: BOARD_DRAW_MODELS.painter,
      imageWidth: ctx.imageWidth,
      imageHeight: ctx.imageHeight,
      instructionsChars: s.instructionsChars,
      ...(s.overlayPx !== undefined ? { overlayPx: s.overlayPx } : {}),
      ...(s.alignScore !== undefined ? { alignScore: s.alignScore } : {}),
      ...(s.strokes !== undefined ? { strokes: s.strokes } : {}),
      ...(s.strokesDropped ? { strokesDropped: s.strokesDropped } : {}),
      ...(s.paints ? { paints: s.paints } : {}),
      ...(s.correct ? { correct: true } : {}),
      ...(s.simple ? { simple: s.simple } : {}),
      ...(s.readbackStrays?.length ? { readbackStrays: s.readbackStrays } : {}),
      ...(s.tutorWrongSums?.length ? { tutorWrongSums: s.tutorWrongSums, tutorRechecked: s.tutorRechecked ?? false } : {}),
      ...(s.errorCode ? { errorCode: s.errorCode, retryable: s.retryable ?? false } : {}),
      ...(s.upstreamStatus !== undefined ? { upstreamStatus: s.upstreamStatus } : {}),
    },
  });
}

export function recordBoardDrawOutcome(ctx: { userId: string; requestId: string } & BoardDrawOutcome): void {
  recordEvent({
    source: "server",
    level: "info",
    kind: BOARD_DRAW_OUTCOME_EVENT,
    code: ctx.outcome,
    message: `Picture tutor run ${ctx.runId.slice(0, 100)}: ${ctx.outcome}`,
    route: `${BOARD_DRAW_ROUTE}/outcome`,
    userId: uuidOrUndefined(ctx.userId),
    requestId: ctx.requestId,
    meta: { runId: ctx.runId.slice(0, 100), outcome: ctx.outcome },
  });
}
