/**
 * Exponential and logarithmic equations, exact:
 *
 *   2^x = 8            4^x = 8                e^x = 5        5^x = 7            \log_2 x = 5
 *   2^{x} = 2^{3}      (2^{2})^{x} = 2^{3}    x = \ln 5      x = \log_{5} 7     x = 2^{5}
 *   x = 3              2^{2x} = 2^{3}                                           x = 32
 *                      2x = 3
 *                      x = \frac{3}{2}
 *
 *   \log x + \log(x - 3) = 1
 *   x > 3                                 where every log is defined
 *   \log(x(x - 3)) = 1                    the logs combined
 *   x(x - 3) = 10^{1}                     exponential form
 *   … the quadratic's steps …
 *   x = -2, \ x = 5
 *   x = 5                                 the root outside `x > 3` dropped
 *
 * Powers of one base are written over their common base; otherwise the answer is the exact
 * logarithm (`\ln 5`, `\log_{5} 7`), never a decimal. A power equal to a number `\le 0` is
 * `\varnothing`. Null for anything mixed (a power and a log, two different bases with no common
 * one, a log with a coefficient beside another log).
 */
import type { MathNode } from "mathjs";
import { q, qDiv, qLatex, qMul, qNeg, termsLatex, type Q, type Term } from "./algebra";
import type { ParsedRelation, SolveContext } from "./advanced";
import { argsOf, coefficientOf, constantValue, fnOf, mentions, polyTermsOf, stripParens, summands } from "./nodes";
import { ONE, deg, exactly, polyFromTerms, polyScale, productLatex, qEq, qIsZero, qNum, qPow, qSub, termsAsWritten, type Poly } from "./poly";
import { NO_SOLUTION, StepWriter, rootsLine, type Root, type Solution } from "./solution";

type Base = "e" | Q;

interface PowerTerm {
  k: Q;
  base: Base;
  exponent: Term[];
  poly: Poly;
}

interface LogTerm {
  k: Q;
  base: Base;
  arg: Term[];
  poly: Poly;
}

interface Side {
  powers: PowerTerm[];
  logs: LogTerm[];
  rest: Term[];
}

const negate = (ts: Term[]): Term[] => ts.map((t) => ({ c: qNeg(t.c), vars: t.vars }));
const sameBase = (a: Base, b: Base): boolean => (a === "e" || b === "e" ? a === b : qEq(a, b));
const baseValue = (b: Base): number => (b === "e" ? Math.E : qNum(b));

function baseOf(node: MathNode): Base | null {
  const n = stripParens(node);
  if (n.type === "SymbolNode" && (n as MathNode & { name: string }).name === "e") return "e";
  const v = constantValue(n);
  if (!v || v.n <= 0 || qEq(v, ONE)) return null;
  return v;
}

function parseSide(node: MathNode, variable: string): Side | null {
  const side: Side = { powers: [], logs: [], rest: [] };
  for (const s of summands(node)) {
    const co = coefficientOf(s.node);
    if (!co) return null;
    const k = s.sign < 0 ? qNeg(co.k) : co.k;
    const core = stripParens(co.core);
    const f = fnOf(core);
    const args = argsOf(core);
    if (core.type === "OperatorNode" && f === "pow" && mentions(args[1], variable)) {
      const base = baseOf(args[0]);
      const exponent = polyTermsOf(args[1], variable);
      const poly = exponent && polyFromTerms(exponent, variable);
      if (!base || !exponent || !poly || mentions(args[0], variable)) return null;
      side.powers.push({ k, base, exponent, poly });
      continue;
    }
    if (core.type === "FunctionNode" && f === "exp" && args.length === 1) {
      const exponent = polyTermsOf(args[0], variable);
      const poly = exponent && polyFromTerms(exponent, variable);
      if (!exponent || !poly) return null;
      side.powers.push({ k, base: "e", exponent, poly });
      continue;
    }
    if (core.type === "FunctionNode" && ["log", "log10", "log2"].includes(f)) {
      let base: Base | null = f === "log10" ? q(10) : f === "log2" ? q(2) : args.length === 2 ? baseOf(args[1]) : "e";
      if (f === "log" && args.length > 2) base = null;
      const arg = polyTermsOf(args[0], variable);
      const poly = arg && polyFromTerms(arg, variable);
      if (!base || !arg || !poly) return null;
      if (deg(poly) < 1) {
        // `\log_2 8` beside the unknown: a number, when it is a whole one; `\ln 9` stays a log
        const value = poly[0] ?? q(0);
        if (value.n <= 0) return null;
        const whole = exactLog(base, value);
        if (whole === null) side.logs.push({ k, base, arg, poly });
        else side.rest.push({ c: qMul(k, q(whole)), vars: {} });
        continue;
      }
      side.logs.push({ k, base, arg, poly });
      continue;
    }
    const t = polyTermsOf(s.node, variable);
    if (!t) return null;
    side.rest.push(...(s.sign < 0 ? negate(t) : t));
  }
  return side;
}

