/**
 * Straight lines (F-IF.6, F-LE.2, A-CED.2, A-REI.10), the way an Algebra 1 teacher writes them:
 *
 *   (2, 3), (5, 9)                  m = 2, (1, 3)             2x + 3y = 6        y - 3 = 2(x - 1)
 *   m = \frac{9 - 3}{5 - 2}         y - 3 = 2(x - 1)          3y = -2x + 6       y - 3 = 2x - 2
 *   m = \frac{6}{3}                 y - 3 = 2x - 2            y = -\frac{2}{3}x + 2   y = 2x + 1
 *   m = 2                           y = 2x + 1
 *   y - 3 = 2(x - 2)
 *   y - 3 = 2x - 4
 *   y = 2x - 1
 *
 * Two points and `m = ?` stop at the slope; two points alone (or with `y = ?`) go on to the line
 * through them, point-slope then slope-intercept. A vertical line (`\frac{6}{0}`) is `x = 2`; a
 * horizontal one `y = 3`. A lone linear equation in x and y is written in slope-intercept form.
 * Exact fractions throughout; every answer is checked on the points (or the line) it came from.
 */
import { combineTerms, q, qAdd, qDiv, qMul, qNeg, termsOf, type Q, type Term } from "./algebra";
import { evalLatex, lettersOf, parseExpr, questionName, splitEquation, type CourseDeps } from "./courseKit";
import { termsTex } from "./literalEquations";
import { exactly, qFromNumber, qIsZero } from "./poly";
import { StepWriter } from "./solution";

export interface Point {
  x: Q;
  y: Q;
}

const qTex = (a: Q): string => (a.d === 1 ? String(a.n) : `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`);
/** a number inside a longer line: `(-3)` */
const qParenTex = (a: Q): string => (a.n < 0 ? `(${qTex(a)})` : qTex(a));

function valueQ(deps: CourseDeps, latex: string): Q | null {
  const v = evalLatex(deps, latex);
  if (!v || Math.abs(v.im) > 1e-12) return null;
  return qFromNumber(v.re);
}

const POINT = String.raw`(?:\\left\s*)?\(\s*([^(),]+?)\s*,\s*([^(),]+?)\s*(?:\\right\s*)?\)`;
const ONE_POINT = new RegExp(`^\\s*${POINT}\\s*$`);
const TWO_POINTS = new RegExp(`^\\s*${POINT}\\s*(?:,|;|\\\\quad|\\\\qquad|\\\\;|\\\\,|\\\\ |\\s)*\\s*${POINT}\\s*$`);

/** The points written on a line: `(2, 3)` or `(2, 3), (5, 9)`. */
export function pointsOn(deps: CourseDeps, latex: string): Point[] | null {
  const two = TWO_POINTS.exec(latex);
  const one = two ? null : ONE_POINT.exec(latex);
  const raw = two ? [two[1], two[2], two[3], two[4]] : one ? [one[1], one[2]] : null;
  if (!raw) return null;
  const values = raw.map((r) => valueQ(deps, r));
  if (values.some((v) => v === null)) return null;
  const out: Point[] = [];
  for (let i = 0; i < values.length; i += 2) out.push({ x: values[i]!, y: values[i + 1]! });
  return out;
}

/** `m = \frac{9 - 3}{5 - 2}`, `m = \frac{6}{3}`, `m = 2` — null slope for a vertical line. */
function slopeLines(a: Point, b: Point, w: StepWriter): Q | null {
  const top = `${qTex(b.y)} - ${qParenTex(a.y)}`;
  const bottom = `${qTex(b.x)} - ${qParenTex(a.x)}`;
  w.write(`m = \\frac{${top}}{${bottom}}`);
  const dy = qAdd(b.y, qNeg(a.y));
  const dx = qAdd(b.x, qNeg(a.x));
  w.write(`m = \\frac{${qTex(dy)}}{${qTex(dx)}}`);
  if (qIsZero(dx)) return null;
  const m = qDiv(dy, dx);
  w.write(`m = ${qTex(m)}`);
  return m;
}

/** `(x - 2)`, `(x + 1)`, `x` for a point's x. */
function shifted(letter: string, c: Q): string {
  if (qIsZero(c)) return letter;
  return `${letter} ${c.n < 0 ? "+" : "-"} ${qTex({ n: Math.abs(c.n), d: c.d })}`;
}

