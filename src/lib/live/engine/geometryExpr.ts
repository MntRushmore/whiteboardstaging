/**
 * The maths of a figure as a small tree the tutor can evaluate the way a teacher does on the
 * board — one kind of operation at a time, innermost first — and print back in the student's
 * notation:
 *
 *   d = \sqrt{(4 - 1)^{2} + (6 - 2)^{2}}      V = \frac{4}{3}\pi(3)^{3}      \frac{(8 - 2) \cdot 180^{\circ}}{8}
 *   d = \sqrt{3^{2} + 4^{2}}                  V = \frac{4}{3}\pi(27)         = \frac{6 \cdot 180^{\circ}}{8}
 *   d = \sqrt{9 + 16}                         V = 36\pi                      = \frac{1080^{\circ}}{8}
 *   d = \sqrt{25}                                                            = 135^{\circ}
 *   d = 5
 *
 * A round reduces every node whose children are already numbers, choosing the operations in the
 * school order: anything inside a bracket, a root or a fraction bar first, then powers, roots and
 * trig values, then products and quotients, then sums. Values stay exact (`geometryValue.ts`:
 * `25\pi`, `6\sqrt{2}`, `70^{\circ}`); a value that is not exact (`\tan 40^{\circ}`) is left written
 * and the numbers beside it are combined (`176\cos 37^{\circ}`), and the caller finishes with a
 * decimal and `\approx`. Pure: the tree is built from a parsed mathjs node, nothing is evaluated
 * by mathjs.
 */
import type { MathNode } from "mathjs";
import { q, type Q } from "./algebra";
import { nameLatex } from "./geometryNotation";
import {
  NoValue,
  NotExact,
  vAbs,
  vAdd,
  vDegree,
  vDiv,
  vInverseDegrees,
  vIsRational,
  vLatex,
  vMul,
  vNeg,
  vNum,
  vPi,
  vPow,
  vQ,
  vRational,
  vRoot,
  vTrig,
  vUnit,
  type InverseFn,
  type PrintOptions,
  type TrigFn,
  type Val,
} from "./geometryValue";

export class NotGeometry extends Error {}
const notGeometry = (): never => {
  throw new NotGeometry();
};

export type G =
  | { k: "val"; v: Val; text?: string }
  | { k: "sym"; name: string }
  | { k: "add"; items: Array<{ neg: boolean; g: G }> }
  | { k: "mul"; items: G[] }
  | { k: "div"; num: G; den: G }
  | { k: "pow"; base: G; exp: G }
  | { k: "root"; arg: G; n: number }
  | { k: "abs"; arg: G }
  | { k: "fn"; name: TrigFn | InverseFn; arg: G }
  | { k: "paren"; g: G }
  | { k: "neg"; g: G };

const FORWARD = new Set(["sin", "cos", "tan", "sec", "csc", "cot"]);
const INVERSE = new Set(["asin", "acos", "atan"]);

export const gVal = (v: Val, text?: string): G => ({ k: "val", v, text });
export const gNum = (n: number): G => gVal(vQ(q(n)));
export const gSym = (name: string): G => ({ k: "sym", name });

// ---------------------------------------------------------------- from mathjs

type AnyNode = MathNode & {
  type: string;
  value?: unknown;
  name?: string;
  op?: string;
  fn?: { name?: string } | string;
  args?: MathNode[];
  content?: MathNode;
  implicit?: boolean;
};

/** A decimal literal as an exact rational: `2.5` → 5/2. */
function literalQ(value: number): Q {
  if (!Number.isFinite(value)) notGeometry();
  const s = String(value);
  if (/e/i.test(s)) notGeometry();
  const [whole, frac = ""] = s.split(".");
  try {
    return q(Number(whole + frac), 10 ** frac.length);
  } catch {
    return notGeometry();
  }
}

export interface FromNodeOptions {
  /** names the translator read as units (`cm`, `deg`) */
  units?: ReadonlySet<string>;
}

const fnNameOf = (n: AnyNode): string => (typeof n.fn === "string" ? n.fn : (n.fn?.name ?? ""));

