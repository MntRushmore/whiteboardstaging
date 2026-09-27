/**
 * Complex numbers (N-CN.1–2, N-CN.7), exact, in the lines a teacher writes:
 *
 *   (2 + 3i)(1 - i)             i^{23}                        \frac{2 + 3i}{1 - i}
 *   = 2 - 2i + 3i - 3i^{2}      = (i^{4})^{5} \cdot i^{3}     = \frac{(2 + 3i)(1 + i)}{(1 - i)(1 + i)}
 *   = 2 - 2i + 3i + 3           = i^{3}                       = \frac{2 + 2i + 3i + 3i^{2}}{1 - i^{2}}
 *   = 5 + i                     = -i                          = \frac{-1 + 5i}{2}
 *                                                             = -\frac{1}{2} + \frac{5}{2}i
 *
 * Sums, products (FOIL, `i^{2} = -1` applied as its own line), quotients by the conjugate,
 * powers of `i` by fours, `\sqrt{-16}` as `\sqrt{16} \cdot i`, and `|3 + 4i|`. And a quadratic's
 * COMPLEX roots, only when the caller allows them (`complexSetting.ts`): the formula, the negative
 * under the root written with `i`, the answer `x = -1 \pm 2i`. Exact rationals throughout;
 * every line is checked numerically (as complex values) against the question.
 */
import type { MathNode } from "mathjs";
import { q, qAdd, qDiv, qMul, qNeg, type Q } from "./algebra";
import { chainAgrees, closeC, parseExpr, splitEquation, type CourseDeps } from "./courseKit";
import { argsOf, fnOf, polyOf, stripParens } from "./nodes";
import { exactly, qIsZero, polySub } from "./poly";
import { StepWriter } from "./solution";

type AnyNode = MathNode & { value?: unknown; name?: string };

/** a + bi with exact rational parts */
interface G {
  re: Q;
  im: Q;
}

class NotComplex extends Error {}

const Z = q(0);
const g = (re: Q, im: Q = Z): G => ({ re, im });
const gAdd = (a: G, b: G): G => g(qAdd(a.re, b.re), qAdd(a.im, b.im));
const gNeg = (a: G): G => g(qNeg(a.re), qNeg(a.im));
const gMul = (a: G, b: G): G => g(qAdd(qMul(a.re, b.re), qNeg(qMul(a.im, b.im))), qAdd(qMul(a.re, b.im), qMul(a.im, b.re)));
const gConj = (a: G): G => g(a.re, qNeg(a.im));
function gDiv(a: G, b: G): G {
  const d = qAdd(qMul(b.re, b.re), qMul(b.im, b.im));
  if (qIsZero(d)) throw new NotComplex();
  const n = gMul(a, gConj(b));
  return g(qDiv(n.re, d), qDiv(n.im, d));
}

const qTex = (a: Q): string => (a.d === 1 ? String(a.n) : `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`);
const isOne = (a: Q) => a.n === 1 && a.d === 1;

/** `5 + i`, `-i`, `2i`, `3`, `-\frac{1}{2} + \frac{5}{2}i`. */
export function gTex(a: G): string {
  const imMag: Q = { n: Math.abs(a.im.n), d: a.im.d };
  const imBody = isOne(imMag) ? "i" : `${qTex(imMag)}i`;
  if (qIsZero(a.im)) return qTex(a.re);
  if (qIsZero(a.re)) return `${a.im.n < 0 ? "-" : ""}${imBody}`;
  return `${qTex(a.re)} ${a.im.n < 0 ? "-" : "+"} ${imBody}`;
}

// ---------------------------------------------------------------- reading

function isI(node: MathNode): boolean {
  const n = stripParens(node) as AnyNode;
  return n.type === "SymbolNode" && n.name === "i";
}

function intOf(node: MathNode): number | null {
  const n = stripParens(node) as AnyNode;
  if (n.type === "ConstantNode" && typeof n.value === "number" && Number.isInteger(n.value)) return n.value;
  if (n.type === "OperatorNode" && fnOf(n) === "unaryMinus") {
    const v = intOf(argsOf(n)[0]);
    return v === null ? null : -v;
  }
  return null;
}

