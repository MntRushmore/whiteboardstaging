/**
 * A skill page's math (`/math/long-division`, docs/SEO.md): one worked example and a practice set of
 * ten problems with their answers, made at build time by the app's own generators and worked by the
 * board's own engine, so the page shows exactly the kind of problem a kid meets on a topic board,
 * worked the way the tutor works it.
 *
 * - The worked example is picked as the topic board picks it (`pickLocalExample`, topicExample.ts):
 *   from the topic's example candidates, the first the engine works out on its own, preferring one
 *   with more than one step to show. Its steps are the ones the tutor writes under it
 *   (`localWorkFor`).
 * - The practice set is the topic's ladder (`drawLadder`), easy to hard: each problem must be one
 *   the board chat would write (`verifyProblem`: the engine reads it and Solve answers it locally,
 *   the hand can write it), and its answer is the engine's.
 * - No answer is shown unchecked: every answer is checked again here (`checkAnswer`), apart from the
 *   engine's solver, by putting it back into the problem with mathjs (an equation's solutions are
 *   substituted and its other roots searched for; an inequality is sampled on both sides; an
 *   expression is compared at sample values; a derivative, an integral or a limit numerically). A
 *   problem that fails is dropped and another is drawn, at the same rung of the ladder.
 *
 * Fixed seeds, so the same build writes the same page. `latexToPlain` gives each line as plain
 * Unicode text (`\frac{3}{4} + \frac{1}{6}` → `3/4 + 1/6`) for crawlers, screen readers and
 * llms-full.txt.
 *
 * Pure apart from the engine (mathjs, created once on first use): no React, no network.
 */
import * as mathjs from "mathjs";
import type { PracticeProblem } from "@/lib/learning/contracts";
import { drawLadder } from "@/lib/learning/generators";
import { localWorkFor } from "@/lib/learning/topicExample";
import type { TopicId } from "@/lib/learning/topics";
import { answerOf, handCanWrite, verifyProblem } from "@/lib/live/chat/verify";
import type { LiveEngine } from "@/lib/live/contracts";
import { createEngine } from "@/lib/live/engine";
import { splitRelations } from "@/lib/live/engine/latex";
import { createMathInstance, translate } from "@/lib/live/engine/math";

// ------------------------------------------------------------------ the shapes

/** One line of math: as written (LaTeX, for the hand) and as plain text (for every reader). */
export interface MathLine {
  latex: string;
  text: string;
}

export interface WorkedExample {
  /** the problem, one line (a system or a function and a question about it: two or three) */
  problem: MathLine[];
  /** what the tutor writes under it, in order; the last is the answer */
  steps: MathLine[];
  /** the final answer on its own (`x = 7`, `16`; a system's letters together) */
  answer: MathLine;
}

export interface PracticeItem {
  problem: MathLine[];
  /** the answer on its own, as the answer key shows it (`16`, `x = 7`, `x = 4, y = 2`) */
  answer: MathLine;
  /**
   * The interval the answer is for, when the problem gives none and the tutor states it as the first
   * line of its working (`2\sin x = -1` is solved for `0° \le x < 360°`).
   */
  interval?: MathLine;
}

export interface SkillContent {
  id: TopicId;
  /** null only if the engine could work none of the skill's candidates (never on 2026-10-13) */
  example: WorkedExample | null;
  /** `PRACTICE_COUNT` problems, easy to hard, each new to the page */
  problems: PracticeItem[];
  /**
   * The practice problems are worth writing in the board's hand (fractions, powers, roots, integrals:
   * a plain line flattens them). Plain sums (`48 ÷ 3`) read as well in type.
   */
  handwritten: boolean;
}

/** Problems in a practice set. */
export const PRACTICE_COUNT = 10;
/** The page's seed: the ladder and the example candidates come from it, then from the next seeds when one fails. */
export const CONTENT_SEED = 1;
/** Seeds tried before a rung of the ladder (or the example) is given up. */
const SEEDS = 8;

// ------------------------------------------------------------------ the engine

let engineOnce: LiveEngine | null = null;
let mathOnce: mathjs.MathJsInstance | null = null;

/** The board's engine, made once (synchronously: the server has mathjs already). */
export function seoEngine(): LiveEngine {
  engineOnce ??= createEngine(mathjs);
  return engineOnce;
}

function seoMath(): mathjs.MathJsInstance {
  mathOnce ??= createMathInstance(mathjs);
  return mathOnce;
}

// ------------------------------------------------------------------ a skill's content

const cache = new Map<TopicId, SkillContent>();

