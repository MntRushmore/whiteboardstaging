/**
 * Trig equations the way a teacher solves them: isolate the function, find the reference angle,
 * use the quadrants the value lives in, list the solutions in the interval.
 *
 *   2\cos x - 1 = 0                                  2\sin^{2} x - \sin x - 1 = 0
 *   0^{\circ} \le x < 360^{\circ}                    0^{\circ} \le x < 360^{\circ}
 *   2\cos x = 1                                      (2\sin x + 1)(\sin x - 1) = 0
 *   \cos x = \frac{1}{2}                             \sin x = -\frac{1}{2}, \ \sin x = 1
 *   \cos^{-1}\left(\frac{1}{2}\right) = 60^{\circ}   \sin^{-1}\left(\frac{1}{2}\right) = 30^{\circ}
 *   x = 60^{\circ}, \ x = 360^{\circ} - 60^{\circ}   x = 90^{\circ}, \ x = 180^{\circ} + 30^{\circ}, \ x = 360^{\circ} - 30^{\circ}
 *   x = 60^{\circ}, \ x = 300^{\circ}                x = 90^{\circ}, \ x = 210^{\circ}, \ x = 330^{\circ}
 *
 * The interval is the one the student wrote on the line (`\sin x = \frac{1}{2}, \ 0 \le x < 2\pi`),
 * otherwise one turn from 0 — in degrees unless π is on the line — written as the first line, so
 * the board says in maths which solutions are listed. For `\sin 2x`, `\cos(x - 30^{\circ})` the
 * whole argument is solved over its own range, then x. The equation may be linear or quadratic in
 * one of sin / cos / tan (the quadratic through the engine's own factoring, in a placeholder
 * unknown); `\sin x = \cos x` goes through tan, and sin² beside cos (cos² beside sin) through
 * sin² + cos² = 1.
 *
 * Exact values only (the special angles). Any other line with the unknown inside a trig function
 * is REFUSED (`"refuse"`), so the engine never falls back to a numeric root-finder that lists
 * thirty angles in radians. Every answer is checked: each solution satisfies the equation, and a
 * scan of the interval finds no solution the list is missing.
 */
import type { MathJsInstance, MathNode } from "mathjs";
import { exAdd, exInv, exIsRational, exMul, exNeg, exNum, exQ, exTex, fromNode, lineKey, q, Q0, Q1, QHALF, qAdd, qInt, qMul, qNeg, qSub, qVal, qZero, symTex, tex, type AnyNode, type Ex, type Q } from "./calculus";
import { preprocessLatex, splitRelations, type Translated } from "./latex";
import { LIST_SEP, NO_SOLUTION } from "./solution";
import { angleEx, angleTex, exactValueIn, fnName, FORWARD, inverseValue, NotExact, piMultiple, stripParens, tallBrackets, Undefined, type AngleUnit, type TrigName } from "./trig";

export interface TrigEquationDeps {
  translate(latex: string): Translated;
  /** the engine's own solver, for the quadratic in a placeholder unknown (`2w^{2} - w - 1 = 0`) */
  solveAlgebra(latex: string): { latex: string; steps: string[] } | null;
}

/** Steps and answer; `"refuse"`: a trig equation the engine will not answer; null: not a trig equation. */
export type TrigEquationResult = { latex: string; steps: string[] } | "refuse" | null;

const MAX_LINES = 8;
/** The placeholder unknown for the function (`w` for `\sin x`), and the two for sin / cos. */
const W = "w";

class Refuse extends Error {}
const refuse = (): never => {
  throw new Refuse();
};

interface Interval {
  lo: Q;
  hi: Q;
  loIn: boolean;
  hiIn: boolean;
}

/** One solution for the argument: its value kπ and how a teacher writes it (`180^{\circ} - 30^{\circ}`). */
interface Base {
  k: Q;
  tex: string;
}

type Name = "sin" | "cos" | "tan";

export function solveTrigEquation(math: MathJsInstance, latex: string, deps: TrigEquationDeps): TrigEquationResult {
  try {
    return new Solver(math, deps).solve(latex);
  } catch (e) {
    if (e instanceof Refuse || e instanceof NotExact || e instanceof Undefined) return "refuse";
    return "refuse";
  }
}

