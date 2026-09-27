/**
 * Equations with the unknown in a denominator:
 *
 *   \frac{1}{x} + \frac{1}{2} = \frac{3}{4}
 *   x \neq 0                                              what x may not be, in maths
 *   4x \cdot \frac{1}{x} + 4x \cdot \frac{1}{2} = 4x \cdot \frac{3}{4}   every term times the LCD
 *   4 + 2x = 3x                                           the denominators gone
 *   2x - 3x = -4                                          …then the linear (or quadratic) steps
 *   -x = -4
 *   x = 4
 *
 * The LCD is built from the factored denominators (`x^2 - 4` is `(x - 2)(x + 2)`), each term
 * is multiplied by what its own denominator lacks, and the equation left over is solved by the
 * engine's own steps. A root the first line excluded is dropped (`x = 1` against `x \neq 1`
 * leaves `\varnothing`). Null for denominators with irrational zeros.
 */
import type { MathNode } from "mathjs";
import { gcdInt, q, qLatex, qMul, type Q } from "./algebra";
import type { ParsedRelation, SolveContext } from "./advanced";
import { argsOf, coefficientOf, fnOf, mentions, polyTermsOf, stripParens, summands } from "./nodes";
import { X, deg, exactly, factorLinear, polyFromTerms, polyLatex, polyScale, primitive, productLatex, qIsZero, qNum, rootFactor, type Poly } from "./poly";
import { LIST_SEP, NO_SOLUTION, StepWriter, rootsLine, type Solution } from "./solution";

interface Factor {
  f: Poly;
  mult: number;
}

interface RationalTerm {
  sign: 1 | -1;
  /** integer coefficients */
  num: Poly;
  den: Poly;
  denConst: number;
  denFactors: Factor[];
}

const keyOf = (f: Poly): string => f.map((c) => `${c.n}/${c.d}`).join(",");

/** `den = c * Π factors`, factors primitive; null when a factor has real irrational zeros. */
function factorDen(den: Poly): { c: Q; factors: Factor[]; zeros: Q[] } | null {
  const lf = factorLinear(den);
  const factors: Factor[] = lf.roots.map((r) => ({ f: rootFactor(r.root), mult: r.mult }));
  if (deg(lf.rest) >= 1) {
    if (deg(lf.rest) !== 2) return null;
    const [c0, b0, a0] = lf.rest;
    if (qNum(b0) * qNum(b0) - 4 * qNum(a0) * qNum(c0) >= 0) return null;
    factors.push({ f: lf.rest, mult: 1 });
  }
  return { c: lf.content, factors, zeros: lf.roots.map((r) => r.root) };
}

function lcmInt(a: number, b: number): number {
  return (a * b) / gcdInt(a, b);
}

function parseSide(node: MathNode, variable: string, sideSign: 1 | -1): RationalTerm[] | null {
  const out: RationalTerm[] = [];
  for (const s of summands(node)) {
    const co = coefficientOf(s.node);
    if (!co) return null;
    const core = stripParens(co.core);
    let num: Poly | null;
    let den: Poly;
    if (core.type === "OperatorNode" && fnOf(core) === "divide" && mentions(argsOf(core)[1], variable)) {
      const [a, b] = argsOf(core);
      const nt = polyTermsOf(a, variable);
      const dt = polyTermsOf(b, variable);
      num = nt && polyFromTerms(nt, variable);
      const d = dt && polyFromTerms(dt, variable);
      if (!d || deg(d) < 1) return null;
      den = d;
    } else {
      const t = polyTermsOf(core, variable);
      num = t && polyFromTerms(t, variable);
      den = [q(1)];
    }
    if (!num) return null;
    num = polyScale(num, co.k);
    // integer coefficients on top: `\frac{1}{2}` stays a fraction with 2 below
    let m = 1;
    for (const c of num) m = lcmInt(m, c.d);
    num = polyScale(num, q(m));
    den = polyScale(den, q(m));
    const fd = factorDen(den);
    if (!fd || fd.c.d !== 1) return null;
    const sign = ((s.sign * sideSign * Math.sign(fd.c.n)) as 1 | -1) || 1;
    out.push({ sign, num, den: polyScale(den, q(Math.sign(fd.c.n))), denConst: Math.abs(fd.c.n), denFactors: fd.factors });
  }
  return out;
}

/** `\frac{3}{x - 2}`, `\frac{1}{2}`, `2x`, `(x + 1)`: a term as it sits after `LCD \cdot`. */
function termTex(t: RationalTerm, variable: string): string {
  const top = polyLatex(t.num, variable);
  const whole = deg(t.den) === 0 && t.den[0].n === 1 && t.den[0].d === 1;
  if (whole) return t.num.filter((c) => !qIsZero(c)).length > 1 ? `(${top})` : top;
  return `\\frac{${top}}{${polyLatex(t.den, variable)}}`;
}

