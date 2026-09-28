import { getLiveModels } from "@/lib/env";
import { ChatRequestSchema, ChatResponseSchema, type ChatAction, type ChatResponse, type WriteProofAction } from "@/lib/live/chat/contracts";
import { figureProblems } from "@/lib/live/chat/figure";
import { FigureSpecSchema } from "@/lib/live/figureDraw/contracts";
import { enforceCredits, refundCredits, runCharged } from "@/lib/server/billing";
import { gateChatProof, PROOF_NOT_WRITTEN } from "@/lib/server/chatProof";
import { chatJsonWithFallback } from "@/lib/server/openrouter";
import { errorResponse } from "@/lib/server/request";
import {
  actionTypes,
  buildChatMessages,
  buildFigureRepairMessages,
  buildProofRepairMessages,
  ChatReplyRawSchema,
  cleanChatActions,
  cleanReplyText,
  FigureRepairReplySchema,
  ProofRepairReplySchema,
} from "@/lib/server/prompts/chat";
import { livePreamble, withRequestId } from "@/lib/server/live-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

/** One attempt per model: a problem set or a figure spec is a longer reply than a setup. */
const CHAT_ATTEMPT_MS = 18_000;
/** The figure repair is one small call (at most one per request). */
const REPAIR_ATTEMPT_MS = 10_000;
/** A proof's repair carries its figure and statements back (at most one per request). */
const PROOF_REPAIR_ATTEMPT_MS = 14_000;

const FIGURE_NOT_DRAWN = "The figure couldn't be drawn.";

