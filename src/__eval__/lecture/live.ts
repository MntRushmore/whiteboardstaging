/**
 * The lecture director eval's LIVE and SLIDES parts: the sequences (./sequences.ts) tick by tick
 * through the PRODUCTION director, with the board's state carried between ticks as the desk keeps
 * it — a new chart or diagram gets a fixed id and comes back in `screen.active` (newest first, at
 * most two) with its spec as it now is, an update replaces its spec, a heading starts a new slide
 * (what was drawn moves to `recent`, the live visuals go off-screen), and a full slide — its
 * `LECTURE_LIMITS.slideBullets` bullets, or a visual already on it — goes on on the next screen as
 * "<title> (cont.)". Scored per tick:
 *  - UPDATE VS NEW: started a visual when one was due, updated the right one when one was, left
 *    every live visual alone when nothing was said for it, drew nothing at all on filler;
 *  - VALUES: each named chart, label by label, as said so far — corrections applied, null where
 *    nothing was said yet, no number at a label that was never given one;
 *  - LOST: a number a chart showed before the tick and does not after it;
 *  - ITEMS: a diagram's steps, events or spokes (a table's rows), in order;
 *  - latency (of every tick, and of the ticks with a live visual to update).
 * And per run of a SLIDES sequence (`scoreSlides`): a title at the start and at each topic change,
 * no title where none was due, a bullet for each key point (on its tick, or the next when the
 * point runs on), no two bullets on a topic that say the same thing, how many bullets a topic got,
 * and silence on the filler ticks.
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
import { BULLET_ASK_MAX, BULLET_ONE_LINE, bulletWords, sameBullet, type LectureDroppedAction } from "@/lib/server/prompts/lecture";
import { pool, type CallContext, type CallRecord } from "../models/client";
import { benchModelCall, chartNumbers, digitNumbers, kindOf, type EvalReasoning } from "./run";
import type { LectureSequence, SequenceExpect, SequenceTick } from "./sequences";

interface Visual {
  id: string;
  name?: string;
  chart?: ChartSpec;
  diagram?: DiagramSpec;
  /** its line in "drawn" (replaced when it is updated) */
  what: string;
  onScreen: boolean;
  /** the slide it was drawn on (`EvalBoard.slides`) */
  slide: number;
}

/** One slide of the deck, as the eval keeps it. */
export interface EvalSlide {
  /** its topic (null: none yet) */
  title: string | null;
  /** continued from the slide before ("<title> (cont.)"): a full slide, not a new topic */
  cont: boolean;
  /** the topic it belongs to: the index of the slide its topic started on */
  topic: number;
  bullets: string[];
  /** its visuals, by `describeLectureAction` (as drawn last) */
  visuals: string[];
}

/** What draws a visual on the slide (a chart, a diagram, a picture, maths); an update grows one. */
const VISUAL_TYPES: ReadonlySet<string> = new Set(["chart", "diagram", "sketch", "graph", "draw_figure", "write_lines"]);
const UPDATE_TYPES: ReadonlySet<string> = new Set(["update_chart", "update_diagram"]);

/** The board between ticks, as the desk keeps it: slides of a title, bullets and one visual. */
export class EvalBoard {
  topic: string | null;
  drawn: string[];
  recent: string[] = [];
  /** newest first */
  visuals: Visual[] = [];
  slides: EvalSlide[];
  private next = 1;

  constructor(topic: string | null) {
    this.topic = topic;
    this.drawn = topic ? [`heading: ${topic}`] : [];
    this.slides = [{ title: topic, cont: false, topic: 0, bullets: [], visuals: [] }];
  }

  /** the slide being written on */
  get slide(): EvalSlide {
    return this.slides[this.slides.length - 1];
  }

  get empty(): boolean {
    return this.drawn.length === 0;
  }

  /** Roughly how much of the slide is free (0..1): the bullets' column and the visual's box. */
  room(): number {
    if (this.empty) return 1;
    return Math.max(0.1, Math.round((0.9 - 0.07 * this.slide.bullets.length - (this.slide.visuals.length ? 0.45 : 0)) * 100) / 100);
  }

  active(): ActiveVisual[] {
    return this.visuals
      .filter((v) => v.onScreen && (v.chart || v.diagram))
      .slice(0, LECTURE_LIMITS.active)
      .map((v) => (v.chart ? { id: v.id, chart: v.chart } : { id: v.id, diagram: v.diagram! }));
  }

  named(name: string): Visual | undefined {
    return this.visuals.find((v) => v.name === name);
  }

