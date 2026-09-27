/**
 * Trigonometry the way a teacher writes it, exactly: the values at the angles a student knows,
 * in degrees and in radians, and the angle of an inverse function at those values.
 *
 *   \sin 60^{\circ} =      \sin 210^{\circ} =        \sec 60^{\circ}              \tan 90^{\circ}
 *   = \frac{\sqrt{3}}{2}   = -\sin 30^{\circ}        = \frac{1}{\cos 60^{\circ}}  = \frac{\sin 90^{\circ}}{\cos 90^{\circ}}
 *                          = -\frac{1}{2}            = 2                          = \frac{1}{0}
 *
 *   \sin^{-1}\left(\frac{1}{2}\right) =      \sin^{2} 30^{\circ} + \cos^{2} 30^{\circ} =
 *   = 30^{\circ}                             = \left(\frac{1}{2}\right)^{2} + \left(\frac{\sqrt{3}}{2}\right)^{2}
 *                                            = \frac{1}{4} + \frac{3}{4}
 *                                            = 1
 *
 * The angles are the multiples of 30° and 45° (π/6 and π/4), any sign, any size: an angle
 * outside the first quadrant is written through its reference angle first. A value that does
 * not exist (tan 90°, sec 90°) is written as the division by zero it is — `\frac{1}{0}` — never
 * as a decimal (mathjs says tan 90° = 1.633 × 10¹⁶) and never in words. An inverse function
 * answers in the unit the line uses: degrees unless π is on it.
 *
 * Built on `calculus.ts`'s exact values (`Ex`: rationals, √, π) and printer. Every value is
 * checked against mathjs before it is returned: a bug here is no answer, never a wrong one.
 */
import type { MathJsInstance, MathNode } from "mathjs";
import {
  div,
  exAtom,
  exFn,
  exInv,
  exIsRational,
  exLit,
  exMul,
  exNeg,
  exNum,
  exPowQ,
  exQ,
  exSqrtQ,
  exTex,
  exAdd,
  fn,
  fromNode,
  I,
  lineKey,
  neg,
  piAtom,
  pow,
  q,
  Q0,
  Q1,
  QHALF,
  qAdd,
  qEq,
  qInt,
  qMul,
  qNeg,
  qSub,
  qVal,
  qZero,
  S,
  tex,
  ZeroDivision,
  type AnyNode,
  type Ex,
  type Expr,
  type Fn,
  type Q,
} from "./calculus";
import type { Translated } from "./latex";
import { preprocessLatex, splitRelations } from "./latex";
import { identitySteps } from "./trigIdentity";

export type TrigName = "sin" | "cos" | "tan" | "sec" | "csc" | "cot";
export const FORWARD: ReadonlySet<string> = new Set(["sin", "cos", "tan", "sec", "csc", "cot"]);
const INVERSE_OF: Record<string, TrigName> = { asin: "sin", acos: "cos", atan: "tan", asec: "sec", acsc: "csc", acot: "cot" };

/** No value exists: tan 90°, sec 270°, sin^{-1}(2). */
export class Undefined extends Error {}
/** The value exists but is not one a teacher writes exactly (sin 20°, sin^{-1}(0.3)). */
export class NotExact extends Error {}

export type AngleUnit = "deg" | "rad";

export const fnName = (n: AnyNode): string => (typeof n.fn === "string" ? n.fn : (n.fn?.name ?? ""));

export function stripParens(node: MathNode): AnyNode {
  let n = node as AnyNode;
  while (n.type === "ParenthesisNode" && n.content) n = n.content as AnyNode;
  return n;
}

function someNode(node: MathNode, pred: (n: AnyNode) => boolean): boolean {
  let hit = false;
  node.traverse((n) => {
    if (!hit && pred(n as AnyNode)) hit = true;
  });
  return hit;
}

const isSymbol = (n: AnyNode, name: string): boolean => n.type === "SymbolNode" && n.name === name;
const isTrigCall = (n: AnyNode): boolean => n.type === "FunctionNode" && (FORWARD.has(fnName(n)) || fnName(n) in INVERSE_OF);

/** Free symbols (not π, e, deg, a function's name). */
export function freeSymbols(node: MathNode): string[] {
  const out = new Set<string>();
  node.traverse((n, path, parent) => {
    const a = n as AnyNode;
    if (a.type !== "SymbolNode" || (parent && parent.type === "FunctionNode" && path === "fn")) return;
    if (a.name && !["pi", "e", "deg", "Infinity"].includes(a.name)) out.add(a.name);
  });
  return [...out];
}

