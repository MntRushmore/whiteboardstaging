/**
 * The scoreboard's judge of maths: reads a LaTeX line (a problem, a tutor's step, an expected
 * answer) and decides what it MEANS, numerically, so two lines can be compared semantically —
 * never by string equality.
 *
 *  - expressions are compared by sampling their free variables at irrational-ish points;
 *  - equations by their real root sets (a sign-change + local-minimum scan over a sinh-spaced
 *    grid out to ±1500, plus exact candidate points so double roots are not missed);
 *  - inequalities by their truth at sample points and at every boundary;
 *  - antiderivatives by differentiating numerically (constant-insensitive);
 *  - limits numerically from both sides (or at 10^8 for x → ∞).
 *
 * LaTeX → mathjs goes through the engine's own translator (`translate`), because the oracle has
 * to read what a student writes exactly as the board does; everything after that — root finding,
 * limits, derivatives of antiderivatives, set comparison — is independent of the engine. What the
 * translator refuses (`\lim`, `\int … dx` without limits, `\ln|x|`) is handled here first.
 *
 * Pure and synchronous. Never throws: an unreadable line comes back as `kind: 'unreadable'`.
 */
import * as mathjs from "mathjs";
import type { MathJsInstance, MathNode, Unit } from "mathjs";
import { preprocessLatex, splitRelations } from "@/lib/live/engine/latex";
import { createMathInstance, translate } from "@/lib/live/engine/math";

let instance: MathJsInstance | null = null;
function M(): MathJsInstance {
  if (!instance) {
    const m = createMathInstance(mathjs);
    // `\left[F\right]_{a}^{b}` is F(b) - F(a): the notation, defined here independently of the engine
    m.import(
      {
        bracketEval: (expr: string, x: string, lo: number, hi: number) => {
          const f = m.compile(expr);
          const at = (v: number) => {
            const y = f.evaluate({ [x]: v }) as unknown;
            if (typeof y !== "number" || !Number.isFinite(y)) throw new Error("undefined at a limit");
            return y;
          };
          return at(hi) - at(lo);
        },
      },
      { override: true },
    );
    instance = m;
  }
  return instance;
}

// ---------------------------------------------------------------- types

export type Value = number | Unit;
export type RelOp = "==" | "<" | ">" | "<=" | ">=" | "!=";

export interface Expr {
  kind: "expr";
  latex: string;
  /** free variables (bound `dx` / sum index excluded) */
  vars: string[];
  /** the real value (or a physical quantity) at `scope`; null where undefined or not real */
  at(scope: Record<string, number>): Value | null;
  /** the raw value, complex allowed (for `x = -\frac{1}{2} + 0.866i`) */
  complexAt(scope: Record<string, number>): { re: number; im: number } | null;
  /** the value with complex values put in (`x = -1 + 2i` into `x^{2} + 2x + 5`); absent where not readable */
  complexAtC?(scope: Record<string, { re: number; im: number }>): { re: number; im: number } | null;
  /** most decimal places written in the LaTeX, null when none (rounding tolerance) */
  decimals: number | null;
  /** relative tolerance of an exact comparison (a numeric limit or integral is looser) */
  tol: number;
  /** the translated source (`angle_C` for `\angle C`): a side that is exactly its variable is bare */
  source?: string;
}

export interface Indefinite {
  kind: "indefinite";
  latex: string;
  variable: string;
  integrand: Expr;
  vars: string[];
}

export interface Alternative {
  sides: Expr[];
  ops: RelOp[];
}

export interface Relation {
  kind: "relation";
  latex: string;
  /** one per `or` / `,` / ± branch */
  alternatives: Alternative[];
  vars: string[];
  /** written with ≈ */
  approx: boolean;
  decimals: number | null;
}

export type Parsed =
  | Expr
  | Indefinite
  | Relation
  | { kind: "empty-set"; latex: string }
  | { kind: "all-reals"; latex: string }
  | { kind: "question"; latex: string; variable: string }
  | { kind: "unreadable"; latex: string; reason: string };

// ---------------------------------------------------------------- numbers

const EXACT_TOL = 1e-9;

function isUnit(v: unknown): v is Unit {
  return typeof v === "object" && v !== null && (v as { type?: string }).type === "Unit";
}

function complexOf(v: unknown): { re: number; im: number } | null {
  if (typeof v === "number") return Number.isFinite(v) ? { re: v, im: 0 } : null;
  if (typeof v === "boolean" || v === null || v === undefined) return null;
  if (typeof v === "object") {
    const o = v as { re?: unknown; im?: unknown; isNode?: boolean; valueOf?: () => unknown };
    if (o.isNode) return null;
    if (typeof o.re === "number" && typeof o.im === "number") {
      return Number.isFinite(o.re) && Number.isFinite(o.im) ? { re: o.re, im: o.im } : null;
    }
    if (isUnit(v)) return null;
    if (typeof o.valueOf === "function") {
      const p = o.valueOf();
      const n = typeof p === "number" ? p : typeof p === "string" ? Number(p) : NaN;
      return Number.isFinite(n) ? { re: n, im: 0 } : null;
    }
  }
  return null;
}

/**
 * An angle is a number: `30^{\circ}` is π/6, the value `\sin x` reads x as. A quantity whose
 * only dimension is an angle becomes its radian measure, so `x = 30^{\circ}` solves `\sin x = \frac{1}{2}`
 * and `x = 30` (thirty radians) does not.
 */
function angleAsNumber(v: unknown): unknown {
  if (!isUnit(v)) return v;
  try {
    const dims = (v as unknown as { dimensions?: number[] }).dimensions ?? [];
    // mathjs base dimensions: MASS, LENGTH, TIME, CURRENT, TEMPERATURE, LUMINOUS_INTENSITY, AMOUNT_OF_SUBSTANCE, ANGLE, BIT
    const angleOnly = dims.length >= 8 && dims[7] !== 0 && dims.every((d, i) => i === 7 || d === 0);
    // any power of an angle in radians: `\frac{\theta}{360^{\circ}}` with θ = π/2 is ¼
    return angleOnly ? (v as unknown as { value: number }).value : v;
  } catch {
    return v;
  }
}

