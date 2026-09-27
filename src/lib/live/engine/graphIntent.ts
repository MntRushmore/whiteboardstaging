/**
 * What the tutor graphs (`LiveEngine.graphFor`): a column of work in, the maths of a sketch out.
 *
 * Pure maths, no page. It reads the column's lines (the student's, then any solution written
 * under them) and decides:
 *
 *  - a PLANE graph when the column has relations in x and y — `y = 2x + 1`, `f(x) = x^2 - 4`
 *    (any `y = f(x)`: polynomials, |…|, roots, exponentials, logs, rational functions), a line
 *    in standard form `2x + 3y = 6`, a region `y < 2x + 1` / `2x + 3y \ge 6`, a circle
 *    `(x-1)^2 + (y+2)^2 = 9` (also expanded). Rewrites of the same relation count once
 *    (`2x + 3y = 6` → `3y = 6 - 2x` → `y = 2 - \frac{2}{3}x` is one line); two or three
 *    DIFFERENT ones are a system, drawn together with the points where they cross;
 *  - else a NUMBER LINE when the column's last one-variable inequality is an answer — the
 *    variable alone: `x > 3`, `-2 \le x < 3`, `x < 2, \ x > 3`, `x \neq 1`, `-\infty < x < \infty`.
 *
 * The key points are found numerically and written only when exact: a dot at every intercept,
 * vertex, crossing, centre or end point, and its coordinates `(0, 1)` beside it only when both
 * are whole numbers or simple fractions — a graph is not the place for `(1.414, 0)` presented
 * as fact. Asymptotes (vertical where the function blows up, horizontal where it levels off) are
 * returned so the sketch can draw them dashed.
 *
 * `key` identifies the graph by its maths, not its spelling (every relation is fingerprinted by
 * its values), so the board never draws the same graph twice and redraws it only when the maths
 * changed.
 */
import type { MathJsInstance, MathNode } from "mathjs";
import type {
  GraphAsymptote,
  GraphCircleCurve,
  GraphCurve,
  GraphFunctionCurve,
  GraphIntent,
  GraphKeyPoint,
  GraphRelOp,
  NumberLineIntent,
  NumberLineInterval,
  PlaneGraphIntent,
} from "../contracts";
import { functionInfo } from "./classify";
import { splitAtCommas } from "./compound";
import { compileExpr, toXExpression } from "./graph";
import { preprocessLatex, splitRelations, type Translated } from "./latex";
import { safeParse } from "./math";

export interface GraphIntentDeps {
  /** LaTeX → mathjs (throws on what it cannot read) */
  translate(latex: string): Translated;
}

/** At most this many relations on one graph (the last ones written). */
export const MAX_GRAPH_CURVES = 3;
/** Where key points are looked for, in x (the window is chosen from what is found). */
export const SEARCH: { readonly lo: number; readonly hi: number; readonly step: number } = { lo: -40, hi: 40, step: 0.05 };
/** At most this many key points on one graph. */
const MAX_POINTS = 6;
/** A coordinate is written only when it is p/q with q at most this. */
const MAX_DENOMINATOR = 12;

type Sampler = (x: number) => number;
type Sampler2 = (x: number, y: number) => number;