/** A parsed mathjs node (from the engine's own translation) as a geometry tree; throws NotGeometry. */
export function fromNode(node: MathNode, opts: FromNodeOptions = {}): G {
  const n = node as AnyNode;
  switch (n.type) {
    case "ConstantNode": {
      if (typeof n.value !== "number") return notGeometry();
      const v = vQ(literalQ(n.value));
      const text = String(n.value);
      return gVal(v, /\./.test(text) ? text : undefined);
    }
    case "SymbolNode": {
      const name = n.name ?? "";
      if (name === "pi") return gVal(vPi());
      if (name === "deg") return gVal(vDegree());
      if (name === "e" || name === "Infinity" || name === "i") return notGeometry();
      if (opts.units?.has(name)) return gVal(vUnit(name));
      return gSym(name);
    }
    case "ParenthesisNode": {
      const inner = n.content as AnyNode;
      // `((a)/(b))` is how the translator writes `\frac{a}{b}`: the bar is the grouping
      if (inner.type === "OperatorNode" && inner.op === "/" && inner.args?.length === 2) {
        const [a, b] = inner.args as AnyNode[];
        if (a.type === "ParenthesisNode" && b.type === "ParenthesisNode") return frac(fromNode(a.content!, opts), fromNode(b.content!, opts));
      }
      return { k: "paren", g: fromNode(inner, opts) };
    }
    case "OperatorNode": {
      const args = (n.args ?? []) as AnyNode[];
      if (n.op === "-" && args.length === 1) return { k: "neg", g: fromNode(args[0], opts) };
      if (n.op === "+" && args.length === 1) return fromNode(args[0], opts);
      if (args.length !== 2) return notGeometry();
      const [a, b] = args.map((x) => fromNode(x, opts));
      switch (n.op) {
        case "+":
        case "-": {
          const items = a.k === "add" ? [...a.items] : [{ neg: false, g: a }];
          items.push({ neg: n.op === "-", g: b });
          return { k: "add", items };
        }
        case "*": {
          const items = [...(a.k === "mul" ? a.items : [a]), ...(b.k === "mul" ? b.items : [b])];
          return foldMarks({ k: "mul", items });
        }
        case "/":
          return frac(a, b);
        case "^":
          return { k: "pow", base: a, exp: b };
        default:
          return notGeometry();
      }
    }
    case "FunctionNode": {
      const name = fnNameOf(n);
      const args = (n.args ?? []).map((x) => fromNode(x, opts));
      if (name === "sqrt" && args.length === 1) return { k: "root", arg: args[0], n: 2 };
      if (name === "nthRoot" && args.length === 2) {
        const idx = args[1];
        const r = idx.k === "val" ? vRational(idx.v) : null;
        if (!r || r.d !== 1 || r.n < 2 || r.n > 9) return notGeometry();
        return { k: "root", arg: args[0], n: r.n };
      }
      if (name === "cbrt" && args.length === 1) return { k: "root", arg: args[0], n: 3 };
      if (name === "abs" && args.length === 1) return { k: "abs", arg: args[0] };
      if ((FORWARD.has(name) || INVERSE.has(name)) && args.length === 1) return { k: "fn", name: name as TrigFn, arg: args[0] };
      return notGeometry();
    }
    default:
      return notGeometry();
  }
}

/** `\frac{1}{2}`: a fraction of whole numbers in lowest terms is one number already. */
function frac(num: G, den: G): G {
  if (num.k === "val" && den.k === "val" && !num.text && !den.text) {
    const a = vRational(num.v);
    const b = vRational(den.v);
    if (a && b && a.d === 1 && b.d === 1 && b.n > 0 && num.v.deg === 0 && den.v.deg === 0 && num.v.len === 0 && den.v.len === 0) {
      const r = q(a.n, b.n);
      if (r.n === a.n && r.d === b.n) return gVal(vQ(r));
    }
  }
  return { k: "div", num, den };
}

const isMark = (g: G): boolean => g.k === "val" && !g.text && vIsRational(g.v) && vRational(g.v)!.n === 1 && vRational(g.v)!.d === 1 && (g.v.deg !== 0 || g.v.len !== 0);

/** `35 deg` is one number, 35°; `5 cm` one length. */
function foldMarks(m: { k: "mul"; items: G[] }): G {
  const items: G[] = [];
  for (const g of m.items) {
    const prev = items[items.length - 1];
    if (isMark(g) && prev?.k === "val" && prev.v.deg === 0 && prev.v.len === 0) {
      items[items.length - 1] = gVal(vMul(prev.v, (g as { v: Val }).v), prev.text);
      continue;
    }
    items.push(g);
  }
  return items.length === 1 ? items[0] : { k: "mul", items };
}