/** `\sqrt{-16}` → 4 (the root of the positive part), or null when it is not a perfect square. */
function negativeRoot(node: MathNode): number | null {
  const n = stripParens(node);
  if (n.type !== "FunctionNode" || fnOf(n) !== "sqrt") return null;
  const v = intOf(argsOf(n)[0]);
  if (v === null || v >= 0) return null;
  const r = Math.round(Math.sqrt(-v));
  return r * r === -v ? r : null;
}

/** The exact value of a tree of numbers, `i`, + - × ÷, whole powers and `\sqrt{-n²}`. */
function valueOf(node: MathNode): G {
  const n = stripParens(node) as AnyNode;
  if (n.type === "ConstantNode") {
    if (typeof n.value !== "number" || !Number.isInteger(n.value)) throw new NotComplex();
    return g(q(n.value));
  }
  if (isI(n)) return g(Z, q(1));
  const nr = negativeRoot(n);
  if (nr !== null) return g(Z, q(nr));
  const f = fnOf(n);
  const a = argsOf(n);
  if (n.type === "OperatorNode") {
    if (f === "add") return gAdd(valueOf(a[0]), valueOf(a[1]));
    if (f === "subtract") return gAdd(valueOf(a[0]), gNeg(valueOf(a[1])));
    if (f === "unaryMinus") return gNeg(valueOf(a[0]));
    if (f === "multiply") return gMul(valueOf(a[0]), valueOf(a[1]));
    if (f === "divide") return gDiv(valueOf(a[0]), valueOf(a[1]));
    if (f === "pow") {
      const k = intOf(a[1]);
      if (k === null || Math.abs(k) > 64) throw new NotComplex();
      let out = g(q(1));
      const b = valueOf(a[0]);
      for (let j = 0; j < Math.abs(k); j++) out = gMul(out, b);
      return k < 0 ? gDiv(g(q(1)), out) : out;
    }
  }
  throw new NotComplex();
}

function mentionsI(node: MathNode): boolean {
  let found = false;
  node.traverse((x: MathNode) => {
    if (isI(x) || negativeRoot(x) !== null) found = true;
  });
  return found;
}

function summands(node: MathNode, sign = 1): Array<{ sign: number; node: MathNode }> {
  const n = stripParens(node);
  const f = fnOf(n);
  const a = argsOf(n);
  if (n.type === "OperatorNode" && f === "add") return [...summands(a[0], sign), ...summands(a[1], sign)];
  if (n.type === "OperatorNode" && f === "subtract") return [...summands(a[0], sign), ...summands(a[1], -sign)];
  return [{ sign, node: n }];
}

/** A complex operand as its real and imaginary terms, in the order written (`2 + 3i` → [2, 3i]). */
function termsOfOperand(node: MathNode): G[] {
  return summands(node).map((s) => {
    const v = valueOf(s.node);
    if (!qIsZero(v.re) && !qIsZero(v.im)) throw new NotComplex();
    return s.sign < 0 ? gNeg(v) : v;
  });
}

/** One real or imaginary term inside a longer line: `2`, `- 3i`, `+ i^{2}` style handled by the caller. */
function termBody(t: G, i2 = false): { neg: boolean; body: string } {
  const r = qIsZero(t.im) ? t.re : t.im;
  const neg = r.n < 0;
  const mag: Q = { n: Math.abs(r.n), d: r.d };
  if (qIsZero(t.im)) return { neg, body: qTex(mag) };
  const unit = i2 ? "i^{2}" : "i";
  return { neg, body: isOne(mag) ? unit : `${qTex(mag)}${unit}` };
}

function joinTerms(parts: ReadonlyArray<{ neg: boolean; body: string }>): string {
  return parts.map((p, k) => (k === 0 ? `${p.neg ? "-" : ""}${p.body}` : ` ${p.neg ? "-" : "+"} ${p.body}`)).join("");
}

/** `(2 + 3i)`: a sum in a bracket, a single term bare. */
const operandTex = (ts: readonly G[]): string => (ts.length > 1 ? `(${joinTerms(ts.map((t) => termBody(t)))})` : joinTerms(ts.map((t) => termBody(t))));

// ---------------------------------------------------------------- products and quotients

