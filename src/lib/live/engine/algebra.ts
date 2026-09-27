/**
 * Teacher-style algebra steps: the lines a teacher writes on the board, never words.
 *
 *   3(x + 2) = 21        \frac{x}{2} + 3 = 7      5x - 3 = 2x + 9      3(x + 2) - x
 *   3x + 6 = 21          x + 6 = 14               5x - 2x = 9 + 3      = 3x + 6 - x
 *   3x = 15              x = 8                    3x = 12              = 2x + 6
 *   x = 5                                         x = 4
 *
 * Expressions are read from the mathjs tree into a list of terms (exact rational coefficient ×
 * monomial) WITHOUT collecting like terms, so the expanded line is the one a student writes
 * (`3x + 6 - x`, not `2x + 6`); like terms are collected as a separate, visible step. Anything
 * outside that — a decimal, a function, a variable in a denominator, a huge number — is `null`,
 * and the caller keeps its older path. Pure: no mathjs import at runtime.
 */
import type { MathNode } from "mathjs";

// --- exact rationals ---------------------------------------------------------

export interface Q {
  n: number;
  d: number;
}

const LIMIT = 1e12;

export class NotAlgebra extends Error {}

function fail(): never {
  throw new NotAlgebra();
}

export function gcdInt(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

export function q(n: number, d = 1): Q {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) fail();
  if (Math.abs(n) > LIMIT || Math.abs(d) > LIMIT) fail();
  const g = gcdInt(n, d);
  const sign = d < 0 ? -1 : 1;
  const out = { n: (sign * n) / g, d: (sign * d) / g };
  if (Object.is(out.n, -0)) out.n = 0;
  return out;
}

export const qAdd = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const qMul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
export const qDiv = (a: Q, b: Q): Q => (b.n === 0 ? fail() : q(a.n * b.d, a.d * b.n));
export const qNeg = (a: Q): Q => q(-a.n, a.d);
const qZero = (a: Q): boolean => a.n === 0;
const qOne = (a: Q): boolean => a.n === 1 && a.d === 1;

/** `3`, `-\frac{7}{3}` — always exact. */
export function qLatex(a: Q): string {
  if (a.d === 1) return String(a.n);
  return `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`;
}

// --- terms -------------------------------------------------------------------

export interface Term {
  c: Q;
  /** variable → power (> 0) */
  vars: Record<string, number>;
}

function monoKey(vars: Record<string, number>): string {
  return Object.keys(vars)
    .sort()
    .map((v) => `${v}^${vars[v]}`)
    .join("*");
}

function degreeOf(t: Term): number {
  return Object.values(t.vars).reduce((a, b) => a + b, 0);
}

function mulTerm(a: Term, b: Term): Term {
  const vars = { ...a.vars };
  for (const [v, p] of Object.entries(b.vars)) vars[v] = (vars[v] ?? 0) + p;
  return { c: qMul(a.c, b.c), vars };
}

function mulTerms(a: Term[], b: Term[]): Term[] {
  const out: Term[] = [];
  for (const x of a) for (const y of b) out.push(mulTerm(x, y));
  return out;
}

/** Like terms merged (first appearance order), zero terms dropped. */
export function combineTerms(terms: readonly Term[]): Term[] {
  const order: string[] = [];
  const byKey = new Map<string, Term>();
  for (const t of terms) {
    const k = monoKey(t.vars);
    const seen = byKey.get(k);
    if (seen) byKey.set(k, { c: qAdd(seen.c, t.c), vars: seen.vars });
    else {
      order.push(k);
      byKey.set(k, { c: t.c, vars: { ...t.vars } });
    }
  }
  return order.map((k) => byKey.get(k)!).filter((t) => !qZero(t.c));
}

/** A single number, when every term is a constant. */
function constantOf(terms: readonly Term[]): Q | null {
  let sum = q(0);
  for (const t of terms) {
    if (Object.keys(t.vars).length > 0) return null;
    sum = qAdd(sum, t.c);
  }
  return sum;
}

type AnyNode = MathNode & {
  type: string;
  fn?: string | { name?: string };
  op?: string;
  args?: MathNode[];
  content?: MathNode;
  value?: unknown;
  name?: string;
};