  /** A new screen: a new topic's slide, or this one continued ("<title> (cont.)", the desk's smaller heading). */
  private newSlide(title: string | null, cont: boolean): void {
    this.recent = [...[...this.drawn].reverse(), ...this.recent].slice(0, LECTURE_LIMITS.recent);
    this.drawn = cont && title ? [`heading: ${title} (cont.)`] : [];
    for (const v of this.visuals) v.onScreen = false;
    this.slides.push({ title, cont, topic: cont ? this.slide.topic : this.slides.length, bullets: [], visuals: [] });
  }

  /** The actions as the desk runs them: what was started and what was updated. */
  apply(actions: readonly LectureAction[]): { started: Visual[]; updated: Visual[] } {
    const started: Visual[] = [];
    const updated: Visual[] = [];
    for (const a of actions) {
      const what = describeLectureAction(a);
      if (a.type === "heading") {
        // a new topic: a new slide, unless this screen is still blank
        if (this.empty) this.slide.title = a.text;
        else this.newSlide(a.text, false);
        this.topic = a.text;
        this.drawn.push(what);
      } else if (a.type === "note") {
        if (this.slide.bullets.length >= LECTURE_LIMITS.slideBullets) this.newSlide(this.topic, true);
        this.slide.bullets.push(a.text);
        this.drawn.push(what);
      } else if (VISUAL_TYPES.has(a.type)) {
        // one visual a slide: a second goes on the slide continued
        if (this.slide.visuals.length > 0) this.newSlide(this.topic, true);
        const v: Visual = { id: `v${this.next++}`, what, onScreen: true, slide: this.slides.length - 1, ...(a.type === "chart" ? { chart: a.chart } : a.type === "diagram" ? { diagram: a.diagram } : {}) };
        this.visuals.unshift(v);
        this.slide.visuals.push(what);
        this.drawn.push(what);
        started.push(v);
      } else if (a.type === "update_chart" || a.type === "update_diagram") {
        const v = this.visuals.find((x) => x.id === a.target);
        if (!v) continue;
        if (a.type === "update_chart") v.chart = a.chart;
        else v.diagram = a.diagram;
        const at = this.drawn.indexOf(v.what);
        if (at >= 0) this.drawn[at] = what;
        const on = this.slides[v.slide].visuals.indexOf(v.what);
        if (on >= 0) this.slides[v.slide].visuals[on] = what;
        v.what = what;
        updated.push(v);
      } else this.drawn.push(what);
    }
    this.drawn = this.drawn.slice(-LECTURE_LIMITS.drawn);
    return { started, updated };
  }
}

// ------------------------------------------------------------------ scoring a tick

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

/**
 * The chart's label for a label said: the same key, else one that starts with it or it starts with,
 * a plural aside ("Mon" is Monday; "Meetings booked" is Meetings; "Dial" is Dials). A model names a
 * category in its own words; the number under it is what is scored.
 */
function findLabel(keys: readonly string[], want: string): string | undefined {
  const bare = (k: string) => k.replace(/s$/, "");
  const w = bare(want);
  return keys.find((k) => k === want) ?? keys.find((k) => w.length >= 3 && (bare(k).startsWith(w) || (bare(k).length >= 3 && w.startsWith(bare(k)))));
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
  const keys = [...got.keys()];
  const matched = new Set<string>();
  for (const [label, e] of Object.entries(want)) {
    const k = findLabel(keys, labelKey(label));
    if (k === undefined) {
      wrong.push(`no ${label}`);
      continue;
    }
    matched.add(k);
    const v = got.get(k) ?? null;
    if (e === null ? v !== null : v === null || !sameNumber(v, e)) wrong.push(`${label} ${v ?? "empty"}, not ${e ?? "empty"}`);
  }
  let invented = 0;
  for (const [k, v] of got)
    if (!matched.has(k) && v !== null) {
      invented++;
      wrong.push(`${k} ${v}, never said`);
    }
  let lost = 0;
  for (const [k, v] of before ?? []) if (v !== null && (got.get(k) ?? null) === null) lost++;
  return { right: wrong.length === 0, wrong, lost, invented };
}

/** A visual's items, as matched: a flow's or a cycle's steps, a timeline's events (date and what), a hub's spokes, a tree's branches, a Venn's items, a table's rows. */
function visualItems(v: ChartSpec | DiagramSpec | undefined): string[] {
  if (!v) return [];
  switch (v.kind) {
    case "flow":
    case "cycle":
      return v.steps;
    case "timeline":
      return v.events.map((e) => `${e.when} ${e.what}`);
    case "hub":
      return v.spokes;
    case "tree":
      return v.children.map((c) => [c.text, ...(c.children ?? [])].join(" "));
    case "venn":
      return [...v.leftOnly, ...v.both, ...v.rightOnly];
    case "table":
      return v.rows.map((r) => r.join(" "));
    default:
      return [];
  }
}