/** Splits `\sin x = \frac{1}{2}, \ 0 \le x < 2\pi` (or `\quad`) into its top-level pieces. */
function pieces(latex: string): string[] {
  const s = latex.replace(/\\q?quad\b/g, ",");
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((p) => p.trim().replace(/^\\\s+/, "").replace(/\\[,;: ]\s*$/, "").trim()).filter(Boolean);
}

function mentions(node: MathNode, name: string): boolean {
  let hit = false;
  node.traverse((n) => {
    const a = n as AnyNode;
    if (a.type === "SymbolNode" && a.name === name) hit = true;
  });
  return hit;
}

function mentionsSymbol(node: MathNode, name: string): boolean {
  return mentions(node, name);
}

const isCallOn = (n: AnyNode, x: string): boolean => n.type === "FunctionNode" && FORWARD.has(fnName(n)) && mentions(n, x);

/** The trig calls on the unknown, and whether the unknown also appears outside them (`\sin x = x`). */
function trigCalls(node: MathNode, x: string): { calls: AnyNode[]; outside: boolean } {
  const calls: AnyNode[] = [];
  let outside = false;
  const walk = (m: MathNode) => {
    const n = m as AnyNode;
    if (isCallOn(n, x)) {
      calls.push(n);
      return;
    }
    if (n.type === "SymbolNode" && n.name === x) outside = true;
    if (n.type === "ParenthesisNode" && n.content) walk(n.content);
    else (n.args ?? []).forEach(walk);
  };
  walk(node);
  return { calls, outside };
}

/** The argument as kx + cπ (x an angle in radians): null when it is not linear in x. */
function linearArgument(arg: MathNode, x: string): { k: Q; c: Q } | null {
  try {
    const at = (s: Q) => piMultiple(exactValueIn(arg, new Map([[x, angleEx(s)]])));
    const c = at(Q0);
    const one = at(Q1);
    const half = at(QHALF);
    if (!c || !one || !half) return null;
    const k = qSub(one, c);
    if (qZero(k) || !qZero(qSub(qSub(half, c), qMul(k, QHALF)))) return null;
    return { k, c };
  } catch {
    return null;
  }
}

const qInvert = (a: Q): Q => q(a.d * Math.sign(a.n), Math.abs(a.n));

class Solver {
  constructor(
    private readonly math: MathJsInstance,
    private readonly deps: TrigEquationDeps,
  ) {}

  private parse(latex: string): MathNode {
    return this.math.parse(this.deps.translate(latex).source);
  }

  /** Every trig call on the unknown replaced by a placeholder symbol. */
  private replaceCalls(node: MathNode, x: string, symbol: (name: string) => string): MathNode {
    return node.transform((m) => (isCallOn(m as AnyNode, x) ? this.math.parse(symbol(fnName(m as AnyNode))) : m));
  }

