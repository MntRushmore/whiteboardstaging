import { AnnotationSchema, CheckRequestSchema, LIVE_TIMING } from "@/lib/live/contracts";
import { getLiveModels } from "@/lib/env";
import { enforceCredits } from "@/lib/server/billing";
import { streamWithFallback } from "@/lib/server/openrouter";
import { jsonlToEvents, sseResponse, type SseEmit } from "@/lib/server/sse";
import { buildCheckMessages } from "@/lib/server/prompts/check";
import { livePreamble, sseErrorPayload, withRequestId } from "@/lib/server/live-route";
import { filterAnnotation } from "@/lib/server/live-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_ANNOTATIONS = 3;

/** Adapts the fallback stream into text deltas, announcing the active model via `meta`. */
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
      if (announced !== null) emit("meta", { requestId, model: ev.model }); // fallback engaged
      announced = ev.model;
    } else {
      yield ev.text;
    }
  }
}

export async function POST(req: Request) {
  const ctx = await livePreamble(req, "check", "liveCheck", CheckRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, token, log, data, startedAt } = ctx;

  const models = getLiveModels();

  // Charge credits before opening the stream (a 402/503 JSON body, not SSE).
  const billing = await enforceCredits({ token, route: "live/check", requestId, model: models.check }, log);
  if ("response" in billing) return withRequestId(billing.response, requestId);

  const messages = buildCheckMessages(data);

  const res = sseResponse(
    req,
    async (emit, signal) => {
      let model = models.check;
      emit("meta", { requestId, model });

      const events = streamWithFallback(
        models.check,
        models.checkFallback,
        {
          messages,
          signal,
          temperature: 0,
          reasoningEffort: "minimal",
          maxTokens: 600,
          requestId,
          title: "Agathon Live - check",
        },
        LIVE_TIMING.checkWatchdogMs,
      );

      let sent = 0;
      let dropped = 0;
      let firstAt: number | null = null;
      const { count, invalid } = await jsonlToEvents(
        textDeltas(events, emit, requestId, (m) => {
          model = m;
        }),
        AnnotationSchema,
        (annotation) => {
          const kept = filterAnnotation(annotation, data);
          if (!kept) {
            dropped++;
            return true;
          }
          if (firstAt === null) firstAt = Date.now();
          emit("annotation", kept);
          sent++;
          return sent < MAX_ANNOTATIONS;
        },
        (line, reason) => log.debug({ reason, line: line.slice(0, 200) }, "dropped invalid annotation line"),
      );

      const ms = Date.now() - startedAt;
      log.info(
        { model, ms, ttfaMs: firstAt === null ? null : firstAt - startedAt, sent, dropped, parsed: count, invalid, lines: data.lines.length, mode: data.mode },
        "check completed",
      );
      emit("done", { count: sent, ms });
    },
    {
      headers: { "X-Request-Id": requestId },
      onError: (err) => {
        log.error({ error: err instanceof Error ? err.message : String(err), ms: Date.now() - startedAt }, "check failed");
        return { event: "error", data: sseErrorPayload(err) };
      },
    },
  );
  return withRequestId(res, requestId);
}