/** The patterns, in order, among the visual's items (each after the one before). */
export function scoreItems(d: ChartSpec | DiagramSpec | undefined, patterns: readonly string[]): { right: boolean; why: string } {
  const items = visualItems(d);
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

/**
 * What a tick did, against what it was to do. A bullet is always allowed beside a visual (a slide
 * has both); a heading only where one is due (`opts.heading`; the live sequences: a start whose
 * `also` names it) — a heading anywhere else starts a slide the lecture did not.
 */
export function judgeTick(
  expect: SequenceExpect,
  actions: readonly LectureAction[],
  started: readonly { id: string }[],
  updated: readonly { id: string }[],
  target: string | undefined,
  opts: { heading?: boolean } = {},
): { ok: boolean; why: string } {
  const did = actions.map(didOf).join(", ") || "nothing";
  const fail = (why: string) => ({ ok: false, why });
  if ("none" in expect) return actions.length === 0 ? { ok: true, why: "" } : fail(`drew ${did}`);
  const headingOk = opts.heading ?? ("start" in expect && (expect.also ?? []).includes("heading"));
  if (!headingOk && actions.some((a) => a.type === "heading")) return fail(`a new slide where none was due: ${did}`);
  const visuals = actions.filter((a) => VISUAL_TYPES.has(a.type) || UPDATE_TYPES.has(a.type));
  if ("keep" in expect) return visuals.length === 0 ? { ok: true, why: "" } : fail(`touched the visuals: ${did}`);
  if ("may" in expect) {
    const other = visuals.filter((a) => !((a.type === "update_chart" || a.type === "update_diagram") && a.target === target));
    return other.length === 0 ? { ok: true, why: "" } : fail(`drew ${other.map(didOf).join(", ")} beside ${expect.may}`);
  }
  if ("update" in expect) {
    if (!target) return fail(`nothing to update (${expect.update} was never started)`);
    if (started.length) return fail(`started a new one instead: ${did}`);
    return updated.some((u) => u.id === target) ? { ok: true, why: "" } : fail(`did not update ${expect.update}: ${did}`);
  }
  if (updated.length) return fail(`updated a live visual instead of starting one: ${did}`);
  const first = actions.find((a) => VISUAL_TYPES.has(a.type));
  if (!first) return fail(`started nothing: ${did}`);
  if (!expect.kinds.includes(kindOf(first))) return fail(`started a ${kindOf(first)}, not ${expect.kinds.join(" / ")}`);
  const allowed = new Set([...expect.kinds, ...(expect.also ?? []), "note", "heading"]);
  const extra = actions.filter((a) => a !== first && !allowed.has(kindOf(a)));
  return extra.length ? fail(`also drew ${extra.map(kindOf).join(", ")}`) : { ok: true, why: "" };
}

// ------------------------------------------------------------------ scoring a deck

/**
 * Two bullets that say the same thing, as a reader would count them: the route's own check either
 * way (`sameBullet`), or three words or more in common that are most of the shorter one. Looser
 * than the route, so it finds what got past it; the report lists every pair it flags.
 */
export function looseSameBullet(a: string, b: string): boolean {
  if (sameBullet(a, b) || sameBullet(b, a)) return true;
  const A = new Set(bulletWords(a));
  const B = new Set(bulletWords(b));
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared >= 3 && shared / Math.min(A.size, B.size) >= 0.7;
}

export interface SlideScore {
  /** titles due (the start, each topic change) and those written on the tick or the next, on topic */
  titles: number;
  titlesRight: number;
  titlesLate: number;
  titlesMissed: string[];
  /** titles written where none was due ("tick 7: …") */
  stray: string[];
  /** replies with a title that was not their first action (the desk writes a reply in order: the title first puts the rest on the new slide) */
  notFirst: string[];
  /** key points made, those bulleted (on their tick or the next), those a tick late */
  points: number;
  pointsBulleted: number;
  pointsLate: number;
  pointsMissed: string[];
  bullets: number;
  /** BULLET LENGTH (the desk: about `BULLET_ONE_LINE` characters fit one line, 75 is two): bullets on one line, those over the prompt's `BULLET_ASK_MAX`, the longest, and those the route cut short */
  oneLine: number;
  overAsk: string[];
  longest: number;
  cut: number;
  /** bullets on one topic that say the same thing (`looseSameBullet`) */
  dupes: Array<[string, string]>;
  /** bullets the route dropped as repeats: the model proposed them */
  caught: number;
  /** the most bullets one topic got (its slide and its continuations) */
  mostOnATopic: number;
  /** slides continued on the next screen ("<title> (cont.)") */
  continued: number;
  /** bullets that write a number the chart on their topic already shows */
  restating: string[];
  /** filler ticks (nothing to draw) and those left silent */
  filler: number;
  fillerSilent: number;
}

/** A run of a SLIDES sequence, scored as the deck it built. */
export function scoreSlides(seq: LectureSequence, ticks: readonly TickResult[], board: EvalBoard): SlideScore {
  const at = (i: number) => ticks.find((t) => t.tick === i + 1);
  const titles: SlideScore["titlesMissed"] = [];
  let titlesRight = 0;
  let titlesLate = 0;
  const dueAt = new Set<number>();
  seq.ticks.forEach((t, i) => {
    if (!t.title) return;
    dueAt.add(i);
    const re = new RegExp(t.title, "i");
    const now = at(i)?.headings ?? [];
    const next = at(i + 1)?.headings ?? [];
    if (now.some((h) => re.test(h))) titlesRight++;
    else if (next.some((h) => re.test(h))) {
      titlesRight++;
      titlesLate++;
    } else titles.push(`${i + 1}: /${t.title}/ (${[...now, ...next].join(", ") || "none"})`);
  });
  const stray = ticks.flatMap((t) => (dueAt.has(t.tick - 1) || dueAt.has(t.tick - 2) ? [] : t.headings.map((h) => `${t.tick}: ${h}`)));
  const notFirst = ticks.filter((t) => t.did.includes("heading") && t.did[0] !== "heading").map((t) => `${t.tick}: ${t.did.join(", ")}`);

  let points = 0;
  let pointsBulleted = 0;
  let pointsLate = 0;
  const pointsMissed: string[] = [];
  seq.ticks.forEach((t, i) => {
    for (const p of t.points ?? []) {
      points++;
      const re = new RegExp(p, "i");
      if ((at(i)?.notes ?? []).some((n) => re.test(n))) pointsBulleted++;
      else if ((at(i + 1)?.notes ?? []).some((n) => re.test(n))) {
        pointsBulleted++;
        pointsLate++;
      } else pointsMissed.push(`${i + 1}: /${p}/`);
    }
  });

  // the deck by topic: a slide and the slides that continue it
  const topics = new Map<number, string[]>();
  for (const s of board.slides) topics.set(s.topic, [...(topics.get(s.topic) ?? []), ...s.bullets]);
  const dupes: Array<[string, string]> = [];
  for (const bullets of topics.values()) for (let i = 0; i < bullets.length; i++) for (let j = i + 1; j < bullets.length; j++) if (looseSameBullet(bullets[j], bullets[i])) dupes.push([bullets[i], bullets[j]]);
  const restating: string[] = [];
  for (const [topic, bullets] of topics) {
    const shown = new Set(board.visuals.filter((v) => v.chart && board.slides[v.slide].topic === topic).flatMap((v) => chartNumbers(v.chart!)));
    for (const b of bullets) if (digitNumbers(b).some((n) => shown.has(n))) restating.push(b);
  }
  const filler = seq.ticks.filter((t) => "none" in t.expect).length;
  const all = board.slides.flatMap((s) => s.bullets);
  return {
    titles: dueAt.size,
    titlesRight,
    titlesLate,
    titlesMissed: titles,
    stray,
    notFirst,
    points,
    pointsBulleted,
    pointsLate,
    pointsMissed,
    bullets: all.length,
    oneLine: all.filter((b) => b.length <= BULLET_ONE_LINE).length,
    overAsk: all.filter((b) => b.length > BULLET_ASK_MAX),
    longest: Math.max(0, ...all.map((b) => b.length)),
    cut: ticks.reduce((n, t) => n + t.dropped.filter((d) => d.type === "note" && d.reason.startsWith("cut to")).length, 0),
    dupes,
    caught: ticks.reduce((n, t) => n + t.caught.length, 0),
    mostOnATopic: Math.max(0, ...[...topics.values()].map((b) => b.length)),
    continued: board.slides.filter((s) => s.cont).length,
    restating,
    filler,
    fillerSilent: ticks.filter((t) => t.expect === "nothing" && t.did.length === 0).length,
  };
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
  /** the titles and the bullets this tick wrote */
  headings: string[];
  notes: string[];
  /** bullets the route dropped as already on the board (what they repeat) */
  caught: string[];
  dropped: LectureDroppedAction[];
  invalid: number;
  call: Omit<CallRecord, "content">;
  content: string;
}

/** One sequence run by one model, one trial: its ticks, the deck it built, and (SLIDES) the deck's score. */
export interface SequenceRun {
  sequence: string;
  model: string;
  trial: number;
  ticks: TickResult[];
  slides: EvalSlide[];
  score?: SlideScore;
}

export interface SequenceRunOptions {
  sequences: readonly LectureSequence[];
  models: readonly string[];
  ctx: CallContext;
  trials?: number;
  /** fewer trials for some models (`LectureRunOptions.trialsFor`) */
  trialsFor?: (model: string) => number | undefined;
  reasoning?: EvalReasoning;
  concurrency?: number;
  log?: (line: string) => void;
}

const describeExpect = (e: SequenceExpect) =>
  "none" in e ? "nothing" : "keep" in e ? "leave the visuals" : "update" in e ? `update ${e.update}` : "may" in e ? `grow or leave ${e.may}` : `start ${e.start} (${e.kinds.join(" / ")})`;

/** One sequence, tick by tick, for one model and trial. */
async function runOne(seq: LectureSequence, model: string, trial: number, opts: SequenceRunOptions): Promise<SequenceRun> {
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
      screen: { empty: board.empty, topic: board.topic, drawn: board.drawn, room: board.room(), active },
      recent: board.recent,
    });
    const before = new Map(Object.keys(t.values ?? {}).map((name) => [name, chartValues(board.named(name)?.chart)]));
    let record: CallRecord | null = null;
    const base = { sequence: seq.id, tick: i + 1, model, trial, live: active.length > 0, expect: describeExpect(t.expect) };
    // a title is due on this tick, or was on the one before (a topic change said across two ticks)
    const heading = seq.slides ? Boolean(t.title || seq.ticks[i - 1]?.title) : undefined;
    try {
      const dir = await directLecture(req, { models: { lecture: model, lectureFallback: model }, callModel: benchModelCall(opts.ctx, trial, opts.reasoning, (r) => (record = r)) });
      const named = "update" in t.expect ? t.expect.update : "may" in t.expect ? t.expect.may : undefined;
      const target = named ? board.named(named)?.id : undefined;
      const { started, updated } = board.apply(dir.actions);
      if ("start" in t.expect && started[0]) started[0].name = t.expect.start;
      const judged = judgeTick(t.expect, dir.actions, started, updated, target, { heading });
      const { content, ...call } = record!;
      out.push({
        ...base,
        did: dir.actions.map(didOf),
        ok: judged.ok,
        why: judged.why,
        values: scoreTickValues(board, t, before),
        items: Object.entries(t.items ?? {}).map(([name, patterns]) => {
          const v = board.named(name);
          return { name, ...scoreItems(v?.diagram ?? v?.chart, patterns) };
        }),
        headings: dir.actions.flatMap((a) => (a.type === "heading" ? [a.text] : [])),
        notes: dir.actions.flatMap((a) => (a.type === "note" ? [a.text] : [])),
        caught: dir.dropped.filter((d) => d.type === "note" && d.why === "repeat").map((d) => d.what ?? d.reason),
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
      out.push({ ...base, did: [], ok: false, why: `call failed: ${why.slice(0, 80)}`, values: scoreTickValues(board, t, before), items: [], headings: [], notes: [], caught: [], dropped: [], invalid: 0, call, content });
    }
    said.push(t.fresh);
  }
  return { sequence: seq.id, model, trial, ticks: out, slides: board.slides, ...(seq.slides ? { score: scoreSlides(seq, out, board) } : {}) };
}

function scoreTickValues(board: EvalBoard, t: SequenceTick, before: Map<string, Map<string, number | null> | null>): TickResult["values"] {
  return Object.entries(t.values ?? {}).map(([name, want]) => ({ name, ...scoreValues(board.named(name)?.chart, want, before.get(name) ?? null) }));
}

/** Every sequence × model × trial (ticks in order within a sequence). */
export async function runSequences(opts: SequenceRunOptions): Promise<SequenceRun[]> {
  const trials = (model: string) => Array.from({ length: Math.max(1, opts.trialsFor?.(model) ?? opts.trials ?? 1) }, (_, t) => t);
  const jobs = opts.models.flatMap((model) => trials(model).flatMap((trial) => opts.sequences.map((seq) => ({ model, trial, seq }))));
  return pool(jobs, opts.concurrency ?? 4, ({ model, trial, seq }) => runOne(seq, model, trial, opts));
}
