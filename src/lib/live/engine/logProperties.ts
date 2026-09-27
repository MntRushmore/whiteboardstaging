/**
 * Properties of logarithms (F-LE.4, F-BF.5, A-SSE.2), exact:
 *
 *   \log(x^{2}y)               2\log x + \log y        \log_{2} 8 + \log_{2} 4     \log_{3} 7
 *   = \log x^{2} + \log y      = \log x^{2} + \log y   = \log_{2}(8 \cdot 4)       = \frac{\ln 7}{\ln 3}
 *   = 2\log x + \log y         = \log(x^{2}y)          = \log_{2} 32
 *                                                      = 5
 *
 * A single log of a product / quotient / power is EXPANDED (product and quotient rules, then the
 * power rule, then any log of a number worked out); several logs of one base are CONDENSED (the
 * power rule inwards, then one log). A log of a number is written as a power of its base when it
 * is one (`\log_{2} 2^{3}` → `3`), otherwise by the change of base (`\frac{\ln 7}{\ln 3}`).
 *
 * Exponential equations over bases with no common one (`3^{x} = 2^{x + 1}`) take the log of both
 * sides: `x\ln 3 = (x + 1)\ln 2` … `x = \frac{\ln 2}{\ln 3 - \ln 2}`, exact. Every line is
 * checked numerically against the question.
 */
import type { MathNode } from "mathjs";
import { q, qAdd, qDiv, qMul, qNeg, type Q } from "./algebra";
import { chainAgrees, equationHolds, parseExpr, printNode, splitEquation, type CourseDeps } from "./courseKit";
import { argsOf, coefficientOf, constantValue, fnOf, polyOf, stripParens, summands } from "./nodes";
import { exactly, qIsZero } from "./poly";
import { StepWriter } from "./solution";

type AnyNode = MathNode & { value?: unknown; name?: string };

/** e (`\ln`), 10 (`\log`) or a whole number base (`\log_{2}`). */
type Base = "e" | number;

interface LogTerm {
  k: Q;
  base: Base;
  arg: MathNode;
}

const qTex = (a: Q): string => (a.d === 1 ? String(a.n) : `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`);
const isOne = (a: Q) => a.n === 1 && a.d === 1;

function logOf(node: MathNode): { base: Base; arg: MathNode } | null {
  const n = stripParens(node);
  if (n.type !== "FunctionNode") return null;
  const f = fnOf(n);
  const a = argsOf(n);
  if (f === "log" && a.length === 1) return { base: "e", arg: a[0] };
  if (f === "log10" && a.length === 1) return { base: 10, arg: a[0] };
  if (f === "log" && a.length === 2) {
    const b = constantValue(a[1]);
    if (!b || b.d !== 1 || b.n < 2) return null;
    return { base: b.n, arg: a[0] };
  }
  return null;
}

function termsOf(node: MathNode): LogTerm[] | null {
  const out: LogTerm[] = [];
  for (const s of summands(node)) {
    const co = coefficientOf(s.node);
    if (!co) return null;
    const log = logOf(co.core);
    if (!log) return null;
    out.push({ k: s.sign < 0 ? qNeg(co.k) : co.k, base: log.base, arg: log.arg });
  }
  return out;
}

const sameBase = (a: Base, b: Base) => a === b;

function logName(base: Base): string {
  return base === "e" ? "\\ln" : base === 10 ? "\\log" : `\\log_{${base}}`;
}

/** `\log x`, `\log x^{2}`, `\log_{2}(8x)`, `\ln\frac{x}{y}`. */
function logTex(base: Base, argTex: string, bare: boolean): string {
  return bare ? `${logName(base)} ${argTex}` : `${logName(base)}(${argTex})`;
}

function isBareArg(node: MathNode): boolean {
  const n = stripParens(node) as AnyNode;
  if (n.type === "SymbolNode" || n.type === "ConstantNode") return true;
  if (n.type === "OperatorNode" && fnOf(n) === "pow") {
    const b = stripParens(argsOf(n)[0]) as AnyNode;
    return b.type === "SymbolNode" || b.type === "ConstantNode";
  }
  if (n.type === "OperatorNode" && fnOf(n) === "divide") return true;
  return false;
}

function argTexOf(node: MathNode): string | null {
  return printNode(stripParens(node));
}

