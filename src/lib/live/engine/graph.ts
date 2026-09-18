/**
 * Graph helpers: compile `y = f(x)` samplers and build `plot` descriptors for function lines.
 */
import type { MathJsInstance, MathNode } from "mathjs";
import { freeSymbols, safeParse } from "./math";

const ALLOWED_FREE = new Set(["x", "e", "pi", "i", "Infinity"]);

/** Compiled sampler for a mathjs expression in `x`; null when it does not parse or uses other symbols. */
export function compileExpr(math: MathJsInstance, expr: string): ((x: number) => number) | null {
  const node = safeParse(math, expr);
  if (!node) return null;
  const symbols = freeSymbols(node).filter((s) => !ALLOWED_FREE.has(s));
  if (symbols.length > 0) return null;
  let compiled: { evaluate: (scope: Record<string, unknown>) => unknown };
  try {
    compiled = node.compile();
  } catch {
    return null;
  }
  const probe = (() => {
    try {
      return compiled.evaluate({ x: 0.37 });
    } catch {
      return Number.NaN;
    }
  })();
  if (typeof probe !== "number" && !(typeof probe === "object" && probe !== null && "re" in (probe as object))) return null;
  return (x: number): number => {
    try {
      const v = compiled.evaluate({ x }) as unknown;
      if (typeof v === "number") return v;
      if (typeof v === "object" && v !== null && "re" in (v as object) && "im" in (v as object)) {
        const c = v as { re: number; im: number };
        return Math.abs(c.im) < 1e-9 ? c.re : Number.NaN;
      }
      return Number.NaN;
    } catch {
      return Number.NaN;
    }
  };
}

/** Rewrites the function parameter to `x` so graph shapes can sample it: `2 * t + 1` (t) -> `2 * x + 1`. */
export function toXExpression(math: MathJsInstance, source: string, param: string): string | null {
  const node = safeParse(math, source);
  if (!node) return null;
  if (param === "x") return node.toString();
  const renamed = node.transform((n: MathNode) => {
    if (n.type === "SymbolNode" && (n as MathNode & { name: string }).name === param) return new math.SymbolNode("x");
    return n;
  });
  return renamed.toString();
}

export interface PlotInfo {
  expr: string;
  latex: string;
}

export function plotFor(math: MathJsInstance, rhsSource: string, rhsLatex: string, param: string): PlotInfo | null {
  const expr = toXExpression(math, rhsSource, param);
  if (!expr) return null;
  if (!compileExpr(math, expr)) return null;
  return { expr, latex: rhsLatex };
}
