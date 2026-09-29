/**
 * The ILLUSTRATOR eval's runs: every case (./corpus.ts) through the PRODUCTION illustrator
 * (`illustrate`, src/lib/server/sketch/illustrate.ts: the prompt, the SVG parser and sampler, the
 * one retry with the parser's complaint) with the model bench's client injected as its model call —
 * cached on disk, timed, priced from the OpenRouter catalog, under a hard spend cap. Each model is
 * run on its own (no fallback), so what is measured is that model: its drawings, how often its
 * first SVG was unusable, its latency (every attempt of a drawing added up) and its cost.
 *
 * The drawings are then LOOKED at (./render.ts: contact sheets under docs/eval/sketch/) and scored
 * by eye (./scores.ts); nothing here pretends to judge a picture.
 */
import { SketchRequestSchema, type SketchDrawing } from "@/lib/live/lecture/contracts";
import { illustrate, NoDrawingError, SKETCH_ATTEMPT_MS, sketchReasoning, type SketchModelCall } from "@/lib/server/sketch/illustrate";
import { UpstreamError } from "@/lib/server/openrouter";
import { callModel, pool, type BenchMessage, type CallContext, type CallRecord } from "../models/client";
import type { SketchCase } from "./corpus";

export type EvalReasoning = "minimal" | "low" | "medium" | "none";

export interface SketchResult {
  id: string;
  model: string;
  drawing: SketchDrawing | null;
  failure?: string;
  /** the first reply was not drawable (the retry was used) */
  firstUnusable: boolean;
  attempts: number;
  /** every attempt's latency added up (what the student waits) */
  latencyMs: number;
  /** an attempt ran past the route's per-attempt timeout (production would have fallen back) */
  overAttempt: boolean;
  costUsd: number;
  completionTokens: number;
  reasoningTokens: number;
  problems: string[];
  strokes: number;
  points: number;
  labels: number;
  cached: boolean;
  /** the SVG that was drawn (kept for a look when a drawing is odd) */
  svg?: string;
}

/** The bench's client in the shape of the illustrator's model call; `keep` receives every call's record. */
export function benchSketchCall(ctx: CallContext, keep: (r: CallRecord) => void): SketchModelCall {
  return async ({ model, messages, maxTokens, reasoning }) => {
    const record = await callModel({ model, messages: messages as BenchMessage[], maxTokens, json: false, reasoning: reasoning ?? null, timeoutMs: 120_000 }, ctx);
    keep(record);
    if (!record.ok) throw new UpstreamError(502, `${record.failure}: ${record.error ?? ""}`);
    return { text: record.content, finishReason: record.finishReason };
  };
}

export interface SketchRunOptions {
  cases: readonly SketchCase[];
  models: readonly string[];
  ctx: CallContext;
  /** override the illustrator's reasoning effort ("none": leave it unset) */
  reasoning?: EvalReasoning;
  concurrency?: number;
  log?: (line: string) => void;
}

export async function runSketches(opts: SketchRunOptions): Promise<SketchResult[]> {
  const jobs = opts.models.flatMap((model) => opts.cases.map((c) => ({ model, c })));
  return pool(jobs, opts.concurrency ?? 6, async ({ model, c }) => {
    const records: CallRecord[] = [];
    const req = SketchRequestSchema.parse({ boardId: "eval", session: "eval-session", prompt: c.prompt, cast: c.cast, panel: c.panel, aspect: c.aspect });
    const reasoningFor =
      opts.reasoning === undefined ? sketchReasoning : (m: string) => (opts.reasoning === "none" || m.startsWith("anthropic/") ? undefined : (opts.reasoning as "minimal" | "low"));
    const base = (drawing: SketchDrawing | null) => ({
      id: c.id,
      model,
      drawing,
      attempts: records.length,
      latencyMs: records.reduce((n, r) => n + r.latencyMs, 0),
      overAttempt: records.some((r) => r.latencyMs > SKETCH_ATTEMPT_MS),
      costUsd: records.reduce((n, r) => n + r.costUsd, 0),
      completionTokens: records.reduce((n, r) => n + r.completionTokens, 0),
      reasoningTokens: records.reduce((n, r) => n + r.reasoningTokens, 0),
      cached: records.every((r) => r.cached),
    });
    try {
      const out = await illustrate(req, {
        models: { sketch: model, sketchFallback: model },
        callModel: benchSketchCall(opts.ctx, (r) => records.push(r)),
        // the bench's own timeout measures the tail; the route's per-attempt limit is judged after
        attemptMs: 10 * 60_000,
        budgetMs: 20 * 60_000,
        reasoningFor: reasoningFor as (m: string) => "minimal" | "low" | undefined,
      });
      const d = out.drawing;
      return {
        ...base(d),
        firstUnusable: out.attempts.length > 1,
        problems: out.problems,
        strokes: d.strokes.length,
        points: d.strokes.reduce((n, s) => n + s.points.length, 0),
        labels: d.labels.length,
        svg: out.svg,
      };
    } catch (err) {
      const why = err instanceof NoDrawingError ? err.attempts.map((a) => a.why).join(" | ") : err instanceof Error ? err.message : String(err);
      opts.log?.(`${model} ${c.id}: no drawing (${why.slice(0, 200)})`);
      return { ...base(null), failure: why.slice(0, 200), firstUnusable: true, problems: [], strokes: 0, points: 0, labels: 0 };
    }
  });
}

// ------------------------------------------------------------------ numbers

export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export interface ModelNumbers {
  model: string;
  drawings: number;
  drawn: number;
  /** the first SVG was unusable (retried) */
  firstUnusable: number;
  /** no drawing at all, even after the retry */
  failed: number;
  /** an attempt over the route's per-attempt timeout */
  overAttempt: number;
  p50: number;
  p95: number;
  costPerDrawing: number;
  costTotal: number;
  meanStrokes: number;
  meanPoints: number;
}

export function modelNumbers(model: string, results: readonly SketchResult[]): ModelNumbers {
  const mine = results.filter((r) => r.model === model);
  const drawn = mine.filter((r) => r.drawing);
  const lat = mine.map((r) => r.latencyMs);
  const cost = mine.reduce((n, r) => n + r.costUsd, 0);
  return {
    model,
    drawings: mine.length,
    drawn: drawn.length,
    firstUnusable: mine.filter((r) => r.firstUnusable).length,
    failed: mine.length - drawn.length,
    overAttempt: mine.filter((r) => r.overAttempt).length,
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    costPerDrawing: mine.length ? cost / mine.length : 0,
    costTotal: cost,
    meanStrokes: drawn.length ? drawn.reduce((n, r) => n + r.strokes, 0) / drawn.length : 0,
    meanPoints: drawn.length ? drawn.reduce((n, r) => n + r.points, 0) / drawn.length : 0,
  };
}