/** `2\log x`, `-\ln y`, `\frac{1}{2}\log x` as a term of a longer line. */
function termTex(t: LogTerm, first: boolean, argTex: string, bare: boolean): string {
  const mag: Q = { n: Math.abs(t.k.n), d: t.k.d };
  const coef = isOne(mag) ? "" : qTex(mag);
  const body = `${coef}${logTex(t.base, argTex, bare)}`;
  if (first) return `${t.k.n < 0 ? "-" : ""}${body}`;
  return ` ${t.k.n < 0 ? "-" : "+"} ${body}`;
}

// ---------------------------------------------------------------- a log of a number

/** `8` is `2^{3}` in base 2; `\frac{1}{8}` is `2^{-3}`; null when it is no power of the base. */
function exponentIn(base: number, x: Q): Q | null {
  if (x.n <= 0) return null;
  for (let p = -12; p <= 30; p++) {
    if (base ** Math.abs(p) > 1e12) continue;
    const v = p >= 0 ? q(base ** p) : q(1, base ** -p);
    if (v.n === x.n && v.d === x.d) return q(p);
  }
  // fractional: base^(m/n) = x when x^n = base^m (8 in base 4: 8^2 = 4^3)
  for (let d = 2; d <= 4; d++) {
    for (let m = -12; m <= 24; m++) {
      if (m % d === 0 || base ** Math.abs(m) > 1e12) continue;
      const left = x.n ** d / x.d ** d;
      const right = m >= 0 ? base ** m : 1 / base ** -m;
      if (Math.abs(left - right) < 1e-9 * Math.max(1, right)) return q(m, d);
    }
  }
  return null;
}

/**
 * `\log_{2} 8` → [`\log_{2} 2^{3}`, `3`]; `\log_{4} 8` → [`\frac{\log_{2} 8}{\log_{2} 4}`, `\frac{3}{2}`];
 * `\log_{3} 7` → [`\frac{\ln 7}{\ln 3}`] (the change of base, exact). Null for a base e / 10 value
 * that is no power (the calculator's job).
 */
function numericLog(base: Base, x: Q, w: StepWriter): Q | "exact-form" | null {
  if (base === "e") return null;
  const e = exponentIn(base, x);
  const xTex = qTex(x);
  if (e && e.d === 1) {
    w.write(`${logName(base)} ${base}^{${qTex(e)}}`);
    w.write(qTex(e));
    return e;
  }
  if (e) {
    // a common base: the smallest base both are whole powers of
    for (const c of [2, 3, 5, 7, 10]) {
      const eb = exponentIn(c, q(base));
      const ex = exponentIn(c, x);
      if (eb && ex && eb.d === 1 && ex.d === 1) {
        w.write(`\\frac{\\log_{${c}} ${xTex}}{\\log_{${c}} ${base}}`);
        w.write(`\\frac{${qTex(ex)}}{${qTex(eb)}}`);
        w.write(qTex(e));
        return e;
      }
    }
    return null;
  }
  if (base === 10 || x.d !== 1) return null;
  w.write(`\\frac{\\ln ${xTex}}{\\ln ${base}}`);
  return "exact-form";
}

// ---------------------------------------------------------------- expand / condense

interface ArgFactor {
  node: MathNode;
  /** the base the power is of, and the power (a root is a fractional power) */
  inner: MathNode;
  power: Q;
  below: boolean;
}

function argFactors(node: MathNode, below = false, out: ArgFactor[] = []): ArgFactor[] | null {
  const n = stripParens(node);
  const f = fnOf(n);
  const a = argsOf(n);
  if (n.type === "OperatorNode" && f === "multiply") return argFactors(a[0], below, out) && argFactors(a[1], below, out);
  if (n.type === "OperatorNode" && f === "divide") return argFactors(a[0], below, out) && argFactors(a[1], !below, out);
  const base = (m: MathNode) => {
    const s = stripParens(m) as AnyNode;
    return s.type === "SymbolNode" || s.type === "ConstantNode";
  };
  if (base(n)) {
    out.push({ node: n, inner: n, power: q(1), below });
    return out;
  }
  if (n.type === "OperatorNode" && f === "pow" && base(a[0])) {
    const e = constantValue(a[1]);
    if (!e) return null;
    out.push({ node: n, inner: stripParens(a[0]), power: e, below });
    return out;
  }
  if (n.type === "FunctionNode" && f === "sqrt" && base(a[0])) {
    out.push({ node: n, inner: stripParens(a[0]), power: q(1, 2), below });
    return out;
  }
  return null;
}

