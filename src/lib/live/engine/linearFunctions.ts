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
 *
 * Standard form `Ax + By = C` (whole numbers, A > 0, no common factor), asked for with the
 * template `Ax + By = C` or the student's `\text{standard form}` under the line (or above the
 * line Solve is pressed on); `y = mx + b` / `\text{slope-intercept form}` asks the other way:
 *
 *   y = -\frac{2}{3}x + 2        (2, 3), (5, 9)             2x + 3y = 6
 *   Ax + By = C                  Ax + By = C                y = mx + b
 *   3y = -2x + 6                 m = \frac{9 - 3}{5 - 2}    3y = -2x + 6
 *   2x + 3y = 6                  …, y - 3 = 2(x - 2)        y = -\frac{2}{3}x + 2
 *                                y - 3 = 2x - 4
 *                                -2x + y = -1
 *                                2x - y = 1
 */
import { combineTerms, gcdInt, q, qAdd, qDiv, qMul, qNeg, termsOf, type Q, type Term } from "./algebra";
import type { AnalyzeContext, LineAnalysis } from "../contracts";
import { evalLatex, exactNode, hasRelation, lcm, lettersOf, parseExpr, questionName, splitEquation, type CourseDeps } from "./courseKit";
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

// ---------------------------------------------------------------- standard form

export type LineForm = "standard" | "slope-intercept";

const LINE_WORDS = /^\\(?:text|textrm|mathrm|operatorname)\s*\{\s*([a-zA-Z][a-zA-Z\s-]*?)\s*\}\s*(?:=\s*(?:\?|\\text\s*\{\s*\?\s*\})?)?\s*$/;

/** The form of a line a line asks for: `Ax + By = C` / `\text{standard form}`, `y = mx + b` / `\text{slope-intercept form}`. */
export function lineFormAsked(latex: string): LineForm | null {
  const s = (latex ?? "").replace(/\\[,;:! ]|\\cdot|\s+/g, "");
  if (/^Ax\+By=C$/.test(s)) return "standard";
  if (/^y=mx\+b$/.test(s)) return "slope-intercept";
  const w = LINE_WORDS.exec((latex ?? "").trim());
  const key = w ? w[1].replace(/[\s-]+/g, "").toLowerCase() : "";
  if (key === "standardform") return "standard";
  if (key === "slopeinterceptform") return "slope-intercept";
  return null;
}

/** A form of the line asked for above the line (a template or its name): the form, or null. */
export function lineFormAbove(lines: readonly string[]): LineForm | null {
  for (const l of lines) {
    const form = lineFormAsked(l);
    if (form) return form;
  }
  return null;
}

/** `ax + by = c` as its x, y and number terms on each side (decimals made exact), or null when not linear in x and y. */
function linearSides(deps: CourseDeps, latex: string): { TL: Term[]; TR: Term[]; sides: [string, string] } | null {
  const sides = splitEquation(latex);
  if (!sides) return null;
  const L0 = parseExpr(deps, sides[0]);
  const R0 = parseExpr(deps, sides[1]);
  const L = L0 && exactNode(deps, L0);
  const R = R0 && exactNode(deps, R0);
  if (!L || !R) return null;
  const letters = [...new Set([...lettersOf(L), ...lettersOf(R)])];
  if (letters.length === 0 || letters.some((v) => v !== "x" && v !== "y")) return null;
  const TL = termsOf(L, ["x", "y"]);
  const TR = termsOf(R, ["x", "y"]);
  if (!TL || !TR) return null;
  if ([...TL, ...TR].some((t) => (t.vars.x ?? 0) + (t.vars.y ?? 0) > 1)) return null;
  return { TL, TR, sides };
}

/** A linear equation with both x and y in it (a line, not an equation in one unknown). */
export function isLineInXY(deps: CourseDeps, latex: string): boolean {
  const s = linearSides(deps, latex);
  if (!s) return false;
  const all = [...combineTerms(s.TL), ...combineTerms(s.TR)];
  return all.some((t) => t.vars.x === 1) && all.some((t) => t.vars.y === 1);
}

