/**
 * What the school-course modules share (`functionNotation.ts`, `literalEquations.ts`,
 * `linearFunctions.ts`, `exponentRules.ts`, `radicalExpr.ts`, `sequences.ts`,
 * `complexNumbers.ts`, `polynomialDivision.ts`, `logProperties.ts`, `rationalExpressions.ts`,
 * `binomial.ts`): reading a line, printing a tree the way a student writes it, and the numeric
 * SELF-CHECK every one of them runs before it answers — a bug becomes no answer, never a wrong
 * line (the rule `calculus.ts` set).
 *
 * Pure apart from the mathjs instance handed in (`CourseDeps.math`).
 */
import type { MathJsInstance, MathNode } from "mathjs";
import { gcdInt, q, qLatex, type Q } from "./algebra";
import { shortExactDecimal } from "./format";
import type { Translated } from "./latex";
import { argsOf, fnOf, stripParens } from "./nodes";
import { exactly, qFromNumber } from "./poly";

export interface CourseDeps {
  math: MathJsInstance;
  /** LaTeX → mathjs source, letters never read as units (throws on LaTeX it cannot read) */
  translate(latex: string): Translated;
  /** two step lines are the same line (spacing, `\cdot`, `\le` spellings do not count) */
  normalize(latex: string): string;
  /** the engine's one-unknown solve with teacher steps (`engine.solveLatex`) */
  solveOne(latex: string): { latex: string; steps: string[] } | null;
}

export interface Complex {
  re: number;
  im: number;
}

type AnyNode = MathNode & { type: string; value?: unknown; name?: string; content?: MathNode };

// ---------------------------------------------------------------- reading

/** A line (no relation) as a mathjs tree, or null: unreadable, units, prose or `\pm`. */
export function parseExpr(deps: CourseDeps, latex: string): MathNode | null {
  try {
    const t = deps.translate(latex);
    if (!t.source.trim() || t.hasUnits || t.hasText || t.hasPm || t.hasPercent) return null;
    return deps.math.parse(t.source);
  } catch {
    return null;
  }
}

/** Decimals as exact fractions (`0.5` → `1/2`), so `termsOf` (whole numbers only) takes the tree; null when one is not a short fraction. */
export function exactNode(deps: CourseDeps, node: MathNode): MathNode | null {
  let ok = true;
  const out = node.transform((n: MathNode) => {
    const a = n as AnyNode;
    if (a.type !== "ConstantNode" || typeof a.value !== "number" || Number.isInteger(a.value)) return n;
    const f = exactQ(a.value);
    if (!f) {
      ok = false;
      return n;
    }
    return new deps.math.OperatorNode("/", "divide", [new deps.math.ConstantNode(f.n), new deps.math.ConstantNode(f.d)]);
  });
  return ok ? out : null;
}

/** The free letters of a tree (constants `e`, `pi`, `i` and function names excluded). */
export function lettersOf(node: MathNode): string[] {
  const out: string[] = [];
  node.traverse((n: MathNode, path: string, parent: MathNode | null) => {
    if (n.type !== "SymbolNode") return;
    if (parent && parent.type === "FunctionNode" && path === "fn") return;
    const name = (n as AnyNode).name ?? "";
    if (!name || ["e", "pi", "i", "Infinity"].includes(name) || out.includes(name)) return;
    out.push(name);
  });
  return out;
}

/** Top-level `=` split (braces and brackets respected); null when there is not exactly one. */
export function splitEquation(latex: string): [string, string] | null {
  let depth = 0;
  let at = -1;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === "\\") {
      const m = /^\\[a-zA-Z]+/.exec(latex.slice(i));
      if (m) {
        if (depth === 0 && /^\\(?:le|leq|ge|geq|ne|neq|lt|gt|approx|to|Rightarrow)$/.test(m[0])) return null;
        i += m[0].length - 1;
      } else i++;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (depth === 0 && (ch === "<" || ch === ">")) return null;
    else if (depth === 0 && ch === "=") {
      if (at !== -1) return null;
      at = i;
    }
  }
  if (at === -1) return null;
  const lhs = latex.slice(0, at).trim();
  const rhs = latex.slice(at + 1).trim();
  return lhs && rhs ? [lhs, rhs] : null;
}