/** `k` with `base^k = value` for a whole `k` (|k| ≤ 40), or null. */
function exactLog(base: Base, value: Q): number | null {
  if (base === "e") return qEq(value, ONE) ? 0 : null;
  for (let k = -40; k <= 40; k++) {
    const p = exactly(() => qPow(base, k));
    if (p && qEq(p, value)) return k;
  }
  return null;
}

/** `b = r^m` with the smallest whole `r`: 8 → 2^3, 9 → 3^2, `\frac{1}{4}` → 2^{-2}. */
function rootBase(b: Q): { r: number; m: number } | null {
  const whole = (n: number): { r: number; m: number } => {
    for (let m = 40; m >= 2; m--) {
      const r = Math.round(Math.pow(n, 1 / m));
      for (const c of [r - 1, r, r + 1]) if (c >= 2 && Math.pow(c, m) === n) return { r: c, m };
    }
    return { r: n, m: 1 };
  };
  if (b.d === 1 && b.n >= 2) return whole(b.n);
  if (b.n === 1 && b.d >= 2) {
    const w = whole(b.d);
    return { r: w.r, m: -w.m };
  }
  return null;
}

/** `v = r^k` for a whole `k` (1 is `r^0`), or null. */
function powerOf(v: Q, r: number): number | null {
  return exactLog(q(r), v);
}

function baseTex(b: Base): string {
  if (b === "e") return "e";
  return b.d === 1 ? String(b.n) : `\\left(${qLatex(b)}\\right)`;
}

/** `2^{x + 1}`, `e^{2}`; `e` itself for `e^{1}`. */
const powTex = (b: Base, exponent: string): string => (b === "e" && exponent === "1" ? "e" : `${baseTex(b)}^{${exponent}}`);

function logName(b: Base): string {
  if (b === "e") return "\\ln";
  if (qEq(b, q(10))) return "\\log";
  return `\\log_{${qLatex(b)}}`;
}

/** `\ln x`, `\log_{2}(x - 3)`: brackets unless the argument is the bare unknown. */
function logTex(b: Base, arg: string, bare: boolean): string {
  return bare ? `${logName(b)} ${arg}` : `${logName(b)}(${arg})`;
}

const isBare = (terms: Term[]): boolean => terms.length === 1 && qEq(terms[0].c, ONE) && Object.values(terms[0].vars).every((p) => p === 1);

function coefTex(k: Q): string {
  if (qEq(k, ONE)) return "";
  if (qEq(k, q(-1))) return "-";
  return qLatex(k);
}

/**
 * `αx + β = S` for an exact symbol `S` (`\ln 5`, `\log_{3} 7`): `αx = S - β`, then `x = \frac{S - β}{α}`.
 * `value` is the numeric value of `S`.
 */
function symbolicLinear(E: Poly, variable: string, S: string, value: number, w: StepWriter): Root | null {
  if (deg(E) !== 1) return null;
  const [beta, alpha] = [E[0], E[1]];
  let rhs = S;
  if (!qIsZero(beta)) {
    rhs = `${S} ${beta.n < 0 ? "+" : "-"} ${qLatex({ n: Math.abs(beta.n), d: beta.d })}`;
    w.write(`${termsLatex([{ c: alpha, vars: { [variable]: 1 } }])} = ${rhs}`);
  }
  let final = `${variable} = ${rhs}`;
  if (!qEq(alpha, ONE)) {
    const a = { n: Math.abs(alpha.n), d: alpha.d };
    const sign = alpha.n < 0 ? "-" : "";
    final = qEq(a, ONE) ? `${variable} = ${sign}${qIsZero(beta) ? S : `(${rhs})`}` : `${variable} = ${sign}\\frac{${rhs}}{${qLatex(a)}}`;
  }
  w.write(final);
  return { latex: final.slice(final.indexOf("=") + 1).trim(), value: (value - qNum(beta)) / qNum(alpha) };
}

function done(w: StepWriter, roots: Root[]): Solution {
  return { steps: w.lines(), final: w.last ?? NO_SOLUTION, roots };
}