  solve(latex: string): TrigEquationResult {
    const pre = preprocessLatex(latex ?? "").trim();
    if (!/\\(?:sin|cos|tan|sec|csc|cot)(?![a-z])/.test(pre)) return null;
    const parts = pieces(pre);
    if (parts.length > 2) return null;
    let equation: { L: MathNode; R: MathNode; latex: string } | null = null;
    let range: { sides: string[]; ops: string[] } | null = null;
    for (const p of parts) {
      const split = splitRelations(p);
      if (split.ops.length === 1 && split.ops[0] === "==" && !equation) {
        try {
          equation = { L: this.parse(split.sides[0]), R: this.parse(split.sides[1]), latex: p };
        } catch {
          return null;
        }
      } else if (split.ops.length === 2 && split.ops.every((o) => o === "<" || o === "<=") && !range) range = split;
      else return null;
    }
    if (!equation) return null;
    const { L, R } = equation;
    const free = new Set<string>();
    for (const side of [L, R]) {
      side.traverse((n, path, parent) => {
        const a = n as AnyNode;
        if (a.type === "SymbolNode" && !(parent?.type === "FunctionNode" && path === "fn") && a.name && !["pi", "e", "deg"].includes(a.name)) free.add(a.name);
      });
    }
    if (free.size !== 1) return null;
    const x = [...free][0];
    if (x === W || x === "s" || x === "c") return null;
    const left = trigCalls(L, x);
    const right = trigCalls(R, x);
    const calls = [...left.calls, ...right.calls];
    if (calls.length === 0) return null;
    // from here the line IS a trig equation: an exact answer, or none — never a numeric scan
    if (left.outside || right.outside) refuse();
    const argument = linearArgument((calls[0].args ?? [])[0], x) ?? refuse();
    for (const c of calls) {
      const a = linearArgument((c.args ?? [])[0], x);
      if (!a || !qZero(qSub(a.k, argument.k)) || !qZero(qSub(a.c, argument.c))) refuse();
    }
    const { k, c } = argument;

    // --- the unit and the interval -------------------------------------------------------------
    const { unit, interval, intervalLine } = this.interval(pre, range, x);
    const xTex = symTex(x);
    const argTex = argumentTex(k, c, xTex, unit);
    const lines: string[] = [];

    // --- one function: sin x = cos x → tan x; sin² beside cos → 1 - cos² ------------------------
    const names = [...new Set(calls.map((n) => fnName(n)))];
    let name: Name;
    let working: { L: MathNode; R: MathNode };
    if (names.length === 1 && (names[0] === "sin" || names[0] === "cos" || names[0] === "tan")) {
      name = names[0];
      working = { L, R };
    } else if (names.length === 2 && names.includes("sin") && names.includes("cos")) {
      const reduced = this.reduceSinCos(L, R, x, argTex) ?? refuse();
      name = reduced.name;
      working = { L: reduced.L, R: reduced.R };
      lines.push(...reduced.lines);
    } else return refuse();
    const call = (power = 1): string => trigCallTex(name, power, argTex);

    // --- the algebra: the value(s) of the function ----------------------------------------------
    const wL = this.replaceCalls(working.L, x, () => W);
    const wR = this.replaceCalls(working.R, x, () => W);
    const values = this.functionValues(wL, wR, call, lines);

    // --- the angles ------------------------------------------------------------------------------
    const refs: string[] = [];
    const bases: Base[] = [];
    let bounded = false;
    for (const v of values) {
      const n = exNum(v);
      // sin and cos stay between -1 and 1: a value outside has no angle, and the board says why
      if (name !== "tan" && Math.abs(n) > 1 + 1e-12) {
        bounded = true;
        continue;
      }
      const found = baseSolutions(name, v, unit);
      if (found.ref) {
        const abs = exTex(n < 0 ? exNeg(v) : v, true);
        const refLine = tallBrackets(`\\${name}^{-1}(${abs}) = ${found.ref}`);
        if (!refs.includes(refLine)) refs.push(refLine);
      }
      for (const b of found.bases) if (!bases.some((o) => qZero(qSub(o.k, b.k)))) bases.push(b);
    }

    // every solution for the argument g = kx + c over its range, then x = (g - c)/k
    const gEnds = [qAdd(qMul(k, interval.lo), c), qAdd(qMul(k, interval.hi), c)].map(qVal);
    const [gLo, gHi] = [Math.min(...gEnds), Math.max(...gEnds)];
    const inside = (xv: Q) => {
      const v = qVal(xv);
      const lo = qVal(interval.lo);
      const hi = qVal(interval.hi);
      return (v > lo + 1e-12 || (interval.loIn && Math.abs(v - lo) < 1e-12)) && (v < hi - 1e-12 || (interval.hiIn && Math.abs(v - hi) < 1e-12));
    };
    const sols: Array<{ g: Q; x: Q; tex: string }> = [];
    for (const b of bases) {
      const m0 = Math.floor((gLo - qVal(b.k)) / 2) - 1;
      const m1 = Math.ceil((gHi - qVal(b.k)) / 2) + 1;
      for (let m = m0; m <= m1; m++) {
        const g = qAdd(b.k, q(2 * m));
        const xv = qMul(qSub(g, c), qInvert(k));
        if (!inside(xv) || sols.some((s) => qZero(qSub(s.x, xv)))) continue;
        // `180^{\circ} - 30^{\circ}` shows where a solution comes from; one a turn away is just its angle
        sols.push({ g, x: xv, tex: m === 0 ? b.tex : (angleTex(xv, unit) ?? refuse()) });
      }
    }
    sols.sort((a, b) => qVal(a.x) - qVal(b.x));
    if (sols.length > 8) refuse();

    // --- check: each solution holds, and the interval hides no other ------------------------------
    if (!this.verified(L, R, x, unit, sols.map((s) => s.x), interval)) refuse();

    // --- the lines --------------------------------------------------------------------------------
    const plainX = qZero(qSub(k, Q1)) && qZero(c);
    const answer = sols.length === 0 ? NO_SOLUTION : sols.map((s) => `${xTex} = ${angleTex(s.x, unit) ?? refuse()}`).join(LIST_SEP);
    const angleLines: string[] = [];
    if (sols.length > 0) {
      // `x = 30^{\circ}, \ x = 180^{\circ} - 30^{\circ}`: where each solution comes from
      if (plainX) angleLines.push(sols.map((s) => `${xTex} = ${s.tex}`).join(LIST_SEP));
      else angleLines.push(sols.map((s) => `${argTexBare(k, c, xTex, unit)} = ${angleTex(s.g, unit) ?? refuse()}`).join(LIST_SEP));
    }
    const all: Array<{ tex: string; keep: number }> = [];
    // no solution is none in any interval: the interval line would say nothing
    if (intervalLine && sols.length > 0) all.push({ tex: intervalLine, keep: 3 });
    lines.forEach((l, i) => all.push({ tex: l, keep: i === lines.length - 1 ? 2 : 0 }));
    if (bounded) all.push({ tex: `-1 \\le ${call()} \\le 1`, keep: 2 });
    refs.forEach((r) => all.push({ tex: r, keep: 1 }));
    angleLines.forEach((l) => all.push({ tex: l, keep: 1 }));
    all.push({ tex: answer, keep: 9 });
    // over the block's budget: the algebra's middle lines go first, then the reference angles
    for (let level = 0; level <= 2 && all.length > MAX_LINES; level++) {
      for (let i = all.length - 2; i >= 0 && all.length > MAX_LINES; i--) if (all[i].keep === level) all.splice(i, 1);
    }
    if (all.length > MAX_LINES) refuse();
    const out: string[] = [];
    let last = lineKey(equation.latex);
    for (const l of all) {
      const key = lineKey(l.tex);
      if (key === last) continue;
      out.push(l.tex);
      last = key;
    }
    return { latex: answer, steps: out };
  }