/** A relation anywhere in the line: `=`, `<`, `>`, `\le`, `\ge`, `\neq` (never the `\le` of `\left`). */
export function hasRelation(latex: string): boolean {
  return /[=<>]|\\(?:le|ge|leq|geq|neq|ne|lt|gt|approx)(?![a-zA-Z])/.test(latex);
}

/** `x = ?`, `x =`, `a_{10} = ?`, `\bar{x} = ?`, `S_{\infty} = ?`: the name asked for, as written. */
export function questionName(latex: string): string | null {
  const s = latex
    .replace(/\\text\s*\{\s*\?\s*\}/g, "?")
    .replace(/\\[,;:! ]|\\quad|\\qquad|~/g, "")
    .replace(/\s+/g, "");
  const m = /^((?:\\(?:bar|overline)\{[a-zA-Z]\})|[a-zA-Z](?:_\{?(?:[a-zA-Z0-9]+|\\infty)\}?)?)=\??$/.exec(s);
  return m ? m[1] : null;
}

/** Strips a trailing `=` / `= ?` (the student asking for the value). */
export function withoutQuestionMark(latex: string): { body: string; asked: boolean } {
  const s = latex.trim();
  const m = /^(.*?)\s*=\s*(?:\?|\\text\s*\{\s*\?\s*\})?\s*$/.exec(s);
  if (m && m[1].trim() && !/[=<>]\s*$/.test(m[1])) return { body: m[1].trim(), asked: true };
  return { body: s, asked: false };
}

// ---------------------------------------------------------------- numbers

/** The value of a closed tree as a complex number (null where undefined). */
export function evalNode(deps: CourseDeps, node: MathNode, scope: Record<string, unknown> = {}): Complex | null {
  try {
    return toComplex(node.compile().evaluate({ ...scope }));
  } catch {
    return null;
  }
}

export function evalLatex(deps: CourseDeps, latex: string, scope: Record<string, unknown> = {}): Complex | null {
  const node = parseExpr(deps, latex);
  return node ? evalNode(deps, node, scope) : null;
}

export function toComplex(v: unknown): Complex | null {
  if (typeof v === "number") return Number.isFinite(v) ? { re: v, im: 0 } : null;
  if (typeof v === "object" && v !== null) {
    const o = v as { re?: unknown; im?: unknown; valueOf?: () => unknown; isNode?: boolean };
    if (o.isNode) return null;
    if (typeof o.re === "number" && typeof o.im === "number") return Number.isFinite(o.re) && Number.isFinite(o.im) ? { re: o.re, im: o.im } : null;
    if (typeof o.valueOf === "function" && !("units" in (v as object))) {
      const p = o.valueOf();
      const n = typeof p === "number" ? p : Number(p);
      return Number.isFinite(n) ? { re: n, im: 0 } : null;
    }
  }
  return null;
}

export function closeC(a: Complex, b: Complex, tol = 1e-7): boolean {
  const scale = Math.max(1, Math.hypot(a.re, a.im), Math.hypot(b.re, b.im));
  return Math.abs(a.re - b.re) <= tol * scale && Math.abs(a.im - b.im) <= tol * scale;
}

const SAMPLES = [0.37, 1.13, -0.53, 2.29, 1.61, -1.27, 0.71, 2.83, -2.41, 3.17];
const POSITIVE = [0.37, 1.13, 2.29, 1.61, 0.71, 2.83, 1.37, 0.53, 3.17, 1.91];

/** Deterministic sample points for these letters (each letter offset, so a = b never). */
export function sampleScopes(vars: readonly string[], positive = false, n = 8): Record<string, number>[] {
  const pool = positive ? POSITIVE : SAMPLES;
  const out: Record<string, number>[] = [];
  for (let k = 0; k < n; k++) {
    const scope: Record<string, number> = {};
    vars.forEach((v, j) => {
      scope[v] = pool[(k * 3 + j * 7) % pool.length] * (1 + 0.137 * j);
    });
    out.push(scope);
  }
  return out;
}

/**
 * Every line has the value of `reference` wherever both are defined (a leading `=` is the line
 * continuing the question). A relation line (`x \neq 0`) is skipped: it is beside the working.
 * False when a line cannot be read or too few points are defined — the caller then answers nothing.
 */