function realOf(v: unknown): Value | null {
  if (isUnit(v)) return v;
  const c = complexOf(v);
  if (!c) return null;
  return Math.abs(c.im) <= 1e-9 * Math.max(1, Math.abs(c.re)) ? c.re : null;
}

/** SI magnitude of a value, and the dimension key a unit carries ('' for a plain number). */
function magnitude(v: Value): { n: number; dim: string } | null {
  if (typeof v === "number") return { n: v, dim: "" };
  try {
    const dims = (v as unknown as { dimensions?: number[] }).dimensions ?? [];
    const n = (v as unknown as { value: number | null }).value;
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    const dim = dims.every((d) => d === 0) ? "" : dims.join(",");
    return { n, dim };
  } catch {
    return null;
  }
}

export function closeTo(a: number, b: number, tol = EXACT_TOL): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Half a unit in the last written decimal place: `2.414` is within 0.0005 of √2 + 1. */
function roundingTol(decimals: number | null): number {
  return decimals === null ? 0 : 0.5 * 10 ** -decimals + 1e-12;
}

/** The coarsest decimal written (`2.414 or -0.4142` → 3): rounding is judged by the loosest value. */
function decimalsIn(latex: string): number | null {
  let best: number | null = null;
  for (const m of latex.matchAll(/\d\.(\d+)/g)) best = Math.min(best ?? Infinity, m[1].length);
  return best;
}

// ---------------------------------------------------------------- LaTeX clean-up

