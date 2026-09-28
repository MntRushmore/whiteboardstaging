/**
 * The lecture director eval's LIVE part: the sequences (./sequences.ts) tick by tick through the
 * PRODUCTION director, with the board's state carried between ticks as the desk keeps it — a new
 * chart or diagram gets a fixed id and comes back in `screen.active` (newest first, at most two)
 * with its spec as it now is, an update replaces its spec, a heading starts a new screen (what was
 * drawn moves to `recent`, the live visuals go off-screen). Scored per tick:
 *  - UPDATE VS NEW: started a visual when one was due, updated the right one when one was, left
 *    every live visual alone when nothing was said for it;
 *  - VALUES: each named chart, label by label, as said so far — corrections applied, null where
 *    nothing was said yet, no number at a label that was never given one;
 *  - LOST: a number a chart showed before the tick and does not after it;
 *  - ITEMS: a diagram's steps or events, in order;
 *  - latency of the ticks that had a live visual to update (what a live tick costs the student).
 */
import {
  describeLectureAction,
  LECTURE_LIMITS,
  LectureRequestSchema,
  type ActiveVisual,
  type ChartSpec,
  type DiagramSpec,
  type LectureAction,
} from "@/lib/live/lecture/contracts";
import { directLecture } from "@/lib/server/lectureDirector";
import type { LectureDroppedAction } from "@/lib/server/prompts/lecture";
import { pool, type CallContext, type CallRecord } from "../models/client";
import { benchModelCall, kindOf, type EvalReasoning } from "./run";
import type { LectureSequence, SequenceExpect, SequenceTick } from "./sequences";

interface Visual {
  id: string;
  name?: string;
  chart?: ChartSpec;
  diagram?: DiagramSpec;
  /** its line in "drawn" (replaced when it is updated) */
  what: string;
  onScreen: boolean;
}

/** The board between ticks, as the desk keeps it. */
export class EvalBoard {
  topic: string;
  drawn: string[];
  recent: string[] = [];
  /** newest first */
  visuals: Visual[] = [];
  private next = 1;

  constructor(topic: string) {
    this.topic = topic;
    this.drawn = [`heading: ${topic}`];
  }

  active(): ActiveVisual[] {
    return this.visuals
      .filter((v) => v.onScreen)
      .slice(0, LECTURE_LIMITS.active)
      .map((v) => (v.chart ? { id: v.id, chart: v.chart } : { id: v.id, diagram: v.diagram! }));
  }

  named(name: string): Visual | undefined {
    return this.visuals.find((v) => v.name === name);
  }

  /** The actions as the desk runs them: what was started and what was updated. */
  apply(actions: readonly LectureAction[]): { started: Visual[]; updated: Visual[] } {
    const started: Visual[] = [];
    const updated: Visual[] = [];
    for (const a of actions) {
      const what = describeLectureAction(a);
      if (a.type === "heading") {
        // a new topic on a screen with anything on it: a new screen
        this.recent = [...[...this.drawn].reverse(), ...this.recent].slice(0, LECTURE_LIMITS.recent);
        this.drawn = [];
        for (const v of this.visuals) v.onScreen = false;
        this.topic = a.text;
        this.drawn.push(what);
      } else if (a.type === "chart" || a.type === "diagram") {
        const v: Visual = { id: `v${this.next++}`, what, onScreen: true, ...(a.type === "chart" ? { chart: a.chart } : { diagram: a.diagram }) };
        this.visuals.unshift(v);
        this.drawn.push(what);
        started.push(v);
      } else if (a.type === "update_chart" || a.type === "update_diagram") {
        const v = this.visuals.find((x) => x.id === a.target);
        if (!v) continue;
        if (a.type === "update_chart") v.chart = a.chart;
        else v.diagram = a.diagram;
        const at = this.drawn.indexOf(v.what);
        v.what = what;
        if (at >= 0) this.drawn[at] = what;
        updated.push(v);
      } else this.drawn.push(what);
    }
    this.drawn = this.drawn.slice(-LECTURE_LIMITS.drawn);
    return { started, updated };
  }
}

// ------------------------------------------------------------------ scoring

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ORDINALS: Record<string, string> = { first: "1", second: "2", third: "3", fourth: "4", "1st": "1", "2nd": "2", "3rd": "3", "4th": "4" };

/** A category label as compared: "Q1", "Quarter 1", "1st quarter" are one; "January" and "Jan" are one. */
export function labelKey(label: string): string {
  const t = label.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const q = /^(?:q|quarter) ?(\d)$/.exec(t) ?? /^(\w+) quarter$/.exec(t);
  if (q) return `q${ORDINALS[q[1]] ?? q[1]}`;
  const m = MONTHS.find((x) => t.startsWith(x));
  if (m && /^[a-z]+$/.test(t)) return m;
  return t.replace(/ /g, "");
}

