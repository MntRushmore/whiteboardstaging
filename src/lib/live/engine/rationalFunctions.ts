/**
 * Rational functions (F-IF.7d, A-APR.6): a function that is one fraction of polynomials, and what
 * its graph does — the values it cannot take, its holes, its asymptotes. No words: each feature is
 * the maths that names it, and the sketch (`graphIntent.ts`) shows the rest.
 *
 *   f(x) = \frac{x^{2} - 4}{x^{2} - x - 2}          y = \frac{x^{2} + 1}{x - 1}
 *   f(x) = \frac{(x + 2)(x - 2)}{(x + 1)(x - 2)}     x \neq 1
 *   x \neq -1, \ x \neq 2                            y = x + 1 + \frac{2}{x - 1}
 *   f(x) = \frac{x + 2}{x + 1}, \ x \neq 2           x = 1
 *   \frac{2 + 2}{2 + 1} = \frac{4}{3}                y = x + 1
 *   (2, \frac{4}{3})
 *   x = -1
 *   y = 1
 *
 * In order: the top and the bottom factored (rational roots), the values the bottom rules out
 * (the domain), the common factors cancelled — the value each one rules out carried beside the
 * simplified function (`x \neq 2`, the rational-expression style) — the hole there (its height
 * from the simplified function), the zeros left in the bottom (vertical asymptotes), and the
 * behaviour at ±∞ from the degrees: `y = 0` when the bottom wins, the ratio of the leading
 * coefficients when they tie, the quotient of the division when the top is one degree higher
 * (a slant asymptote), none past that.
 *
 * The asks under such a function (`askOf`): `\text{VA} = ?` or `x = ?` (the vertical asymptotes),
 * `\text{HA} = ?`, `\text{holes}`, `\text{domain}` / `D = ?`. Every line written is checked
 * numerically against the function as the student wrote it before anything is answered.
 */
import type { MathNode } from "mathjs";
import { q, qAdd, qDiv, qLatex, qMul, type Q } from "./algebra";
import { closeC, evalLatex, parseExpr, type CourseDeps } from "./courseKit";
import { functionInfo } from "./classify";
import { substituteParam } from "./functionNotation";
import { argsOf, coefficientOf, fnOf, polyOf, stripParens } from "./nodes";
import { deg, exactly, factorLinear, lead, polyDiv, polyEval, polyEvalNum, polyLatex, polyScale, productLatex, qEq, qNum, rootFactor, trim, type Poly } from "./poly";
import { LIST_SEP, NO_SOLUTION, StepWriter } from "./solution";

/** The domain when nothing is ruled out. */
const ALL_REALS = (v: string) => `${v} \\in \\mathbb{R}`;

interface Factor {
  f: Poly;
  mult: number;
}

interface Factored {
  content: Q;
  factors: Factor[];
}

export interface RationalFunction {
  /** the left side as written: `f(x)`, `y`, `R(x)` */
  head: string;
  /** the variable */
  v: string;
  /** top and bottom as written (not reduced) */
  num: Poly;
  den: Poly;
}

export interface Hole {
  x: Q;
  y: Q;
}

export interface RationalFeatures {
  /** the real zeros of the bottom, ascending: the values the domain leaves out */
  excluded: Q[];
  holes: Hole[];
  /** zeros of the bottom left after cancelling */
  vertical: Q[];
  /** the level at ±∞, null when there is none (a slant asymptote, faster growth, or no fraction left) */
  horizontal: Q | null;
  /** y = mx + b when the top is one degree higher */
  oblique: Poly | null;
  /** after cancelling */
  reducedNum: Poly;
  reducedDen: Poly;
  /** LaTeX of the factored fraction, of the reduced function */
  factoredTex: string;
  reducedTex: string;
  /** the fraction as written (to know whether factoring changed anything) */
  writtenTex: string;
}

export type RationalAsk = "all" | "vertical" | "horizontal" | "holes" | "domain";

const key = (f: Poly): string => f.map((c) => `${c.n}/${c.d}`).join(",");

function factored(p: Poly): Factored {
  const lf = factorLinear(p);
  const factors: Factor[] = lf.roots.map((r) => ({ f: rootFactor(r.root), mult: r.mult }));
  if (deg(lf.rest) >= 1) factors.push({ f: lf.rest, mult: 1 });
  return { content: lf.content, factors };
}

