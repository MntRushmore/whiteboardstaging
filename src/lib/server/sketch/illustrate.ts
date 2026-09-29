import type { z } from "zod";
import type { LiveModels } from "@/lib/env";
import type { SketchDrawing, SketchRequestSchema } from "@/lib/live/lecture/contracts";
import { CreditsExhaustedError, openrouterChat, UpstreamError, type ChatMessage } from "@/lib/server/openrouter";
import { buildSketchMessages } from "./prompt";
import { extractSvg, MIN_USABLE_STROKES, svgToDrawing, type SvgParseStats } from "./svg";

/**
 * Lecture mode's illustrator: one panel (a picture, or one panel of a comic strip) described in
 * words → the model's SVG → `SketchDrawing` strokes (`svg.ts`). The route (`/api/live/lecture/
 * sketch`) calls it with the production models; the eval (`src/__eval__/sketch`) with its own
 * cached, priced client — so the eval measures exactly what the route does.
 *
 * The attempts, within one budget (`SKETCH_BUDGET_MS`, inside the route's `maxDuration`):
 *  1. the primary (`LIVE_MODELS.sketch`);
 *  2. when its SVG yields nothing usable (no markup, nothing visible, fewer than
 *     `MIN_USABLE_STROKES` strokes, or a reply cut off at the token limit — half a knight is not
 *     a picture), the primary ONCE more, told what the parser found wrong;
 *  3. when that fails too, or the primary errs or times out, the fallback once, with whatever is
 *     left of the budget (a slower, careful model gets the time a fast one did not use).
 * Out of credits and the caller leaving are never retried. Nothing usable at the end throws
 * (`UpstreamError`), so the route answers 502 and the panel's credits are refunded.
 */

/**
 * The primary's attempt (and its retry): a drawing is a few thousand tokens, and the primary
 * (docs/eval/sketch.md) writes one in 5–12 s — past this it is stuck, and the fallback gets the rest.
 */
export const SKETCH_ATTEMPT_MS = 20_000;
/** All attempts together, inside the route's 60 s. */
export const SKETCH_BUDGET_MS = 55_000;
/** An attempt is not started with less time than this left (it could not finish a drawing). */
export const SKETCH_MIN_ATTEMPT_MS = 8_000;
/** A busy drawing (80 elements of paths) and a little reasoning before it. */
export const SKETCH_MAX_TOKENS = 8_000;

/**
 * Reasoning per model (the eval, docs/eval/sketch.md): "low" — Gemini 3.8 Flash drew no better at
 * "medium" and took four times as long, three of its replies running out of tokens while thinking
 * (cut off: unusable). None set for Anthropic's: Sonnet 5.5 reasons on its own on OpenRouter
 * (it cannot be turned off), and a set budget would start at 1024 tokens.
 */
export function sketchReasoning(model: string): "minimal" | "low" | undefined {
  if (model.startsWith("anthropic/")) return undefined;
  return "low";
}

export interface SketchCallInput {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  reasoning: "minimal" | "low" | undefined;
  /** ends the attempt: the caller leaving or the attempt's own timeout */
  signal: AbortSignal;
  requestId?: string;
}

/** The model call: the reply's text (the eval passes its own client in this shape). */
export type SketchModelCall = (input: SketchCallInput) => Promise<{ text: string; finishReason?: string }>;

/** The production call: OpenRouter, the reply as text (no JSON mode: an SVG is not a JSON object). */
export const openrouterSketchCall: SketchModelCall = async ({ model, messages, maxTokens, reasoning, signal, requestId }) => {
  const body: Record<string, unknown> = { model, messages, max_tokens: maxTokens, temperature: 0, provider: { sort: "latency" } };
  if (reasoning) body.reasoning = { effort: reasoning };
  const data = await openrouterChat(body, { signal, requestId, title: "Agathon Live - sketch" });
  const raw = data.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).join("") : "";
  return { text, finishReason: data.choices?.[0]?.finish_reason };
};

export type ParsedSketchRequest = z.output<typeof SketchRequestSchema>;

export interface IllustratorDeps {
  models: Pick<LiveModels, "sketch" | "sketchFallback">;
  signal?: AbortSignal;
  requestId?: string;
  /** default: `openrouterSketchCall` */
  callModel?: SketchModelCall;
  attemptMs?: number;
  budgetMs?: number;
  /** reasoning per model (the eval overrides it to measure it); default `sketchReasoning` */
  reasoningFor?: (model: string) => "minimal" | "low" | undefined;
  now?: () => number;
}

