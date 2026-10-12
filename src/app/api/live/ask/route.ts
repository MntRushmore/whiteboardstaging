import { after } from "next/server";
import { getLiveModels } from "@/lib/env";
import { ASK_BOARD_OPEN, ASK_EVENTS, AskBoardBlockSchema, AskRequestSchema, type AskErrorEvent } from "@/lib/live/ask/contracts";
import { AskStreamSplitter } from "@/lib/live/ask/splitter";
import type { ChatAction } from "@/lib/live/chat/contracts";
import { EMPTY_ASK_CONTEXT, loadAskContext, rememberFromTurn, saveAskTurns, type AskStoreCaller } from "@/lib/server/ask/store";
import { explains, keepExplanation } from "@/lib/server/askReply";
import { enforceInk } from "@/lib/server/billing";
import { chatGate } from "@/lib/server/chatGate";
import { livePreamble, runChargedStream, withRequestId } from "@/lib/server/live-route";
import { CreditsExhaustedError, streamWithFallback, UpstreamError, WatchdogTimeoutError } from "@/lib/server/openrouter";
import { ASK_MAX_TOKENS, askReasoningFor, buildAskMessages, cleanAskReply } from "@/lib/server/prompts/ask";
import { actionTypes, type DroppedAction } from "@/lib/server/prompts/chat";
import { PROVIDER_UNAVAILABLE_MESSAGE, recordRouteEvent } from "@/lib/server/request";
import { repairJsonEscapes, sseResponse } from "@/lib/server/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Room past ASK_BUDGET_MS for what runs after the response: `after()` (the memory model, up to two
 * MEMORY_ATTEMPT_MS attempts, then its write) shares the function's time, and at 60 s a long
 * answer's 50 s plus saving left it too little. The stream's own budget is unchanged.
 */
export const maxDuration = 90;

/**
 * The primary's first words. Haiku 5.5 streamed its first in 0.75 s on 2026-10-11 (GPT-5.4 mini in
 * 1.5 s): 5 s of nothing is a stuck provider, and the student is staring at the panel.
 */
const ASK_WATCHDOG_MS = 5_000;
/** The fallback's own first-words watchdog: a stuck fallback is an error the student can retry, not a minute of nothing. */
const ASK_FALLBACK_WATCHDOG_MS = 10_000;
/**
 * The answer's stream ends this long after the route started (both models), so the engine's gates
 * still have time for a repair after a long answer.
 */
const ASK_STREAM_MS = 40_000;
/**
 * Everything the response does ends this long after the route started: the stream, then the gates'
 * repairs (`chatGate` starts none without enough left), then saving the turn. A model that never
 * finishes fails with an event and a refund, not a silent kill by the platform. The rest of
 * maxDuration (90) is the memory update's, in `after()`.
 */
const ASK_BUDGET_MS = 50_000;
/** An answer that was only a board block (the panel still says something). */
const BOARD_ONLY_REPLY = "Take a look at your board.";

/**
 * As little reasoning as each model takes, measured per model on `npm run eval:ask`
 * (`askReasoningFor`, prompts/ask.ts): Ask is a conversation, and the student watches the first
 * words arrive. With its default, Sonnet 5.5 thinks first and its answer lands all at once after
 * 3–4 s; at "minimal" its first words come in about a second. A model the eval did not measure
 * gets "low" ("minimal" for OpenAI's).
 */
function askReasoning(model: string): "none" | "minimal" | "low" {
  return askReasoningFor(model) ?? (model.startsWith("openai/") ? "minimal" : "low");
}

/**
 * The board block's actions, read leniently: `{"actions":[…]}` (more than the contract's 12 are cut,
 * not refused), or one bare action. `invalid` says why a block could not be read at all.
 */
function readBoardBlock(json: string): { actions: unknown[] } | { invalid: string } {
  let parsed: unknown;
  try {
    // LaTeX in JSON strings with single backslashes (`\frac`), as every model writes it
    parsed = JSON.parse(repairJsonEscapes(json));
  } catch {
    return { invalid: "not JSON" };
  }
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (!obj) return { invalid: "not an object" };
  const candidate = !("actions" in obj) && typeof obj.type === "string" ? { actions: [obj] } : Array.isArray(obj.actions) ? { ...obj, actions: obj.actions.slice(0, 12) } : obj;
  const block = AskBoardBlockSchema.safeParse(candidate);
  if (!block.success) return { invalid: `${block.error.issues[0]?.path.join(".") || "block"}: ${block.error.issues[0]?.message ?? "invalid"}`.slice(0, 120) };
  return { actions: block.data.actions };
}

/** A failure as the stream's `error` event: the codes the panel maps to its words (never ink: the student is not out of it). */
function askErrorPayload(err: unknown): AskErrorEvent {
  if (err instanceof CreditsExhaustedError) return { code: "credits_exhausted", message: PROVIDER_UNAVAILABLE_MESSAGE, status: 503 };
  const timedOut =
    err instanceof WatchdogTimeoutError || (err instanceof UpstreamError && err.status === 504) || (err instanceof Error && err.name === "TimeoutError");
  if (timedOut) return { code: "timeout", message: "The tutor took too long to answer. Please try again.", status: 504 };
  if (err instanceof UpstreamError) return { code: "upstream", message: "The tutor had a hiccup. Please try again.", status: 502 };
  return { code: "internal", message: "Something went wrong on our side. Please try again.", status: 500 };
}