/** Follows an exponent (or argument) equation through the engine's own steps. */
function follow(line: string, ctx: SolveContext, w: StepWriter): Root[] | null {
  w.write(line);
  const sol = ctx.solve(line);
  if (!sol || !sol.roots) return null;
  w.writeAll(sol.steps);
  if (sol.roots.length === 0 && w.last !== NO_SOLUTION) w.write(NO_SOLUTION);
  return sol.roots;
}

// --- exponentials ---------------------------------------------------------------------

/** `k b^{E} + c = d`. */
function onePower(p: PowerTerm, c: Q, d: Q, variable: string, ctx: SolveContext, w: StepWriter): Solution | null {
  const E = termsAsWritten(p.exponent);
  const pow = powTex(p.base, E);
  if (!qIsZero(c)) w.write(`${coefTex(p.k)}${pow} = ${qLatex(qSub(d, c))}`);
  const v = qDiv(qSub(d, c), p.k);
  w.write(`${pow} = ${qLatex(v)}`);
  if (v.n <= 0) {
    w.write(NO_SOLUTION);
    return done(w, []);
  }
  if (p.base !== "e") {
    const rb = rootBase(p.base);
    const n = rb && powerOf(v, rb.r);
    if (rb && n !== null) {
      if (rb.m === 1) w.write(`${pow} = ${powTex(p.base, String(n))}`);
      else {
        w.write(`\\left(${rb.r}^{${rb.m}}\\right)^{${E}} = ${rb.r}^{${n}}`, true);
        const mE = termsLatex(polyTermsExpanded(polyScale(p.poly, q(rb.m)), variable));
        w.write(`${rb.r}^{${mE}} = ${rb.r}^{${n}}`);
      }
      const expLine = `${rb.m === 1 ? E : termsLatex(polyTermsExpanded(polyScale(p.poly, q(rb.m)), variable))} = ${n}`;
      const roots = follow(expLine, ctx, w);
      return roots ? done(w, roots) : null;
    }
  }
  if (qEq(v, ONE)) {
    const roots = follow(`${E} = 0`, ctx, w);
    return roots ? done(w, roots) : null;
  }
  const S = `${logName(p.base)} ${qLatex(v)}`;
  const value = Math.log(qNum(v)) / Math.log(baseValue(p.base));
  if (deg(p.poly) !== 1) return null;
  if (isBare(p.exponent)) {
    const final = `${variable} = ${S}`;
    w.write(final);
    return done(w, [{ latex: S, value }]);
  }
  w.write(`${E} = ${S}`);
  const root = symbolicLinear(p.poly, variable, S, value, w);
  return root ? done(w, [root]) : null;
}

/** Terms of a polynomial, highest power first (for `2x + 2` from `2(x + 1)`). */
function polyTermsExpanded(p: Poly, variable: string): Term[] {
  const out: Term[] = [];
  for (let i = p.length - 1; i >= 0; i--) if (!qIsZero(p[i])) out.push({ c: p[i], vars: i === 0 ? {} : { [variable]: i } });
  return out;
}

/** `b1^{E1} = b2^{E2}`: over a common base, then the exponents equal. */
function twoPowers(a: PowerTerm, b: PowerTerm, variable: string, ctx: SolveContext, w: StepWriter): Solution | null {
  if (!qEq(a.k, ONE) || !qEq(b.k, ONE)) return null;
  let left: Poly = a.poly;
  let right: Poly = b.poly;
  if (!sameBase(a.base, b.base)) {
    if (a.base === "e" || b.base === "e") return null;
    const ra = rootBase(a.base);
    const rb = rootBase(b.base);
    if (!ra || !rb || ra.r !== rb.r) return null;
    left = polyScale(a.poly, q(ra.m));
    right = polyScale(b.poly, q(rb.m));
    const lt = termsLatex(polyTermsExpanded(left, variable));
    const rt = termsLatex(polyTermsExpanded(right, variable));
    w.write(`${ra.r}^{${lt}} = ${ra.r}^{${rt}}`);
    const roots = follow(`${lt} = ${rt}`, ctx, w);
    return roots ? done(w, roots) : null;
  }
  const roots = follow(`${termsAsWritten(a.exponent)} = ${termsAsWritten(b.exponent)}`, ctx, w);
  return roots ? done(w, roots) : null;
}

// --- logarithms ---------------------------------------------------------------------------

