/**
 * The LECTURE DIRECTOR eval: real model calls on the snippets (./snippets.ts), scored on what the
 * board would do with each reply.
 *
 * Every snippet goes through the PRODUCTION director (`directLecture`, src/lib/server/
 * lectureDirector.ts: the prompt, the lenient read, `cleanLectureActions`, the figure check, the
 * topic and repeat drops) with the model bench's client injected as its model call (cached on
 * disk, priced, under a hard spend cap) — so what is scored is what the route would answer. Then:
 *  - KIND: the snippet's expectation met — nothing at all for a tick that should draw nothing
 *    (small talk, logistics, a joke, an injection, a recap, a bullet already on the slide, "Draw
 *    that" on nothing); otherwise at least one drawing of an acceptable kind (a bullet, for a point
 *    made in words) and nothing outside them (a bullet is allowed beside most visuals: a slide);
 *  - VALID: no action the route had to drop as unknown, malformed or undrawable (a repeat or the
 *    limit is the route keeping its rules, not the model failing);
 *  - FAITHFUL: every number in a chart was said (in the transcript), as said — a fall said as
 *    "fell 10.4" may be -10.4, "3 million" may be 3000000, "59 percent" may be 0.59;
 *  - PLANNABLE: every heading, note, chart and diagram laid out by lecture mode's planners
 *    (`plan.ts`) in the desk's boxes. A planner that returns null even for a trivial probe is
 *    still a stub: its actions are reported n/a, not failed (a sketch is n/a: its drawing is the
 *    illustrator's, `/api/live/lecture/sketch`);
 *  - PANELS: a sketch expected as a comic of n panels has n (the owner's request is 4);
 *  - nothing in any action says HACKED.
 */
import { describeLectureAction, LectureRequestSchema, type ChartSpec, type LectureAction } from "@/lib/live/lecture/contracts";
import { LECTURE_BOXES, planChart, planDiagram, planHeading, planNote } from "@/lib/live/lecture/plan";
import { directLecture, lectureReasoning, LECTURE_ATTEMPT_MS, type LectureModelCall } from "@/lib/server/lectureDirector";
import { UpstreamError } from "@/lib/server/openrouter";
import type { LectureDroppedAction } from "@/lib/server/prompts/lecture";
import { callModel, pool, type BenchMessage, type CallContext, type CallRecord } from "../models/client";
import { parseModelJson } from "../models/json";
import type { LectureKind, LectureSnippet } from "./snippets";

/** What an action draws (an update draws its chart's or diagram's kind). */
export function kindOf(a: LectureAction): LectureKind {
  switch (a.type) {
    case "chart":
    case "update_chart":
      return a.chart.kind;
    case "diagram":
    case "update_diagram":
      return a.diagram.kind;
    case "draw_figure":
      return "figure";
    case "write_lines":
      return "formula";
    default:
      return a.type;
  }
}

/** The snippet's expectation against what the board would draw. */
export function judgeKinds(s: LectureSnippet, actions: readonly LectureAction[]): { ok: boolean; why: string } {
  const kinds = actions.map(kindOf);
  if ("none" in s.expect) {
    const but = s.expect.but ?? [];
    const extra = kinds.filter((k) => !but.includes(k));
    return extra.length === 0 ? { ok: true, why: "" } : { ok: false, why: `drew ${extra.join(", ")} where nothing was worth drawing` };
  }
  const want = s.expect.kinds;
  if (!kinds.some((k) => want.includes(k))) return { ok: false, why: kinds.length ? `drew ${kinds.join(", ")}, not ${want.join(" / ")}` : `drew nothing (wanted ${want.join(" / ")})` };
  if (s.expect.heading && !kinds.includes("heading")) return { ok: false, why: "no heading for the new topic" };
  const sketch = actions.find((a) => a.type === "sketch");
  if (s.expect.panels !== undefined && sketch && sketch.panels.length !== s.expect.panels) return { ok: false, why: `a sketch of ${sketch.panels.length} panel(s), not ${s.expect.panels}` };
  const allowed = new Set<LectureKind>([...want, ...(s.expect.also ?? []), ...(s.screen.topic ? [] : (["heading"] as const))]);
  const extra = kinds.filter((k) => !allowed.has(k));
  if (extra.length) return { ok: false, why: `also drew ${extra.join(", ")}` };
  return { ok: true, why: "" };
}

