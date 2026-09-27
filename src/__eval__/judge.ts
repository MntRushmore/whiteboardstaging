/**
 * Scores ONE Solve: the lines the board saw, what `localSolve` wrote, against the problem's
 * expectation. Five stages, in the order a failure matters:
 *
 *   local     a local solution exists (no model call)
 *   answer    the final line means the expected answer (oracle.ts: semantic, not textual)
 *   steps     every step is consistent with the line before it (or, for a system, with its
 *             solution): no root lost, no wrong value, no empty line
 *   drawable  the tutor's hand can write every step (`planHandwriting`, no `unsupported`)
 *   words     no step carries prose (`\text{…}` with letters) — the board has no words
 *
 * Pure: the handwriting check is passed in, so this file needs neither tldraw nor an engine.
 */
import { splitRelations } from "@/lib/live/engine/latex";
import type { LocalSolveResult } from "@/lib/live/localSolve";
import { courseOf, type Course, type EvalProblem, type Expectation, type Topic } from "./corpus";
import { definitionsOf, expandCalls } from "./functions";
import { featuresLatex, judgeFeatures } from "./functionFeatures";
import {
  assignmentOf,
  boundaries,
  closeTo,
  compareExprs,
  exprOf,
  isAntiderivative,
  isBare,
  isEquation,
  isExpanded,
  isFactored,
  isInequality,
  isSimplifiedRadical,
  isSolvedInequality,
  isStandardLine,
  isVertexForm,
  listedValues,
  parseLine,
  rootSet,
  sameRoots,
  sameTruth,
  solvedValues,
  subsetRoots,
  truthAt,
  truthAtComplex,
  truthEverywhere,
  tuplesIn,
  type Expr,
  type Parsed,
  type Relation,
  type RootSet,
} from "./oracle";

export const STAGES = ["local", "answer", "steps", "drawable", "words"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  local: "local solution",
  answer: "answer correct",
  steps: "steps consistent",
  drawable: "hand can draw",
  words: "no words",
};

/**
 * `ok`; `approx` a decimal / `≈` where the teacher writes an exact value; `form` right value,
 * wrong shape (not factorised / not expanded); `unsolved` the last line is not an answer yet;
 * `wrong`; `missing` no local solution at all; `unjudged` the oracle could not read it.
 */
export type AnswerStatus = "ok" | "approx" | "form" | "unsolved" | "wrong" | "missing" | "unjudged";
export const ANSWER_STATUSES: readonly AnswerStatus[] = ["ok", "approx", "form", "unsolved", "wrong", "missing", "unjudged"];

/** `widened`: a superset of the solutions (squaring both sides) — allowed, but reported. */
export type TransitionStatus = "ok" | "widened" | "broken" | "unverified";

export interface Transition {
  from: string;
  to: string;
  status: TransitionStatus;
  reason: string;
}

export interface Verdict {
  id: string;
  topic: Topic;
  course: Course;
  lines: string[];
  expected: string;
  note?: string;
  source: LocalSolveResult["source"];
  steps: string[];
  stages: Record<Stage, boolean>;
  answer: { status: AnswerStatus; reason: string };
  transitions: Transition[];
  unsupported: string[];
  words: string[];
  warnings: string[];
  pass: boolean;
  /** every failing stage, in stage order, with what went wrong and the offending LaTeX */
  failures: Array<{ stage: Stage; reason: string; latex: string }>;
}

// ---------------------------------------------------------------- expectation display

function fmtNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
}

export function expectedLatex(expect: Expectation): string {
  if (expect.answer) return expect.answer;
  const features = featuresLatex({ expect });
  if (features) return features;
  if (expect.list) return expect.list.length === 0 ? "\\varnothing" : expect.list.map(fmtNumber).join(", \\ ");
  const values = expect.values ?? {};
  const vars = Object.keys(values);
  if (vars.length === 1) {
    const v = vars[0];
    const vs = values[v];
    if (vs.length === 0) return "\\varnothing";
    return vs.map((x) => `${v} = ${fmtNumber(x)}`).join(" \\text{ or } ");
  }
  return vars.map((v) => `${v} = ${values[v].map(fmtNumber).join(", ")}`).join(", ");
}

// ---------------------------------------------------------------- helpers

/** Prose on the board: `\text{…}` (or `\textrm`, `\mbox`) with a letter in it. */
export function wordsIn(latex: string): string[] {
  return [...latex.matchAll(/\\(?:text|textrm|textit|textbf|mbox)\s*\{([^}]*)\}/g)].map((m) => m[1]).filter((t) => /[A-Za-z]/.test(t)).map((t) => t.trim());
}