/** Above or below a bar: `x + 1` alone, `x(x + 1)`, `2(x - 1)^{2}`, `3`. */
function partTex(p: Factored, v: string): string {
  if (p.factors.length === 0) return qLatex(p.content);
  if (p.factors.length === 1 && p.factors[0].mult === 1 && qEq(p.content, q(1))) return polyLatex(p.factors[0].f, v);
  return productLatex(p.content, p.factors, v);
}

/** `\frac{top}{bottom}` with the sign in front; a polynomial when the bottom is 1. */
function fractionTex(top: Factored, bottom: Factored, v: string): string {
  const c = qDiv(top.content, bottom.content);
  const neg = c.n < 0;
  const t = partTex({ content: q(Math.abs(c.n)), factors: top.factors }, v);
  if (bottom.factors.length === 0 && c.d === 1) return `${neg ? "-" : ""}${neg && /[+-]/.test(t.slice(1)) && top.factors.length === 1 && Math.abs(c.n) === 1 ? `(${t})` : t}`;
  return `${neg ? "-" : ""}\\frac{${t}}{${partTex({ content: q(c.d), factors: bottom.factors }, v)}}`;
}

/** Real rational zeros of a factored polynomial; null when a factor left over has an irrational real zero. */
function realZeros(p: Factored): Q[] | null {
  const out: Q[] = [];
  for (const f of p.factors) {
    if (deg(f.f) === 1) out.push(qDiv(q(-f.f[0].n, f.f[0].d), f.f[1]));
    else if (deg(f.f) === 2) {
      const [c, b, a] = f.f.map(qNum);
      if (b * b - 4 * a * c >= 0) return null;
    } else if (hasRealRoot(f.f)) return null;
  }
  return out.sort((a, b) => qNum(a) - qNum(b));
}

/** A sign change anywhere in [-1000, 1000] (an odd degree always has one). */
function hasRealRoot(p: Poly): boolean {
  if (deg(p) % 2 === 1) return true;
  let prev = polyEvalNum(p, -1000);
  for (let x = -1000; x <= 1000; x += 0.01) {
    const y = polyEvalNum(p, x);
    if (y === 0 || Math.sign(y) !== Math.sign(prev)) return true;
    prev = y;
  }
  return false;
}

function mulPoly(a: Poly, b: Poly): Poly {
  const out: Q[] = new Array(Math.max(0, a.length + b.length - 1)).fill(q(0));
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] = qAdd(out[i + j], qMul(a[i], b[j]));
  return trim(out);
}

/** `y = \frac{…}{…}` / `f(x) = …` as one fraction of polynomials in its variable (the bottom not a constant), or null. */
export function readRationalFunction(deps: CourseDeps, latex: string): RationalFunction | null {
  const fn = functionInfo(latex);
  if (!fn || /\\neq|\\ne(?![a-zA-Z])|,/.test(fn.rhs)) return null;
  const node = parseExpr(deps, fn.rhs);
  if (!node) return null;
  const v = fn.param;
  return exactly(() => {
    const kc = coefficientOf(node);
    if (!kc) return null;
    const core = stripParens(kc.core);
    if (core.type !== "OperatorNode" || fnOf(core) !== "divide") return null;
    const [a, b] = argsOf(core);
    const top = polyOf(a, v);
    const bottom = polyOf(b, v);
    if (!top || !bottom || top.length === 0 || deg(bottom) < 1 || deg(top) > 8 || deg(bottom) > 8) return null;
    const head = fn.name === "y" ? "y" : `${fn.name}(${v})`;
    return { head, v, num: polyScale(top, kc.k), den: bottom };
  });
}