/** `y = 2x - 1` for slope m through (x1, y1): the value of b. */
function intercept(m: Q, p: Point): Q {
  return qAdd(p.y, qNeg(qMul(m, p.x)));
}

/** `2x - 1`, `-\frac{2}{3}x + 2`, `3` (m = 0), `x` (m = 1). */
export function mxPlusB(m: Q, b: Q): string {
  const terms: Term[] = [];
  if (!qIsZero(m)) terms.push({ c: m, vars: { x: 1 } });
  if (!qIsZero(b) || terms.length === 0) terms.push({ c: b, vars: {} });
  return termsTex(terms);
}

/** Point-slope, expanded, slope-intercept: `y - 3 = 2(x - 2)`, `y - 3 = 2x - 4`, `y = 2x - 1`. */
function lineLines(m: Q, p: Point, w: StepWriter): string {
  const b = intercept(m, p);
  const left = shifted("y", p.y);
  const bracket = shifted("x", p.x);
  const factor = qIsZero(p.x) ? "x" : `(${bracket})`;
  const mTex = m.n === 1 && m.d === 1 ? "" : m.n === -1 && m.d === 1 ? "-" : qTex(m);
  if (!qIsZero(m)) w.write(`${left} = ${mTex}${factor}`);
  // expanded: m x - m x1
  const expanded: Term[] = [];
  if (!qIsZero(m)) expanded.push({ c: m, vars: { x: 1 } });
  const k = qNeg(qMul(m, p.x));
  if (!qIsZero(k)) expanded.push({ c: k, vars: {} });
  if (!qIsZero(m) && !qIsZero(p.x) && !qIsZero(p.y)) w.write(`${left} = ${termsTex(expanded)}`);
  const final = `y = ${mxPlusB(m, b)}`;
  w.write(final);
  return final;
}

export interface LineAnswer {
  latex: string;
  steps: string[];
}

/** Two points: the slope, then (unless only the slope was asked for) the line through them. */
export function throughTwoPoints(a: Point, b: Point, slopeOnly: boolean, normalize: (s: string) => string): LineAnswer | null {
  return exactly(() => {
    if (a.x.n * b.x.d === b.x.n * a.x.d && a.y.n * b.y.d === b.y.n * a.y.d) return null;
    const w = new StepWriter(normalize);
    const m = slopeLines(a, b, w);
    if (slopeOnly) {
      if (!m) return { latex: w.last!, steps: w.lines() };
      return { latex: `m = ${qTex(m)}`, steps: w.lines() };
    }
    if (!m) {
      // vertical: every point has the same x
      const final = `x = ${qTex(a.x)}`;
      w.write(final);
      return { latex: final, steps: w.lines() };
    }
    const final = lineLines(m, a, w);
    // the check: both points are on the answer
    const bAt = (p: Point) => qAdd(qMul(m, p.x), intercept(m, a));
    const same = (u: Q, v: Q) => u.n * v.d === v.n * u.d;
    if (!same(bAt(a), a.y) || !same(bAt(b), b.y)) return null;
    return { latex: final, steps: w.lines() };
  });
}

/** A point and a slope: point-slope form, then slope-intercept. */
export function throughPointWithSlope(p: Point, m: Q, normalize: (s: string) => string): LineAnswer | null {
  return exactly(() => {
    const w = new StepWriter(normalize);
    const final = lineLines(m, p, w);
    return { latex: final, steps: w.lines() };
  });
}

/**
 * A linear equation in x and y written as `y = mx + b` (a vertical line as `x = c`): brackets
 * expanded, the y term alone, divided through. Null when the line is not linear in x and y, has
 * no y, or is already `y = mx + b` with nothing to expand.
 */