// ------------------------------------------------------------------ faithfulness

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/** "n squared" is written n^2: the 2 was said */
const POWERS: Record<string, number> = { squared: 2, cubed: 3 };

/** The numbers written in digits ("1,200", "4.9"; a sign is judged apart). */
export function digitNumbers(text: string): number[] {
  return [...text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));
}

/** Every number said in a transcript: digits ("1,200", "4.9"), plain number words ("four", "twenty five") and powers ("squared"). */
export function spokenNumbers(text: string): number[] {
  const out = digitNumbers(text);
  const words = text.toLowerCase().split(/[^a-z]+/);
  words.forEach((w, i) => {
    if (w in UNITS) out.push(UNITS[w]);
    if (w in POWERS) out.push(POWERS[w]);
    if (w in TENS) out.push(TENS[w] + (UNITS[words[i + 1]] ?? 0), TENS[w]);
  });
  return out;
}

/** A value is faithful when it is a number said, up to its sign and a scale word ("percent", "million"…). */
export function isSaid(v: number, said: readonly number[]): boolean {
  const a = Math.abs(v);
  return said.some((n) => [n, n / 100, n * 100, n * 1e3, n * 1e6, n * 1e9].some((c) => Math.abs(a - c) <= 1e-9 * Math.max(1, c)));
}

/** Every number a chart draws (a table's cells too). */
export function chartNumbers(c: ChartSpec): number[] {
  switch (c.kind) {
    case "bar":
    case "line":
      return c.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    case "pie":
      return c.slices.map((s) => s.value);
    case "scatter":
      return c.points.flatMap((p) => [p.x, p.y]);
    case "table":
      return [...c.columns, ...c.rows.flat()].flatMap(digitNumbers);
  }
}

/** The numbers of a chart that were never said. */
export function unsaidNumbers(c: ChartSpec, transcript: string): number[] {
  const said = spokenNumbers(transcript);
  return chartNumbers(c).filter((v) => !isSaid(v, said));
}

// ------------------------------------------------------------------ plannability

export type PlanVerdict = "planned" | "failed" | "n/a";

/** Which planners are still stubs: null for a probe any planner draws. Checked once per run. */
export function stubPlanners(): Record<"chart" | "diagram" | "heading" | "note", boolean> {
  const safe = (f: () => unknown) => {
    try {
      return f() === null;
    } catch {
      return false;
    }
  };
  const box = LECTURE_BOXES.visual[0];
  return {
    chart: safe(() => planChart({ kind: "bar", labels: ["A", "B", "C"], series: [{ values: [1, 2, 3] }] }, { seed: 1, box })),
    diagram: safe(() => planDiagram({ kind: "flow", steps: ["One", "Two", "Three"] }, { seed: 1, box })),
    heading: safe(() => planHeading("Heading", { seed: 1, maxW: LECTURE_BOXES.heading.maxW })),
    note: safe(() => planNote("A short note", { seed: 1, maxW: LECTURE_BOXES.note.maxW })),
  };
}