function walk(node: MathNode, unknowns: ReadonlySet<string>): Term[] {
  const n = node as AnyNode;
  switch (n.type) {
    case "ConstantNode": {
      const v = n.value;
      if (typeof v !== "number" || !Number.isInteger(v)) fail();
      return [{ c: q(v as number), vars: {} }];
    }
    case "SymbolNode": {
      const name = n.name ?? "";
      if (!unknowns.has(name)) fail();
      return [{ c: q(1), vars: { [name]: 1 } }];
    }
    case "ParenthesisNode":
      return walk(n.content!, unknowns);
    case "OperatorNode": {
      const fn = typeof n.fn === "string" ? n.fn : n.fn?.name;
      const args = n.args ?? [];
      switch (fn) {
        case "add":
          return [...walk(args[0], unknowns), ...walk(args[1], unknowns)];
        case "subtract":
          return [...walk(args[0], unknowns), ...walk(args[1], unknowns).map((t) => ({ c: qNeg(t.c), vars: t.vars }))];
        case "unaryMinus":
          return walk(args[0], unknowns).map((t) => ({ c: qNeg(t.c), vars: t.vars }));
        case "unaryPlus":
          return walk(args[0], unknowns);
        case "multiply":
          return mulTerms(walk(args[0], unknowns), walk(args[1], unknowns));
        case "divide": {
          const den = constantOf(walk(args[1], unknowns));
          if (!den || qZero(den)) fail();
          return walk(args[0], unknowns).map((t) => ({ c: qDiv(t.c, den), vars: t.vars }));
        }
        case "pow": {
          const exp = constantOf(walk(args[1], unknowns));
          if (!exp || exp.d !== 1 || exp.n < 0 || exp.n > 6) fail();
          const base = walk(args[0], unknowns);
          let out: Term[] = [{ c: q(1), vars: {} }];
          for (let i = 0; i < exp.n; i++) out = combineTerms(mulTerms(out, base));
          return out.length > 0 ? out : [{ c: q(0), vars: {} }];
        }
        default:
          return fail();
      }
    }
    default:
      return fail();
  }
}

/** The terms of an expression, uncollected, or null when it is not a polynomial with exact coefficients. */
export function termsOf(node: MathNode, unknowns: readonly string[]): Term[] | null {
  try {
    return walk(node, new Set(unknowns));
  } catch (e) {
    if (e instanceof NotAlgebra) return null;
    throw e;
  }
}

// --- LaTeX ---------------------------------------------------------------------

function monoLatex(vars: Record<string, number>): string {
  return Object.keys(vars)
    .sort()
    .map((v) => (vars[v] === 1 ? v : `${v}^{${vars[v]}}`))
    .join("");
}

function termBody(t: Term): string {
  const mono = monoLatex(t.vars);
  const mag = { n: Math.abs(t.c.n), d: t.c.d };
  if (!mono) return qLatex(mag);
  if (qOne(mag)) return mono;
  return `${qLatex(mag)}${mono}`;
}

/** `3x + 6 - x`; `0` for no terms. */
export function termsLatex(terms: readonly Term[]): string {
  let out = "";
  for (const t of terms) {
    const neg = t.c.n < 0;
    const body = termBody(t);
    if (!out) out = neg ? `-${body}` : body;
    else out += ` ${neg ? "-" : "+"} ${body}`;
  }
  return out || "0";
}

/**
 * Collected terms in the order a student writes them: highest power first, the number last —
 * except `18 - x` (a lone negative unknown term before a positive number reads better first).
 */
export function standardOrder(terms: readonly Term[]): Term[] {
  const sorted = [...terms].sort((a, b) => degreeOf(b) - degreeOf(a));
  if (sorted.length === 2 && degreeOf(sorted[1]) === 0 && sorted[0].c.n < 0 && sorted[1].c.n > 0) return [sorted[1], sorted[0]];
  return sorted;
}

// --- relations -----------------------------------------------------------------

export type RelOp = "==" | "<" | ">" | "<=" | ">=";

const OP_LATEX: Record<RelOp, string> = { "==": "=", "<": "<", ">": ">", "<=": "\\le", ">=": "\\ge" };
const FLIP: Record<RelOp, RelOp> = { "==": "==", "<": ">", ">": "<", "<=": ">=", ">=": "<=" };

export function opLatex(op: RelOp): string {
  return OP_LATEX[op];
}

export interface LinearSteps {
  steps: string[];
  /** the last line: `x = 4`, `x > -3`, or `0 = 0` / `0 = 2` when the unknown cancelled */
  final: string;
  outcome: "solved" | "identity" | "contradiction";
}

function holds(op: RelOp, lhs: number, rhs: number): boolean {
  switch (op) {
    case "==":
      return lhs === rhs;
    case "<":
      return lhs < rhs;
    case ">":
      return lhs > rhs;
    case "<=":
      return lhs <= rhs;
    case ">=":
      return lhs >= rhs;
  }
}