/** A label compared as written: case, spacing and a heading's colon aside (`Median` is the student's `median:`). */
const labelKey = (word: string): string =>
  word
    .toLowerCase()
    .replace(/[\s:.]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

const UNSOLVED_MARKERS = /\\frac\s*\{\s*d(?:\^\{?\d\}?)?\s*\}\s*\{\s*d|\\int|\\lim|\\frac\s*\{\s*d[a-zA-Z]\s*\}|[a-zA-Z]'/;

function normalizeForEquality(latex: string): string {
  return latex
    .replace(/\\left|\\right|\\,|\\;|\\!|\\ |~/g, "")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/[{}\s]/g, "")
    .replace(/^=|=$/g, "");
}

function numbersIn(parsed: Parsed[], expect: Expectation): number[] {
  const out: number[] = [];
  for (const vs of Object.values(expect.values ?? {})) out.push(...vs);
  for (const p of parsed) {
    if (p.kind !== "relation") continue;
    for (const v of p.vars) {
      const s = solvedValues(p, v);
      if (s) for (const c of s.values) if (Math.abs(c.im) < 1e-9) out.push(c.re);
    }
  }
  return out;
}

const rootsText = (r: RootSet | null): string => (!r ? "?" : r.all ? "every x" : r.roots.length === 0 ? "∅" : `{${r.roots.map(fmtNumber).join(", ")}}`);

/** Tolerance for comparing root sets: exact, unless a side was written to a few decimals. */
function setTol(...rels: Relation[]): number {
  let tol = 1e-6;
  for (const r of rels) if (r.approx || r.decimals !== null) tol = Math.max(tol, 0.5 * 10 ** -(r.decimals ?? 0) + 1e-9);
  return tol;
}

// ---------------------------------------------------------------- answer

function lastSideExpr(p: Parsed): Expr | null {
  if (p.kind === "expr") return p;
  if (p.kind === "relation" && p.alternatives.length === 1) {
    const sides = p.alternatives[0].sides;
    const last = sides[sides.length - 1];
    return last.vars.length === 0 || sides.length === 2 ? last : null;
  }
  return null;
}

function judgeAnswer(problem: EvalProblem, lines: readonly string[], steps: readonly string[]): { status: AnswerStatus; reason: string } {
  if (steps.length === 0) return { status: "missing", reason: "no local solution: Solve would ask the model" };
  const expect = problem.expect;
  const finalLatex = steps[steps.length - 1];
  const final = parseLine(finalLatex);
  const approxOk = Boolean(expect.approxOk);

  if (expect.complexValues) {
    // non-real roots (`x = -1 \pm 2i`): the last line gives exactly that set
    const [v, want] = Object.entries(expect.complexValues)[0];
    const got = solvedValues(final, v);
    if (!got) return { status: "unsolved", reason: `the last line is not \`${v} = …\`` };
    const close = (a: { re: number; im: number }, b: [number, number]) => closeTo(a.re, b[0], 1e-9) && closeTo(a.im, b[1], 1e-9);
    const same = got.values.length === want.length && want.every((w) => got.values.some((g) => close(g, w))) && got.values.every((g) => want.some((w) => close(g, w)));
    if (!same) return { status: "wrong", reason: `gives {${got.values.map((c) => `${fmtNumber(c.re)} ${c.im < 0 ? "-" : "+"} ${fmtNumber(Math.abs(c.im))}i`).join(", ")}}` };
    return got.approx && !approxOk ? { status: "approx", reason: "written with ≈" } : { status: "ok", reason: "" };
  }

  if (expect.point) {
    // a point: the last one written on the final line (`(2, 3) \to (-3, 2)`, `M = (\frac{5}{2}, 4)`)
    const pts = tuplesIn(finalLatex);
    const got = pts[pts.length - 1];
    const show = (p: readonly number[]) => `(${p.map(fmtNumber).join(", ")})`;
    if (!got) return { status: "unsolved", reason: "the last line has no point" };
    if (!got.every((v, i) => closeTo(v, expect.point![i], 1e-9))) return { status: "wrong", reason: `gives ${show(got)}, want ${show(expect.point)}` };
    // what else the same line answers (a circle's radius beside its centre)
    for (const [v, want] of Object.entries(expect.values ?? {})) {
      const sv = listPieces(finalLatex)
        .map((p) => solvedValues(parseLine(p), v))
        .find(Boolean);
      if (!sv) return { status: "unsolved", reason: `the last line does not give ${v}` };
      if (!sameRoots(sv.values.map((c) => c.re), want, 1e-9)) return { status: "wrong", reason: `${v} = {${sv.values.map((c) => fmtNumber(c.re)).join(", ")}}, want {${want.map(fmtNumber).join(", ")}}` };
      if (sv.approx && !approxOk) return { status: "approx", reason: "written with ≈ although the value is exact" };
    }
    return { status: "ok", reason: "" };
  }

  if (expect.list) {
    // a list of numbers, in order (a five-number summary, the modes): the last line's value side
    const got = listedValues(finalLatex);
    const want = expect.list;
    const show = (xs: readonly number[]) => (xs.length === 0 ? "∅" : `{${xs.map(fmtNumber).join(", ")}}`);
    if (!got) return { status: "unsolved", reason: "the last line is not a list of numbers" };
    if (got.length !== want.length || got.some((v, i) => !closeTo(v, want[i], 1e-9))) return { status: "wrong", reason: `gives ${show(got)}, want ${show(want)}` };
    return { status: "ok", reason: "" };
  }

  if (expect.values) {
    const vars = Object.keys(expect.values);
    if (vars.length === 1) {
      const v = vars[0];
      const want = expect.values[v];
      const got = solvedValues(final, v);
      if (!got) return { status: "unsolved", reason: `the last line is not \`${v} = …\`` };
      const nonReal = got.values.filter((c) => Math.abs(c.im) > 1e-9);
      if (nonReal.length > 0) return { status: "wrong", reason: want.length === 0 ? "gives complex roots; there is no real solution" : "gives complex roots" };
      const reals = got.values.map((c) => c.re);
      const d = parseDecimals(final);
      if (sameRoots(reals, want, 1e-9)) {
        if (got.approx && !approxOk) return { status: "approx", reason: "written with ≈ although the value is exact" };
        return { status: "ok", reason: "" };
      }
      if (sameRoots(reals, want, Math.max(1e-9, 0.5 * 10 ** -(d ?? 0) + 1e-9)) && d !== null) {
        return approxOk ? { status: "ok", reason: "" } : { status: "approx", reason: "a decimal where the exact value is wanted" };
      }
      return { status: "wrong", reason: `gives ${reals.length === 0 ? "∅" : `{${reals.map(fmtNumber).join(", ")}}`}, want ${want.length === 0 ? "∅" : `{${want.map(fmtNumber).join(", ")}}`}` };
    }
    // several unknowns: the last value(s) each one is given anywhere in the steps — `v = c`, or a
    // list `v = c1, \ v = c2` when the system has several solution points (paired in order)
    const found = new Map<string, { values: number[]; approx: boolean }>();
    for (const s of steps) {
      const p = parseLine(s);
      if (p.kind !== "relation" || p.vars.length !== 1) continue;
      const sv = solvedValues(p, p.vars[0]);
      if (!sv || sv.values.length === 0 || sv.values.some((c) => Math.abs(c.im) > 1e-9)) continue;
      found.set(p.vars[0], { values: sv.values.map((c) => c.re), approx: sv.approx });
    }
    const missing = vars.filter((v) => !found.has(v));
    if (missing.length > 0) return { status: "unsolved", reason: `no line gives ${missing.join(", ")}` };
    const n = expect.values[vars[0]].length;
    const short = vars.filter((v) => found.get(v)!.values.length !== n);
    if (short.length > 0) return { status: "wrong", reason: short.map((v) => `${v} = {${found.get(v)!.values.map(fmtNumber).join(", ")}}, want {${expect.values![v].map(fmtNumber).join(", ")}}`).join("; ") };
    const tuples = (at: (v: string, i: number) => number) => Array.from({ length: n }, (_, i) => vars.map((v) => at(v, i)));
    const want = tuples((v, i) => expect.values![v][i]);
    const got = tuples((v, i) => found.get(v)!.values[i]);
    const same = (a: number[], b: number[]) => a.every((x, j) => closeTo(x, b[j], 1e-6));
    if (!want.every((w) => got.some((g) => same(g, w))) || !got.every((g) => want.some((w) => same(g, w)))) {
      const show = (ts: number[][]) => ts.map((t) => `(${t.map(fmtNumber).join(", ")})`).join(", ");
      return { status: "wrong", reason: `(${vars.join(", ")}) = ${show(got)}, want ${show(want)}` };
    }
    if (vars.some((v) => found.get(v)!.approx) && !approxOk) return { status: "approx", reason: "written with ≈" };
    return { status: "ok", reason: "" };
  }

  const wantLatex = expect.equivalentTo ?? expect.answer ?? "";
  const want = parseLine(wantLatex);
  if (want.kind === "empty-set") {
    if (final.kind === "empty-set") return { status: "ok", reason: "" };
    if (final.kind === "relation" && final.vars.length === 0 && truthAt(final, {}) === false) return { status: "unsolved", reason: "stops at the contradiction without writing ∅" };
    return { status: "wrong", reason: "expected no solution (∅)" };
  }
  if (want.kind === "all-reals") {
    if (final.kind === "all-reals") return { status: "ok", reason: "" };
    if (final.kind === "relation" && final.vars.length === 0 && truthAt(final, {}) === true) return { status: "unsolved", reason: "stops at the identity without saying every x works" };
    return { status: "wrong", reason: "expected every real number (ℝ)" };
  }
  if (want.kind === "relation") {
    if (final.kind !== "relation") return { status: "unsolved", reason: "the last line is not a relation" };
    if (want.vars.length === 0) {
      // a check worked out (`169 = 169`, `85 \neq 81`): the same statement, side by side
      const target = lines[lines.length - 1] ?? "";
      if (final.vars.length !== 0) return { status: "unsolved", reason: "the last line still has an unknown" };
      if (normalizeForEquality(finalLatex) === normalizeForEquality(target)) return { status: "unsolved", reason: "the last line restates the problem" };
      const [a, b] = [final.alternatives, want.alternatives];
      if (a.length !== 1 || b.length !== 1 || a[0].sides.length !== b[0].sides.length || a[0].ops.join() !== b[0].ops.join()) return { status: "wrong", reason: "not the same statement" };
      for (let i = 0; i < a[0].sides.length; i++) {
        const c = compareExprs(a[0].sides[i], b[0].sides[i]);
        if (c.unknown) return { status: "unjudged", reason: "a side has no value" };
        if (!c.exact) return { status: "wrong", reason: `side ${i + 1} has a different value` };
      }
      return { status: "ok", reason: "" };
    }
    if (want.vars.length === 1 && isInequality(want)) {
      const v = want.vars[0];
      if (!isSolvedInequality(final, v)) return { status: "unsolved", reason: `\`${v}\` is not alone on one side` };
      const t = sameTruth(final, want, v);
      if (t === "equal") return { status: "ok", reason: "" };
      return t === "different" ? { status: "wrong", reason: "a different solution set" } : { status: "unjudged", reason: "cannot sample the inequality" };
    }
    // two unknowns (a whole line of solutions): same y for every x
    const y = want.vars.find((v) => want.alternatives.every((a) => a.sides.some((s) => isBare(s, v)))) ?? want.vars[want.vars.length - 1];
    const others = want.vars.filter((v) => v !== y);
    if (!others.every((o) => final.vars.includes(o)) || !final.vars.includes(y)) return { status: "wrong", reason: `a relation in ${final.vars.join(", ")}` };
    for (const x of [0.37, 1.13, -0.53, 2.29]) {
      // each other letter at its own value (all at one value, h = \frac{2b}{A} would pass for h = \frac{2A}{b})
      const fixed = Object.fromEntries(others.map((o, j) => [o, x * (1 + 0.37 * j) + 0.11 * j]));
      const a = rootSet(final, y, [], fixed);
      const b = rootSet(want, y, [], fixed);
      if (!a || !b) return { status: "unjudged", reason: "cannot solve the relation" };
      if (a.all !== b.all || !sameRoots(a.roots, b.roots, 1e-6)) return { status: "wrong", reason: "not the same line of solutions" };
    }
    // the same line or curve, and it must also LOOK like the form asked for
    if (expect.form === "standard" && !isStandardLine(finalLatex)) return { status: "form", reason: "the same line, not in standard form Ax + By = C" };
    if (expect.form === "vertex" && !isVertexForm(finalLatex)) return { status: "form", reason: "the same quadratic, not in vertex form" };
    if (expect.form === "expanded" && !isExpanded(finalLatex)) return { status: "form", reason: "the same quadratic, not expanded" };
    return { status: "ok", reason: "" };
  }
  if (want.kind !== "expr") return { status: "unjudged", reason: `the expectation \`${wantLatex}\` is unreadable` };

  // on the answer side: `\frac{dy}{dx} = -\frac{x}{y}` names the derivative it gives
  const answerSide = (() => {
    try {
      const split = splitRelations(finalLatex.replace(/^\s*=\s*/, ""));
      return split.sides[split.sides.length - 1] ?? finalLatex;
    } catch {
      return finalLatex;
    }
  })();
  if (UNSOLVED_MARKERS.test(answerSide)) return { status: "unsolved", reason: "the last line still has the operator in it" };
  const target = lines[lines.length - 1] ?? "";
  if (normalizeForEquality(finalLatex) === normalizeForEquality(target)) return { status: "unsolved", reason: "the last line restates the problem" };
  // `m_{\perp} = -\frac{4}{3}`: a name the translator cannot read, a value it can
  const got = lastSideExpr(final) ?? (final.kind === "unreadable" && answerSide !== finalLatex ? exprOf(answerSide) : null);
  if (!got) return { status: final.kind === "unreadable" ? "unjudged" : "unsolved", reason: final.kind === "unreadable" ? `cannot read the last line (${final.reason})` : "the last line is not a value" };
  const cmp = compareExprs(got, want, { upToConstant: expect.upToConstant });
  if (cmp.unknown) return { status: "unjudged", reason: "no sample point where both are defined" };
  if (cmp.exact) {
    if (/\\approx/.test(finalLatex) && !approxOk) return { status: "approx", reason: "written with ≈ although the value is exact" };
    if (expect.form === "factored" && !isFactored(finalLatex)) return { status: "form", reason: "right value, not factorised" };
    if (expect.form === "expanded" && !isExpanded(finalLatex)) return { status: "form", reason: "right value, not expanded" };
    if (expect.form === "radical" && !isSimplifiedRadical(finalLatex)) return { status: "form", reason: "right value, not in simplest radical form" };
    return { status: "ok", reason: "" };
  }
  if (cmp.approx) return approxOk ? { status: "ok", reason: "" } : { status: "approx", reason: "a decimal where the exact value is wanted" };
  return { status: "wrong", reason: "not the expected value" };
}

function parseDecimals(p: Parsed): number | null {
  if (p.kind === "relation" || p.kind === "expr") return p.decimals;
  return null;
}

// ---------------------------------------------------------------- steps

interface Truth {
  kind: "points" | "vacuous" | "unknown";
  points: Array<Record<string, number>>;
  /** the points ARE the solution set (from `values`), not samples of a line of solutions */
  exact: boolean;
}

/** Where a system is true: its solution point(s), from the expectation and the known values. */
function systemTruth(problem: EvalProblem, parsedLines: Parsed[]): Truth {
  const expect = problem.expect;
  const known: Record<string, number> = {};
  for (const p of parsedLines) {
    const a = assignmentOf(p);
    if (a) known[a.variable] = a.value;
  }
  if (expect.values) {
    // one solution point, or several (`values[v][i]` is the i-th point's v)
    const vars = Object.keys(expect.values);
    const n = expect.values[vars[0]]?.length ?? 0;
    if (n === 0 || vars.some((v) => expect.values![v].length !== n)) return { kind: "unknown", points: [], exact: false };
    const points = Array.from({ length: n }, (_, i) => ({ ...known, ...Object.fromEntries(vars.map((v) => [v, expect.values![v][i]])) }));
    return { kind: "points", points, exact: true };
  }
  const want = parseLine(expect.answer ?? "");
  if (want.kind === "empty-set") return { kind: "vacuous", points: [], exact: false };
  if (want.kind === "relation" && want.vars.length === 2) {
    const [x, y] = want.vars.includes("y") ? [want.vars.find((v) => v !== "y")!, "y"] : want.vars;
    const points: Array<Record<string, number>> = [];
    for (const xv of [0.37, 1.13, -0.53, 2.29]) {
      const r = rootSet(want, y, [], { [x]: xv });
      if (r && !r.all) for (const yv of r.roots) points.push({ ...known, [x]: xv, [y]: yv });
    }
    return { kind: "points", points, exact: false };
  }
  return { kind: "unknown", points: [], exact: false };
}

function judgeSystemStep(step: string, p: Parsed, truth: Truth, candidates: number[], window: Window | null = null): Transition {
  const t = (status: TransitionStatus, reason = ""): Transition => ({ from: "(the system)", to: step, status, reason });
  // a line written to a few decimals (`r \approx 3.99`) holds to its own rounding
  const snap = p.kind === "relation" && (p.approx || p.decimals !== null) ? 0.5 * 10 ** -(p.decimals ?? 0) + 1e-9 : 1e-9;
  if (p.kind === "unreadable") return p.reason === "empty" ? t("broken", "empty step") : t("unverified", `unreadable (${p.reason})`);
  if (truth.kind === "vacuous") {
    if (p.kind === "all-reals") return t("broken", "says every value works; the system has no solution");
    return t("ok", "no solution: any consequence holds vacuously");
  }
  if (truth.kind === "unknown") return t("unverified", "no solution point to check against");
  if (p.kind === "empty-set") return t("broken", "says no solution; the system has one");
  if (p.kind !== "relation") return t("unverified", "not a relation");
  for (const point of truth.points) {
    if (!p.vars.every((v) => v in point)) return t("unverified", `mentions ${p.vars.filter((v) => !(v in point)).join(", ")}`);
    const holds = truthAt(p, point, snap);
    if (holds === false) return t("broken", `false at the solution (${Object.entries(point).map(([k, v]) => `${k} = ${fmtNumber(v)}`).join(", ")})`);
    if (holds === null) return t("unverified", "undefined at the solution");
  }
  if (truth.exact && p.vars.length === 1 && isEquation(p)) {
    // a line in one unknown must have exactly that unknown's values at the solution points (a
    // length's only in (0, ∞), when the problem says so)
    const v = p.vars[0];
    const want = [...new Set(truth.points.map((pt) => pt[v]))];
    const rs = windowed(rootSet(p, v, [...candidates, ...want]), window);
    if (!rs) return t("unverified", "cannot solve the step");
    if (rs.all) return t("widened", `true for every ${v}`);
    if (!sameRoots(rs.roots, want, setTol(p))) {
      return subsetRoots(want, rs.roots, setTol(p)) ? t("widened", `also admits ${rootsText(rs)}`) : t("broken", `solutions ${rootsText(rs)}, the system says ${v} ∈ {${want.map(fmtNumber).join(", ")}}`);
    }
  }
  return t("ok");
}

/**
 * The interval a trig equation is solved in (`expect.interval`): `\sin x = \frac{1}{2}` has
 * infinitely many roots, the problem only the ones in [0, 2π). Roots outside it are not compared.
 */
interface Window {
  lo: number;
  hi: number;
  loIn: boolean;
  hiIn: boolean;
}

function inWindow(x: number, w: Window): boolean {
  const eps = 1e-9 * Math.max(1, Math.abs(x));
  const aboveLo = x > w.lo + eps || (w.loIn && Math.abs(x - w.lo) <= eps);
  const belowHi = x < w.hi - eps || (w.hiIn && Math.abs(x - w.hi) <= eps);
  return aboveLo && belowHi;
}

function windowed(r: RootSet | null, w: Window | null): RootSet | null {
  if (!r || !w || r.all) return r;
  return { all: false, roots: r.roots.filter((x) => inWindow(x, w)) };
}

function compareRelations(prev: Relation, cur: Relation, candidates: number[], cache: Map<string, RootSet | null>, origin: Relation | null, lastIneq: Relation | null = null, window: Window | null = null): Omit<Transition, "from" | "to"> {
  const vars = [...new Set([...prev.vars, ...cur.vars])];
  if (vars.length === 0) {
    const a = truthAt(prev, {});
    const b = truthAt(cur, {});
    if (a === null || b === null) return { status: "unverified", reason: "undefined" };
    return a === b ? { status: "ok", reason: "" } : { status: "broken", reason: `turns a ${a ? "true" : "false"} statement ${b ? "true" : "false"}` };
  }
  if (vars.length > 1) return compareSeveral(prev, cur, vars);
  const v = vars[0];
  if (isEquation(prev) && isEquation(cur)) {
    const rs = (r: Relation) => {
      const key = `${r.latex}|${v}`;
      if (!cache.has(key)) cache.set(key, rootSet(r, v, candidates));
      return windowed(cache.get(key)!, window);
    };
    const a = rs(prev);
    const b = rs(cur);
    if (!a || !b) return { status: "unverified", reason: "cannot solve" };
    if (a.all && b.all) return { status: "ok", reason: "" };
    if (a.all !== b.all) return b.all ? { status: "widened", reason: `${rootsText(a)} became every ${v}` } : { status: "broken", reason: `every ${v} became ${rootsText(b)}` };
    const tol = setTol(prev, cur);
    if (sameRoots(a.roots, b.roots, tol)) return { status: "ok", reason: "" };
    if (subsetRoots(a.roots, b.roots, tol)) return { status: "widened", reason: `${rootsText(a)} → ${rootsText(b)} (extraneous candidates)` };
    // narrowing is right when what is dropped was never a solution of the problem (-1 for √(x+2) = x)
    const o = origin && origin.vars.length === 1 && origin.vars[0] === v && isEquation(origin) ? rs(origin) : null;
    if (o && !o.all && subsetRoots(b.roots, a.roots, tol) && sameRoots(o.roots, b.roots, tol)) return { status: "ok", reason: "rejects the extraneous candidates" };
    return { status: "broken", reason: `solutions ${rootsText(a)} → ${rootsText(b)}` };
  }
  // an inequality's answer: the same solution set as the inequality it came from, or as the
  // problem itself (a zero of a denominator dropped from `(x + 1)(x - 3) \le 0`)
  const asInequality = (ref: Relation): Omit<Transition, "from" | "to"> => {
    const t = sameTruth(ref, cur, v);
    if (t !== "equal" && origin && origin !== ref && isInequality(origin) && origin.vars.length === 1 && origin.vars[0] === v && sameTruth(origin, cur, v) === "equal") return { status: "ok", reason: "the problem's own solution set" };
    return t === "equal" ? { status: "ok", reason: "" } : t === "different" ? { status: "broken", reason: "a different solution set" } : { status: "unverified", reason: "cannot sample" };
  };
  if (isInequality(prev) && isInequality(cur)) return asInequality(prev);
  if (lastIneq && isInequality(prev) && isEquation(cur)) {
    // (an inequality problem only: under an equation, `x > 2` is a domain, not a step to solve)
    // the critical values: the equation's roots are exactly where the inequality's sides meet
    const rs = rootSet(cur, v, candidates);
    if (!rs || rs.all) return { status: "unverified", reason: "cannot solve" };
    const edges = boundaries(prev, v);
    if (sameRoots(rs.roots, edges, setTol(prev, cur))) return { status: "ok", reason: "the critical values" };
    return { status: "broken", reason: `critical values ${rootsText(rs)}, the inequality turns at {${edges.map(fmtNumber).join(", ")}}` };
  }
  // after the critical values (an equation) or an excluded value (`x \neq -1`): against the last inequality
  if (!isInequality(prev) && isInequality(cur) && lastIneq && lastIneq.vars.length === 1 && lastIneq.vars[0] === v) return asInequality(lastIneq);
  return { status: "unverified", reason: "an equation and an inequality" };
}

/**
 * Two equations in the same letters (`A = \frac{1}{2}bh` → `2A = bh`, `y - 3 = 2(x - 2)` →
 * `y = 2x - 1`): every letter but one pinned (each to its own value), the last solved in both —
 * the same roots at every pin is `ok`, roots neither a subset nor a superset of the other is
 * `broken`. A lost or gained root (`b = \sqrt{c^{2} - a^{2}}` from `b^{2} = …`) stays `unverified`:
 * a formula's length takes the positive root, and that is not the judge's to call.
 */
function compareSeveral(prev: Relation, cur: Relation, vars: string[]): Omit<Transition, "from" | "to"> {
  const several = { status: "unverified" as const, reason: `several unknowns (${vars.join(", ")})` };
  if (!isEquation(prev) || !isEquation(cur) || vars.length > 4) return several;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  if (!same(prev.vars, cur.vars)) return several;
  for (const solveFor of [...vars].reverse()) {
    const others = vars.filter((x) => x !== solveFor);
    let compared = 0;
    let subset = false;
    let bad = false;
    for (const t of [0.37, 1.13, 2.29, 0.71]) {
      const fixed = Object.fromEntries(others.map((o, j) => [o, t * (1 + 0.37 * j) + 0.11 * j]));
      const a = rootSet(prev, solveFor, [], fixed);
      const b = rootSet(cur, solveFor, [], fixed);
      if (!a || !b || a.all || b.all || (a.roots.length === 0 && b.roots.length === 0)) continue;
      compared++;
      if (sameRoots(a.roots, b.roots, 1e-6)) continue;
      if (subsetRoots(a.roots, b.roots, 1e-6) || subsetRoots(b.roots, a.roots, 1e-6)) subset = true;
      else bad = true;
    }
    if (compared < 2) continue;
    if (bad) return { status: "broken", reason: `not the same ${solveFor} for the other letters (${others.join(", ")})` };
    if (subset) return { status: "unverified", reason: `a root of ${solveFor} gained or lost` };
    return { status: "ok", reason: "" };
  }
  return several;
}

/** `u = x^{2} + 1` in an integral: later lines in u are compared with the ones in x through it. */
interface Subst {
  u: string;
  x: string;
  g: Expr;
}

/** g'(x) by a central difference. */
function slopeOf(g: Expr, x: string, scope: Record<string, number>): number | null {
  const t = scope[x];
  if (typeof t !== "number") return null;
  const h = 1e-6 * Math.max(1, Math.abs(t));
  const up = g.at({ ...scope, [x]: t + h });
  const down = g.at({ ...scope, [x]: t - h });
  return typeof up === "number" && typeof down === "number" ? (up - down) / (2 * h) : null;
}

/**
 * An expression in u read back in x: F(g(x)) — or, for an integrand, f(g(x))·g'(x), so
 * `\int u^{5} \, du` is compared with the `\int 2x(x^{2} + 1)^{5} \, dx` it came from.
 */
function pullBack(e: Expr, s: Subst, integrand: boolean): Expr {
  const at = (scope: Record<string, number>): number | null => {
    const gv = s.g.at(scope);
    if (typeof gv !== "number") return null;
    const v = e.at({ ...scope, [s.u]: gv });
    if (typeof v !== "number") return null;
    if (!integrand) return v;
    const d = slopeOf(s.g, s.x, scope);
    return d === null ? null : v * d;
  };
  return {
    kind: "expr",
    latex: e.latex,
    vars: [...new Set([...e.vars.filter((v) => v !== s.u), ...s.g.vars])],
    at,
    complexAt: (scope) => {
      const v = at(scope);
      return v === null ? null : { re: v, im: 0 };
    },
    decimals: e.decimals,
    tol: Math.max(e.tol, 1e-6),
  };
}

function judgeChainStep(
  prev: Parsed,
  cur: Parsed,
  topic: Topic,
  candidates: number[],
  cache: Map<string, RootSet | null>,
  origin: Parsed,
  window: Window | null = null,
  subst: Subst | null = null,
  lastIneq: Relation | null = null,
): Omit<Transition, "from" | "to"> {
  if (cur.kind === "unreadable") return cur.reason === "empty" ? { status: "broken", reason: "empty step" } : { status: "unverified", reason: `unreadable step (${cur.reason})` };
  if (prev.kind === "unreadable") return { status: "unverified", reason: `the line before is unreadable (${prev.reason})` };
  if (prev.kind === "question" || cur.kind === "question") return { status: "unverified", reason: "a question line" };
  if (prev.kind === "relation" && cur.kind === "relation") return compareRelations(prev, cur, candidates, cache, origin.kind === "relation" ? origin : null, lastIneq, window);
  if (cur.kind === "empty-set" || cur.kind === "all-reals") {
    if (prev.kind !== "relation") return { status: "unverified", reason: "∅ / ℝ after a non-relation" };
    if (prev.vars.length === 0) {
      // the unknown cancelled: `0 = -9` is ∅, `0 = 0` (or `0 < 4`) is every number
      const holds = truthAt(prev, {});
      if (holds === null) return { status: "unverified", reason: "undefined" };
      if (cur.kind === "empty-set") return holds ? { status: "broken", reason: "says ∅ after a true statement" } : { status: "ok", reason: "" };
      return holds ? { status: "ok", reason: "" } : { status: "broken", reason: "says every value after a false statement" };
    }
    const v = prev.vars[0];
    if (prev.vars.length !== 1) return { status: "unverified", reason: "several unknowns" };
    if (lastIneq && lastIneq.vars.length === 1 && lastIneq.vars[0] === v) {
      // an inequality's answer: ∅ where it never holds, every number where it always does
      const e = truthEverywhere(lastIneq, v);
      if (e === "unknown") return { status: "unverified", reason: "cannot sample" };
      if (cur.kind === "empty-set") return e === "never" ? { status: "ok", reason: "" } : { status: "broken", reason: "says ∅, the inequality holds somewhere" };
      return e === "always" ? { status: "ok", reason: "" } : { status: "broken", reason: `says every ${v}, the inequality fails somewhere` };
    }
    if (isEquation(prev)) {
      const rs = windowed(rootSet(prev, v, candidates), window);
      if (!rs) return { status: "unverified", reason: "cannot solve" };
      const empty = !rs.all && rs.roots.length === 0;
      if (cur.kind === "empty-set") {
        if (empty) return { status: "ok", reason: "" };
        // every candidate dropped because the problem cannot take it (`x = 2` against `x \neq 2`)
        const o = origin.kind === "relation" && origin.vars.length === 1 && origin.vars[0] === v && isEquation(origin) ? rootSet(origin, v, candidates) : null;
        if (o && !o.all && o.roots.length === 0 && !rs.all) return { status: "ok", reason: "rejects the extraneous candidates" };
        return { status: "broken", reason: `says ∅, the line before has ${rootsText(rs)}` };
      }
      return rs.all ? { status: "ok", reason: "" } : { status: "broken", reason: `says every ${v}, the line before has ${rootsText(rs)}` };
    }
    return { status: "unverified", reason: "∅ / ℝ after an inequality" };
  }
  if (prev.kind === "empty-set" || prev.kind === "all-reals") return { status: "unverified", reason: "a step after ∅ / ℝ" };
  if (prev.kind === "indefinite") {
    if (cur.kind === "expr") {
      const r = isAntiderivative(cur, prev.integrand, prev.variable);
      return r === "equal" ? { status: "ok", reason: "" } : r === "different" ? { status: "broken", reason: "its derivative is not the integrand" } : { status: "unverified", reason: "no sample point" };
    }
    if (cur.kind === "indefinite") {
      // `\int u^{5} \, du` under `\int 2x(x^{2} + 1)^{5} \, dx`, through `u = x^{2} + 1`
      const through = cur.variable !== prev.variable && subst !== null && subst.u === cur.variable && subst.x === prev.variable;
      const c = compareExprs(through ? pullBack(cur.integrand, subst!, true) : cur.integrand, prev.integrand);
      return c.unknown ? { status: "unverified", reason: "no sample point" } : c.exact ? { status: "ok", reason: "" } : { status: "broken", reason: through ? `not the integral in ${subst!.u} it becomes` : "a different integrand" };
    }
    return { status: "unverified", reason: "a relation after an integral" };
  }
  if (prev.kind === "expr" && cur.kind === "expr") {
    // `\frac{(x^{2} + 1)^{6}}{6}` under `\frac{u^{6}}{6}`: the line in u read back in x
    const back = subst !== null && prev.vars.includes(subst.u) && !cur.vars.includes(subst.u);
    const c = compareExprs(cur, back ? pullBack(prev, subst!, false) : prev, { upToConstant: topic === "integral-indefinite" });
    if (c.unknown) return { status: "unverified", reason: "no sample point where both are defined" };
    if (c.exact || c.approx) return { status: "ok", reason: "" };
    return { status: "broken", reason: "not equal to the line before" };
  }
  if (prev.kind === "expr" && cur.kind === "indefinite") return { status: "unverified", reason: "an integral after an expression" };
  return { status: "unverified", reason: "switches between an expression and a relation" };
}

const RANK: Record<TransitionStatus, number> = { ok: 0, widened: 1, unverified: 2, broken: 3 };

// ---------------------------------------------------------------- lines beside the working

/**
 * What the working has declared so far: a substitution, the parts of an integration by parts,
 * partial-fraction lines waiting for their coefficients.
 */
interface Asides {
  /** the problem's own letters (a new one on the left of `u = …` is a substitution) */
  letters: Set<string>;
  integral: boolean;
  window: Window | null;
  variable: string | null;
  subst: Subst | null;
  parts: Map<string, Expr>;
  pending: Transition[];
  pendingRelations: Relation[];
}

/** Top-level pieces of a list line: `u = x, \ dv = e^{x} \, dx` → [`u = x`, `dv = e^{x} \, dx`]. */
function listPieces(latex: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0 && latex[i - 1] !== "\\") {
      out.push(latex.slice(start, i));
      start = i + 1;
    }
  }
  out.push(latex.slice(start));
  return out.map((p) => p.trim().replace(/^\\\s+/, "").replace(/\\[,;: ]\s*$/, "").trim()).filter(Boolean);
}