/** FOIL of two operands: every product, with `i \cdot i` written `i^{2}`. */
function foil(x: readonly G[], y: readonly G[]): { withSquares: string; applied: string; value: G } {
  const withSquares: Array<{ neg: boolean; body: string }> = [];
  const applied: Array<{ neg: boolean; body: string }> = [];
  let value = g(Z);
  for (const s of x) {
    for (const t of y) {
      const bothI = !qIsZero(s.im) && !qIsZero(t.im);
      const p = gMul(s, t);
      value = gAdd(value, p);
      if (bothI) {
        // (bi)(di) = bd i^{2} = -bd
        const coef = qMul(s.im, t.im);
        withSquares.push(termBody(g(Z, coef), true));
        applied.push(termBody(g(qNeg(coef))));
      } else {
        withSquares.push(termBody(p));
        applied.push(termBody(p));
      }
    }
  }
  return { withSquares: joinTerms(withSquares), applied: joinTerms(applied), value };
}

/**
 * The steps for a line with `i` in it, or null: a letter, a shape not handled, a non-exact
 * value, or a line that fails its check.
 */
export function complexSteps(deps: CourseDeps, node: MathNode, input: string): string[] | null {
  try {
    return exactly(() => {
      if (!mentionsI(node)) return null;
      const n = stripParens(node);
      const f = fnOf(n);
      const a = argsOf(n);
      const w = new StepWriter(deps.normalize, input);
      const total = n.type === "FunctionNode" && f === "abs" ? g(Z) : valueOf(n);
      // `\sqrt{-16}` alone: `\sqrt{16} \cdot i` first
      const alone = negativeRoot(n);
      if (alone !== null) {
        const inner = intOf(argsOf(n)[0])!;
        w.write(`\\sqrt{${-inner}} \\cdot i`);
      }
      // `\sqrt{-16}` written with i first, wherever it is
      if (hasNegativeRoot(n)) {
        const withI = rewriteRoots(input);
        if (withI && withI !== input) w.write(withI);
      }
      if (n.type === "OperatorNode" && f === "pow" && isI(a[0])) {
        const k = intOf(a[1]);
        if (k === null || k < 2) return null;
        const r = k % 4;
        const fours = Math.floor(k / 4);
        if (fours > 0) {
          w.write(`${fours === 1 ? "i^{4}" : `(i^{4})^{${fours}}`}${r === 0 ? "" : ` \\cdot ${r === 1 ? "i" : `i^{${r}}`}`}`);
          if (r > 1) w.write(`i^{${r}}`);
        } else if (r === 3) w.write("i^{2} \\cdot i");
      } else if (n.type === "OperatorNode" && f === "pow" && intOf(a[1]) === 2) {
        const t = termsOfOperand(a[0]);
        const p = foil(t, t);
        w.write(p.withSquares);
        w.write(p.applied);
      } else if (n.type === "OperatorNode" && f === "multiply" && a.length === 2) {
        const x = termsOfOperand(a[0]);
        const y = termsOfOperand(a[1]);
        const p = foil(x, y);
        if (x.length > 1 || y.length > 1) {
          w.write(p.withSquares);
          w.write(p.applied);
        } else w.write(p.withSquares);
      } else if (n.type === "OperatorNode" && f === "divide" && a.length === 2) {
        const top = termsOfOperand(a[0]);
        const bottom = termsOfOperand(a[1]);
        const B = bottom.reduce((s, t) => gAdd(s, t), g(Z));
        if (qIsZero(B.im)) {
          // a real bottom: each part divided
        } else if (qIsZero(B.re)) {
          // `\frac{5}{2i}`: times i over i
          const topTex = operandTex(top);
          const bottomTex = operandTex(bottom);
          w.write(`\\frac{${topTex} \\cdot i}{${bottomTex} \\cdot i}`);
          const newTop = top.reduce((s, t) => gAdd(s, gMul(t, g(Z, q(1)))), g(Z));
          w.write(`\\frac{${gTex(newTop)}}{${qTex(B.im)}i^{2}}`.replace(/\{1i\^/, "{i^").replace(/\{-1i\^/, "{-i^"));
          w.write(`\\frac{${gTex(newTop)}}{${qTex(qNeg(B.im))}}`);
        } else {
          const conj = gConj(B);
          const conjTex = `(${gTex(conj)})`;
          w.write(`\\frac{${operandTex(top)}${conjTex}}{(${gTex(B)})${conjTex}}`);
          const conjTerms = [g(conj.re), g(Z, conj.im)];
          const p = foil(top, conjTerms);
          const reSq = qMul(B.re, B.re);
          const imSq = qMul(B.im, B.im);
          w.write(`\\frac{${p.withSquares}}{${qTex(reSq)} - ${isOne(imSq) ? "" : qTex(imSq)}i^{2}}`);
          w.write(`\\frac{${gTex(p.value)}}{${qTex(qAdd(reSq, imSq))}}`);
        }
      } else if (n.type === "FunctionNode" && f === "abs") {
        const v = valueOf(a[0]);
        const sq = (x: Q) => (x.n < 0 ? `(${qTex(x)})^{2}` : `${qTex(x)}^{2}`);
        w.write(`\\sqrt{${sq(v.re)} + ${sq(v.im)}}`);
        const s = qAdd(qMul(v.re, v.re), qMul(v.im, v.im));
        w.write(`\\sqrt{${qTex(s)}}`);
        const r = s.d === 1 ? Math.round(Math.sqrt(s.n)) : -1;
        if (r * r !== s.n) return null;
        w.write(String(r));
        return check(deps, input, w.lines());
      } else if (n.type === "OperatorNode" && (f === "add" || f === "subtract")) {
        // brackets off, the real parts together, then the imaginary parts
        const parts = summands(n).flatMap((s) => {
          const inner = stripParens(s.node);
          const ts = fnOf(inner) === "add" || fnOf(inner) === "subtract" ? termsOfOperand(inner) : [valueOf(inner)];
          return ts.map((t) => (s.sign < 0 ? gNeg(t) : t));
        });
        if (parts.some((t) => !qIsZero(t.re) && !qIsZero(t.im))) return null;
        const reals = parts.filter((t) => qIsZero(t.im));
        const imags = parts.filter((t) => !qIsZero(t.im));
        w.write(joinTerms([...reals, ...imags].map((t) => termBody(t))));
      } else if (!hasNegativeRoot(n)) return null;
      w.write(gTex(total));
      return check(deps, input, w.lines());
    });
  } catch {
    return null;
  }
}

function check(deps: CourseDeps, input: string, lines: string[]): string[] | null {
  if (lines.length === 0) return null;
  return chainAgrees(deps, input, lines, { complex: true }) ? lines : null;
}

function hasNegativeRoot(node: MathNode): boolean {
  let found = false;
  node.traverse((x: MathNode) => {
    if (negativeRoot(x) !== null) found = true;
  });
  return found;
}

/** `\sqrt{-16}` → `4i` in the LaTeX (`\sqrt{-9} \cdot \sqrt{-4}` → `3i \cdot 2i`). */
function rewriteRoots(latex: string): string | null {
  let bad = false;
  const out = latex.replace(/\\sqrt\s*\{\s*-\s*(\d+)\s*\}/g, (_m, digits: string) => {
    const v = Number(digits);
    const r = Math.round(Math.sqrt(v));
    if (r * r !== v) bad = true;
    return r === 1 ? "i" : `${r}i`;
  });
  return bad ? null : out;
}

// ---------------------------------------------------------------- complex roots of a quadratic

/**
 * `ax^{2} + bx + c = 0` with no real roots, answered with complex ones: the formula, the negative
 * under the root written with i, the pair `x = p \pm qi`. Null when the line is not a quadratic
 * with a negative discriminant (the real paths answer it) or the roots fail their check.
 */
export function complexQuadratic(deps: CourseDeps, latex: string): { latex: string; steps: string[] } | null {
  try {
    return exactly(() => {
      const sides = splitEquation(latex);
      if (!sides) return null;
      const L = parseExpr(deps, sides[0]);
      const R = parseExpr(deps, sides[1]);
      if (!L || !R) return null;
      const letters = new Set<string>();
      for (const s of [L, R])
        s.traverse((x: MathNode) => {
          if (x.type === "SymbolNode" && !["e", "pi", "i"].includes((x as AnyNode).name ?? "")) letters.add((x as AnyNode).name ?? "");
        });
      if (letters.size !== 1) return null;
      const v = [...letters][0];
      const lp = polyOf(L, v);
      const rp = polyOf(R, v);
      if (!lp || !rp) return null;
      let P = polySub(lp, rp);
      if (P.length !== 3) return null;
      if (P[2].n < 0) P = P.map(qNeg);
      const [c, b, a] = P;
      const disc = qAdd(qMul(b, b), qNeg(qMul(q(4), qMul(a, c))));
      if (disc.n >= 0) return null;
      if (a.d !== 1 || b.d !== 1 || c.d !== 1) return null;
      const w = new StepWriter(deps.normalize, latex);
      // standard form first (a pure square `x^{2} = -9` is already where it needs to be)
      if (!qIsZero(b)) w.write(`${polyTex(P, v)} = 0`);
      const D = -disc.n;
      const k = extractSquare(D);
      // √(-D) = k √m i
      const rootI = k.m === 1 ? `${k.k === 1 ? "" : k.k}i` : `${k.k === 1 ? "" : k.k}i\\sqrt{${k.m}}`;
      let pair: string;
      if (qIsZero(b)) {
        // `x^{2} = -9`: the square root of a negative
        const rhs = qDiv(qNeg(c), a);
        w.write(`${v}^{2} = ${qTex(rhs)}`);
        w.write(`${v} = \\pm\\sqrt{${qTex(rhs)}}`);
        const inner = qNeg(rhs);
        const top = extractSquare(inner.n * inner.d);
        const coef = qDiv(q(top.k), q(inner.d));
        const coefTex = isOne(coef) ? "" : coef.d === 1 ? String(coef.n) : qTex(coef);
        pair = top.m === 1 ? `${v} = \\pm ${coefTex}i` : `${v} = \\pm ${coefTex}i\\sqrt{${top.m}}`;
      } else {
        const paren = (x: Q) => (x.n < 0 ? `(${qTex(x)})` : qTex(x));
        w.write(`${v} = \\frac{${qTex(qNeg(b))} \\pm \\sqrt{${paren(b)}^{2} - 4 \\cdot ${paren(a)} \\cdot ${paren(c)}}}{2 \\cdot ${paren(a)}}`);
        w.write(`${v} = \\frac{${qTex(qNeg(b))} \\pm \\sqrt{${qTex(disc)}}}{${qTex(qMul(q(2), a))}}`);
        w.write(`${v} = \\frac{${qTex(qNeg(b))} \\pm ${rootI}}{${qTex(qMul(q(2), a))}}`);
        // divide through when every part shares the bottom
        const d = 2 * a.n;
        const g1 = gcd(gcd(Math.abs(b.n), k.k), d);
        const p = -b.n / g1;
        const kk = k.k / g1;
        const dd = d / g1;
        const imTex = `${kk === 1 ? "" : kk}i${k.m === 1 ? "" : `\\sqrt{${k.m}}`}`;
        pair = dd === 1 ? `${v} = ${p} \\pm ${imTex}` : `${v} = \\frac{${p} \\pm ${imTex}}{${dd}}`;
      }
      w.write(pair);
      const steps = w.lines();
      // the check: both roots make the line zero
      const re = qNum(qDiv(qNeg(b), qMul(q(2), a)));
      const im = Math.sqrt(D) / (2 * qNum(a));
      for (const s of [1, -1]) {
        const x = { re, im: s * im };
        const x2 = { re: x.re * x.re - x.im * x.im, im: 2 * x.re * x.im };
        const val = { re: qNum(a) * x2.re + qNum(b) * x.re + qNum(c), im: qNum(a) * x2.im + qNum(b) * x.im };
        if (!closeC(val, { re: 0, im: 0 }, 1e-9)) return null;
      }
      return { latex: pair, steps };
    });
  } catch {
    return null;
  }
}

const qNum = (a: Q): number => a.n / a.d;

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function extractSquare(n: number): { k: number; m: number } {
  let k = 1;
  let m = n;
  for (let i = 2; i * i <= m; i++) {
    while (m % (i * i) === 0) {
      m /= i * i;
      k *= i;
    }
  }
  return { k, m };
}

function polyTex(P: readonly Q[], v: string): string {
  let out = "";
  for (let d = P.length - 1; d >= 0; d--) {
    const c = P[d];
    if (qIsZero(c)) continue;
    const mag: Q = { n: Math.abs(c.n), d: c.d };
    const coef = d > 0 && isOne(mag) ? "" : qTex(mag);
    const body = d === 0 ? coef : d === 1 ? `${coef}${v}` : `${coef}${v}^{${d}}`;
    out = !out ? `${c.n < 0 ? "-" : ""}${body}` : `${out} ${c.n < 0 ? "-" : "+"} ${body}`;
  }
  return out || "0";
}