/** Where every (linear) log argument is positive: `x > 3`, `-1 < x < 2`; null when one is not linear. */
function domainOf(logs: LogTerm[], variable: string): { line: string; ok: (x: number) => boolean } | null {
  let lo = -Infinity;
  let hi = Infinity;
  let loTex = "";
  let hiTex = "";
  for (const l of logs) {
    if (deg(l.poly) !== 1) return null;
    const [beta, alpha] = [l.poly[0], l.poly[1]];
    const edge = qDiv(qNeg(beta), alpha);
    const e = qNum(edge);
    if (alpha.n > 0 && e > lo) {
      lo = e;
      loTex = qLatex(edge);
    }
    if (alpha.n < 0 && e < hi) {
      hi = e;
      hiTex = qLatex(edge);
    }
  }
  const ok = (x: number) => x > lo + 1e-12 && x < hi - 1e-12;
  if (lo >= hi) return { line: NO_SOLUTION, ok };
  if (hi === Infinity) return { line: `${variable} > ${loTex}`, ok };
  if (lo === -Infinity) return { line: `${variable} < ${hiTex}`, ok };
  return { line: `${loTex} < ${variable} < ${hiTex}`, ok };
}

/** One factor bare (`x - 2`), several as a product (`x(x - 3)`): the inside of a log or a fraction. */
function factorsTex(factors: Array<{ f: Poly; mult: number }>, variable: string): string {
  return factors.length === 1 && factors[0].mult === 1 ? termsLatex(polyTermsExpanded(factors[0].f, variable)) : productLatex(ONE, factors, variable);
}

/** `b^{v}` exactly (`10^{1}` → 10), or null for `e` / a fraction exponent. */
function exactPower(b: Base, v: Q): Q | null {
  if (b === "e") return qIsZero(v) ? q(1) : null;
  if (v.d !== 1 || Math.abs(v.n) > 40) return null;
  return exactly(() => qPow(b, v.n));
}

/** `k \log_b f + c = d`: isolate, exponential form, solve. Every root is valid (f = b^v > 0). */
function oneLog(l: LogTerm, c: Q, d: Q, variable: string, ctx: SolveContext, w: StepWriter): Solution | null {
  const f = termsAsWritten(l.arg);
  const log = logTex(l.base, f, isBare(l.arg));
  if (!qIsZero(c)) w.write(`${coefTex(l.k)}${log} = ${qLatex(qSub(d, c))}`);
  const v = qDiv(qSub(d, c), l.k);
  // the log already alone (`\log_2(x) = 5`): no line to restate it as `\log_{2} x = 5`
  if (!qIsZero(c) || !qEq(l.k, ONE)) w.write(`${log} = ${qLatex(v)}`);
  const power = powTex(l.base, qLatex(v));
  w.write(`${f} = ${power}`);
  const exact = exactPower(l.base, v);
  if (exact) {
    const roots = follow(`${f} = ${qLatex(exact)}`, ctx, w);
    return roots ? done(w, roots) : null;
  }
  const value = Math.pow(baseValue(l.base), qNum(v));
  if (isBare(l.arg)) return done(w, [{ latex: power, value }]);
  const root = symbolicLinear(l.poly, variable, power, value, w);
  return root ? done(w, [root]) : null;
}

/** Several logs of one base, coefficients ±1, equal to a number: domain, combine, exponential form. */
function combinedLogs(logs: LogTerm[], C: Q, variable: string, ctx: SolveContext, w: StepWriter, K: Q = ONE): Solution | null {
  const base = logs[0].base;
  if (!logs.every((l) => sameBase(l.base, base) && (qEq(l.k, ONE) || qEq(l.k, q(-1))))) return null;
  const domain = domainOf(logs, variable);
  if (!domain) return null;
  w.write(domain.line);
  if (domain.line === NO_SOLUTION) return done(w, []);
  const factor = (l: LogTerm) => ({ f: l.poly, mult: 1 });
  const top = logs.filter((l) => l.k.n > 0);
  const bottom = logs.filter((l) => l.k.n < 0);
  if (top.length === 0) return null;
  // `K`: the logs of numbers folded in (`\log_2 x + \log_2 3` is `\log_2(3x)`)
  const topTex = qEq(K, ONE) ? factorsTex(top.map(factor), variable) : productLatex(K, top.map(factor), variable);
  const exact = exactPower(base, C);
  if (!exact) return null;
  let line: string;
  if (bottom.length === 0) {
    w.write(`${logName(base)}(${topTex}) = ${qLatex(C)}`);
    line = `${topTex} = ${powTex(base, qLatex(C))}`;
  } else {
    const bottomTex = factorsTex(bottom.map(factor), variable);
    w.write(`${logName(base)} \\frac{${topTex}}{${bottomTex}} = ${qLatex(C)}`);
    w.write(`\\frac{${topTex}}{${bottomTex}} = ${powTex(base, qLatex(C))}`);
    line = `${topTex} = ${productLatex(exact, bottom.map(factor), variable)}`;
  }
  const roots = follow(line, ctx, w);
  if (!roots) return null;
  const kept = roots.filter((r) => domain.ok(r.value));
  if (kept.length !== roots.length) w.write(rootsLine(variable, kept));
  return done(w, kept);
}

