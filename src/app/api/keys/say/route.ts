import { getLiveModels } from "@/lib/env";
import { sayable, tidyLine } from "@/lib/keys/copy";
import { SayRequestSchema, SayResponseSchema, type SayResponse } from "@/lib/keys/say";
import { livePreamble, withRequestId } from "@/lib/server/live-route";
import { chatJson } from "@/lib/server/openrouter";
import { buildKeysSayMessages, KeysSayReplySchema } from "@/lib/server/prompts/keysSay";
import { rereadReasoning } from "@/lib/server/prompts/reread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** The model's whole budget: the page stops waiting at 1.5 s (SAY_WAIT_MS), so a later line is wasted. */
const SAY_DEADLINE_MS = 1_400;

/** Lines already said, by request: the same slip on the same problem says the same thing (and costs nothing). */
const said = new Map<string, string>();
const SAID_MAX = 500;

/**
 * POST /api/keys/say — Agathon Keys' tutor line (docs/KEYS.md, Phase 2). The page sends the moment
 * (a Look again, a rung of the help ladder, a cheer), the named bug, the sub-step, the kid's grade
 * and its own fixed line (`src/lib/keys/copy.ts`); this answers with that line said in a coach's
 * voice, on the small fast model that names boards (`LIVE_MODEL_TITLE`, one attempt). The judgement never comes
 * from here: a reply that changes a number or says a word the tutor never says (`sayable`), a slow
 * model (1.4 s) or any failure answers the fixed line, 200, `source: "copy"`. Uncharged; the
 * `keysSay` rate limit bounds it.
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "keys-say", "keysSay", SayRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, log, data, startedAt } = ctx;

  const reply = (line: string, source: SayResponse["source"]) => {
    const body: SayResponse = SayResponseSchema.parse({ line, source, ms: Date.now() - startedAt });
    return withRequestId(Response.json(body, { headers: { "Cache-Control": "private, no-store" } }), requestId);
  };
  const copy = tidyLine(data.copy);
  const key = JSON.stringify([data.moment, data.bug, data.problem, data.step, data.level, data.grade, copy]);
  const known = said.get(key);
  if (known) return reply(known, "model");

  const models = getLiveModels();
  try {
    // One attempt, no fallback model: a second try would land after the page has stopped waiting.
    const model = models.title;
    const out = await chatJson({
      model,
      messages: buildKeysSayMessages({ ...data, copy }),
      schema: KeysSayReplySchema,
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(SAY_DEADLINE_MS)]),
      requestId,
      maxTokens: 80,
      temperature: 0.4,
      reasoningEffort: rereadReasoning(model),
      latencyFirst: true,
      title: "Agathon Keys - tutor line",
    });
    const line = tidyLine(out.line ?? "");
    const ok = sayable(line, copy);
    log.info({ model, ms: Date.now() - startedAt, moment: data.moment, bug: data.bug, kept: ok }, "keys line");
    if (!ok) return reply(copy, "copy");
    if (said.size >= SAID_MAX) said.delete(said.keys().next().value as string);
    said.set(key, line);
    return reply(line, "model");
  } catch (err) {
    log.info({ ms: Date.now() - startedAt, error: err instanceof Error ? err.message : String(err) }, "keys line: the fixed line");
    return reply(copy, "copy");
  }
}
