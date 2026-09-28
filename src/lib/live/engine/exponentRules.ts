/**
 * The laws of exponents (A-SSE.2, N-RN.2), one rule per line, the way a teacher writes them:
 *
 *   x^{3} \cdot x^{4}     (2x^{3}y)^{2}              \frac{12x^{5}y^{2}}{4x^{2}y^{5}}     x^{-2}
 *   = x^{3 + 4}           = 2^{2}x^{3 \cdot 2}y^{2}  = 3x^{5 - 2}y^{2 - 5}               = \frac{1}{x^{2}}
 *   = x^{7}               = 4x^{6}y^{2}              = 3x^{3}y^{-3}
 *                                                    = \frac{3x^{3}}{y^{3}}
 *
 * The power of a product / quotient / power first (exponents multiplied, written `3 \cdot 2`),
 * then like bases combined (exponents added, or subtracted across the fraction bar), then
 * negative exponents moved below the bar and zero exponents dropped. Numbers written as powers
 * (`2^{3} \cdot 2^{4}`) are bases like any letter and are worked out at the end (`= 128`).
 * Only a product / quotient / power of numbers and letters is taken (no sums); every line is
 * checked numerically against the question before it is written.
 */
import type { MathNode } from "mathjs";
import { q, qAdd, qDiv, qMul, qNeg, type Q } from "./algebra";
import { chainAgrees, type CourseDeps } from "./courseKit";
import { argsOf, fnOf, stripParens } from "./nodes";
import { exactly, qIsZero, qPow } from "./poly";
import { StepWriter } from "./solution";

type AnyNode = MathNode & { value?: unknown; name?: string };

/** One factor as written: a letter or a number, with its chain of exponents (own first, then each bracket's). */
interface Factor {
  base: string | number;
  chain: Q[];
  below: boolean;
}

class NotMonomial extends Error {}

function constQ(node: MathNode): Q | null {
  const n = stripParens(node) as AnyNode;
  if (n.type === "ConstantNode" && typeof n.value === "number" && Number.isInteger(n.value)) return q(n.value);
  const f = fnOf(n);
  const a = argsOf(n);
  if (n.type === "OperatorNode" && f === "unaryMinus") {
    const inner = constQ(a[0]);
    return inner ? qNeg(inner) : null;
  }
  if (n.type === "OperatorNode" && f === "divide") {
    const x = constQ(a[0]);
    const y = constQ(a[1]);
    return x && y && y.n !== 0 ? qDiv(x, y) : null;
  }
  return null;
}

function walk(node: MathNode, outer: Q[], below: boolean, out: Factor[], state: { bracketPower: boolean }): void {
  const n = stripParens(node) as AnyNode;
  const f = fnOf(n);
  const a = argsOf(n);
  if (n.type === "ConstantNode") {
    if (typeof n.value !== "number" || !Number.isInteger(n.value) || n.value <= 0) throw new NotMonomial();
    out.push({ base: n.value, chain: [q(1), ...outer], below });
    return;
  }
  if (n.type === "SymbolNode") {
    const name = n.name ?? "";
    if (!/^[a-zA-Z]$/.test(name) || name === "e" || name === "i") throw new NotMonomial();
    out.push({ base: name, chain: [q(1), ...outer], below });
    return;
  }
  if (n.type !== "OperatorNode") throw new NotMonomial();
  if (f === "multiply") {
    walk(a[0], outer, below, out, state);
    walk(a[1], outer, below, out, state);
    return;
  }
  if (f === "divide") {
    walk(a[0], outer, below, out, state);
    walk(a[1], outer, !below, out, state);
    return;
  }
  if (f === "unaryMinus") {
    out.push({ base: -1, chain: [q(1), ...outer], below });
    walk(a[0], outer, below, out, state);
    return;
  }
  if (f === "pow") {
    const e = constQ(a[1]);
    if (!e) throw new NotMonomial();
    const b = stripParens(a[0]) as AnyNode;
    if (b.type === "SymbolNode" || b.type === "ConstantNode") {
      const before = out.length;
      walk(b, outer, below, out, state);
      // the base's own exponent replaces the implicit 1
      for (let i = before; i < out.length; i++) out[i].chain[0] = e;
      return;
    }
    state.bracketPower = true;
    walk(b, [e, ...outer], below, out, state);
    return;
  }
  throw new NotMonomial();
}

