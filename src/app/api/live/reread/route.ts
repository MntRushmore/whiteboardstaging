import { RereadRequestSchema, RereadResponseSchema, type RereadResponse } from "@/lib/live/contracts";
import { getLiveModels } from "@/lib/env";
import { enforceCredits, runCharged } from "@/lib/server/billing";
import { chatJsonWithFallback } from "@/lib/server/openrouter";
import { errorResponse } from "@/lib/server/request";
import { buildRereadMessages, cleanRereadLatex, rereadReasoning, RereadReplySchema } from "@/lib/server/prompts/reread";
import { livePreamble, withRequestId } from "@/lib/server/live-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One attempt per model; the benchmark's p95 for the reread models was ≤ 1.3 s. */
const REREAD_ATTEMPT_MS = 8_000;

/**
 * POST /api/live/reread — the second reader. The client sends it only on a signal (a read the
 * engine cannot make sense of, a symbol that is odd in its column, or a low-confidence read) and
 * at most once per ink. The reply is the model's transcription; the client keeps Mathpix's read
 * unless the new one differs, parses with the engine and has no words. Charged `live/reread`
 * (1 credit, like recognize), refunded by `runCharged` on any non-2xx.
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "reread", "liveReread", RereadRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, log, data, startedAt } = ctx;

  const models = getLiveModels();
  const billing = await enforceCredits({ token, route: "live/reread", requestId, model: models.reread }, log);
  if ("response" in billing) return withRequestId(billing.response, requestId);

  return runCharged(
    { token, requestId },
    log,
    async () => {
      const { data: reply, model } = await chatJsonWithFallback(models.reread, models.rereadFallback, {
        messages: buildRereadMessages(data),
        schema: RereadReplySchema,
        signal: req.signal,
        requestId,
        maxTokens: 800,
        reasoningFor: rereadReasoning,
        latencyFirst: true,
        attemptTimeoutMs: REREAD_ATTEMPT_MS,
        title: "Agathon Live - reread",
      });
      const latex = cleanRereadLatex(reply.latex);
      const body: RereadResponse = RereadResponseSchema.parse({ latex, changed: reply.changed, model, ms: Date.now() - startedAt });
      log.info({ model, ms: body.ms, changed: body.changed, same: latex === data.latex.trim() }, "reread completed");
      return withRequestId(Response.json(body), requestId);
    },
    (err) => withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt }), requestId),
  );
}