export function chainAgrees(deps: CourseDeps, reference: string, lines: readonly string[], opts: { positive?: boolean; complex?: boolean } = {}): boolean {
  const ref = parseExpr(deps, reference);
  if (!ref) return false;
  for (const raw of lines) {
    const line = raw.replace(/^\s*=\s*/, "").trim();
    if (raw.trim() !== line || !hasRelation(line)) {
      const node = parseExpr(deps, line);
      if (!node) return false;
      const vars = [...new Set([...lettersOf(ref), ...lettersOf(node)])];
      if (!sameValues(deps, ref, node, vars, opts)) return false;
    }
  }
  return true;
}

/** Two trees agree at the sample points (at least 3 defined, 1 when closed). */
export function sameValues(deps: CourseDeps, a: MathNode, b: MathNode, vars: readonly string[], opts: { positive?: boolean; complex?: boolean } = {}): boolean {
  let defined = 0;
  for (const scope of sampleScopes(vars, opts.positive)) {
    const x = evalNode(deps, a, scope);
    const y = evalNode(deps, b, scope);
    if (!x || !y) continue;
    if (!opts.complex && (Math.abs(x.im) > 1e-9 || Math.abs(y.im) > 1e-9)) continue;
    defined++;
    if (!closeC(x, y, 1e-8)) return false;
  }
  return defined >= (vars.length === 0 ? 1 : 3);
}

/** An equation line holds at this point (both sides defined and equal); null where undefined. */
export function equationHolds(deps: CourseDeps, latex: string, scope: Record<string, unknown>): boolean | null {
  const sides = splitEquation(latex);
  if (!sides) return null;
  const l = evalLatex(deps, sides[0], scope);
  const r = evalLatex(deps, sides[1], scope);
  if (!l || !r) return null;
  return closeC(l, r, 1e-7);
}

// ---------------------------------------------------------------- printing

/** An exact rational for a JS number, when it is one (denominator ≤ 1000). */
export const exactQ = (x: number): Q | null => qFromNumber(x);

/**
 * A number as a student writes it: a whole number, an exact fraction, or — on a line written in
 * decimals — the exact terminating decimal. Null when it is none of those (never rounded).
 */
export function numberLatex(x: number, decimals: boolean): string | null {
  if (!Number.isFinite(x)) return null;
  const snapped = Number(x.toPrecision(12));
  if (Number.isInteger(snapped)) return String(snapped);
  if (decimals) {
    // a short decimal only when it IS the value (1348.850153 is not (1.005)^{60} · 1000)
    const s = shortExactDecimal(snapped);
    return s !== null && Math.abs(Number(s) - x) <= 1e-12 * Math.max(1, Math.abs(x)) ? s : null;
  }
  const f = exactQ(snapped);
  return f ? qLatex(f) : null;
}

/** `(-3)` for a negative number inside a longer line, the number itself otherwise. */
export function paren(latex: string): string {
  return /^-/.test(latex) || /\\frac/.test(latex) ? `(${latex})` : latex;
}

const PREC: Record<string, number> = { add: 1, subtract: 1, unaryMinus: 2, multiply: 3, divide: 3, pow: 5 };

/**
 * A tree as a student writes it: `\frac{}{}` for division, juxtaposition before a bracket or a
 * letter (`2(x + 1)`, `3x`), `\cdot` between two numbers, brackets only where precedence needs
 * them. Numbers through `num` (default: exact rationals / short decimals). Null for a node it
 * does not print (units, strings, matrices).
 */
