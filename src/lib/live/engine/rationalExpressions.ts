/**
 * Rational expressions (A-APR.6–7) in one letter, with the values it cannot take first:
 *
 *   \frac{2}{x} + \frac{3}{x + 1}                    \frac{x^{2} - 4}{x + 3} \cdot \frac{x + 3}{x - 2}
 *   x \neq -1, \ x \neq 0                            x \neq -3, \ x \neq 2
 *   = \frac{2(x + 1)}{x(x + 1)} + \frac{3x}{x(x + 1)}   = \frac{(x + 2)(x - 2)}{x + 3} \cdot \frac{x + 3}{x - 2}
 *   = \frac{2(x + 1) + 3x}{x(x + 1)}                 = \frac{(x + 2)(x - 2)(x + 3)}{(x + 3)(x - 2)}
 *   = \frac{2x + 2 + 3x}{x(x + 1)}                   = x + 2
 *   = \frac{5x + 2}{x(x + 1)}
 *
 * Denominators factored (rational roots, as `polynomial.ts` does), the LCD built from the factors,
 * each fraction brought over it, one fraction, the top expanded and collected, and any factor it
 * shares with the bottom cancelled. Dividing is multiplying by the reciprocal (the divisor's top
 * joins the excluded values). Every `= …` line is checked numerically against the question.
 */
import type { MathNode } from "mathjs";
import { combineTerms, q, qDiv, qMul, standardOrder, termsLatex, termsOf, type Q, type Term } from "./algebra";
import { chainAgrees, lettersOf, type CourseDeps } from "./courseKit";
import { argsOf, fnOf, stripParens } from "./nodes";
import { deg, exactly, factorLinear, polyFromTerms, polyLatex, productLatex, rootFactor, type Poly } from "./poly";
import { LIST_SEP, StepWriter } from "./solution";

interface Factor {
  f: Poly;
  mult: number;
}

interface Factored {
  content: Q;
  factors: Factor[];
}

const key = (f: Poly): string => f.map((c) => `${c.n}/${c.d}`).join(",");
const qTex = (a: Q): string => (a.d === 1 ? String(a.n) : `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`);

function factored(p: Poly): Factored {
  const lf = factorLinear(p);
  const factors: Factor[] = lf.roots.map((r) => ({ f: rootFactor(r.root), mult: r.mult }));
  if (deg(lf.rest) >= 1) factors.push({ f: lf.rest, mult: 1 });
  return { content: lf.content, factors };
}

/** Above or below a bar: `x + 1` alone, `x(x + 1)`, `2(x - 1)^{2}`. */
function partTex(p: Factored, v: string): string {
  if (p.factors.length === 0) return qTex(p.content);
  if (p.factors.length === 1 && p.factors[0].mult === 1 && p.content.n === 1 && p.content.d === 1) return polyLatex(p.factors[0].f, v);
  return productLatex(p.content, p.factors, v);
}

function roots(p: Factored): Q[] {
  return p.factors.filter((f) => deg(f.f) === 1).map((f) => qDiv(q(-f.f[0].n, f.f[0].d), f.f[1]));
}

function restrictionLine(denominators: readonly Factored[], v: string): string | null {
  const all: Q[] = [];
  for (const d of denominators) for (const r of roots(d)) if (!all.some((a) => a.n === r.n && a.d === r.d)) all.push(r);
  if (all.length === 0) return null;
  all.sort((a, b) => a.n / a.d - b.n / b.d);
  return all.map((r) => `${v} \\neq ${qTex(r)}`).join(LIST_SEP);
}

interface Fraction {
  sign: 1 | -1;
  num: Poly;
  den: Poly;
}

function polyOfNode(node: MathNode, v: string): Poly | null {
  const t = termsOf(node, [v]);
  return t ? polyFromTerms(t, v) : null;
}

/** `\frac{A}{B}` or a polynomial (over 1). */
function fractionOf(node: MathNode, v: string): { num: Poly; den: Poly } | null {
  const n = stripParens(node);
  if (n.type === "OperatorNode" && fnOf(n) === "divide") {
    const num = polyOfNode(argsOf(n)[0], v);
    const den = polyOfNode(argsOf(n)[1], v);
    return num && den && den.length > 0 ? { num, den } : null;
  }
  const p = polyOfNode(n, v);
  return p ? { num: p, den: [q(1)] } : null;
}

function summandsOf(node: MathNode, sign: 1 | -1 = 1): Array<{ sign: 1 | -1; node: MathNode }> {
  const n = stripParens(node);
  const f = fnOf(n);
  const a = argsOf(n);
  if (n.type === "OperatorNode" && f === "add") return [...summandsOf(a[0], sign), ...summandsOf(a[1], sign)];
  if (n.type === "OperatorNode" && f === "subtract") return [...summandsOf(a[0], sign), ...summandsOf(a[1], (-sign) as 1 | -1)];
  return [{ sign, node: n }];
}

