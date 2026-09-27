/**
 * Inequalities past linear, solved the way a teacher writes them — the critical values, then the
 * intervals where the sign is right, never a word:
 *
 *   x^2 - 5x + 6 < 0        \frac{x + 1}{x - 3} \le 2             -3 < 2x + 1 < 7
 *   (x - 2)(x - 3) < 0      x \neq 3                              -4 < 2x < 6
 *   x = 2, \ x = 3          (x + 1)(x - 3) \le 2(x - 3)^{2}        -2 < x < 3
 *   2 < x < 3               x^{2} - 10x + 21 \ge 0
 *                           (x - 3)(x - 7) \ge 0
 *   x^2 - 2x - 1 > 0        x = 3, \ x = 7
 *   x^{2} - 2x - 1 = 0      x < 3, \ x \ge 7
 *   … the formula …
 *   x = 1 \pm \sqrt{2}
 *   x < 1 - \sqrt{2}, \ x > 1 + \sqrt{2}
 *
 * A polynomial inequality is brought to `P op 0` with a positive leading coefficient (moving
 * every term to the side that makes it so), divided by its positive content, factored over the
 * rationals (or its roots found by the quadratic formula), and the sign of P read between the
 * critical values. A rational one is multiplied by the square of its denominator (positive
 * wherever the line is defined), so nothing flips; the denominator's zeros stay excluded. A chain
 * `a < px + q < b` is solved in all three parts at once. The answer is a union written as a list
 * (`x < 2, \ x > 3`); none is `\varnothing`, every number `-\infty < x < \infty`, all but one
 * point `x \neq 1`. Null for anything else. Pure: type-only mathjs import.
 */
import type { MathNode } from "mathjs";
import { gcdInt, hasBracket, opLatex, q, qAdd, qDiv, qLatex, qMul, standardOrder, termsLatex, type Q, type RelOp, type Term } from "./algebra";
import type { ParsedRelation, SolveContext } from "./advanced";
import { argsOf, coefficientOf, constantValue, fnOf, mentions, polyTermsOf, stripParens, summands } from "./nodes";
import { ONE, deg, exactly, factorLinear, lead, polyEvalNum, polyFromTerms, polyLatex, polyNeg, polyScale, polySub, primitive, productLatex, qEq, qIsZero, qNum, qSub, rootFactor, type Poly } from "./poly";
import { qRoot } from "./quadratic";
import { ALL_REALS, LIST_SEP, NO_SOLUTION, StepWriter, rootsLine, type Solution } from "./solution";

type IneqOp = Exclude<RelOp, "==">;

const FLIP: Record<IneqOp, IneqOp> = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
const strict = (op: IneqOp): boolean => op === "<" || op === ">";

/** A place the sign of the left side may change: a root, or a zero of a denominator. */
interface Critical {
  latex: string;
  value: number;
}

interface Bound {
  latex: string;
  closed: boolean;
}

/** One connected piece of the answer: `lower < x < upper`, a bound null for ±∞; a point when both are the same closed value. */
interface Piece {
  lower: Bound | null;
  upper: Bound | null;
}

function pieceLatex(p: Piece, v: string): string {
  const le = (b: Bound) => (b.closed ? "\\le" : "<");
  if (p.lower && p.upper && p.lower.latex === p.upper.latex) return `${v} = ${p.lower.latex}`;
  if (!p.lower && !p.upper) return ALL_REALS(v);
  if (!p.lower) return `${v} ${le(p.upper!)} ${p.upper!.latex}`;
  if (!p.upper) return `${v} ${p.lower.closed ? "\\ge" : ">"} ${p.lower.latex}`;
  return `${p.lower.latex} ${le(p.lower)} ${v} ${le(p.upper)} ${p.upper.latex}`;
}

/**
 * The solution set of `F(x) op 0` as the tutor writes it, from the sign of F between its critical
 * values (every root of F is one; `excluded` are the ones the line cannot take).
 */
