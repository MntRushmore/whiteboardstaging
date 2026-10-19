/**
 * The brain: the board's own TypeScript logic behind a small API of plain JSON, for the native
 * iPad app (docs/IPAD-NATIVE.md, "The brain"). `scripts/build-ios-brain.mjs` bundles this file into
 * `brain.js`, which the app runs in JavaScriptCore (`ios/Packages/AgathonBrain`).
 *
 * Nothing here is new logic. Each method calls the same functions the web board calls, the way the
 * board calls them (`LiveLoop` in `src/lib/live/liveLoop.ts`), and only adapts the data:
 *
 *  - ink comes in as `BrainStroke` (one pen-down: `x[]`, `y[]`, optional pressure `p[]`), not as
 *    tldraw draw shapes;
 *  - everything out is plain JSON: no Map, no function (a graph's `f`), no tldraw record. A
 *    non-finite number crosses as a string (`json.ts`).
 *
 * The native side calls one function, `call(method, argsJson) → envelopeJson`, and gets
 * `{"ok":true,"result":…}` or `{"ok":false,"error":{"code","message"}}` — a thrown error never
 * escapes into the host as a JavaScript exception. `API_VERSION` changes whenever a method's
 * arguments or result change shape; the Swift wrappers check it on load.
 *
 * Ask (Phase 3): the board chat's desk as a pure planner (`chat.ts`: `chatPlan` then `chatResult`,
 * `chatPicture`) and the read-aloud chunking (`speech.ts`).
 *
 * Not here yet (see docs/IPAD-NATIVE.md): the loop's stateful bits that read the editor
 * (`withoutStrays`, `withProblemColumns`, a column's `filled`/`together`).
 */
import { all, create, version as mathjsVersion } from "mathjs";
import type { TLShapeId } from "tldraw";
import { createEngine } from "@/lib/live/engine";
import { isArithmetic, judgeLine } from "@/lib/live/engine/columnWork";
import type { AnalyzeContext, GraphForOptions, HelpMode, InkLine, InkStroke, LineAnalysis, LiveEngine, Rect } from "@/lib/live/contracts";
import { barGroups, splitInk, type Diagram, type StrokeVerdict } from "@/lib/live/diagrams";
import { stackGroups } from "@/lib/live/stackedSums";
import { clusterLines, unionRects } from "@/lib/live/strokeClusters";
import { buildPayload, payloadPointCount } from "@/lib/live/strokePayload";
import { analyzeColumn, localSolve, type LocalSolveResult } from "@/lib/live/localSolve";
import { HAND_WRITE, handSeedFor, handSizeFor, inlineHandSizeFor, placeHandPlanOnBaseline, planFromStrokes, planHandwriting, type HandPlanResult } from "@/lib/live/handwriting";
import { markAnchor, markKey, markStrokes, ringRect, type MarkKind } from "@/lib/live/marks";
import { decide, type PolicyDecision, type PolicyInput } from "@/lib/live/policy";
import { planGraph, type GraphWindowHint } from "@/lib/live/graphing";
import { composeHandwriting, layoutMath, mulberry32 } from "@/lib/hand";
import { practiceProblems, hasPractice } from "@/lib/learning/practiceSet";
import { findVariant } from "@/lib/learning/generators/variant";
import { classifyProblem } from "@/lib/learning/skills";
import { classifyMistake } from "@/lib/learning/mistakes";
import { problemLines, seedOf } from "@/lib/learning/nowYouTry";
import { learnerHint, summarize } from "@/lib/learning/summary";
import type { AttemptRecord, PracticeProblem, SkillId } from "@/lib/learning/contracts";
import type { LearnerHint, MistakeKind } from "@/lib/learning/hint";
import type { CourseId } from "@/lib/onboarding/courseIds";
import type { Grade } from "@/lib/learning/grades";
import type { ComplexRootsSetting } from "@/lib/live/engine/complexSetting";
import { sha1Hex } from "./sha1";
import { decode, encode, encodePlain } from "./json";
import { chatPicture, startChatPlan, takeChatPlan, type ChatPlanArgs, type ChatScreenArgs } from "./chat";
import { speechFit, speechSplit, speechTake, spoken } from "./speech";