export function printNode(node: MathNode, num: (x: number) => string | null = (x) => numberLatex(x, false)): string | null {
  const walk = (n: MathNode, parentPrec: number, side: "l" | "r" | "only"): string | null => {
    const a = n as AnyNode;
    if (a.type === "ParenthesisNode") return walk(a.content!, parentPrec, side);
    if (a.type === "ConstantNode") {
      if (typeof a.value !== "number") return null;
      const s = num(a.value);
      if (s === null) return null;
      return s.startsWith("-") && parentPrec > 1 ? `(${s})` : s;
    }
    if (a.type === "SymbolNode") {
      const name = a.name ?? "";
      if (name === "pi") return "\\pi";
      if (/^[a-zA-Z]_[a-zA-Z0-9]+$/.test(name)) return `${name[0]}_{${name.slice(2)}}`;
      return /^[a-zA-Z]$/.test(name) || name === "e" || name === "i" ? name : null;
    }
    const f = fnOf(n);
    const args = argsOf(n);
    if (a.type === "FunctionNode") {
      const inner = args.map((x) => walk(x, 0, "only"));
      if (inner.some((x) => x === null)) return null;
      if (f === "sqrt") return `\\sqrt{${inner[0]}}`;
      if (f === "nthRoot") return `\\sqrt[${inner[1]}]{${inner[0]}}`;
      if (f === "abs") return `|${inner[0]}|`;
      if (f === "log" && args.length === 1) return `\\ln${bracketArg(args[0], inner[0]!)}`;
      if (f === "log10") return `\\log${bracketArg(args[0], inner[0]!)}`;
      if (f === "log" && args.length === 2) return `\\log_{${inner[1]}}${bracketArg(args[0], inner[0]!)}`;
      if (f === "exp") return `e^{${inner[0]}}`;
      return null;
    }
    if (a.type !== "OperatorNode") return null;
    const prec = PREC[f] ?? 0;
    let out: string | null;
    if (f === "unaryMinus") {
      const x = walk(args[0], prec, "r");
      out = x === null ? null : `-${x}`;
    } else if (f === "unaryPlus") {
      out = walk(args[0], parentPrec, side);
      return out;
    } else if (f === "add" || f === "subtract") {
      const l = walk(args[0], prec, "l");
      const r = walk(args[1], f === "subtract" ? prec + 0.5 : prec, "r");
      if (l === null || r === null) return null;
      out = r.startsWith("-") && f === "add" ? `${l} - ${r.slice(1)}` : `${l} ${f === "add" ? "+" : "-"} ${r}`;
    } else if (f === "multiply") {
      const l = walk(args[0], prec, "l");
      const r = walk(args[1], prec + 0.5, "r");
      if (l === null || r === null) return null;
      const glue = /^[a-zA-Z(\\]/.test(r) && !/^\\frac/.test(r) && !/^\\cdot/.test(r) && !(/\d$/.test(l) && /^\d/.test(r));
      // `\pi r^{2}`: a command before a letter keeps its space
      out = glue && !/^\(?-/.test(r) ? (/\\[a-zA-Z]+$/.test(l) && /^[a-zA-Z]/.test(r) ? `${l} ${r}` : `${l}${r}`) : `${l} \\cdot ${r}`;
    } else if (f === "divide") {
      const l = walk(args[0], 0, "only");
      const r = walk(args[1], 0, "only");
      if (l === null || r === null) return null;
      out = `\\frac{${l}}{${r}}`;
      return out;
    } else if (f === "pow") {
      const b = walk(args[0], prec + 0.5, "l");
      const e = walk(args[1], 0, "only");
      if (b === null || e === null) return null;
      const base = /^[a-zA-Z0-9]+$/.test(b) || /^\\(?:pi|sqrt)/.test(b) || /^\(.*\)$/.test(b) ? b : `(${b})`;
      out = `${base}^{${e}}`;
      return out;
    } else return null;
    if (out === null) return null;
    return prec < parentPrec || (side === "r" && prec === parentPrec && (f === "add" || f === "subtract")) ? `(${out})` : out;
  };
  return walk(node, 0, "only");
}

function bracketArg(node: MathNode, latex: string): string {
  const n = stripParens(node);
  return n.type === "SymbolNode" || (n.type === "ConstantNode" && !latex.startsWith("-")) ? ` ${latex}` : `(${latex})`;
}

/** An exact rational as LaTeX with the sign in front (`-\frac{2}{3}`). */
export const fracLatex = (a: Q): string => qLatex(a);

/** `\frac{n}{d}` reduced, as an exact rational (or null outside exact arithmetic). */
export function ratio(n: number, d: number): Q | null {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d === 0) return null;
  return exactly(() => q(n, d));
}

export function lcm(a: number, b: number): number {
  return (Math.abs(a) / gcdInt(a, b)) * Math.abs(b);
}
