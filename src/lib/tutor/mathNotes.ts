/**
 * Apple Calculator Math Notes + locked algebra on the orange Solve path.
 */
import { algebraNextStep, looksLikeAlgebra } from "./algebra";

export function expressionToEvaluate(latex: string): string | null {
  let s = latex.trim();
  if (!s) return null;
  s = s.replace(/^\$+|\$+$/g, "");
  s = s.replace(/\\left|\\right/g, "");
  s = s.replace(/\\times|\\cdot|·|×/g, "*");
  s = s.replace(/\\div|÷/g, "/");
  s = s.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "(($1)/($2))");
  s = s.replace(/\^\s*\{([^{}]+)\}/g, "^($1)");
  s = s.replace(/\\[a-zA-Z]+\*?/g, "");
  s = s.replace(/[{}]/g, "");
  s = s.replace(/\s+/g, "");
  const eq = s.lastIndexOf("=");
  if (eq !== -1) s = s.slice(0, eq);
  if (!s) return null;
  s = s.replace(/(\d)\(/g, "$1*(");
  s = s.replace(/\)(\d)/g, ")*$1");
  s = s.replace(/\)\(/g, ")*(");
  if (/[a-zA-Z]/.test(s)) return null;
  if (!/^[0-9+\-*/^().]+$/.test(s)) return null;
  return s;
}

function formatMathNotesResult(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-9) return String(rounded);
  const trimmed = Number(value.toPrecision(8));
  if (!Number.isFinite(trimmed)) return null;
  return String(trimmed);
}

function evaluateArithmetic(expr: string): number | null {
  let i = 0;

  const peek = () => expr[i] ?? "";
  const eat = (ch: string) => {
    if (peek() === ch) {
      i += 1;
      return true;
    }
    return false;
  };

  const parseNumber = (): number | null => {
    const start = i;
    while (peek() >= "0" && peek() <= "9") i += 1;
    if (peek() === ".") {
      i += 1;
      while (peek() >= "0" && peek() <= "9") i += 1;
    }
    if (i === start) return null;
    const n = Number(expr.slice(start, i));
    return Number.isFinite(n) ? n : null;
  };

  const parsePrimary = (): number | null => {
    if (eat("(")) {
      const inner = parseExpr();
      if (inner == null || !eat(")")) return null;
      return inner;
    }
    return parseNumber();
  };

  const parseUnary = (): number | null => {
    if (eat("+")) return parseUnary();
    if (eat("-")) {
      const v = parseUnary();
      return v == null ? null : -v;
    }
    return parsePrimary();
  };

  const parsePower = (): number | null => {
    const base = parseUnary();
    if (base == null) return null;
    if (!eat("^")) return base;
    const exp = parsePower();
    if (exp == null) return null;
    return base ** exp;
  };

  const parseTerm = (): number | null => {
    let v = parsePower();
    if (v == null) return null;
    while (peek() === "*" || peek() === "/") {
      const op = peek();
      i += 1;
      const r = parsePower();
      if (r == null) return null;
      if (op === "/") {
        if (r === 0) return null;
        v = v / r;
      } else {
        v = v * r;
      }
    }
    return v;
  };

  const parseExpr = (): number | null => {
    let v = parseTerm();
    if (v == null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = peek();
      i += 1;
      const r = parseTerm();
      if (r == null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };

  const value = parseExpr();
  if (value == null || i !== expr.length) return null;
  return value;
}

/** `36 + 2 =` → `"38"`. Empty / algebra / unreadable → null (stay quiet). */
export function evaluateMathNotes(latex: string): string | null {
  const expr = expressionToEvaluate(latex);
  if (!expr) return null;
  const value = evaluateArithmetic(expr);
  if (value == null) return null;
  return formatMathNotesResult(value);
}

/**
 * Arithmetic Math Notes only fires on a line that ends in `=`.
 * A stray `7` must not consume the solve slot.
 */
export function mathNotesLineResult(latex: string): string | null {
  if (!/[=＝]/.test(latex)) return null;
  return evaluateMathNotes(latex);
}

/** Arithmetic `expr=` first, then one-variable algebra (letters are allowed). */
export function solveNextStep(latex: string): string | null {
  const arith = mathNotesLineResult(latex);
  if (arith) return arith;
  return algebraNextStep(latex);
}

export function firstSolveLine<T extends { latex: string }>(
  candidates: T[],
): (T & { result: string }) | null {
  for (const candidate of candidates) {
    const result = solveNextStep(candidate.latex);
    if (result) return { ...candidate, result };
  }
  return null;
}

export function firstMathNotesLine<T extends { latex: string }>(
  candidates: T[],
): (T & { result: string }) | null {
  return firstSolveLine(candidates);
}

export { looksLikeAlgebra };