/**
 * A log's argument raised to its coefficient (the power law, `2\ln x = \ln x^{2}`): `x^{2}`,
 * `(x - 1)^{2}`, a number worked out (`2\ln 3` → `9`). Null for a coefficient that is not a
 * small positive whole number.
 */
function argToPower(l: LogTerm, variable: string): { tex: string; bare: boolean } | null {
  if (qEq(l.k, ONE)) return { tex: termsAsWritten(l.arg), bare: isBare(l.arg) || deg(l.poly) < 1 };
  if (l.k.d !== 1 || l.k.n < 2 || l.k.n > 4) return null;
  if (deg(l.poly) < 1) {
    const v = exactly(() => qPow(l.poly[0], l.k.n));
    return v ? { tex: qLatex(v), bare: true } : null;
  }
  const f = termsAsWritten(l.arg);
  return { tex: isBare(l.arg) ? `${variable}^{${l.k.n}}` : `(${f})^{${l.k.n}}`, bare: false };
}

/**
 * `\log_b f = \log_b g` → `f = g`; `2\ln x = \ln 9` → `\ln(x^{2}) = \ln 9` → `x^{2} = 9` first
 * (the power law). A root outside the domain is dropped under the domain line.
 */
function logEqualsLog(a: LogTerm, b: LogTerm, variable: string, ctx: SolveContext, normalize: (s: string) => string, input: string): Solution | null {
  if (!sameBase(a.base, b.base)) return null;
  const A = argToPower(a, variable);
  const B = argToPower(b, variable);
  if (!A || !B) return null;
  const powerLaw = !qEq(a.k, ONE) || !qEq(b.k, ONE);
  const line = `${A.tex} = ${B.tex}`;
  const sol = ctx.solve(line);
  if (!sol || !sol.roots) return null;
  const logs = [a, b].filter((l) => deg(l.poly) >= 1);
  const valid = (x: number) => logs.every((l) => polyEvalNumber(l.poly, x) > 1e-12);
  const kept = sol.roots.filter((r) => valid(r.value));
  const w = new StepWriter(normalize, input);
  if (kept.length !== sol.roots.length) {
    const domain = domainOf(logs, variable);
    if (!domain) return null;
    w.write(domain.line);
  }
  if (powerLaw) w.write(`${logTex(a.base, A.tex, A.bare)} = ${logTex(b.base, B.tex, B.bare)}`);
  w.write(line);
  w.writeAll(sol.steps);
  if (kept.length !== sol.roots.length || kept.length === 0) w.write(rootsLine(variable, kept));
  return done(w, kept);
}

function polyEvalNumber(p: Poly, x: number): number {
  let out = 0;
  for (let i = p.length - 1; i >= 0; i--) out = out * x + qNum(p[i]);
  return out;
}

export function expLogSteps(rel: ParsedRelation, ctx: SolveContext): Solution | null {
  return exactly(() => {
    const v = rel.variable;
    let L = parseSide(rel.lhs, v);
    let R = parseSide(rel.rhs, v);
    if (!L || !R) return null;
    const powers = L.powers.length + R.powers.length;
    const logs = L.logs.length + R.logs.length;
    if ((powers > 0) === (logs > 0)) return null;
    const w = new StepWriter(ctx.normalize, rel.latex);
    const constantOf = (ts: Term[]): Q | null => {
      const p = polyFromTerms(ts, v);
      return p && deg(p) <= 0 ? (p[0] ?? q(0)) : null;
    };

    if (powers > 0) {
      if (L.powers.length === 1 && R.powers.length === 1 && L.rest.length === 0 && R.rest.length === 0) return twoPowers(L.powers[0], R.powers[0], v, ctx, w);
      if (L.powers.length === 0) [L, R] = [R, L];
      if (L.powers.length !== 1 || R.powers.length !== 0) return null;
      const c = constantOf(L.rest);
      const d = constantOf(R.rest);
      if (!c || !d) return null;
      return onePower(L.powers[0], c, d, v, ctx, w);
    }

    if (L.logs.length === 1 && R.logs.length === 1 && L.rest.length === 0 && R.rest.length === 0) return logEqualsLog(L.logs[0], R.logs[0], v, ctx, ctx.normalize, rel.latex);
    if (L.logs.length === 0) [L, R] = [R, L];
    const all = [...L.logs, ...R.logs.map((l) => ({ ...l, k: qNeg(l.k) }))];
    const c = constantOf(L.rest);
    const d = constantOf(R.rest);
    if (!c || !d) return null;
    if (all.some((l) => deg(l.poly) < 1)) return logsAgainstLogOfNumber(all, qSub(d, c), v, ctx, w);
    if (all.length === 1) return oneLog(all[0], c, d, v, ctx, w);
    return combinedLogs(all, qSub(d, c), v, ctx, w);
  });
}