/** The worked example and the practice set of a skill (built once per process). */
export function skillContent(id: TopicId, engine: LiveEngine = seoEngine()): SkillContent {
  const hit = cache.get(id);
  if (hit && engine === engineOnce) return hit;
  const content = buildContent(id, engine);
  if (engine === engineOnce) cache.set(id, content);
  return content;
}

const keyOf = (p: readonly string[]) => p.join("; ");

function buildContent(id: TopicId, engine: LiveEngine): SkillContent {
  const ladders = Array.from({ length: SEEDS }, (_, k) => drawLadder(id, PRACTICE_COUNT, CONTENT_SEED + k));
  const used = new Set<string>();
  const opts: CheckOptions = { lengths: LENGTH_SKILLS.has(id) };

  const example = pickExample(engine, ladders.map((l) => l.examples), opts);
  if (example) used.add(keyOf(example.problem.map((l) => l.latex)));

  const problems: PracticeItem[] = [];
  for (let rung = 0; rung < PRACTICE_COUNT; rung++) {
    // this rung of the first ladder, else the same rung of the next seed's, and so on
    for (const ladder of ladders) {
      const p = ladder.problems[rung];
      if (!p || used.has(keyOf(p))) continue;
      const item = practiceItem(engine, p, opts);
      if (!item) continue;
      used.add(keyOf(p));
      problems.push(item);
      break;
    }
  }
  return { id, example, problems, handwritten: problems.some((p) => p.problem.some((l) => HAND_HELPS.test(l.latex))) };
}

