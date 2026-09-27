import { getLiveModels } from "@/lib/env";
import { ProofRequestSchema, ProofResponseSchema, type ProofResponse } from "@/lib/live/proof/contracts";
import { enforceCredits, runCharged } from "@/lib/server/billing";
import { chatJsonWithFallback, UpstreamError } from "@/lib/server/openrouter";
import { errorResponse } from "@/lib/server/request";
import { buildProofFigureMessages, buildProofStepMessages, cleanFigureReply, cleanStepReply, FigureReplySchema, StepReplySchema } from "@/lib/server/prompts/proof";
import { livePreamble, withRequestId } from "@/lib/server/live-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One attempt per model (the setup pair answers in ~2 s at p95). */
const PROOF_ATTEMPT_MS = 12_000;

/**
 * POST /api/live/proof — two-column geometry proofs, only on an explicit ask and only when the
 * engine cannot do without it (`src/lib/live/proof`):
 *
 *  - `task: "figure"` + `crop`: what the proof's figure draws — its labelled points and the straight
 *    lines through them (the engine derives vertical angles, alternate interior angles…);
 *  - `task: "step"`: one next row `{ statement, reason }` for a proof the planner could not finish,
 *    which the client writes only when its checker ticks it.
 *
 * `LIVE_MODELS.proof` (`openai/gpt-5.4-mini`), fallback `proofFallback` (`deepseek/deepseek-v4.1-flash`).
 * Charged `live/proof` (2 credits), refunded by `runCharged` on any non-2xx — an empty read or an
 * empty row is a 502.
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "proof", "liveProof", ProofRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, log, data, startedAt } = ctx;

  const models = getLiveModels();
  const billing = await enforceCredits({ token, route: "live/proof", requestId, model: models.proof }, log);
  if ("response" in billing) return withRequestId(billing.response, requestId);

  return runCharged(
    { token, requestId },
    log,
    async () => {
      const common = { signal: req.signal, requestId, maxTokens: 1500, reasoningFor: () => "low" as const, latencyFirst: true, attemptTimeoutMs: PROOF_ATTEMPT_MS };
      let body: ProofResponse;
      if (data.task === "figure") {
        const { data: reply, model } = await chatJsonWithFallback(models.proof, models.proofFallback, {
          ...common,
          messages: buildProofFigureMessages(data),
          schema: FigureReplySchema,
          title: "Agathon Live - proof figure",
        });
        const figure = cleanFigureReply(reply);
        if (Object.keys(figure.points).length < 3 || figure.lines.length === 0) throw new UpstreamError(502, "The model read no figure");
        body = ProofResponseSchema.parse({ figure, model, ms: Date.now() - startedAt });
        log.info({ model, ms: body.ms, points: Object.keys(figure.points).length, lines: figure.lines.length }, "proof figure read");
      } else {
        const { data: reply, model } = await chatJsonWithFallback(models.proof, models.proofFallback, {
          ...common,
          messages: buildProofStepMessages(data),
          schema: StepReplySchema,
          title: "Agathon Live - proof step",
        });
        const row = cleanStepReply(reply);
        if (!row) throw new UpstreamError(502, "The model returned no row");
        body = ProofResponseSchema.parse({ row, model, ms: Date.now() - startedAt });
        log.info({ model, ms: body.ms, rows: data.rows.length }, "proof step written");
      }
      return withRequestId(Response.json(body), requestId);
    },
    (err) => withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt }), requestId),
  );
}
