import type pino from "pino";
import { getLiveModels } from "@/lib/env";
import { LectureRequestSchema, LectureResponseSchema, type LectureResponse } from "@/lib/live/lecture/contracts";
import { billingEnforced, enforceCredits, runCharged, userClient } from "@/lib/server/billing";
import { directLecture, lectureMinuteId } from "@/lib/server/lectureDirector";
import { errorResponse } from "@/lib/server/request";
import { livePreamble, withRequestId } from "@/lib/server/live-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Two attempts of `LECTURE_ATTEMPT_MS` (the primary, then the fallback once) and the checks. */
export const maxDuration = 30;

/**
 * POST /api/live/lecture — lecture mode's director: the recent transcript, what is already drawn
 * and the screen's live visuals → `{ actions }`, usually none, often one update of a live chart or
 * diagram while numbers or steps are coming. The client asks every ~8 s while they are, every
 * ~40 s otherwise, and at once when the student taps "Draw that" (`force`). The work is
 * `directLecture` (`src/lib/server/lectureDirector.ts`: one model call, `LIVE_MODELS.lecture` then
 * `lectureFallback`; every action validated against the shared contract and an invalid one
 * dropped, never guessed at).
 *
 * BILLED PER MINUTE of a session, not per request: `live/lecture` (1 credit) is charged by the
 * first request in each wall-clock minute of `session` (`lectureMinuteId`), and `charged: true`
 * says so. The others that minute find that charge (the user's own `usage_events` row, readable
 * by them) and are free. A charging request that fails is refunded by `runCharged` (the row is
 * deleted), so the next request that minute is charged instead; a free request that fails refunds
 * nothing (it would give back the minute another request paid for). A reply with nothing drawn,
 * or everything dropped, keeps the charge: the minute of listening is the product.
 *
 * The session asks one request at a time, so two requests of one session never race for a
 * minute; a client that sent them in parallel could only pay twice for it, never not at all.
 *
 * The transcript is never logged (it is what was said in a classroom): only its size.
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "lecture", "liveLecture", LectureRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId: traceId, token, user, log, data, startedAt } = ctx;
  const models = getLiveModels();
  const minute = lectureMinuteId(data.session, startedAt);

  const direct = async (charged: boolean): Promise<Response> => {
    const { actions, notes, proposed, dropped, model } = await directLecture(data, { models, signal: req.signal, requestId: traceId });
    const body: LectureResponse = LectureResponseSchema.parse({ actions, notes, charged, model, ms: Date.now() - startedAt });
    log.info(
      {
        model,
        ms: body.ms,
        charged,
        minute,
        force: data.force,
        proposed,
        // a sketch by its panel count (its prompts are what was said: not logged)
        actions: actions
          .map((a) => (a.type === "chart" || a.type === "update_chart" ? `${a.type}:${a.chart.kind}` : a.type === "diagram" || a.type === "update_diagram" ? `${a.type}:${a.diagram.kind}` : a.type === "sketch" ? `sketch:${a.panels.length}` : a.type))
          .join(","),
        dropped: dropped.length,
        // why, and the schema's or the drawer's reason; a repeat's reason is lecture content (its title)
        droppedWhy: dropped.slice(0, 4).map((d) => ({ type: d.type, why: d.why, ...(d.why === "repeat" ? {} : { reason: d.reason }) })),
        freshChars: data.fresh.length,
        contextChars: data.context.length,
        drawn: data.screen.drawn.length,
        active: data.screen.active.length,
        recent: data.recent.length,
        screenEmpty: data.screen.empty,
      },
      "lecture completed",
    );
    return withRequestId(Response.json(body), traceId);
  };
  const failed = (err: unknown) => withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt, charged: false }), traceId);

  /** The minute's charge: taken, and on any failure given back, under the minute's own id. */
  const charge = async (requestId: string): Promise<Response> => {
    const billing = await enforceCredits({ token, route: "live/lecture", requestId, model: models.lecture }, log);
    if ("response" in billing) return withRequestId(billing.response, traceId);
    return runCharged({ token, requestId }, log, () => direct(true), failed);
  };

  if (billingEnforced() && !(await minutePaid(token, user.id, minute, log))) return charge(minute);
  try {
    return await direct(false);
  } catch (err) {
    return failed(err);
  }
}

/**
 * Whether this minute of the session is paid already: the user's own charge row for it (RLS
 * "usage_events: owner select"; `refund_credits` deletes a refunded one). A lookup that fails
 * charges: a minute is never given away on an error.
 */
async function minutePaid(token: string, userId: string, requestId: string, log: pino.Logger): Promise<boolean> {
  try {
    const { data, error } = await userClient(token).from("usage_events").select("id").eq("user_id", userId).eq("request_id", requestId).limit(1);
    if (error) {
      log.warn({ error: error.message }, "lecture minute lookup failed; charging");
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, "lecture minute lookup failed; charging");
    return false;
  }
}
