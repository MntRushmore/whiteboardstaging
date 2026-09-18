/**
 * Step equivalence between consecutive lines.
 *
 * Equations in one unknown: g = lhs - rhs; roots via rationalize -> polynomialRoot (degree <= 3),
 * otherwise numeric bisection on [-50, 50]. Two relations are `ok` iff every root of the previous
 * satisfies the current (relative tolerance 1e-6) and vice versa. Inequalities are compared by
 * sampling truth values. Expressions are compared by value (no unknowns) or by sampling.
 */
import type { MathJsInstance, MathNode } from "mathjs";
import type { EngineVerdict } from "../contracts";
import { freeSymbols, isComplexValue, magnitude, nearlyEqual, safeParse, toNumber, type ComplexLike } from "./math";
import { unitsEqual } from "./units";

export type RelOp = "==" | "<" | ">" | "<=" | ">=" | "!=";

const FN_TO_OP: Record<string, RelOp> = {
  equal: "==",
  smaller: "<",
  larger: ">",
  smallerEq: "<=",
  largerEq: ">=",
  unequal: "!=",
};

export interface Relation {
  op: RelOp;
  lhs: string;
  rhs: string;
  /** mathjs source of the whole relation, e.g. `2 * x + 3 == 11` */
  source: string;
  variables: string[];
}

/** Parses `2 * x + 3 == 11` (a single top-level relational operator). Null otherwise. */
export function parseRelation(math: MathJsInstance, source: string): Relation | null {
  const node = safeParse(math, source);
  if (!node || node.type !== "OperatorNode") return null;
  const op = node as MathNode & { fn: string; args: MathNode[] };
  const rel = FN_TO_OP[op.fn];
  if (!rel || op.args.length !== 2) return null;
  const [l, r] = op.args;
  return { op: rel, lhs: l.toString(), rhs: r.toString(), source, variables: freeSymbols(node) };
}

export type RootValue = number | ComplexLike;

export interface RootInfo {
  variable: string;
  /** null when roots could not be determined */
  roots: RootValue[] | null;
  /** g is identically zero (every value is a solution) */
  identity: boolean;
  /** g is a non-zero constant (no solution) */
  contradiction: boolean;
  degree: number | null;
  /** polynomial coefficients, constant term first (when rationalizable) */
  coefficients: number[] | null;
  exact: boolean;
}

type Compiled = { evaluate: (scope: Record<string, unknown>) => unknown };

function compile(math: MathJsInstance, source: string): Compiled | null {
  try {
    return math.compile(source);
  } catch {
    return null;
  }
}

function evalNumber(c: Compiled, variable: string, value: RootValue, math: MathJsInstance): unknown {
  try {
    const v = typeof value === "number" ? value : math.complex(value.re, value.im);
    return c.evaluate({ [variable]: v });
  } catch {
    return undefined;
  }
}

/** |lhs - rhs| <= 1e-6 * max(1, |lhs|, |rhs|) at `value` */
export function satisfies(math: MathJsInstance, rel: Relation, variable: string, value: RootValue, tol = 1e-6): boolean | null {
  const l = compile(math, rel.lhs);
  const r = compile(math, rel.rhs);
  if (!l || !r) return null;
  const lv = evalNumber(l, variable, value, math);
  const rv = evalNumber(r, variable, value, math);
  if (lv === undefined || rv === undefined) return null;
  const lm = magnitude(math, lv);
  const rm = magnitude(math, rv);
  if (lm === null || rm === null) return null;
  let diff: number | null;
  try {
    diff = magnitude(math, math.subtract(lv as number, rv as number));
  } catch {
    return null;
  }
  if (diff === null || !Number.isFinite(diff)) return null;
  return diff <= tol * Math.max(1, lm, rm);
}