/** What the translator does not take, rewritten into what it does. */
export function cleanLatex(latex: string): string {
  let s = (latex ?? "").trim();
  s = s.replace(/\$+/g, "");
  s = s.replace(/\\mathrm\s*\{\s*~\s*/g, "\\,\\mathrm{").replace(/~/g, " ");
  // `\ln|x|`, `\log|x - 1|`: an argument in bars
  s = s.replace(/\\(ln|log)\s*\|([^|]+)\|/g, "\\$1\\left(|$2|\\right)");
  s = s.replace(/\\left\s*\|/g, "|").replace(/\\right\s*\|/g, "|");
  s = s.replace(/\\(?:displaystyle|textstyle)/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * `+ C` closing an antiderivative. Only a capital: `a + b + c = 9` is algebra. A lowercase
 * `+ c` stays a variable, and `compareExprs(…, { upToConstant })` pins it to 0.
 */
function dropConstant(latex: string): string {
  return latex.replace(/\s*\+\s*C\s*$/, "").trim();
}

const CONSTANT_NAMES = new Set(["c", "C", "K"]);

const EMPTY_SET = /^(?:\\varnothing|\\emptyset|\\\{\s*\\\}|\{\s*\})$/;
const ALL_REALS = /^(?:(?:[a-zA-Z]\s*\\in\s*)?\\mathbb\s*\{?\s*R\s*\}?|-\s*\\infty\s*<\s*[a-zA-Z]\s*<\s*\\infty)$/;

// ---------------------------------------------------------------- expressions

function resolveCalculus(node: MathNode): MathNode {
  const n = node as MathNode & { type: string; fn?: { name?: string }; args?: MathNode[] };
  if (n.type === "FunctionNode" && n.fn?.name === "derivative" && n.args && n.args.length === 2) {
    const [inner, v] = n.args as Array<MathNode & { type: string; value?: unknown }>;
    const variable = typeof v.value === "string" ? v.value : String(v.value ?? "x");
    const body = inner.type === "ConstantNode" && typeof inner.value === "string" ? M().parse(inner.value) : inner;
    return M().derivative(resolveCalculus(body), variable, { simplify: false });
  }
  return node.map((child) => resolveCalculus(child));
}

function limitTarget(latex: string): number | null {
  const s = latex.replace(/\s+/g, "");
  if (/^\+?\\infty$/.test(s)) return Infinity;
  if (/^-\\infty$/.test(s)) return -Infinity;
  const e = exprOf(latex);
  if (!e || e.vars.length > 0) return null;
  const v = e.at({});
  return typeof v === "number" ? v : null;
}

/** `\lim_{x \to a} body` evaluated numerically: both sides must agree. */
function limitExpr(latex: string, variable: string, targetLatex: string, bodyLatex: string): Expr | null {
  const body = exprOf(bodyLatex);
  const a = limitTarget(targetLatex);
  if (!body || a === null) return null;
  const num = (v: Value | null): number | null => (typeof v === "number" ? v : null);
  const value = (scope: Record<string, number>): number | null => {
    const f = (x: number) => num(body.at({ ...scope, [variable]: x }));
    if (!Number.isFinite(a)) {
      const s = Math.sign(a);
      const far = f(s * 1e8);
      const farther = f(s * 1e10);
      if (far === null || farther === null) return null;
      return closeTo(far, farther, 1e-5) ? farther : null;
    }
    const h = 1e-6 * Math.max(1, Math.abs(a));
    const left = f(a - h);
    const right = f(a + h);
    if (left === null && right === null) return null;
    if (left === null || right === null) return left ?? right; // one-sided (√x at 0)
    if (!closeTo(left, right, 1e-4)) return null;
    const near = (left + right) / 2;
    // 0/0 whose top cancels to second order (`\frac{1 - \cos x}{x^{2}}`) loses its digits at
    // h = 10⁻⁶: a Richardson estimate from h = 10⁻³ and 10⁻⁴ decides when the two agree
    const avg = (k: number): number | null => {
      const l = f(a - k * Math.max(1, Math.abs(a)));
      const r = f(a + k * Math.max(1, Math.abs(a)));
      return l === null || r === null ? null : (l + r) / 2;
    };
    const a3 = avg(1e-3);
    const a4 = avg(1e-4);
    if (a3 !== null && a4 !== null) {
      const richardson = (100 * a4 - a3) / 99;
      if (!closeTo(near, richardson, 1e-5) && closeTo(a4, richardson, 1e-6)) return richardson;
    }
    return near;
  };
  return {
    kind: "expr",
    latex,
    vars: body.vars.filter((v) => v !== variable),
    at: value,
    complexAt: (scope) => {
      const v = value(scope);
      return v === null ? null : { re: v, im: 0 };
    },
    decimals: decimalsIn(latex),
    tol: 1e-5,
  };
}

const LIMIT = /^\\lim\s*_\s*\{\s*([a-zA-Z])\s*(?:\\to|\\rightarrow|→)\s*(.+?)\s*\}\s*([\s\S]+)$/;

/**
 * `\frac{dy}{dx}` (or `y'`) as a whole side of a line: the derivative it names, an unknown of its
 * own (`\frac{dy}{dx} = -\frac{x}{y}` gives it). Inside an expression it stays unreadable.
 */
function derivativeName(latex: string): Expr[] | null {
  const s = cleanLatex(latex).replace(/\s+/g, "");
  const m = /^\\frac\{(?:\\mathrm\{d\}|d)([a-zA-Z])\}\{(?:\\mathrm\{d\}|d)([a-zA-Z])\}$/.exec(s) ?? /^([a-zA-Z])'$/.exec(s);
  if (!m) return null;
  const name = `D_${m[1]}`;
  const at = (scope: Record<string, number>) => (name in scope ? scope[name] : null);
  return [{ kind: "expr", latex: s, vars: [name], at, complexAt: (scope) => (name in scope ? { re: scope[name], im: 0 } : null), decimals: null, tol: EXACT_TOL }];
}

/** One LaTeX expression → one `Expr` per ± branch; null when unreadable. */
export function exprBranches(latex: string): Expr[] | null {
  const src = dropConstant(cleanLatex(latex));
  if (!src) return null;
  // `\frac{dy}{dx}` / `f'(x)` mean something only next to their definition: not readable alone
  if (/\\frac\s*\{\s*d\s*[a-zA-Z]\s*\}\s*\{\s*d\s*[a-zA-Z]\s*\}|[a-zA-Z]\s*(?:'|\\prime)/.test(src)) return null;
  const lim = LIMIT.exec(src);
  if (lim) {
    const e = limitExpr(src, lim[1], lim[2], lim[3]);
    return e ? [e] : null;
  }
  let t: ReturnType<typeof translate>;
  try {
    t = translate(M(), src);
  } catch {
    return null;
  }
  if (!t.source.trim()) return null;
  const out: Expr[] = [];
  for (const branch of t.branches) {
    let compiled: { evaluate: (scope?: Record<string, unknown>) => unknown };
    try {
      compiled = resolveCalculus(M().parse(branch)).compile();
    } catch {
      return null;
    }
    // `x - 30^{\circ}`: an unknown next to an angle is an angle (x radians), as `\sin x` reads it
    const angles = /\bdeg\b/.test(branch);
    const raw = (scope: Record<string, number>): unknown => {
      try {
        return compiled.evaluate({ ...scope });
      } catch {
        if (!angles) return null;
        try {
          return compiled.evaluate(Object.fromEntries(Object.entries(scope).map(([k, v]) => [k, M().unit(v, "rad")])));
        } catch {
          return null;
        }
      }
    };
    const tol = /integral\(/.test(branch) ? 1e-7 : EXACT_TOL;
    out.push({
      kind: "expr",
      latex: src,
      vars: [...t.variables],
      at: (scope) => realOf(angleAsNumber(raw(scope))),
      complexAt: (scope) => complexOf(angleAsNumber(raw(scope))),
      complexAtC: (scope) => {
        try {
          return complexOf(compiled.evaluate(Object.fromEntries(Object.entries(scope).map(([k, v]) => [k, M().complex(v.re, v.im)]))));
        } catch {
          return null;
        }
      },
      decimals: decimalsIn(src),
      tol,
      source: branch.trim(),
    });
  }
  return out.length > 0 ? out : null;
}

export function exprOf(latex: string): Expr | null {
  return exprBranches(latex)?.[0] ?? null;
}

// ---------------------------------------------------------------- parsing a line

const INDEFINITE = /^\\int\s*(?!_)([\s\S]+?)\s*(?:\\[,;:!]\s*|\\ \s*)*\\?(?:mathrm\s*\{\s*d\s*\}|d)\s*([a-zA-Z])\s*$/;

function splitDisjuncts(src: string): string[] {
  const parts = src.split(/\\text\s*\{\s*or\s*\}|\\quad\b|\\qquad\b|\\text\s*\{\s*,\s*\}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    // `x = 2, x = 3` (top-level commas, each piece a relation)
    const pieces: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
      else if (ch === "," && depth === 0) {
        pieces.push(p.slice(start, i));
        start = i + 1;
      }
    }
    pieces.push(p.slice(start));
    // the `\ ` after a list comma goes; the backslash of `\theta` stays
    const cleaned = pieces.map((x) => x.replace(/^\s*(?:\\(?![a-zA-Z]))?\s*/, "").replace(/\\\s*$/, "").trim()).filter(Boolean);
    if (cleaned.length > 1 && cleaned.every((x) => /=|<|>|\\[lg]e|\\approx/.test(x))) out.push(...cleaned);
    else out.push(p);
  }
  return out;
}

function relOpOf(op: string): { op: RelOp; approx: boolean } | null {
  if (op === "==") return { op: "==", approx: false };
  if (op === "~") return { op: "==", approx: true };
  if (op === "<" || op === ">" || op === "<=" || op === ">=" || op === "!=") return { op, approx: false };
  return null;
}

/**
 * Reads one line. A leading `=` / `≈` (a step continuing the line above) and a trailing `=`
 * (a student asking for the value) are dropped: what is left is compared.
 */
export function parseLine(latex: string): Parsed {
  const original = latex ?? "";
  let src = cleanLatex(original);
  if (!src) return { kind: "unreadable", latex: original, reason: "empty" };
  const q = /^([a-zA-Z])\s*=\s*(?:\?|\\text\s*\{\s*\?\s*\})?$/.exec(src);
  if (q) return { kind: "question", latex: original, variable: q[1] };
  // `AB = ?`, `\angle C =`, `m_{AB} = ?`: a name that translates to one unknown, asked for (read
  // with its line, which is what makes `AB` one length)
  const named = /^(.+?)\s*=\s*(?:\?|\\text\s*\{\s*\?\s*\})?$/.exec(preprocessLatex(src));
  if (named && !/[=<>]/.test(named[1])) {
    const e = exprBranches(named[1]);
    if (e && e.length === 1 && e[0].vars.length === 1 && e[0].source === e[0].vars[0]) return { kind: "question", latex: original, variable: e[0].vars[0] };
  }
  let leadingApprox = false;
  const lead = /^(=|\\approx)\s*/.exec(src);
  if (lead) {
    leadingApprox = lead[1] === "\\approx";
    src = src.slice(lead[0].length).trim();
  }
  src = src.replace(/\s*=\s*$/, "").trim();
  if (!src) return { kind: "unreadable", latex: original, reason: "empty" };
  if (EMPTY_SET.test(src)) return { kind: "empty-set", latex: original };
  if (ALL_REALS.test(src)) return { kind: "all-reals", latex: original };

  const noC = dropConstant(src);
  // `\frac{1}{2}\int e^{u} \, du`: a constant times an integral is the integral of the multiple
  const coefLead = /^(-?\s*(?:\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\}|\d+)?)\s*(\\int(?!\s*_)[\s\S]*)$/.exec(noC);
  const ind = coefLead ? INDEFINITE.exec(coefLead[2]) : null;
  if (coefLead && ind) {
    const raw = exprOf(ind[1].replace(/^\((.*)\)$/, "$1"));
    if (!raw) return { kind: "unreadable", latex: original, reason: "integrand" };
    const k = coefLead[1].replace(/\s+/g, "");
    const factor = k === "" ? 1 : k === "-" ? -1 : (exprOf(k)?.at({}) ?? null);
    if (typeof factor !== "number") return { kind: "unreadable", latex: original, reason: "coefficient" };
    const integrand: Expr =
      factor === 1
        ? raw
        : {
            ...raw,
            at: (scope) => {
              const v = raw.at(scope);
              return typeof v === "number" ? factor * v : null;
            },
            complexAt: (scope) => {
              const v = raw.complexAt(scope);
              return v ? { re: factor * v.re, im: factor * v.im } : null;
            },
          };
    return { kind: "indefinite", latex: original, variable: ind[2], integrand, vars: integrand.vars.filter((v) => v !== ind[2]) };
  }

  const disjuncts = splitDisjuncts(src);
  const alternatives: Alternative[] = [];
  let approx = leadingApprox;
  let relational = false;
  for (const d of disjuncts) {
    let split: { sides: string[]; ops: string[] };
    try {
      split = splitRelations(d);
    } catch {
      return { kind: "unreadable", latex: original, reason: "split" };
    }
    // `A \Rightarrow B`: the claim is B
    const imp = split.ops.lastIndexOf("=>");
    if (imp !== -1) split = { sides: split.sides.slice(imp + 1), ops: split.ops.slice(imp + 1) };
    if (split.ops.length === 0) {
      if (disjuncts.length > 1) return { kind: "unreadable", latex: original, reason: "mixed list" };
      const branches = exprBranches(d);
      if (!branches) return { kind: "unreadable", latex: original, reason: "untranslatable" };
      if (branches.length === 1) {
        const e = branches[0];
        return leadingApprox ? { ...e, decimals: e.decimals ?? 0 } : e;
      }
      return { kind: "unreadable", latex: original, reason: "± in an expression" };
    }
    relational = true;
    const ops: RelOp[] = [];
    for (const o of split.ops) {
      const r = relOpOf(o);
      if (!r) return { kind: "unreadable", latex: original, reason: `operator ${o}` };
      if (r.approx) approx = true;
      ops.push(r.op);
    }
    if (split.sides.some((s) => !s.trim())) return { kind: "unreadable", latex: original, reason: "empty side" };
    const sideBranches: Expr[][] = [];
    for (const side of split.sides) {
      const b = exprBranches(side) ?? derivativeName(side);
      if (!b) return { kind: "unreadable", latex: original, reason: "untranslatable side" };
      sideBranches.push(b);
    }
    // cartesian product of the ± branches of every side
    let combos: Expr[][] = [[]];
    for (const b of sideBranches) combos = combos.flatMap((c) => b.map((e) => [...c, e]));
    for (const sides of combos) alternatives.push({ sides, ops });
  }
  if (!relational) return { kind: "unreadable", latex: original, reason: "untranslatable" };
  const vars = [...new Set(alternatives.flatMap((a) => a.sides.flatMap((s) => s.vars)))];
  return { kind: "relation", latex: original, alternatives, vars, approx, decimals: decimalsIn(src) };
}

// ---------------------------------------------------------------- relations: truth and roots

function holds(op: RelOp, d: number): boolean {
  switch (op) {
    case "==":
      return d === 0;
    case "!=":
      return d !== 0;
    case "<":
      return d < 0;
    case ">":
      return d > 0;
    case "<=":
      return d <= 0;
    case ">=":
      return d >= 0;
  }
}

function difference(a: Value, b: Value, snap = 1e-9): number | null {
  const ma = magnitude(a);
  const mb = magnitude(b);
  if (!ma || !mb || ma.dim !== mb.dim) return null;
  const d = ma.n - mb.n;
  // snap rounding noise to an exact tie, so `x \le 3` holds at x = 3
  return Math.abs(d) <= snap * Math.max(1, Math.abs(ma.n), Math.abs(mb.n)) ? 0 : d;
}

/** Is the relation true at this point? null when a side is undefined there. */
export function truthAt(rel: Relation, scope: Record<string, number>, snap = 1e-9): boolean | null {
  let anyDefined = false;
  for (const alt of rel.alternatives) {
    const values = alt.sides.map((s) => s.at(scope));
    if (values.some((v) => v === null)) continue;
    anyDefined = true;
    let ok = true;
    for (let i = 0; i < alt.ops.length; i++) {
      const d = difference(values[i] as Value, values[i + 1] as Value, snap);
      if (d === null || !holds(alt.ops[i], d)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return anyDefined ? false : null;
}

export const isEquation = (rel: Relation): boolean => rel.alternatives.every((a) => a.ops.every((o) => o === "=="));
export const isInequality = (rel: Relation): boolean => rel.alternatives.every((a) => a.ops.length > 0 && a.ops.every((o) => o !== "==" && o !== "!="));

/** sinh-spaced grid: dense near 0, reaching ±1500 (log(x) = 2 has its root at 100). */
const GRID: number[] = (() => {
  const out: number[] = [];
  const n = 1600;
  for (let i = 0; i <= n; i++) out.push(Math.sinh(-8 + (16 * i) / n));
  return out;
})();

export interface RootSet {
  /** every real number (an identity) */
  all: boolean;
  roots: number[];
}

function dedupe(values: number[], tol = 1e-7): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) if (!out.some((o) => closeTo(o, v, tol))) out.push(v);
  return out;
}

/** Real roots of g on the grid: sign changes, touching minima, and candidates that are exact roots. */
export function rootsOf(g: (x: number) => number | null, candidates: readonly number[] = []): RootSet {
  const ys = GRID.map((x) => g(x));
  const finite = ys.filter((y): y is number => y !== null && Number.isFinite(y));
  if (finite.length > 0 && finite.filter((y) => Math.abs(y) <= 1e-9).length > finite.length * 0.5) return { all: true, roots: [] };
  const roots: number[] = [];
  const accept = (x: number) => {
    const y = g(x);
    if (y !== null && Math.abs(y) <= 1e-7) roots.push(x);
  };
  for (let i = 0; i < GRID.length; i++) {
    const y = ys[i];
    if (y === null || !Number.isFinite(y)) continue;
    if (y === 0) {
      roots.push(GRID[i]);
      continue;
    }
    const yn = i + 1 < GRID.length ? ys[i + 1] : null;
    if (yn !== null && Number.isFinite(yn) && yn !== 0 && Math.sign(y) !== Math.sign(yn)) {
      let lo = GRID[i];
      let hi = GRID[i + 1];
      let ylo = y;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2;
        const ym = g(mid);
        if (ym === null) break;
        if (ym === 0) {
          lo = hi = mid;
          break;
        }
        if (Math.sign(ym) === Math.sign(ylo)) {
          lo = mid;
          ylo = ym;
        } else hi = mid;
      }
      accept((lo + hi) / 2);
    }
    // a root the curve only touches: a local minimum of |g| near zero
    const yp = i > 0 ? ys[i - 1] : null;
    if (yp !== null && yn !== null && Number.isFinite(yp) && Number.isFinite(yn) && Math.abs(y) < Math.abs(yp) && Math.abs(y) < Math.abs(yn) && Math.sign(yp) === Math.sign(y) && Math.sign(yn) === Math.sign(y)) {
      let a = GRID[i - 1];
      let b = GRID[i + 1];
      const phi = (Math.sqrt(5) - 1) / 2;
      for (let k = 0; k < 100; k++) {
        const c = b - phi * (b - a);
        const d = a + phi * (b - a);
        const gc = g(c);
        const gd = g(d);
        if (gc === null || gd === null) break;
        if (Math.abs(gc) < Math.abs(gd)) b = d;
        else a = c;
      }
      accept((a + b) / 2);
    }
  }
  for (const c of candidates) {
    const y = g(c);
    if (y !== null && Math.abs(y) <= 1e-9 * Math.max(1, Math.abs(c))) roots.push(c);
  }
  // prefer an exact candidate over its bisected neighbour
  const snapped = roots.map((r) => candidates.find((c) => closeTo(c, r, 1e-6)) ?? Number(r.toPrecision(12)));
  return { all: false, roots: dedupe(snapped) };
}

/** Real solution set of an equation-type relation in `variable` (other variables pinned by `fixed`). */
export function rootSet(rel: Relation, variable: string, candidates: readonly number[] = [], fixed: Record<string, number> = {}): RootSet | null {
  if (!isEquation(rel)) return null;
  let all = false;
  const roots: number[] = [];
  for (const alt of rel.alternatives) {
    if (alt.sides.length !== 2) return null;
    const [L, R] = alt.sides;
    const g = (x: number): number | null => {
      const scope = { ...fixed, [variable]: x };
      const a = L.at(scope);
      const b = R.at(scope);
      if (a === null || b === null) return null;
      const ma = magnitude(a);
      const mb = magnitude(b);
      if (!ma || !mb || ma.dim !== mb.dim) return null;
      // both sides vanishing far out (`3^{x}` and `2^{x + 1}` at x = -1400 underflow to 0) is
      // floating point, not a root
      if (Math.abs(x) > 50 && Math.abs(ma.n) < 1e-100 && Math.abs(mb.n) < 1e-100) return null;
      return ma.n - mb.n;
    };
    const rs = rootsOf(g, candidates);
    if (rs.all) all = true;
    roots.push(...rs.roots);
  }
  return { all, roots: all ? [] : dedupe(roots) };
}

export function sameRoots(a: readonly number[], b: readonly number[], tol: number): boolean {
  return a.every((x) => b.some((y) => closeTo(x, y, tol) || Math.abs(x - y) <= tol)) && b.every((y) => a.some((x) => closeTo(x, y, tol) || Math.abs(x - y) <= tol));
}

export function subsetRoots(a: readonly number[], b: readonly number[], tol: number): boolean {
  return a.every((x) => b.some((y) => closeTo(x, y, tol) || Math.abs(x - y) <= tol));
}

/** Boundaries of an inequality: the roots of every side difference (its critical values). */
export function boundaries(rel: Relation, variable: string): number[] {
  const out: number[] = [];
  for (const alt of rel.alternatives) {
    for (let i = 0; i + 1 < alt.sides.length; i++) {
      const [L, R] = [alt.sides[i], alt.sides[i + 1]];
      const g = (x: number) => {
        const a = L.at({ [variable]: x });
        const b = R.at({ [variable]: x });
        return a === null || b === null ? null : difference(a, b);
      };
      out.push(...rootsOf(g).roots.map(nearestSimple));
    }
  }
  return dedupe(out);
}

/**
 * A boundary found by bisection is only good to the tie-snap of `difference` (~1e-9): a root that
 * close to a simple fraction (denominator ≤ 12) IS that fraction, so the relation is sampled at
 * the true edge — where a denominator's zero makes the line undefined, not a huge number.
 */
function nearestSimple(r: number): number {
  for (let d = 1; d <= 12; d++) {
    const n = Math.round(r * d);
    if (Math.abs(n / d - r) <= 1e-8 * Math.max(1, Math.abs(r))) return n / d;
  }
  return r;
}

/** Do two one-variable relations hold at exactly the same points? */
export function sameTruth(a: Relation, b: Relation, variable: string): "equal" | "different" | "unknown" {
  const edges = dedupe([...boundaries(a, variable), ...boundaries(b, variable)], 1e-6);
  const nearEdge = (x: number) => edges.some((r) => Math.abs(x - r) <= 1e-5 * Math.max(1, Math.abs(r)));
  // a grid point a hair from a boundary is decided by rounding noise, not by the relation
  const pts: Array<{ x: number; snap: number }> = GRID.filter((_, i) => i % 4 === 0 && !nearEdge(GRID[i])).map((x) => ({ x, snap: 1e-9 }));
  for (const r of edges) {
    pts.push({ x: r, snap: 1e-6 });
    pts.push({ x: r - 1e-4 * Math.max(1, Math.abs(r)), snap: 1e-9 });
    pts.push({ x: r + 1e-4 * Math.max(1, Math.abs(r)), snap: 1e-9 });
  }
  let compared = 0;
  for (const { x, snap } of pts) {
    const ta = truthAt(a, { [variable]: x }, snap);
    const tb = truthAt(b, { [variable]: x }, snap);
    if (ta === null || tb === null) continue;
    compared++;
    if (ta !== tb) return "different";
  }
  return compared >= 20 ? "equal" : "unknown";
}

/** Is a one-variable relation true at every point where it is defined, at none, or at some? */
export function truthEverywhere(rel: Relation, variable: string): "always" | "never" | "mixed" | "unknown" {
  const edges = boundaries(rel, variable);
  const pts = [...GRID.filter((_, i) => i % 4 === 0), ...edges.flatMap((r) => [r, r - 1e-4 * Math.max(1, Math.abs(r)), r + 1e-4 * Math.max(1, Math.abs(r))])];
  let yes = 0;
  let no = 0;
  for (const x of pts) {
    const t = truthAt(rel, { [variable]: x }, 1e-6);
    if (t === true) yes++;
    else if (t === false) no++;
  }
  if (yes + no < 20) return "unknown";
  return no === 0 ? "always" : yes === 0 ? "never" : "mixed";
}

// ---------------------------------------------------------------- expressions: comparison

const POOL = [0.37, 1.13, -0.53, 2.29, 1.61, -1.27, 0.71, 2.83, -2.41, 3.17, 1.37, -0.83, 0.53, 1.91, 2.57, -1.71];

/** Sample scopes for these variables: deterministic, irrational-ish, some negative. */
export function sampleScopes(vars: readonly string[], n = 16): Record<string, number>[] {
  const out: Record<string, number>[] = [];
  for (let k = 0; k < n; k++) {
    const scope: Record<string, number> = {};
    vars.forEach((v, j) => {
      scope[v] = POOL[(k * 5 + j * 7) % POOL.length] * (1 + 0.01 * j);
    });
    out.push(scope);
  }
  return out;
}

export interface ExprComparison {
  /** equal to within the exact tolerance (or up to a constant when asked) */
  exact: boolean;
  /** equal to within the rounding of the decimals written in `got` */
  approx: boolean;
  /** too few points where both are defined to say anything */
  unknown: boolean;
}

export function compareExprs(got: Expr, want: Expr, opts: { upToConstant?: boolean } = {}): ExprComparison {
  let vars = [...new Set([...got.vars, ...want.vars])];
  // an integration constant written on one side only (`+ c`) is 0 for the comparison
  const pinned: Record<string, number> = {};
  if (opts.upToConstant) {
    for (const v of vars) if (CONSTANT_NAMES.has(v) && got.vars.includes(v) !== want.vars.includes(v)) pinned[v] = 0;
    vars = vars.filter((v) => !(v in pinned));
  }
  const tol = Math.max(got.tol, want.tol);
  const rt = roundingTol(got.decimals);
  let n = 0;
  let exact = true;
  let approx = true;
  let offset: number | null = null;
  for (const sampled of sampleScopes(vars, vars.length === 0 ? 1 : 16)) {
    const scope = { ...sampled, ...pinned };
    const a = got.at(scope);
    const b = want.at(scope);
    if (a === null || b === null) continue;
    const ma = magnitude(a);
    const mb = magnitude(b);
    if (!ma || !mb) continue;
    n++;
    if (ma.dim !== mb.dim) return { exact: false, approx: false, unknown: false };
    let d = ma.n - mb.n;
    if (opts.upToConstant) {
      if (offset === null) offset = d;
      d -= offset;
    }
    const scale = Math.max(1, Math.abs(ma.n), Math.abs(mb.n));
    if (Math.abs(d) > tol * scale) exact = false;
    if (Math.abs(d) > Math.max(tol * scale, rt)) approx = false;
  }
  const needed = vars.length === 0 ? 1 : 4;
  if (n === 0 && vars.length === 0) {
    // two closed values that are not real (`5 + i`): compared as complex numbers
    const a = got.complexAt({});
    const b = want.complexAt({});
    if (a && b && (Math.abs(a.im) > EXACT_TOL || Math.abs(b.im) > EXACT_TOL)) {
      const scale = Math.max(1, Math.hypot(a.re, a.im), Math.hypot(b.re, b.im));
      const same = Math.abs(a.re - b.re) <= tol * scale && Math.abs(a.im - b.im) <= tol * scale;
      return { exact: same, approx: same, unknown: false };
    }
  }
  if (n < needed) return { exact: false, approx: false, unknown: true };
  return { exact, approx: approx || exact, unknown: false };
}

/** Does the relation hold at this complex point (every alternative's sides evaluated with it)? */
export function truthAtComplex(rel: Relation, scope: Record<string, { re: number; im: number }>, tol = 1e-7): boolean | null {
  let anyDefined = false;
  for (const alt of rel.alternatives) {
    if (alt.ops.some((o) => o !== "==")) return null;
    const values = alt.sides.map((s) => s.complexAtC?.(scope) ?? null);
    if (values.some((v) => v === null)) continue;
    anyDefined = true;
    const ok = values.every((v, i) => {
      if (i === 0) return true;
      const a = values[0]!;
      const scale = Math.max(1, Math.hypot(a.re, a.im), Math.hypot(v!.re, v!.im));
      return Math.abs(a.re - v!.re) <= tol * scale && Math.abs(a.im - v!.im) <= tol * scale;
    });
    if (ok) return true;
  }
  return anyDefined ? false : null;
}

/** Is `F` an antiderivative of `f` (numerically: F' = f at the sample points)? */
export function isAntiderivative(F: Expr, f: Expr, variable: string): "equal" | "different" | "unknown" {
  let n = 0;
  const vars = [...new Set([...F.vars, ...f.vars, variable])];
  for (const scope of sampleScopes(vars, 16)) {
    const x = scope[variable];
    const h = 1e-5 * Math.max(1, Math.abs(x));
    const up = F.at({ ...scope, [variable]: x + h });
    const down = F.at({ ...scope, [variable]: x - h });
    const want = f.at(scope);
    if (typeof up !== "number" || typeof down !== "number" || typeof want !== "number") continue;
    n++;
    const slope = (up - down) / (2 * h);
    if (!closeTo(slope, want, 1e-5)) return "different";
  }
  return n >= 4 ? "equal" : "unknown";
}

// ---------------------------------------------------------------- solved forms

/** The side is the unknown and nothing else: `x`, `{x}`, `\theta`, `\angle C`, `AB`, `m_{AB}`. */
export function isBare(e: Expr, variable: string): boolean {
  // a Greek unknown is written as its command: `\theta` is the variable theta
  const written = e.latex.replace(/\s|[{}]/g, "");
  // a named angle or segment translates to exactly its own identifier (`\angle C` → angle_C)
  return e.vars.length === 1 && e.vars[0] === variable && (written === variable || written === `\\${variable}` || e.source === variable);
}

/** `x = 2 \text{ or } x = 3`: the values, when every alternative is `v = closed`. */
export function solvedValues(parsed: Parsed, variable: string): { values: Array<{ re: number; im: number }>; approx: boolean } | null {
  if (parsed.kind === "empty-set") return { values: [], approx: false };
  if (parsed.kind !== "relation" || !isEquation(parsed)) return null;
  const values: Array<{ re: number; im: number }> = [];
  for (const alt of parsed.alternatives) {
    if (alt.sides.length !== 2) return null;
    const [L, R] = alt.sides;
    const bare = (e: Expr) => isBare(e, variable);
    let other: Expr | null = null;
    if (bare(L) && R.vars.length === 0) other = R;
    else if (bare(R) && L.vars.length === 0) other = L;
    if (!other) return null;
    const v = other.complexAt({});
    if (!v) return null;
    values.push(v);
  }
  return { values, approx: parsed.approx };
}

/**
 * The numeric points `(a, b)` written on a line, in order: `(2, 3) \to (-3, 2)` → [[2, 3],
 * [-3, 2]], `M = \left(\frac{5}{2}, 4\right)` → [[2.5, 4]]. A tuple with a letter in it (`(x, y)`,
 * `(h, k)`) is not a point and is skipped.
 */
export function tuplesIn(latex: string): number[][] {
  const s = cleanLatex(latex).replace(/\\left\s*\(/g, "(").replace(/\\right\s*\)/g, ")");
  const out: number[][] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "(") continue;
    let depth = 0;
    let end = -1;
    const commas: number[] = [];
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      } else if (ch === "," && depth === 1) commas.push(j);
    }
    if (end < 0 || commas.length !== 1) continue;
    const a = exprOf(s.slice(i + 1, commas[0]));
    const b = exprOf(s.slice(commas[0] + 1, end));
    if (!a || !b || a.vars.length > 0 || b.vars.length > 0) continue;
    const av = a.at({});
    const bv = b.at({});
    if (typeof av !== "number" || typeof bv !== "number") continue;
    out.push([av, bv]);
    i = end;
  }
  return out;
}

