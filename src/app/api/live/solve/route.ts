import { LIVE_LIMITS, SolveRequestSchema, SolveStepSchema, type LiveEngine, type SolveStep } from "@/lib/live/contracts";
import { createSolveStepJudge, engineParsesStep, type SolveStepJudge } from "@/lib/live/solveSteps";
import { getLiveModels } from "@/lib/env";
import { enforceInk, refundInk } from "@/lib/server/billing";
import { streamWithFallback, type ChatMessage, type FallbackStreamEvent, type StreamLimits } from "@/lib/server/openrouter";
import { recordRouteEvent } from "@/lib/server/request";
import { jsonlToEvents, sseResponse, type SseEmit } from "@/lib/server/sse";
import { buildSolveMessages, buildSolveRetryMessages } from "@/lib/server/prompts/solve";
import { livePreamble, runChargedStream, sseErrorPayload, withRequestId } from "@/lib/server/live-route";
import { normalizeStep } from "@/lib/server/live-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The primary's first sign of life. It was 8 s of no CONTENT, and GPT-5.4 mini's thinking counted
 * as silence: in production the hardest problems went to the weaker fallback (one, 2026-10-07, after
 * 8 s of thinking, got DeepSeek's steps the board then refused, and the student "Couldn't solve
 * this one"). Content or a reasoning delta is life now, and the first wait is longer.
 */
const SOLVE_WATCHDOG_MS = 12_000;
/** A primary that is thinking (reasoning deltas) may go this long before its first step. */
const SOLVE_THINKING_MS = 20_000;
/** The fallback's own first-content watchdog (it had none: a stuck fallback ran until the platform killed the function). */
const SOLVE_FALLBACK_WATCHDOG_MS = 15_000;
/**
 * Everything the route does ends this long after it started (maxDuration 60): a model that never
 * finishes fails with an event and a refund, not a silent kill by the platform.
 */
const SOLVE_BUDGET_MS = 55_000;
/** The one retry after unusable steps is only worth starting with at least this long left. */
const SOLVE_RETRY_MIN_MS = 10_000;

/** The engine the board checks the steps with, loaded on the first solve (mathjs, ~2 MB). */
let enginePromise: Promise<LiveEngine> | null = null;
function solveEngine(): Promise<LiveEngine> {
  enginePromise ??= import("@/lib/live/engine").then((m) => m.getEngine());
  enginePromise.catch(() => {
    enginePromise = null;
  });
  return enginePromise;
}

async function* textDeltas(
  events: AsyncIterable<FallbackStreamEvent>,
  emit: SseEmit,
  requestId: string,
  onModel: (model: string) => void,
): AsyncGenerator<string> {
  let announced: string | null = null;
  for await (const ev of events) {
    if (ev.type === "model") {
      onModel(ev.model);
      if (announced !== null) emit("meta", { requestId, model: ev.model });
      announced = ev.model;
    } else {
      yield ev.text;
    }
  }
}

/**
 * POST /api/live/solve — the model's worked solution, streamed as steps (JSON Lines → `step`
 * frames). The board draws a step only when its interlock accepts it (`createSolveStepGuard`), and
 * when it accepts none the student is told "Couldn't solve this one". The route runs the same judge
 * (`createSolveStepJudge`) on what it sends: when the model answered but the board will draw none of
 * it, it asks the primary ONCE more — with the refused steps and why — within its time budget, and
 * streams those steps too (the board takes the ones it accepts). A solve the board can draw nothing
 * of is an event (`unusable_steps`, with the first refusal's reason) and is refunded. A stream that
 * fails is refunded only before its first step, as before (`runChargedStream`).
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "solve", "liveSolve", SolveRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, user, log, data, startedAt } = ctx;

  const models = getLiveModels();

  // Charge ink before opening the stream (a 402/503 JSON body, not SSE). The charge is
  // refunded if the stream fails before the first step (runChargedStream), never after.
  const billing = await enforceInk({ token, route: "live/solve", requestId, model: models.solve }, log);
  if ("response" in billing) return withRequestId(billing.response, requestId);

  const messages = buildSolveMessages(data);
  const deadline = startedAt + SOLVE_BUDGET_MS;

  const res = sseResponse(
    req,
    async (emit, signal) => {
      let sent = 0;
      // The board's engine loads while the model answers (it judges the steps once they are all in;
      // a judge is sequential and pure, so judging at the end is judging as they came). Null when it
      // would not load: then nothing is judged, as before.
      const enginePending = solveEngine().catch((err: unknown) => {
        log.warn({ error: err instanceof Error ? err.message : String(err) }, "solve: the engine did not load; steps are not judged");
        return null;
      });
      let judge: SolveStepJudge | null = null;
      const judged = async (steps: readonly SolveStep[]) => {
        const engine = await enginePending;
        if (!engine) return;
        judge ??= createSolveStepJudge({ sourceLatex: data.lines.map((l) => l.latex), parses: (latex) => engineParsesStep(engine, latex) });
        for (const step of steps) judge.judge(step.latex);
      };
      await runChargedStream({ userId: user.id, requestId }, log, () => sent > 0, async () => {
        let model = models.solve;
        emit("meta", { requestId, model });

        /** One model answer, its steps sent as they come (each attempt numbers its own from 1). */
        const run = async (events: AsyncIterable<FallbackStreamEvent>) => {
          let own = 0;
          const steps: SolveStep[] = [];
          let pending: SolveStep | null = null;
          const flush = (isLast: boolean) => {
            if (!pending) return;
            const step = normalizeStep(isLast ? { ...pending, final: true } : pending, own + 1);
            emit("step", step);
            steps.push(step);
            own++;
            sent++;
            pending = null;
          };
          const result = await jsonlToEvents(
            textDeltas(events, emit, requestId, (m) => {
              model = m;
            }),
            SolveStepSchema,
            (step) => {
              // Hold one step back so the final one can be forced `final: true` at the cap / end of stream.
              flush(false);
              pending = step;
              if (own + 1 >= LIVE_LIMITS.maxSolveSteps) {
                flush(true);
                return false;
              }
              return true;
            },
            (line, reason) => log.debug({ reason, line: line.slice(0, 200) }, "dropped invalid step line"),
          );
          flush(true);
          return { ...result, steps };
        };

        const limits: StreamLimits = { primaryThinkingMs: SOLVE_THINKING_MS, fallbackWatchdogMs: SOLVE_FALLBACK_WATCHDOG_MS, deadline };
        const first = await run(
          streamWithFallback(
            models.solve,
            models.solveFallback,
            { messages, signal, temperature: 0.2, reasoningEffort: "low", maxTokens: 1500, requestId, title: "Agathon Live - solve" },
            SOLVE_WATCHDOG_MS,
            limits,
          ),
        );

        await judged(first.steps);

        // The model answered, and the board will draw none of it: once more, with why.
        let retried = false;
        const firstRejection = judge?.firstRejection ?? null;
        const unusable = () => Boolean(judge && judge.drawn === 0 && judge.discarded > 0);
        if (unusable() && firstRejection && !signal.aborted && deadline - Date.now() >= SOLVE_RETRY_MIN_MS) {
          retried = true;
          const firstModel = model;
          log.info({ model: firstModel, reason: firstRejection.reason, introduced: firstRejection.introduced, steps: first.steps.length }, "solve: no usable step; asking once more");
          const retryMessages: ChatMessage[] = buildSolveRetryMessages(data, first.steps, firstRejection);
          emit("meta", { requestId, model: models.solve });
          const again = await run(
            streamWithFallback(
              models.solve,
              "",
              { messages: retryMessages, signal, temperature: 0.2, reasoningEffort: "low", maxTokens: 1500, requestId, title: "Agathon Live - solve" },
              // the primary with the time that is left (no fallback: the time is the point)
              Math.max(1000, deadline - Date.now()),
              { deadline },
            ),
          ).catch((err: unknown) => {
            // the first answer stands (and is what the board was told); the retry only failed to improve it
            if (signal.aborted) throw err;
            log.warn({ error: err instanceof Error ? err.message : String(err) }, "solve: the retry failed");
            return null;
          });
          if (again) await judged(again.steps);
        }

        const ms = Date.now() - startedAt;
        if (unusable()) {
          // Nothing the board can draw: the student gets "Couldn't solve this one". An event (the
          // report from the board joins it by request id) and the ink back.
          recordRouteEvent(log, {
            level: "warn",
            code: "unusable_steps",
            message: `No step the board could draw (${firstRejection?.reason ?? "unknown"})`,
            meta: {
              model,
              reason: firstRejection?.reason ?? "unknown",
              introduced: firstRejection?.introduced.slice(0, 4).join(",") ?? "",
              steps: sent,
              retried,
              ms,
            },
          });
          await refundInk({ userId: user.id, requestId }, log);
        }
        log.info(
          { model, ms, sent, usable: judge?.drawn ?? null, discarded: judge?.discarded ?? null, retried, parsed: first.count, invalid: first.invalid, lines: data.lines.length },
          "solve completed",
        );
        emit("done", { count: sent, ms });
      });
    },
    {
      headers: { "X-Request-Id": requestId },
      onError: (err) => {
        log.error({ error: err instanceof Error ? err.message : String(err), ms: Date.now() - startedAt }, "solve failed");
        return { event: "error", data: sseErrorPayload(err) };
      },
    },
  );
  return withRequestId(res, requestId);
}