/** Structure a plain line flattens: a fraction, a power, a root, a subscript, an integral or a limit. */
const HAND_HELPS = /\\frac|\\sqrt|\^|_\{|\\int|\\lim|\\log_/;

/**
 * The topic board's choice (`pickLocalExample`): of the candidates, the first the engine works out
 * on the device. Here the first with more than one step to watch wins over a one-line one, and the
 * hand must be able to write every line. The first seed's candidates first, then the next seed's.
 */
function pickExample(engine: LiveEngine, candidateSets: readonly PracticeProblem[][], opts: CheckOptions): WorkedExample | null {
  for (const candidates of candidateSets) {
    let oneLine: WorkedExample | null = null;
    for (const c of candidates) {
      const worked = workedExample(engine, c, opts);
      if (!worked) continue;
      if (worked.steps.length > 1) return worked;
      oneLine ??= worked;
    }
    if (oneLine) return oneLine;
  }
  return null;
}

function workedExample(engine: LiveEngine, problem: PracticeProblem, opts: CheckOptions): WorkedExample | null {
  const steps = localWorkFor(engine, problem);
  if (steps.length === 0 || !handCanWrite(problem) || !handCanWrite(steps)) return null;
  const answer = finalAnswer(problem, steps);
  if (!answer || !checkAnswer(problem, answer, steps, opts)) return null;
  return { problem: problem.map(mathLine), steps: steps.map(mathLine), answer: mathLine(answerShown(answer)) };
}

function practiceItem(engine: LiveEngine, problem: PracticeProblem, opts: CheckOptions): PracticeItem | null {
  const verdict = verifyProblem(engine, problem, handCanWrite);
  if (!verdict.ok) return null;
  const answer = finalAnswer(verdict.lines, verdict.steps);
  if (!answer || !checkAnswer(verdict.lines, answer, verdict.steps, opts)) return null;
  const item: PracticeItem = { problem: verdict.lines.map(mathLine), answer: mathLine(answerShown(answer)) };
  // a trig equation solved on an interval the problem does not state
  const trig = verdict.lines.some((l) => TRIG_EQUATION.test(l) && /=/.test(l));
  const stated = verdict.lines.some((l) => parts(l).slice(1).some((p) => domainOf(p)));
  const interval = trig && !stated ? verdict.steps.find((s) => !/,/.test(s) && domainOf(s)) : undefined;
  if (interval) item.interval = mathLine(interval);
  return item;
}

const TRIG_EQUATION = /\\(?:sin|cos|tan)\s*x/;

export function mathLine(latex: string): MathLine {
  return { latex, text: latexToPlain(latex) };
}

/** `= 16` is shown as `16`; a relation (`x = 7`) as it is. */
function answerShown(answer: string): string {
  return answer.replace(/^\s*=\s*/, "");
}

// ------------------------------------------------------------------ the answer

/** Letters that are not unknowns: e, i and the units a problem may carry. */
const NOT_UNKNOWNS = new Set(["e", "i"]);

/** The letters of a line outside commands (`\frac`, `\mathrm{km}`), in order, each once. */
function lettersOf(latex: string): string[] {
  const bare = latex.replace(/\\mathrm\{[^{}]*\}/g, "").replace(/\\[a-zA-Z]+/g, " ");
  return [...new Set(bare.match(/[a-zA-Z]/g) ?? [])].filter((l) => !NOT_UNKNOWNS.has(l));
}

/** `x = 6`: a line that gives a letter a number. */
const GIVEN = /^\s*([a-zA-Z])\s*=\s*(-?\s*[\d.]+|-?\\frac\{\d+\}\{\d+\})\s*$/;

/**
 * The answer as the answer key says it: the engine's last line, except for a system, where every
 * unknown's value is taken from the last line that gives it (`x = 4, \ y = 2`).
 */
export function finalAnswer(problem: readonly string[], steps: readonly string[]): string {
  const last = answerOf(steps).trim();
  if (problem.length < 2 || !problem.every((l) => /=/.test(l)) || problem.some((l) => /\(x\)/.test(l))) return last;
  const given = new Set(problem.map((l) => GIVEN.exec(l)?.[1]).filter(Boolean));
  const unknowns = [...new Set(problem.flatMap(lettersOf))].filter((l) => !given.has(l)).sort();
  if (unknowns.length < 2) return last;
  const values = unknowns.map((v) => [...steps].reverse().find((s) => GIVEN.exec(s)?.[1] === v));
  return values.every(Boolean) ? values.map((s) => s!.trim()).join(", \\ ") : last;
}

// ------------------------------------------------------------------ checking an answer

/**
 * Is `answer` right for `problem`? Checked apart from the engine's solver, with mathjs, the way a
 * teacher checks: put it back in. `steps` (the engine's working) is read only for the interval a
 * trig equation was solved on when the problem gave none (the tutor writes it as its first line).
 * False whenever the check cannot be done: an answer we cannot check is never shown.
 */
export function checkAnswer(problem: readonly string[], answer: string, steps: readonly string[] = [], opts: CheckOptions = {}): boolean {
  try {
    if (problem.length === 0 || !answer.trim()) return false;
    if (problem.some(isFunctionDef)) return checkFunctions(problem, answer);
    const relations = problem.some((l) => splitRelations(l).ops.length > 0);
    if (!relations) return problem.length === 1 && /^\s*=/.test(answer) && checkExpression(problem[0], answer.replace(/^\s*=\s*/, ""));
    return checkRelations(problem, answer, steps, opts);
  } catch {
    return false;
  }
}

export interface CheckOptions {
  /** the unknown is a length (a side, a radius, a distance): its negative root is no answer */
  lengths?: boolean;
}

/** Skills whose unknown is a length, a radius or a distance (`c^{2} = 169` → `c = 13`, not −13 too). */
export const LENGTH_SKILLS: ReadonlySet<TopicId> = new Set<TopicId>(["pythagorean", "circles", "area_perimeter", "coordinate_geometry"]);

type Scope = Record<string, unknown>;
interface Value {
  re: number;
  im: number;
  /** a unit's dimension (`L` and `mL` share one), '' for a number; angles count as numbers (radians) */
  dim: string;
}

function evaluate(source: string, scope: Scope = {}): Value {
  return valueOf(seoMath().evaluate(source, { ...scope }));
}

function valueOf(v: unknown): Value {
  if (typeof v === "number") return { re: v, im: 0, dim: "" };
  if (typeof v === "boolean") return { re: v ? 1 : 0, im: 0, dim: "" };
  if (v && typeof v === "object") {
    const o = v as { re?: number; im?: number; value?: number | null; dimensions?: number[]; toNumber?: () => number };
    if (typeof o.re === "number" && typeof o.im === "number") return { re: o.re, im: o.im, dim: "" };
    if (Array.isArray(o.dimensions)) {
      // mathjs's base dimensions; an angle alone (index 7) is a number, in radians
      const angle = o.dimensions.every((d, k) => (k === 7 ? d === 1 : d === 0));
      return { re: o.value ?? Number.NaN, im: 0, dim: angle ? "" : o.dimensions.join(",") };
    }
    if (typeof o.toNumber === "function") return { re: o.toNumber(), im: 0, dim: "" };
  }
  return { re: Number.NaN, im: Number.NaN, dim: "?" };
}

function close(a: Value, b: Value, tol = 1e-7): boolean {
  if (a.dim !== b.dim) return false;
  const scale = Math.max(1, Math.abs(a.re), Math.abs(b.re), Math.abs(a.im), Math.abs(b.im));
  return Math.abs(a.re - b.re) <= tol * scale && Math.abs(a.im - b.im) <= tol * scale;
}

const real = (v: Value) => (Math.abs(v.im) <= 1e-12 * Math.max(1, Math.abs(v.re)) && Number.isFinite(v.re) ? v.re : Number.NaN);
const src = (latex: string) => translate(seoMath(), latex).source;
const vars = (latex: string) => translate(seoMath(), latex).variables;

/** Off-integer sample values, so nothing vanishes or divides by zero by chance. */
const SAMPLES = [0.731, 1.413, 2.217, 3.119, -0.587, -1.673];

/** `problem` and `answer` are the same value: at sample values of their letters, or at once when they have none. */
function checkExpression(problem: string, answer: string): boolean {
  const p = src(problem);
  const a = src(answer);
  let m: RegExpExecArray | null;
  if ((m = /^derivative\("(.*)", "x"\)$/.exec(p))) return sameFunction(derivativeOf(fn(m[1])), fn(a));
  if ((m = /^antiderivative\("(.*)", "x"\)$/.exec(p))) {
    // the answer ends in + C: any constant, here 0
    if (!/\+\s*C\s*$/.test(answer)) return false;
    return sameFunction(derivativeOf(fn(a, { C: 0 })), fn(m[1]));
  }
  if ((m = /^integral\("(.*)", "x", (.+), (.+)\)$/.exec(p))) {
    return close({ re: simpson(fn(m[1]), real(evaluate(m[2])), real(evaluate(m[3]))), im: 0, dim: "" }, evaluate(a), 1e-6);
  }
  if ((m = /^limit\("(.*)", "x", (.+)\)$/.exec(p))) return close({ re: limitOf(fn(m[1]), m[2].trim()), im: 0, dim: "" }, evaluate(a), 1e-5);
  const letters = [...new Set([...vars(problem), ...vars(answer)])];
  if (letters.length === 0) return close(evaluate(p), evaluate(a));
  return SAMPLES.slice(0, 4).every((_, k) => {
    const scope = Object.fromEntries(letters.map((l, j) => [l, SAMPLES[(k + j) % SAMPLES.length]]));
    return close(evaluate(p, scope), evaluate(a, scope));
  });
}

type RealFn = (x: number) => number;

function fn(source: string, extra: Scope = {}): RealFn {
  const compiled = seoMath().compile(source);
  return (x) => real(valueOf(compiled.evaluate({ ...extra, x })));
}

function derivativeOf(f: RealFn): RealFn {
  const h = 1e-5;
  return (x) => (f(x + h) - f(x - h)) / (2 * h);
}

function sameFunction(f: RealFn, g: RealFn): boolean {
  return SAMPLES.every((x) => {
    const a = f(x);
    const b = g(x);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b));
  });
}