/** `v = closed` with a single variable on the left: an assignment (for systems' answers). */
export function assignmentOf(parsed: Parsed): { variable: string; value: number; approx: boolean } | null {
  if (parsed.kind !== "relation" || parsed.alternatives.length !== 1 || parsed.vars.length !== 1) return null;
  const s = solvedValues(parsed, parsed.vars[0]);
  if (!s || s.values.length !== 1 || Math.abs(s.values[0].im) > 1e-9) return null;
  return { variable: parsed.vars[0], value: s.values[0].re, approx: s.approx };
}

/** One variable alone on one side, only numbers elsewhere: `x > 4`, `4 < x`, `-2 < x < 2`. */
export function isSolvedInequality(rel: Relation, variable: string): boolean {
  return rel.alternatives.every((alt) => {
    const bare = alt.sides.filter((s) => isBare(s, variable));
    const closed = alt.sides.filter((s) => s.vars.length === 0);
    return bare.length === 1 && bare.length + closed.length === alt.sides.length;
  });
}

// ---------------------------------------------------------------- forms

function stripParens(node: MathNode): MathNode {
  let n = node as MathNode & { type: string; content?: MathNode };
  while (n.type === "ParenthesisNode" && n.content) n = n.content as typeof n;
  return n;
}

function hasSymbol(node: MathNode): boolean {
  let found = false;
  node.traverse((n: MathNode, path: string, parent: MathNode | null) => {
    if (n.type === "SymbolNode" && !(parent && parent.type === "FunctionNode" && path === "fn")) {
      const name = (n as MathNode & { name: string }).name;
      if (!["e", "pi", "i"].includes(name)) found = true;
    }
  });
  return found;
}