/** `2x \, dx` → `2x`; `dx` → `1`; null when the piece does not end in `d<x>`. */
function withoutDifferential(latex: string, x: string): string | null {
  const m = new RegExp(`^([\\s\\S]*?)\\s*(?:\\\\[,;: !]\\s*)*d\\s*${x}$`).exec(latex.trim());
  if (!m) return null;
  const coef = m[1].trim().replace(/\\cdot\s*$/, "").trim();
  return coef || "1";
}

/** Letters written in a line, outside commands (`\int_{0}^{1} 2x \, dx` → x, d). */
function lettersOf(latex: string): Set<string> {
  const plain = latex.replace(/\\[a-zA-Z]+/g, " ");
  return new Set(plain.match(/[a-zA-Z]/g) ?? []);
}

/**
 * A line beside the working rather than a step of it, judged on its own and never the line the
 * next step is compared with: a true calculation (`\sin^{-1}(\frac{1}{2}) = 30^{\circ}`), the
 * interval of a trig equation, a substitution and its differential, the parts of an integration
 * by parts and their formula, partial-fraction coefficients. Null when the line is a step.
 */
function asideOf(latex: string, cur: Parsed, ctx: Asides, transition: Transition): Omit<Transition, "from" | "to"> | null {
  const ok = (reason: string) => ({ status: "ok" as const, reason });
  const bare = latex.replace(/\\[,;: !]|\s|[{}]/g, "");
  if (ctx.integral && bare === "\\intudv=uv-\\intvdu") return ok("the formula for integration by parts");

  const x = ctx.variable;
  const pieces = listPieces(latex);
  if (ctx.integral && x) {
    // `du = 2x \, dx` under `u = x^{2} + 1`: the derivative of the substitution
    if (pieces.length === 1 && ctx.subst) {
      const s = ctx.subst;
      const m = /^d([a-zA-Z])\s*=\s*([\s\S]+)$/.exec(pieces[0]);
      const coef = m && m[1] === s.u ? withoutDifferential(m[2], x) : null;
      if (coef !== null) {
        const e = exprOf(coef);
        if (!e) return { status: "unverified", reason: "unreadable differential" };
        const slope: Expr = { ...e, vars: s.g.vars, at: (scope) => slopeOf(s.g, x, scope), complexAt: () => null, tol: 1e-6 };
        const c = compareExprs(e, slope);
        return c.unknown ? { status: "unverified", reason: "no sample point" } : c.exact ? ok(`d${s.u} = ${s.u}' d${x}`) : { status: "broken", reason: `not the derivative of ${s.u}` };
      }
    }
    // `u = x, \ dv = e^{x} \, dx` and `du = dx, \ v = e^{x}`: the parts, checked against each other
    const partsM = pieces.map((p) => /^(du|dv|u|v)\s*=\s*([\s\S]+)$/.exec(p));
    if (pieces.length >= 2 && partsM.every(Boolean)) {
      for (const m of partsM) {
        const name = m![1];
        const body = name.startsWith("d") ? withoutDifferential(m![2], x) : m![2];
        const e = body === null ? null : exprOf(body);
        if (!e) return { status: "unverified", reason: `unreadable ${name}` };
        ctx.parts.set(name, e);
      }
      const named = new Set(partsM.map((m) => m![1]));
      const checks: Array<"equal" | "different" | "unknown"> = [];
      const u = ctx.parts.get("u");
      const du = ctx.parts.get("du");
      const dv = ctx.parts.get("dv");
      const v = ctx.parts.get("v");
      if (u && du && (named.has("u") || named.has("du"))) checks.push(isAntiderivative(u, du, x));
      if (v && dv && (named.has("v") || named.has("dv"))) checks.push(isAntiderivative(v, dv, x));
      if (checks.includes("different")) return { status: "broken", reason: "du is not u' dx, or v' is not dv" };
      if (checks.length > 0 && checks.every((c) => c === "equal")) return ok("the parts agree");
      // `u = x, \ dv = e^{x} \, dx` is a choice, not a claim: du and v are checked when they are written
      if (checks.length === 0 && named.has("u") && named.has("dv")) return ok("the parts chosen");
      return { status: "unverified", reason: "the parts of integration by parts" };
    }
    // `u = x^{2} + 1`: a substitution (a new letter, defined in the problem's own)
    if (cur.kind === "relation" && cur.alternatives.length === 1 && cur.alternatives[0].sides.length === 2 && isEquation(cur)) {
      const [L, R] = cur.alternatives[0].sides;
      const u = L.vars.length === 1 && isBare(L, L.vars[0]) ? L.vars[0] : null;
      if (u && !ctx.letters.has(u) && R.vars.length > 0 && R.vars.every((v) => ctx.letters.has(v))) {
        ctx.subst = { u, x, g: R };
        return ok(`the substitution ${u}`);
      }
    }
    // partial fractions: `\frac{1}{x^{2} - 1} = \frac{A}{x - 1} + \frac{B}{x + 1}` waits for A and B
    const coefficients = pieces.map((p) => /^([A-Z])\s*=\s*([\s\S]+)$/.exec(p));
    if (coefficients.every(Boolean) && ctx.pending.length > 0) {
      const values: Record<string, number> = {};
      for (const m of coefficients) {
        const e = exprOf(m![2]);
        const n = e && e.vars.length === 0 ? e.at({}) : null;
        if (typeof n !== "number") return { status: "unverified", reason: "unreadable coefficient" };
        values[m![1]] = n;
      }
      let allHold = true;
      ctx.pendingRelations.forEach((rel, i) => {
        const holds = [0.37, 1.61, -2.29, 3.13].every((t) => truthAt(rel, { ...values, [x]: t }, 1e-7) !== false);
        ctx.pending[i].status = holds ? "ok" : "broken";
        ctx.pending[i].reason = holds ? "holds with the coefficients" : "false with the coefficients";
        allHold &&= holds;
      });
      ctx.pending = [];
      ctx.pendingRelations = [];
      return allHold ? ok("the coefficients") : { status: "broken", reason: "the coefficients do not satisfy the lines above" };
    }
    if (cur.kind === "relation" && cur.vars.some((v) => /^[A-Z]$/.test(v) && !ctx.letters.has(v))) {
      ctx.pending.push(transition);
      ctx.pendingRelations.push(cur);
      return { status: "unverified", reason: "waits for its coefficients" };
    }
  }
  // a calculation beside the working: `\sin^{-1}\left(\frac{1}{2}\right) = 30^{\circ}`, `\sqrt{4} \neq -2`
  if (cur.kind === "relation" && cur.vars.length === 0 && truthAt(cur, {}) === true) return ok("a true statement beside the working");
  // a bound true for every value: `-1 \le \sin x \le 1` (why sin x = 2 has no angle)
  if (cur.kind === "relation" && isInequality(cur) && cur.vars.length === 1) {
    const v1 = cur.vars[0];
    const pts = Array.from({ length: 41 }, (_, i) => -10 + i * 0.4973);
    if (pts.every((t) => truthAt(cur, { [v1]: t }, 1e-9) === true)) return ok(`true for every ${v1}`);
  }
  // the interval a trig equation is solved in, written as maths
  const v0 = ctx.variable;
  if (cur.kind === "relation" && ctx.window && v0 && isInequality(cur) && cur.vars.length === 1 && cur.vars[0] === v0) {
    const w = ctx.window;
    const samples = [w.lo, w.hi, w.lo - 0.5, w.hi + 0.5, ...[0.1, 0.3, 0.5, 0.7, 0.9].map((f) => w.lo + f * (w.hi - w.lo))];
    if (samples.every((t) => truthAt(cur, { [v0]: t }, 1e-9) === inWindow(t, w))) return ok("the interval");
  }
  return null;
}

