import type { LiveModels } from "@/lib/env";
import { figureProblems } from "@/lib/live/chat/figure";
import type { FigureSpec } from "@/lib/live/figureDraw/contracts";
import type { z } from "zod";
import type { LectureAction, LectureRequestSchema } from "@/lib/live/lecture/contracts";
import { chatJsonWithFallback, type ChatJsonFallbackOptions } from "@/lib/server/openrouter";
import { buildLectureMessages, cleanLectureActions, LectureReplyRawSchema, type LectureDroppedAction, type LectureReplyRaw } from "@/lib/server/prompts/lecture";

/**
 * Lecture mode's director, the one place a tick is decided: the request (recent transcript, what
 * is drawn) → the model → the actions the board will sketch. The route (`/api/live/lecture`) calls
 * it with the production models; the eval (`src/__eval__/lecture`) calls it with its own cached,
 * priced model client — so the eval measures exactly what the route does, without HTTP, auth or
 * billing.
 *
 * ONE model call (primary, then the fallback once) and no repair round-trip: a tick is one
 * credit, asked every few seconds while anyone talks (`LECTURE_TIMING`). What the model proposes
 * is validated against the shared contract and anything wrong is dropped, never guessed at
 * (`cleanLectureActions`): a figure the drawer rejects, a heading that is already the topic,
 * something already drawn, a bullet that says again what one on the board says, a comic nobody
 * asked for (cut to its first panel), an update that is not its live visual grown.
 *
 * SLIDES: each tick carries a sentence or two of fresh speech, and the reply builds the slide as
 * the lecture goes — a title when the topic changes, a bullet for each point as it is made, the
 * visual's next number or step. The call is the same for every tick, and short.
 */

/** One attempt per model: a title, two bullets and a chart is a short reply. Two attempts fit the route's 30 s. */
export const LECTURE_ATTEMPT_MS = 13_000;
/** Room for a heading, two bullets, a 12-label chart with 3 series, and low reasoning before them. */
export const LECTURE_MAX_TOKENS = 2000;

/**
 * The least reasoning that keeps the director right, because a tick comes every few seconds and the
 * student waits for it: "minimal" for OpenAI's models (the eval, docs/eval/lecture.md: GPT-5.4 mini
 * as right at "minimal" as at "low" on the single ticks and the live sequences, with a shorter
 * tail), "low" for the others (DeepSeek's fallback was measured there), none for Anthropic's (its
 * thinking budget starts at 1024 tokens).
 */
export function lectureReasoning(model: string): "minimal" | "low" | undefined {
  if (model.startsWith("anthropic/")) return undefined;
  return model.startsWith("openai/") ? "minimal" : "low";
}

/** The model call, as `chatJsonWithFallback` makes it (the eval passes its own client in this shape). */
export type LectureModelCall = (primary: string, fallback: string, opts: ChatJsonFallbackOptions<typeof LectureReplyRawSchema>) => Promise<{ data: LectureReplyRaw; model: string }>;

export interface LectureDirectorDeps {
  models: Pick<LiveModels, "lecture" | "lectureFallback">;
  signal?: AbortSignal;
  requestId?: string;
  /** default: `chatJsonWithFallback` (OpenRouter) */
  callModel?: LectureModelCall;
  /** the figure drawer's check (tests); default `checkFigure`, run through `figureProblems` either way */
  checkFigure?: (spec: FigureSpec) => string[];
}

export interface LectureDirection {
  /** what the board sketches, in order (at most `LECTURE_LIMITS.actions`) */
  actions: LectureAction[];
  /** what was dropped, in words for the panel after "Draw that" */
  notes: string[];
  /** how many actions the model proposed (for the log and the eval) */
  proposed: number;
  dropped: LectureDroppedAction[];
  /** the model that answered */
  model: string;
}

/**
 * Lecture mode is billed per minute of a session, not per question (`live/lecture`, 2 credits): the
 * first request in each wall-clock minute of a session is charged under this id, and the others
 * that minute find the charge already there. The id is the charge's `usage_events.request_id` (a
 * user's own row, which they may read), so a failed charging request is refunded under it and the
 * next request that minute pays instead.
 */
export function lectureMinuteId(session: string, atMs: number): string {
  return `lec:${session}:${Math.floor(atMs / 60_000)}`;
}

export const FIGURE_NOT_DRAWN = "The figure couldn't be drawn.";
export const SKETCH_NOT_DRAWN = "Part of the sketch couldn't be drawn, so it was left out.";

/** The panel's words for what was dropped (shown after "Draw that"): once each, only what the student would miss. */
export function droppedNotes(dropped: readonly LectureDroppedAction[]): string[] {
  const notes: string[] = [];
  const add = (s: string) => {
    const t = s.slice(0, 200);
    if (!notes.includes(t) && notes.length < 8) notes.push(t);
  };
  if (dropped.some((d) => d.why === "figure")) add(FIGURE_NOT_DRAWN);
  if (dropped.some((d) => d.why === "unknown" || d.why === "invalid" || d.why === "target")) add(SKETCH_NOT_DRAWN);
  for (const d of dropped) if (d.why === "repeat" && d.what) add(`Already on the board: ${d.what}`);
  return notes;
}

/** The request as the route has parsed it (`LectureRequestSchema`: defaults filled in). */
export type ParsedLectureRequest = z.output<typeof LectureRequestSchema>;

export async function directLecture(data: ParsedLectureRequest, deps: LectureDirectorDeps): Promise<LectureDirection> {
  const call = deps.callModel ?? chatJsonWithFallback;
  const { data: raw, model } = await call(deps.models.lecture, deps.models.lectureFallback, {
    messages: buildLectureMessages(data),
    schema: LectureReplyRawSchema,
    signal: deps.signal,
    requestId: deps.requestId,
    maxTokens: LECTURE_MAX_TOKENS,
    reasoningFor: lectureReasoning,
    latencyFirst: true,
    attemptTimeoutMs: LECTURE_ATTEMPT_MS,
    title: "Agathon Live - lecture",
  });
  const proposed = raw.actions.length;
  const check = (spec: FigureSpec) => figureProblems(spec, deps.checkFigure);
  const drawn = [...data.screen.drawn, ...data.recent];
  // what was said, for "was a comic asked for?": the request may have come a tick or two before its panels
  const said = `${data.context} ${data.fresh}`;
  const { actions, dropped } = cleanLectureActions(raw.actions, { topic: data.screen.topic, drawn, figureProblems: check, active: data.screen.active, said });
  return { actions, notes: droppedNotes(dropped), proposed, dropped, model };
}