  /** The interval the student wrote (`0 \le x < 2\pi`), or one turn from 0 in the line's unit. */
  private interval(pre: string, range: { sides: string[]; ops: string[] } | null, x: string): { unit: AngleUnit; interval: Interval; intervalLine: string | null } {
    const hasDeg = /\\circ|°/.test(pre);
    const hasPi = /\\pi/.test(pre);
    if (!range) {
      const unit: AngleUnit = hasPi && !hasDeg ? "rad" : "deg";
      const zero = unit === "deg" ? "0^{\\circ}" : "0";
      return { unit, interval: { lo: Q0, hi: q(2), loIn: true, hiIn: false }, intervalLine: `${zero} \\le ${symTex(x)} < ${angleTex(q(2), unit)}` };
    }
    const [loTex, mid, hiTex] = range.sides;
    if (lineKey(mid) !== lineKey(symTex(x))) refuse();
    const bound = (s: string): { v: Q; kind: "deg" | "pi" | "plain" } => {
      const node = this.parse(s);
      const v = exactValueIn(node, new Map());
      if (/\\circ|°/.test(s)) return { v: piMultiple(v) ?? refuse(), kind: "deg" };
      if (/\\pi/.test(s)) return { v: piMultiple(v) ?? refuse(), kind: "pi" };
      if (!exIsRational(v)) refuse();
      return { v: v.r, kind: "plain" };
    };
    const lo = bound(loTex);
    const hi = bound(hiTex);
    const unit: AngleUnit = lo.kind === "pi" || hi.kind === "pi" ? "rad" : "deg";
    // `0 \le x < 360`: plain numbers are degrees when they are that large (0 ≤ x ≤ 1 is refused)
    if (lo.kind === "plain" && hi.kind === "plain" && Math.max(Math.abs(qVal(lo.v)), Math.abs(qVal(hi.v))) < 7) refuse();
    const toPi = (b: { v: Q; kind: string }): Q => (b.kind !== "plain" ? b.v : unit === "deg" ? qMul(b.v, q(1, 180)) : qZero(b.v) ? Q0 : refuse());
    const interval: Interval = { lo: toPi(lo), hi: toPi(hi), loIn: range.ops[0] === "<=", hiIn: range.ops[1] === "<=" };
    if (qVal(interval.hi) <= qVal(interval.lo) || qVal(interval.hi) - qVal(interval.lo) > 8) refuse();
    return { unit, interval, intervalLine: null };
  }