const qTex = (a: Q): string => (a.d === 1 ? String(a.n) : `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`);
const qProduct = (xs: readonly Q[]): Q => xs.reduce((s, x) => qMul(s, x), q(1));
const isOne = (x: Q): boolean => x.n === 1 && x.d === 1;

/**
 * `x`, `x^{3}`, `x^{3 \cdot 2}`, `2^{2}` — a factor with its exponents written out; evaluated, a
 * number next to letters is worked out (`4x^{6}`), a number alone keeps its power (`2^{6}`).
 */
function factorTex(f: Factor, evaluated: boolean, numbersOut = false): string {
  const base = typeof f.base === "number" ? (f.base < 0 ? `(${f.base})` : String(f.base)) : f.base;
  if (evaluated && numbersOut && typeof f.base === "number") {
    const e = qProduct(f.chain);
    if (e.d === 1 && e.n >= 0) {
      const v = qPow(q(f.base), e.n);
      return v.n < 0 ? `(${qTex(v)})` : qTex(v);
    }
  }
  const chain = f.chain.filter((e, i) => !(i === 0 && isOne(e) && f.chain.length > 1));
  const exps = evaluated ? [qProduct(f.chain)] : chain.length ? chain : [q(1)];
  if (exps.length === 1 && isOne(exps[0])) return base;
  const e = exps.map((x) => (x.n < 0 && exps.length > 1 ? `(${qTex(x)})` : qTex(x))).join(" \\cdot ");
  return `${base}^{${e}}`;
}