function simpson(f: RealFn, a: number, b: number, n = 2000): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let k = 1; k < n; k++) s += (k % 2 === 1 ? 4 : 2) * f(a + k * h);
  return (s * h) / 3;
}

function limitOf(f: RealFn, at: string): number {
  if (at === "Infinity") return f(1e9);
  if (at === "-Infinity") return f(-1e9);
  const a = real(evaluate(at));
  const h = 1e-7;
  return (f(a - h) + f(a + h)) / 2;
}

// ---- function problems: `g(x) = 3x - 4`, then `g(2)`, `f(x) = -22`, `f^{-1}(x)`, `f'(x)` or `f(g(1))`

/** `f(x) = …`: a function's name and its right side. */
const FUNCTION_LINE = /^\s*([a-z])\(x\)\s*=\s*(.+)$/;
const hasX = (latex: string) => /x/.test(latex.replace(/\\[a-zA-Z]+/g, ""));

/** A function defined in x: `f(x) = 3x - 2` (its right side has an x; `f(x) = -22` is a value it takes). */
function isFunctionDef(line: string): boolean {
  const m = FUNCTION_LINE.exec(line);
  return Boolean(m && hasX(m[2]));
}

function checkFunctions(problem: readonly string[], answer: string): boolean {
  const defs = new Map<string, RealFn>();
  for (const line of problem) {
    const m = FUNCTION_LINE.exec(line);
    if (m && hasX(m[2])) defs.set(m[1], fn(src(m[2])));
  }
  const last = problem[problem.length - 1].trim();
  const rhs = answer.replace(/^\s*=\s*/, "");
  let m: RegExpExecArray | null;
  // f(x) = -22: the x where f takes that value
  if ((m = FUNCTION_LINE.exec(last)) && !hasX(m[2])) {
    const f = defs.get(m[1]);
    const x = /^\s*x\s*=\s*(.+)$/.exec(answer);
    if (!f || !x) return false;
    return close({ re: f(real(evaluate(src(x[1])))), im: 0, dim: "" }, evaluate(src(m[2])));
  }
  // f^{-1}(x): f undoes it
  if ((m = /^([a-z])\^\{-1\}\(x\)$/.exec(last))) {
    const f = defs.get(m[1]);
    const inv = new RegExp(`^\\s*${m[1]}\\^\\{-1\\}\\(x\\)\\s*=\\s*(.+)$`).exec(answer);
    if (!f || !inv) return false;
    const g = fn(src(inv[1]));
    return sameFunction((x) => f(g(x)), (x) => x);
  }
  // f'(x): its derivative
  if ((m = /^([a-z])'\(x\)$/.exec(last))) {
    const f = defs.get(m[1]);
    return Boolean(f) && /^\s*=/.test(answer) && sameFunction(derivativeOf(f!), fn(src(rhs)));
  }
  // g(2), f(g(1)): evaluated
  if (!/^\s*=/.test(answer)) return false;
  const call = (s: string): number => {
    const c = /^([a-z])\((.*)\)$/.exec(s.trim());
    if (c && defs.has(c[1])) return defs.get(c[1])!(call(c[2]));
    return real(evaluate(src(s)));
  };
  return close({ re: call(last), im: 0, dim: "" }, evaluate(src(rhs)));
}

// ---- equations, inequalities, formulas, systems

/** The parts of a line a comma and a control space separate: `x = 5, \ x = -1`, `2\cos x = 1, \ 0 \le x < 2\pi`. */
function parts(latex: string): string[] {
  return latex
    .split(/,\s*\\\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `0 \le x < 2\pi`: an interval for one letter, with numbers at both ends. */
function domainOf(latex: string): { v: string; lo: number; hi: number; loIn: boolean; hiIn: boolean } | null {
  try {
    return readDomain(latex);
  } catch {
    return null;
  }
}

function readDomain(latex: string): { v: string; lo: number; hi: number; loIn: boolean; hiIn: boolean } | null {
  const s = splitRelations(latex);
  if (s.sides.length !== 3 || !s.ops.every((o) => o === "<" || o === "<=")) return null;
  if (!/^[a-zA-Z]$/.test(s.sides[1].trim()) || vars(s.sides[0]).length > 0 || vars(s.sides[2]).length > 0) return null;
  return { v: s.sides[1].trim(), lo: real(evaluate(src(s.sides[0]))), hi: real(evaluate(src(s.sides[2]))), loIn: s.ops[0] === "<=", hiIn: s.ops[1] === "<=" };
}

const EQ_TOL = 1e-9;

function holds(op: string, l: number, r: number): boolean {
  const eq = Math.abs(l - r) <= EQ_TOL * Math.max(1, Math.abs(l), Math.abs(r));
  switch (op) {
    case "==":
      return eq;
    case "<":
      return l < r && !eq;
    case "<=":
      return l < r || eq;
    case ">":
      return l > r && !eq;
    case ">=":
      return l > r || eq;
    case "!=":
      return !eq;
    default:
      return false;
  }
}

/** Does a relation (a chain, `-6 < 4x + 2 \le 26`) hold with these values? Units compare by their value. */
function relationHolds(latex: string, scope: Scope): boolean {
  const s = splitRelations(latex);
  if (s.ops.length === 0) return false;
  const values = s.sides.map((side) => evaluate(src(side), scope));
  return s.ops.every((op, k) => {
    const a = values[k];
    const b = values[k + 1];
    if (a.dim !== b.dim || Math.abs(a.im) > 1e-12 || Math.abs(b.im) > 1e-12) return false;
    return holds(op, a.re, b.re);
  });
}

/** `x = \pm 4` → [4, -4]; `x = 13^{\circ}` → the angle in radians, as the problem's `x` takes it. */
function valuesOf(rhs: string): unknown[] {
  return translate(seoMath(), rhs).branches.map((b) => seoMath().evaluate(b) as unknown);
}

function checkRelations(problem: readonly string[], answer: string, steps: readonly string[], opts: CheckOptions): boolean {
  // the problem's own relations, its interval (a trig equation's), and the letters it gives (`x = 6`)
  const own: string[] = [];
  let domain = null as ReturnType<typeof domainOf>;
  const given: Scope = {};
  for (const line of problem) {
    const [head, ...rest] = parts(line);
    for (const r of rest) domain = domainOf(r) ?? domain;
    const g = problem.length > 1 ? GIVEN.exec(head) : null;
    if (g) given[g[1]] = seoMath().evaluate(src(g[2]));
    else own.push(head);
  }
  if (!domain && /\\(?:sin|cos|tan)/.test(own.join(" "))) domain = steps.map(domainOf).find(Boolean) ?? null;
  if (own.length === 0) return false;

  const answers = parts(answer);
  const split = answers.map((a) => splitRelations(a));
  const inequality = split.some((s) => s.ops.some((o) => o !== "=="));
  if (inequality) return checkInequality(own, answers);

  // every part is `letter = value`
  if (!split.every((s) => s.ops.length === 1 && /^[a-zA-Z]$/.test(s.sides[0].trim()))) return false;
  const letters = [...new Set(split.map((s) => s.sides[0].trim()))];

  // a point: M = (6, 5)
  if (split.length === 1 && /,/.test(split[0].sides[1])) {
    const want = own.map((l) => splitRelations(l)).find((s) => s.sides[0].trim() === letters[0]);
    if (!want) return false;
    const coords = (s: string) =>
      s
        .replace(/\\left|\\right/g, "")
        .trim()
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((c) => evaluate(src(c.trim())));
    const a = coords(split[0].sides[1]);
    const b = coords(want.sides[1]);
    return a.length === 2 && b.length === 2 && close(a[0], b[0]) && close(a[1], b[1]);
  }

  // a rewrite: y = -4x + 12 under y - 8 = -4(x - 1)
  if (split.length === 1 && vars(split[0].sides[1]).length > 0) {
    const v = letters[0];
    const others = [...new Set(own.flatMap((l) => vars(l)))].filter((l) => l !== v);
    if (others.length === 0 || vars(split[0].sides[1]).includes(v)) return false;
    const value = seoMath().compile(src(split[0].sides[1]));
    return SAMPLES.slice(0, 4).every((_, k) => {
      const scope: Scope = { ...given, ...Object.fromEntries(others.map((l, j) => [l, SAMPLES[(k + j) % SAMPLES.length]])) };
      scope[v] = value.evaluate({ ...scope });
      return own.every((l) => relationHolds(l, scope));
    });
  }

  // a system: every unknown given a value, every equation holds
  if (letters.length > 1) {
    const scope: Scope = { ...given };
    for (const s of split) {
      const vs = valuesOf(s.sides[1]);
      if (vs.length !== 1) return false;
      scope[s.sides[0].trim()] = vs[0];
    }
    const unknowns = [...new Set(own.flatMap((l) => vars(l)))];
    return unknowns.every((u) => u in scope) && own.every((l) => relationHolds(l, scope));
  }

  // solutions of one unknown: each one holds (and is in the interval), and there are no others
  const v = letters[0];
  const values = split.flatMap((s) => valuesOf(s.sides[1]));
  if (values.length === 0) return false;
  for (const value of values) {
    const scope = { ...given, [v]: value };
    if (!own.every((l) => relationHolds(l, scope))) return false;
    if (domain && !inDomain(real(valueOf(value)), domain)) return false;
  }
  const roots = values.map((x) => real(valueOf(x)));
  if (opts.lengths && roots.some((x) => !(x > 0))) return false;
  return noOtherRoots(own, v, given, roots, opts.lengths ? { v, lo: 0, hi: 1000, loIn: false, hiIn: false } : domain);
}

function inDomain(x: number, d: NonNullable<ReturnType<typeof domainOf>>): boolean {
  const eps = 1e-9 * Math.max(1, Math.abs(x));
  return (x > d.lo + eps || (d.loIn && Math.abs(x - d.lo) <= eps)) && (x < d.hi - eps || (d.hiIn && Math.abs(x - d.hi) <= eps));
}

/**
 * One equation in one unknown, with no units: search its interval (or -40 to 40) for a root the
 * answer leaves out, where the two sides cross. A root found must be one of the answers.
 */
function noOtherRoots(own: readonly string[], v: string, given: Scope, answers: readonly number[], domain: ReturnType<typeof domainOf>): boolean {
  if (own.length !== 1) return true;
  const s = splitRelations(own[0]);
  if (s.ops.length !== 1 || s.ops[0] !== "==") return true;
  if (translate(seoMath(), own[0]).units.length > 0) return true;
  const left = seoMath().compile(src(s.sides[0]));
  const right = seoMath().compile(src(s.sides[1]));
  const f = (x: number) => real(valueOf(left.evaluate({ ...given, [v]: x }))) - real(valueOf(right.evaluate({ ...given, [v]: x })));
  const lo = domain ? domain.lo : -40;
  const hi = domain ? domain.hi : 40;
  const step = (hi - lo) / 4000;
  let a = lo;
  let fa = f(a);
  for (let k = 1; k <= 4000; k++) {
    const b = lo + k * step;
    const fb = f(b);
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb < 0) {
      let x0 = a;
      let x1 = b;
      let f0 = fa;
      for (let i = 0; i < 60; i++) {
        const mid = (x0 + x1) / 2;
        const fm = f(mid);
        if (!Number.isFinite(fm)) break;
        if (f0 * fm <= 0) x1 = mid;
        else {
          x0 = mid;
          f0 = fm;
        }
      }
      const root = (x0 + x1) / 2;
      // a sign change at a pole is no root
      if (Math.abs(f(root)) < 1e-6 && !(domain && !inDomain(root, domain))) {
        if (!answers.some((x) => Math.abs(x - root) <= 1e-5 * Math.max(1, Math.abs(root)))) return false;
      }
    }
    a = b;
    fa = fb;
  }
  return true;
}

/** An inequality: on a grid of values (every quarter, the ends included), the answer holds exactly where the problem does. */
function checkInequality(own: readonly string[], answers: readonly string[]): boolean {
  const letters = [...new Set([...own, ...answers].flatMap((l) => vars(l)))];
  if (letters.length !== 1) return false;
  const v = letters[0];
  for (let k = -160; k <= 160; k++) {
    const scope = { [v]: k / 4 };
    const want = own.every((l) => relationHolds(l, scope));
    const got = answers.some((a) => relationHolds(a, scope));
    if (want !== got) return false;
  }
  return true;
}

// ------------------------------------------------------------------ plain text

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "−": "⁻", "-": "⁻", "+": "⁺", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", k: "ᵏ", m: "ᵐ", t: "ᵗ",
};
const SUBSCRIPT: Readonly<Record<string, string>> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "−": "₋", "-": "₋", "+": "₊", x: "ₓ", a: "ₐ", e: "ₑ", n: "ₙ", t: "ₜ",
};

