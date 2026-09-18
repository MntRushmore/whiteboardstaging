/**
 * mathjs instance factory and small evaluation helpers shared by the engine modules.
 * The mathjs module is passed in (loaded once via `await import("mathjs")` in index.ts).
 * Pure TypeScript, no DOM.
 */
import type { MathJsInstance, MathNode, Unit } from "mathjs";
import { registerConstants } from "./constants";
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

function registerIntegral(math: MathJsInstance): void {
  const integral = (expr: string, variable: string, lower: number, upper: number): number => {
    const compiled = math.compile(expr);
    const f = (x: number): number => {
      const v = compiled.evaluate({ [variable]: x }) as unknown;
      return typeof v === "number" ? v : Number.NaN;
    };
    return simpson(f, lower, upper);
  };
  math.import({ integral }, { override: true });
}

/** `create(all)` + physical constants + `integral`. */
export function createMathInstance(mod: MathModule): MathJsInstance {
  const math = mod.create(mod.all);
  registerConstants(math);
  registerIntegral(math);
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