/** Two equations are the same line (`y = 2x - 1`, `-2x + y = -1`): their Ax + By = C proportional. */
export function sameLine(deps: CourseDeps, a: string, b: string): boolean {
  const abc = (latex: string): Q[] | null => {
    const s = linearSides(deps, latex);
    if (!s) return null;
    const sum = (ts: Term[], pick: (t: Term) => boolean) => ts.filter(pick).reduce((acc, t) => qAdd(acc, t.c), q(0));
    const isX = (t: Term) => t.vars.x === 1;
    const isY = (t: Term) => t.vars.y === 1;
    const isNumber = (t: Term) => Object.keys(t.vars).length === 0;
    return exactly(() => [qAdd(sum(s.TL, isX), qNeg(sum(s.TR, isX))), qAdd(sum(s.TL, isY), qNeg(sum(s.TR, isY))), qAdd(sum(s.TR, isNumber), qNeg(sum(s.TL, isNumber)))]);
  };
  const u = abc(a);
  const v = abc(b);
  if (!u || !v) return false;
  return (
    exactly(() => {
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (!qIsZero(qAdd(qMul(u[i], v[j]), qNeg(qMul(u[j], v[i]))))) return false;
      return true;
    }) ?? false
  );
}

/**
 * A linear equation in x and y written in standard form `Ax + By = C` — whole numbers, A > 0 (B > 0
 * when there is no x term), no common factor — the way a teacher does it: brackets expanded,
 * fractions and decimals cleared by their LCD, x and y collected on the left and the number on
 * the right, then the line divided by its common factor (and by -1 when A is negative). Null when
 * the line is already in standard form, or is not linear in x and y.
 */