/** Degrees when the line has a degree sign, radians when it has π; degrees otherwise (school). */
export function angleUnitOf(node: MathNode): AngleUnit {
  if (someNode(node, (n) => isSymbol(n, "deg"))) return "deg";
  if (someNode(node, (n) => isSymbol(n, "pi"))) return "rad";
  return "deg";
}

// ---------------------------------------------------------------------------------------------
// Angles: an exact angle is k·π (k rational)
// ---------------------------------------------------------------------------------------------

/** The rational k of an angle kπ, or null when the angle is not a rational multiple of π. */
export function piMultiple(a: Ex): Q | null {
  if (exIsRational(a)) return qZero(a.r) ? Q0 : null;
  if (qZero(a.r) && a.t.length === 1 && a.t[0].a.kind === "pi" && a.t[0].a.p === 1) return a.t[0].c;
  return null;
}

export const angleEx = (k: Q): Ex => (qZero(k) ? exQ(Q0) : exAtom(piAtom(1), k));

/** kπ as the teacher writes the angle: `30^{\circ}` or `\frac{\pi}{6}`; null when not a whole number of degrees. */
export function angleTex(k: Q, unit: AngleUnit): string | null {
  if (unit === "deg") {
    const d = qMul(k, q(180));
    if (!qInt(d)) return null;
    return `${d.n}^{\\circ}`;
  }
  return exTex(angleEx(k));
}

/** `\sin 30^{\circ}`, `\cos\frac{\pi}{4}`, `\tan(-45^{\circ})`. */
export function trigAt(name: string, k: Q, unit: AngleUnit): string {
  const a = angleTex(k, unit) ?? "";
  if (k.n < 0) return `\\${name}(${a})`;
  return a.startsWith("\\") ? `\\${name}${a}` : `\\${name} ${a}`;
}

/** sin(kπ) etc. at the special angles; throws Undefined where the value does not exist, NotExact elsewhere. */
export function trigValue(name: TrigName, k: Q): Ex {
  let v: Ex;
  try {
    v = exFn(name as Fn, angleEx(k));
  } catch (e) {
    if (e instanceof ZeroDivision) throw new Undefined();
    throw new NotExact();
  }
  if (v.t.some((t) => t.a.kind === "fn")) throw new NotExact();
  return v;
}

const SQRT2_2 = (): Ex => exSqrtQ(QHALF); // √2/2
const SQRT3_2 = (): Ex => exMul(exSqrtQ(q(3)), exQ(QHALF));
const SQRT3_3 = (): Ex => exMul(exSqrtQ(q(3)), exQ(q(1, 3)));

/** The angles (in units of π) of the values sin and tan take at the special angles in the first quadrant. */
const SIN_TABLE = (): Array<[Ex, Q]> => [
  [exQ(Q0), Q0],
  [exQ(QHALF), q(1, 6)],
  [SQRT2_2(), q(1, 4)],
  [SQRT3_2(), q(1, 3)],
  [exQ(Q1), QHALF],
];
const TAN_TABLE = (): Array<[Ex, Q]> => [
  [exQ(Q0), Q0],
  [SQRT3_3(), q(1, 6)],
  [exQ(Q1), q(1, 4)],
  [exSqrtQ(q(3)), q(1, 3)],
];

const same = (a: Ex, b: Ex): boolean => Math.abs(exNum(a) - exNum(b)) < 1e-12;

/** The first-quadrant angle kπ (0 ≤ k ≤ 1/2) with sin (or tan) equal to |v|; null when |v| is not special. */
export function referenceAngle(kind: "sin" | "tan", v: Ex): Q | null {
  const abs = exNum(v) < 0 ? exNeg(v) : v;
  for (const [value, k] of kind === "sin" ? SIN_TABLE() : TAN_TABLE()) if (same(value, abs)) return k;
  return null;
}