/** The line without a written interval (`, \ 0 \le x < 2\pi` or `\quad 0^{\circ} \le x < 360^{\circ}`). */
export function withoutIntervalPiece(latex: string): string {
  const pieces = listPieces(latex.replace(/\\q?quad\b/g, ","));
  if (pieces.length !== 2) return latex;
  const chain = (p: string) => {
    const parsed = parseLine(p);
    return parsed.kind === "relation" && isInequality(parsed) && parsed.alternatives.every((a) => a.sides.length === 3);
  };
  const kept = pieces.filter((p) => !chain(p));
  return kept.length === 1 ? kept[0] : latex;
}

/**
 * A problem with non-real roots (`complexValues`): each equation step in the unknown must hold at
 * every expected root (evaluated as complex numbers), and a solved line must give exactly them.
 */
function judgeComplexSteps(problem: EvalProblem, steps: readonly string[]): Transition[] {
  const [v, want] = Object.entries(problem.expect.complexValues!)[0];
  return steps.map((s) => {
    const t = (status: TransitionStatus, reason = ""): Transition => ({ from: "(the equation)", to: s, status, reason });
    const p = parseLine(s);
    if (p.kind === "empty-set") return t("broken", "says no solution; there are complex roots");
    if (p.kind !== "relation" || !isEquation(p) || p.vars.length !== 1 || p.vars[0] !== v) return t("unverified", "not an equation in the unknown");
    for (const [re, im] of want) {
      const holds = truthAtComplex(p, { [v]: { re, im } });
      if (holds === false) return t("broken", `false at ${v} = ${fmtNumber(re)} ${im < 0 ? "-" : "+"} ${fmtNumber(Math.abs(im))}i`);
      if (holds === null) return t("unverified", "cannot evaluate with a complex value");
    }
    const solved = solvedValues(p, v);
    if (solved && solved.values.length !== want.length) return t("broken", "not every root");
    return t("ok");
  });
}

