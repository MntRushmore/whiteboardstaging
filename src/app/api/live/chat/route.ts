import { getLiveModels } from "@/lib/env";
import { ChatRequestSchema, ChatResponseSchema, type ChatAction, type ChatResponse, type TeachAction, type WriteProofAction } from "@/lib/live/chat/contracts";
import { figureProblems } from "@/lib/live/chat/figure";
import { PROOF_CHECK, wantsHardProof } from "@/lib/live/chat/proof";
import type { LiveEngine } from "@/lib/live/contracts";
import { FigureSpecSchema } from "@/lib/live/figureDraw/contracts";
import { enforceInk, refundInk, runCharged } from "@/lib/server/billing";
import { gateChatProof, PROOF_NOT_WRITTEN } from "@/lib/server/chatProof";
import { gateChatTeach, TEACH_NOT_WRITTEN } from "@/lib/server/chatTeach";
import { chatJsonWithFallback } from "@/lib/server/openrouter";
import { errorResponse } from "@/lib/server/request";
import {
  actionTypes,
  buildChatMessages,
  buildFigureRepairMessages,
  buildProofRepairMessages,
  buildTeachRepairMessages,
  ChatReplyRawSchema,
  cleanChatActions,
  cleanReplyText,
  dropMissingProblems,
  FigureRepairReplySchema,
  ProofRepairReplySchema,
  teachFromRepair,
  TeachRepairReplySchema,
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
/** A worked solution's repair works the problem again (at most one per request). */
const TEACH_REPAIR_ATTEMPT_MS = 16_000;

const FIGURE_NOT_DRAWN = "The figure couldn't be drawn.";

/** The maths engine the teach check runs on, loaded on the first worked solution (mathjs, ~2 MB). */
let enginePromise: Promise<LiveEngine> | null = null;
function teachEngine(): Promise<LiveEngine> {
  enginePromise ??= import("@/lib/live/engine").then((m) => m.getEngine());
  return enginePromise;
}

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
 * A `teach` (a worked solution: "explain it step by step", "do the actual problem") goes on only
 * when the engine has checked every line of its maths (`gateChatTeach` → `checkTeach`, run here on
 * the engine, loaded on the first one); one it cannot check gets ONE repair round-trip with the
 * engine's findings, else it is dropped with a note — never written unchecked. Its figure, when the
 * drawer still finds problems with it after that, is left out and the working goes on.
 * A `help_problem` ("help me with 3") names a problem on the screen by its number there; one about
 * a number the screen does not have is dropped with a note ("There's no problem 7 on this
 * screen."), which is the reply when nothing else is left.
 *
 * Charged `live/chat` (3 ink) up front, refunded by `runCharged` on any non-2xx; a reply whose
 * every proposed action had to be dropped is refunded too (200, `refunded: true`), since the
 * student got nothing for it. A deliberate reply with no actions (a question back, a polite no to
 * something that is not maths) keeps the charge.
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "chat", "liveChat", ChatRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, log, data, startedAt } = ctx;

  const models = getLiveModels();
  const billing = await enforceInk({ token, route: "live/chat", requestId, model: models.chat }, log);
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

      /** One repair round-trip for a worked solution the engine could not check: the model gets its findings. */
      const repairTeach = async (action: TeachAction, problems: readonly string[]) => {
        try {
          const { data: fixed } = await chatJsonWithFallback(models.chat, models.chatFallback, {
            messages: buildTeachRepairMessages(data, action, problems),
            schema: TeachRepairReplySchema,
            signal: req.signal,
            requestId,
            maxTokens: 3000,
            reasoningFor: () => "low",
            latencyFirst: true,
            attemptTimeoutMs: TEACH_REPAIR_ATTEMPT_MS,
            title: "Agathon Live - chat teach",
          });
          return teachFromRepair(fixed);
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, "chat teach repair failed");
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
      // Worked solutions: every line checked by the engine (`gateChatTeach`), one repair, else dropped.
      let teachRepairs = 0;
      let teachesDropped = 0;
      let teachChecked = 0;
      // "the hardest proof ever" is held to it: a proof that takes a few rows is sent back once
      const proofCheck = wantsHardProof(data.message) ? { minRows: PROOF_CHECK.hardMinRows } : {};
      for (const action of valid) {
        if (action.type === "teach") {
          const gated = await gateChatTeach(action, await teachEngine(), teachRepairs === 0 ? (problems) => repairTeach(action, problems) : null);
          if (gated.repaired) teachRepairs++;
          if (gated.ok) {
            actions.push(gated.action);
            teachChecked += gated.checked;
            if (gated.figureDropped && !notes.includes(FIGURE_NOT_DRAWN)) notes.push(FIGURE_NOT_DRAWN);
          } else {
            teachesDropped++;
            dropped.push({ type: "teach", reason: gated.reason });
          }
          continue;
        }
        if (action.type === "write_proof") {
          const gated = await gateChatProof(action, proofRepairs === 0 ? (problems) => repairProof(action, problems) : null, proofCheck);
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
      if (figuresDropped > 0 && !notes.includes(FIGURE_NOT_DRAWN)) notes.push(FIGURE_NOT_DRAWN);
      if (proofsDropped > 0) notes.push(PROOF_NOT_WRITTEN);
      if (teachesDropped > 0) notes.push(TEACH_NOT_WRITTEN);

      // A screen added (or the tutor's ink cleared) only to make room for a figure, a proof or a
      // worked solution that could not be written is not something the student asked for: with
      // nothing else left, nothing is done.
      if (figuresDropped + proofsDropped + teachesDropped > 0 && actions.every((a) => a.type === "new_screen" || a.type === "clear_tutor")) actions.length = 0;

      // Help with a problem that is not on this screen: dropped, and the panel says there is none.
      const present = dropMissingProblems(actions, data.screen);
      actions.splice(0, actions.length, ...present.actions);
      dropped.push(...present.dropped);
      notes.push(...present.notes);

      // Nothing the model proposed survived: say so plainly, and give the ink back.
      let reply = cleanReplyText(raw.reply);
      let refunded = false;
      if (proposed > 0 && actions.length === 0) {
        reply =
          teachesDropped > 0
            ? "Sorry, I couldn't check that working, so I didn't write it. Try asking again."
            : proofsDropped > 0
              ? "Sorry, I couldn't check that proof, so I didn't write it. Try asking for another one."
              : figuresDropped > 0
                ? "Sorry, I couldn't draw that figure."
                : present.notes.length > 0
                  ? present.notes[0]
                  : "Sorry, I couldn't do that on the board. Try asking another way.";
        notes.length = 0;
        const r = await refundInk({ token, requestId }, log);
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
          teachRepairs,
          teachesDropped,
          teachChecked,
          problemSent: Boolean(data.problem),
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