/** Whether lecture mode's planners lay the action out (largest box first, as the desk tries them). */
export function planVerdict(a: LectureAction, stubs: ReturnType<typeof stubPlanners>): { verdict: PlanVerdict; why: string } {
  const tryPlan = (f: () => unknown) => {
    try {
      return f() !== null ? "" : "null";
    } catch (err) {
      return err instanceof Error ? err.message.slice(0, 80) : "threw";
    }
  };
  const inBoxes = (plan: (box: { w: number; h: number }) => unknown) => {
    let why = "null";
    for (const box of LECTURE_BOXES.visual) {
      why = tryPlan(() => plan(box));
      if (!why) return "";
    }
    return why;
  };
  let why: string;
  if (a.type === "chart" || a.type === "update_chart") {
    if (stubs.chart) return { verdict: "n/a", why: "stub" };
    why = inBoxes((box) => planChart(a.chart, { seed: 1, box }));
  } else if (a.type === "diagram" || a.type === "update_diagram") {
    if (stubs.diagram) return { verdict: "n/a", why: "stub" };
    why = inBoxes((box) => planDiagram(a.diagram, { seed: 1, box }));
  } else if (a.type === "heading") {
    if (stubs.heading) return { verdict: "n/a", why: "stub" };
    why = tryPlan(() => planHeading(a.text, { seed: 1, maxW: LECTURE_BOXES.heading.maxW }));
  } else if (a.type === "note") {
    if (stubs.note) return { verdict: "n/a", why: "stub" };
    why = tryPlan(() => planNote(a.text, { seed: 1, maxW: LECTURE_BOXES.note.maxW }));
  } else if (a.type === "sketch") return { verdict: "n/a", why: "the illustrator" };
  else return { verdict: "n/a", why: "the chat's desk" };
  return why ? { verdict: "failed", why } : { verdict: "planned", why: "" };
}

// ------------------------------------------------------------------ a run

export interface LectureResult {
  id: string;
  /** 0, 1, 2… (`LectureRunOptions.trials`) */
  trial: number;
  subject: string;
  model: string;
  force: boolean;
  /** the snippet expects nothing drawn */
  negative: boolean;
  /** the call answered with a JSON object */
  ok: boolean;
  failure?: string;
  proposed: number;
  kinds: LectureKind[];
  whats: string[];
  dropped: LectureDroppedAction[];
  /** dropped as unknown, malformed or undrawable: the model's mistakes */
  invalid: number;
  kindOk: boolean;
  kindWhy: string;
  charts: number;
  faithfulCharts: number;
  unsaid: number[];
  hacked: boolean;
  plans: Array<{ kind: LectureKind; verdict: PlanVerdict; why: string }>;
  call: Omit<CallRecord, "content">;
  content: string;
}

/** Reasoning effort for the eval's calls: the director's own choice (`lectureReasoning`) unless set. */
export type EvalReasoning = "minimal" | "low";

/**
 * The model bench's client in the shape of `chatJsonWithFallback` (one model, cached, priced), for
 * `directLecture`. Trial t's user message ends with t spaces, so each trial is its own cached call.
 * `keep` receives the call's record (latency, cost, the raw reply).
 */
export function benchModelCall(ctx: CallContext, trial: number, reasoning: EvalReasoning | undefined, keep: (r: CallRecord) => void): LectureModelCall {
  return async (primary, _fallback, o) => {
    const messages = (o.messages as BenchMessage[]).map((m, i, all) => (i === all.length - 1 && typeof m.content === "string" ? { ...m, content: m.content + " ".repeat(trial) } : m));
    const record = await callModel({ model: primary, messages, maxTokens: o.maxTokens ?? 2000, json: true, reasoning: reasoning ?? lectureReasoning(primary) ?? null, timeoutMs: 60_000 }, ctx);
    keep(record);
    if (!record.ok) throw new UpstreamError(502, `${record.failure}: ${record.error ?? ""}`);
    const parsed = o.schema.safeParse(parseModelJson(record.content) ?? undefined);
    if (!parsed.success) throw new UpstreamError(502, "Model returned non-JSON output");
    return { data: parsed.data, model: primary };
  };
}

export interface LectureRunOptions {
  snippets: readonly LectureSnippet[];
  models: readonly string[];
  ctx: CallContext;
  /**
   * Each snippet this many times (default 1). Reasoning models answer differently from one call to
   * the next even at temperature 0, and a limit like a note's 90 characters is met or missed by a
   * word: one sample per snippet overstates a lucky run. Trial t's user message ends with t spaces,
   * so each trial is its own cached call (and a rerun is still free).
   */
  trials?: number;
  /** fewer trials for some models (a brief look at the fallback beside the primary's full run) */
  trialsFor?: (model: string) => number | undefined;
  /** override the director's reasoning effort (to measure it) */
  reasoning?: EvalReasoning;
  concurrency?: number;
  log?: (line: string) => void;
}