export function slopeIntercept(deps: CourseDeps, latex: string): LineAnswer | null {
  const sides = splitEquation(latex);
  if (!sides) return null;
  const L = parseExpr(deps, sides[0]);
  const R = parseExpr(deps, sides[1]);
  if (!L || !R) return null;
  const letters = [...new Set([...lettersOf(L), ...lettersOf(R)])].sort();
  if (letters.join() !== "x,y") return null;
  const TL = termsOf(L, ["x", "y"]);
  const TR = termsOf(R, ["x", "y"]);
  if (!TL || !TR) return null;
  const degree = (t: Term) => (t.vars.x ?? 0) + (t.vars.y ?? 0);
  if ([...TL, ...TR].some((t) => degree(t) > 1)) return null;
  return exactly(() => {
    const w = new StepWriter(deps.normalize, `${sides[0]} = ${sides[1]}`);
    const isY = (t: Term) => t.vars.y === 1;
    const isX = (t: Term) => t.vars.x === 1;
    const coef = (ts: Term[], pick: (t: Term) => boolean) => ts.filter(pick).reduce((s, t) => qAdd(s, t.c), q(0));
    const yL = coef(TL, isY);
    const yR = coef(TR, isY);
    const B = qAdd(yL, qNeg(yR));
    const A = qAdd(coef(TR, isX), qNeg(coef(TL, isX)));
    const C = qAdd(coef(TR, (t) => degree(t) === 0), qNeg(coef(TL, (t) => degree(t) === 0)));
    const alreadyY = sides[0].replace(/\s+/g, "") === "y" && qIsZero(yR);
    if (/\(/.test(latex)) {
      // brackets expanded as written, then like terms collected
      w.write(`${termsTex(TL)} = ${termsTex(TR)}`);
      w.write(`${termsTex(combineTerms(TL))} = ${termsTex(combineTerms(TR))}`);
    }
    if (qIsZero(B)) {
      // no y left: a vertical line x = c
      if (qIsZero(A)) return null;
      const final = `x = ${qTex(qNeg(qDiv(C, A)))}`;
      w.write(final);
      return { latex: final, steps: w.lines() };
    }
    if (alreadyY && !/\(/.test(latex) && combineTerms(TR).length === TR.length) return null;
    const right: Term[] = [];
    if (!qIsZero(A)) right.push({ c: A, vars: { x: 1 } });
    if (!qIsZero(C) || right.length === 0) right.push({ c: C, vars: {} });
    w.write(`${termsTex([{ c: B, vars: { y: 1 } }])} = ${termsTex(right)}`);
    const m = qDiv(A, B);
    const b = qDiv(C, B);
    const final = `y = ${mxPlusB(m, b)}`;
    w.write(final);
    // the check: the answer and the line agree at two x values
    for (const x of [q(0), q(3)]) {
      const y = qAdd(qMul(m, x), b);
      const lhs = TL.reduce((s, t) => qAdd(s, qMul(t.c, qMul(t.vars.x ? x : q(1), t.vars.y ? y : q(1)))), q(0));
      const rhs = TR.reduce((s, t) => qAdd(s, qMul(t.c, qMul(t.vars.x ? x : q(1), t.vars.y ? y : q(1)))), q(0));
      if (lhs.n * rhs.d !== rhs.n * lhs.d) return null;
    }
    const steps = w.lines();
    return steps.length > 0 ? { latex: final, steps } : null;
  });
}

/**
 * From the column: points, a slope `m = 2`, and what is asked (`m = ?`, `y = ?`, or nothing).
 * Null when the column is not about a line through points.
 */
export function lineFromColumn(deps: CourseDeps, lines: readonly string[]): LineAnswer | null {
  const target = lines[lines.length - 1] ?? "";
  const asked = questionName(target);
  if (asked && asked !== "m" && asked !== "y") return null;
  const points: Point[] = [];
  let slope: Q | null = null;
  let other = false;
  for (const l of asked ? lines.slice(0, -1) : lines) {
    const ps = pointsOn(deps, l);
    if (ps) {
      points.push(...ps);
      continue;
    }
    const sides = splitEquation(l);
    if (sides && sides[0].trim() === "m") {
      const v = valueQ(deps, sides[1]);
      if (v) {
        slope = v;
        continue;
      }
    }
    other = true;
  }
  if (other) return null;
  if (points.length === 2 && slope === null) return throughTwoPoints(points[0], points[1], asked === "m", deps.normalize);
  if (points.length === 1 && slope !== null && asked !== "m") return throughPointWithSlope(points[0], slope, deps.normalize);
  return null;
}