// ---------------------------------------------------------------- inspection

export function symbolsOf(g: G, out: Set<string> = new Set()): Set<string> {
  switch (g.k) {
    case "val":
      return out;
    case "sym":
      out.add(g.name);
      return out;
    case "add":
      g.items.forEach((i) => symbolsOf(i.g, out));
      return out;
    case "mul":
      g.items.forEach((i) => symbolsOf(i, out));
      return out;
    case "div":
      symbolsOf(g.num, out);
      return symbolsOf(g.den, out);
    case "pow":
      symbolsOf(g.base, out);
      return symbolsOf(g.exp, out);
    case "root":
    case "abs":
    case "fn":
      return symbolsOf(g.arg, out);
    case "paren":
    case "neg":
      return symbolsOf(g.g, out);
  }
}

export const isClosed = (g: G): boolean => symbolsOf(g).size === 0;

export function someNode(g: G, pred: (x: G) => boolean): boolean {
  if (pred(g)) return true;
  switch (g.k) {
    case "val":
    case "sym":
      return false;
    case "add":
      return g.items.some((i) => someNode(i.g, pred));
    case "mul":
      return g.items.some((i) => someNode(i, pred));
    case "div":
      return someNode(g.num, pred) || someNode(g.den, pred);
    case "pow":
      return someNode(g.base, pred) || someNode(g.exp, pred);
    case "root":
    case "abs":
    case "fn":
      return someNode(g.arg, pred);
    case "paren":
    case "neg":
      return someNode(g.g, pred);
  }
}

export const hasTrig = (g: G): boolean => someNode(g, (x) => x.k === "fn");
export const hasPi = (g: G): boolean => someNode(g, (x) => x.k === "val" && x.v.terms.some((t) => t.pi !== 0));
export const hasRoot = (g: G): boolean => someNode(g, (x) => x.k === "root");
export const hasDegrees = (g: G): boolean => someNode(g, (x) => x.k === "val" && x.v.deg !== 0);
export const hasUnits = (g: G): boolean => someNode(g, (x) => x.k === "val" && x.v.len !== 0);
export const hasAbs = (g: G): boolean => someNode(g, (x) => x.k === "abs");

/** Replaces symbols by trees (a substituted value is bracketed where the student would bracket it). */
export function substitute(g: G, values: ReadonlyMap<string, G>): G {
  const sub = (x: G): G => substitute(x, values);
  switch (g.k) {
    case "val":
      return g;
    case "sym": {
      const v = values.get(g.name);
      return v ?? g;
    }
    case "add":
      return { k: "add", items: g.items.map((i) => ({ neg: i.neg, g: sub(i.g) })) };
    case "mul":
      return { k: "mul", items: g.items.map(sub) };
    case "div":
      return { k: "div", num: sub(g.num), den: sub(g.den) };
    case "pow":
      return { k: "pow", base: sub(g.base), exp: sub(g.exp) };
    case "root":
      return { k: "root", arg: sub(g.arg), n: g.n };
    case "abs":
      return { k: "abs", arg: sub(g.arg) };
    case "fn":
      return { k: "fn", name: g.name, arg: sub(g.arg) };
    case "paren":
      return { k: "paren", g: sub(g.g) };
    case "neg":
      return { k: "neg", g: sub(g.g) };
  }
}

// ---------------------------------------------------------------- exact and numeric values

export interface EvalOptions {
  /** inverse trig answers in radians (π on the line) instead of degrees */
  radians?: boolean;
  env?: ReadonlyMap<string, Val>;
}