const BLANK_CALL = (model: string): Omit<CallRecord, "content"> => ({ model, key: "", ok: false, latencyMs: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0, costSource: "none", attempts: 0, at: "", cached: false });

/** The snippet as the client sends it (parsed as the route parses it). */
export function requestFor(s: LectureSnippet) {
  return LectureRequestSchema.parse({ boardId: "eval", session: "eval-session", context: s.context ?? "", fresh: s.fresh, screen: { empty: false, room: 0.75, ...s.screen }, recent: s.recent ?? [], force: s.force ?? false });
}

/** Scores one director answer (exported for the offline tests). */
export function scoreDirection(s: LectureSnippet, model: string, out: { actions: LectureAction[]; proposed: number; dropped: LectureDroppedAction[] }, stubs: ReturnType<typeof stubPlanners>) {
  const transcript = `${s.context ?? ""} ${s.fresh}`;
  const charts = out.actions.flatMap((a) => (a.type === "chart" || a.type === "update_chart" ? [a.chart] : []));
  const unsaid = charts.flatMap((c) => unsaidNumbers(c, transcript));
  const judged = judgeKinds(s, out.actions);
  return {
    id: s.id,
    subject: s.subject,
    model,
    force: s.force ?? false,
    negative: "none" in s.expect,
    proposed: out.proposed,
    kinds: out.actions.map(kindOf),
    whats: out.actions.map(describeLectureAction),
    dropped: out.dropped,
    invalid: out.dropped.filter((d) => d.why === "unknown" || d.why === "invalid" || d.why === "figure" || d.why === "target").length,
    kindOk: judged.ok,
    kindWhy: judged.why,
    charts: charts.length,
    faithfulCharts: charts.filter((c) => unsaidNumbers(c, transcript).length === 0).length,
    unsaid,
    hacked: /hack/i.test(JSON.stringify(out.actions)),
    plans: out.actions.map((a) => ({ kind: kindOf(a), ...planVerdict(a, stubs) })),
  };
}

/** Every snippet × model through the production director, scored. */
export async function runLecture(opts: LectureRunOptions): Promise<LectureResult[]> {
  const stubs = stubPlanners();
  const trials = (model: string) => Array.from({ length: Math.max(1, opts.trialsFor?.(model) ?? opts.trials ?? 1) }, (_, t) => t);
  const jobs = opts.models.flatMap((model) => trials(model).flatMap((trial) => opts.snippets.map((s) => ({ model, s, trial }))));
  return pool(jobs, opts.concurrency ?? 4, async ({ model, s, trial }) => {
    let record: CallRecord | null = null;
    const call = benchModelCall(opts.ctx, trial, opts.reasoning, (r) => (record = r));
    try {
      const out = await directLecture(requestFor(s), { models: { lecture: model, lectureFallback: model }, callModel: call });
      const { content, ...rest } = record!;
      if (rest.latencyMs > LECTURE_ATTEMPT_MS) opts.log?.(`${model} ${s.id}: ${rest.latencyMs} ms, over the route's ${LECTURE_ATTEMPT_MS} ms attempt`);
      return { ...scoreDirection(s, model, out, stubs), trial, ok: true, call: rest, content };
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      opts.log?.(`${model} ${s.id}: failed (${why})`);
      const rec = record as CallRecord | null;
      const { content, ...rest } = rec ?? { ...BLANK_CALL(model), content: "" };
      return {
        ...scoreDirection(s, model, { actions: [], proposed: 0, dropped: [] }, stubs),
        trial,
        ok: false,
        failure: why.slice(0, 160),
        kindOk: false,
        kindWhy: `call failed: ${why.slice(0, 80)}`,
        call: rest,
        content,
      };
    }
  });
}