/** The principal value of an inverse function, as kπ; throws Undefined out of its domain, NotExact off the table. */
export function inverseValue(name: TrigName, v: Ex): Q {
  const n = exNum(v);
  const asin = (x: Ex): Q => {
    if (Math.abs(exNum(x)) > 1 + 1e-12) throw new Undefined();
    const r = referenceAngle("sin", x);
    if (!r) throw new NotExact();
    return exNum(x) < 0 ? qNeg(r) : r;
  };
  const atan = (x: Ex): Q => {
    const r = referenceAngle("tan", x);
    if (!r) throw new NotExact();
    return exNum(x) < 0 ? qNeg(r) : r;
  };
  const recip = (x: Ex): Ex => {
    try {
      return exInv(x);
    } catch {
      throw new Undefined();
    }
  };
  switch (name) {
    case "sin":
      return asin(v);
    case "cos":
      return qSub(QHALF, asin(v));
    case "tan":
      return atan(v);
    case "csc":
      if (Math.abs(n) < 1 - 1e-12) throw new Undefined();
      return asin(recip(v));
    case "sec":
      if (Math.abs(n) < 1 - 1e-12) throw new Undefined();
      return qSub(QHALF, asin(recip(v)));
    case "cot":
      if (Math.abs(n) < 1e-15) return QHALF;
      return n > 0 ? atan(recip(v)) : qAdd(Q1, atan(recip(v)));
  }
}

// ---------------------------------------------------------------------------------------------
// Exact evaluation of a closed line
// ---------------------------------------------------------------------------------------------

const DEGREE = (): Ex => exAtom(piAtom(1), q(1, 180));

/** A closed mathjs tree as an exact value (radians for an angle); throws Undefined / NotExact. */
export function exactValue(node: MathNode): Ex {
  return exactValueIn(node, new Map());
}

/** The same, with values for symbols (the unknown of an equation, a placeholder). */
export function exactValueIn(node: MathNode, env: ReadonlyMap<string, Ex>): Ex {
  const exactValue = (m: MathNode): Ex => exactValueIn(m, env);
  const n = stripParens(node);
  const guard = (f: () => Ex): Ex => {
    try {
      return f();
    } catch (e) {
      if (e instanceof Undefined || e instanceof NotExact) throw e;
      if (e instanceof ZeroDivision) throw new Undefined();
      throw new NotExact();
    }
  };
  switch (n.type) {
    case "ConstantNode": {
      if (typeof n.value !== "number") throw new NotExact();
      if (Number.isInteger(n.value)) return exQ(q(n.value));
      // `0.5`, `0.25`: a terminating decimal is its fraction
      const f = decimalFraction(n.value);
      if (!f) throw new NotExact();
      return exQ(f);
    }
    case "SymbolNode":
      if (n.name && env.has(n.name)) return env.get(n.name)!;
      if (n.name === "pi") return exAtom(piAtom(1));
      if (n.name === "deg") return DEGREE();
      if (n.name === "e") return guard(() => exFn("exp", exQ(Q1)));
      throw new NotExact();
    case "OperatorNode": {
      const f = fnName(n);
      const a = n.args ?? [];
      switch (f) {
        case "add":
          return exAdd(exactValue(a[0]), exactValue(a[1]));
        case "subtract":
          return exAdd(exactValue(a[0]), exNeg(exactValue(a[1])));
        case "multiply":
          return guard(() => exMul(exactValue(a[0]), exactValue(a[1])));
        case "divide": {
          const top = exactValue(a[0]);
          const bottom = exactValue(a[1]);
          if (Math.abs(exNum(bottom)) < 1e-15) throw new Undefined();
          return guard(() => exMul(top, exInv(bottom)));
        }
        case "unaryMinus":
          return exNeg(exactValue(a[0]));
        case "unaryPlus":
          return exactValue(a[0]);
        case "pow": {
          const base = exactValue(a[0]);
          const k = exactValue(a[1]);
          if (!exIsRational(k)) throw new NotExact();
          return guard(() => exPowQ(base, k.r));
        }
        default:
          throw new NotExact();
      }
    }
    case "FunctionNode": {
      const name = fnName(n);
      const a = n.args ?? [];
      if (a.length !== 1) throw new NotExact();
      if (FORWARD.has(name)) {
        const k = piMultiple(exactValue(a[0]));
        if (!k) throw new NotExact();
        return trigValue(name as TrigName, k);
      }
      if (name in INVERSE_OF) return angleEx(inverseValue(INVERSE_OF[name], exactValue(a[0])));
      if (name === "sqrt") return guard(() => exPowQ(exactValue(a[0]), QHALF));
      const other: Record<string, Fn> = { log: "ln", log10: "log10", exp: "exp", abs: "abs" };
      if (other[name]) {
        const v = guard(() => exFn(other[name], exactValue(a[0])));
        if (v.t.some((t) => t.a.kind === "fn")) throw new NotExact();
        return v;
      }
      throw new NotExact();
    }
    default:
      throw new NotExact();
  }
}

