import { SetupRequestSchema, SetupResponseSchema, type SetupResponse } from "@/lib/live/contracts";
import { getLiveModels } from "@/lib/env";
import { enforceCredits, runCharged } from "@/lib/server/billing";
import { chatJsonWithFallback, UpstreamError } from "@/lib/server/openrouter";
import { errorResponse } from "@/lib/server/request";
import { buildSetupMessages, cleanSetupReply, SetupReplySchema } from "@/lib/server/prompts/setup";
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
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "setup", "liveSetup", SetupRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, log, data, startedAt } = ctx;

  const models = getLiveModels();
  const billing = await enforceCredits({ token, route: "live/setup", requestId, model: models.setup }, log);
  if ("response" in billing) return withRequestId(billing.response, requestId);

  return runCharged(
    { token, requestId },
    log,
    async () => {
      const { data: reply, model } = await chatJsonWithFallback(models.setup, models.setupFallback, {
        messages: buildSetupMessages(data),
        schema: SetupReplySchema,
        signal: req.signal,
        requestId,
        maxTokens: 1500,
        reasoningFor: () => "low",
        latencyFirst: true,
        attemptTimeoutMs: SETUP_ATTEMPT_MS,
        title: "Agathon Live - setup",
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
      log.info({ model, ms: body.ms, lines: body.lines.length, problemLines: data.lines.length }, "setup completed");
      return withRequestId(Response.json(body), requestId);
    },
    (err) => withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt }), requestId),
  );
}
