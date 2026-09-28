import { SetupRequestSchema, SetupResponseSchema, type SetupResponse } from "@/lib/live/contracts";
import { FigureReplySchema } from "@/lib/live/figure";
import { getLiveModels } from "@/lib/env";
import { enforceCredits, runCharged } from "@/lib/server/billing";
import { chatJsonWithFallback, UpstreamError } from "@/lib/server/openrouter";
import { errorResponse } from "@/lib/server/request";
import { buildSetupMessages, cleanSetupReply, SetupReplySchema, type SetupReply } from "@/lib/server/prompts/setup";
import { buildFigureMessages, figureReasoning, figureSetup } from "@/lib/server/prompts/figure";
import { livePreamble, withRequestId } from "@/lib/server/live-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One attempt per model; the benchmark's p95 for the setup models was ≤ 2.2 s. */
const SETUP_ATTEMPT_MS = 12_000;

/**
 * POST /api/live/setup — a word problem → the equations under it (LaTeX only, no arithmetic
 * done, no words). The client solves them with the local engine and writes setup + steps by
 * hand; when the setup is unusable it falls back to /api/live/solve. Charged `live/setup`
 * (below solve), refunded by `runCharged` on any non-2xx.
 *
 * With a `crop` it is a hand-drawn FIGURE ("the tutor reads the figure"): a vision model
 * (`LIVE_MODELS.figure`, prompt `prompts/figure.ts`) describes what the figure shows — which label
 * is which angle or side, and the relationships the drawing marks — and `planFigure` turns that
 * into the equations (`figure.source: "facts"`); when the description does not hold up, the model's
 * own setup lines come back instead (`source: "lines"`). Same price, same bucket.
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "setup", "liveSetup", SetupRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, log, data, startedAt } = ctx;

  const models = getLiveModels();
  const figure = Boolean(data.crop);
  const [primary, fallback] = figure ? [models.figure, models.figureFallback] : [models.setup, models.setupFallback];
  const billing = await enforceCredits({ token, route: "live/setup", requestId, model: primary }, log);
  if ("response" in billing) return withRequestId(billing.response, requestId);

  return runCharged(
    { token, requestId },
    log,
    async () => {
      const { data: reply, model } = await chatJsonWithFallback(primary, fallback, {
        messages: figure ? buildFigureMessages(data) : buildSetupMessages(data),
        schema: figure ? FigureReplySchema : SetupReplySchema,
        signal: req.signal,
        requestId,
        maxTokens: 1500,
        reasoningFor: figure ? figureReasoning : () => "low",
        latencyFirst: true,
        attemptTimeoutMs: SETUP_ATTEMPT_MS,
        title: figure ? "Agathon Live - figure" : "Agathon Live - setup",
      });
      const setup = figure ? figureSetup(reply, data) : cleanSetupReply(reply as SetupReply);
      // Nothing to set up is a failed call for billing (refunded); the board falls back to solve.
      if (setup.lines.length === 0) throw new UpstreamError(502, "The model returned no setup lines");
      const body: SetupResponse = SetupResponseSchema.parse({
        lines: setup.lines,
        ...(setup.unknown ? { unknown: setup.unknown } : {}),
        ...("figure" in setup && setup.figure ? { figure: setup.figure } : {}),
        ...("sketch" in setup && setup.sketch ? { sketch: setup.sketch } : {}),
        model,
        ms: Date.now() - startedAt,
      });
      log.info(
        {
          model,
          ms: body.ms,
          lines: body.lines.length,
          problemLines: data.lines.length,
          figure,
          labels: data.labels?.length ?? 0,
          ...(body.figure ? { source: body.figure.source, reason: body.figure.reason, stages: body.figure.stages?.length ?? 0 } : {}),
          sketch: Boolean(body.sketch),
          ...("sketchDropped" in setup && setup.sketchDropped ? { sketchDropped: setup.sketchDropped } : {}),
        },
        "setup completed",
      );
      return withRequestId(Response.json(body), requestId);
    },
    (err) => withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt }), requestId),
  );
}