const SYMBOLS: Readonly<Record<string, string>> = {
  times: "×", div: "÷", cdot: "·", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", lt: "<", gt: ">",
  to: "→", rightarrow: "→", infty: "∞", pi: "π", theta: "θ", alpha: "α", beta: "β", circ: "°", approx: "≈", cdots: "…", ldots: "…",
  square: "□", bigcirc: "○", in: "∈", int: "∫", "%": "%", $: "$", "{": "{", "}": "}", "|": "|",
  ",": " ", ";": " ", ":": " ", "!": "", " ": " ", quad: " ", qquad: " ", left: "", right: "",
};
const FUNCTIONS = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "log", "ln", "exp", "lim", "min", "max"]);
const WRAPPERS = new Set(["mathrm", "text", "textrm", "mathit", "mathbf", "operatorname", "boxed", "mbox"]);

/** A whole term on its own: a number, a letter, or one with a power (`x²`) or a root (`√3`): no parentheses needed around it. */
const ATOM = /^(?:−?\d+(?:\.\d+)?|−?[a-zA-Zπθ](?:[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿˣʸ]+)?|√\d+|√[a-z])$/;
/**
 * A numerator that needs no parentheses: nothing outside its own brackets but one term (`7π`, `x⁵`,
 * `6y⁷`, `(x + 4)(x − 4)`), a leading minus allowed.
 */