/** The features of a rational function, exactly; null when the bottom has an irrational real zero or a factor it cannot see. */
export function rationalFeatures(rf: RationalFunction): RationalFeatures | null {
  return exactly(() => {
    const { num, den, v } = rf;
    const N = factored(num);
    const D = factored(den);
    const excluded = realZeros(D);
    if (!excluded) return null;
    // a common factor with no rational root (x² + 1 over x² + 1) is not something to read off
    const restN = N.factors.find((f) => deg(f.f) >= 2);
    const restD = D.factors.find((f) => deg(f.f) >= 2);
    if (restN && restD && deg(polyGcd(restN.f, restD.f)) >= 1) return null;
    // cancel
    const bottom = D.factors.map((f) => ({ ...f }));
    const top: Factor[] = [];
    const common: Factor[] = [];
    for (const f of N.factors) {
      const m = bottom.find((x) => key(x.f) === key(f.f));
      const k = m ? Math.min(m.mult, f.mult) : 0;
      if (k > 0) {
        m!.mult -= k;
        common.push({ f: f.f, mult: k });
      }
      if (f.mult - k > 0) top.push({ f: f.f, mult: f.mult - k });
    }
    const rest = bottom.filter((x) => x.mult > 0);
    let commonPoly: Poly = [q(1)];
    for (const c of common) for (let i = 0; i < c.mult; i++) commonPoly = mulPoly(commonPoly, c.f);
    const reducedNum = polyDiv(num, commonPoly).quotient;
    const reducedDen = polyDiv(den, commonPoly).quotient;
    const vertical = realZeros({ content: q(1), factors: rest }) ?? [];
    const holes: Hole[] = [];
    for (const a of excluded) {
      if (vertical.some((x) => qEq(x, a))) continue;
      const bottomAt = polyEval(reducedDen, a);
      if (bottomAt.n === 0) return null;
      holes.push({ x: a, y: qDiv(polyEval(reducedNum, a), bottomAt) });
    }
    let horizontal: Q | null = null;
    let oblique: Poly | null = null;
    if (deg(reducedDen) >= 1) {
      const dn = deg(num);
      const dd = deg(den);
      if (dn < dd) horizontal = q(0);
      else if (dn === dd) horizontal = qDiv(lead(num), lead(den));
      else if (dn === dd + 1) oblique = polyDiv(reducedNum, reducedDen).quotient;
    }
    const factoredTex = `\\frac{${partTex(N, v)}}{${partTex(D, v)}}`;
    const reducedTex = fractionTex({ content: N.content, factors: top }, { content: D.content, factors: rest }, v);
    const writtenTex = `\\frac{${polyLatex(num, v)}}{${polyLatex(den, v)}}`;
    return { excluded, holes, vertical, horizontal, oblique, reducedNum, reducedDen, factoredTex, reducedTex, writtenTex };
  });
}

function polyGcd(a: Poly, b: Poly): Poly {
  let x = trim(a);
  let y = trim(b);
  for (let guard = 0; guard < 20 && y.length > 0; guard++) {
    const r = polyDiv(x, y).remainder;
    x = y;
    y = trim(r);
  }
  return x;
}

// ---------------------------------------------------------------- lines

const numTex = (a: Q): string => qLatex(a);

/** `x \neq -1, \ x \neq 2`, or `x \in \mathbb{R}`. */
export function domainLine(v: string, excluded: readonly Q[]): string {
  return excluded.length === 0 ? ALL_REALS(v) : excluded.map((a) => `${v} \\neq ${numTex(a)}`).join(LIST_SEP);
}

/** `x = -1, \ x = 3`, or `\varnothing`. */
export function verticalLine(v: string, vertical: readonly Q[]): string {
  return vertical.length === 0 ? NO_SOLUTION : vertical.map((a) => `${v} = ${numTex(a)}`).join(LIST_SEP);
}

/** `(2, \frac{4}{3})`, several joined, or `\varnothing`. */
export function holesLine(holes: readonly Hole[]): string {
  return holes.length === 0 ? NO_SOLUTION : holes.map((h) => `(${numTex(h.x)}, ${numTex(h.y)})`).join(LIST_SEP);
}

/** `f(x) = x + 1 + \frac{2}{x - 1}`: the quotient and what is left over the bottom. */
function divisionTex(f: RationalFeatures, v: string): string | null {
  const { quotient, remainder } = polyDiv(f.reducedNum, f.reducedDen);
  if (quotient.length === 0) return null;
  const qTex = polyLatex(quotient, v);
  if (remainder.length === 0) return qTex;
  const bottom = polyLatex(f.reducedDen, v);
  const top = polyLatex(remainder, v);
  const single = remainder.filter((c) => c.n !== 0).length === 1;
  if (single && top.startsWith("-")) return `${qTex} - \\frac{${top.slice(1)}}{${bottom}}`;
  return `${qTex} + \\frac{${top}}{${bottom}}`;
}