export function intervalsLine(variable: string, critical: readonly Critical[], F: (x: number) => number, op: IneqOp, excluded: readonly number[] = []): string {
  const pts: Critical[] = [];
  for (const c of [...critical].sort((a, b) => a.value - b.value)) if (!pts.some((p) => Math.abs(p.value - c.value) < 1e-9)) pts.push(c);
  const wantPositive = op === ">" || op === ">=";
  const holds = (x: number) => {
    const y = F(x);
    return wantPositive ? y > 0 : y < 0;
  };
  // segments in order: interval 0, point 0, interval 1, …, point k-1, interval k
  const tests = pts.length === 0 ? [0] : [pts[0].value - 1, ...pts.slice(1).map((p, i) => (pts[i].value + p.value) / 2), pts[pts.length - 1].value + 1];
  const inInterval = tests.map(holds);
  const atPoint = pts.map((p) => !strict(op) && !excluded.some((e) => Math.abs(e - p.value) < 1e-9));
  const pieces: Piece[] = [];
  let open: Piece | null = null;
  const segments = inInterval.length + pts.length;
  for (let s = 0; s < segments; s++) {
    const isPoint = s % 2 === 1;
    const i = Math.floor(s / 2);
    const included = isPoint ? atPoint[i] : inInterval[i];
    if (included && !open) {
      open = { lower: isPoint ? { latex: pts[i].latex, closed: true } : i === 0 ? null : { latex: pts[i - 1].latex, closed: false }, upper: null };
    } else if (!included && open) {
      open.upper = isPoint ? { latex: pts[i].latex, closed: false } : { latex: pts[i - 1].latex, closed: true };
      pieces.push(open);
      open = null;
    }
  }
  if (open) pieces.push(open);
  if (pieces.length === 0) return NO_SOLUTION;
  // every number but one: `x \neq 1`
  if (pieces.length === 2 && !pieces[0].lower && !pieces[1].upper && pieces[0].upper && pieces[1].lower && !pieces[0].upper.closed && !pieces[1].lower.closed && pieces[0].upper.latex === pieces[1].lower.latex) {
    return `${variable} \\neq ${pieces[0].upper.latex}`;
  }
  return pieces.map((p) => pieceLatex(p, variable)).join(LIST_SEP);
}

// --- polynomial inequalities ----------------------------------------------------------------

/** The discriminant's sign of a quadratic: negative means it never changes sign. */
function discriminant(p: Poly): number {
  const [c, b, a] = p.map(qNum);
  return b * b - 4 * a * c;
}

/**
 * `P op 0` (P = left side minus right side, nothing written yet): the standard form with a
 * positive leading coefficient, the content divided out, the factored form and critical values
 * (or the equation by the formula), then the intervals. `excluded`: zeros of a denominator.
 */
function solvePolynomial(P0: Poly, op0: IneqOp, variable: string, w: StepWriter, ctx: SolveContext, excluded: readonly Q[], from: "sum" | "product" | "given" = "sum"): Solution | null {
  let P = P0;
  let op = op0;
  if (deg(P) < 1) return null;
  if (lead(P).n < 0) {
    // every term moved to the side where the leading coefficient is positive
    P = polyNeg(P);
    op = FLIP[op];
  }
  const rel = opLatex(op);
  const { content, prim } = primitive(P);
  const writeStandard = from === "sum";
  // the student's own product, needing no sign turned or number divided out, is not rewritten
  const factoredGiven = from === "given" && lead(P0).n > 0 && qEq(content, ONE);
  if (writeStandard) {
    w.write(`${polyLatex(P, variable)} ${rel} 0`);
    if (!qEq(content, ONE)) w.write(`${polyLatex(prim, variable)} ${rel} 0`);
  }
  const lf = factorLinear(prim);
  const n = deg(prim);
  let critical: Critical[];
  if (deg(lf.rest) === 0 || (deg(lf.rest) === 2 && lf.roots.length > 0 && discriminant(lf.rest) < 0)) {
    // factors over the rationals (a leftover quadratic with no real roots is always positive)
    const factors = lf.roots.map((r) => ({ f: rootFactor(r.root), mult: r.mult }));
    if (deg(lf.rest) === 2) factors.push({ f: lf.rest, mult: 1 });
    if (n >= 2 && !factoredGiven) w.write(`${productLatex(ONE, factors, variable)} ${rel} 0`);
    else if (n < 2 && !writeStandard) w.write(`${polyLatex(prim, variable)} ${rel} 0`);
    critical = lf.roots.map((r) => ({ latex: qLatex(r.root), value: qNum(r.root) }));
    if (n >= 2) w.write(rootsLine(variable, lf.roots.map((r) => qRoot(r.root))));
  } else if (n === 2) {
    // no rational roots: the equation by the formula, its roots the critical values
    if (!writeStandard) w.write(`${polyLatex(prim, variable)} ${rel} 0`);
    const eq = `${polyLatex(prim, variable)} = 0`;
    const sol = ctx.solve(eq);
    if (!sol || !sol.roots) return null;
    w.write(eq);
    w.writeAll(sol.steps.filter((s) => s !== NO_SOLUTION));
    critical = sol.roots.map((r) => ({ latex: r.latex, value: r.value }));
  } else return null;
  const answer = intervalsLine(
    variable,
    critical,
    (x) => polyEvalNum(prim, x),
    op,
    excluded.map((e) => qNum(e)),
  );
  w.write(answer);
  return { steps: w.lines(), final: answer, roots: null };
}

