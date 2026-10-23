import { getLiveModels } from "@/lib/env";
import { ChatRequestSchema, ChatResponseSchema, type ChatResponse } from "@/lib/live/chat/contracts";
import { enforceInk, runCharged } from "@/lib/server/billing";
import { chatGate } from "@/lib/server/chatGate";
import { chatJsonWithFallback } from "@/lib/server/openrouter";
import { errorResponse } from "@/lib/server/request";
import { actionTypes, buildChatMessages, ChatReplyRawSchema, cleanReplyText } from "@/lib/server/prompts/chat";
import { livePreamble, withRequestId } from "@/lib/server/live-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

/** One attempt per model: a problem set or a figure spec is a longer reply than a setup. */
const CHAT_ATTEMPT_MS = 18_000;
/**
 * Everything the route does ends this long after it started (maxDuration 45). Two 18 s attempts and
 * a repair after them could run past 45 s, and the platform then kills the function: no event, no
 * refund, and the student waits for nothing. Every model call gets what is left of this
 * (`deadline`), and the gate does not start a repair with too little left (`chatGate`).
 */
const CHAT_BUDGET_MS = 40_000;

/**
 * POST /api/live/chat — the board chat: a typed request → `{ reply, actions }`. The model plans
 * (`LIVE_MODELS.chat`, fallback `chatFallback`; prompt `prompts/chat.ts`); what it proposes for the
 * board goes through the engine's gates (`chatGate`, shared with POST /api/live/ask): every action
 * validated with zod and an invalid one dropped, never guessed at; a figure checked by the drawer, a
 * proof proved by the engine's planner, a worked solution (`teach`) checked line by line, a problem
 * set verified problem by problem — each with ONE repair round-trip when it fails, else dropped (or
 * left out) with a note; help with a problem the screen does not have dropped with a note. The board
 * verifies every problem and every proof again before writing it. Every model call and repair fits
 * the route's time (`CHAT_BUDGET_MS`, `deadline`), so the platform never kills a request mid-way.
 *
 * Charged `live/chat` (3 ink) up front, refunded by `runCharged` on any non-2xx; a reply whose
 * every proposed action had to be dropped is refunded too (200, `refunded: true`), since the
 * student got nothing for it. A deliberate reply with no actions (a question back, a polite no to
 * something that is not maths) keeps the charge.
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "chat", "liveChat", ChatRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, user, log, data, startedAt } = ctx;

  const models = getLiveModels();
  const billing = await enforceInk({ token, route: "live/chat", requestId, model: models.chat, satQuestionId: ctx.satQuestionId }, log);
  if ("response" in billing) return withRequestId(billing.response, requestId);

  const deadline = startedAt + CHAT_BUDGET_MS;

  return runCharged(
    { userId: user.id, requestId },
    log,
    async () => {
      const { data: raw, model } = await chatJsonWithFallback(models.chat, models.chatFallback, {
        // the request as parsed, `learner` (weak skills, recurring mistakes) included
        messages: buildChatMessages(data),
        schema: ChatReplyRawSchema,
        signal: req.signal,
        requestId,
        maxTokens: 3000,
        reasoningFor: () => "low",
        latencyFirst: true,
        attemptTimeoutMs: CHAT_ATTEMPT_MS,
        deadline,
        title: "Agathon Live - chat",
      });
      const gate = await chatGate(raw.actions, {
        request: data,
        models: { primary: models.chat, fallback: models.chatFallback },
        route: "chat",
        model,
        signal: req.signal,
        requestId,
        userId: user.id,
        log,
        startedAt,
        deadline,
      });

      // Nothing the model proposed survived: the gate's words replace the reply (the ink is back).
      let reply = gate.replacement ?? cleanReplyText(raw.reply);
      if (!reply) reply = gate.actions.length > 0 ? "Here you go." : "I can only help with maths on this board.";

      const body: ChatResponse = ChatResponseSchema.parse({
        reply,
        actions: gate.actions,
        notes: gate.notes,
        ...(gate.refunded ? { refunded: true } : {}),
        model,
        ms: Date.now() - startedAt,
      });
      log.info(
        {
          model,
          ms: body.ms,
          proposed: gate.proposed,
          actions: actionTypes(gate.actions),
          dropped: gate.dropped.length,
          droppedWhy: gate.dropped.slice(0, 4),
          ...gate.stats,
          problemSent: Boolean(data.problem),
          learnerWeak: data.learner?.weakSkills.length ?? 0,
          refunded: gate.refunded,
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
