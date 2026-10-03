import { getLiveModels } from "@/lib/env";
import { SketchRequestSchema, SketchResponseSchema, type SketchResponse } from "@/lib/live/lecture/contracts";
import { billingEnforced, enforceInk, runCharged } from "@/lib/server/billing";
import { errorResponse } from "@/lib/server/request";
import { livePreamble, withRequestId } from "@/lib/server/live-route";
import { illustrate, NoDrawingError } from "@/lib/server/sketch/illustrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The illustrator's attempts share `SKETCH_BUDGET_MS` (55 s): the primary, its one retry, the fallback. */
export const maxDuration = 60;

/**
 * POST /api/live/lecture/sketch — lecture mode's free drawing, one panel: a picture described in
 * words ("a futuristic police officer on a rooftop at night"), or one panel of a comic strip with
 * the cast every panel shares → `{ drawing }`, the illustrator's SVG sampled into ink strokes on
 * the server (`illustrate`, `src/lib/server/sketch`). A comic of four panels is four requests,
 * made together; each panel fills its frame on the board when it arrives.
 *
 * BILLED PER PANEL: `live/sketch` is charged before the model is asked, and refunded by
 * `runCharged` when no drawing comes back — an upstream error, every attempt timing out, or an SVG
 * with nothing drawable in it even after the retry and the fallback (a 502). A drawing that arrives
 * is charged even when the parser had to leave details out of it.
 *
 * The request's words are lecture content: never logged, only their size.
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "lecture/sketch", "liveSketch", SketchRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, user, log, data, startedAt } = ctx;
  const models = getLiveModels();
  const charged = billingEnforced();

  const billing = await enforceInk({ token, route: "live/sketch", requestId, model: models.sketch }, log);
  if ("response" in billing) return withRequestId(billing.response, requestId);

  const draw = async (): Promise<Response> => {
    const out = await illustrate(data, { models, signal: req.signal, requestId });
    const body: SketchResponse = SketchResponseSchema.parse({ drawing: out.drawing, model: out.model, ms: Date.now() - startedAt, charged });
    log.info(
      {
        model: out.model,
        ms: body.ms,
        charged,
        panel: data.panel ? `${data.panel.index + 1}/${data.panel.of}` : null,
        aspect: data.aspect,
        promptChars: data.prompt.length,
        castChars: data.cast?.length ?? 0,
        attempts: out.attempts.map((a) => ({ model: a.model, retry: a.retry, ok: a.ok, ms: a.ms, why: a.why, finish: a.finishReason, strokes: a.strokes })),
        strokes: out.stats.strokes,
        points: out.stats.points,
        labels: out.stats.labels,
        dropped: out.stats.dropped,
        ignored: out.stats.ignored,
        problems: out.problems.slice(0, 4),
      },
      "sketch drawn",
    );
    return withRequestId(Response.json(body), requestId);
  };
  const failed = (err: unknown) => {
    if (err instanceof NoDrawingError) log.warn({ attempts: err.attempts }, "sketch: no usable drawing");
    return withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt, charged }), requestId);
  };
  return runCharged({ userId: user.id, requestId }, log, draw, failed);
}
