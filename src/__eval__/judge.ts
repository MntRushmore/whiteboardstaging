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
import type { LocalSolveResult } from "@/lib/live/localSolve";
import type { EvalProblem, Expectation, Topic } from "./corpus";
import {
  assignmentOf,
  boundaries,
  closeTo,
  compareExprs,
  isAntiderivative,
  isBare,
  isEquation,
  isExpanded,
  isFactored,
  isInequality,
  isSolvedInequality,
  parseLine,
  rootSet,
  sameRoots,
  sameTruth,
  solvedValues,
  subsetRoots,
  truthAt,
  truthEverywhere,
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
      const fixed = Object.fromEntries(others.map((o) => [o, x]));
      const a = rootSet(final, y, [], fixed);
      const b = rootSet(want, y, [], fixed);
      if (!a || !b) return { status: "unjudged", reason: "cannot solve the relation" };
      if (a.all !== b.all || !sameRoots(a.roots, b.roots, 1e-6)) return { status: "wrong", reason: "not the same line of solutions" };
    }
    return { status: "ok", reason: "" };
  }
  if (want.kind !== "expr") return { status: "unjudged", reason: `the expectation \`${wantLatex}\` is unreadable` };

  if (UNSOLVED_MARKERS.test(finalLatex)) return { status: "unsolved", reason: "the last line still has the operator in it" };
  const target = lines[lines.length - 1] ?? "";
  if (normalizeForEquality(finalLatex) === normalizeForEquality(target)) return { status: "unsolved", reason: "the last line restates the problem" };
  const got = lastSideExpr(final);
  if (!got) return { status: final.kind === "unreadable" ? "unjudged" : "unsolved", reason: final.kind === "unreadable" ? `cannot read the last line (${final.reason})` : "the last line is not a value" };
  const cmp = compareExprs(got, want, { upToConstant: expect.upToConstant });
  if (cmp.unknown) return { status: "unjudged", reason: "no sample point where both are defined" };
  if (cmp.exact) {
    if (/\\approx/.test(finalLatex) && !approxOk) return { status: "approx", reason: "written with ≈ although the value is exact" };
    if (expect.form === "factored" && !isFactored(finalLatex)) return { status: "form", reason: "right value, not factorised" };
    if (expect.form === "expanded" && !isExpanded(finalLatex)) return { status: "form", reason: "right value, not expanded" };
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

function judgeSystemStep(step: string, p: Parsed, truth: Truth, candidates: number[]): Transition {
  const t = (status: TransitionStatus, reason = ""): Transition => ({ from: "(the system)", to: step, status, reason });
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
    const holds = truthAt(p, point);
    if (holds === false) return t("broken", `false at the solution (${Object.entries(point).map(([k, v]) => `${k} = ${fmtNumber(v)}`).join(", ")})`);
    if (holds === null) return t("unverified", "undefined at the solution");
  }
  if (truth.exact && p.vars.length === 1 && isEquation(p)) {
    // a line in one unknown must have exactly that unknown's values at the solution points
    const v = p.vars[0];
    const want = [...new Set(truth.points.map((pt) => pt[v]))];
    const rs = rootSet(p, v, [...candidates, ...want]);
    if (!rs) return t("unverified", "cannot solve the step");
    if (rs.all) return t("widened", `true for every ${v}`);
    if (!sameRoots(rs.roots, want, setTol(p))) {
      return subsetRoots(want, rs.roots, setTol(p)) ? t("widened", `also admits ${rootsText(rs)}`) : t("broken", `solutions ${rootsText(rs)}, the system says ${v} ∈ {${want.map(fmtNumber).join(", ")}}`);
    }
  }
  return t("ok");
}

