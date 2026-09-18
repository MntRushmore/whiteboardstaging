/**
 * Unit-aware evaluation: preferred derived units (N, J, W, Pa, C, V, Ω, T), 4 significant figures,
 * and dimensional-mismatch detection ("These units don't add together").
 */
import type { MathJsInstance, Unit } from "mathjs";
import { unitToLatex, valueToLatex, type NumberFormatOptions } from "./format";
import { isUnitValue, safeEvaluate } from "./math";

/** Derived units students expect to see; checked in this order. */
export const PREFERRED_UNITS = ["N", "J", "W", "Pa", "C", "V", "ohm", "T", "Hz"] as const;

export const UNIT_MISMATCH_NOTE = "These units don't add together";
export const VALUELESS_ADD_NOTE = "Convert to the same unit before adding";

interface UnitParts {
  units: Array<{ power: number; prefix: { name: string }; unit: { name: string } }>;
}

function parts(u: Unit): UnitParts["units"] {
  return (u as unknown as UnitParts).units ?? [];
}

/** Simplifies compound units and converts to a preferred derived unit when the base matches. */
export function preferUnit(math: MathJsInstance, unit: Unit): Unit {
  let u = unit;
  if (parts(u).length <= 1) return u;
  try {
    if (!u.fixPrefix) u = u.simplify();
  } catch {
    u = unit;
  }
  const p = parts(u);
  if (p.length <= 1) return u;
  for (const name of PREFERRED_UNITS) {
    try {
      const target = math.unit(name);
      if (u.equalBase(target)) return u.to(name);
    } catch {
      // ignore unknown unit names on exotic instances
    }
  }
  return u;
}

export function unitValueToLatex(math: MathJsInstance, unit: Unit, opts: NumberFormatOptions = {}): string {
  return unitToLatex(preferUnit(math, unit), opts);
}

export interface UnitEvaluation {
  ok: boolean;
  /** '' when nothing can be shown */
  latex: string;
  note: string;
  value?: unknown;
  error?: string;
}

/** Evaluates a unit-carrying mathjs source and maps the classic failures to student-facing notes. */
export function evaluateUnits(
  math: MathJsInstance,
  source: string,
  scope?: Record<string, unknown>,
  opts: NumberFormatOptions = {},
): UnitEvaluation {
  const res = safeEvaluate(math, source, scope);
  if (!res.ok) {
    if (/Units do not match/i.test(res.error)) return { ok: false, latex: "", note: UNIT_MISMATCH_NOTE, error: res.error };
    if (/unit with undefined value/i.test(res.error) && /[+\-]/.test(source)) {
      return { ok: false, latex: "", note: VALUELESS_ADD_NOTE, error: res.error };
    }
    return { ok: false, latex: "", note: "", error: res.error };
  }
  const value = res.value;
  if (isUnitValue(value)) return { ok: true, latex: unitValueToLatex(math, value, opts), note: "", value };
  return { ok: true, latex: valueToLatex(value, opts), note: "", value };
}

/** Unit-aware equality with a relative tolerance; null when the two values cannot be compared. */
export function unitsEqual(math: MathJsInstance, a: unknown, b: unknown, tol = 1e-6): boolean | null {
  try {
    if (isUnitValue(a) && isUnitValue(b)) {
      if (!a.equalBase(b)) return false;
      const x = a.toSI().value;
      const y = b.toSI().value;
      return Math.abs(x - y) <= tol * Math.max(1, Math.abs(x), Math.abs(y));
    }
    if (isUnitValue(a) !== isUnitValue(b)) {
      // a dimensionless unit (e.g. from `to`) compares with a number
      const ua = isUnitValue(a) ? a : (b as Unit);
      const n = isUnitValue(a) ? (b as number) : (a as number);
      if (parts(ua).length === 0 && typeof n === "number") return Math.abs(ua.value - n) <= tol * Math.max(1, Math.abs(n));
      return false;
    }
    const eq = math.equal(a as number, b as number) as unknown;
    if (typeof eq === "boolean") return eq;
    return null;
  } catch {
    return null;
  }
}

export interface MatchOptions {
  /** decimal places the student wrote on the compared side (null: none) */
  decimals?: number | null;
  /** \approx: also accept 2 % relative error */
  loose?: boolean;
}

/**
 * Rounding-aware equality: `exact` matches `written` when it rounds to the written precision
 * (28.274 ~ 28.27), plus 2 % for approximate relations. Null when incomparable.
 */
export function valuesMatch(math: MathJsInstance, exact: unknown, written: unknown, opts: MatchOptions = {}): boolean | null {
  const strict = unitsEqual(math, exact, written);
  if (strict !== false) return strict;
  const decimals = opts.decimals ?? null;
  if (decimals === null && !opts.loose) return false;
  let a: number | null = null;
  let b: number | null = null;
  try {
    if (isUnitValue(exact) && isUnitValue(written)) {
      if (!exact.equalBase(written)) return false;
      const target = written.formatUnits();
      a = exact.toNumber(target);
      b = written.toNumber(target);
    } else if (typeof exact === "number" && typeof written === "number") {
      a = exact;
      b = written;
    } else {
      return false;
    }
  } catch {
    return null;
  }
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const diff = Math.abs(a - b);
  const ulp = decimals === null ? 0 : 0.5 * 10 ** -decimals + 1e-9;
  const loose = opts.loose ? 0.02 * Math.max(Math.abs(a), Math.abs(b)) : 0;
  return diff <= Math.max(ulp, loose, decimals === null && opts.loose ? 0.5 : 0);
}

/** `5 km/h` -> `m/s`; null when the conversion is not possible. */
export function convert(math: MathJsInstance, valueSource: string, target: string): Unit | null {
  const res = safeEvaluate(math, `${valueSource} to ${target}`);
  if (!res.ok || !isUnitValue(res.value)) return null;
  return res.value;
}