function mulPoly(a: Poly, b: Poly): Poly {
  const out: Q[] = new Array(Math.max(0, a.length + b.length - 1)).fill(q(0));
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] = addQ(out[i + j], qMul(a[i], b[j]));
  while (out.length && out[out.length - 1].n === 0) out.pop();
  return out;
}

const addQ = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d);

/** Terms of p (highest power first) as written after expanding: `2x + 2 + 3x` keeps its order. */
function expandedTerms(parts: ReadonlyArray<{ sign: 1 | -1; factors: Poly[] }>, v: string): Term[] {
  const out: Term[] = [];
  for (const p of parts) {
    const prod = p.factors.reduce((a, b) => mulPoly(a, b), [q(1)] as Poly);
    for (let d = prod.length - 1; d >= 0; d--) {
      if (prod[d].n === 0) continue;
      out.push({ c: p.sign < 0 ? qMul(prod[d], q(-1)) : prod[d], vars: d === 0 ? {} : { [v]: d } });
    }
  }
  return out;
}

/** The sum of several fractions over their LCD. */
function sumSteps(deps: CourseDeps, fr: Fraction[], v: string, input: string): string[] | null {
  const dens = fr.map((f) => factored(f.den));
  if (dens.some((d) => d.content.d !== 1)) return null;
  // the LCD: every factor at its highest power, the lcm of the numbers in front
  const lcdFactors: Factor[] = [];
  let lcdContent = 1;
  for (const d of dens) {
    lcdContent = lcm(lcdContent, Math.abs(d.content.n));
    for (const f of d.factors) {
      const at = lcdFactors.find((x) => key(x.f) === key(f.f));
      if (at) at.mult = Math.max(at.mult, f.mult);
      else lcdFactors.push({ ...f });
    }
  }
  const lcd: Factored = { content: q(lcdContent), factors: lcdFactors };
  const lcdTex = partTex(lcd, v);
  const w = new StepWriter(deps.normalize, input);
  const restriction = restrictionLine(dens, v);
  if (restriction) w.write(restriction);
  // denominators factored as needed
  const writtenDens = fr.map((f) => polyLatex(f.den, v));
  const factoredDens = dens.map((d) => partTex(d, v));
  const fracTex = (sign: number, top: string, bottom: string, first: boolean) => `${first ? (sign < 0 ? "-" : "") : sign < 0 ? " - " : " + "}\\frac{${top}}{${bottom}}`;
  if (factoredDens.some((d, i) => d !== writtenDens[i])) w.write(fr.map((f, i) => fracTex(f.sign, polyLatex(f.num, v), factoredDens[i], i === 0)).join(""), true);
  // each over the LCD: the top times what its bottom lacks
  const parts: Array<{ sign: 1 | -1; factors: Poly[]; tex: string }> = [];
  for (const [i, f] of fr.entries()) {
    const d = dens[i];
    const missing: Poly[] = [];
    const k = lcdContent / Math.abs(d.content.n);
    if (k !== 1) missing.push([q(k)]);
    // what the bottom lacks: a power of the letter itself, and bracketed factors
    let letterPower = 0;
    let brackets = "";
    for (const L of lcdFactors) {
      const have = d.factors.find((x) => key(x.f) === key(L.f))?.mult ?? 0;
      const extra = L.mult - have;
      for (let j = 0; j < extra; j++) missing.push(L.f);
      if (extra <= 0) continue;
      const lone = deg(L.f) === 1 && L.f[0].n === 0 && L.f[1].n === 1 && L.f[1].d === 1;
      if (lone) letterPower += extra;
      else brackets += extra > 1 ? `(${polyLatex(L.f, v)})^{${extra}}` : `(${polyLatex(L.f, v)})`;
    }
    const sign = (d.content.n < 0 ? -f.sign : f.sign) as 1 | -1;
    // the top times what is missing, as a student writes it: `2(x + 1)`, `3x`, `x(x - 1)`, `x - 1`
    const single = f.num.filter((c) => c.n !== 0).length <= 1;
    let numTex: string;
    if (single) {
      const power = f.num.findIndex((c) => c.n !== 0);
      const c = power < 0 ? q(0) : qMul(f.num[power], q(k));
      const term: Term = { c, vars: power + letterPower > 0 ? { [v]: power + letterPower } : {} };
      const head = termsLatex([term]);
      numTex = brackets ? (head === "1" ? brackets : head === "-1" ? `-${brackets}` : `${head}${brackets}`) : head;
      if (numTex.startsWith("(") && numTex.endsWith(")") && brackets === numTex && !numTex.slice(1, -1).includes("(")) numTex = numTex.slice(1, -1);
    } else {
      const head = termsLatex([{ c: q(k), vars: letterPower > 0 ? { [v]: letterPower } : {} }]);
      const lead = head === "1" ? "" : head;
      numTex = lead || brackets ? `${lead}${brackets}(${polyLatex(f.num, v)})` : polyLatex(f.num, v);
    }
    parts.push({ sign, factors: [...missing, f.num], tex: numTex });
  }
  w.write(parts.map((p, i) => fracTex(p.sign, p.tex, lcdTex, i === 0)).join(""));
  // one fraction
  const joined = parts.map((p, i) => {
    const multiTerm = p.factors.length === 1 && p.factors[0].filter((c) => c.n !== 0).length > 1;
    const body = p.sign < 0 && multiTerm ? `(${p.tex})` : p.tex;
    return i === 0 ? `${p.sign < 0 ? "-" : ""}${body}` : ` ${p.sign < 0 ? "-" : "+"} ${body}`;
  });
  w.write(`\\frac{${joined.join("")}}{${lcdTex}}`);
  const expanded = expandedTerms(parts, v);
  w.write(`\\frac{${termsLatex(expanded)}}{${lcdTex}}`, true);
  const collected = standardOrder(combineTerms(expanded));
  const top = polyFromTerms(collected, v);
  if (!top) return null;
  if (collected.length === 0) {
    w.write("0");
  } else {
    w.write(`\\frac{${termsLatex(collected)}}{${lcdTex}}`);
    // a factor the top shares with the LCD cancels
    const topF = factored(top);
    const cancel = cancelCommon(topF, lcd);
    if (cancel) {
      w.write(`\\frac{${partTex(topF, v)}}{${lcdTex}}`);
      w.write(cancel.tex(v));
    }
  }
  const lines = w.lines();
  return chainAgrees(deps, input, lines) ? lines : null;
}