function lcdOf(terms: readonly Term[]): number {
  let lcd = 1;
  for (const t of terms) lcd = (lcd * t.c.d) / gcdInt(lcd, t.c.d);
  return lcd;
}

const scaled = (terms: readonly Term[], k: Q): Term[] => terms.map((t) => ({ c: qMul(t.c, k), vars: t.vars }));

/** `x^2 - 4 < 0`, `x(x + 1) \ge 6`, `\frac{x^2}{2} > x`: a polynomial of degree 2 to 4 against another. */
function polynomialInequality(rel: ParsedRelation, op: IneqOp, ctx: SolveContext): Solution | null {
  const v = rel.variable;
  let L = polyTermsOf(rel.lhs, v);
  let R = polyTermsOf(rel.rhs, v);
  if (!L || !R) return null;
  const pl = polyFromTerms(L, v);
  const pr = polyFromTerms(R, v);
  if (!pl || !pr) return null;
  const P = polySub(pl, pr);
  if (deg(P) < 2 || deg(P) > 4) return null;
  const w = new StepWriter(ctx.normalize, rel.latex);
  // already a product against 0 (`(x - 1)^2 > 0`, `x(x - 4) \le 0`): straight to its factors
  const isZero = (n: MathNode) => {
    const c = constantValue(n);
    return c !== null && qIsZero(c);
  };
  const product = (n: MathNode) => ["multiply", "pow"].includes(fnOf(stripParens(n)));
  if ((isZero(rel.rhs) && product(rel.lhs)) || (isZero(rel.lhs) && product(rel.rhs))) return solvePolynomial(P, op, v, w, ctx, [], "given");
  const lcd = lcdOf([...L, ...R]);
  if (lcd > 1) {
    L = scaled(L, q(lcd));
    R = scaled(R, q(lcd));
  }
  // brackets expanded, fractions cleared (by a positive number: the sign stays)
  if (hasBracket(rel.latex) || lcd > 1) w.write(`${termsLatex(L)} ${opLatex(op)} ${termsLatex(R)}`);
  return solvePolynomial(polySub(polyFromTerms(L, v)!, polyFromTerms(R, v)!), op, v, w, ctx, []);
}

// --- rational inequalities --------------------------------------------------------------------

interface Summand {
  sign: 1 | -1;
  /** k · num / den; den is [1] for a polynomial term */
  num: Poly;
  den: Poly | null;
}

function sideSummands(node: MathNode, variable: string): Summand[] | null {
  const out: Summand[] = [];
  for (const s of summands(node)) {
    const co = coefficientOf(s.node);
    if (!co) return null;
    const core = stripParens(co.core);
    if (core.type === "OperatorNode" && fnOf(core) === "divide" && mentions(argsOf(core)[1], variable)) {
      const [a, b] = argsOf(core);
      const nt = polyTermsOf(a, variable);
      const dt = polyTermsOf(b, variable);
      const num = nt && polyFromTerms(nt, variable);
      const den = dt && polyFromTerms(dt, variable);
      if (!num || !den || deg(den) < 1) return null;
      out.push({ sign: s.sign, num: polyScale(num, co.k), den });
      continue;
    }
    const t = polyTermsOf(s.node, variable);
    const p = t && polyFromTerms(t, variable);
    if (!p) return null;
    out.push({ sign: s.sign, num: p, den: null });
  }
  return out;
}