function isSum(node: MathNode): boolean {
  const n = stripParens(node) as MathNode & { type: string; op?: string; fn?: string };
  return n.type === "OperatorNode" && (n.op === "+" || (n.op === "-" && (n as unknown as { args: MathNode[] }).args.length === 2));
}

function nodeOf(latex: string): MathNode | null {
  try {
    const src = dropConstant(cleanLatex(latex).replace(/^(=|\\approx)\s*/, ""));
    return M().parse(translate(M(), src).source);
  } catch {
    return null;
  }
}

/** A product with at least one bracketed sum in the unknown: `(x + 2)(x + 3)`, `3x(2x + 3)`. */
export function isFactored(latex: string): boolean {
  const node = nodeOf(latex);
  if (!node) return false;
  const top = stripParens(node) as MathNode & { type: string; op?: string; args?: MathNode[] };
  if (top.type === "OperatorNode" && top.op === "*" && top.args) {
    const flat: MathNode[] = [];
    const walk = (n: MathNode) => {
      const s = stripParens(n) as MathNode & { type: string; op?: string; args?: MathNode[] };
      if (s.type === "OperatorNode" && s.op === "*" && s.args) s.args.forEach(walk);
      else flat.push(s);
    };
    walk(top);
    return flat.some((f) => {
      const b = f as MathNode & { type: string; op?: string; args?: MathNode[] };
      const base = b.type === "OperatorNode" && b.op === "^" && b.args ? b.args[0] : b;
      return isSum(base) && hasSymbol(base);
    });
  }
  if (top.type === "OperatorNode" && top.op === "^" && top.args) return isSum(top.args[0]) && hasSymbol(top.args[0]);
  return false;
}