  /**
   * The value(s) of the function. Linear (`2\cos x - 1 = 0` → `2\cos x = 1`, `\cos x = \frac{1}{2}`)
   * exactly, surds and all; a quadratic through the engine's factoring in the placeholder.
   */
  private functionValues(wL: MathNode, wR: MathNode, call: (power?: number) => string, lines: string[]): Ex[] {
    const val = (node: MathNode, w: Ex) => exactValueIn(node, new Map([[W, w]]));
    const L0 = val(wL, exQ(Q0));
    const R0 = val(wR, exQ(Q0));
    const a = exAdd(val(wL, exQ(Q1)), exNeg(L0));
    const b = exAdd(val(wR, exQ(Q1)), exNeg(R0));
    const linear = [2, 3].every((t) => {
      const T = exQ(q(t));
      return Math.abs(exNum(val(wL, T)) - exNum(exAdd(L0, exMul(a, T)))) < 1e-9 && Math.abs(exNum(val(wR, T)) - exNum(exAdd(R0, exMul(b, T)))) < 1e-9;
    });
    if (linear) {
      // `\sin x = \frac{1}{2}` as written: nothing to isolate
      const isolated = (side: MathNode, other: MathNode) => {
        const n = stripParens(side);
        return n.type === "SymbolNode" && n.name === W && !mentionsSymbol(other, W);
      };
      const coef = exAdd(a, exNeg(b));
      if (Math.abs(exNum(coef)) < 1e-12) refuse();
      const rhs = exAdd(R0, exNeg(L0));
      const value = exMul(rhs, exInv(coef));
      if (isolated(wL, wR) || isolated(wR, wL)) {
        if (Math.abs(exNum(coef)) < 1e-12) refuse();
        const v = exMul(exAdd(R0, exNeg(L0)), exInv(coef));
        return [v];
      }
      const isOne = exIsRational(coef) && qZero(qSub(coef.r, Q1));
      if (!isOne) {
        const minusOne = exIsRational(coef) && qZero(qAdd(coef.r, Q1));
        const coefTex = minusOne ? "-" : exIsRational(coef) ? exTex(coef) : `${exTex(coef)} `;
        lines.push(`${coefTex}${call()} = ${exTex(rhs, true)}`);
      }
      lines.push(`${call()} = ${exTex(value, true)}`);
      return [value];
    }
    // quadratic (or higher) in the placeholder: the engine's own steps, the values read back
    const wLatex = `${tex(fromNode(wL))} = ${tex(fromNode(wR))}`;
    const solved = this.deps.solveAlgebra(wLatex) ?? refuse();
    if (/\\approx|\d\.\d/.test(solved.latex) || solved.steps.some((s) => /\\approx|\d\.\d/.test(s))) refuse();
    const values: Ex[] = [];
    if (solved.latex.trim() !== NO_SOLUTION) {
      for (const part of solved.latex.split(/,\s*\\ /)) {
        const m = new RegExp(`^\\s*${W}\\s*=\\s*(.+)$`).exec(part.trim()) ?? refuse();
        const rhs = m[1].trim();
        const pm = /^\\pm\s*/.exec(rhs);
        const branches = pm ? [rhs.slice(pm[0].length), `-(${rhs.slice(pm[0].length)})`] : [rhs];
        for (const br of branches) {
          const v = exactValueIn(this.parse(br), new Map());
          if (!values.some((o) => Math.abs(exNum(o) - exNum(v)) < 1e-12)) values.push(v);
        }
      }
    }
    for (const s of solved.steps) lines.push(backSubstitute(s, W, call));
    // `\sin x = \pm \frac{1}{2}` is written as the two equations it is
    if (/\\pm/.test(lines[lines.length - 1] ?? "") && values.length === 2) {
      lines.pop();
      lines.push(
        [...values]
          .sort((p, r) => exNum(r) - exNum(p))
          .map((v) => `${call()} = ${exTex(v, true)}`)
          .join(LIST_SEP),
      );
    }
    return values;
  }