function compareRelations(prev: Relation, cur: Relation, candidates: number[], cache: Map<string, RootSet | null>, origin: Relation | null, lastIneq: Relation | null): Omit<Transition, "from" | "to"> {
  const vars = [...new Set([...prev.vars, ...cur.vars])];
  if (vars.length === 0) {
    const a = truthAt(prev, {});
    const b = truthAt(cur, {});
    if (a === null || b === null) return { status: "unverified", reason: "undefined" };
    return a === b ? { status: "ok", reason: "" } : { status: "broken", reason: `turns a ${a ? "true" : "false"} statement ${b ? "true" : "false"}` };
  }
  if (vars.length > 1) return { status: "unverified", reason: `several unknowns (${vars.join(", ")})` };
  const v = vars[0];
  if (isEquation(prev) && isEquation(cur)) {
    const rs = (r: Relation) => {
      const key = `${r.latex}|${v}`;
      if (!cache.has(key)) cache.set(key, rootSet(r, v, candidates));
      return cache.get(key)!;
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

function judgeChainStep(prev: Parsed, cur: Parsed, topic: Topic, candidates: number[], cache: Map<string, RootSet | null>, origin: Parsed, lastIneq: Relation | null = null): Omit<Transition, "from" | "to"> {
  if (cur.kind === "unreadable") return cur.reason === "empty" ? { status: "broken", reason: "empty step" } : { status: "unverified", reason: `unreadable step (${cur.reason})` };
  if (prev.kind === "unreadable") return { status: "unverified", reason: `the line before is unreadable (${prev.reason})` };
  if (prev.kind === "question" || cur.kind === "question") return { status: "unverified", reason: "a question line" };
  if (prev.kind === "relation" && cur.kind === "relation") return compareRelations(prev, cur, candidates, cache, origin.kind === "relation" ? origin : null, lastIneq);
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
      const rs = rootSet(prev, v, candidates);
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
      const c = compareExprs(cur.integrand, prev.integrand);
      return c.unknown ? { status: "unverified", reason: "no sample point" } : c.exact ? { status: "ok", reason: "" } : { status: "broken", reason: "a different integrand" };
    }
    return { status: "unverified", reason: "a relation after an integral" };
  }
  if (prev.kind === "expr" && cur.kind === "expr") {
    const c = compareExprs(cur, prev, { upToConstant: topic === "integral-indefinite" });
    if (c.unknown) return { status: "unverified", reason: "no sample point where both are defined" };
    if (c.exact || c.approx) return { status: "ok", reason: "" };
    return { status: "broken", reason: "not equal to the line before" };
  }
  if (prev.kind === "expr" && cur.kind === "indefinite") return { status: "unverified", reason: "an integral after an expression" };
  return { status: "unverified", reason: "switches between an expression and a relation" };
}

const RANK: Record<TransitionStatus, number> = { ok: 0, widened: 1, unverified: 2, broken: 3 };

function judgeSteps(problem: EvalProblem, lines: readonly string[], steps: readonly string[]): Transition[] {
  const parsedLines = lines.filter(Boolean).map(parseLine);
  const parsedSteps = steps.map(parseLine);
  const candidates = numbersIn([...parsedLines, ...parsedSteps], problem.expect);
  const relationLines = parsedLines.filter((p) => p.kind === "relation");
  const system = relationLines.length >= 2 || Object.keys(problem.expect.values ?? {}).length > 1;
  if (system) {
    const truth = systemTruth(problem, parsedLines);
    return steps.map((s, i) => judgeSystemStep(s, parsedSteps[i], truth, candidates));
  }
  const cache = new Map<string, RootSet | null>();
  const out: Transition[] = [];
  const targetLatex = [...lines].reverse().find(Boolean) ?? "";
  const origin: Parsed = parseLine(targetLatex);
  let prev: Parsed = origin;
  let prevLatex = targetLatex;
  let good: Parsed = origin;
  let goodLatex = targetLatex;
  // the last inequality in the chain: what an answer after its critical values is checked against
  let lastIneq: Relation | null = origin.kind === "relation" && isInequality(origin) ? origin : null;
  for (let i = 0; i < steps.length; i++) {
    const cur = parsedSteps[i];
    let r = judgeChainStep(prev, cur, problem.topic, candidates, cache, origin, lastIneq);
    let from = prevLatex;
    // One mistake is blamed once: a line that follows from the wrong line before it is not a
    // second mistake, and a line that goes back to the last good line is not one either.
    if (good !== prev) {
      const back = judgeChainStep(good, cur, problem.topic, candidates, cache, origin, lastIneq);
      if (RANK[back.status] < RANK[r.status]) {
        r = back;
        from = goodLatex;
      }
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
    if (/(^|[^\d}])-\s*\d+\s*\^/.test(s)) out.add("`-2^{2}`: a negative base without brackets reads as -(2²)");
  }
  return [...out];
}

// ---------------------------------------------------------------- the verdict

export interface JudgeOptions {
  /** `planHandwriting(steps).unsupported` — what the tutor's hand cannot draw */
  unsupported: (steps: readonly string[]) => string[];
}

export function judge(problem: EvalProblem, lines: readonly string[], result: LocalSolveResult, opts: JudgeOptions): Verdict {
  const steps = result.steps;
  const found = result.source !== null && steps.length > 0;
  const answer = judgeAnswer(problem, lines, steps);
  const transitions = found ? judgeSteps(problem, lines, steps) : [];
  const unsupported = found ? opts.unsupported(steps) : [];
  const words = steps.flatMap(wordsIn);
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