/** The exact value of a closed tree; throws NotExact (not writable exactly) or NoValue. */
export function evalExact(g: G, opts: EvalOptions = {}): Val {
  const ev = (x: G) => evalExact(x, opts);
  switch (g.k) {
    case "val":
      return g.v;
    case "sym": {
      const v = opts.env?.get(g.name);
      if (!v) throw new NotExact();
      return v;
    }
    case "add":
      return g.items.map((i) => (i.neg ? vNeg(ev(i.g)) : ev(i.g))).reduce(vAdd);
    case "mul":
      return g.items.map(ev).reduce(vMul);
    case "div":
      return vDiv(ev(g.num), ev(g.den));
    case "pow": {
      const e = vRational(ev(g.exp));
      if (!e) throw new NotExact();
      return vPow(ev(g.base), e);
    }
    case "root":
      return vRoot(ev(g.arg), g.n);
    case "abs":
      return vAbs(ev(g.arg));
    case "fn": {
      if (FORWARD.has(g.name)) return vTrig(g.name as TrigFn, ev(g.arg));
      const d = vInverseDegrees(g.name as InverseFn, ev(g.arg));
      if (opts.radians) return vMul(vQ(q(d, 180)), vPi());
      return vQ(q(d), 1);
    }
    case "paren":
      return ev(g.g);
    case "neg":
      return vNeg(ev(g.g));
  }
}

export interface NumValue {
  n: number;
  /** degree dimension (an angle in degrees) */
  deg: number;
  /** π appears: a trig argument is in radians */
  pi: boolean;
}

/** Decimal value of a tree (`scope` for its unknowns); NaN when undefined. Trig reads degrees unless the angle has π in it. */
export function evalNumber(g: G, scope: ReadonlyMap<string, NumValue> = new Map(), opts: { radians?: boolean } = {}): NumValue {
  const ev = (x: G) => evalNumber(x, scope, opts);
  const nan: NumValue = { n: NaN, deg: 0, pi: false };
  switch (g.k) {
    case "val":
      return { n: vNum(g.v), deg: g.v.deg, pi: g.v.terms.some((t) => t.pi !== 0) };
    case "sym":
      return scope.get(g.name) ?? nan;
    case "add": {
      const vs = g.items.map((i) => ({ v: ev(i.g), neg: i.neg }));
      return { n: vs.reduce((s, x) => s + (x.neg ? -x.v.n : x.v.n), 0), deg: vs.find((x) => x.v.deg !== 0)?.v.deg ?? 0, pi: vs.some((x) => x.v.pi) };
    }
    case "mul": {
      const vs = g.items.map(ev);
      return { n: vs.reduce((s, x) => s * x.n, 1), deg: vs.reduce((s, x) => s + x.deg, 0), pi: vs.some((x) => x.pi) };
    }
    case "div": {
      const a = ev(g.num);
      const b = ev(g.den);
      return { n: b.n === 0 ? NaN : a.n / b.n, deg: a.deg - b.deg, pi: a.pi || b.pi };
    }
    case "pow": {
      const a = ev(g.base);
      const e = ev(g.exp);
      return { n: a.n ** e.n, deg: a.deg * e.n, pi: a.pi };
    }
    case "root": {
      const a = ev(g.arg);
      const n = g.n % 2 === 1 && a.n < 0 ? -((-a.n) ** (1 / g.n)) : a.n < 0 ? NaN : a.n ** (1 / g.n);
      return { n, deg: a.deg / g.n, pi: a.pi };
    }
    case "abs": {
      const a = ev(g.arg);
      return { ...a, n: Math.abs(a.n) };
    }
    case "fn": {
      const a = ev(g.arg);
      if (FORWARD.has(g.name)) {
        const rad = a.deg === 0 && a.pi ? a.n : (a.n * Math.PI) / 180;
        const s = Math.sin(rad);
        const c = Math.cos(rad);
        const table: Record<string, number> = { sin: s, cos: c, tan: s / c, sec: 1 / c, csc: 1 / s, cot: c / s };
        return { n: table[g.name], deg: 0, pi: false };
      }
      const f = g.name === "asin" ? Math.asin : g.name === "acos" ? Math.acos : Math.atan;
      const r = f(a.n);
      return opts.radians ? { n: r, deg: 0, pi: true } : { n: (r * 180) / Math.PI, deg: 1, pi: false };
    }
    case "paren":
      return ev(g.g);
    case "neg": {
      const a = ev(g.g);
      return { ...a, n: -a.n };
    }
  }
}

// ---------------------------------------------------------------- printing

export interface GPrint extends PrintOptions {
  /** `m\angle A` rather than `\angle A` (the student's own style) */
  measure?: boolean;
}

