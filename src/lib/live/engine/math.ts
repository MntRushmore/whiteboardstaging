/**
 * mathjs instance factory and small evaluation helpers shared by the engine modules.
 * The mathjs module is passed in (loaded once via `await import("mathjs")` in index.ts).
 * Pure TypeScript, no DOM.
 */
import type { MathJsInstance, MathNode, Unit } from "mathjs";
import { registerConstants } from "./constants";
import { asSmallFraction } from "./format";
import { latexToMath, type Translated, type TranslateOptions } from "./latex";

export type MathModule = typeof import("mathjs");

export interface ComplexLike {
  re: number;
  im: number;
}

export type EvalResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Simpson's rule, 1000 panels: `integral("x^2", "x", 0, 1)`. */
export function simpson(f: (x: number) => number, a: number, b: number, panels = 1000): number {
  const n = panels % 2 === 0 ? panels : panels + 1;
  const h = (b - a) / n;
  let sum = f(a) + f(b);
  for (let i = 1; i < n; i++) sum += (i % 2 === 1 ? 4 : 2) * f(a + i * h);
  return (sum * h) / 3;
}

/** An exactly-representable number: an integer or a small rational the formatter can print. */
function isRational(x: number): boolean {
  return Number.isFinite(x) && (Number.isInteger(Number(x.toPrecision(12))) || asSmallFraction(x) !== null);
}

const POLY_CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
const MAX_POLY_DEGREE = 12;

function polyAdd(a: number[], b: number[], sign: number): number[] {
  const out = new Array<number>(Math.max(a.length, b.length)).fill(0);
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) + sign * (b[i] ?? 0);
  return out;
}

function polyMul(a: number[], b: number[]): number[] | null {
  if (a.length + b.length - 2 > MAX_POLY_DEGREE) return null;
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}

/**
 * Coefficients [c0, c1, ...] of a polynomial in `variable` built only from +, -, *, /(constant),
 * unary minus and integer powers; null for anything else (sin, 1/x, x^x, other symbols, units).
 * Deliberately strict: a wrong "yes" here would turn into a wrong integral.
 */