function expandSteps(deps: CourseDeps, t: LogTerm, input: string): string[] | null {
  if (!isOne(t.k)) return null;
  const factors = argFactors(t.arg);
  if (!factors || factors.length === 0) return null;
  const compound = factors.length > 1 || factors.some((f) => !isOne(f.power));
  if (!compound) return null;
  // a single power of a number is a number (`\log_{2} 8^{3}`): not an expansion
  if (factors.every((f) => stripParens(f.inner).type === "ConstantNode")) return null;
  const w = new StepWriter(deps.normalize, input);
  const piece = (f: ArgFactor): string | null => {
    const inner = argTexOf(f.inner);
    if (!inner) return null;
    if (isOne(f.power)) return inner;
    return `${inner}^{${qTex(f.power)}}`;
  };
  // product and quotient rules (a root as its power)
  const line1: string[] = [];
  for (const [i, f] of factors.entries()) {
    const p = piece(f);
    if (!p) return null;
    const lt = logTex(t.base, p, true);
    line1.push(i === 0 ? `${f.below ? "-" : ""}${lt}` : ` ${f.below ? "-" : "+"} ${lt}`);
  }
  if (factors.length > 1 || factors.some((f) => fnOf(stripParens(f.node)) === "sqrt")) w.write(line1.join(""));
  // the power rule
  const line2: string[] = [];
  const numbers: Array<{ i: number; value: Q }> = [];
  for (const [i, f] of factors.entries()) {
    const inner = argTexOf(f.inner);
    if (!inner) return null;
    const k: Q = f.below ? qNeg(f.power) : f.power;
    const lt: LogTerm = { k, base: t.base, arg: f.inner };
    line2.push(termTex(lt, i === 0, inner, true));
    const c = constantValue(f.inner);
    if (c) numbers.push({ i, value: c });
  }
  w.write(line2.join(""));
  // a log of a number worked out (`\log_{2} 8` → 3, `\ln e` → 1)
  const line3: string[] = [];
  let changed = false;
  let constant = q(0);
  const rest: string[] = [];
  for (const [i, f] of factors.entries()) {
    const k: Q = f.below ? qNeg(f.power) : f.power;
    const s = stripParens(f.inner) as AnyNode;
    let value: Q | null = null;
    if (s.type === "SymbolNode" && s.name === "e" && t.base === "e") value = q(1);
    const c = numbers.find((x) => x.i === i);
    if (c && t.base !== "e") {
      const e = exponentIn(t.base, c.value);
      if (e) value = e;
    }
    if (value) {
      constant = qAdd(constant, qMul(k, value));
      changed = true;
      continue;
    }
    const inner = argTexOf(f.inner)!;
    rest.push(termTex({ k, base: t.base, arg: f.inner }, rest.length === 0 && qIsZero(constant) && line3.length === 0, inner, true));
  }
  if (changed) {
    let line = qIsZero(constant) ? "" : qTex(constant);
    for (const r of rest) {
      const trimmed = r.trim();
      line = !line ? trimmed : trimmed.startsWith("-") ? `${line} - ${trimmed.slice(1).trim()}` : `${line} + ${trimmed.replace(/^\+\s*/, "")}`;
    }
    w.write(line || "0");
  }
  const lines = w.lines();
  return lines.length > 0 && chainAgrees(deps, input, lines, { positive: true }) ? lines : null;
}

