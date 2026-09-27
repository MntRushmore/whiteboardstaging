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
  closeTo,
  compareExprs,
  exprOf,
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
    // several unknowns: the last value each one is given anywhere in the steps
    const found = new Map<string, { value: number; approx: boolean }>();
    for (const s of steps) {
      const a = assignmentOf(parseLine(s));
      if (a) found.set(a.variable, { value: a.value, approx: a.approx });
    }
    const missing = vars.filter((v) => !found.has(v));
    if (missing.length > 0) return { status: "unsolved", reason: `no line gives ${missing.join(", ")}` };
    const wrong = vars.filter((v) => !closeTo(found.get(v)!.value, expect.values![v][0], 1e-6));
    if (wrong.length > 0) return { status: "wrong", reason: wrong.map((v) => `${v} = ${fmtNumber(found.get(v)!.value)}, want ${fmtNumber(expect.values![v][0])}`).join("; ") };
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
  unique: boolean;
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
    const vars = Object.keys(expect.values);
    if (vars.some((v) => expect.values![v].length !== 1)) return { kind: "unknown", points: [], unique: false };
    const point = { ...known };
    for (const v of vars) point[v] = expect.values[v][0];
    return { kind: "points", points: [point], unique: true };
  }
  const want = parseLine(expect.answer ?? "");
  if (want.kind === "empty-set") return { kind: "vacuous", points: [], unique: false };
  if (want.kind === "relation" && want.vars.length === 2) {
    const [x, y] = want.vars.includes("y") ? [want.vars.find((v) => v !== "y")!, "y"] : want.vars;
    const points: Array<Record<string, number>> = [];
    for (const xv of [0.37, 1.13, -0.53, 2.29]) {
      const r = rootSet(want, y, [], { [x]: xv });
      if (r && !r.all) for (const yv of r.roots) points.push({ ...known, [x]: xv, [y]: yv });
    }
    return { kind: "points", points, unique: false };
  }
  return { kind: "unknown", points: [], unique: false };
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
  if (truth.unique && p.vars.length === 1 && isEquation(p)) {
    const v = p.vars[0];
    const want = truth.points[0][v];
    const rs = rootSet(p, v, [...candidates, want]);
    if (!rs) return t("unverified", "cannot solve the step");
    if (rs.all) return t("widened", `true for every ${v}`);
    if (!sameRoots(rs.roots, [want], setTol(p))) {
      return subsetRoots([want], rs.roots, setTol(p)) ? t("widened", `also admits ${rootsText(rs)}`) : t("broken", `solutions ${rootsText(rs)}, the system says ${v} = ${fmtNumber(want)}`);
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

function compareRelations(prev: Relation, cur: Relation, candidates: number[], cache: Map<string, RootSet | null>, origin: Relation | null, window: Window | null = null): Omit<Transition, "from" | "to"> {
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
  if (isInequality(prev) && isInequality(cur)) {
    const t = sameTruth(prev, cur, v);
    return t === "equal" ? { status: "ok", reason: "" } : t === "different" ? { status: "broken", reason: "a different solution set" } : { status: "unverified", reason: "cannot sample" };
  }
  return { status: "unverified", reason: "an equation and an inequality" };
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
): Omit<Transition, "from" | "to"> {
  if (cur.kind === "unreadable") return cur.reason === "empty" ? { status: "broken", reason: "empty step" } : { status: "unverified", reason: `unreadable step (${cur.reason})` };
  if (prev.kind === "unreadable") return { status: "unverified", reason: `the line before is unreadable (${prev.reason})` };
  if (prev.kind === "question" || cur.kind === "question") return { status: "unverified", reason: "a question line" };
  if (prev.kind === "relation" && cur.kind === "relation") return compareRelations(prev, cur, candidates, cache, origin.kind === "relation" ? origin : null, window);
  if (cur.kind === "empty-set" || cur.kind === "all-reals") {
    if (prev.kind !== "relation") return { status: "unverified", reason: "∅ / ℝ after a non-relation" };
    const v = prev.vars[0];
    if (prev.vars.length !== 1) return { status: "unverified", reason: "several unknowns" };
    if (isEquation(prev)) {
      const rs = windowed(rootSet(prev, v, candidates), window);
      if (!rs) return { status: "unverified", reason: "cannot solve" };
      const empty = !rs.all && rs.roots.length === 0;
      if (cur.kind === "empty-set") return empty ? { status: "ok", reason: "" } : { status: "broken", reason: `says ∅, the line before has ${rootsText(rs)}` };
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
  const interval = problem.expect.interval;
  // `\sin x = \frac{1}{2}, \ 0 \le x < 2\pi`: the equation is the line, the interval is `expect.interval`
  const originLatex = interval ? withoutIntervalPiece(targetLatex) : targetLatex;
  const origin: Parsed = parseLine(originLatex);
  const window: Window | null = interval ? { lo: interval.lo, hi: interval.hi, loIn: interval.loIn ?? true, hiIn: interval.hiIn ?? false } : null;
  const integral = problem.topic === "integral-indefinite" || problem.topic === "integral-definite" || /\\int/.test(targetLatex);
  const dx = /d\s*([a-zA-Z])\s*=?\s*$/.exec(targetLatex.trim());
  const variable = origin.kind === "indefinite" ? origin.variable : integral && dx ? dx[1] : origin.kind === "relation" && origin.vars.length === 1 ? origin.vars[0] : null;
  const ctx: Asides = { letters: lettersOf(targetLatex), integral, window, variable, subst: null, parts: new Map(), pending: [], pendingRelations: [] };
  let prev: Parsed = origin;
  let prevLatex = targetLatex;
  let good: Parsed = origin;
  let goodLatex = targetLatex;
  for (let i = 0; i < steps.length; i++) {
    const cur = parsedSteps[i];
    const transition: Transition = { from: prevLatex, to: steps[i], status: "unverified", reason: "" };
    const aside = asideOf(steps[i], cur, ctx, transition);
    if (aside) {
      transition.status = aside.status;
      transition.reason = aside.reason;
      out.push(transition);
      continue;
    }
    let r = judgeChainStep(prev, cur, problem.topic, candidates, cache, origin, window, ctx.subst);
    let from = prevLatex;
    // One mistake is blamed once: a line that follows from the wrong line before it is not a
    // second mistake, and a line that goes back to the last good line is not one either.
    if (good !== prev) {
      const back = judgeChainStep(good, cur, problem.topic, candidates, cache, origin, window, ctx.subst);
      if (RANK[back.status] < RANK[r.status]) {
        r = back;
        from = goodLatex;
      }
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