/**
 * A step of a problem whose answer is a point: a numeric point on it (the last one, as in
 * `(2, 3) \to (1 + 3, 4 - 2)`) must BE the answer; a tuple of letters (`(x, y) \to (-y, x)`,
 * `(h, k)`) is the rule beside the working. Null for a step with no tuple (a circle's equation
 * rewritten, a distance) — the ordinary checks apply.
 */
function pointStep(problem: EvalProblem, step: string): Omit<Transition, "from" | "to"> | null {
  const want = problem.expect.point;
  if (!want) return null;
  const pts = tuplesIn(step);
  const show = (p: readonly number[]) => `(${p.map(fmtNumber).join(", ")})`;
  if (pts.length > 0) {
    const got = pts[pts.length - 1];
    return got.every((v, i) => closeTo(v, want[i], 1e-9)) ? { status: "ok", reason: "the point" } : { status: "broken", reason: `gives ${show(got)}, the point is ${show(want)}` };
  }
  if (/\(\s*[a-z]\s*,\s*[a-z]\s*\)/.test(step)) return { status: "ok", reason: "the rule" };
  return null;
}

function judgeSteps(problem: EvalProblem, lines: readonly string[], steps: readonly string[]): Transition[] {
  if (problem.expect.complexValues) return judgeComplexSteps(problem, steps);
  const parsedLines = lines.filter(Boolean).map(parseLine);
  const parsedSteps = steps.map(parseLine);
  const candidates = numbersIn([...parsedLines, ...parsedSteps], problem.expect);
  const relationLines = parsedLines.filter((p) => p.kind === "relation");
  // the unknown asked for is not the last line's own (`AB = ?` under two points, the distance
  // formula in x_{1}, …): every step is checked at the expected value instead of along a chain
  const wanted = Object.keys(problem.expect.values ?? {});
  const last = parsedLines[parsedLines.length - 1];
  const unanchored = !problem.expect.point && wanted.length === 1 && !(last && last.kind === "relation" && last.vars.length === 1 && last.vars[0] === wanted[0]);
  const system = relationLines.length >= 2 || wanted.length > 1 || unanchored;
  if (system) {
    const truth = systemTruth(problem, parsedLines);
    const iv = problem.expect.interval;
    const w: Window | null = iv ? { lo: iv.lo, hi: iv.hi, loIn: iv.loIn ?? true, hiIn: iv.hiIn ?? false } : null;
    return steps.map((s, i) => {
      const pt = pointStep(problem, s);
      return pt ? { from: "(the system)", to: s, ...pt } : judgeSystemStep(s, parsedSteps[i], truth, candidates, w);
    });
  }
  const cache = new Map<string, RootSet | null>();
  const out: Transition[] = [];
  const targetLatex = [...lines].reverse().find(Boolean) ?? "";
  const interval = problem.expect.interval;
  // `\sin x = \frac{1}{2}, \ 0 \le x < 2\pi`: the equation is the line, the interval is `expect.interval`
  let originLatex = interval ? withoutIntervalPiece(targetLatex) : targetLatex;
  let origin: Parsed = parseLine(originLatex);
  // `h = ?` under `A = \frac{1}{2}bh`: the working starts from the formula the letter is asked of
  if (origin.kind === "question") {
    const asked = origin.variable;
    const formula = [...parsedLines].reverse().find((p): p is Relation => p.kind === "relation" && p.vars.includes(asked) && p.vars.length >= 2);
    if (formula) {
      origin = formula;
      originLatex = formula.latex;
    }
  }
  const window: Window | null = interval ? { lo: interval.lo, hi: interval.hi, loIn: interval.loIn ?? true, hiIn: interval.hiIn ?? false } : null;
  const integral = problem.topic === "integral-indefinite" || problem.topic === "integral-definite" || /\\int/.test(targetLatex);
  const dx = /d\s*([a-zA-Z])\s*=?\s*$/.exec(targetLatex.trim());
  const variable = origin.kind === "indefinite" ? origin.variable : integral && dx ? dx[1] : origin.kind === "relation" && origin.vars.length === 1 ? origin.vars[0] : null;
  const ctx: Asides = { letters: lettersOf(targetLatex), integral, window, variable, subst: null, parts: new Map(), pending: [], pendingRelations: [] };
  let prev: Parsed = origin;
  let prevLatex = targetLatex;
  let good: Parsed = origin;
  let goodLatex = targetLatex;
  // the last inequality in the chain: what an answer after its critical values is checked against
  let lastIneq: Relation | null = origin.kind === "relation" && isInequality(origin) ? origin : null;
  for (let i = 0; i < steps.length; i++) {
    const cur = parsedSteps[i];
    const transition: Transition = { from: prevLatex, to: steps[i], status: "unverified", reason: "" };
    const pt = pointStep(problem, steps[i]);
    if (pt) {
      out.push({ ...transition, ...pt });
      continue;
    }
    const aside = asideOf(steps[i], cur, ctx, transition);
    if (aside) {
      transition.status = aside.status;
      transition.reason = aside.reason;
      out.push(transition);
      continue;
    }
    let r = judgeChainStep(prev, cur, problem.topic, candidates, cache, origin, window, ctx.subst, lastIneq);
    let from = prevLatex;
    // One mistake is blamed once: a line that follows from the wrong line before it is not a
    // second mistake, and a line that goes back to the last good line is not one either.
    if (good !== prev) {
      const back = judgeChainStep(good, cur, problem.topic, candidates, cache, origin, window, ctx.subst, lastIneq);
      if (RANK[back.status] < RANK[r.status]) {
        r = back;
        from = goodLatex;
      }
    }
    // an expression the line above cannot be compared with is compared with the question itself
    // (every `= …` line of a derivative, a limit, a simplification equals it)
    if (origin.kind === "expr" && cur.kind === "expr" && r.status === "unverified") {
      const direct = compareExprs(cur, origin, { upToConstant: problem.topic === "integral-indefinite" });
      if (!direct.unknown) r = direct.exact || direct.approx ? { status: "ok", reason: "equal to the question" } : { status: "broken", reason: "not equal to the question" };
    }
    // an antiderivative is checked against the problem itself when the line above cannot say
    // (`x e^{x} - \int e^{x} \, dx` still has an integral in it)
    if (origin.kind === "indefinite" && cur.kind === "expr" && r.status === "unverified") {
      const direct = isAntiderivative(cur, origin.integrand, origin.variable);
      if (direct === "equal") r = { status: "ok", reason: "an antiderivative of the integrand" };
      else if (direct === "different" && cur.vars.every((v) => v === origin.variable || /^[CK]$/.test(v))) r = { status: "broken", reason: "its derivative is not the integrand" };
    }
    out.push({ from, to: steps[i], ...r });
    if (cur.kind === "unreadable") continue;
    prev = cur;
    prevLatex = steps[i];
    if (lastIneq && r.status !== "broken" && cur.kind === "relation" && isInequality(cur)) lastIneq = cur;
    if (r.status !== "broken" && from === goodLatex) {
      good = cur;
      goodLatex = steps[i];
    }
  }
  return out;
}