/** What is left of `LCD · term`, as a product: `3(x - 2)`, `2x`, `x(x + 1)`. */
function clearedTex(t: RationalTerm, lcdConst: number, lcd: Factor[], variable: string): { tex: string; negative: boolean } {
  const factors: Factor[] = [];
  for (const f of lcd) {
    const own = t.denFactors.find((d) => keyOf(d.f) === keyOf(f.f));
    const mult = f.mult - (own?.mult ?? 0);
    if (mult > 0) factors.push({ f: f.f, mult });
  }
  let c = q(lcdConst / t.denConst);
  const nonzero = t.num.map((coef, i) => ({ coef, i })).filter((x) => !qIsZero(x.coef));
  if (nonzero.length === 1) {
    c = qMul(c, nonzero[0].coef);
    if (nonzero[0].i > 0) factors.push({ f: X, mult: nonzero[0].i });
  } else if (nonzero.length > 1) {
    // the whole numerator, nothing to multiply it by: `x + 1`, not `(x + 1)`
    if (factors.length === 0 && c.n === 1 && c.d === 1) return { tex: polyLatex(t.num, variable), negative: t.sign < 0 };
    const { content, prim } = primitive(t.num);
    c = qMul(c, content);
    factors.push({ f: prim, mult: 1 });
  } else c = q(0);
  const negative = (c.n < 0) !== (t.sign < 0);
  const mag = { n: Math.abs(c.n), d: c.d };
  return { tex: productLatex(mag, factors, variable), negative };
}

function joinSigned(parts: Array<{ tex: string; negative: boolean }>): string {
  let out = "";
  for (const p of parts) {
    if (!out) out = p.negative ? `-${p.tex}` : p.tex;
    else out += ` ${p.negative ? "-" : "+"} ${p.tex}`;
  }
  return out || "0";
}

export function rationalEquationSteps(rel: ParsedRelation, ctx: SolveContext): Solution | null {
  return exactly(() => {
    const v = rel.variable;
    const L = parseSide(rel.lhs, v, 1);
    const R = parseSide(rel.rhs, v, 1);
    if (!L || !R || L.length === 0 || R.length === 0) return null;
    const all = [...L, ...R];
    if (!all.some((t) => deg(t.den) >= 1)) return null;

    // the LCD: the largest power of every factor, and the lcm of the numbers
    let lcdConst = 1;
    const lcd = new Map<string, Factor>();
    for (const t of all) {
      lcdConst = lcmInt(lcdConst, t.denConst);
      for (const f of t.denFactors) {
        const k = keyOf(f.f);
        const seen = lcd.get(k);
        if (!seen || seen.mult < f.mult) lcd.set(k, { f: f.f, mult: f.mult });
      }
    }
    const lcdFactors = [...lcd.values()];
    const lcdTex = productLatex(q(lcdConst), lcdFactors, v);

    const zeros: Q[] = [];
    for (const t of all) {
      const fd = factorDen(t.den);
      for (const z of fd?.zeros ?? []) if (!zeros.some((o) => o.n === z.n && o.d === z.d)) zeros.push(z);
    }
    zeros.sort((a, b) => qNum(a) - qNum(b));

    const w = new StepWriter(ctx.normalize, rel.latex);
    if (zeros.length > 0) w.write(zeros.map((z) => `${v} \\neq ${qLatex(z)}`).join(LIST_SEP));
    const times = (ts: RationalTerm[]) => joinSigned(ts.map((t) => ({ tex: `${lcdTex} \\cdot ${termTex(t, v)}`, negative: t.sign < 0 })));
    w.write(`${times(L)} = ${times(R)}`, true);
    const cleared = `${joinSigned(L.map((t) => clearedTex(t, lcdConst, lcdFactors, v)))} = ${joinSigned(R.map((t) => clearedTex(t, lcdConst, lcdFactors, v)))}`;
    w.write(cleared);
    const sol = ctx.solve(cleared);
    if (!sol || !sol.roots) return null;
    w.writeAll(sol.steps);
    const kept = sol.roots.filter((r) => !zeros.some((z) => Math.abs(qNum(z) - r.value) < 1e-9));
    if (kept.length !== sol.roots.length || sol.roots.length === 0) w.write(rootsLine(v, kept));
    const final = w.last ?? NO_SOLUTION;
    return { steps: w.lines(), final, roots: kept };
  });
}