/** The lines answering an ask about the function (`"all"`: Solve on the function itself). Null when nothing checks out. */
export function rationalFunctionSteps(deps: CourseDeps, rf: RationalFunction, ask: RationalAsk, input?: string): { latex: string; steps: string[] } | null {
  try {
    const f = rationalFeatures(rf);
    if (!f) return null;
    const { head, v } = rf;
    const w = new StepWriter(deps.normalize, input);
    const factoredChanged = deps.normalize(f.factoredTex) !== deps.normalize(f.writtenTex);
    const cancels = f.holes.length > 0;
    const holeMarks = f.holes.map((h) => `${v} \\neq ${numTex(h.x)}`).join(LIST_SEP);
    const cancelled = `${head} = ${f.reducedTex}${cancels ? `${LIST_SEP}${holeMarks}` : ""}`;
    const factoredLine = `${head} = ${f.factoredTex}`;
    const division = f.oblique ? divisionTex(f, v) : null;
    const obliqueLine = f.oblique ? `y = ${polyLatex(f.oblique, v)}` : null;
    const horizontalLine = f.horizontal ? `y = ${numTex(f.horizontal)}` : null;
    const valueLine = (h: Hole): string => `${substituteParam(f.reducedTex, v, numTex(h.x))} = ${numTex(h.y)}`;
    switch (ask) {
      case "all": {
        if (factoredChanged) w.write(factoredLine, !cancels);
        w.write(domainLine(v, f.excluded));
        if (cancels) w.write(cancelled);
        if (f.holes.length === 1) w.write(valueLine(f.holes[0]), true);
        if (f.holes.length > 0) w.write(holesLine(f.holes));
        if (f.vertical.length > 0) w.write(verticalLine(v, f.vertical));
        if (division && obliqueLine) {
          w.write(`${head} = ${division}`, true);
          w.write(obliqueLine);
        } else if (horizontalLine) w.write(horizontalLine);
        break;
      }
      case "vertical":
        if (factoredChanged) w.write(factoredLine);
        if (cancels) w.write(cancelled);
        w.write(verticalLine(v, f.vertical));
        break;
      case "holes":
        if (factoredChanged) w.write(factoredLine);
        if (cancels) w.write(cancelled);
        if (f.holes.length === 1) w.write(valueLine(f.holes[0]));
        w.write(holesLine(f.holes));
        break;
      case "domain":
        if (factoredChanged && f.excluded.length > 0) w.write(factoredLine);
        w.write(domainLine(v, f.excluded));
        break;
      case "horizontal":
        if (division && obliqueLine) {
          w.write(`${head} = ${division}`);
          w.write(obliqueLine);
        } else w.write(horizontalLine ?? NO_SOLUTION);
        break;
    }
    const steps = w.lines();
    if (steps.length === 0 || !selfCheck(deps, rf, f, steps)) return null;
    return { latex: steps[steps.length - 1], steps };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the check

const SAMPLE_XS = [-7.3, -4.1, -2.6, -1.37, -0.53, 0.29, 0.83, 1.61, 2.47, 3.3, 4.9, 8.2];

/**
 * Every line against the function as written, numerically: a rewrite has its values wherever
 * both are defined; an excluded value is a zero of the bottom; `x = a` is where it blows up;
 * a point is where it is undefined with that limit; `y = c` / `y = mx + b` is where it goes at ±∞.
 */
function selfCheck(deps: CourseDeps, rf: RationalFunction, feats: RationalFeatures, steps: readonly string[]): boolean {
  const F = (x: number) => polyEvalNum(rf.num, x) / polyEvalNum(rf.den, x);
  const v = rf.v;
  const bottomZero = (a: number) => Math.abs(polyEvalNum(rf.den, a)) < 1e-9;
  for (const line of steps) {
    const pieces = line.split(LIST_SEP).map((p) => p.trim());
    for (const piece of pieces) {
      if (piece === NO_SOLUTION || piece === ALL_REALS(v)) continue;
      const neq = new RegExp(`^${v} \\\\neq (.+)$`).exec(piece);
      if (neq) {
        const a = evalLatex(deps, neq[1]);
        if (!a || !bottomZero(a.re)) return false;
        continue;
      }
      const point = /^\((.+), (.+)\)$/.exec(piece);
      if (point) {
        const a = evalLatex(deps, point[1]);
        const b = evalLatex(deps, point[2]);
        if (!a || !b || !bottomZero(a.re)) return false;
        const h = 1e-7 * Math.max(1, Math.abs(a.re));
        if (![F(a.re + h), F(a.re - h)].every((y) => Math.abs(y - b.re) < 1e-4 * Math.max(1, Math.abs(b.re)))) return false;
        continue;
      }
      const eq = /^(.+?) = (.+)$/.exec(piece);
      if (!eq) return false;
      const [, lhs, rhs] = eq;
      if (lhs === v) {
        const a = evalLatex(deps, rhs);
        if (!a) return false;
        const h = 1e-7 * Math.max(1, Math.abs(a.re));
        if (!(Math.abs(F(a.re + h)) > 1e4 || Math.abs(F(a.re - h)) > 1e4) || !bottomZero(a.re)) return false;
        continue;
      }
      if (lhs === "y" && rf.head !== "y") {
        if (!asymptoteHolds(deps, rhs, v, F)) return false;
        continue;
      }
      if (lhs === "y" && rf.head === "y") {
        // `y = …` under `y = …`: the function rewritten, or an asymptote
        if (!sameFunction(deps, rhs, v, F) && !asymptoteHolds(deps, rhs, v, F)) return false;
        continue;
      }
      if (lhs === rf.head) {
        if (!sameFunction(deps, rhs, v, F)) return false;
        continue;
      }
      // `\frac{2 + 2}{2 + 1} = \frac{4}{3}`: a true statement
      const l = evalLatex(deps, lhs);
      const r = evalLatex(deps, rhs);
      if (!l || !r || !closeC(l, r, 1e-9)) return false;
    }
  }
  return feats.excluded.every((a) => bottomZero(qNum(a)));
}

function sameFunction(deps: CourseDeps, rhs: string, v: string, F: (x: number) => number): boolean {
  const node = parseExpr(deps, rhs);
  if (!node) return false;
  let n = 0;
  for (const x of SAMPLE_XS) {
    const want = F(x);
    if (!Number.isFinite(want) || Math.abs(want) > 1e6) continue;
    const got = evalLatexNode(node, v, x);
    if (got === null || Math.abs(got - want) > 1e-8 * Math.max(1, Math.abs(want))) return false;
    n++;
  }
  return n >= 6;
}

function asymptoteHolds(deps: CourseDeps, rhs: string, v: string, F: (x: number) => number): boolean {
  const node = parseExpr(deps, rhs);
  if (!node) return false;
  for (const x of [1e6, -1e6, 1e8, -1e8]) {
    const got = evalLatexNode(node, v, x);
    const want = F(x);
    if (got === null || !Number.isFinite(want) || Math.abs(got - want) > 1e-3) return false;
  }
  return true;
}

function evalLatexNode(node: MathNode, v: string, x: number): number | null {
  try {
    const y = node.compile().evaluate({ [v]: x }) as unknown;
    return typeof y === "number" && Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- asks

/**
 * What a line under a rational function asks for: `\text{VA} = ?`, `\text{HA} = ?`,
 * `\text{holes}`, `\text{domain}`, `D = ?` (the letter D alone, capital) — or `x = ?`, which under
 * a function with no value given asks where it cannot be evaluated: the vertical asymptotes.
 */
export function askOf(latex: string, v = "x"): Exclude<RationalAsk, "all"> | null {
  const s = latex
    .replace(/\\(?:text|mathrm|textrm|mbox|operatorname)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\[,;:! ]|\\quad|~|\s|\./g, "")
    .replace(/\\text\{\?\}/g, "?");
  const m = /^([A-Za-z]+)(?:=\??)?$/.exec(s);
  if (!m) return null;
  const word = m[1];
  if (/^(?:VA|verticalasymptotes?)$/i.test(word) && word !== "va") return "vertical";
  if (/^(?:HA|horizontalasymptotes?)$/i.test(word) && word !== "ha") return "horizontal";
  if (/^holes?$/i.test(word)) return "holes";
  if (/^domain$/i.test(word) || (word === "D" && /=/.test(s))) return "domain";
  if (word === v && /=/.test(s)) return "vertical";
  return null;
}

/**
 * An ask under a rational function (`\text{VA} = ?`, `x = ?`, `\text{holes}`, …): the nearest
 * line above that is not another ask must be the function. Null otherwise.
 */
export function rationalAskSteps(deps: CourseDeps, lines: readonly string[]): { latex: string; steps: string[] } | null {
  const target = lines[lines.length - 1] ?? "";
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const rf = readRationalFunction(deps, line);
    if (rf) {
      const ask = askOf(target, rf.v);
      return ask ? rationalFunctionSteps(deps, rf, ask, target) : null;
    }
    if (askOf(line) !== null) continue;
    return null;
  }
  return null;
}

/** The ask a text line makes (`\text{holes}`), for the analysis: a question word, not prose. */
export function isWordAsk(latex: string): boolean {
  const ask = askOf(latex);
  return ask !== null && /[A-Za-z]{2,}/.test(latex.replace(/\\[a-zA-Z]+/g, ""));
}