function condenseSteps(deps: CourseDeps, ts: LogTerm[], input: string): string[] | null {
  if (ts.length < 2 || !ts.every((t) => sameBase(t.base, ts[0].base))) return null;
  const base = ts[0].base;
  const w = new StepWriter(deps.normalize, input);
  // the power rule inwards: `2\log x` → `\log x^{2}`
  const powered: Array<{ tex: string; below: boolean; value: Q | null; node: MathNode }> = [];
  for (const t of ts) {
    const mag: Q = { n: Math.abs(t.k.n), d: t.k.d };
    const inner = argTexOf(t.arg);
    if (!inner) return null;
    const bare = isBareArg(t.arg);
    const withPower = isOne(mag) ? inner : bare && !/\^/.test(inner) ? `${inner}^{${qTex(mag)}}` : `(${inner})^{${qTex(mag)}}`;
    const c = constantValue(t.arg);
    const value = c && mag.d === 1 ? qPowQ(c, mag.n) : null;
    powered.push({ tex: withPower, below: t.k.n < 0, value, node: t.arg });
  }
  if (ts.some((t) => !isOne({ n: Math.abs(t.k.n), d: t.k.d }))) {
    w.write(powered.map((p, i) => (i === 0 ? `${p.below ? "-" : ""}${logTex(base, p.tex, true)}` : ` ${p.below ? "-" : "+"} ${logTex(base, p.tex, true)}`)).join(""));
  }
  // one log: a product over a quotient
  const top = powered.filter((p) => !p.below);
  const bottom = powered.filter((p) => p.below);
  if (top.length === 0) return null;
  const numeric = powered.every((p) => p.value);
  const join = (ps: typeof powered) => (numeric ? ps.map((p) => p.tex).join(" \\cdot ") : ps.map((p) => p.tex).join(""));
  const topTex = join(top);
  const argTex = bottom.length ? `\\frac{${topTex}}{${join(bottom)}}` : topTex;
  const bare = bottom.length > 0 || top.length === 1;
  w.write(logTex(base, argTex, bare));
  if (numeric) {
    let value = q(1);
    for (const p of powered) value = p.below ? qDiv(value, p.value!) : qMul(value, p.value!);
    w.write(logTex(base, qTex(value), value.d === 1));
    numericLog(base, value, w);
  }
  const lines = w.lines();
  return lines.length > 0 && chainAgrees(deps, input, lines, { positive: true }) ? lines : null;
}

function qPowQ(a: Q, k: number): Q {
  let out = q(1);
  for (let i = 0; i < k; i++) out = qMul(out, a);
  return out;
}