function bare(s: string): boolean {
  let depth = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && (/[\s+=<>≤≥×÷·,]/.test(c) || (c === "−" && k > 0))) return false;
  }
  return true;
}

/**
 * A line of LaTeX as plain Unicode text: `\frac{3}{4} + \frac{1}{6}` → `3/4 + 1/6`, `46 \times 7` →
 * `46 × 7`, `x^{2}` → `x²`, `2\frac{1}{3}` → `2 1/3`, `\sqrt{x - 5}` → `√(x − 5)`, `\log_{2} 8` →
 * `log₂ 8`, `\int_{1}^{4}` → `∫₁⁴`, a minus as `−`. Parentheses go where a flat line needs them
 * (`(x + 2)/3`, `(1/3)x`).
 */
export function latexToPlain(latex: string): string {
  return tidy(render(latex));
}

function tidy(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+,/g, ",")
    .trim();
}

/** The group at `i` (`{...}` or one character or command), and where it ends. */
function readArg(s: string, i: number): [string, number] {
  while (s[i] === " ") i++;
  if (s[i] === "{") {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}" && --depth === 0) return [s.slice(i + 1, j), j + 1];
    }
    return [s.slice(i + 1), s.length];
  }
  if (s[i] === "\\") {
    const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
    return m ? [m[0], i + m[0].length] : ["", i + 1];
  }
  return [s[i] ?? "", i + 1];
}