/** A decimal with at most 4 places as the exact fraction it is (0.5 → ½), else null. */
function decimalFraction(v: number): Q | null {
  for (const d of [10, 100, 1000, 10000]) {
    const n = Math.round(v * d);
    if (Math.abs(n / d - v) < 1e-12) return q(n, d);
  }
  return null;
}

/** The line's value is an angle: an inverse function, or a sum / rational multiple of them. */
function angleValued(node: MathNode): boolean {
  const n = stripParens(node);
  if (n.type === "FunctionNode") return fnName(n) in INVERSE_OF;
  if (n.type !== "OperatorNode") return false;
  const f = fnName(n);
  const a = n.args ?? [];
  const constant = (m: MathNode) => freeSymbols(m).length === 0 && !someNode(m, isTrigCall) && !someNode(m, (x) => isSymbol(x, "deg") || isSymbol(x, "pi"));
  if (f === "unaryMinus" || f === "unaryPlus") return angleValued(a[0]);
  if (f === "add" || f === "subtract") return angleValued(a[0]) && angleValued(a[1]);
  if (f === "multiply") return (constant(a[0]) && angleValued(a[1])) || (angleValued(a[0]) && constant(a[1]));
  if (f === "divide") return angleValued(a[0]) && constant(a[1]);
  return false;
}

/** A value as the answer line: an angle in the line's unit, otherwise the exact number. */
function valueTex(v: Ex, angle: boolean, unit: AngleUnit): string {
  if (!angle) return exTex(v, true);
  const k = piMultiple(v);
  const a = k ? angleTex(k, unit) : null;
  if (!a) throw new NotExact();
  return a;
}

// ---------------------------------------------------------------------------------------------
// Printing a closed line with its values written in
// ---------------------------------------------------------------------------------------------

/** mathjs tree → calculus Expr, each trig call replaced by `replace(call)` (a written-in value). */
function toExpr(node: MathNode, replace: (call: AnyNode) => Expr): Expr {
  const n = stripParens(node);
  switch (n.type) {
    case "ConstantNode":
      if (typeof n.value !== "number" || !Number.isInteger(n.value)) throw new NotExact();
      return I(n.value);
    case "SymbolNode":
      if (n.name === "pi" || n.name === "e") return S(n.name);
      if (n.name && /^[a-zA-Z]$/.test(n.name)) return S(n.name);
      throw new NotExact();
    case "OperatorNode": {
      const f = fnName(n);
      const a = (n.args ?? []).map((x) => toExpr(x, replace));
      switch (f) {
        case "add":
          return { t: "add", args: [a[0], a[1]] };
        case "subtract":
          return { t: "add", args: [a[0], neg(a[1])] };
        case "multiply":
          return { t: "mul", args: [a[0], a[1]] };
        case "divide":
          return div(a[0], a[1]);
        case "unaryMinus":
          return neg(a[0]);
        case "unaryPlus":
          return a[0];
        case "pow":
          return a[0].t === "sym" && a[0].name === "e" ? fn("exp", a[1]) : pow(a[0], a[1]);
        default:
          throw new NotExact();
      }
    }
    case "FunctionNode": {
      if (isTrigCall(n)) return replace(n);
      const name = fnName(n);
      const a = (n.args ?? []).map((x) => toExpr(x, replace));
      if (a.length !== 1) throw new NotExact();
      if (name === "sqrt") return { t: "sqrt", arg: a[0] };
      const other: Record<string, Fn> = { log: "ln", log10: "log10", exp: "exp", abs: "abs" };
      if (other[name]) return fn(other[name], a[0]);
      throw new NotExact();
    }
    default:
      throw new NotExact();
  }
}

/** A written-in value: `\frac{\sqrt{3}}{2}`, `30^{\circ}`. */
function lit(texStr: string, v: Ex): Expr {
  const base = exLit(v);
  const atom = base.t === "lit" && base.atom;
  return { t: "lit", tex: texStr, neg: exNum(v) < 0, atom: atom || /^\d+\^\{\\circ\}$/.test(texStr) };
}

// ---------------------------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------------------------

export interface TrigDeps {
  /** LaTeX → mathjs source (the engine's `translate`); throws on LaTeX it cannot read */
  translate(latex: string): Translated;
}

export type TrigValueResult = { kind: "exact"; latex: string } | { kind: "undefined" };