const hasFrac = (s: string): boolean => /\\frac/.test(s);
const paren = (s: string): string => (hasFrac(s) ? `\\left(${s}\\right)` : `(${s})`);

function valText(g: { v: Val; text?: string }, opts: GPrint): string {
  if (g.text && g.v.deg === 0 && g.v.len === 0) return g.text;
  if (g.text && g.v.deg === 1) return `${g.text}^{\\circ}`;
  return vLatex(g.v, opts);
}

const isNegativeVal = (g: G): boolean => g.k === "val" && vNum(g.v) < 0;
/** A number written as digits (no fraction, root, π): what reads as `(5)` after another factor. */
const isPlainNumber = (g: G): boolean => g.k === "val" && vIsRational(g.v) && vRational(g.v)!.d === 1 && g.v.deg === 0 && g.v.len === 0 && vNum(g.v) >= 0;
const isDecimalNumber = (g: G): boolean => g.k === "val" && Boolean(g.text) && g.v.deg === 0 && g.v.len === 0;

export function gLatex(g: G, opts: GPrint = {}): string {
  const p = (x: G) => gLatex(x, opts);
  switch (g.k) {
    case "val":
      return valText(g, opts);
    case "sym":
      return nameLatex(g.name, { measure: opts.measure });
    case "add":
      return g.items
        .map((item, i) => {
          let body = p(item.g);
          if (item.g.k === "add") body = paren(body);
          const lead = body.startsWith("-");
          if (i === 0) return item.neg ? `-${lead || item.g.k === "add" ? paren(body) : body}` : body;
          if (lead) return item.neg ? ` - ${paren(body)}` : ` - ${body.slice(1).trimStart()}`;
          return item.neg ? ` - ${body}` : ` + ${body}`;
        })
        .join("");
    case "mul":
      return mulLatex(g.items, opts);
    case "div":
      return `\\frac{${p(unparen(g.num))}}{${p(unparen(g.den))}}`;
    case "pow": {
      let base = p(g.base);
      // `(3)^{2}` after a substitution reads `3^{2}`
      if (g.base.k === "paren" && (isPlainNumber(unparen(g.base)) || isDecimalNumber(unparen(g.base)))) base = gLatex(unparen(g.base), opts);
      const simple = g.base.k === "sym" || g.base.k === "paren" || (g.base.k === "val" && !isNegativeVal(g.base) && /^[\d.]+$/.test(base)) || g.base.k === "abs";
      if (!simple) base = paren(base);
      return `${base}^{${p(g.exp)}}`;
    }
    case "root":
      return g.n === 2 ? `\\sqrt{${p(g.arg)}}` : `\\sqrt[${g.n}]{${p(g.arg)}}`;
    case "abs":
      return `|${p(g.arg)}|`;
    case "fn": {
      const arg = p(g.arg);
      if (INVERSE.has(g.name)) {
        const base = g.name.slice(1);
        return `\\${base}^{-1}${paren(arg)}`;
      }
      const atomic = g.arg.k === "sym" || (g.arg.k === "val" && !isNegativeVal(g.arg) && !hasFrac(arg));
      return atomic ? `\\${g.name} ${arg}` : `\\${g.name}${paren(arg)}`;
    }
    case "paren":
      return paren(p(g.g));
    case "neg": {
      const body = p(g.g);
      return g.g.k === "add" || body.startsWith("-") ? `-${paren(body)}` : `-${body}`;
    }
  }
}

const unparen = (g: G): G => (g.k === "paren" ? unparen(g.g) : g);

