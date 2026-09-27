/**
 * Radicals and rational exponents (N-RN.1–2, A-SSE.2), exact, the way a teacher simplifies:
 *
 *   \sqrt{50}            \sqrt{12} + \sqrt{27}           \frac{1}{\sqrt{2}}                     8^{\frac{2}{3}}
 *   = \sqrt{25 \cdot 2}  = \sqrt{4 \cdot 3} + \sqrt{9 \cdot 3}   = \frac{1 \cdot \sqrt{2}}{\sqrt{2} \cdot \sqrt{2}}   = (\sqrt[3]{8})^{2}
 *   = 5\sqrt{2}          = 2\sqrt{3} + 3\sqrt{3}         = \frac{\sqrt{2}}{2}                   = 2^{2}
 *                        = 5\sqrt{3}                                                           = 4
 *
 *   \frac{3}{2 + \sqrt{3}}
 *   = \frac{3(2 - \sqrt{3})}{(2 + \sqrt{3})(2 - \sqrt{3})}
 *   = \frac{6 - 3\sqrt{3}}{4 - 3}
 *   = 6 - 3\sqrt{3}
 *
 * Numbers only (a letter under a root needs |x| — not written). A value is a sum of rational
 * multiples of square-free square roots (`Surd`); cube and fourth roots are taken one at a time.
 * Every line is checked numerically against the question.
 */
import type { MathNode } from "mathjs";
import { gcdInt, q, qAdd, qDiv, qMul, qNeg, type Q } from "./algebra";
import { chainAgrees, type CourseDeps } from "./courseKit";
import { argsOf, fnOf, stripParens } from "./nodes";
import { exactly, qIsZero, qPow } from "./poly";
import { StepWriter } from "./solution";

type AnyNode = MathNode & { value?: unknown; name?: string };

/** Σ coefficient · √radicand, radicands square-free (1 is the rational part). */
type Surd = Map<number, Q>;

class NotRadical extends Error {}

const isOne = (a: Q) => a.n === 1 && a.d === 1;
const qTex = (a: Q): string => (a.d === 1 ? String(a.n) : `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`);

/** n = k^index · m with m free of index-th powers. */
function extract(n: number, index: number): { k: number; m: number } {
  if (!Number.isInteger(n) || n < 0 || n > 1e9) throw new NotRadical();
  if (n === 0) return { k: 0, m: 1 };
  let k = 1;
  let m = n;
  for (let i = 2; i ** index <= m; i++) {
    while (m % i ** index === 0) {
      m /= i ** index;
      k *= i;
    }
  }
  return { k, m };
}

function surdAdd(a: Surd, b: Surd): Surd {
  const out = new Map(a);
  for (const [m, c] of b) out.set(m, qAdd(out.get(m) ?? q(0), c));
  for (const [m, c] of out) if (qIsZero(c)) out.delete(m);
  return out;
}

function surdScale(a: Surd, k: Q): Surd {
  const out: Surd = new Map();
  for (const [m, c] of a) if (!qIsZero(qMul(c, k))) out.set(m, qMul(c, k));
  return out;
}

function surdMul(a: Surd, b: Surd): Surd {
  let out: Surd = new Map();
  for (const [m1, c1] of a) {
    for (const [m2, c2] of b) {
      const { k, m } = extract(m1 * m2, 2);
      out = surdAdd(out, new Map([[m, qMul(qMul(c1, c2), q(k))]]));
    }
  }
  return out;
}

const rational = (x: Q): Surd => (qIsZero(x) ? new Map() : new Map([[1, x]]));

/** `5\sqrt{3}`, `-\sqrt{2}`, `\frac{\sqrt{2}}{2}`, `6 - 3\sqrt{3}`, `\frac{2 + \sqrt{2}}{2}`. */
export function surdTex(s: Surd): string {
  const entries = [...s.entries()].sort((a, b) => a[0] - b[0]);
  if (entries.length === 0) return "0";
  let den = 1;
  for (const [, c] of entries) den = (den / gcdInt(den, c.d)) * c.d;
  const termTex = (m: number, c: Q, first: boolean): string => {
    const mag = Math.abs(c.n);
    const body = m === 1 ? String(mag) : `${mag === 1 ? "" : mag}\\sqrt{${m}}`;
    return first ? `${c.n < 0 ? "-" : ""}${body}` : ` ${c.n < 0 ? "-" : "+"} ${body}`;
  };
  if (den === 1) return entries.map(([m, c], i) => termTex(m, c, i === 0)).join("");
  const scaled = entries.map(([m, c]) => [m, qMul(c, q(den))] as const);
  // one term: the sign in front of the fraction
  if (scaled.length === 1) {
    const [m, c] = scaled[0];
    return `${c.n < 0 ? "-" : ""}\\frac{${termTex(m, { n: Math.abs(c.n), d: 1 }, true)}}{${den}}`;
  }
  return `\\frac{${scaled.map(([m, c], i) => termTex(m, c, i === 0)).join("")}}{${den}}`;
}