export interface Trig {
  /** The exact value of a closed line with trig in it (`\frac{\sqrt{3}}{2}`, `30^{\circ}`); `undefined` for tan 90°; null when not trig or not exact. */
  value(source: string): TrigValueResult | null;
  /** Teacher steps for a closed trig line (`simplifySteps`); null when there is nothing exact to write. */
  steps(latex: string): string[] | null;
}

export function createTrig(math: MathJsInstance, deps: TrigDeps): Trig {
  const numeric = (source: string): number | null => {
    try {
      const v = math.evaluate(source) as unknown;
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      const o = v as { toNumber?: (u?: string) => number; re?: number; im?: number };
      if (typeof o?.re === "number" && typeof o.im === "number") return Math.abs(o.im) < 1e-12 ? o.re : null;
      if (typeof o?.toNumber === "function") return o.toNumber("rad");
      return null;
    } catch {
      return null;
    }
  };

  const closedTrig = (source: string): MathNode | null => {
    let node: MathNode;
    try {
      node = math.parse(source);
    } catch {
      return null;
    }
    if (!someNode(node, isTrigCall)) return null;
    if (freeSymbols(node).length > 0) return null;
    return node;
  };

  const value = (source: string): TrigValueResult | null => {
    const node = closedTrig(source);
    if (!node) return null;
    try {
      const v = exactValue(node);
      const n = numeric(source);
      if (n === null || Math.abs(n - exNum(v)) > 1e-9 * Math.max(1, Math.abs(n))) return null;
      return { kind: "exact", latex: valueTex(v, angleValued(node), angleUnitOf(node)) };
    } catch (e) {
      return e instanceof Undefined ? { kind: "undefined" } : null;
    }
  };

  /** Each line must be the same number as the question (read back through the translator). */
  const agrees = (lines: readonly string[], v: number): boolean =>
    lines.every((l) => {
      if (/\\frac\{-?1\}\{0\}/.test(l)) return true;
      try {
        const n = numeric(deps.translate(l).source);
        return n !== null && Math.abs(n - v) <= 1e-9 * Math.max(1, Math.abs(v));
      } catch {
        return false;
      }
    });

  const RECIPROCAL: Partial<Record<TrigName, TrigName>> = { sec: "cos", csc: "sin", cot: "tan" };

  /** One trig call at a special angle: reference angle, reciprocal, value. */
  const callSteps = (name: TrigName, k: Q, unit: AngleUnit): string[] => {
    if (!angleTex(k, unit)) throw new NotExact();
    const recip = RECIPROCAL[name];
    const base = recip ?? name;
    // undefined: the division by zero, written out
    let value: Ex | null = null;
    try {
      value = trigValue(name, k);
    } catch (e) {
      if (!(e instanceof Undefined)) throw e;
    }
    if (!value) {
      const s = trigValue("sin", k);
      const c = trigValue("cos", k);
      const zeroTop = (v: Ex) => `\\frac{${exTex(v)}}{0}`;
      switch (name) {
        case "tan":
          return [`\\frac{${trigAt("sin", k, unit)}}{${trigAt("cos", k, unit)}}`, zeroTop(s)];
        case "cot":
          return [`\\frac{${trigAt("cos", k, unit)}}{${trigAt("sin", k, unit)}}`, zeroTop(c)];
        default:
          return [`\\frac{1}{${trigAt(base, k, unit)}}`, "\\frac{1}{0}"];
      }
    }
    const lines: string[] = [];
    if (recip) {
      if (name === "cot" && Math.abs(exNum(trigValue("cos", k))) < 1e-15) {
        // cot 90° = cos 90° / sin 90° (tan 90° does not exist)
        lines.push(`\\frac{${trigAt("cos", k, unit)}}{${trigAt("sin", k, unit)}}`);
      } else lines.push(`\\frac{1}{${trigAt(base, k, unit)}}`);
    }
    // the reference angle: in [0, 2π), then into the first quadrant with the sign of the quadrant
    const turn = qMul(k, QHALF); // k/2 turns
    const within = qSub(k, qMul(q(2), q(Math.floor(qVal(turn) + 1e-12))));
    const w = qVal(within);
    const quadrantal = qInt(qMul(within, q(2)));
    if (!quadrantal && (w > 0.5 || !qEq(within, k))) {
      let ref: Q;
      if (w < 0.5) ref = within;
      else if (w < 1) ref = qSub(Q1, within);
      else if (w < 1.5) ref = qSub(within, Q1);
      else ref = qSub(q(2), within);
      const sign = exNum(trigValue(base, within)) < 0 ? "-" : "";
      const refCall = trigAt(base, ref, unit);
      lines.push(recip ? `${sign}\\frac{1}{${refCall}}` : `${sign}${refCall}`);
    }
    lines.push(exTex(value, true));
    return lines;
  };

  const closedSteps = (node: MathNode, input: string): string[] | null => {
    const unit = angleUnitOf(node);
    const angle = angleValued(node);
    const top = stripParens(node);
    let lines: string[];
    if (top.type === "FunctionNode" && FORWARD.has(fnName(top))) {
      const k = piMultiple(exactValue((top.args ?? [])[0]));
      if (!k) return null;
      lines = callSteps(fnName(top) as TrigName, k, unit);
    } else if (top.type === "FunctionNode" && fnName(top) in INVERSE_OF) {
      lines = [valueTex(exactValue(node), true, unit)];
    } else {
      const total = exactValue(node);
      // several values: each written in, then (a sum) each term, then the total
      const written = toExpr(node, (call) => {
        const v = exactValue(call);
        return lit(valueTex(v, fnName(call) in INVERSE_OF, unit), v);
      });
      lines = [tallBrackets(tex(written))];
      const terms = topTerms(node);
      if (terms.length >= 2 && !angle) lines.push(joinTerms(terms.map((t) => (t.neg ? exNeg(exactValue(t.node)) : exactValue(t.node)))));
      lines.push(valueTex(total, angle, unit));
    }
    const out: string[] = [];
    let last = lineKey(input);
    for (const l of lines) {
      const k = lineKey(l);
      if (k === last) continue;
      out.push(l);
      last = k;
    }
    return out.length ? out : null;
  };

  const steps = (latex: string): string[] | null => {
    try {
      const pre = preprocessLatex(latex ?? "").trim().replace(/=\s*$/, "").trim();
      if (!pre || splitRelations(pre).ops.length > 0) return null;
      if (!/\\(?:sin|cos|tan|sec|csc|cot|arc)/.test(pre)) return null;
      const source = deps.translate(pre).source;
      const node = closedTrig(source);
      if (!node) {
        // an expression in x: simplified with the identities (`trigIdentity.ts`)
        const parsed = math.parse(source);
        const vars = freeSymbols(parsed);
        if (vars.length !== 1 || !someNode(parsed, isTrigCall)) return null;
        return identitySteps(fromNode(parsed), vars[0], pre);
      }
      const v = value(source);
      if (!v) return null;
      const lines = closedSteps(node, pre);
      if (!lines) return null;
      if (v.kind === "exact") {
        const n = numeric(source);
        if (n === null || !agrees(lines, n)) return null;
      }
      return lines;
    } catch {
      return null;
    }
  };

  return { value, steps };
}