function coefficientNumbers(raw: unknown[]): number[] | null {
  const out: number[] = [];
  for (const c of raw) {
    const n = toNumber(c);
    if (n === null || !Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

export interface NumericRoots {
  roots: number[];
  /** g vanished at (almost) every finite sample: an identity */
  identity: boolean;
}

/** Real roots of a compiled g on [lo, hi] by sign-change bisection (asymptotes rejected). */
export function numericRoots(math: MathJsInstance, g: Compiled, variable: string, lo = -50, hi = 50, samples = 1000): NumericRoots {
  const f = (x: number): number => {
    const v = evalNumber(g, variable, x, math);
    const n = typeof v === "number" ? v : toNumber(v);
    return n === null ? Number.NaN : n;
  };
  const roots: number[] = [];
  const push = (x: number) => {
    if (roots.some((r) => nearlyEqual(r, x, 1e-7))) return;
    roots.push(x);
  };
  const h = (hi - lo) / samples;
  let prevX = lo;
  let prevY = f(lo);
  let finite = Number.isFinite(prevY) ? 1 : 0;
  let zeros = Math.abs(prevY) < 1e-9 ? 1 : 0;
  if (prevY === 0) push(lo);
  for (let i = 1; i <= samples; i++) {
    const x = lo + i * h;
    const y = f(x);
    if (Number.isFinite(y)) {
      finite++;
      if (Math.abs(y) < 1e-9) zeros++;
    }
    if (Number.isFinite(y) && Number.isFinite(prevY)) {
      if (y === 0) push(x);
      else if ((y < 0 && prevY > 0) || (y > 0 && prevY < 0)) {
        let a = prevX;
        let b = x;
        let fa = prevY;
        for (let k = 0; k < 60; k++) {
          const m = (a + b) / 2;
          const fm = f(m);
          if (!Number.isFinite(fm)) break;
          if ((fm < 0 && fa < 0) || (fm > 0 && fa > 0)) {
            a = m;
            fa = fm;
          } else b = m;
          if (b - a < 1e-12) break;
        }
        const root = (a + b) / 2;
        const fr = f(root);
        const scale = Math.max(1, Math.abs(f(root - 1e-3)), Math.abs(f(root + 1e-3)));
        if (Number.isFinite(fr) && Math.abs(fr) <= 1e-6 * scale) push(root);
      }
    }
    prevX = x;
    prevY = y;
  }
  if (finite > 0 && zeros >= 0.9 * finite) return { roots: [], identity: true };
  return { roots, identity: false };
}

/** Roots of lhs - rhs in `variable`. */
export function equationRoots(math: MathJsInstance, rel: Relation, variable: string): RootInfo {
  const g = `(${rel.lhs}) - (${rel.rhs})`;
  const base: RootInfo = { variable, roots: null, identity: false, contradiction: false, degree: null, coefficients: null, exact: false };
  let coefficients: number[] | null = null;
  try {
    const detailed = math.rationalize(g, {}, true) as { variables: string[]; coefficients: unknown[] };
    if (detailed.variables.length <= 1) coefficients = coefficientNumbers(detailed.coefficients);
    if (detailed.variables.length > 1) return base;
  } catch {
    coefficients = null;
  }
  if (coefficients !== null) {
    while (coefficients.length > 0 && Math.abs(coefficients[coefficients.length - 1]) < 1e-12) coefficients.pop();
    if (coefficients.length === 0) {
      // rationalize returned no polynomial: constant g
      const val = evalNumber(compile(math, g) ?? { evaluate: () => undefined }, variable, 0, math);
      const n = typeof val === "number" ? val : toNumber(val);
      if (n !== null && Math.abs(n) < 1e-12) return { ...base, identity: true, roots: [], degree: 0, coefficients: [], exact: true };
      if (n !== null) return { ...base, contradiction: true, roots: [], degree: 0, coefficients: [n], exact: true };
      return base;
    }
    if (coefficients.length === 1) {
      const c0 = coefficients[0];
      if (Math.abs(c0) < 1e-12) return { ...base, identity: true, roots: [], degree: 0, coefficients, exact: true };
      return { ...base, contradiction: true, roots: [], degree: 0, coefficients, exact: true };
    }
    const degree = coefficients.length - 1;
    if (degree <= 3) {
      try {
        const raw = math.polynomialRoot(...(coefficients as [number, number, number?, number?])) as unknown[];
        const roots: RootValue[] = [];
        for (const r of raw) {
          if (typeof r === "number") roots.push(r);
          else if (isComplexValue(r)) roots.push(Math.abs(r.im) < 1e-9 ? r.re : { re: r.re, im: r.im });
        }
        // a rational function's numerator roots must not be poles of g
        const compiledG = compile(math, g);
        const filtered = compiledG
          ? roots.filter((r) => {
              const v = evalNumber(compiledG, variable, r, math);
              const m = magnitude(math, v);
              return m !== null && Number.isFinite(m) && m < 1e-3;
            })
          : roots;
        return { ...base, roots: filtered, degree, coefficients, exact: true };
      } catch {
        // fall through to numeric
      }
    }
    const compiled = compile(math, g);
    if (!compiled) return base;
    const numeric = numericRoots(math, compiled, variable);
    return { ...base, roots: numeric.roots, identity: numeric.identity, degree, coefficients, exact: false };
  }
  const compiled = compile(math, g);
  if (!compiled) return base;
  const probe = evalNumber(compiled, variable, 0.123, math);
  if (probe === undefined) return base;
  const numeric = numericRoots(math, compiled, variable);
  return { ...base, roots: numeric.roots, identity: numeric.identity, exact: false };
}

/** Number of decimal places the student wrote (max over numeric literals), or null when none. */
export function decimalsIn(latex: string): number | null {
  let max: number | null = null;
  for (const m of latex.matchAll(/\d+\.(\d+)/g)) max = Math.max(max ?? 0, m[1].length);
  return max;
}

/** Snaps a rounded value the student wrote (1.414 for sqrt 2) onto the matching exact root. */
export function snapToRoots(values: RootValue[], roots: RootValue[] | null, decimals: number | null): RootValue[] {
  if (!roots || decimals === null) return values;
  const tol = 0.5 * 10 ** -decimals + 1e-9;
  return values.map((v) => {
    if (typeof v !== "number") return v;
    for (const r of roots) {
      const n = rootToNumber(r);
      if (n !== null && Math.abs(n - v) <= tol) return n;
    }
    return v;
  });
}

function mutualRootCheck(math: MathJsInstance, prev: Relation, prevInfo: RootInfo, cur: Relation, curInfo: RootInfo, variable: string): EngineVerdict {
  if (!prevInfo.roots || !curInfo.roots) return "unknown";
  if (prevInfo.identity || curInfo.identity) return prevInfo.identity && curInfo.identity ? "ok" : "unknown";
  if (prevInfo.contradiction || curInfo.contradiction) return prevInfo.contradiction && curInfo.contradiction ? "ok" : "mismatch";
  if (prevInfo.roots.length === 0 && curInfo.roots.length === 0) return "unknown";
  for (const r of prevInfo.roots) {
    const s = satisfies(math, cur, variable, r);
    if (s === null) return "unknown";
    if (!s) return "mismatch";
  }
  for (const r of curInfo.roots) {
    const s = satisfies(math, prev, variable, r);
    if (s === null) return "unknown";
    if (!s) return "mismatch";
  }
  return "ok";
}

const SAMPLE_POINTS = [-7.3, -3.1, -1.7, -0.45, 0.31, 0.7, 1.3, 2.1, 3.7, 5.3, 8.9, 13.7];

function truthAt(math: MathJsInstance, rel: Relation, variable: string, x: number): boolean | null {
  const l = compile(math, rel.lhs);
  const r = compile(math, rel.rhs);
  if (!l || !r) return null;
  const lv = toNumber(evalNumber(l, variable, x, math));
  const rv = toNumber(evalNumber(r, variable, x, math));
  if (lv === null || rv === null || !Number.isFinite(lv) || !Number.isFinite(rv)) return null;
  if (nearlyEqual(lv, rv, 1e-9)) return null; // boundary: skip
  switch (rel.op) {
    case "<":
    case "<=":
      return lv < rv;
    case ">":
    case ">=":
      return lv > rv;
    case "==":
      return false;
    case "!=":
      return true;
  }
}

/** Inequalities (or an inequality vs an equation): compare truth values on a fixed sample. */
export function compareBySampling(math: MathJsInstance, prev: Relation, cur: Relation, variable: string): EngineVerdict {
  let compared = 0;
  for (const x of SAMPLE_POINTS) {
    const a = truthAt(math, prev, variable, x);
    const b = truthAt(math, cur, variable, x);
    if (a === null || b === null) continue;
    compared++;
    if (a !== b) return "mismatch";
  }
  return compared >= 4 ? "ok" : "unknown";
}

/** Verdict of `cur` relative to `prev`, both in the same single unknown. */
export function compareRelations(math: MathJsInstance, prev: Relation, cur: Relation, variable: string): EngineVerdict {
  if (prev.op === "==" && cur.op === "==") {
    const prevInfo = equationRoots(math, prev, variable);
    const curInfo = equationRoots(math, cur, variable);
    return mutualRootCheck(math, prev, prevInfo, cur, curInfo, variable);
  }
  if (prev.op === "!=" || cur.op === "!=") return "unknown";
  return compareBySampling(math, prev, cur, variable);
}

/** `cur` written as an explicit set of values (`x = 2, -2`, `x = \pm 2`) vs the previous relation. */
export function compareValuesToRelation(math: MathJsInstance, prev: Relation, variable: string, rawValues: RootValue[], decimals: number | null = null): EngineVerdict {
  if (prev.op !== "==") return "unknown";
  const prevInfo = equationRoots(math, prev, variable);
  const values = snapToRoots(rawValues, prevInfo.roots, decimals);
  const product = values.map((v) => `(${variable} - (${typeof v === "number" ? v : `${v.re} + ${v.im}i`}))`).join(" * ");
  const cur: Relation = { op: "==", lhs: product, rhs: "0", source: `${product} == 0`, variables: [variable] };
  const curInfo: RootInfo = { variable, roots: values, identity: false, contradiction: false, degree: values.length, coefficients: null, exact: true };
  return mutualRootCheck(math, prev, prevInfo, cur, curInfo, variable);
}

/** Do all `values` satisfy `original`? (the "Solved" test) */
export function solvesRelation(math: MathJsInstance, original: Relation, variable: string, rawValues: RootValue[], decimals: number | null = null): boolean {
  if (rawValues.length === 0) return false;
  const values = decimals === null ? rawValues : snapToRoots(rawValues, equationRoots(math, original, variable).roots, decimals);
  for (const v of values) {
    const s = satisfies(math, original, variable, v);
    if (s !== true) return false;
  }
  return true;
}

/** Two expressions (mathjs sources) with the same free symbols: equal by value, or by sampling. */
export function expressionsEquivalent(math: MathJsInstance, a: string, b: string, variables: string[]): EngineVerdict {
  const ca = compile(math, a);
  const cb = compile(math, b);
  if (!ca || !cb) return "unknown";
  if (variables.length === 0) {
    try {
      const eq = unitsEqual(math, ca.evaluate({}), cb.evaluate({}));
      return eq === null ? "unknown" : eq ? "ok" : "mismatch";
    } catch {
      return "unknown";
    }
  }
  if (variables.length > 3) return "unknown";
  let compared = 0;
  for (let i = 0; i < SAMPLE_POINTS.length; i++) {
    const scope: Record<string, number> = {};
    variables.forEach((v, k) => {
      scope[v] = SAMPLE_POINTS[(i + 3 * k) % SAMPLE_POINTS.length];
    });
    let va: unknown;
    let vb: unknown;
    try {
      va = ca.evaluate(scope);
      vb = cb.evaluate(scope);
    } catch {
      continue;
    }
    const na = toNumber(va);
    const nb = toNumber(vb);
    if (na === null || nb === null || !Number.isFinite(na) || !Number.isFinite(nb)) continue;
    compared++;
    if (!nearlyEqual(na, nb)) return "mismatch";
  }
  return compared >= 3 ? "ok" : "unknown";
}

/** Formats a root for `solutions` / `steps`. */
export function rootToNumber(r: RootValue): number | null {
  return typeof r === "number" ? r : Math.abs(r.im) < 1e-9 ? r.re : null;
}