/** The kinds of action written, each once, in order (a saved turn keeps these, never the content). */
const kinds = (actions: readonly ChatAction[]) => [...new Set(actions.map((a) => a.type))];

/**
 * POST /api/live/ask — Ask, rebuilt (docs/ASK-V2.md): the board chat as a tutor, streamed as
 * Server-Sent Events (`ASK_EVENTS`, src/lib/live/ask/contracts.ts).
 *
 * The model (`LIVE_MODELS.ask`, fallback `askFallback` from another provider; prompt
 * `prompts/ask.ts`, which puts the screen's picture in the user message) answers in Markdown-lite
 * and may end with ONE `<board>{"actions":[…]}</board>` block. The reply's words go out as they come
 * (`delta`, split from the block by `AskStreamSplitter`); a stuck primary hands over to the fallback
 * after ASK_WATCHDOG_MS (`model` again). Then the block's actions go through the same engine gates as
 * POST /api/live/chat (`chatGate`, repairs on Ask's models) and out as `actions`, after the final
 * `reply` (cleaned; when nothing proposed survived, its sentences about the board taken out and the
 * gate's line about what failed added: `keepExplanation`). A block that is not JSON is dropped with
 * a log and an event, never a crash, and counts as a proposal that did not survive.
 *
 * The exchange is saved on the board (`saveAskTurns`: the student's turn with its `clientId`, the
 * tutor's with its notes and the kinds of action it wrote); `done` carries the tutor turn's id, or
 * none when saving failed (the chat goes on, unsaved). After the response, the memory model reads
 * the exchange (`rememberFromTurn`, with `after()`): it never holds the stream.
 *
 * Charged `live/chat` (3 ink) up front, as the old chat. Out of ink, rate limited, signed out or a
 * bad body are the usual JSON errors, before any stream. Once streaming, a failure is an `error`
 * event and the ink comes back in full (the reply was cut short and nothing is saved). A reply whose
 * every proposed action was dropped is refunded (`done.refunded`) only when the gate's failure line
 * is all that is left of it; an explanation kept above the line keeps the charge, as any answer
 * does. A student who leaves aborts the model call; nothing is saved, and the ink comes back unless
 * the reply had begun.
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "ask", "liveChat", AskRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, user, log, data, startedAt } = ctx;

  const models = getLiveModels();
  const caller: AskStoreCaller = { token, userId: user.id };
  // what the tutor knows about the student, read while the ink is checked (never throws)
  const contextPending = loadAskContext(caller).catch(() => EMPTY_ASK_CONTEXT);

  const billing = await enforceInk({ token, route: "live/chat", requestId, model: models.ask }, log);
  if ("response" in billing) return withRequestId(billing.response, requestId);

  // The memory model runs after the response is sent: registered now, inside the request, and handed
  // the finished exchange at the end of the stream (none when it failed or the student left).
  let remember: (() => Promise<void>) | null = null;
  const rememberLater = async () => {
    const task = remember;
    remember = null;
    if (!task) return;
    try {
      await task();
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "ask: memory update failed");
    }
  };
  let deferred = false;
  try {
    after(rememberLater);
    deferred = true;
  } catch {
    // outside a request (a script, a test): `after` throws, and the memory runs at the end of the stream
  }

  /** the model answering (the fallback once it takes over) */
  let model = models.ask;
  const res = sseResponse(
    req,
    async (emit, signal) => {
      /** reply text the student has seen (`delta` events) */
      let shown = 0;
      // A failure at any point gives the ink back in full: the reply was cut short (or never came)
      // and nothing is saved, as the old chat's failures were. The charge is kept only when the
      // student left after the reply had begun: they read it. An app event either way (but a leave).
      const kept = () => signal.aborted && shown > 0;
      await runChargedStream({ userId: user.id, requestId }, log, kept, async () => {
        const learner = await contextPending;
        const messages = buildAskMessages(data, { learner });
        const splitter = new AskStreamSplitter();
        /** the whole answer as the model wrote it (a few KB): whether a board block was opened at all */
        let answer = "";
        let firstAt: number | null = null;
        const say = (text: string) => {
          if (!text) return;
          firstAt ??= Date.now();
          emit(ASK_EVENTS.delta, { text });
          shown++;
        };

        const events = streamWithFallback(
          models.ask,
          models.askFallback,
          { messages, signal, temperature: 0.4, maxTokens: ASK_MAX_TOKENS, reasoningFor: askReasoning, requestId, title: "Agathon Live - ask" },
          ASK_WATCHDOG_MS,
          { fallbackWatchdogMs: ASK_FALLBACK_WATCHDOG_MS, deadline: startedAt + ASK_STREAM_MS },
        );
        for await (const ev of events) {
          if (ev.type === "model") {
            model = ev.model;
            emit(ASK_EVENTS.model, { model });
          } else {
            answer += ev.text;
            say(splitter.push(ev.text));
          }
        }
        const end = splitter.end();
        say(end.tail);
        const streamedAt = Date.now();

        // The board block: read leniently; one that is not JSON is dropped, never a crash. A block
        // opened with no whole object in it (the model ran out of tokens) is one that could not be read.
        const block = end.board !== null ? readBoardBlock(end.board) : answer.includes(ASK_BOARD_OPEN) ? { invalid: "no JSON object" } : null;
        const unread: DroppedAction[] = [];
        if (block && "invalid" in block) {
          unread.push({ type: "board", reason: block.invalid });
          log.warn({ model, why: block.invalid, chars: end.board?.length ?? 0, overflow: splitter.overflow }, "ask: the board block could not be read; dropped");
          recordRouteEvent(log, {
            level: "warn",
            code: "board_invalid",
            message: `The board block could not be read (${block.invalid})`,
            meta: { model, why: block.invalid, chars: end.board?.length ?? 0, overflow: splitter.overflow },
          });
        }
        const raw = block && "actions" in block ? block.actions : [];

        let reply = cleanAskReply(end.reply);
        // nothing at all: the model failed, said as one (an `error` event, the ink back)
        if (!reply && raw.length === 0 && unread.length === 0) throw new UpstreamError(502, `${model} returned an empty answer`);

        const gate = await chatGate(
          raw,
          {
            request: data,
            models: { primary: models.ask, fallback: models.askFallback },
            reasoningFor: askReasoning,
            route: "ask",
            model,
            signal,
            requestId,
            userId: user.id,
            log,
            startedAt,
            deadline: startedAt + ASK_BUDGET_MS,
            // The ink comes back only when the failure line is all the student sees: a real
            // explanation kept above it was the answer they paid for ("explain X in detail, then
            // put problem 99 on my board" is not a free answer when problem 99 fails).
            refundWhen: () => !explains(reply),
          },
          unread,
        );
        // Nothing proposed survived: the explanation stays, its claims of board work go, and the
        // gate's line says what failed (the line alone when little else was said).
        if (gate.replacement) reply = keepExplanation(reply, gate.replacement);
        if (!reply) reply = BOARD_ONLY_REPLY;

        emit(ASK_EVENTS.reply, { text: reply });
        emit(ASK_EVENTS.actions, { actions: gate.actions, notes: gate.notes });

        // The student left before the end: what they saw is not a finished exchange to keep.
        if (signal.aborted) {
          log.info({ model, ms: Date.now() - startedAt, shown }, "ask: the client left before the end; not saved");
          return;
        }

        let turnId: string | undefined;
        try {
          const ids = await saveAskTurns(caller, data.boardId, [
            { role: "user", text: data.message, ...(data.clientId ? { clientId: data.clientId } : {}) },
            { role: "tutor", text: reply, notes: gate.notes, wrote: kinds(gate.actions) },
          ]);
          // the tutor's turn is the last saved
          turnId = ids?.at(-1);
          if (!ids) log.warn({ boardId: data.boardId }, "ask: the exchange was not saved");
        } catch (err) {
          log.warn({ boardId: data.boardId, err: err instanceof Error ? err.message : String(err) }, "ask: the exchange was not saved");
        }

        const memory = learner.memory;
        remember = () => rememberFromTurn(caller, { message: data.message, reply, memory });
        if (!deferred) void rememberLater();

        const ms = Date.now() - startedAt;
        log.info(
          {
            model,
            ms,
            ttftMs: firstAt === null ? null : firstAt - startedAt,
            streamMs: streamedAt - startedAt,
            proposed: gate.proposed,
            actions: actionTypes(gate.actions),
            dropped: gate.dropped.length,
            droppedWhy: gate.dropped.slice(0, 4),
            ...gate.stats,
            refunded: gate.refunded,
            replaced: gate.replacement !== null,
            replyChars: reply.length,
            boardChars: end.board?.length ?? 0,
            image: Boolean(data.screen.image),
            history: data.history.length,
            voice: Boolean(data.voice),
            screenEmpty: data.screen.empty,
            problemSent: Boolean(data.problem),
            learnerWeak: data.learner?.weakSkills.length ?? 0,
            memoryNotes: memory.length,
            saved: turnId !== undefined,
          },
          "ask completed",
        );
        emit(ASK_EVENTS.done, { model, ms, ...(gate.refunded ? { refunded: true } : {}), ...(turnId ? { turnId } : {}) });
      }).catch((err: unknown) => {
        // the model call was aborted with the student; nothing is saved
        if (signal.aborted) log.info({ model, ms: Date.now() - startedAt, shown, chargeKept: shown > 0 }, "ask abandoned by the client");
        throw err;
      });
    },
    {
      headers: { "X-Request-Id": requestId },
      onError: (err) => {
        log.error({ error: err instanceof Error ? err.message : String(err), model, ms: Date.now() - startedAt }, "ask failed");
        return { event: ASK_EVENTS.error, data: askErrorPayload(err) };
      },
    },
  );
  return withRequestId(res, requestId);
}