/** Bumped whenever a method's arguments or result change shape. */
export const API_VERSION = 0;

// ------------------------------------------------------------------ data in

/** One pen-down of the student's ink, page coordinates. `bounds` defaults to the points' box. */
export interface BrainStroke {
  id: string;
  x: number[];
  y: number[];
  /** pressure, 0..1; carried for the board, unused by the logic */
  p?: number[];
  bounds?: Rect;
}

export class BrainError extends Error {
  constructor(
    readonly code: "bad_args" | "unknown_method" | "not_ready",
    message: string,
  ) {
    super(message);
    this.name = "BrainError";
  }
}

function need(cond: unknown, message: string): asserts cond {
  if (!cond) throw new BrainError("bad_args", message);
}

function pointsBox(xs: readonly number[], ys: readonly number[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!(x1 >= x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A `BrainStroke` as the board's `InkStroke` (`LiveLoop.inkOf`): one segment, page coordinates. */
export function toInkStroke(s: BrainStroke): InkStroke {
  need(s && typeof s.id === "string" && Array.isArray(s.x) && Array.isArray(s.y) && s.x.length === s.y.length, "a stroke is { id, x[], y[] } with as many x as y");
  const points = new Array<{ x: number; y: number }>(s.x.length);
  for (let i = 0; i < s.x.length; i++) points[i] = { x: s.x[i], y: s.y[i] };
  return { id: s.id as TLShapeId, bounds: s.bounds ?? pointsBox(s.x, s.y), segments: [points] };
}

/** Ids for new lines and drawings from a seed (parity tests), or the board's random ones. */
function idSource(prefix: "ln" | "dg", seed: number | undefined): (() => string) | undefined {
  if (seed === undefined) return undefined;
  const rand = mulberry32((seed ^ (prefix === "ln" ? 0x6c6e : 0x6467)) >>> 0);
  return () => `${prefix}_${Math.floor(rand() * 0xffffffff).toString(16).padStart(8, "0")}`;
}

// ------------------------------------------------------------------ the engine

let engineInstance: LiveEngine | null = null;
let engineMs = 0;

/** mathjs `create(all)` and the engine on it: built once, on first use or by `init`. */
function engine(): LiveEngine {
  if (!engineInstance) {
    const t0 = now();
    // the engine needs only `create(all)` (`engine/math.ts`); the bundle maps `mathjs` to just those
    // (`scripts/build-ios-brain.mjs`), without the default instance mathjs builds on import
    engineInstance = createEngine({ create, all } as unknown as Parameters<typeof createEngine>[0]);
    engineMs = now() - t0;
  }
  return engineInstance;
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

// ------------------------------------------------------------------ methods

export function init(): { api: number; engineMs: number; mathjs: string } {
  engine();
  return { api: API_VERSION, engineMs, mathjs: mathjsVersion };
}

export function version(): { api: number; mathjs: string } {
  return { api: API_VERSION, mathjs: mathjsVersion };
}

export interface AnalyzeLineArgs {
  latex: string;
  /** the column context (`LiveLoop.columnContext`); `mode` defaults to "feedback" */
  context?: Partial<AnalyzeContext>;
}

/** `engine.analyzeLine`: one line against the line above it and the column's first relation. */
export function analyzeLine(args: AnalyzeLineArgs): LineAnalysis {
  need(typeof args.latex === "string", "latex is a string");
  const ctx: AnalyzeContext = { ...args.context, mode: (args.context?.mode ?? "feedback") as HelpMode };
  return engine().analyzeLine(args.latex, ctx);
}

export interface JudgeLineArgs {
  latex: string;
  /** the column context (`LiveLoop.columnContext`); `mode` defaults to "feedback" */
  context?: Partial<AnalyzeContext>;
  /**
   * The problem the line is part of: the tutor's problem heading its column, else the column's first
   * line. In arithmetic (no letters: `isArithmetic`) a young student's working is judged against it
   * (`LiveLoop.arithmeticLines`): a lone number is the answer, a side calculation is no slip.
   */
  problem?: string[] | null;
  /** the student's lines above it in its column, top to bottom, as read */
  above?: string[];
  /** the step right above it when that step is a slip (ringed, or carried on from one) */
  slip?: LineAnalysis;
}

/** `judgeLine` (engine/columnWork.ts): a line of the student's working judged in its column, as `LiveLoop.judge` does. */
export function judgeLineOf(args: JudgeLineArgs): LineAnalysis {
  need(typeof args.latex === "string", "latex is a string");
  const ctx: AnalyzeContext = { ...args.context, mode: (args.context?.mode ?? "feedback") as HelpMode };
  const problem = Array.isArray(args.problem) ? args.problem.filter((l) => typeof l === "string" && l.trim().length > 0) : [];
  const arithmetic = problem.length > 0 && problem.every(isArithmetic) ? problem : null;
  const above = Array.isArray(args.above) ? args.above.filter((l) => typeof l === "string") : [];
  return judgeLine(engine(), args.latex, { ctx, arithmetic, above, slip: args.slip });
}

/** Each line of a column analysed as the loop holds it (`analyzeColumn` in localSolve.ts). */
export function analyzeColumnOf(args: { lines: string[]; mode?: HelpMode }): (LineAnalysis | null)[] {
  need(Array.isArray(args.lines), "lines is an array of LaTeX strings");
  return analyzeColumn(engine(), args.lines, args.mode ?? "answer");
}

/** The tutor's hand for a worked block, as the offline scoreboard sizes it: the interlock ignores size. */
const SOLVE_HAND = { size: 28, seed: 1 } as const;

export interface LocalSolveArgs {
  lines: string[];
  targetIndex?: number;
  handwriting?: boolean;
  mode?: HelpMode;
  complexRoots?: ComplexRootsSetting;
  domain?: string;
}

/**
 * What Solve writes without a model (`localSolve`), with the board's hand interlock: steps the hand
 * cannot draw drop to the next local path, as `drawStepsByHand` does.
 */
export function localSolveOf(args: LocalSolveArgs): LocalSolveResult {
  need(Array.isArray(args.lines), "lines is an array of LaTeX strings");
  const canDraw = (steps: readonly string[]) => {
    if (steps.length === 0) return true;
    const r = planHandwriting(steps, SOLVE_HAND);
    return r.unsupported.length === 0 && r.plan !== null;
  };
  return localSolve(engine(), args.lines, args.targetIndex, {
    canDraw,
    handwriting: args.handwriting,
    mode: args.mode,
    complexRoots: args.complexRoots,
    domain: args.domain,
  });
}

/** `engine.calculate`: the calculator's input (`3.2*4.5`, `5 km/h to m/s`, `balance Fe+O2->Fe2O3`). */
export function calculate(args: { input: string }): { latex: string } | null {
  need(typeof args.input === "string", "input is a string");
  return engine().calculate(args.input);
}

/** `engine.verifyExpected`: a model's `expected` claim (mathjs) against the student's line. */
export function verifyExpected(args: { expected: string; latex: string }): "equal" | "unequal" | "unknown" {
  need(typeof args.expected === "string" && typeof args.latex === "string", "expected and latex are strings");
  return engine().verifyExpected(args.expected, args.latex);
}

export interface ClusterArgs {
  strokes: BrainStroke[];
  /** the lines of the last flush: their ids carry over to lines sharing half their strokes */
  previousLines?: InkLine[];
  /** the drawings of the last flush: their ids carry over the same way */
  previousDiagrams?: Diagram[];
  /** the board's fit zoom (screen px per page px); none is a desktop */
  zoom?: number;
  /** the tutor's problems on the screen, as boxes: a bar drawn under one is a division bar */
  equations?: Rect[];
  /** set drawings apart first, as the board does (default true); false clusters every stroke */
  split?: boolean;
  /** new ids from this seed instead of random ones (parity tests) */
  idSeed?: number;
}

export interface ClusterResult {
  lines: InkLine[];
  diagrams: Diagram[];
  bars: ReturnType<typeof splitInk>["bars"];
  stacks: ReturnType<typeof splitInk>["stacks"];
  /** the glyph scale the split judged sizes by (page px) */
  glyph: number;
  /** stroke id → what the split made of it */
  roles: Record<string, StrokeVerdict>;
}

/**
 * The board's flush (`LiveLoop.flush`) minus its editor state: drawings, division bars and stacked
 * sums set apart (`splitInk`), then the handwriting clustered into lines and columns
 * (`clusterLines`), a bar with its divisor and a stacked sum a line each.
 */
export function clusterStrokes(args: ClusterArgs): ClusterResult {
  need(Array.isArray(args.strokes), "strokes is an array");
  const ink = args.strokes.map(toInkStroke);
  const previousLines = args.previousLines ?? [];
  if (args.split === false) {
    const lines = clusterLines(ink, previousLines, [], { zoom: args.zoom, newId: idSource("ln", args.idSeed) });
    return { lines, diagrams: [], bars: [], stacks: [], glyph: 0, roles: {} };
  }
  const split = splitInk(ink, args.previousDiagrams ?? [], { zoom: args.zoom, equations: args.equations, newId: idSource("dg", args.idSeed) });
  const fixed = [...barGroups(split.bars, ink), ...stackGroups(split.stacks, ink)];
  const lines = clusterLines(split.writing, previousLines, fixed, { zoom: args.zoom, newId: idSource("ln", args.idSeed) });
  return { lines, diagrams: split.diagrams, bars: split.bars, stacks: split.stacks, glyph: split.glyph, roles: Object.fromEntries(split.roles) };
}

export interface PayloadArgs {
  strokes: BrainStroke[];
  /** the line to send; default every stroke given, as one line */
  line?: { id?: string; strokeIds: string[]; bounds?: Rect };
}

export interface PayloadResult {
  /** `/api/live/recognize`'s `strokes` and `bounds` */
  strokes: { x: number[][]; y: number[][] };
  bounds: { w: number; h: number };
  /** the recognition cache key: sha-1 hex of JSON([x, y]), the same as the web board's */
  hash: string;
  points: number;
}

/**
 * The body pieces the board sends to `/api/live/recognize` for one line (`buildPayload`:
 * normalised to ~180 px tall, RDP-simplified, capped), and its cache key. Null when the line is
 * over the stroke or point caps (the board marks it "Too much ink for one line").
 */
export function recognizerPayload(args: PayloadArgs): PayloadResult | null {
  need(Array.isArray(args.strokes), "strokes is an array");
  const ink = args.strokes.map(toInkStroke);
  const ids = args.line?.strokeIds ?? ink.map((s) => s.id as string);
  const byId = new Map(ink.map((s) => [s.id as string, s]));
  const members = ids.flatMap((id) => byId.get(id) ?? []);
  if (members.length === 0) return null;
  const line: InkLine = {
    id: args.line?.id ?? "line",
    strokeIds: ids as TLShapeId[],
    bounds: args.line?.bounds ?? unionRects(members.map((s) => s.bounds)),
    column: 0,
    row: 0,
    hash: "",
  };
  const payload = buildPayload(line, ink);
  if (!payload) return null;
  return {
    strokes: { x: payload.x, y: payload.y },
    bounds: { w: payload.w, h: payload.h },
    hash: sha1Hex(JSON.stringify([payload.x, payload.y])),
    points: payloadPointCount(payload),
  };
}

export interface HandwritingArgs {
  /** LaTeX lines, top to bottom (a worked solution), or one `latex` */
  steps?: string[];
  latex?: string;
  /** cap height in px; default from `lineHeight` (`handSizeFor`, or `inlineHandSizeFor` with `inline`) */
  size?: number;
  /** the student's line height (page px) the hand is sized to */
  lineHeight?: number;
  inline?: boolean;
  zoom?: number;
  /** the hand's seed; default `handSeedFor(seedKey ?? steps)` */
  seed?: number;
  seedKey?: string;
  /** top-left of the block's ink (page px) */
  origin?: { x: number; y: number };
  /** or: where the first line's writing line is, to finish the student's own line */
  baseline?: { x: number; baselineY: number };
}

/**
 * The tutor's handwriting for LaTeX steps (`planHandwriting`): per line, strokes (with pressure
 * `z`) relative to the line's origin, its baseline, and when it starts and how long it takes at a
 * natural pace (`pace` speeds a long block up). `unsupported` non-empty means do not draw: show
 * the typeset maths instead.
 */
export function layoutHandwriting(args: HandwritingArgs): HandPlanResult & { size: number; seed: number } {
  const steps = args.steps ?? (typeof args.latex === "string" ? [args.latex] : null);
  need(Array.isArray(steps) && steps.every((s) => typeof s === "string"), "steps is an array of LaTeX strings (or latex is one)");
  const size =
    args.size ??
    (args.lineHeight !== undefined ? (args.inline ? inlineHandSizeFor(args.lineHeight, args.zoom) : handSizeFor(args.lineHeight, args.zoom)) : HAND_WRITE.minSize);
  const seed = args.seed ?? handSeedFor(args.seedKey ?? steps.join("\n"));
  const result = planHandwriting(steps, { size, seed, origin: args.origin });
  if (result.plan && args.baseline) return { plan: placeHandPlanOnBaseline(result.plan, args.baseline), unsupported: result.unsupported, size, seed };
  return { ...result, size, seed };
}

/** One LaTeX expression laid out in the hand (`layoutMath`), layout coordinates, no timing. */
export function layoutMathOf(args: { latex: string; size?: number; seed?: number }) {
  need(typeof args.latex === "string", "latex is a string");
  return layoutMath(args.latex, { size: args.size, seed: args.seed });
}

/** Words in the tutor's hand (`composeHandwriting`), wrapped at `maxWidth`, local coordinates. */
export function writeText(args: { text: string; maxWidth: number; size?: number; seed?: number }) {
  need(typeof args.text === "string" && typeof args.maxWidth === "number", "text is a string and maxWidth a number");
  return composeHandwriting(args.text, { maxWidth: args.maxWidth, size: args.size, seed: args.seed });
}

export interface MarkArgs {
  kind: MarkKind;
  /** the student's line, page px */
  bbox: Rect;
  /** default `handSeedFor(seedKey)`; the board's key is `${lineId}:${kind}` */
  seed?: number;
  seedKey?: string;
}

/**
 * A tick, a ring or a question mark for a line (`markStrokes`), and the plan the board reveals it
 * with (`planFromStrokes` at the hand's smallest size), as `LiveLoop` draws a mark.
 */
export function marks(args: MarkArgs) {
  need(args.kind === "check" || args.kind === "circle" || args.kind === "question", "kind is check, circle or question");
  need(args.bbox && typeof args.bbox.x === "number", "bbox is a rect");
  const seed = args.seed ?? handSeedFor(args.seedKey ?? `${args.kind}`);
  const strokes = markStrokes(args.kind, args.bbox, seed);
  return {
    strokes,
    plan: planFromStrokes(args.kind, strokes, HAND_WRITE.minSize),
    key: markKey(args.kind, args.bbox),
    anchor: markAnchor(args.bbox),
    ring: ringRect(args.bbox),
  };
}

/** The help ladder and silence rules for one line (`decide` in policy.ts). */
export function policy(args: PolicyInput): PolicyDecision {
  need(args && typeof args.mode === "string", "mode is a help mode");
  return decide(args);
}

export interface VariantArgs {
  problem: PracticeProblem;
  seed: number;
  /**
   * Run the search on a still clock (no time budget): the same answer on every machine. The board
   * runs on the real clock, so a slow device gets a variant within ~80 ms; parity tests pass true.
   */
  stillClock?: boolean;
}

/** "Now you try": a new problem like this one (`variantOf` in practice.ts), checked by the engine. */
export function variantOf(args: VariantArgs): PracticeProblem | null {
  need(Array.isArray(args.problem) && typeof args.seed === "number", "problem is LaTeX lines and seed a number");
  try {
    return findVariant(engine(), args.problem, args.seed, {
      fallback: (lines) => {
        const skill = classifyProblem(lines);
        return hasPractice(skill) ? practiceProblems(skill, 3, args.seed) : [];
      },
      ...(args.stillClock ? { now: () => 0 } : {}),
    });
  } catch {
    return null;
  }
}

/** "Now you try" from an attempt record, as the board's offer does: its problem, its id's seed. */
export function nowYouTry(args: { problemLatex: string; attemptId: string; stillClock?: boolean }): PracticeProblem | null {
  need(typeof args.problemLatex === "string" && typeof args.attemptId === "string", "problemLatex and attemptId are strings");
  return variantOf({ problem: problemLines(args.problemLatex), seed: seedOf(args.attemptId), stillClock: args.stillClock });
}

/** `count` practice problems for a skill (`practiceProblems`): same seed, same problems. */
export function practice(args: { skill: SkillId; count: number; seed: number }): PracticeProblem[] {
  need(typeof args.skill === "string" && typeof args.count === "number" && typeof args.seed === "number", "skill, count and seed");
  return practiceProblems(args.skill, args.count, args.seed);
}

/**
 * "Practice my weak spots" (`weakSpotPractice` in components/chat/chatView.ts): `count` problems on
 * the weakest skill that has practice problems, the next one if it makes none. Null: nothing to
 * practise.
 */
export function weakSpotPractice(args: { hint?: LearnerHint; seed: number; count?: number }): { skill: LearnerHint["weakSkills"][number]; problems: PracticeProblem[] } | null {
  need(typeof args.seed === "number", "seed is a number");
  const count = args.count ?? 4;
  for (const s of args.hint?.weakSkills ?? []) {
    if (!hasPractice(s.id)) continue;
    const problems = practiceProblems(s.id as SkillId, count, args.seed).filter((p) => p.length > 0);
    if (problems.length > 0) return { skill: s, problems: problems.map((p) => [...p]) };
  }
  return null;
}

/** What a problem is practice of (`classifyProblem`): the skill attempts are filed under. */
export function classify(args: { lines: string[]; course?: string | null }): SkillId {
  need(Array.isArray(args.lines), "lines is an array of LaTeX strings");
  return classifyProblem(args.lines, args.course);
}

/**
 * What kind of mistake a ringed line is, compared with the line above it (`classifyMistake`, the
 * board's own classifier for the learning record); null when none of the kinds explains it.
 */
export function mistakeOf(args: { previous: string; latex: string }): MistakeKind | null {
  need(typeof args.previous === "string" && typeof args.latex === "string", "previous and latex are strings");
  return classifyMistake(engine(), args.previous, args.latex);
}

export interface ProgressArgs {
  attempts: AttemptRecord[];
  /** ms since the epoch */
  now: number;
  course?: CourseId | null;
  grade?: Grade | null;
  tzOffsetMinutes?: number;
}

/** The Progress page's numbers from the attempts (`summarize`), and the tutor's learner hint. */
export function progressSummary(args: ProgressArgs) {
  need(Array.isArray(args.attempts) && typeof args.now === "number", "attempts is an array and now a number");
  const summary = summarize(args.attempts, args.now, { course: args.course, grade: args.grade, tzOffsetMinutes: args.tzOffsetMinutes });
  return { summary, hint: learnerHint(summary) ?? null };
}

export interface GraphArgs {
  /** a column of work, top to bottom, or relations asked for by name (`explicit`) */
  lines: string[];
  explicit?: boolean;
  seed?: number;
  box?: { w: number; h: number };
  window?: GraphWindowHint;
}

/**
 * What the tutor graphs for a column (`engine.graphFor`) and the hand-drawn sketch of it
 * (`planGraph`). The intent crosses without its curves' samplers (`f`); `expr` is each one's
 * mathjs source. Null when there is nothing to graph or nothing the hand can draw.
 */
export function sketchGraph(args: GraphArgs) {
  need(Array.isArray(args.lines), "lines is an array of LaTeX strings");
  const opts: GraphForOptions = args.explicit ? { explicit: true } : {};
  const intent = engine().graphFor?.(args.lines, opts) ?? null;
  if (!intent) return null;
  const sketch = planGraph(intent, { seed: args.seed ?? handSeedFor(args.lines.join("\n")), box: args.box, window: args.window });
  if (!sketch) return { intent, plan: null, box: null, window: null };
  return { intent, plan: sketch.plan, box: sketch.box, window: sketch.window };
}

// ------------------------------------------------------------------ Ask

/**
 * Plans a reply's board actions (`chat.ts`): starts the web's desk on a copy of the screen and
 * answers a ticket; `chatResult` with it on the next call has the operations and the report (the
 * run settles between the two calls: every promise of its host is already settled).
 */
export function chatPlan(args: ChatPlanArgs): { ticket: number } {
  need(Array.isArray(args.actions) && Array.isArray(args.shapes), "actions and shapes are arrays");
  need(args.screen && typeof args.screen.w === "number", "screen is a rect");
  need(typeof args.pageId === "string", "pageId is a string");
  return startChatPlan(args, engine);
}

export function chatResult(args: { ticket: number }) {
  need(typeof args.ticket === "number", "ticket is a number");
  return takeChatPlan(args.ticket);
}

/** The current screen as maths, for an ask's `screen` (`ChatDesk.picture`). */
export function chatPictureOf(args: ChatScreenArgs) {
  need(Array.isArray(args.shapes) && typeof args.pageId === "string", "shapes is an array and pageId a string");
  return chatPicture(args, engine);
}

/**
 * A tight integer loop, for the host to tell an interpreter from a JIT: JavaScriptCore without a
 * JIT runs it ~20–50x slower than with one.
 */
export function jitProbe(args: { n?: number }): { ms: number; sum: number } {
  const n = args.n ?? 5_000_000;
  const t0 = now();
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + ((i * 7) ^ (i >>> 3))) | 0;
  return { ms: now() - t0, sum };
}

// ------------------------------------------------------------------ the boundary

type Method = { run: (args: never) => unknown; plain?: boolean };

/**
 * Every method the host may call. `plain`: the result holds only finite numbers, strings and
 * arrays (strokes, payloads), so it is written without the non-finite replacer (`json.ts`).
 */
export const METHODS: Readonly<Record<string, Method>> = {
  version: { run: version },
  init: { run: init },
  analyzeLine: { run: analyzeLine },
  judgeLine: { run: judgeLineOf },
  analyzeColumn: { run: analyzeColumnOf },
  localSolve: { run: localSolveOf },
  calculate: { run: calculate },
  verifyExpected: { run: verifyExpected },
  clusterStrokes: { run: clusterStrokes },
  recognizerPayload: { run: recognizerPayload, plain: true },
  layoutHandwriting: { run: layoutHandwriting, plain: true },
  layoutMath: { run: layoutMathOf, plain: true },
  writeText: { run: writeText, plain: true },
  marks: { run: marks, plain: true },
  policy: { run: policy },
  variantOf: { run: variantOf },
  nowYouTry: { run: nowYouTry },
  practice: { run: practice },
  weakSpotPractice: { run: weakSpotPractice },
  classify: { run: classify },
  classifyMistake: { run: mistakeOf },
  progressSummary: { run: progressSummary },
  sketchGraph: { run: sketchGraph },
  chatPlan: { run: chatPlan },
  chatResult: { run: chatResult },
  chatPicture: { run: chatPictureOf },
  speechTake: { run: speechTake },
  speechSplit: { run: speechSplit },
  speechFit: { run: speechFit },
  spoken: { run: spoken },
  jitProbe: { run: jitProbe },
};

function errorEnvelope(e: unknown): string {
  const code = e instanceof BrainError ? e.code : "threw";
  const message = e instanceof Error ? e.message : String(e);
  const stack = e instanceof Error && typeof e.stack === "string" ? e.stack.split("\n").slice(0, 8).join("\n") : "";
  return encode({ ok: false, error: { code, message, stack } });
}

/**
 * The one entry point the native host calls: `method` with its arguments as JSON, the result as a
 * JSON envelope. Never throws.
 */
export function call(method: string, argsJson: string): string {
  try {
    const m = Object.prototype.hasOwnProperty.call(METHODS, method) ? METHODS[method] : undefined;
    if (!m) throw new BrainError("unknown_method", `no brain method "${method}"`);
    const args = decode<Record<string, unknown>>(argsJson || "{}") ?? {};
    const result = (m.run as (a: unknown) => unknown)(args);
    return `{"ok":true,"result":${(m.plain ? encodePlain : encode)(result === undefined ? null : result)}}`;
  } catch (e) {
    return errorEnvelope(e);
  }
}

/** Every method's name, for the host's lab screen. */
export function methods(): string[] {
  return Object.keys(METHODS);
}