function cancelCommon(top: Factored, bottom: Factored): { tex: (v: string) => string } | null {
  const b = bottom.factors.map((f) => ({ ...f }));
  const t: Factor[] = [];
  let any = false;
  for (const f of top.factors) {
    const m = b.find((x) => key(x.f) === key(f.f));
    const k = m ? Math.min(m.mult, f.mult) : 0;
    if (k > 0) {
      any = true;
      m!.mult -= k;
    }
    if (f.mult - k > 0) t.push({ f: f.f, mult: f.mult - k });
  }
  if (!any) return null;
  const c = qDiv(top.content, bottom.content);
  const rest = b.filter((x) => x.mult > 0);
  return {
    tex: (v) => {
      const topTex = partTex({ content: q(Math.abs(c.n)), factors: t }, v);
      if (rest.length === 0 && c.d === 1) return `${c.n < 0 ? "-" : ""}${partTex({ content: q(Math.abs(c.n)), factors: t }, v)}`;
      return `${c.n < 0 ? "-" : ""}\\frac{${topTex}}{${partTex({ content: q(c.d), factors: rest }, v)}}`;
    },
  };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/** Two fractions multiplied (or divided: times the reciprocal). */
function productSteps(deps: CourseDeps, x: { num: Poly; den: Poly }, y: { num: Poly; den: Poly }, divide: boolean, v: string, input: string): string[] | null {
  const w = new StepWriter(deps.normalize, input);
  const excluded = [factored(x.den), factored(y.den), ...(divide ? [factored(y.num)] : [])];
  const restriction = restrictionLine(excluded, v);
  if (restriction) w.write(restriction);
  const fracOf = (num: Poly, den: Poly) => `\\frac{${polyLatex(num, v)}}{${polyLatex(den, v)}}`;
  const second = divide ? { num: y.den, den: y.num } : y;
  if (divide) w.write(`${fracOf(x.num, x.den)} \\cdot ${fracOf(second.num, second.den)}`);
  const parts = [factored(x.num), factored(x.den), factored(second.num), factored(second.den)];
  const [a, b, c, d] = parts;
  w.write(`\\frac{${partTex(a, v)}}{${partTex(b, v)}} \\cdot \\frac{${partTex(c, v)}}{${partTex(d, v)}}`);
  const top: Factored = { content: qMul(a.content, c.content), factors: mergeFactors(a.factors, c.factors) };
  const bottom: Factored = { content: qMul(b.content, d.content), factors: mergeFactors(b.factors, d.factors) };
  w.write(`\\frac{${partTex(top, v)}}{${partTex(bottom, v)}}`);
  const cancel = cancelCommon(top, bottom);
  if (cancel) w.write(cancel.tex(v));
  else {
    const c2 = qDiv(top.content, bottom.content);
    w.write(`\\frac{${partTex({ content: q(c2.n), factors: top.factors }, v)}}{${partTex({ content: q(c2.d), factors: bottom.factors }, v)}}`);
  }
  const lines = w.lines();
  return chainAgrees(deps, input, lines) ? lines : null;
}

function mergeFactors(a: readonly Factor[], b: readonly Factor[]): Factor[] {
  const out = a.map((f) => ({ ...f }));
  for (const f of b) {
    const at = out.find((x) => key(x.f) === key(f.f));
    if (at) at.mult += f.mult;
    else out.push({ ...f });
  }
  return out;
}

/**
 * The steps for a sum, difference, product or quotient of fractions with the letter below, or
 * null (one fraction alone is `polynomial.ts`'s; no letter below; a check that fails).
 */
export function rationalSteps(deps: CourseDeps, node: MathNode, input: string): string[] | null {
  try {
    return exactly(() => {
      const letters = lettersOf(node);
      if (letters.length !== 1) return null;
      const v = letters[0];
      const n = stripParens(node);
      const f = fnOf(n);
      const a = argsOf(n);
      if (n.type === "OperatorNode" && (f === "multiply" || f === "divide") && a.length === 2) {
        const bothFractions = [a[0], a[1]].every((x) => fnOf(stripParens(x)) === "divide");
        if (bothFractions) {
          const x = fractionOf(a[0], v);
          const y = fractionOf(a[1], v);
          if (!x || !y || (deg(x.den) < 1 && deg(y.den) < 1)) return null;
          return productSteps(deps, x, y, f === "divide", v, input);
        }
        return null;
      }
      const ss = summandsOf(n);
      if (ss.length < 2) return null;
      const fr: Fraction[] = [];
      for (const s of ss) {
        const x = fractionOf(s.node, v);
        if (!x) return null;
        fr.push({ sign: s.sign, num: x.num, den: x.den });
      }
      if (!fr.some((x) => deg(x.den) >= 1)) return null;
      return sumSteps(deps, fr, v, input);
    });
  } catch {
    return null;
  }
}

/** `(x + 2)^{4}`: (a + b)^n from Pascal's row, then multiplied out (A-APR.5). */
export function binomialSteps(deps: CourseDeps, node: MathNode, input: string): string[] | null {
  try {
    return exactly(() => {
      const n = stripParens(node);
      if (n.type !== "OperatorNode" || fnOf(n) !== "pow") return null;
      const [baseNode, expNode] = argsOf(n);
      const e = stripParens(expNode) as MathNode & { value?: unknown };
      if (e.type !== "ConstantNode" || typeof e.value !== "number" || !Number.isInteger(e.value)) return null;
      const k = e.value;
      if (k < 3 || k > 7) return null;
      const letters = lettersOf(baseNode);
      if (letters.length === 0 || letters.length > 2) return null;
      const terms = termsOf(baseNode, letters);
      if (!terms || terms.length !== 2) return null;
      const [A, B] = terms;
      const row: number[] = [1];
      for (let i = 1; i <= k; i++) row.push((row[i - 1] * (k - i + 1)) / i);
      const plainLetter = (t: Term) => t.c.n === 1 && t.c.d === 1 && Object.keys(t.vars).length === 1 && Object.values(t.vars)[0] === 1;
      const power = (t: Term, p: number, first: boolean): string => {
        if (p === 0) return "";
        const tex = termsLatex([t]);
        if (plainLetter(t)) return p === 1 ? tex : `${tex}^{${p}}`;
        const isNumber = Object.keys(t.vars).length === 0;
        if (isNumber && t.c.n > 0 && t.c.d === 1) return first ? (p === 1 ? tex : `${tex}^{${p}}`) : p === 1 ? `(${tex})` : `(${tex})^{${p}}`;
        return p === 1 ? `(${tex})` : `(${tex})^{${p}}`;
      };
      const pieces: string[] = [];
      for (let i = 0; i <= k; i++) {
        const coef = row[i] === 1 ? "" : String(row[i]);
        const a = power(A, k - i, coef === "");
        const b = power(B, i, coef === "" && a === "");
        const glue = coef && /^\d/.test(a || b) ? " \\cdot " : "";
        pieces.push(`${coef}${glue}${a}${b}`);
      }
      const w = new StepWriter(deps.normalize, input);
      w.write(pieces.join(" + "));
      const expanded = standardOrder(combineTerms(termsOf(n, letters) ?? []));
      if (expanded.length === 0) return null;
      w.write(termsLatex(expanded));
      const lines = w.lines();
      return chainAgrees(deps, input, lines) ? lines : null;
    });
  } catch {
    return null;
  }
}