  /**
   * sin and cos together: a·sin + b·cos = 0 → `\tan x = -\frac{b}{a}`; sin² beside cos →
   * `1 - \cos^{2} x` written in (cos² beside sin the other way round).
   */
  private reduceSinCos(L: MathNode, R: MathNode, x: string, argTex: string): { name: Name; L: MathNode; R: MathNode; lines: string[] } | null {
    const S = "s";
    const C = "c";
    const two = (node: MathNode) => this.replaceCalls(node, x, (n) => (n === "sin" ? S : n === "cos" ? C : refuse()));
    const tl = two(L);
    const tr = two(R);
    const at = (s: Ex, c: Ex): Ex => exAdd(exactValueIn(tl, new Map([[S, s], [C, c]])), exNeg(exactValueIn(tr, new Map([[S, s], [C, c]]))));
    const zero = exQ(Q0);
    const one = exQ(Q1);
    // homogeneous and linear: f(s, c) = a s + b c
    const a = at(one, zero);
    const b = at(zero, one);
    const linear = [
      [q(3, 10), q(7, 10)],
      [q(13, 10), q(-2, 5)],
      [q(-2), QHALF],
    ].every(([s, c]) => Math.abs(exNum(at(exQ(s), exQ(c))) - (exNum(a) * qVal(s) + exNum(b) * qVal(c))) < 1e-9) && Math.abs(exNum(at(zero, zero))) < 1e-12;
    if (linear && Math.abs(exNum(a)) > 1e-12 && Math.abs(exNum(b)) > 1e-12) {
      const ratio = exNeg(exMul(b, exInv(a)));
      const ratioTex = exTex(ratio, true);
      return { name: "tan", L: this.math.parse(`tan(${x})`), R: this.parse(ratioTex), lines: [`${trigCallTex("tan", 1, argTex)} = ${ratioTex}`] };
    }
    // sin appears squared only: sin² = 1 - cos² (and the other way round)
    for (const [even, other] of [
      ["sin", "cos"],
      ["cos", "sin"],
    ] as const) {
      const newL = this.pythagoras(L, x, even, other);
      const newR = this.pythagoras(R, x, even, other);
      if (!newL || !newR) continue;
      const shown = `${this.trigTex(newL, x, argTex)} = ${this.trigTex(newR, x, argTex)}`;
      return { name: other, L: newL, R: newR, lines: [tallBrackets(shown)] };
    }
    return null;
  }

  /** `even(x)^{2k}` → `(1 - other(x)^2)^k`; null when `even` appears to an odd power. */
  private pythagoras(node: MathNode, x: string, even: Name, other: Name): MathNode | null {
    let ok = true;
    const out = node.transform((m, path, parent) => {
      const n = m as AnyNode;
      if (n.type === "OperatorNode" && fnName(n) === "pow") {
        const [b, e] = n.args ?? [];
        const base = stripParens(b);
        if (base.type === "FunctionNode" && fnName(base) === even && mentions(base, x)) {
          const kk = stripParens(e);
          if (kk.type !== "ConstantNode" || typeof kk.value !== "number" || kk.value % 2 !== 0 || kk.value <= 0) {
            ok = false;
            return m;
          }
          const arg = (base.args ?? [])[0];
          const half = kk.value / 2;
          return this.math.parse(`(1 - ${other}(${arg.toString()})^2)${half === 1 ? "" : `^${half}`}`);
        }
      }
      if (isCallOn(n, x) && fnName(n) === even) {
        const p = parent as AnyNode | null;
        const inPow = p && p.type === "OperatorNode" && fnName(p) === "pow" && path === "args[0]";
        if (!inPow) ok = false;
      }
      return m;
    });
    return ok ? out : null;
  }