/** Two numbers the same up to the scale word the chart chose ("12" with unit "million" is 12000000). */
function sameNumber(v: number, e: number): boolean {
  return [1, 1e3, 1e6, 1e9].some((k) => Math.abs(v - e * k) <= 1e-9 * Math.max(1, Math.abs(e * k)) || Math.abs(v * k - e) <= 1e-9 * Math.max(1, Math.abs(e)));
}

/** A category chart's first series by label key (null: its slot, no number). */
function chartValues(c: ChartSpec | undefined): Map<string, number | null> | null {
  if (!c || (c.kind !== "bar" && c.kind !== "line")) return null;
  return new Map(c.labels.map((l, i) => [labelKey(l), c.series[0]?.values[i] ?? null]));
}

export interface ValuesScore {
  right: boolean;
  /** what was wrong, in words */
  wrong: string[];
  /** a number shown before the tick and gone after it */
  lost: number;
  /** a number at a label never given one */
  invented: number;
}

/** A named chart after a tick against what has been said so far; `before`: its values before the tick. */
export function scoreValues(chart: ChartSpec | undefined, want: Record<string, number | null>, before: Map<string, number | null> | null): ValuesScore {
  const got = chartValues(chart);
  if (!got) return { right: false, wrong: [chart ? `a ${chart.kind}, not a bar or line chart` : "no such chart"], lost: 0, invented: 0 };
  const wrong: string[] = [];
  const keys = new Set(Object.keys(want).map(labelKey));
  for (const [label, e] of Object.entries(want)) {
    const k = labelKey(label);
    if (!got.has(k)) {
      wrong.push(`no ${label}`);
      continue;
    }
    const v = got.get(k) ?? null;
    if (e === null ? v !== null : v === null || !sameNumber(v, e)) wrong.push(`${label} ${v ?? "empty"}, not ${e ?? "empty"}`);
  }
  let invented = 0;
  for (const [k, v] of got)
    if (!keys.has(k) && v !== null) {
      invented++;
      wrong.push(`${k} ${v}, never said`);
    }
  let lost = 0;
  for (const [k, v] of before ?? []) if (v !== null && (got.get(k) ?? null) === null) lost++;
  return { right: wrong.length === 0, wrong, lost, invented };
}

/** A diagram's steps (a flow, a cycle) or events (a timeline: date and what), as matched. */
function diagramItems(d: DiagramSpec | undefined): string[] {
  if (!d) return [];
  if (d.kind === "flow" || d.kind === "cycle") return d.steps;
  if (d.kind === "timeline") return d.events.map((e) => `${e.when} ${e.what}`);
  return [];
}

/** The patterns, in order, among the diagram's items (each after the one before). */
export function scoreItems(d: DiagramSpec | undefined, patterns: readonly string[]): { right: boolean; why: string } {
  const items = diagramItems(d);
  if (!items.length) return { right: false, why: d ? `a ${d.kind}` : "no such diagram" };
  let from = 0;
  for (const p of patterns) {
    const re = new RegExp(p, "i");
    const at = items.findIndex((x, i) => i >= from && re.test(x));
    if (at < 0) return { right: false, why: `no "${p}" in order (${items.join(" → ")})` };
    from = at + 1;
  }
  return { right: true, why: "" };
}

/** One action as the tables show it: its kind, or "update <target>". */
export const didOf = (a: LectureAction): string => (a.type === "update_chart" || a.type === "update_diagram" ? `update ${a.target}` : kindOf(a));

/** What a tick did, against what it was to do. */
export function judgeTick(expect: SequenceExpect, actions: readonly LectureAction[], started: readonly { id: string }[], updated: readonly { id: string }[], target: string | undefined): { ok: boolean; why: string } {
  const did = actions.map(didOf).join(", ") || "nothing";
  if ("none" in expect) return actions.length === 0 ? { ok: true, why: "" } : { ok: false, why: `drew ${did}` };
  if ("keep" in expect) return started.length + updated.length === 0 ? { ok: true, why: "" } : { ok: false, why: `touched the charts: ${did}` };
  if ("update" in expect) {
    if (!target) return { ok: false, why: `nothing to update (${expect.update} was never started)` };
    if (started.length) return { ok: false, why: `started a new one instead: ${did}` };
    return updated.some((u) => u.id === target) ? { ok: true, why: "" } : { ok: false, why: `did not update ${expect.update}: ${did}` };
  }
  if (updated.length) return { ok: false, why: `updated a live visual instead of starting one: ${did}` };
  const first = actions.find((a) => a.type === "chart" || a.type === "diagram");
  if (!first) return { ok: false, why: `started nothing: ${did}` };
  if (!expect.kinds.includes(kindOf(first))) return { ok: false, why: `started a ${kindOf(first)}, not ${expect.kinds.join(" / ")}` };
  const allowed = new Set([...expect.kinds, ...(expect.also ?? [])]);
  const extra = actions.filter((a) => a !== first && !allowed.has(kindOf(a)));
  return extra.length ? { ok: false, why: `also drew ${extra.map(kindOf).join(", ")}` } : { ok: true, why: "" };
}