/** A line has something to expand: brackets (`3(x+2)`, `\left(`) as the student wrote them. */
export function hasBracket(latex: string): boolean {
  return /\(/.test(latex);
}

/**
 * The steps for a linear equation or inequality in one unknown, the way a teacher writes them:
 *
 *   1. brackets expanded / fractions cleared by the LCD (only when the line had either),
 *   2. like terms collected on each side (only when there were any),
 *   3. unknown on both sides → unknowns moved left, numbers right (`5x - 2x = 9 + 3`),
 *   4. `ax = b`, then 5. `x = b/a` exact — dividing (or multiplying) by a negative flips `<`.
 *
 * A line identical (normalized) to the one before it, or to the input, is not written again.
 * Null when either side is not linear in `variable` with exact coefficients.
 */
export function linearSolveSteps(
  lhs: MathNode,
  rhs: MathNode,
  op: RelOp,
  variable: string,
  inputLatex: string,
  normalize: (latex: string) => string,
): LinearSteps | null {
  let L = termsOf(lhs, [variable]);
  let R = termsOf(rhs, [variable]);
  if (!L || !R) return null;
  try {
    const isX = (t: Term) => t.vars[variable] === 1 && Object.keys(t.vars).length === 1;
    const isC = (t: Term) => Object.keys(t.vars).length === 0;
    if (![...L, ...R].every((t) => isX(t) || isC(t))) return null;

    // unknowns on the left: `12 = 3x + 3` is solved as `3x + 3 = 12`
    const xIn = (ts: Term[]) => combineTerms(ts).some(isX);
    if (!xIn(L) && xIn(R)) {
      [L, R] = [R, L];
      op = FLIP[op];
    }

    // clear fractions: multiply every term by the LCD of the coefficients
    let lcd = 1;
    for (const t of [...L, ...R]) lcd = (lcd * t.c.d) / gcdInt(lcd, t.c.d);
    if (lcd > 1) {
      const k = q(lcd);
      L = L.map((t) => ({ c: qMul(t.c, k), vars: t.vars }));
      R = R.map((t) => ({ c: qMul(t.c, k), vars: t.vars }));
    }

    const rel = opLatex(op);
    const steps: string[] = [];
    const seen = new Set<string>([normalize(inputLatex)]);
    const write = (line: string) => {
      const key = normalize(line);
      if (seen.has(key)) return;
      seen.add(key);
      steps.push(line);
    };

    if (hasBracket(inputLatex) || lcd > 1) write(`${termsLatex(L)} ${rel} ${termsLatex(R)}`);

    const Lc = combineTerms(L);
    const Rc = combineTerms(R);
    const coef = (ts: Term[], pick: (t: Term) => boolean) => ts.filter(pick).reduce((s, t) => qAdd(s, t.c), q(0));
    const aL = coef(Lc, isX);
    const aR = coef(Rc, isX);
    const cL = coef(Lc, isC);
    const cR = coef(Rc, isC);
    const a = qAdd(aL, qNeg(aR));
    const b = qAdd(cR, qNeg(cL));

    const xTerm = (c: Q): Term => ({ c, vars: { [variable]: 1 } });
    const cTerm = (c: Q): Term => ({ c, vars: {} });
    // unknowns left, numbers right: `5x - 2x = 9 + 3` (`3x - 3x = -2 - 7` when they cancel)
    const moveAcross = () => {
      if (qZero(aL) || qZero(aR)) return;
      const left = [xTerm(aL), xTerm(qNeg(aR))];
      const right = [cTerm(cR), cTerm(qNeg(cL))].filter((t) => !qZero(t.c));
      write(`${termsLatex(left)} ${rel} ${termsLatex(right)}`);
    };

    if (qZero(a)) {
      // the unknown cancelled: `0 = 0` (every value works) or `0 = 2` (none does)
      moveAcross();
      const final = `0 ${rel} ${qLatex(b)}`;
      write(final);
      return { steps, final, outcome: holds(op, 0, b.n / b.d) ? "identity" : "contradiction" };
    }

    const collected = Lc.length < L.length || Rc.length < R.length;
    if (collected) write(`${termsLatex(standardOrder(Lc))} ${rel} ${termsLatex(standardOrder(Rc))}`);

    moveAcross();

    const axb = `${termsLatex([xTerm(a)])} ${rel} ${qLatex(b)}`;
    write(axb);
    let final = axb;
    if (!qOne(a)) {
      const solvedOp = a.n < 0 ? FLIP[op] : op;
      final = `${variable} ${opLatex(solvedOp)} ${qLatex(qDiv(b, a))}`;
      write(final);
    }
    return { steps, final, outcome: "solved" };
  } catch (e) {
    if (e instanceof NotAlgebra) return null;
    throw e;
  }
}

/**
 * Simplifying an expression the way a teacher writes it: brackets expanded (when there were
 * any), then like terms collected. Null when there is nothing to do or it is not a polynomial.
 */
export function simplifyExpressionSteps(node: MathNode, unknowns: readonly string[], inputLatex: string, normalize: (latex: string) => string): string[] | null {
  const terms = termsOf(node, unknowns);
  if (!terms || terms.length === 0) return null;
  try {
    const collected = standardOrder(combineTerms(terms));
    const bracket = hasBracket(inputLatex);
    if (!bracket && collected.length === terms.length) return null; // nothing to expand or collect
    const steps: string[] = [];
    const seen = new Set<string>([normalize(inputLatex)]);
    const write = (line: string) => {
      const key = normalize(line);
      if (seen.has(key)) return;
      seen.add(key);
      steps.push(line);
    };
    if (bracket) write(termsLatex(terms));
    write(termsLatex(collected));
    return steps.length > 0 ? steps : null;
  } catch (e) {
    if (e instanceof NotAlgebra) return null;
    throw e;
  }
}