/**
 * POST /api/live/chat — the board chat: a typed request → `{ reply, actions }`. The model plans
 * (`LIVE_MODELS.chat`, fallback `chatFallback`; prompt `prompts/chat.ts`); every action is validated
 * with zod and an invalid one is dropped, never guessed at. A `draw_figure` the drawer reports
 * problems with (`checkFigure`, run here: pure, ~2 ms, no drawing code) gets ONE repair
 * round-trip with those problems — one per request, so it stays cheap — and is dropped otherwise,
 * with a note. A `write_proof` goes on only when the engine's proof planner proves it with the
 * figure's own geometry (`gateChatProof` → `checkProofProposal`, pure, a few ms); one it cannot
 * gets ONE repair round-trip with the engine's problems, else it is dropped with a note. The board
 * verifies every problem (`src/lib/live/chat/verify.ts`) and every proof again before writing it.
 *
 * Charged `live/chat` (3 credits) up front, refunded by `runCharged` on any non-2xx; a reply whose
 * every proposed action had to be dropped is refunded too (200, `refunded: true`), since the
 * student got nothing for it. A deliberate reply with no actions (a question back, a polite no to
 * something that is not maths) keeps the charge.
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "chat", "liveChat", ChatRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, log, data, startedAt } = ctx;

  const models = getLiveModels();
  const billing = await enforceCredits({ token, route: "live/chat", requestId, model: models.chat }, log);
  if ("response" in billing) return withRequestId(billing.response, requestId);

  return runCharged(
    { token, requestId },
    log,
    async () => {
      const { data: raw, model } = await chatJsonWithFallback(models.chat, models.chatFallback, {
        messages: buildChatMessages(data),
        schema: ChatReplyRawSchema,
        signal: req.signal,
        requestId,
        maxTokens: 3000,
        reasoningFor: () => "low",
        latencyFirst: true,
        attemptTimeoutMs: CHAT_ATTEMPT_MS,
        title: "Agathon Live - chat",
      });
      const proposed = raw.actions.length;
      const { actions: valid, dropped } = cleanChatActions(raw.actions);
      const notes: string[] = [];

      /** One repair round-trip for a proof the engine could not prove: the model gets the engine's problems. */
      const repairProof = async (action: WriteProofAction, problems: readonly string[]) => {
        try {
          const { data: fixed } = await chatJsonWithFallback(models.chat, models.chatFallback, {
            messages: buildProofRepairMessages(data.message, action, problems),
            schema: ProofRepairReplySchema,
            signal: req.signal,
            requestId,
            maxTokens: 2000,
            reasoningFor: () => "low",
            latencyFirst: true,
            attemptTimeoutMs: PROOF_REPAIR_ATTEMPT_MS,
            title: "Agathon Live - chat proof",
          });
          return fixed;
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, "chat proof repair failed");
          return null;
        }
      };

      // Figures: checked by the drawer; one repair round-trip when it stays cheap, else dropped.
      const actions: ChatAction[] = [];
      let repairs = 0;
      let figuresDropped = 0;
      // Proofs: proved by the engine's planner with the figure (`gateChatProof`), one repair, else dropped.
      let proofRepairs = 0;
      let proofsDropped = 0;
      for (const action of valid) {
        if (action.type === "write_proof") {
          const gated = await gateChatProof(action, proofRepairs === 0 ? (problems) => repairProof(action, problems) : null);
          if (gated.repaired) proofRepairs++;
          if (gated.ok) actions.push(gated.action);
          else {
            proofsDropped++;
            dropped.push({ type: "write_proof", reason: gated.reason });
          }
          continue;
        }
        if (action.type !== "draw_figure") {
          actions.push(action);
          continue;
        }
        let problems = figureProblems(action.figure);
        if (problems.length > 0 && repairs === 0) {
          repairs++;
          try {
            const { data: fixed } = await chatJsonWithFallback(models.chat, models.chatFallback, {
              messages: buildFigureRepairMessages(data.message, action.figure, problems),
              schema: FigureRepairReplySchema,
              signal: req.signal,
              requestId,
              maxTokens: 1500,
              reasoningFor: () => "low",
              latencyFirst: true,
              attemptTimeoutMs: REPAIR_ATTEMPT_MS,
              title: "Agathon Live - chat figure",
            });
            const spec = FigureSpecSchema.parse(fixed.figure);
            problems = figureProblems(spec);
            if (problems.length === 0) {
              actions.push({ type: "draw_figure", figure: spec });
              continue;
            }
          } catch (err) {
            log.warn({ err: err instanceof Error ? err.message : String(err) }, "chat figure repair failed");
          }
        }
        if (problems.length === 0) {
          actions.push(action);
          continue;
        }
        figuresDropped++;
        dropped.push({ type: "draw_figure", reason: problems.slice(0, 3).join("; ").slice(0, 160) });
      }
      if (figuresDropped > 0) notes.push(FIGURE_NOT_DRAWN);
      if (proofsDropped > 0) notes.push(PROOF_NOT_WRITTEN);

      // A screen added (or the tutor's ink cleared) only to make room for a figure or a proof that
      // could not be written is not something the student asked for: with nothing else left, nothing is done.
      if (figuresDropped + proofsDropped > 0 && actions.every((a) => a.type === "new_screen" || a.type === "clear_tutor")) actions.length = 0;

      // Nothing the model proposed survived: say so plainly, and give the credits back.
      let reply = cleanReplyText(raw.reply);
      let refunded = false;
      if (proposed > 0 && actions.length === 0) {
        reply =
          proofsDropped > 0
            ? "Sorry, I couldn't check that proof, so I didn't write it. Try asking for another one."
            : figuresDropped > 0
              ? "Sorry, I couldn't draw that figure."
              : "Sorry, I couldn't do that on the board. Try asking another way.";
        notes.length = 0;
        const r = await refundCredits({ token, requestId }, log);
        refunded = r.refunded > 0;
      }
      if (!reply) reply = actions.length > 0 ? "Here you go." : "I can only help with maths on this board.";

      const body: ChatResponse = ChatResponseSchema.parse({
        reply,
        actions,
        notes,
        ...(refunded ? { refunded } : {}),
        model,
        ms: Date.now() - startedAt,
      });
      log.info(
        {
          model,
          ms: body.ms,
          proposed,
          actions: actionTypes(actions),
          dropped: dropped.length,
          droppedWhy: dropped.slice(0, 4),
          repairs,
          proofRepairs,
          proofsDropped,
          refunded,
          history: data.history.length,
          screenEmpty: data.screen.empty,
        },
        "chat completed",
      );
      return withRequestId(Response.json(body), requestId);
    },
    (err) => withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt }), requestId),
  );
}