// ---------------------------------------------------------------- warnings

function styleWarnings(steps: readonly string[]): string[] {
  const out = new Set<string>();
  for (const s of steps) {
    if (/\d\s*\\cdot\s*[a-zA-Z{(\\]/.test(s) && !/\\cdot\s*\\(?:frac|sqrt)/.test(s)) out.add("machine-style `\\cdot` between a number and a letter (`6\\cdot x`)");
    if (/\{\s*[a-zA-Z]\s*\}\s*\^/.test(s)) out.add("braced base (`{x}^{2}`)");
    if (/\\frac\s*\{\s*\\frac/.test(s)) out.add("a fraction over a fraction");
    if (/\\cdot\s*-\s*\d/.test(s)) out.add("a negative factor without brackets (`4 \\cdot -8`)");
    // (`- 30^{\circ}` is a degree sign, not a power)
    if (/(^|[^\d}])-\s*\d+\s*\^(?!\s*\{?\s*\\circ)/.test(s)) out.add("`-2^{2}`: a negative base without brackets reads as -(2²)");
  }
  return [...out];
}

// ---------------------------------------------------------------- the verdict

export interface JudgeOptions {
  /** `planHandwriting(steps).unsupported` — what the tutor's hand cannot draw */
  unsupported: (steps: readonly string[]) => string[];
}

/**
 * The lines and steps as the judge reads them: a function defined above (`f(x) = 2x + 3`) is
 * applied wherever it is called (`f(4)` is the value it asks for, not `4f`), and its definition
 * line is a definition, not an equation of the problem (`functions.ts`, independent of the engine).
 */
export function withDefinitions(lines: readonly string[], steps: readonly string[]): { lines: string[]; steps: string[] } {
  const above = lines.slice(0, -1);
  const defs = definitionsOf(above);
  if (defs.size === 0) return { lines: [...lines], steps: [...steps] };
  const target = lines[lines.length - 1] ?? "";
  const kept = above.filter((l) => definitionsOf([l]).size === 0);
  return { lines: [...kept, expandCalls(target, defs) ?? target], steps: steps.map((s) => expandCalls(s, defs) ?? s) };
}

/**
 * `f^{-1}(x) =` under `f(x) = …`: the lines in x and y are the function written as y
 * (`y = f(x)`) or the swapped relation (`x = f(y)`) and what follows from it — each compared with
 * those by value, pinning one letter. The last line (`f^{-1}(x) = …`) is judged as the answer.
 */
function judgeInverseSteps(lines: readonly string[], steps: readonly string[]): Transition[] | null {
  const target = lines[lines.length - 1] ?? "";
  const m = /^\s*([a-zA-Z])\s*\^\s*\{\s*-\s*1\s*\}\s*(?:\\left\s*)?\(\s*([a-zA-Z])\s*(?:\\right\s*)?\)\s*=?\s*(?:\?)?\s*$/.exec(target);
  if (!m) return null;
  const defs = definitionsOf(lines.slice(0, -1));
  if (!defs.has(m[1])) return null;
  const x = m[2];
  const y = x === "y" ? "t" : "y";
  const swappedLatex = expandCalls(`${x} = ${m[1]}(${y})`, defs);
  const directLatex = expandCalls(`${y} = ${m[1]}(${x})`, defs);
  const swapped = swappedLatex ? parseLine(swappedLatex) : null;
  const direct = directLatex ? parseLine(directLatex) : null;
  if (swapped?.kind !== "relation" || direct?.kind !== "relation") return null;
  return steps.map((s) => {
    const t = (status: TransitionStatus, reason = ""): Transition => ({ from: "(the inverse)", to: s, status, reason });
    const p = parseLine(s);
    if (p.kind !== "relation" || !p.vars.includes(x) || !p.vars.includes(y) || p.vars.length !== 2) return t("unverified", "judged as the answer");
    const bySwap = compareSeveral(swapped, p, [x, y]);
    if (bySwap.status === "ok") return t("ok", "the swapped relation");
    if (compareSeveral(direct, p, [x, y]).status === "ok") return t("ok", "the function as y");
    return bySwap.status === "broken" ? t("broken", "neither the function nor its swap") : t("unverified", bySwap.reason);
  });
}

export function judge(problem: EvalProblem, lines: readonly string[], result: LocalSolveResult, opts: JudgeOptions): Verdict {
  const steps = result.steps;
  const found = result.source !== null && steps.length > 0;
  const read = withDefinitions(lines, steps);
  // a rational function's features, a transformation (`functionFeatures.ts`): their own judge
  const features = judgeFeatures(problem, lines, steps);
  const answer = features?.answer ?? judgeAnswer(problem, read.lines, read.steps);
  // judged as read, reported as written
  const transitions = !found ? [] : (features?.transitions ?? judgeInverseSteps(lines, steps) ?? judgeSteps(problem, read.lines, read.steps).map((t, i) => ({ ...t, to: steps[i] })));
  const unsupported = found ? opts.unsupported(steps) : [];
  // a label the student wrote themselves (`\text{median} = ?` → `\text{median} = 8`) is theirs, not
  // the tutor's prose; any other word in a step still fails the stage
  const own = new Set(lines.flatMap(wordsIn).map(labelKey));
  const words = steps.flatMap(wordsIn).filter((w) => !own.has(labelKey(w)));
  const broken = transitions.filter((t) => t.status === "broken");

  const stages: Record<Stage, boolean> = {
    local: found,
    answer: answer.status === "ok",
    steps: found && broken.length === 0,
    drawable: found && unsupported.length === 0,
    words: found && words.length === 0,
  };

  const failures: Verdict["failures"] = [];
  if (!stages.local) failures.push({ stage: "local", reason: answer.reason, latex: "" });
  else {
    if (!stages.answer) failures.push({ stage: "answer", reason: `${answer.status}: ${answer.reason}`, latex: steps[steps.length - 1] });
    if (!stages.steps) for (const b of broken) failures.push({ stage: "steps", reason: b.reason, latex: b.to });
    if (!stages.drawable) failures.push({ stage: "drawable", reason: `cannot draw ${unsupported.join(" ")}`, latex: steps.find((s) => opts.unsupported([s]).length > 0) ?? "" });
    if (!stages.words) failures.push({ stage: "words", reason: `prose on the board: ${words.map((w) => `"${w}"`).join(", ")}`, latex: steps.find((s) => wordsIn(s).length > 0) ?? "" });
  }

  const warnings: string[] = [];
  if (result.source === "solveLatex" && steps.length === 1 && /\\approx/.test(steps[0])) warnings.push("numeric root-finder: the answer with no working");
  if (steps.length >= 8) warnings.push("8 lines: at the maxSolveSteps cap (working may have been cut)");
  for (const t of transitions) if (t.status === "widened") warnings.push(`widened: \`${t.to}\` (${t.reason})`);
  for (const t of transitions) if (t.status === "unverified") warnings.push(`unverified: \`${t.to}\` (${t.reason})`);
  warnings.push(...styleWarnings(steps));

  return {
    id: problem.id,
    topic: problem.topic,
    course: courseOf(problem),
    lines: [...lines],
    expected: expectedLatex(problem.expect),
    note: problem.note,
    source: result.source,
    steps: [...steps],
    stages,
    answer,
    transitions,
    unsupported,
    words,
    warnings,
    pass: STAGES.every((s) => stages[s]),
    failures,
  };
}