// ---------------------------------------------------------------- reading

interface Term {
  /** rational coefficient in front */
  c: Q;
  /** the root as written, or null for a plain number */
  root: { n: number; index: number } | null;
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

function qOf(node: MathNode): Q | null {
  const n = stripParens(node);
  const i = intOf(n);
  if (i !== null) return q(i);
  if (n.type === "OperatorNode" && fnOf(n) === "divide") {
    const a = qOf(argsOf(n)[0]);
    const b = qOf(argsOf(n)[1]);
    return a && b && !qIsZero(b) ? qDiv(a, b) : null;
  }
  if (n.type === "OperatorNode" && fnOf(n) === "unaryMinus") {
    const a = qOf(argsOf(n)[0]);
    return a ? qNeg(a) : null;
  }
  return null;
}

/** `\sqrt{n}` / `\sqrt[3]{n}` with an integer radicand. */
function rootOf(node: MathNode): { n: number; index: number } | null {
  const n = stripParens(node);
  if (n.type !== "FunctionNode") return null;
  const f = fnOf(n);
  const a = argsOf(n);
  if (f === "sqrt" && a.length === 1) {
    const v = intOf(a[0]);
    return v !== null && v >= 0 ? { n: v, index: 2 } : null;
  }
  if (f === "nthRoot" && a.length === 2) {
    const v = intOf(a[0]);
    const k = intOf(a[1]);
    return v !== null && v >= 0 && k !== null && k >= 2 && k <= 4 ? { n: v, index: k } : null;
  }
  return null;
}

/** `3\sqrt{8}`, `\sqrt{8}`, `-2\sqrt{5}`, `\frac{\sqrt{3}}{2}`, `7`. */
function termOf(node: MathNode): Term | null {
  const n = stripParens(node);
  const c = qOf(n);
  if (c) return { c, root: null };
  const r = rootOf(n);
  if (r) return { c: q(1), root: r };
  const f = fnOf(n);
  const a = argsOf(n);
  if (n.type === "OperatorNode" && f === "unaryMinus") {
    const t = termOf(a[0]);
    return t ? { c: qNeg(t.c), root: t.root } : null;
  }
  if (n.type === "OperatorNode" && f === "multiply") {
    const x = termOf(a[0]);
    const y = termOf(a[1]);
    if (!x || !y || (x.root && y.root)) return null;
    return { c: qMul(x.c, y.c), root: x.root ?? y.root };
  }
  if (n.type === "OperatorNode" && f === "divide") {
    const x = termOf(a[0]);
    const d = qOf(a[1]);
    if (!x || !d || qIsZero(d)) return null;
    return { c: qDiv(x.c, d), root: x.root };
  }
  return null;
}

function summandsOf(node: MathNode, sign = 1): Array<{ sign: number; node: MathNode }> {
  const n = stripParens(node);
  const f = fnOf(n);
  const a = argsOf(n);
  if (n.type === "OperatorNode" && f === "add") return [...summandsOf(a[0], sign), ...summandsOf(a[1], sign)];
  if (n.type === "OperatorNode" && f === "subtract") return [...summandsOf(a[0], sign), ...summandsOf(a[1], -sign)];
  return [{ sign, node: n }];
}

/** A sum of terms, each a rational times one root. */
function termsOfSum(node: MathNode): Term[] | null {
  const out: Term[] = [];
  for (const s of summandsOf(node)) {
    const t = termOf(s.node);
    if (!t) return null;
    out.push({ c: s.sign < 0 ? qNeg(t.c) : t.c, root: t.root });
  }
  return out;
}

/** The value of one term (square roots only in a Surd). */
function termValue(t: Term): Surd {
  if (!t.root) return rational(t.c);
  if (t.root.index !== 2) throw new NotRadical();
  const { k, m } = extract(t.root.n, 2);
  return new Map([[m, qMul(t.c, q(k))]].filter(([, c]) => !qIsZero(c as Q)) as Array<[number, Q]>);
}

const sumValue = (ts: readonly Term[]): Surd => ts.reduce((s, t) => surdAdd(s, termValue(t)), new Map() as Surd);

// ---------------------------------------------------------------- printing terms

function rootTex(r: { n: number; index: number }, inside?: string): string {
  const body = inside ?? String(r.n);
  return r.index === 2 ? `\\sqrt{${body}}` : `\\sqrt[${r.index}]{${body}}`;
}

/** A term as written, or with its radicand split (`\sqrt{25 \cdot 2}`), or simplified (`5\sqrt{2}`). */
function termTex(t: Term, mode: "as-written" | "split" | "simplified", first: boolean): string {
  const sign = t.c.n < 0 ? "-" : first ? "" : "+";
  const mag: Q = { n: Math.abs(t.c.n), d: t.c.d };
  const lead = (s: string) => (first ? `${sign}${s}` : ` ${sign} ${s}`);
  if (!t.root) return lead(qTex(mag));
  const { k, m } = extract(t.root.n, t.root.index);
  let coef = mag;
  let root = rootTex(t.root);
  if (mode === "split" && k > 1 && m > 1) root = rootTex(t.root, `${k ** t.root.index} \\cdot ${m}`);
  if (mode === "simplified") {
    coef = qMul(mag, q(k));
    root = m === 1 ? "" : rootTex({ n: m, index: t.root.index });
  }
  if (!root) return lead(qTex(coef));
  if (coef.d !== 1) return lead(`\\frac{${coef.n === 1 ? "" : coef.n}${root}}{${coef.d}}`);
  return lead(`${coef.n === 1 ? "" : coef.n}${root}`);
}

function sumTex(ts: readonly Term[], mode: "as-written" | "split" | "simplified"): string {
  return ts.map((t, i) => termTex(t, mode, i === 0)).join("");
}

const needsSplit = (t: Term) => t.root !== null && extract(t.root.n, t.root.index).k > 1;

// ---------------------------------------------------------------- the shapes

/** The same terms in another order (`2\sqrt{3} + 3\sqrt{2}` and `3\sqrt{2} + 2\sqrt{3}`): not a new line. */
function reordered(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const terms = (s: string) => {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of s.replace(/\s+/g, "")) {
      if (ch === "{" || ch === "(") depth++;
      if (ch === "}" || ch === ")") depth--;
      if ((ch === "+" || ch === "-") && depth === 0 && cur) {
        out.push(cur.startsWith("-") ? cur : `+${cur}`);
        cur = ch === "-" ? "-" : "";
        continue;
      }
      cur += ch;
    }
    if (cur) out.push(cur.startsWith("-") ? cur : `+${cur}`);
    return out.sort().join("");
  };
  return terms(a) === terms(b);
}