/** Factors side by side: letters glued, numbers with `\cdot` between them. */
function joinTex(parts: readonly string[]): string {
  let out = "";
  for (const p of parts) {
    if (!out) out = p;
    else if (/^[\d(]/.test(p) && !/^\(/.test(p)) out += ` \\cdot ${p}`;
    else if (/^\(/.test(p) || /^\d/.test(p)) out += ` \\cdot ${p}`;
    else out += p;
  }
  return out;
}

function fractionTex(top: string, bottom: string): string {
  if (!bottom) return top || "1";
  return `\\frac{${top || "1"}}{${bottom}}`;
}

/** The line with every factor where it was written, exponents as chains (`x^{3 \cdot 2}`) or evaluated. */
function writtenTex(factors: readonly Factor[], evaluated: boolean): string {
  const letters = factors.some((f) => typeof f.base === "string");
  const top = factors.filter((f) => !f.below).map((f) => factorTex(f, evaluated, letters));
  const bottom = factors.filter((f) => f.below).map((f) => factorTex(f, evaluated, letters));
  // a negative number in front needs no bracket: `-27a^{6}`
  const lead = (parts: string[]) => (parts.length > 0 && /^\(-\d+\)$/.test(parts[0]) ? [parts[0].slice(1, -1), ...parts.slice(1)] : parts);
  return fractionTex(joinTex(lead(top)), joinTex(lead(bottom)));
}

/** `-` in front of a number is that number negative: `(-3a^{2})^{3}` has the base -3. */
function mergeSigns(factors: Factor[]): Factor[] {
  const out: Factor[] = [];
  for (let i = 0; i < factors.length; i++) {
    const f = factors[i];
    const next = factors[i + 1];
    if (f.base === -1 && next && typeof next.base === "number" && next.below === f.below && next.chain.length === f.chain.length && next.chain.slice(1).every((e, j) => e.n === f.chain[j + 1].n && e.d === f.chain[j + 1].d) && isOne(next.chain[0])) {
      out.push({ ...next, base: -next.base });
      i++;
      continue;
    }
    out.push(f);
  }
  return out;
}

interface Combined {
  coef: Q;
  /** base → exponent contributions, in the order met (below the bar negative) */
  bases: Array<{ base: string | number; parts: Q[] }>;
}

function combine(factors: readonly Factor[]): Combined {
  let coef = q(1);
  const bases: Combined["bases"] = [];
  const counts = new Map<string, number>();
  for (const f of factors) counts.set(String(f.base), (counts.get(String(f.base)) ?? 0) + 1);
  const letters = factors.some((f) => typeof f.base === "string");
  for (const f of factors) {
    const e = qProduct(f.chain);
    const signed = f.below ? qNeg(e) : e;
    // a plain number, or (beside letters) a number not repeated as a power base, is the coefficient
    const plain = f.chain.every(isOne);
    if (typeof f.base === "number" && (plain || f.base === -1 || (letters && (counts.get(String(f.base)) ?? 0) === 1))) {
      const v = qPow(q(f.base), 1);
      if (e.d !== 1) throw new NotMonomial();
      coef = qMul(coef, qPow(v, signed.n));
      continue;
    }
    const at = bases.find((b) => b.base === f.base);
    if (at) at.parts.push(signed);
    else bases.push({ base: f.base, parts: [signed] });
  }
  return { coef, bases };
}

/** `3x^{5 - 2}y^{2 - 5}`: each base once, its exponents added (subtracted across the bar). */
function combinedTex(c: Combined): string {
  const top: string[] = [];
  const bottom: string[] = [];
  for (const b of c.bases) {
    const base = String(b.base);
    const onlyBelow = b.parts.every((p) => p.n < 0);
    if (onlyBelow && b.parts.length === 1) {
      const e = qNeg(b.parts[0]);
      bottom.push(isOne(e) ? base : `${base}^{${qTex(e)}}`);
      continue;
    }
    let e = "";
    b.parts.forEach((p, i) => {
      const mag = qTex({ n: Math.abs(p.n), d: p.d });
      e += i === 0 ? (p.n < 0 ? `-${mag}` : mag) : ` ${p.n < 0 ? "-" : "+"} ${mag}`;
    });
    top.push(b.parts.length === 1 && isOne(b.parts[0]) ? base : `${base}^{${e}}`);
  }
  return coefFraction(c.coef, top, bottom);
}

function coefFraction(coef: Q, top: readonly string[], bottom: readonly string[]): string {
  const neg = coef.n < 0;
  const mag = { n: Math.abs(coef.n), d: coef.d };
  const topCoef = mag.n === 1 && top.length > 0 ? "" : String(mag.n);
  const bottomCoef = mag.d === 1 ? "" : String(mag.d);
  const t = joinTex([topCoef, ...top].filter(Boolean));
  const b = joinTex([bottomCoef, ...bottom].filter(Boolean));
  return `${neg ? "-" : ""}${fractionTex(t, b)}`;
}

/** Each base with one exponent: `3x^{3}y^{-3}` (a negative exponent still on top). */
function evaluatedTex(c: Combined): { tex: string; exps: Array<{ base: string | number; e: Q }> } {
  const exps = c.bases.map((b) => ({ base: b.base, e: b.parts.reduce((s, p) => qAdd(s, p), q(0)) }));
  const top: string[] = [];
  const bottom: string[] = [];
  c.bases.forEach((b, i) => {
    const x = exps[i];
    const base = typeof x.base === "number" && x.base < 0 ? `(${x.base})` : String(x.base);
    // a base only ever below the bar stays there; a combined one keeps its (negative) exponent on top
    if (b.parts.length === 1 && b.parts[0].n < 0) {
      const e = qNeg(x.e);
      bottom.push(isOne(e) ? base : `${base}^{${qTex(e)}}`);
    } else top.push(isOne(x.e) ? base : `${base}^{${qTex(x.e)}}`);
  });
  return { tex: coefFraction(c.coef, top, bottom), exps };
}

/**
 * Negative exponents below the bar, zero exponents gone: `\frac{3x^{3}}{y^{3}}`, `\frac{1}{2^{3}}`;
 * with `numbers`, number bases worked out too — the answer.
 */
function finalTex(coef: Q, exps: ReadonlyArray<{ base: string | number; e: Q }>, numbers = true): string {
  let k = coef;
  const top: string[] = [];
  const bottom: string[] = [];
  for (const x of exps) {
    if (qIsZero(x.e)) continue;
    if (typeof x.base === "number" && !numbers) {
      const mag = { n: Math.abs(x.e.n), d: x.e.d };
      const tex = `${x.base < 0 ? `(${x.base})` : x.base}${isOne(mag) ? "" : `^{${qTex(mag)}}`}`;
      (x.e.n < 0 ? bottom : top).push(tex);
      continue;
    }
    if (typeof x.base === "number") {
      if (x.e.d !== 1) throw new NotMonomial();
      k = qMul(k, qPow(q(x.base), x.e.n));
      continue;
    }
    const mag = { n: Math.abs(x.e.n), d: x.e.d };
    const tex = isOne(mag) ? x.base : `${x.base}^{${qTex(mag)}}`;
    (x.e.n < 0 ? bottom : top).push(tex);
  }
  return coefFraction(k, top, bottom);
}

/**
 * The exponent-law steps for a product / quotient / power of numbers and letters, or null when
 * the line is not one, no law applies, or a line fails its check.
 */
export function exponentSteps(deps: CourseDeps, node: MathNode, input: string): string[] | null {
  try {
    return exactly(() => {
      const raw: Factor[] = [];
      const state = { bracketPower: false };
      walk(node, [], false, raw, state);
      const factors = mergeSigns(raw);
      if (!factors.some((f) => typeof f.base === "string" || !isOne(f.chain[0]) || f.chain.length > 1)) return null;
      const counts = new Map<string, number>();
      for (const f of factors) counts.set(String(f.base), (counts.get(String(f.base)) ?? 0) + 1);
      const repeated = [...counts.entries()].some(([b, n]) => n > 1 && b !== "-1" && factors.some((f) => String(f.base) === b && (typeof f.base === "string" || !isOne(qProduct(f.chain)))));
      const nonPositive = factors.some((f) => qProduct(f.chain).n <= 0 && typeof f.base === "string") || factors.some((f) => typeof f.base === "number" && qProduct(f.chain).n <= 0);
      const numberPowers = factors.some((f) => typeof f.base === "number" && f.base !== -1 && !isOne(qProduct(f.chain)));
      if (!state.bracketPower && !repeated && !nonPositive && !numberPowers) return null;
      // a lone letter power is already written its simplest way
      if (!state.bracketPower && !repeated && !nonPositive && factors.every((f) => typeof f.base === "number")) {
        // `2^{5}` alone: arithmetic, not a law — the calculator answers it
        if (factors.length === 1) return null;
      }
      const w = new StepWriter(deps.normalize, input);
      if (state.bracketPower) {
        w.write(writtenTex(factors, false));
        w.write(writtenTex(factors, true));
      }
      const c = combine(factors);
      if (repeated) w.write(combinedTex(c));
      const ev = evaluatedTex(c);
      w.write(ev.tex);
      // negative exponents below the bar (`\frac{1}{2^{3}}`), then any number worked out (`\frac{1}{8}`)
      w.write(finalTex(c.coef, ev.exps, false));
      const final = finalTex(c.coef, ev.exps);
      w.write(final);
      const lines = w.lines();
      if (lines.length === 0) return null;
      if (!chainAgrees(deps, input, lines, { positive: true })) return null;
      return lines;
    });
  } catch (e) {
    if (e instanceof NotMonomial) return null;
    return null;
  }
}