/** The text of the brace group opening at `open` (`{`), and the index after it; null when unbalanced. */
function braceGroup(s: string, open: number): { text: string; end: number } | null {
  if (s[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return { text: s.slice(open + 1, i), end: i + 1 };
  }
  return null;
}

/**
 * Simplest radical form: no whole k-th power left under a k-th root (`\sqrt{50}` is not,
 * `5\sqrt{2}` is) and no root below a fraction bar (`\frac{1}{\sqrt{2}}` is not).
 */
export function isSimplifiedRadical(latex: string): boolean {
  const s = latex.replace(/\\left|\\right/g, "");
  for (const m of s.matchAll(/\\sqrt\s*(?:\[\s*(\d+)\s*\])?\s*(?=\{)/g)) {
    const k = m[1] ? Number(m[1]) : 2;
    const group = braceGroup(s, m.index! + m[0].length);
    if (!group) return false;
    // the radicand's value (`\sqrt{25 \cdot 2}` is √50): a whole number with no k-th power in it
    const e = exprOf(group.text);
    const v = e && e.vars.length === 0 ? e.at({}) : null;
    if (typeof v !== "number") continue;
    if (!Number.isInteger(v) || /[^\d\s]/.test(group.text)) {
      if (Number.isInteger(v)) return false; // a product or sum under the root: not simplified yet
      continue;
    }
    for (let p = 2; p ** k <= v; p++) if (v % p ** k === 0) return false;
  }
  for (let i = s.indexOf("\\frac"); i !== -1; i = s.indexOf("\\frac", i + 1)) {
    const top = braceGroup(s, s.indexOf("{", i));
    const bottom = top ? braceGroup(s, top.end) : null;
    if (bottom && /\\sqrt/.test(bottom.text)) return false;
  }
  return true;
}

/** No bracket around a sum in the unknowns is left multiplied or raised to a power. */
export function isExpanded(latex: string): boolean {
  const node = nodeOf(latex);
  if (!node) return false;
  let ok = true;
  node.traverse((n: MathNode) => {
    const o = n as MathNode & { type: string; op?: string; args?: MathNode[] };
    if (o.type !== "OperatorNode" || !o.args) return;
    if (o.op === "*" && o.args.some((a) => isSum(a) && hasSymbol(a))) ok = false;
    if (o.op === "^" && isSum(o.args[0]) && hasSymbol(o.args[0])) ok = false;
  });
  return ok;
}