/** Writes the answer unless it is the line above in another order. */
function writeAnswer(w: StepWriter, tex: string): void {
  if (!reordered(w.last, tex)) w.write(tex);
}

/** A sum of root terms: split the radicands, take the squares out, collect like roots. */
function sumSteps(ts: Term[], w: StepWriter): Surd | null {
  if (!ts.some((t) => t.root)) return null;
  const cubeOrMore = ts.some((t) => t.root && t.root.index !== 2);
  if (ts.some(needsSplit)) {
    if (ts.some((t) => needsSplit(t) && extract(t.root!.n, t.root!.index).m > 1)) w.write(sumTex(ts, "split"));
    w.write(sumTex(ts, "simplified"));
  }
  if (cubeOrMore) {
    // one cube / fourth root: nothing to collect beyond it
    if (ts.length !== 1) return null;
    return new Map();
  }
  const value = sumValue(ts);
  writeAnswer(w, surdTex(value));
  return value;
}

/** Top times its conjugate over the bottom times its conjugate. */
function quotientSteps(top: Term[], bottom: Term[], w: StepWriter): Surd | null {
  const B = sumValue(bottom);
  const T = sumValue(top);
  const bottomRoots = [...B.keys()].filter((m) => m !== 1);
  if (bottomRoots.length === 0) {
    const d = B.get(1);
    if (!d) return null;
    const v = surdScale(T, qDiv(q(1), d));
    if (top.some(needsSplit)) w.write(`\\frac{${sumTex(top, "simplified")}}{${sumTex(bottom, "simplified")}}`);
    writeAnswer(w, surdTex(v));
    return v;
  }
  if (bottomRoots.length > 1) return null;
  const m = bottomRoots[0];
  const a = B.get(1) ?? q(0);
  const b = B.get(m)!;
  const topTex = sumTex(top, "simplified");
  const bottomSimple = surdTex(B);
  if (bottom.some(needsSplit)) w.write(`\\frac{${topTex}}{${bottomSimple}}`);
  if (qIsZero(a)) {
    // one root below: times √m over √m
    const rootM = `\\sqrt{${m}}`;
    const topFactor = top.length > 1 ? `(${topTex})` : topTex;
    const bottomFactor = /^\d*\\sqrt/.test(bottomSimple) || /^\\sqrt/.test(bottomSimple) ? bottomSimple : `(${bottomSimple})`;
    w.write(`\\frac{${topFactor} \\cdot ${rootM}}{${bottomFactor} \\cdot ${rootM}}`);
    const newTop = surdMul(T, new Map([[m, q(1)]]));
    const newBottom = qMul(b, q(m));
    w.write(`\\frac{${surdTex(newTop)}}{${qTex(newBottom)}}`);
    const v = surdScale(newTop, qDiv(q(1), newBottom));
    writeAnswer(w, surdTex(v));
    return v;
  }
  // a binomial below: its conjugate, in the order the bottom was written (`\sqrt{5} - 1` → `\sqrt{5} + 1`)
  const conj: Surd = new Map([
    [1, a],
    [m, qNeg(b)],
  ]);
  const rootFirst = bottom.findIndex((t) => t.root) === 0;
  const pair = (r: Q, s: Q) => {
    const rational: Term = { c: r, root: null };
    const root: Term = { c: s, root: { n: m, index: 2 } };
    return sumTex(rootFirst ? [root, rational] : [rational, root], "simplified");
  };
  // root first: the conjugate is written `\sqrt{5} + 1` (its negative), and so are the top and the squares
  const conjTex = rootFirst ? pair(qNeg(a), b) : pair(a, qNeg(b));
  const bottomTex = pair(a, b);
  const topFactor = top.length > 1 || [...T.keys()].length > 1 ? `(${topTex})` : topTex;
  w.write(`\\frac{${topFactor}(${conjTex})}{(${bottomTex})(${conjTex})}`);
  const newTop = surdMul(T, conj);
  const denom = qAdd(qMul(a, a), qNeg(qMul(qMul(b, b), q(m))));
  const squares = rootFirst ? `${qTex(qMul(qMul(b, b), q(m)))} - ${qTex(qMul(a, a))}` : `${qTex(qMul(a, a))} - ${qTex(qMul(qMul(b, b), q(m)))}`;
  const topNow = rootFirst ? surdScale(newTop, q(-1)) : newTop;
  w.write(`\\frac{${surdTex(topNow)}}{${squares}}`);
  if (qIsZero(denom)) return null;
  const v = surdScale(newTop, qDiv(q(1), denom));
  writeAnswer(w, surdTex(v));
  return v;
}