const OP_OF: Record<string, GraphRelOp> = { "==": "=", "<": "<", ">": ">", "<=": "<=", ">=": ">=" };
const FLIP: Record<GraphRelOp, GraphRelOp> = { "=": "=", "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
/** mathjs relation spelling read from the other side (`3 < x` is `x > 3`) */
const MIRROR: Record<string, string> = { "<": ">", ">": "<", "<=": ">=", ">=": "<=", "!=": "!=" };

// ------------------------------------------------------------------ numbers

/** `v` as p/q with a small q, or null. */
export function niceRational(v: number): { p: number; q: number } | null {
  if (!Number.isFinite(v) || Math.abs(v) > 1e6) return null;
  for (let q = 1; q <= MAX_DENOMINATOR; q++) {
    const p = Math.round(v * q);
    if (Math.abs(v * q - p) < 1e-7 * Math.max(1, Math.abs(p))) return { p, q };
  }
  return null;
}

/** The exact value `v` snaps to (`0.49999999997` → `0.5`), or `v` itself. */
export function snap(v: number): number {
  const r = niceRational(v);
  if (!r) return v;
  const s = r.p / r.q;
  return Object.is(s, -0) ? 0 : s;
}

/** LaTeX of a nice number (`-\frac{1}{2}`, `3`), or null when it is not one. */
export function niceLatex(v: number): string | null {
  const r = niceRational(v);
  if (!r) return null;
  const g = gcdInt(Math.abs(r.p), r.q);
  const p = r.p / g;
  const q = r.q / g;
  if (p === 0) return "0";
  if (q === 1) return String(p);
  return `${p < 0 ? "-" : ""}\\frac{${Math.abs(p)}}{${q}}`;
}

function gcdInt(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** `(x, y)` when both coordinates are exact, else ''. */
export function pointLabel(x: number, y: number): string {
  const lx = niceLatex(x);
  const ly = niceLatex(y);
  return lx !== null && ly !== null ? `(${lx}, ${ly})` : "";
}

function fingerprint(v: number): string {
  if (!Number.isFinite(v)) return "n";
  const s = snap(v);
  return Number(s.toPrecision(9)).toString();
}

// ------------------------------------------------------------------ numerics

function bisect(h: Sampler, a: number, b: number, fa: number): number {
  let lo = a;
  let hi = b;
  let flo = fa;
  for (let i = 0; i < 80 && hi - lo > 1e-13 * Math.max(1, Math.abs(lo)); i++) {
    const m = (lo + hi) / 2;
    const fm = h(m);
    if (!Number.isFinite(fm)) return m;
    if (fm === 0) return m;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = m;
      flo = fm;
    } else hi = m;
  }
  return (lo + hi) / 2;
}

/** Golden-section search for the minimum of `g` on [a, b]. */
function minimize(g: Sampler, a: number, b: number): number {
  const r = (Math.sqrt(5) - 1) / 2;
  let lo = a;
  let hi = b;
  let c = hi - r * (hi - lo);
  let d = lo + r * (hi - lo);
  let gc = g(c);
  let gd = g(d);
  for (let i = 0; i < 90 && hi - lo > 1e-12 * Math.max(1, Math.abs(lo)); i++) {
    if (gc < gd) {
      hi = d;
      d = c;
      gd = gc;
      c = hi - r * (hi - lo);
      gc = g(c);
    } else {
      lo = c;
      c = d;
      gc = gd;
      d = lo + r * (hi - lo);
      gd = g(d);
    }
  }
  return (lo + hi) / 2;
}

/**
 * Does `f` run off to infinity as x → p from the side `dir` (+1 right, -1 left)? A pole or a
 * log's wall grows without bound however close you get; a root or a √'s end point levels off.
 */
function diverges(f: Sampler, p: number, dir: number): boolean {
  const s = Math.max(1, Math.abs(p));
  const a = f(p + dir * 1e-9 * s);
  const b = f(p + dir * 1e-6 * s);
  const c = f(p + dir * 1e-3 * s);
  if (!Number.isFinite(a) && !Number.isNaN(a)) return true;
  if (![a, b, c].every(Number.isFinite)) return false;
  const d1 = Math.abs(a - b);
  const d2 = Math.abs(b - c);
  return d1 > 1e-3 && d1 >= 0.5 * d2;
}

interface Scan {
  xs: number[];
  ys: number[];
}

function scan(f: Sampler, lo = SEARCH.lo, hi = SEARCH.hi, step = SEARCH.step): Scan {
  const xs: number[] = [];
  const ys: number[] = [];
  // an irrational offset, so no sample lands exactly on a pole or a nice root
  for (let x = lo + step * 0.3183; x <= hi; x += step) {
    xs.push(x);
    let y: number;
    try {
      y = f(x);
    } catch {
      y = Number.NaN;
    }
    ys.push(typeof y === "number" ? y : Number.NaN);
  }
  return { xs, ys };
}

interface Features {
  roots: number[];
  poles: number[];
  /** local extrema (a vertex, a corner of |…|, a turning point) */
  extrema: number[];
  /** where the domain ends and f stays finite (the start of √) */
  endpoints: number[];
}

function dedupe(xs: number[], tol = 1e-6): number[] {
  const out: number[] = [];
  for (const x of xs.sort((a, b) => a - b)) if (!out.some((o) => Math.abs(o - x) < tol * Math.max(1, Math.abs(x)))) out.push(x);
  return out;
}

/** Roots, poles, extrema and domain end points of `f` over the search range. */
export function features(f: Sampler, s: Scan = scan(f)): Features {
  const roots: number[] = [];
  const poles: number[] = [];
  const extrema: number[] = [];
  const endpoints: number[] = [];
  const { xs, ys } = s;
  const n = xs.length;
  for (let i = 1; i < n; i++) {
    const a = ys[i - 1];
    const b = ys[i];
    const fa = Number.isFinite(a);
    const fb = Number.isFinite(b);
    if (fa && fb) {
      if (a === 0) roots.push(xs[i - 1]);
      else if (Math.sign(a) !== Math.sign(b) && b !== 0) {
        const p = bisect(f, xs[i - 1], xs[i], a);
        if (diverges(f, p, 1) || diverges(f, p, -1)) poles.push(p);
        else if (Math.abs(f(p)) < 1e-7 * (1 + Math.abs(a) + Math.abs(b))) roots.push(p);
      }
    } else if (fa !== fb) {
      // the domain starts or ends here (NaN on one side), or a pole landed on a sample (±Infinity)
      const infinite = (!fa && !Number.isNaN(a)) || (!fb && !Number.isNaN(b));
      if (infinite) {
        poles.push(fa ? xs[i] : xs[i - 1]);
        continue;
      }
      let lo = xs[i - 1];
      let hi = xs[i];
      for (let k = 0; k < 70; k++) {
        const m = (lo + hi) / 2;
        if (Number.isFinite(f(m)) === fa) lo = m;
        else hi = m;
      }
      const edge = fa ? lo : hi;
      const dir = fa ? -1 : 1;
      if (diverges(f, edge, dir)) poles.push(edge);
      else endpoints.push(edge);
    }
    if (i < n - 1 && fa && fb && Number.isFinite(ys[i + 1])) {
      const c = ys[i + 1];
      // float noise on a flat stretch is not a turning point
      const noise = 1e-11 * (1 + Math.abs(b));
      if (Math.abs(b - a) < noise && Math.abs(c - b) < noise) continue;
      const peak = b > a && b > c;
      const trough = b < a && b < c;
      if (peak || trough) {
        const sign = peak ? -1 : 1;
        const m = minimize((x) => sign * f(x), xs[i - 1], xs[i + 1]);
        const fm = f(m);
        // a peak that never stops rising is an even pole (1/x²), not a vertex
        const up = peak ? fm : -fm;
        if (!Number.isFinite(fm) && !Number.isNaN(fm)) poles.push(m);
        else if (Number.isFinite(fm) && Math.abs(up) > 1e3 && (diverges(f, m, 1) || diverges(f, m, -1))) poles.push(m);
        else if (Number.isFinite(fm)) extrema.push(m);
      }
      // a root the curve only touches ((x - 1)² = 0): |f| dips to zero without a sign change
      const absDip = Math.abs(b) < Math.abs(a) && Math.abs(b) <= Math.abs(c) && Math.sign(a) === Math.sign(c) && a !== 0 && c !== 0;
      if (absDip) {
        const m = minimize((x) => Math.abs(f(x)), xs[i - 1], xs[i + 1]);
        if (Math.abs(f(m)) < 1e-9 * (1 + Math.abs(a))) roots.push(m);
      }
    }
  }
  return { roots: dedupe(roots), poles: dedupe(poles, 1e-5), extrema: dedupe(extrema, 1e-5), endpoints: dedupe(endpoints) };
}

/** The horizontal level f settles at as x → ±∞ (one side), or null. */
function levelAt(f: Sampler, dir: number): number | null {
  const v = [1e4, 1e6, 1e8].map((m) => f(dir * m));
  if (!v.every(Number.isFinite)) return null;
  const [a, b, c] = v;
  if (Math.abs(b - c) > 1e-3 * (1 + Math.abs(c)) || Math.abs(a - c) > 0.05 * (1 + Math.abs(c))) return null;
  return snap(Math.abs(c) < 1e-6 ? 0 : c);
}

/** Polynomial degree of `f` when it is a line (1) or a parabola (2) — finite differences — else null. */
function lowDegree(f: Sampler): 0 | 1 | 2 | null {
  for (const x0 of [-1.37, 0.61]) {
    const h = 0.9;
    const v = [0, 1, 2, 3, 4].map((k) => f(x0 + k * h));
    if (!v.every(Number.isFinite)) return null;
    const d1 = v.slice(1).map((y, i) => y - v[i]);
    const d2 = d1.slice(1).map((y, i) => y - d1[i]);
    const d3 = d2.slice(1).map((y, i) => y - d2[i]);
    const scale = 1e-8 * (1 + Math.max(...v.map(Math.abs)));
    if (!d3.every((d) => Math.abs(d) < scale)) return null;
    if (x0 > 0) {
      if (d1.every((d) => Math.abs(d) < scale)) return 0;
      if (d2.every((d) => Math.abs(d) < scale)) return 1;
      return 2;
    }
  }
  return null;
}

// ------------------------------------------------------------------ reading relations

interface PlaneRel {
  curve: GraphCurve;
  fingerprint: string;
  variable: string;
}

const FP_XS = [-3.1, -1.7, -0.6, 0.35, 1.2, 2.45, 4.3];

function functionFingerprint(op: GraphRelOp, f: Sampler): string {
  return `f${op}:${FP_XS.map((x) => fingerprint(f(x))).join(",")}`;
}

export function createGraphIntent(math: MathJsInstance, deps: GraphIntentDeps): { graphFor(lines: readonly string[]): GraphIntent | null } {
  const substitute = (node: MathNode, name: string, value: number): MathNode =>
    node.transform((n: MathNode) =>
      n.type === "SymbolNode" && (n as MathNode & { name: string }).name === name ? new math.ConstantNode(value) : n,
    );

  /** `y = f(x)`, `f(x) = …`, `g(t) = …` */
  const functionRel = (pre: string): PlaneRel | null => {
    const fn = functionInfo(pre);
    if (!fn) return null;
    const t = deps.translate(fn.rhs);
    if (t.hasUnits || t.hasText || !t.source.trim()) return null;
    if (t.variables.some((v) => v !== fn.param)) return null;
    const expr = toXExpression(math, t.source, fn.param);
    if (!expr) return null;
    const f = compileExpr(math, expr);
    if (!f) return null;
    // real somewhere near the origin, or it is not something to sketch
    if (!scan(f, -10, 10, 0.25).ys.some(Number.isFinite)) return null;
    const curve: GraphFunctionCurve = { kind: "function", latex: pre, f, expr, op: "=" };
    return { curve, fingerprint: functionFingerprint("=", f), variable: fn.param };
  };

  /** Any relation in x and y: a line in any form, a region, a circle. */
  const generalRel = (pre: string): PlaneRel | null => {
    const split = splitRelations(pre);
    if (split.sides.length !== 2 || split.ops.length !== 1) return null;
    const op = OP_OF[split.ops[0]];
    if (!op) return null;
    const [L, R] = split.sides.map((s) => deps.translate(s));
    if (L.hasUnits || R.hasUnits || L.hasText || R.hasText || !L.source.trim() || !R.source.trim()) return null;
    const vars = new Set([...L.variables, ...R.variables]);
    if (vars.size !== 2 || !vars.has("x") || !vars.has("y")) return null;
    const node = safeParse(math, `(${L.source}) - (${R.source})`);
    if (!node) return null;
    let compiled: { evaluate: (scope: Record<string, unknown>) => unknown };
    try {
      compiled = node.compile();
    } catch {
      return null;
    }
    const G: Sampler2 = (x, y) => {
      try {
        const v = compiled.evaluate({ x, y });
        return typeof v === "number" ? v : Number.NaN;
      } catch {
        return Number.NaN;
      }
    };
    const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a) + Math.abs(b));

    // linear in y: G = A(x)·y + B(x)  →  y = -B/A
    const testXs = [-1.7, 0.3, 2.9];
    const As: number[] = [];
    let linear = true;
    for (const x of testXs) {
      const g0 = G(x, 0);
      const A = G(x, 1) - g0;
      if (![g0, A].every(Number.isFinite) || !close(G(x, 2.5) - g0, 2.5 * A) || !close(G(x, -1.3) - g0, -1.3 * A)) {
        linear = false;
        break;
      }
      As.push(A);
    }
    if (linear && As.some((a) => Math.abs(a) > 1e-12)) {
      const constA = As.every((a) => close(a, As[0]));
      if (op !== "=" && !constA) return null; // which side is shaded would change along the line
      const f: Sampler = (x) => {
        const g0 = G(x, 0);
        const a = G(x, 1) - g0;
        return Math.abs(a) < 1e-12 ? Number.NaN : -g0 / a;
      };
      const zero = substitute(node, "y", 0);
      const one = substitute(node, "y", 1);
      const expr = `-(${zero.toString()}) / ((${one.toString()}) - (${zero.toString()}))`;
      const norm: GraphRelOp = op === "=" || As[0] > 0 ? op : FLIP[op];
      const curve: GraphFunctionCurve = { kind: "function", latex: pre, f, expr, op: norm };
      return { curve, fingerprint: functionFingerprint(norm, f), variable: "x" };
    }

    // a circle: G = a(x² + y²) + dx + ey + f, fitted from values and checked elsewhere
    const f0 = G(0, 0);
    const gx1 = G(1, 0);
    const gxm = G(-1, 0);
    const gy1 = G(0, 1);
    const gym = G(0, -1);
    const a = (gx1 + gxm) / 2 - f0;
    const d = (gx1 - gxm) / 2;
    const c = (gy1 + gym) / 2 - f0;
    const e = (gy1 - gym) / 2;
    const b = G(1, 1) - a - c - d - e - f0;
    if (![f0, a, b, c, d, e].every(Number.isFinite)) return null;
    const conic = (x: number, y: number) => a * x * x + b * x * y + c * y * y + d * x + e * y + f0;
    for (const [x, y] of [[2.3, -1.1], [-0.7, 3.2], [4.1, 1.9]] as const) if (!close(G(x, y), conic(x, y))) return null;
    if (Math.abs(a) < 1e-12 || !close(a, c) || Math.abs(b) > 1e-9 * (1 + Math.abs(a))) return null;
    const cx = snap(-d / (2 * a));
    const cy = snap(-e / (2 * a));
    const r2 = cx * cx + cy * cy - f0 / a;
    if (!(r2 > 1e-9)) return null;
    const r = Math.sqrt(snap(r2));
    const norm: GraphRelOp = op === "=" || a > 0 ? op : FLIP[op];
    const curve: GraphCircleCurve = { kind: "circle", latex: pre, cx, cy, r, op: norm };
    return { curve, fingerprint: `c${norm}:${fingerprint(cx)},${fingerprint(cy)},${fingerprint(r)}`, variable: "x" };
  };

  const planeRel = (latex: string): PlaneRel | null => {
    const pre = preprocessLatex(latex);
    if (!pre || pre.length > 300 || /\\text|\\mathrm\s*\{\s*[a-zA-Z]{2,}/.test(pre)) return null;
    try {
      return functionRel(pre) ?? generalRel(pre);
    } catch {
      return null;
    }
  };

  // ---------------------------------------------------------------- number lines

  const numberValue = (latex: string): number | null => {
    const s = latex.trim();
    if (/^\+?\\infty$/.test(s)) return Number.POSITIVE_INFINITY;
    if (/^-\\infty$/.test(s)) return Number.NEGATIVE_INFINITY;
    const t = deps.translate(s);
    if (!t.source.trim() || t.variables.length > 0 || t.hasUnits || t.hasText) return null;
    try {
      const v = math.evaluate(t.source) as unknown;
      return typeof v === "number" && !Number.isNaN(v) ? v : null;
    } catch {
      return null;
    }
  };

  const isVariable = (s: string): string | null => {
    const m = /^([a-zA-Z])$/.exec(s.trim());
    return m ? m[1] : null;
  };

  type Piece = { variable: string; intervals: NumberLineInterval[]; marks: Array<{ at: number; latex: string }> };

  /** One part of an answer: `x > 3`, `3 < x`, `-2 \le x < 3`, `x \neq 1`. */
  const piece = (part: string): Piece | null => {
    const split = splitRelations(part);
    const { sides, ops } = split;
    if (!ops.every((op) => op === "<" || op === ">" || op === "<=" || op === ">=" || op === "!=")) return null;
    if (sides.length === 2) {
      let [lhs, rhs] = sides;
      let op: string = ops[0];
      let variable = isVariable(lhs);
      if (!variable) {
        variable = isVariable(rhs);
        if (!variable) return null;
        [lhs, rhs] = [rhs, lhs];
        op = MIRROR[op];
      }
      const v = numberValue(rhs);
      if (v === null) return null;
      const mark = Number.isFinite(v) ? [{ at: v, latex: rhs.trim() }] : [];
      if (op === "!=") {
        if (!Number.isFinite(v)) return null;
        return {
          variable,
          intervals: [
            { from: null, to: v, fromClosed: false, toClosed: false },
            { from: v, to: null, fromClosed: false, toClosed: false },
          ],
          marks: mark,
        };
      }
      const closed = op === "<=" || op === ">=";
      if (!Number.isFinite(v)) return null;
      const interval: NumberLineInterval =
        op === "<" || op === "<="
          ? { from: null, to: v, fromClosed: false, toClosed: closed }
          : { from: v, to: null, fromClosed: closed, toClosed: false };
      return { variable, intervals: [interval], marks: mark };
    }
    if (sides.length === 3 && !ops.includes("!=")) {
      const variable = isVariable(sides[1]);
      if (!variable) return null;
      const ascending = ops.every((op) => op === "<" || op === "<=");
      const descending = ops.every((op) => op === ">" || op === ">=");
      if (!ascending && !descending) return null;
      const [loS, hiS] = ascending ? [sides[0], sides[2]] : [sides[2], sides[0]];
      const [loOp, hiOp] = ascending ? [ops[0], ops[1]] : [ops[1], ops[0]];
      const lo = numberValue(loS);
      const hi = numberValue(hiS);
      if (lo === null || hi === null || !(hi > lo)) return null;
      const marks: Array<{ at: number; latex: string }> = [];
      if (Number.isFinite(lo)) marks.push({ at: lo, latex: loS.trim() });
      if (Number.isFinite(hi)) marks.push({ at: hi, latex: hiS.trim() });
      return {
        variable,
        intervals: [
          {
            from: Number.isFinite(lo) ? lo : null,
            to: Number.isFinite(hi) ? hi : null,
            fromClosed: Number.isFinite(lo) && (loOp === "<=" || loOp === ">="),
            toClosed: Number.isFinite(hi) && (hiOp === "<=" || hiOp === ">="),
          },
        ],
        marks,
      };
    }
    return null;
  };

  /** A one-variable inequality ANSWER (the variable alone), as a number line. */
  const numberLine = (latex: string): NumberLineIntent | null => {
    const pre = preprocessLatex(latex);
    if (!pre || /\\varnothing|\\emptyset/.test(pre)) return null;
    try {
      const parts = (splitAtCommas(pre) ?? [pre])
        .flatMap((p) => p.split(/\\text\s*\{\s*or\s*\}|\\(?:vee|lor|cup)\b/))
        .map((p) => p.trim())
        .filter(Boolean);
      const pieces = parts.map(piece);
      if (pieces.length === 0 || pieces.some((p) => p === null)) return null;
      const all = pieces as Piece[];
      const variable = all[0].variable;
      if (all.some((p) => p.variable !== variable)) return null;
      const intervals = all.flatMap((p) => p.intervals);
      const marks = all.flatMap((p) => p.marks).filter((m, i, arr) => arr.findIndex((o) => Math.abs(o.at - m.at) < 1e-12) === i);
      const key = `n:${variable}:${intervals
        .map((iv) => `${iv.fromClosed ? "[" : "("}${iv.from === null ? "-inf" : fingerprint(iv.from)},${iv.to === null ? "inf" : fingerprint(iv.to)}${iv.toClosed ? "]" : ")"}`)
        .join("u")}`;
      return { kind: "numberLine", key, variable, intervals, marks };
    } catch {
      return null;
    }
  };

  /** Any inequality at all on the line (an answer or not). */
  const isInequality = (latex: string): boolean => /<|>|\\l(?:e|eq|t)(?![a-zA-Z])|\\g(?:e|eq|t)(?![a-zA-Z])|\\neq?(?![a-zA-Z])/.test(preprocessLatex(latex));

  // ---------------------------------------------------------------- key points

  const functionPoints = (curve: GraphFunctionCurve, single: boolean): { points: GraphKeyPoint[]; asymptotes: GraphAsymptote[] } => {
    const f = curve.f;
    const feat = features(f);
    const points: GraphKeyPoint[] = [];
    const asymptotes: GraphAsymptote[] = [];
    const add = (x: number, role: GraphKeyPoint["role"]) => {
      const sx = snap(x);
      const y = f(sx);
      const yy = Number.isFinite(y) ? y : f(x);
      if (!Number.isFinite(yy)) return;
      const sy = snap(Math.abs(yy) < 1e-10 ? 0 : yy);
      if (points.some((p) => Math.abs(p.x - sx) < 1e-9 && Math.abs(p.y - sy) < 1e-9)) return;
      points.push({ x: sx, y: sy, label: pointLabel(sx, sy), role });
    };
    for (const p of feat.poles) asymptotes.push({ axis: "vertical", at: snap(p) });
    const levels = new Set<number>();
    for (const dir of [-1, 1]) {
      const l = levelAt(f, dir);
      if (l !== null) levels.add(l);
    }
    const degree = lowDegree(f);
    if (degree === null) for (const l of levels) asymptotes.push({ axis: "horizontal", at: l });
    if (!single) return { points: [], asymptotes };

    const nearest = (xs: number[], k: number) => [...xs].sort((a, b) => Math.abs(a) - Math.abs(b)).slice(0, k);
    if (degree === 2) for (const x of feat.extrema) add(x, "vertex");
    for (const x of nearest(feat.roots, 4)) add(x, "intercept");
    if (Number.isFinite(f(0))) add(0, "intercept");
    for (const x of nearest(feat.endpoints, 2)) add(x, "endpoint");
    if (degree === null) {
      // corners of |…| and turning points of a cubic: only where they are exact
      for (const x of nearest(feat.extrema, 3)) {
        const sx = snap(x);
        if (pointLabel(sx, snap(f(sx)))) add(x, "turning");
      }
    }
    return { points: points.slice(0, MAX_POINTS), asymptotes };
  };

  /** Where two relations' boundaries cross (curve ∩ curve), as dots with their coordinates. */
  const crossings = (a: GraphCurve, b: GraphCurve): Array<{ x: number; y: number }> => {
    const branches = (c: GraphCurve): Array<{ f: Sampler; lo: number; hi: number }> => {
      if (c.kind === "function") return [{ f: c.f, lo: SEARCH.lo, hi: SEARCH.hi }];
      const h = (x: number) => c.r * c.r - (x - c.cx) ** 2;
      return [
        { f: (x) => (h(x) >= 0 ? c.cy + Math.sqrt(Math.max(0, h(x))) : Number.NaN), lo: c.cx - c.r, hi: c.cx + c.r },
        { f: (x) => (h(x) >= 0 ? c.cy - Math.sqrt(Math.max(0, h(x))) : Number.NaN), lo: c.cx - c.r, hi: c.cx + c.r },
      ];
    };
    const out: Array<{ x: number; y: number }> = [];
    for (const p of branches(a)) {
      for (const q of branches(b)) {
        const lo = Math.max(p.lo, q.lo);
        const hi = Math.min(p.hi, q.hi);
        if (!(hi > lo)) continue;
        const d: Sampler = (x) => p.f(x) - q.f(x);
        const span = hi - lo;
        const feat = features(d, scan(d, lo, hi, Math.min(SEARCH.step, span / 400)));
        const ends = [lo, hi].filter((x) => Math.abs(d(x)) < 1e-9);
        for (const x of [...feat.roots, ...ends]) {
          const sx = snap(x);
          const y = p.f(sx);
          const yy = Number.isFinite(y) ? y : p.f(x);
          if (!Number.isFinite(yy)) continue;
          const pt = { x: sx, y: snap(yy) };
          if (!out.some((o) => Math.abs(o.x - pt.x) < 1e-7 && Math.abs(o.y - pt.y) < 1e-7)) out.push(pt);
        }
      }
    }
    return out;
  };

  const plane = (rels: PlaneRel[]): PlaneGraphIntent => {
    const curves = rels.map((r) => r.curve);
    const points: GraphKeyPoint[] = [];
    const asymptotes: GraphAsymptote[] = [];
    const single = curves.length === 1;
    for (const c of curves) {
      if (c.kind === "circle") {
        if (single || c.op !== "=") points.push({ x: c.cx, y: c.cy, label: pointLabel(c.cx, c.cy), role: "center" });
        continue;
      }
      const found = functionPoints(c, single);
      points.push(...found.points);
      for (const a of found.asymptotes) {
        if (!asymptotes.some((o) => o.axis === a.axis && Math.abs(o.at - a.at) < 1e-9)) asymptotes.push(a);
      }
    }
    if (!single) {
      for (let i = 0; i < curves.length; i++) {
        for (let j = i + 1; j < curves.length; j++) {
          for (const p of crossings(curves[i], curves[j]).sort((a, b) => Math.abs(a.x) - Math.abs(b.x)).slice(0, 4)) {
            if (!points.some((o) => Math.abs(o.x - p.x) < 1e-7 && Math.abs(o.y - p.y) < 1e-7)) {
              points.push({ ...p, label: pointLabel(p.x, p.y), role: "intersection" });
            }
          }
        }
      }
    }
    const key = `p:${rels[0].variable}:${rels.map((r) => r.fingerprint).sort().join("|")}`;
    return { kind: "plane", key, variable: rels[0].variable, curves, points: points.slice(0, MAX_POINTS), asymptotes };
  };

  /** `y = 9`, `x = -2`, `x = ?`: a value given (or asked for), not a relation to graph. */
  const isValueLine = (latex: string): boolean => {
    const split = splitRelations(preprocessLatex(latex));
    if (split.sides.length !== 2 || split.ops[0] !== "==" || !isVariable(split.sides[0])) return false;
    const rhs = split.sides[1].trim();
    if (rhs === "?" || rhs === "") return true;
    try {
      return numberValue(rhs) !== null;
    } catch {
      return false;
    }
  };

  const graphFor = (lines: readonly string[]): GraphIntent | null => {
    const rels: PlaneRel[] = [];
    let answer: NumberLineIntent | null = null;
    let values = false;
    for (const line of lines) {
      if (!line || !line.trim()) continue;
      const rel = planeRel(line);
      if (rel) {
        const seen = rels.findIndex((r) => r.fingerprint === rel.fingerprint);
        if (seen !== -1) rels.splice(seen, 1); // a rewrite: the latest spelling stands
        rels.push(rel);
        continue;
      }
      if (isValueLine(line)) values = true;
      if (isInequality(line)) answer = numberLine(line);
    }
    // One relation with a value put into it (`x + y = 18`, `y = 9`, `x = ?`) is substitution, not
    // a graph; two or more are a system, whose worked answer (`x = 11`, `y = 7`) is just that.
    if (rels.length === 1 && values) return answer;
    if (rels.length > 0) {
      const variable = rels[rels.length - 1].variable;
      const same = rels.filter((r) => r.variable === variable);
      return plane(same.slice(-MAX_GRAPH_CURVES));
    }
    return answer;
  };

  return { graphFor };
}