function mulLatex(items: G[], opts: GPrint): string {
  let out = "";
  items.forEach((g, i) => {
    let body = gLatex(g, opts);
    if (g.k === "add" || g.k === "neg" || (g.k === "val" && isNegativeVal(g) && i > 0)) body = paren(body);
    if (i === 0) {
      out = body;
      return;
    }
    const prev = items[i - 1];
    if (isMark(g)) {
      // `(2x + 10)^{\circ}`, `5\,\mathrm{cm}`
      const v = (g as { v: Val }).v;
      out += v.deg !== 0 ? "^{\\circ}" : `\\,${vLatex(v).replace(/^1\\,/, "")}`;
      return;
    }
    // after a fraction, a degree value or a unit a number takes a dot: `\frac{1}{6} \cdot 2`, `6 \cdot 180^{\circ}`
    const dotAfter = prev.k === "div" || (prev.k === "val" && (prev.v.deg !== 0 || prev.v.len !== 0 || hasFrac(gLatex(prev, opts))));
    const numberLike = (x: G) => x.k === "val" && x.v.deg === 0 && x.v.len === 0 && /^\d+(?:\.\d+)?$/.test(gLatex(x, opts));
    if (g.k === "pow" && numberLike(unparen(g.base))) {
      // `\pi(5)^{2}`: a number raised after another factor keeps its bracket
      out += dotAfter ? ` \\cdot ${body}` : `(${gLatex(unparen(g.base), opts)})^{${gLatex(g.exp, opts)}}`;
      return;
    }
    if (numberLike(g)) {
      // `\pi(25)`, `2(5)(7)`, `\frac{1}{2}(20)(5)`: a number after another factor is bracketed, as
      // students write it — after a fraction, a dot when a letter follows (`\frac{1}{6} \cdot 2\pi`)
      const next = items[i + 1];
      const letterNext = next !== undefined && !numberLike(next) && next.k !== "paren" && !(next.k === "pow" && numberLike(unparen(next.base)));
      out += dotAfter && (letterNext || (prev.k === "val" && (prev.v.deg !== 0 || prev.v.len !== 0))) ? ` \\cdot ${body}` : `(${body})`;
      return;
    }
    if (g.k === "val" && (g.v.deg !== 0 || g.v.len !== 0 || /^\d/.test(body) || hasFrac(body))) {
      out += ` \\cdot ${body}`;
      return;
    }
    if (g.k === "div") {
      out += ` \\cdot ${body}`;
      return;
    }
    // `2\pi r`: a command's name never runs into the next letter
    out += /\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z]/.test(body) ? ` ${body}` : body;
  });
  return out;
}

// ---------------------------------------------------------------- evaluation rounds

interface Candidate {
  node: G;
  cls: number;
  value: Val;
}

const atomic = (g: G): boolean => g.k === "val" || (g.k === "paren" && atomic(g.g));
const atomVal = (g: G): Val => (g.k === "val" ? g.v : g.k === "paren" ? atomVal(g.g) : (notGeometry() as never));
const children = (g: G): G[] => {
  switch (g.k) {
    case "val":
    case "sym":
      return [];
    case "add":
      return g.items.map((i) => i.g);
    case "mul":
      return g.items;
    case "div":
      return [g.num, g.den];
    case "pow":
      return [g.base, g.exp];
    case "root":
    case "abs":
    case "fn":
      return [g.arg];
    case "paren":
    case "neg":
      return [g.g];
  }
};

const OPERATIONS = new Set(["add", "mul", "div", "neg"]);

/**
 * The next round's candidates in `g`: nodes whose children are all numbers. `grouped` marks a node
 * inside a bracket, a root, a fraction or a function (worked out before what is around it). A
 * product or sum with some numbers beside a value that cannot be written exactly (`2(8)(11)\cos
 * 37^{\circ}`) combines just its numbers.
 */
function collect(g: G, grouped: boolean, out: Candidate[], opts: EvalOptions): void {
  if (g.k === "val" || g.k === "sym") return;
  const kids = children(g);
  const childGrouped = g.k === "paren" || g.k === "root" || g.k === "abs" || g.k === "fn" || g.k === "div" || g.k === "pow";
  for (const c of kids) collect(c, childGrouped, out, opts);
  if (g.k === "paren") return;
  const cls = OPERATIONS.has(g.k) ? (grouped ? 0 : g.k === "add" ? 3 : 2) : 1;
  if (kids.every(atomic)) {
    try {
      out.push({ node: g, cls, value: evalExact(g, opts) });
    } catch (e) {
      if (e instanceof NoValue) throw e;
      // not exact: left as written
    }
    return;
  }
  // numbers beside a value that stays written: combine just the numbers
  if ((g.k === "mul" || g.k === "add") && isClosed(g) && kids.filter(atomic).length >= 2 && kids.filter((c) => !atomic(c)).every((c) => stuck(c, opts))) {
    out.push({ node: g, cls, value: null as unknown as Val });
  }
}