/** A product of two sums (FOIL), each product of roots under one root. */
function productSteps(x: Term[], y: Term[], w: StepWriter): Surd | null {
  if (x.some((t) => t.root && t.root.index !== 2) || y.some((t) => t.root && t.root.index !== 2)) return null;
  const X = sumValue(x);
  const Y = sumValue(y);
  // two single roots: under one root first (`\sqrt{6} \cdot \sqrt{3}` → `\sqrt{18}`)
  if (x.length === 1 && y.length === 1 && x[0].root && y[0].root) {
    const c = qMul(x[0].c, y[0].c);
    const n = x[0].root.n * y[0].root.n;
    const joined: Term = { c, root: { n, index: 2 } };
    w.write(sumTex([joined], "as-written"));
    return sumSteps([joined], w) ?? sumValue([joined]);
  }
  // FOIL: every product written with its roots multiplied
  const parts: Term[] = [];
  for (const s of x) {
    for (const t of y) {
      const c = qMul(s.c, t.c);
      if (s.root && t.root) parts.push({ c, root: { n: s.root.n * t.root.n, index: 2 } });
      else parts.push({ c, root: s.root ?? t.root });
    }
  }
  w.write(sumTex(parts, "as-written"));
  if (parts.some(needsSplit)) w.write(sumTex(parts, "simplified"));
  const v = surdMul(X, Y);
  writeAnswer(w, surdTex(v));
  return v;
}