function script(content: string, map: Readonly<Record<string, string>>, mark: "^" | "_"): string {
  const text = tidy(render(content));
  if (text === "°") return "°";
  const compact = text.replace(/\s+/g, "");
  // a signed number, a letter, or a number and a letter (`5x`): small; anything more in parentheses
  if (/^[−-]?(?:\d+|[a-z]|\d+[a-z])$/.test(compact) && [...compact].every((c) => map[c])) return [...compact].map((c) => map[c]).join("");
  return `${mark}(${text})`;
}

function render(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
      const name = m ? m[1] : "";
      i += m ? m[0].length : 1;
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const [top, j] = readArg(s, i);
        const [bottom, k] = readArg(s, j);
        i = k;
        out += fraction(top, bottom, out, s.slice(i));
      } else if (name === "sqrt") {
        let index = "";
        if (s[i] === "[") {
          const close = s.indexOf("]", i);
          index = s.slice(i + 1, close);
          i = close + 1;
        }
        const [arg, j] = readArg(s, i);
        i = j;
        const inner = tidy(render(arg));
        const sign = index === "3" ? "∛" : index ? `${tidy(render(index))}√` : "√";
        out += ATOM.test(inner) && !inner.startsWith("−") ? `${sign}${inner}` : `${sign}(${inner})`;
      } else if (WRAPPERS.has(name)) {
        const [arg, j] = readArg(s, i);
        i = j;
        out += render(arg);
      } else if (FUNCTIONS.has(name)) {
        // a space before it after a number (`2 sin x`), and after it unless a bracket or a script follows
        if (/[\d)]$/.test(out)) out += " ";
        if (name === "lim" && s[i] === "_") {
          const [sub, j] = readArg(s, i + 1);
          i = j;
          out += `lim ${tidy(render(sub)).replace(/\s+/g, "")} `;
          continue;
        }
        out += name;
        let k = i;
        while (s[k] === " ") k++;
        if (s[k] !== "(" && s[k] !== "^" && s[k] !== "_" && !s.startsWith("\\left", k)) out += " ";
      } else if (name in SYMBOLS) {
        const sym = SYMBOLS[name];
        // ± as a sign (`x = ±4`) sits on its number; as an operation (`−7 ± 9`) it is spaced
        const sign = (sym === "±" || sym === "∓") && /(?:^|[=(,]|[≤≥<>])\s*$/.test(out);
        out += !sign && /^[×÷·±∓≤≥≠<>→≈∈]$/.test(sym) ? ` ${sym} ` : sign ? ` ${sym}` : sym;
        if (sign) while (s[i] === " ") i++;
      } else {
        out += name;
      }
      continue;
    }
    if (ch === "^" || ch === "_") {
      const [arg, j] = readArg(s, i + 1);
      i = j;
      out += script(arg, ch === "^" ? SUPERSCRIPT : SUBSCRIPT, ch);
      continue;
    }
    if (ch === "{" || ch === "}") {
      i++;
      continue;
    }
    if (ch === "~") {
      out += " ";
      i++;
      continue;
    }
    if (ch === "-") {
      out += "−";
      i++;
      continue;
    }
    if (ch === "*") {
      out += " × ";
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** `\frac{top}{bottom}` written flat, with what comes before and after it in view. */
function fraction(topLatex: string, bottomLatex: string, before: string, after: string): string {
  const top = tidy(render(topLatex));
  const bottom = tidy(render(bottomLatex));
  if (top === "d" && /^d[a-z]$/.test(bottom)) return `d/${bottom} `;
  const t = bare(top) ? top : `(${top})`;
  const b = ATOM.test(bottom) || /^\([^()]*\)[⁰¹²³⁴⁵⁶⁷⁸⁹]*$/.test(bottom) ? bottom : `(${bottom})`;
  let flat = `${t}/${b}`;
  // a coefficient (`(1/3)x`, `(1/2)(19)`): held together so it is not read as 1/(3x)
  if (/^\s*(?:[a-zA-Z(\d]|\\(?:sqrt|pi|left|sin|cos|tan|log)\b)/.test(after)) flat = `(${flat})`;
  // a mixed number: 2 1/3
  if (/\d$/.test(before)) flat = ` ${flat}`;
  return flat;
}
