import { LIVE_LIMITS, LIVE_TIMING, SolveRequestSchema, SolveStepSchema, type SolveStep } from "@/lib/live/contracts";
import { getLiveModels } from "@/lib/env";
import { enforceCredits } from "@/lib/server/billing";
import { streamWithFallback } from "@/lib/server/openrouter";
import { jsonlToEvents, sseResponse, type SseEmit } from "@/lib/server/sse";
import { buildSolveMessages } from "@/lib/server/prompts/solve";
import { livePreamble, sseErrorPayload, withRequestId } from "@/lib/server/live-route";
import { normalizeStep } from "@/lib/server/live-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Solve models think longer before the first token; give them twice the check watchdog. */
const SOLVE_WATCHDOG_MS = LIVE_TIMING.checkWatchdogMs * 2;

async function* textDeltas(
  events: AsyncIterable<{ type: "model"; model: string } | { type: "text"; text: string }>,
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

export async function POST(req: Request) {
  const ctx = await livePreamble(req, "solve", "liveSolve", SolveRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, log, data, startedAt } = ctx;

  const models = getLiveModels();

  // Charge credits before opening the stream (a 402/503 JSON body, not SSE).
  const billing = await enforceCredits({ token, route: "live/solve", requestId, model: models.solve }, log);
  if ("response" in billing) return withRequestId(billing.response, requestId);

  const messages = buildSolveMessages(data);

  const res = sseResponse(
    req,
    async (emit, signal) => {
      let model = models.solve;
      emit("meta", { requestId, model });

      const events = streamWithFallback(
        models.solve,
        models.solveFallback,
        {
          messages,
          signal,
          temperature: 0.2,
          reasoningEffort: "low",
          maxTokens: 1500,
          requestId,
          title: "Agathon Live - solve",
        },
        SOLVE_WATCHDOG_MS,
      );

      let sent = 0;
      let pending: SolveStep | null = null;
      const flush = (isLast: boolean) => {
        if (!pending) return;
        const step = isLast ? { ...pending, final: true } : pending;
        emit("step", normalizeStep(step, sent + 1));
        sent++;
        pending = null;
      };

      const { count, invalid } = await jsonlToEvents(
        textDeltas(events, emit, requestId, (m) => {
          model = m;
        }),
        SolveStepSchema,
        (step) => {
          // Hold one step back so the final one can be forced `final: true` at the cap / end of stream.
          flush(false);
          pending = step;
          if (sent + 1 >= LIVE_LIMITS.maxSolveSteps) {
            flush(true);
            return false;
          }
          return true;
        },
        (line, reason) => log.debug({ reason, line: line.slice(0, 200) }, "dropped invalid step line"),
      );
      flush(true);

      const ms = Date.now() - startedAt;
      log.info({ model, ms, sent, parsed: count, invalid, lines: data.lines.length }, "solve completed");
      emit("done", { count: sent, ms });
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