/** `8^{\frac{2}{3}}` → `(\sqrt[3]{8})^{2}` → `2^{2}` → `4`; a negative exponent flips it first. */
function rationalPowerSteps(base: number, e: Q, w: StepWriter): Surd | null {
  if (base <= 0 || e.d === 1 || e.d > 4) return null;
  const { k, m } = extract(base, e.d);
  if (m !== 1) return null;
  const mag = Math.abs(e.n);
  const root = rootTex({ n: base, index: e.d });
  const powered = mag === 1 ? root : `(${root})^{${mag}}`;
  const value = qPow(q(k), mag);
  if (e.n < 0) {
    w.write(`\\frac{1}{${base}^{${qTex({ n: mag, d: e.d })}}}`);
    w.write(`\\frac{1}{${powered}}`);
    if (mag !== 1) w.write(`\\frac{1}{${k}^{${mag}}}`);
    const v = qDiv(q(1), value);
    w.write(qTex(v));
    return rational(v);
  }
  w.write(powered);
  if (mag !== 1) w.write(`${k}^{${mag}}`);
  w.write(qTex(value));
  return rational(value);
}

/**
 * The steps for a numeric line with roots or a rational exponent, or null: a letter in it, a
 * shape not handled, nothing to simplify, or a line that fails its check.
 */
export function radicalSteps(deps: CourseDeps, node: MathNode, input: string): string[] | null {
  try {
    return exactly(() => {
      const n = stripParens(node);
      const f = fnOf(n);
      const a = argsOf(n);
      const w = new StepWriter(deps.normalize, input);
      let value: Surd | null = null;
      if (n.type === "OperatorNode" && f === "pow" && a.length === 2) {
        const b = intOf(a[0]);
        const e = qOf(a[1]);
        if (b !== null && e) value = rationalPowerSteps(b, e, w);
        else {
          // `(1 + \sqrt{2})^{2}`: the product with itself
          const t = termsOfSum(a[0]);
          const k = intOf(a[1]);
          if (!t || k !== 2 || !t.some((x) => x.root)) return null;
          value = productSteps(t, t, w);
        }
      } else if (n.type === "FunctionNode" && f === "sqrt" && a.length === 1 && !rootOf(n)) {
        // `\sqrt{\frac{3}{4}}`: the root of the top over the root of the bottom
        const inner = qOf(a[0]);
        if (!inner || inner.n < 0 || inner.d === 1) return null;
        const top: Term = { c: q(1), root: { n: inner.n, index: 2 } };
        const bottom: Term = { c: q(1), root: { n: inner.d, index: 2 } };
        w.write(`\\frac{\\sqrt{${inner.n}}}{\\sqrt{${inner.d}}}`);
        value = quotientSteps([top], [bottom], w);
      } else if (n.type === "OperatorNode" && f === "divide" && a.length === 2) {
        const top = termsOfSum(a[0]);
        const bottom = termsOfSum(a[1]);
        if (!top || !bottom || !bottom.some((t) => t.root) && !top.some((t) => t.root)) return null;
        // `\frac{\sqrt{50}}{\sqrt{2}}`: one root over one root divides under the root
        if (top.length === 1 && bottom.length === 1 && top[0].root && bottom[0].root && top[0].root.index === 2 && bottom[0].root.index === 2 && top[0].root.n % bottom[0].root.n === 0) {
          const c = qDiv(top[0].c, bottom[0].c);
          const inside = top[0].root.n / bottom[0].root.n;
          const coef = isOne(c) ? "" : qTex(c);
          w.write(`${coef}\\sqrt{\\frac{${top[0].root.n}}{${bottom[0].root.n}}}`);
          w.write(`${coef}\\sqrt{${inside}}`);
          value = sumSteps([{ c, root: { n: inside, index: 2 } }], w) ?? sumValue([{ c, root: { n: inside, index: 2 } }]);
        } else value = quotientSteps(top, bottom, w);
      } else if (n.type === "OperatorNode" && f === "multiply" && a.length === 2 && !termOf(n)) {
        const x = termsOfSum(a[0]);
        const y = termsOfSum(a[1]);
        if (!x || !y || (!x.some((t) => t.root) && !y.some((t) => t.root))) return null;
        value = productSteps(x, y, w);
      } else {
        const ts = termsOfSum(n);
        if (!ts) return null;
        value = sumSteps(ts, w);
      }
      if (!value) return null;
      const lines = w.lines();
      if (lines.length === 0) return null;
      if (!chainAgrees(deps, input, lines)) return null;
      return lines;
    });
  } catch {
    return null;
  }
}