/** A closed tree no round can reduce any further (a non-special angle, √ of a sum with one). */
function stuck(g: G, opts: EvalOptions): boolean {
  if (!isClosed(g)) return false;
  const inner: Candidate[] = [];
  try {
    collect(g, false, inner, opts);
  } catch {
    return false;
  }
  return inner.length === 0;
}

function replace(g: G, chosen: ReadonlyMap<G, Candidate>, opts: EvalOptions): G {
  const hit = chosen.get(g);
  if (hit) {
    if (hit.value) return gVal(hit.value);
    return combineNumbers(g, opts);
  }
  const r = (x: G) => replace(x, chosen, opts);
  switch (g.k) {
    case "val":
    case "sym":
      return g;
    case "add":
      return { k: "add", items: g.items.map((i) => ({ neg: i.neg, g: r(i.g) })) };
    case "mul":
      return { k: "mul", items: g.items.map(r) };
    case "div":
      return { k: "div", num: r(g.num), den: r(g.den) };
    case "pow":
      return { k: "pow", base: r(g.base), exp: r(g.exp) };
    case "root":
      return { k: "root", arg: r(g.arg), n: g.n };
    case "abs":
      return { k: "abs", arg: r(g.arg) };
    case "fn":
      return { k: "fn", name: g.name, arg: r(g.arg) };
    case "paren": {
      // `(8 - 2)` worked out is `6`: the bracket goes with the operation it grouped
      const inner = r(g.g);
      return chosen.has(g.g) && inner.k === "val" && vNum(inner.v) >= 0 ? inner : { k: "paren", g: inner };
    }
    case "neg":
      return { k: "neg", g: r(g.g) };
  }
}

/** `2(8)(11)\cos 37^{\circ}` → `176\cos 37^{\circ}`; `64 + 121 - 176\cos 37^{\circ}` → `185 - 176\cos 37^{\circ}`. */
function combineNumbers(g: G, opts: EvalOptions): G {
  if (g.k === "mul") {
    const nums = g.items.filter(atomic);
    const rest = g.items.filter((c) => !atomic(c));
    const v = nums.map(atomVal).reduce(vMul);
    return rest.length === 0 ? gVal(v) : { k: "mul", items: [gVal(v), ...rest] };
  }
  if (g.k === "add") {
    let sum: Val | null = null;
    let at = -1;
    const items: Array<{ neg: boolean; g: G }> = [];
    g.items.forEach((item) => {
      if (atomic(item.g)) {
        const v = item.neg ? vNeg(atomVal(item.g)) : atomVal(item.g);
        sum = sum ? vAdd(sum, v) : v;
        if (at === -1) {
          at = items.length;
          items.push(item);
        }
        return;
      }
      items.push(item);
    });
    if (sum === null) return g;
    const s = sum as Val;
    items[at] = vNum(s) < 0 && at > 0 ? { neg: true, g: gVal(vNeg(s)) } : { neg: false, g: gVal(s) };
    return { k: "add", items };
  }
  void opts;
  return g;
}

/**
 * One round: the operations of one kind that can be done now, all of them. Null when nothing is
 * left to do (the tree is a number, or what is left cannot be written exactly). Throws NoValue.
 */
export function reduceOnce(g: G, opts: EvalOptions = {}): G | null {
  if (atomic(g) && g.k === "val") return null;
  const found: Candidate[] = [];
  collect(g, false, found, opts);
  if (found.length === 0) {
    // a bracket around a finished number goes when nothing else is left (`= (25)`)
    return g.k === "paren" && atomic(g) ? gVal(atomVal(g)) : null;
  }
  const best = Math.min(...found.map((c) => c.cls));
  const chosen = new Map(found.filter((c) => c.cls === best).map((c) => [c.node, c] as const));
  return replace(g, chosen, opts);
}

/** Every round until nothing is left to do: the trees after each round (not the input). */
export function reduceAll(g: G, opts: EvalOptions = {}, max = 20): G[] {
  const out: G[] = [];
  let cur = g;
  for (let i = 0; i < max; i++) {
    const next = reduceOnce(cur, opts);
    if (!next) break;
    out.push(next);
    cur = next;
  }
  return out;
}

export const isValue = (g: G): g is { k: "val"; v: Val; text?: string } => g.k === "val";
export { NoValue, NotExact };