/** A factor inside a product: `(x - 3)`, `x`, `2`. */
function factorTex(p: Poly, v: string): string {
  const nonzero = p.filter((c) => !qIsZero(c)).length;
  return nonzero > 1 ? `(${polyLatex(p, v)})` : polyLatex(p, v);
}

/** One summand times D²: `(x + 1)(x - 3)` for `\frac{x + 1}{x - 3}`, `2(x - 3)^{2}` for `2`. */
function timesSquare(s: Summand, D: Poly, v: string): { tex: string; negative: boolean } {
  const bareD = deg(D) === 1 && qIsZero(D[0]) && qEq(D[1], ONE);
  const square = bareD ? `${v}^{2}` : `${factorTex(D, v)}^{2}`;
  const num = s.num;
  let negative = s.sign < 0;
  const numTerms = num.filter((c) => !qIsZero(c)).length;
  let numTex = factorTex(num, v);
  if (numTerms === 1 && lead(num).n < 0) {
    negative = !negative;
    numTex = polyLatex(polyNeg(num), v);
  }
  const unit = numTerms === 1 && deg(num) === 0 && qEq(num[0], ONE);
  const other = s.den ? factorTex(D, v) : square;
  const tex = unit ? other : `${numTex}${other}`;
  return { tex, negative };
}

function joinSigned(parts: ReadonlyArray<{ tex: string; negative: boolean }>): string {
  let out = "";
  for (const p of parts) {
    if (!out) out = p.negative ? `-${p.tex}` : p.tex;
    else out += ` ${p.negative ? "-" : "+"} ${p.tex}`;
  }
  return out || "0";
}

/** The side's polynomial once multiplied by D² (a fraction's own D cancels once). */
function sideTimesSquare(ss: readonly Summand[], D: Poly): Poly {
  let out: Poly = [];
  const mul = (a: Poly, b: Poly): Poly => {
    const r: Q[] = new Array(Math.max(0, a.length + b.length - 1)).fill(q(0));
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] = qAdd(r[i + j], qMul(a[i], b[j]));
    return r;
  };
  for (const s of ss) {
    const term = s.den ? mul(s.num, D) : mul(s.num, mul(D, D));
    out = s.sign < 0 ? polySub(out, term) : polySub(out, polyNeg(term));
  }
  return out;
}

/** `\frac{x - 1}{x + 2} > 0`, `\frac{x + 1}{x - 3} \le 2`: one fraction with the unknown below. */
function rationalInequality(rel: ParsedRelation, op: IneqOp, ctx: SolveContext): Solution | null {
  const v = rel.variable;
  const L = sideSummands(rel.lhs, v);
  const R = sideSummands(rel.rhs, v);
  if (!L || !R) return null;
  const fractions = [...L, ...R].filter((s) => s.den);
  if (fractions.length !== 1) return null;
  const D = fractions[0].den!;
  const lf = factorLinear(D);
  if (deg(lf.rest) > 0) return null; // a denominator with irrational zeros
  const zeros = lf.roots.map((r) => r.root);
  const w = new StepWriter(ctx.normalize, rel.latex);
  w.write(zeros.map((z) => `${v} \\neq ${qLatex(z)}`).join(LIST_SEP));
  const P = polySub(sideTimesSquare(L, D), sideTimesSquare(R, D));
  const alone = (side: Summand[], other: Summand[]) => side.length === 1 && side[0].den !== null && other.every((s) => s.den === null && s.num.length === 0);
  if (alone(L, R) || alone(R, L)) {
    // `\frac{N}{D} > 0` times D²: `N D > 0`, written factored at once
    return solvePolynomial(P, op, v, w, ctx, zeros, "product");
  }
  const rel2 = opLatex(op);
  w.write(`${joinSigned(L.map((s) => timesSquare(s, D, v)))} ${rel2} ${joinSigned(R.map((s) => timesSquare(s, D, v)))}`);
  w.write(`${polyLatex(sideTimesSquare(L, D), v)} ${rel2} ${polyLatex(sideTimesSquare(R, D), v)}`, true);
  return solvePolynomial(P, op, v, w, ctx, zeros);
}

/**
 * An inequality in one unknown that is not linear: a polynomial (degree 2–4) or one fraction with
 * the unknown in its denominator. Null for anything else (roots, logs, bars are other solvers').
 */