export interface SketchAttempt {
  model: string;
  /** the retry with the parser's complaint */
  retry: boolean;
  ok: boolean;
  ms: number;
  /** why it was not used: the error, or the parser's problems */
  why?: string;
  finishReason?: string;
  strokes?: number;
  /** the reply's size in characters (never its content: it may carry lecture words) */
  chars?: number;
}

export interface Illustration {
  drawing: SketchDrawing;
  model: string;
  attempts: SketchAttempt[];
  /** what the parser left out of the drawing used (for the log) */
  problems: string[];
  stats: SvgParseStats;
  /** the raw reply that was drawn (the eval keeps it; the route does not log it) */
  svg: string;
}

/** Thrown when no attempt produced a drawing; carries the attempts for the log. */
export class NoDrawingError extends UpstreamError {
  constructor(readonly attempts: SketchAttempt[]) {
    super(502, `No usable drawing: ${attempts.map((a) => `${a.model}${a.retry ? " (retry)" : ""}: ${a.why ?? "?"}`).join("; ").slice(0, 400)}`);
    this.name = "NoDrawingError";
  }
}

const isAbort = (err: unknown) => err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");

export async function illustrate(req: ParsedSketchRequest, deps: IllustratorDeps): Promise<Illustration> {
  const call = deps.callModel ?? openrouterSketchCall;
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.budgetMs ?? SKETCH_BUDGET_MS;
  const attemptMs = deps.attemptMs ?? SKETCH_ATTEMPT_MS;
  const reasoningFor = deps.reasoningFor ?? sketchReasoning;
  const attempts: SketchAttempt[] = [];

  /** One attempt: a drawing, or null (the reason is on its attempt record). Throws only what must not be retried. */
  const attempt = async (model: string, complaint?: string, limitMs = attemptMs): Promise<Illustration | null> => {
    const left = budget - (now() - started);
    const rec: SketchAttempt = { model, retry: Boolean(complaint), ok: false, ms: 0 };
    attempts.push(rec);
    if (left < SKETCH_MIN_ATTEMPT_MS) {
      rec.why = "no time left";
      return null;
    }
    const ms = Math.min(limitMs, left);
    const timeout = AbortSignal.timeout(ms);
    const signal = deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout;
    const t0 = now();
    try {
      const reply = await call({ model, messages: buildSketchMessages(req, complaint), maxTokens: SKETCH_MAX_TOKENS, reasoning: reasoningFor(model), signal, requestId: deps.requestId });
      rec.ms = now() - t0;
      rec.finishReason = reply.finishReason;
      rec.chars = reply.text.length;
      const svg = extractSvg(reply.text);
      if (!svg) {
        rec.why = "no SVG in the reply";
        return null;
      }
      const parsed = svgToDrawing(svg, { aspect: req.aspect });
      rec.strokes = parsed.drawing?.strokes.length ?? 0;
      if (reply.finishReason === "length") {
        rec.why = "the reply was cut off at the token limit: draw it with fewer, simpler elements";
        return null;
      }
      if (!parsed.drawing || parsed.drawing.strokes.length < MIN_USABLE_STROKES) {
        rec.why = parsed.drawing ? `only ${parsed.drawing.strokes.length} visible strokes` : parsed.problems.join("; ") || "nothing drawable";
        return null;
      }
      rec.ok = true;
      return { drawing: parsed.drawing, model, attempts, problems: parsed.problems, stats: parsed.stats, svg };
    } catch (err) {
      rec.ms = now() - t0;
      if (err instanceof CreditsExhaustedError || deps.signal?.aborted) throw err;
      rec.why = timeout.aborted || isAbort(err) ? `no answer within ${ms} ms` : err instanceof Error ? err.message.slice(0, 200) : String(err);
      return null;
    }
  };

  const primary = deps.models.sketch;
  const fallback = deps.models.sketchFallback;
  const first = await attempt(primary);
  if (first) return first;
  // the primary answered but its SVG was not drawable: once more, told why (a timeout or an error goes straight to the fallback)
  const failed = attempts[attempts.length - 1];
  const unusable = failed.chars !== undefined;
  if (unusable) {
    const again = await attempt(primary, failed.why);
    if (again) return again;
  }
  if (fallback && fallback !== primary) {
    const last = await attempt(fallback, undefined, budget);
    if (last) return last;
  }
  throw new NoDrawingError(attempts);
}