// ------------------------------------------------------------------ a run

export interface TickResult {
  sequence: string;
  tick: number;
  model: string;
  trial: number;
  /** the request carried a live visual (a live tick) */
  live: boolean;
  expect: string;
  did: string[];
  ok: boolean;
  why: string;
  /** per named chart checked after this tick */
  values: Array<{ name: string } & ValuesScore>;
  items: Array<{ name: string; right: boolean; why: string }>;
  dropped: LectureDroppedAction[];
  invalid: number;
  call: Omit<CallRecord, "content">;
  content: string;
}

export interface SequenceRunOptions {
  sequences: readonly LectureSequence[];
  models: readonly string[];
  ctx: CallContext;
  trials?: number;
  reasoning?: EvalReasoning;
  concurrency?: number;
  log?: (line: string) => void;
}

const describeExpect = (e: SequenceExpect) => ("none" in e ? "nothing" : "keep" in e ? "leave the charts" : "update" in e ? `update ${e.update}` : `start ${e.start} (${e.kinds.join(" / ")})`);

/** One sequence, tick by tick, for one model and trial. */
async function runOne(seq: LectureSequence, model: string, trial: number, opts: SequenceRunOptions): Promise<TickResult[]> {
  const board = new EvalBoard(seq.topic);
  const said: string[] = [];
  const out: TickResult[] = [];
  for (const [i, t] of seq.ticks.entries()) {
    const active = board.active();
    const req = LectureRequestSchema.parse({
      boardId: "eval",
      session: "eval-session",
      context: said.join(" ").slice(-LECTURE_LIMITS.contextChars),
      fresh: t.fresh,
      screen: { empty: false, topic: board.topic, drawn: board.drawn, room: 0.6, active },
      recent: board.recent,
    });
    const before = new Map(Object.keys(t.values ?? {}).map((name) => [name, chartValues(board.named(name)?.chart)]));
    let record: CallRecord | null = null;
    const base = { sequence: seq.id, tick: i + 1, model, trial, live: active.length > 0, expect: describeExpect(t.expect) };
    try {
      const dir = await directLecture(req, { models: { lecture: model, lectureFallback: model }, callModel: benchModelCall(opts.ctx, trial, opts.reasoning, (r) => (record = r)) });
      const target = "update" in t.expect ? board.named(t.expect.update)?.id : undefined;
      const { started, updated } = board.apply(dir.actions);
      if ("start" in t.expect && started[0]) started[0].name = t.expect.start;
      const judged = judgeTick(t.expect, dir.actions, started, updated, target);
      const { content, ...call } = record!;
      out.push({
        ...base,
        did: dir.actions.map(didOf),
        ok: judged.ok,
        why: judged.why,
        values: scoreTickValues(board, t, before),
        items: Object.entries(t.items ?? {}).map(([name, patterns]) => ({ name, ...scoreItems(board.named(name)?.diagram, patterns) })),
        dropped: dir.dropped,
        invalid: dir.dropped.filter((d) => d.why === "unknown" || d.why === "invalid" || d.why === "figure" || d.why === "target").length,
        call,
        content,
      });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      opts.log?.(`${model} ${seq.id} #${i + 1}: failed (${why})`);
      const rec = record as CallRecord | null;
      const { content, ...call } = rec ?? { model, key: "", ok: false, latencyMs: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0, costSource: "none" as const, attempts: 0, at: "", cached: false, content: "" };
      out.push({ ...base, did: [], ok: false, why: `call failed: ${why.slice(0, 80)}`, values: scoreTickValues(board, t, before), items: [], dropped: [], invalid: 0, call, content });
    }
    said.push(t.fresh);
  }
  return out;
}

function scoreTickValues(board: EvalBoard, t: SequenceTick, before: Map<string, Map<string, number | null> | null>): TickResult["values"] {
  return Object.entries(t.values ?? {}).map(([name, want]) => ({ name, ...scoreValues(board.named(name)?.chart, want, before.get(name) ?? null) }));
}

/** Every sequence × model × trial (ticks in order within a sequence). */
export async function runSequences(opts: SequenceRunOptions): Promise<TickResult[]> {
  const trials = Array.from({ length: Math.max(1, opts.trials ?? 1) }, (_, t) => t);
  const jobs = opts.models.flatMap((model) => trials.flatMap((trial) => opts.sequences.map((seq) => ({ model, trial, seq }))));
  const runs = await pool(jobs, opts.concurrency ?? 4, ({ model, trial, seq }) => runOne(seq, model, trial, opts));
  return runs.flat();
}