  /** A side with sin / cos of the argument, printed the teacher's way (`2(1 - \cos^{2} x) + 3\cos x`). */
  private trigTex(node: MathNode, x: string, argTex: string): string {
    const P = "p";
    const V = "v";
    const swapped = this.replaceCalls(node, x, (n) => (n === "sin" ? P : V));
    const t = tex(fromNode(swapped));
    return backSubstitute(backSubstitute(t, P, (pw) => trigCallTex("sin", pw ?? 1, argTex)), V, (pw) => trigCallTex("cos", pw ?? 1, argTex));
  }

  /** Each solution holds, and a scan of the interval finds no root the list lacks. */
  private verified(L: MathNode, R: MathNode, x: string, unit: AngleUnit, sols: readonly Q[], interval: Interval): boolean {
    void unit;
    const f = (t: number): number | null => {
      try {
        // the unknown is an angle: `x + 30 deg` must read as one
        const scope = { [x]: this.math.unit(t, "rad") };
        const a = L.evaluate(scope) as unknown;
        const b = R.evaluate(scope) as unknown;
        if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return null;
        return a - b;
      } catch {
        return null;
      }
    };
    const lo = qVal(interval.lo) * Math.PI;
    const hi = qVal(interval.hi) * Math.PI;
    for (const s of sols) {
      const y = f(qVal(s) * Math.PI);
      if (y === null || Math.abs(y) > 1e-9) return false;
    }
    const known = (t: number) => sols.some((s) => Math.abs(qVal(s) * Math.PI - t) < 1e-4);
    const excludedEnd = (t: number) => (Math.abs(t - lo) < 1e-6 && !interval.loIn) || (Math.abs(t - hi) < 1e-6 && !interval.hiIn);
    const N = 7200;
    const ts: number[] = [];
    const ys: Array<number | null> = [];
    for (let i = 0; i <= N; i++) {
      ts.push(lo + ((hi - lo) * i) / N);
      ys.push(f(ts[i]));
    }
    for (let i = 1; i <= N; i++) {
      const y0 = ys[i - 1];
      const y1 = ys[i];
      if (y0 === null || y1 === null) continue;
      if (y0 === 0 && !known(ts[i - 1]) && !excludedEnd(ts[i - 1])) return false;
      if (Math.sign(y0) !== Math.sign(y1) && y0 !== 0 && y1 !== 0) {
        // a sign change: a root, unless it is a pole (tan) — bisect and look at the value there
        let a = ts[i - 1];
        let b = ts[i];
        let ya = y0;
        for (let k = 0; k < 60; k++) {
          const mid = (a + b) / 2;
          const ym = f(mid);
          if (ym === null) break;
          if (Math.sign(ym) === Math.sign(ya)) {
            a = mid;
            ya = ym;
          } else b = mid;
        }
        const root = (a + b) / 2;
        const yr = f(root);
        if (yr !== null && Math.abs(yr) < 1e-6 && !known(root) && !excludedEnd(root)) return false;
      }
      // a root the curve only touches (sin x = 1): |f| has a local minimum at zero
      if (i >= 2) {
        const yp = ys[i - 2];
        if (yp !== null && Math.abs(y0) < Math.abs(yp) && Math.abs(y0) <= Math.abs(y1) && Math.abs(y0) < 1e-5 && !known(ts[i - 1]) && !excludedEnd(ts[i - 1])) {
          // refine: golden-section on |f| around the grid point
          let a = ts[i - 2];
          let b = ts[i];
          for (let k = 0; k < 80; k++) {
            const m1 = b - 0.618 * (b - a);
            const m2 = a + 0.618 * (b - a);
            const f1 = Math.abs(f(m1) ?? Infinity);
            const f2 = Math.abs(f(m2) ?? Infinity);
            if (f1 < f2) b = m2;
            else a = m1;
          }
          const t = (a + b) / 2;
          if (Math.abs(f(t) ?? 1) < 1e-9 && !known(t)) return false;
        }
      }
    }
    return true;
  }
}

