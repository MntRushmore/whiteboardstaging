import { SetupRequestSchema, SetupResponseSchema, type SetupResponse } from "@/lib/live/contracts";
import { getLiveModels } from "@/lib/env";
import { enforceCredits, runCharged } from "@/lib/server/billing";
import { chatJsonWithFallback, UpstreamError } from "@/lib/server/openrouter";
import { errorResponse } from "@/lib/server/request";
import { buildSetupMessages, cleanSetupReply, SetupReplySchema } from "@/lib/server/prompts/setup";
import { buildFigureMessages, figureReasoning } from "@/lib/server/prompts/figure";
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
 * With a `crop` it is a hand-drawn FIGURE the student asked about ("the tutor reads the
 * figure"): the same reply, from a vision model that reads the image and the labels
 * (`LIVE_MODELS.figure`, prompt `prompts/figure.ts`). Same price, same bucket.
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
        schema: SetupReplySchema,
        signal: req.signal,
        requestId,
        maxTokens: 1500,
        reasoningFor: figure ? figureReasoning : () => "low",
        latencyFirst: true,
        attemptTimeoutMs: SETUP_ATTEMPT_MS,
        title: figure ? "Agathon Live - figure" : "Agathon Live - setup",
      });
      const setup = cleanSetupReply(reply);
      // Nothing to set up is a failed call for billing (refunded); the board falls back to solve.
      if (setup.lines.length === 0) throw new UpstreamError(502, "The model returned no setup lines");
      const body: SetupResponse = SetupResponseSchema.parse({
        lines: setup.lines,
        ...(setup.unknown ? { unknown: setup.unknown } : {}),
        model,
        ms: Date.now() - startedAt,
      });
      log.info({ model, ms: body.ms, lines: body.lines.length, problemLines: data.lines.length, figure, labels: data.labels?.length ?? 0 }, "setup completed");
      return withRequestId(Response.json(body), requestId);
    },
    (err) => withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt }), requestId),
  );
}