export function standardForm(deps: CourseDeps, latex: string): LineAnswer | null {
  const lin = linearSides(deps, latex);
  if (!lin) return null;
  return exactly(() => {
    const { TL, TR, sides } = lin;
    const w = new StepWriter(deps.normalize, `${sides[0]} = ${sides[1]}`);
    let left = combineTerms(TL);
    let right = combineTerms(TR);
    if (/\(/.test(latex)) {
      // brackets expanded as written, then like terms collected
      w.write(`${termsTex(TL)} = ${termsTex(TR)}`);
      w.write(`${termsTex(left)} = ${termsTex(right)}`);
    }
    const lcd = [...left, ...right].reduce((m, t) => lcm(m, t.c.d), 1);
    if (lcd > 1) {
      const scale = (ts: Term[]) => ts.map((t) => ({ c: qMul(t.c, q(lcd)), vars: t.vars }));
      left = scale(left);
      right = scale(right);
      w.write(`${termsTex(left)} = ${termsTex(right)}`);
    }
    const coef = (ts: Term[], pick: (t: Term) => boolean) => ts.filter(pick).reduce((s, t) => qAdd(s, t.c), q(0));
    const isX = (t: Term) => t.vars.x === 1;
    const isY = (t: Term) => t.vars.y === 1;
    const isNumber = (t: Term) => Object.keys(t.vars).length === 0;
    let A = qAdd(coef(left, isX), qNeg(coef(right, isX)));
    let B = qAdd(coef(left, isY), qNeg(coef(right, isY)));
    let C = qAdd(coef(right, isNumber), qNeg(coef(left, isNumber)));
    if (qIsZero(A) && qIsZero(B)) return null;
    const lineOf = () => {
      const xy: Term[] = [
        { c: A, vars: { x: 1 } },
        { c: B, vars: { y: 1 } },
      ];
      return `${termsTex(xy.filter((t) => !qIsZero(t.c)))} = ${qTex(C)}`;
    };
    // x and y on the left, the number on the right
    w.write(lineOf());
    const g = gcdInt(gcdInt(A.n, B.n), C.n) * (A.n < 0 || (A.n === 0 && B.n < 0) ? -1 : 1);
    if (g !== 1) {
      [A, B, C] = [A, B, C].map((v) => qDiv(v, q(g)));
      w.write(lineOf());
    }
    const final = lineOf();
    // the check: the same line (the coefficients a multiple of the ones written), in whole numbers, A > 0
    const A0 = qAdd(coef(combineTerms(TL), isX), qNeg(coef(combineTerms(TR), isX)));
    const B0 = qAdd(coef(combineTerms(TL), isY), qNeg(coef(combineTerms(TR), isY)));
    const C0 = qAdd(coef(combineTerms(TR), isNumber), qNeg(coef(combineTerms(TL), isNumber)));
    const cross = (u: Q, v: Q, s: Q, t: Q) => qAdd(qMul(u, t), qNeg(qMul(v, s)));
    if (!qIsZero(cross(A, B, A0, B0)) || !qIsZero(cross(A, C, A0, C0)) || !qIsZero(cross(B, C, B0, C0))) return null;
    if ([A, B, C].some((v) => v.d !== 1) || A.n < 0 || (A.n === 0 && B.n <= 0)) return null;
    const steps = w.lines();
    return steps.length > 0 ? { latex: final, steps } : null;
  });
}

/** The line in the form asked for: standard form, or slope-intercept (`slopeIntercept`). */
export function lineIn(deps: CourseDeps, latex: string, form: LineForm): LineAnswer | null {
  return form === "standard" ? standardForm(deps, latex) : slopeIntercept(deps, latex);
}

/**
 * The column's last line asks for a form of the line above it: the line through the points (or
 * a point and a slope) above, or the nearest equation above, written in that form. Null when
 * nothing above is a line, or it is already in that form.
 */
export function lineFormAnswer(deps: CourseDeps, lines: readonly string[]): LineAnswer | null {
  const form = lineFormAsked(lines[lines.length - 1] ?? "");
  if (!form) return null;
  const above = lines.slice(0, -1);
  const through = above.length > 0 ? lineFromColumn(deps, above) : null;
  if (through) {
    if (form === "slope-intercept") return through;
    // from its point-slope line: its standard form follows it (the slope-intercept line is not needed)
    const at = through.steps.findIndex((s) => /^\s*y\b/.test(s));
    const sf = at === -1 ? null : standardForm(deps, through.steps[at]);
    if (!sf) return through;
    return { latex: sf.latex, steps: [...through.steps.slice(0, at + 1), ...sf.steps] };
  }
  for (let i = above.length - 1; i >= 0; i--) {
    if (!hasRelation(above[i])) continue;
    return isLineInXY(deps, above[i]) ? lineIn(deps, above[i], form) : null;
  }
  return null;
}

/** A line's analysis: a function `y = mx + b`, an equation linear in x and y, a point, or a slope `m = 2`. */
function isLineAnalysis(deps: CourseDeps, a: LineAnalysis | undefined): boolean {
  if (!a) return false;
  if (a.kind === "point") return true;
  if (a.kind === "assignment") return /^m\s*=/.test(a.math);
  if ((a.kind !== "function" && a.kind !== "equation") || !a.math) return false;
  const m = /^([^=]+?)\s*==?\s*([^=]+)$/.exec(a.math);
  if (!m) return false;
  try {
    const nodes = [m[1], m[2]].map((s) => exactNode(deps, deps.math.parse(s)));
    if (nodes.some((n) => !n)) return false;
    const letters = new Set(nodes.flatMap((n) => lettersOf(n!)));
    if (![...letters].every((v) => v === "x" || v === "y") || !letters.has("y")) return false;
    return nodes.every((n) => termsOf(n!, ["x", "y"])?.every((t) => (t.vars.x ?? 0) + (t.vars.y ?? 0) <= 1) ?? false);
  } catch {
    return false;
  }
}

/**
 * A form of the line asked for under a line (`Ax + By = C`, `y = mx + b`, `\text{standard form}`):
 * not a step (kind `unknown`), so the student's next line is checked against the line above it,
 * and Solve answers it. Null for any other line.
 */
export function lineFormAnalysis(deps: CourseDeps, latex: string, ctx: AnalyzeContext): LineAnalysis | null {
  if (!lineFormAsked(latex) || !isLineAnalysis(deps, ctx.previous)) return null;
  return { kind: "unknown", math: "", resultLatex: "", verdict: "unknown", note: "" };
}