/**
 * `\ln(x + 1) - \ln x = \ln 2`: the logs of numbers (and any number beside them) moved across as
 * ONE log of a number, the logs in x combined, then the arguments equal:
 *
 *   x > 0,  \ln \frac{x + 1}{x} = \ln 2,  \frac{x + 1}{x} = 2,  x + 1 = 2x,  …  x = 1
 *
 * `all` is every log moved to the left (Σ k log a = C). Null unless every log has one base, the
 * logs in x have coefficient ±1 and linear arguments, and the number works out exactly.
 */
function logsAgainstLogOfNumber(all: LogTerm[], C: Q, variable: string, ctx: SolveContext, w: StepWriter): Solution | null {
  const base = all[0].base;
  if (!all.every((l) => sameBase(l.base, base))) return null;
  let logs = all.filter((l) => deg(l.poly) >= 1);
  const numbers = all.filter((l) => deg(l.poly) < 1);
  if (logs.length === 0 || !logs.every((l) => qEq(l.k, ONE) || qEq(l.k, q(-1)))) return null;
  if (!qIsZero(C)) {
    // against a plain number: the logs of numbers go inside instead (`\log_2(3x) = 4`)
    let K: Q = q(1);
    for (const n of numbers) {
      if (n.k.d !== 1 || Math.abs(n.k.n) > 4) return null;
      const p = exactly(() => qPow(n.poly[0], n.k.n));
      if (!p) return null;
      K = qMul(K, p);
    }
    return combinedLogs(logs, C, variable, ctx, w, K);
  }
  // Σ k log f = C - Σ k' log c' = log(b^C · Π c'^(-k'))
  let M = exactPower(base, C);
  if (!M) return null;
  for (const n of numbers) {
    if (n.k.d !== 1 || Math.abs(n.k.n) > 4) return null;
    const p = exactly(() => qPow(n.poly[0], -n.k.n));
    if (!p) return null;
    M = qMul(M, p);
  }
  if (M.n <= 0) return null;
  // read the way it was written: the first log in x on top
  if (logs[0].k.n < 0) {
    logs = logs.map((l) => ({ ...l, k: qNeg(l.k) }));
    M = qDiv(q(1), M);
  }
  const domain = domainOf(logs, variable);
  if (!domain) return null;
  w.write(domain.line);
  if (domain.line === NO_SOLUTION) return done(w, []);
  const factor = (l: LogTerm) => ({ f: l.poly, mult: 1 });
  const top = logs.filter((l) => l.k.n > 0);
  const bottom = logs.filter((l) => l.k.n < 0);
  const topTex = factorsTex(top.map(factor), variable);
  const right = logTex(base, qLatex(M), true);
  let line: string;
  if (bottom.length === 0) {
    w.write(`${logTex(base, topTex, top.length === 1 && isBare(top[0].arg))} = ${right}`);
    line = `${topTex} = ${qLatex(M)}`;
  } else {
    const bottomTex = factorsTex(bottom.map(factor), variable);
    w.write(`${logName(base)} \\frac{${topTex}}{${bottomTex}} = ${right}`);
    w.write(`\\frac{${topTex}}{${bottomTex}} = ${qLatex(M)}`);
    line = `${topTex} = ${productLatex(M, bottom.map(factor), variable)}`;
  }
  const roots = follow(line, ctx, w);
  if (!roots) return null;
  const kept = roots.filter((r) => domain.ok(r.value));
  if (kept.length !== roots.length) w.write(rootsLine(variable, kept));
  return done(w, kept);
}