export function inequalitySteps(rel: ParsedRelation, ctx: SolveContext): Solution | null {
  if (rel.op === "==") return null;
  const op = rel.op as IneqOp;
  return exactly(() => polynomialInequality(rel, op, ctx) ?? rationalInequality(rel, op, ctx));
}

// --- chains ----------------------------------------------------------------------------------

/** A linear middle as a student writes it: `2x + 1`, `3 - x` (a lone negative unknown after the number). */
function middleTex(f: Poly, v: string): string {
  const terms: Term[] = [
    { c: f[1] ?? q(0), vars: { [v]: 1 } },
    { c: f[0] ?? q(0), vars: {} },
  ].filter((t) => !qIsZero(t.c));
  return termsLatex(standardOrder(terms));
}

/** `a < f < b` in one unknown: three sides and two operators, as mathjs trees. */
export interface ParsedChain {
  sides: [MathNode, MathNode, MathNode];
  ops: [RelOp, RelOp];
  variable: string;
  latex: string;
}

/**
 * `-3 < 2x + 1 < 7` → `-4 < 2x < 6` → `-2 < x < 3`: fractions cleared, the number taken from all
 * three parts, then the coefficient divided out (a negative one turns the chain round). A
 * descending chain (`7 > 2x + 1 > -3`) is read ascending. Null unless the outer parts are numbers
 * and the middle is linear.
 */
export function chainSteps(ch: ParsedChain, normalize: (latex: string) => string): Solution | null {
  return exactly(() => {
    const v = ch.variable;
    let [aNode, fNode, bNode] = ch.sides;
    let [op1, op2] = ch.ops;
    if (op1 === "==" || op2 === "==") return null;
    const up = (o: RelOp) => o === "<" || o === "<=";
    if (up(op1) !== up(op2)) return null;
    const w = new StepWriter(normalize, ch.latex);
    const descending = !up(op1);
    if (descending) {
      [aNode, bNode] = [bNode, aNode];
      [op1, op2] = [FLIP[op2 as IneqOp], FLIP[op1 as IneqOp]];
    }
    let lo = constantValue(aNode);
    let hi = constantValue(bNode);
    const ft = polyTermsOf(fNode, v);
    let f = ft && polyFromTerms(ft, v);
    if (!lo || !hi || !f || deg(f) !== 1) return null;
    const r1 = opLatex(op1);
    const r2 = opLatex(op2);
    const line = (a: Q, mid: string, b: Q) => `${qLatex(a)} ${r1} ${mid} ${r2} ${qLatex(b)}`;
    if (descending) w.write(line(lo, middleTex(f, v), hi));
    // fractions cleared: every part times the LCD
    let lcd = 1;
    for (const c of [lo, hi, ...f]) lcd = (lcd * c.d) / gcdInt(lcd, c.d);
    if (lcd > 1) {
      const k = q(lcd);
      lo = qMul(lo, k);
      hi = qMul(hi, k);
      f = polyScale(f, k);
      w.write(line(lo, middleTex(f, v), hi));
    }
    const [beta, alpha] = [f[0] ?? q(0), f[1]];
    if (!qIsZero(beta)) {
      lo = qSub(lo, beta);
      hi = qSub(hi, beta);
      w.write(line(lo, termsLatex([{ c: alpha, vars: { [v]: 1 } }]), hi));
    }
    let o1 = op1;
    let o2 = op2;
    if (!qEq(alpha, ONE)) {
      if (alpha.n > 0) [lo, hi] = [qDiv(lo, alpha), qDiv(hi, alpha)];
      else {
        // dividing by a negative turns every sign round: written the right way up
        [lo, hi] = [qDiv(hi, alpha), qDiv(lo, alpha)];
        [o1, o2] = [op2, op1];
      }
      w.write(`${qLatex(lo)} ${opLatex(o1)} ${v} ${opLatex(o2)} ${qLatex(hi)}`);
    }
    const gap = qNum(qSub(hi, lo));
    if (gap < 0 || (gap === 0 && (strict(o1 as IneqOp) || strict(o2 as IneqOp)))) w.write(NO_SOLUTION);
    else if (gap === 0) w.write(`${v} = ${qLatex(lo)}`);
    const steps = w.lines();
    if (steps.length === 0) return null;
    return { steps, final: steps[steps.length - 1], roots: null };
  });
}