// ---------------------------------------------------------------------------------------------
// Helpers for the written-in lines
// ---------------------------------------------------------------------------------------------

/** `(\frac{1}{2})^{2}` → `\left(\frac{1}{2}\right)^{2}`: a bracket round a fraction is as tall as it. */
export function tallBrackets(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(" && /^-?\\frac/.test(s.slice(i + 1)) && !/\\left$/.test(out)) {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")" && --depth === 0) break;
      }
      if (j < s.length) {
        out += `\\left(${tallBrackets(s.slice(i + 1, j))}\\right)`;
        i = j;
        continue;
      }
    }
    out += s[i];
  }
  return out;
}

/** The terms of a top-level sum, each with its sign: `a - b + c` → a, -b, c. */
function topTerms(node: MathNode): Array<{ node: MathNode; neg: boolean }> {
  const n = stripParens(node);
  if (n.type === "OperatorNode" && (fnName(n) === "add" || fnName(n) === "subtract")) {
    const [a, b] = n.args ?? [];
    const right = topTerms(b).map((t) => ({ ...t, neg: fnName(n) === "subtract" ? !t.neg : t.neg }));
    return [...topTerms(a), ...right];
  }
  return [{ node: n, neg: false }];
}

function joinTerms(terms: readonly Ex[]): string {
  let out = "";
  terms.forEach((t, i) => {
    const s = exTex(t, true);
    if (i === 0) out = s;
    else out += s.startsWith("-") ? ` - ${s.slice(1)}` : ` + ${s}`;
  });
  return out;
}

