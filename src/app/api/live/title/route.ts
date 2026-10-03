import { getLiveModels } from "@/lib/env";
import { TitleRequestSchema, TitleResponseSchema, cleanSmartTitle, type TitleResponse } from "@/lib/boards/smartTitle";
import { chatJsonWithFallback } from "@/lib/server/openrouter";
import { errorResponse } from "@/lib/server/request";
import { buildTitleMessages, TitleReplySchema } from "@/lib/server/prompts/title";
import { rereadReasoning } from "@/lib/server/prompts/reread";
import { livePreamble, withRequestId } from "@/lib/server/live-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One attempt per model: a name is a nicety, and the page falls back to the first line. */
const TITLE_ATTEMPT_MS = 6_000;

/**
 * POST /api/live/title — a board's name from the maths on it ("Solving trig equations"). The
 * board page asks once the board has saved some maths, and at most a few times a session
 * (`useBoardAutoTitle`). Text only, on the second reader's small fast models. Not charged: it
 * costs a fraction of a cent, and the student never asked for it; the rate limit (`liveTitle`)
 * bounds it instead.
 */
export async function POST(req: Request) {
  const ctx = await livePreamble(req, "title", "liveTitle", TitleRequestSchema);
  if ("response" in ctx) return ctx.response;
  const { requestId, log, data, startedAt } = ctx;

  const models = getLiveModels();
  try {
    const { data: reply, model } = await chatJsonWithFallback(models.reread, models.rereadFallback, {
      messages: buildTitleMessages(data.lines),
      schema: TitleReplySchema,
      signal: req.signal,
      requestId,
      maxTokens: 120,
      reasoningFor: rereadReasoning,
      latencyFirst: true,
      attemptTimeoutMs: TITLE_ATTEMPT_MS,
      title: "Agathon Live - board title",
    });
    const title = cleanSmartTitle(reply.title);
    const body: TitleResponse = TitleResponseSchema.parse({ title, model, ms: Date.now() - startedAt });
    log.info({ model, ms: body.ms, named: title !== null, lines: data.lines.length }, "title completed");
    return withRequestId(Response.json(body), requestId);
  } catch (err) {
    return withRequestId(errorResponse(err, log, { ms: Date.now() - startedAt }), requestId);
  }
}