/** Log-property steps for an expression, or null when it is not a sum of logs this handles. */
export function logSteps(deps: CourseDeps, node: MathNode, input: string): string[] | null {
  try {
    return exactly(() => {
      const ts = termsOf(node);
      if (!ts || ts.length === 0) return null;
      if (ts.length === 1) {
        const t = ts[0];
        const c = constantValue(t.arg);
        if (c && isOne(t.k)) {
          const w = new StepWriter(deps.normalize, input);
          const r = numericLog(t.base, c, w);
          if (!r) return null;
          const lines = w.lines();
          return lines.length > 0 && chainAgrees(deps, input, lines) ? lines : null;
        }
        return expandSteps(deps, t, input);
      }
      return condenseSteps(deps, ts, input);
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- exponential equations

interface Power {
  base: Q;
  /** the exponent a·x + c */
  a: Q;
  c: Q;
}

function powerOf(node: MathNode, v: string): Power | null {
  const n = stripParens(node);
  if (n.type !== "OperatorNode" || fnOf(n) !== "pow") return null;
  const b = constantValue(argsOf(n)[0]);
  if (!b || b.n <= 0 || (b.n === b.d)) return null;
  const e = polyOf(argsOf(n)[1], v);
  if (!e || e.length !== 2) return null;
  return { base: b, a: e[1], c: e[0] };
}

/** Is there a common base (b1^m = b2^n for small m, n)? Then the powers are rewritten, not logged. */
function commonBase(a: Q, b: Q): boolean {
  for (let m = 1; m <= 6; m++) {
    for (let n = 1; n <= 6; n++) {
      if (Math.abs(m * Math.log(a.n / a.d) - n * Math.log(b.n / b.d)) < 1e-12) return true;
    }
  }
  return false;
}

/** `x\ln 3`, `2x\ln 3`, `-x\ln 3` (coef·x·ln b) and `\ln 2`, `-3\ln 2` (coef·ln b). */
function lnTerm(k: Q, x: string, lnb: string, first: boolean): string {
  const mag: Q = { n: Math.abs(k.n), d: k.d };
  const coef = isOne(mag) ? "" : qTex(mag);
  const body = `${coef}${x}${lnb}`;
  return first ? `${k.n < 0 ? "-" : ""}${body}` : ` ${k.n < 0 ? "-" : "+"} ${body}`;
}

function linearTex(a: Q, c: Q, x: string): string {
  const parts: string[] = [];
  if (!qIsZero(a)) parts.push(lnTerm(a, x, "", true));
  if (!qIsZero(c)) parts.push(parts.length ? ` ${c.n < 0 ? "-" : "+"} ${qTex({ n: Math.abs(c.n), d: c.d })}` : qTex(c));
  return parts.join("") || "0";
}

/**
 * `3^{x} = 2^{x + 1}`: both sides' logs, the power rule, the unknown collected and factored out.
 * Null unless each side is one power of a different base with no common one and a linear exponent.
 */
export function differentBasesSteps(deps: CourseDeps, latex: string): { latex: string; steps: string[] } | null {
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
          const name = (x as AnyNode).name ?? "";
          if (x.type === "SymbolNode" && !["e", "pi", "i"].includes(name)) letters.add(name);
        });
      if (letters.size !== 1) return null;
      const v = [...letters][0];
      const p = powerOf(L, v);
      const r = powerOf(R, v);
      if (!p || !r || commonBase(p.base, r.base)) return null;
      if (p.base.d !== 1 || r.base.d !== 1) return null;
      const ln1 = `\\ln ${p.base.n}`;
      const ln2 = `\\ln ${r.base.n}`;
      const w = new StepWriter(deps.normalize, latex);
      w.write(`\\ln ${p.base.n}^{${linearTex(p.a, p.c, v)}} = \\ln ${r.base.n}^{${linearTex(r.a, r.c, v)}}`);
      const side = (x: Power, ln: string) => {
        if (qIsZero(x.c)) return lnTerm(x.a, v, ln, true);
        if (qIsZero(x.a)) return `${qTex(x.c)}${ln}`;
        return `(${linearTex(x.a, x.c, v)})${ln}`;
      };
      w.write(`${side(p, ln1)} = ${side(r, ln2)}`);
      const expand = (x: Power, ln: string) => {
        const parts: string[] = [];
        if (!qIsZero(x.a)) parts.push(lnTerm(x.a, v, ln, true));
        if (!qIsZero(x.c)) parts.push(lnTerm(x.c, "", ln, parts.length === 0));
        return parts.join("");
      };
      w.write(`${expand(p, ln1)} = ${expand(r, ln2)}`);
      // unknowns left, logs of numbers right
      const left = [lnTerm(p.a, v, ln1, true), lnTerm(qNeg(r.a), v, ln2, false)].join("");
      const rightParts: string[] = [];
      if (!qIsZero(r.c)) rightParts.push(lnTerm(r.c, "", ln2, true));
      if (!qIsZero(p.c)) rightParts.push(lnTerm(qNeg(p.c), "", ln1, rightParts.length === 0));
      const right = rightParts.join("") || "0";
      w.write(`${left} = ${right}`);
      const factor = [lnTerm(p.a, "", ln1, true), lnTerm(qNeg(r.a), "", ln2, false)].join("");
      w.write(`${v}(${factor}) = ${right}`);
      const final = `${v} = \\frac{${right}}{${factor}}`;
      w.write(final);
      const steps = w.lines();
      // the check: the answer makes both sides equal
      const value = (Math.log(r.base.n) * qN(r.c) - Math.log(p.base.n) * qN(p.c)) / (Math.log(p.base.n) * qN(p.a) - Math.log(r.base.n) * qN(r.a));
      if (!Number.isFinite(value)) return null;
      if (!equationHolds(deps, latex, { [v]: value })) return null;
      for (const s of steps) if (equationHolds(deps, s, { [v]: value }) === false) return null;
      return { latex: final, steps };
    });
  } catch {
    return null;
  }
}

const qN = (a: Q): number => a.n / a.d;

/**
 * `x = \log_{5} 7` as an answer gets its change of base, `x = \frac{\ln 7}{\ln 5}` — the exact
 * form a calculator takes. Anything else is returned as it is.
 */
export function withChangeOfBase<T extends { latex: string; steps: string[] }>(r: T): T {
  const m = /^([a-zA-Z]) = \\log_\{(\d+)\} (\d+)$/.exec(r.latex);
  if (!m || m[2] === "10") return r;
  const final = `${m[1]} = \\frac{\\ln ${m[3]}}{\\ln ${m[2]}}`;
  return { ...r, latex: final, steps: [...r.steps, final] };
}