/** `\sin x`, `\sin^{2} x`, `\cos 2x`, `\cos(x - 30^{\circ})`, `\sin\theta`. */
function trigCallTex(name: string, power: number, argTex: string): string {
  const sp = argTex.startsWith("(") || argTex.startsWith("\\") ? "" : " ";
  return `\\${name}${power === 1 ? "" : `^{${power}}`}${sp}${argTex}`;
}

/** `x`, `2x`, `(x - 30^{\circ})`, `\frac{x}{2}` — the argument as it follows `\sin`. */
function argumentTex(k: Q, c: Q, xTex: string, unit: AngleUnit): string {
  const bare = argTexBare(k, c, xTex, unit);
  return qZero(c) ? bare : `(${bare})`;
}

function argTexBare(k: Q, c: Q, xTex: string, unit: AngleUnit): string {
  let kx: string;
  if (qZero(qSub(k, Q1))) kx = xTex;
  else if (qZero(qAdd(k, Q1))) kx = `-${xTex}`;
  else if (qInt(k)) kx = `${k.n}${xTex}`;
  else kx = `${k.n < 0 ? "-" : ""}\\frac{${Math.abs(k.n) === 1 ? "" : Math.abs(k.n)}${xTex}}{${k.d}}`;
  if (qZero(c)) return kx;
  const cTex = angleTex(c.n < 0 ? qNeg(c) : c, unit) ?? refuse();
  return `${kx} ${c.n < 0 ? "-" : "+"} ${cTex}`;
}

/** The placeholder back as the function: `(2w + 1)(w - 1) = 0` → `(2\sin x + 1)(\sin x - 1) = 0`. */
function backSubstitute(latex: string, symbol: string, call: (power?: number) => string): string {
  let out = "";
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === "\\") {
      const m = /^\\[a-zA-Z]+/.exec(latex.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    if (ch === symbol) {
      const pw = /^\^\{?(\d+)\}?/.exec(latex.slice(i + 1));
      if (pw) {
        out += call(Number(pw[1]));
        i += pw[0].length;
      } else out += call();
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * The solutions in [0, 2π) for the function's value v, each as the teacher writes it, and the
 * reference angle (none for 0 and ±1, whose angles are read straight off the axes).
 */
function baseSolutions(name: Name, v: Ex, unit: AngleUnit): { ref: string | null; bases: Base[] } {
  const n = exNum(v);
  const A = (k: Q): string => angleTex(k, unit) ?? refuse();
  const at = (k: Q): Base => ({ k, tex: A(k) });
  const around = (whole: Q, sign: 1 | -1, alpha: Q): Base => ({ k: sign > 0 ? qAdd(whole, alpha) : qSub(whole, alpha), tex: `${A(whole)} ${sign > 0 ? "+" : "-"} ${A(alpha)}` });
  const near = (t: number) => Math.abs(n - t) < 1e-12;
  if (name === "sin") {
    if (near(0)) return { ref: null, bases: [at(Q0), at(Q1)] };
    if (near(1)) return { ref: null, bases: [at(QHALF)] };
    if (near(-1)) return { ref: null, bases: [at(q(3, 2))] };
  }
  if (name === "cos") {
    if (near(0)) return { ref: null, bases: [at(QHALF), at(q(3, 2))] };
    if (near(1)) return { ref: null, bases: [at(Q0)] };
    if (near(-1)) return { ref: null, bases: [at(Q1)] };
  }
  if (name === "tan" && near(0)) return { ref: null, bases: [at(Q0), at(Q1)] };
  const alpha = inverseValue(name as TrigName, n < 0 ? exNeg(v) : v);
  const ref = A(alpha);
  const pos = n > 0;
  let bases: Base[];
  if (name === "sin") bases = pos ? [at(alpha), around(Q1, -1, alpha)] : [around(Q1, 1, alpha), around(q(2), -1, alpha)];
  else if (name === "cos") bases = pos ? [at(alpha), around(q(2), -1, alpha)] : [around(Q1, -1, alpha), around(Q1, 1, alpha)];
  else bases = pos ? [at(alpha), around(Q1, 1, alpha)] : [around(Q1, -1, alpha), around(q(2), -1, alpha)];
  return { ref, bases };
}