export function polynomialCoefficients(node: MathNode, variable: string): number[] | null {
  const n = node as MathNode & { type: string; value?: unknown; name?: string; fn?: unknown; op?: string; args?: MathNode[]; content?: MathNode };
  switch (n.type) {
    case "ConstantNode": {
      const v = typeof n.value === "number" ? n.value : toNumber(n.value);
      return v === null || !Number.isFinite(v) ? null : [v];
    }
    case "SymbolNode": {
      if (n.name === variable) return [0, 1];
      const c = n.name !== undefined ? POLY_CONSTANTS[n.name] : undefined;
      return c === undefined ? null : [c];
    }
    case "ParenthesisNode":
      return n.content ? polynomialCoefficients(n.content, variable) : null;
    case "OperatorNode": {
      const args = n.args ?? [];
      if (args.length === 1 && n.op === "-") {
        const a = polynomialCoefficients(args[0], variable);
        return a ? a.map((c) => -c) : null;
      }
      if (args.length !== 2) return null;
      const a = polynomialCoefficients(args[0], variable);
      if (!a) return null;
      const b = polynomialCoefficients(args[1], variable);
      if (!b) return null;
      if (n.op === "+") return polyAdd(a, b, 1);
      if (n.op === "-") return polyAdd(a, b, -1);
      if (n.op === "*") return polyMul(a, b);
      if (n.op === "/") {
        if (b.length !== 1 || b[0] === 0) return null;
        return a.map((c) => c / b[0]);
      }
      if (n.op === "^") {
        if (b.length !== 1) return null;
        const k = b[0];
        if (!Number.isInteger(k) || k < 0 || k > MAX_POLY_DEGREE) return null;
        let out = [1];
        for (let i = 0; i < k; i++) {
          const next = polyMul(out, a);
          if (!next) return null;
          out = next;
        }
        return out;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Exact value of a definite integral whose integrand is a polynomial with rational coefficients
 * over rational limits (`\int_0^1 x^2 dx` -> 1/3). Null when any of that does not hold, which is
 * the signal to fall back to Simpson and to print a decimal.
 */
export function exactIntegral(math: MathJsInstance, expr: string, variable: string, lower: number, upper: number): number | null {
  if (!isRational(lower) || !isRational(upper)) return null;
  const node = safeParse(math, expr);
  if (!node) return null;
  const coeffs = polynomialCoefficients(node, variable);
  if (!coeffs || coeffs.length > MAX_POLY_DEGREE + 1) return null;
  if (!coeffs.every(isRational)) return null;
  const at = (x: number): number => coeffs.reduce((sum, c, k) => sum + (c * x ** (k + 1)) / (k + 1), 0);
  const value = at(upper) - at(lower);
  return Number.isFinite(value) ? value : null;
}

function constantString(node: MathNode): string | null {
  const n = node as MathNode & { type: string; value?: unknown };
  return n.type === "ConstantNode" && typeof n.value === "string" ? n.value : null;
}

/** Numeric value of a node that must not depend on any variable (`0`, `2\pi`), or null. */
function closedNumber(math: MathJsInstance, node: MathNode): number | null {
  const res = safeEvaluate(math, node.toString());
  return res.ok ? toNumber(res.value) : null;
}

/**
 * True when `source` contains at least one `integral(...)` call and every one of them is exact
 * (so the result may be shown as a fraction rather than a 4-significant-figure decimal).
 */
export function integralsExact(math: MathJsInstance, source: string): boolean {
  const root = safeParse(math, source);
  if (!root) return false;
  let any = false;
  let all = true;
  root.traverse((node: MathNode) => {
    const n = node as MathNode & { type: string; fn?: { name?: string }; args?: MathNode[] };
    if (n.type !== "FunctionNode" || n.fn?.name !== "integral") return;
    any = true;
    const args = n.args ?? [];
    if (args.length !== 4) {
      all = false;
      return;
    }
    const expr = constantString(args[0]);
    const variable = constantString(args[1]);
    const lower = closedNumber(math, args[2]);
    const upper = closedNumber(math, args[3]);
    if (expr === null || variable === null || lower === null || upper === null) all = false;
    else if (exactIntegral(math, expr, variable, lower, upper) === null) all = false;
  });
  return any && all;
}

function registerIntegral(math: MathJsInstance): void {
  const integral = (expr: string, variable: string, lower: number, upper: number): number => {
    const exact = exactIntegral(math, expr, variable, lower, upper);
    if (exact !== null) return exact;
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) throw new Error("integral needs finite limits");
    const compiled = math.compile(expr);
    const f = (x: number): number => {
      const v = compiled.evaluate({ [variable]: x }) as unknown;
      const n = typeof v === "number" ? v : toNumber(v);
      // a singular or complex-valued sample means this integral is improper for us: no answer
      if (n === null || !Number.isFinite(n)) throw new Error("integral does not converge");
      return n;
    };
    const value = simpson(f, lower, upper);
    if (!Number.isFinite(value)) throw new Error("integral does not converge");
    return value;
  };
  math.import({ integral }, { override: true });
}

/** Largest number of terms a `\sum` may have before the engine refuses to evaluate it. */
export const MAX_SUMMATION_TERMS = 10_000;

function registerSummation(math: MathJsInstance): void {
  const summation = (expr: string, variable: string, lower: number, upper: number): number => {
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) throw new Error("sum needs finite limits");
    if (!Number.isInteger(lower) || !Number.isInteger(upper)) throw new Error("sum needs integer limits");
    if (upper < lower) return 0;
    if (upper - lower + 1 > MAX_SUMMATION_TERMS) throw new Error("sum has too many terms");
    const compiled = math.compile(expr);
    let total = 0;
    for (let k = lower; k <= upper; k++) {
      const v = compiled.evaluate({ [variable]: k }) as unknown;
      const n = typeof v === "number" ? v : toNumber(v);
      if (n === null || !Number.isFinite(n)) throw new Error("sum term is not a finite number");
      total += n;
    }
    return total;
  };
  math.import({ summation }, { override: true });
}

/** `create(all)` + physical constants + `integral` + `summation`. */
export function createMathInstance(mod: MathModule): MathJsInstance {
  const math = mod.create(mod.all);
  registerConstants(math);
  registerIntegral(math);
  registerSummation(math);
  return math;
}

export function isUnitName(math: MathJsInstance, name: string): boolean {
  if (!/^[a-zA-Z]+$/.test(name)) return false;
  try {
    return math.Unit.isValuelessUnit(name);
  } catch {
    return false;
  }
}

/** LaTeX -> mathjs source using the instance's unit table. Throws UnsupportedLatex. */
export function translate(math: MathJsInstance, latex: string, opts: Omit<TranslateOptions, "isUnit"> = {}): Translated {
  return latexToMath(latex, { ...opts, isUnit: (name) => isUnitName(math, name) });
}

export function safeEvaluate(math: MathJsInstance, source: string, scope?: Record<string, unknown>): EvalResult {
  try {
    const value = scope ? (math.evaluate(source, scope) as unknown) : (math.evaluate(source) as unknown);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function safeParse(math: MathJsInstance, source: string): MathNode | null {
  try {
    return math.parse(source);
  } catch {
    return null;
  }
}

export function isUnitValue(v: unknown): v is Unit {
  return typeof v === "object" && v !== null && "units" in (v as object) && typeof (v as Unit).toNumber === "function";
}

export function isComplexValue(v: unknown): v is ComplexLike {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as ComplexLike).re === "number" &&
    typeof (v as ComplexLike).im === "number" &&
    !("units" in (v as object))
  );
}

export function isNodeValue(v: unknown): v is MathNode {
  return typeof v === "object" && v !== null && (v as MathNode).isNode === true;
}

/** number | Fraction | BigNumber | boolean-free numeric -> number, else null */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (isComplexValue(v)) return Math.abs(v.im) < 1e-12 ? v.re : null;
  if (typeof v === "object" && v !== null && !isUnitValue(v) && typeof (v as { valueOf?: () => unknown }).valueOf === "function") {
    const prim = (v as { valueOf: () => unknown }).valueOf();
    if (typeof prim === "number") return prim;
    if (typeof prim === "string") {
      const n = Number(prim);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/** Free symbols of a node (function names excluded), in order of appearance. */
export function freeSymbols(node: MathNode): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  node.traverse((n: MathNode, path: string, parent: MathNode | null) => {
    if (n.type !== "SymbolNode") return;
    if (parent && parent.type === "FunctionNode" && path === "fn") return;
    const name = (n as MathNode & { name: string }).name;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  });
  return out;
}

/** Binary operations in an assembled mathjs source: `2 * x + 3` -> 2. */
export function countOperations(source: string): number {
  const matches = source.match(/[0-9a-zA-Z_)\]]\s*(?:[+\-*/^]|\bmod\b)/g);
  return matches ? matches.length : 0;
}

/** `|a - b| <= tol * max(1, |a|, |b|)` on plain numbers. */
export function nearlyEqual(a: number, b: number, tol = 1e-6): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Magnitude of a numeric/complex value, or null. */
export function magnitude(math: MathJsInstance, v: unknown): number | null {
  if (typeof v === "number") return Math.abs(v);
  if (isComplexValue(v)) return Math.hypot(v.re, v.im);
  if (isUnitValue(v)) {
    try {
      return Math.abs(v.value);
    } catch {
      return null;
    }
  }
  const n = toNumber(v);
  if (n !== null) return Math.abs(n);
  try {
    const r = math.abs(v as number) as unknown;
    return typeof r === "number" ? r : null;
  } catch {
    return null;
  }
}
