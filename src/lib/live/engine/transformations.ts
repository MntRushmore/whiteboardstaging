/**
 * Transformations of functions (F-BF.3): a function written from a parent,
 * `g(x) = a·f(bx + c) + k`, rewritten, with the mapping rule and where the parent's key point goes.
 *
 *   f(x) = x^{2}                          y = 2(x - 1)^{2} + 3
 *   g(x) = \frac{1}{2}f(x + 1) - 4        f(x) = x^{2}
 *   g(x) = \frac{1}{2}(x + 1)^{2} - 4     y = 2f(x - 1) + 3
 *   (x, y) \to (x - 1, \frac{1}{2}y - 4)  (x, y) \to (x + 1, 2y + 3)
 *   (0, 0) \to (-1, -4)                   (0, 0) \to (1, 3)
 *
 * The rule is the whole transformation at once, so the order of the moves never goes wrong: a
 * point (x, y) of f lands at ((x - c)/b, a·y + k) — `f(2x)` halves every x, `f(2x - 6)` is
 * `f(2(x - 3))`, three to the right, not six. The parent is any function defined above (its key
 * point is its vertex when it is a quadratic) or, read straight off a line, one of the school
 * parents: x², x³, |x|, √x, 1/x, bˣ (`familyOf`, structurally — `y = x^{2} - 4x` is not read as a
 * transformation, `y = (x - 2)^{2} - 4` is).
 *
 * The student's rewrite `g(x) = …` under `g(x) = f(x - 3) + 1` is checked (`analyzeDerived`): the
 * same function everywhere is ✓, anything else is ringed. Every line written is checked
 * numerically against the parent before it is answered.
 */
import type { MathNode } from "mathjs";
import type { AnalyzeContext, LineAnalysis } from "../contracts";
import { combineTerms, q, qAdd, qDiv, qLatex, qMul, qNeg, standardOrder, termsLatex, termsOf, type Q, type Term } from "./algebra";
import { functionInfo } from "./classify";
import { closeC, evalLatex, lettersOf, parseExpr, type CourseDeps } from "./courseKit";
import { callsOf, definitionsIn, isSumLatex, substituteParam, type FunctionDef } from "./functionNotation";
import { plotFor } from "./graph";
import { argsOf, coefficientOf, constantValue, fnOf, polyOf, stripParens, summands } from "./nodes";
import { deg, exactly, polyEval, qEq, qNum } from "./poly";
import { StepWriter } from "./solution";

export type Family = "square" | "cube" | "abs" | "sqrt" | "reciprocal" | "exp";

/** y = a·P(b·x + c) + k */
export interface Affine {
  a: Q;
  b: Q;
  c: Q;
  k: Q;
}

export interface FamilyForm extends Affine {
  family: Family;
  /** an exponential's base: `2`, `e` */
  base?: string;
}

const ONE = (): Q => q(1);
const ZERO = (): Q => q(0);

/** Is this node `b·v + c` with b ≠ 0? */
function linearIn(node: MathNode, v: string): { b: Q; c: Q } | null {
  const p = polyOf(node, v);
  if (!p || deg(p) !== 1) return null;
  return { b: p[1], c: p[0] ?? ZERO() };
}

/**
 * A school parent with one move each way, read off the tree: `2(x - 1)^{2} + 3`,
 * `-|x + 2|`, `\sqrt{x - 4} + 1`, `\frac{3}{x - 2} - 1`, `2^{x + 1} - 3`. Null for anything else
 * (a polynomial in standard form, two terms in x, a product of two such).
 */
export function familyOf(node: MathNode, v: string): FamilyForm | null {
  return exactly(() => {
    let k = ZERO();
    let term: { sign: 1 | -1; node: MathNode } | null = null;
    for (const s of summands(node)) {
      const c = lettersOf(s.node).length === 0 ? constantValue(s.node) : null;
      if (c) {
        k = qAdd(k, s.sign < 0 ? qNeg(c) : c);
        continue;
      }
      if (term) return null;
      term = s;
    }
    if (!term) return null;
    const kc = coefficientOf(term.node);
    if (!kc) return null;
    let a = term.sign < 0 ? qNeg(kc.k) : kc.k;
    const core = stripParens(kc.core);
    const f = fnOf(core);
    const args = argsOf(core);
    const form = (family: Family, inner: MathNode, base?: string): FamilyForm | null => {
      const lin = linearIn(inner, v);
      return lin ? { family, a, b: lin.b, c: lin.c, k, ...(base ? { base } : {}) } : null;
    };
    if (core.type === "OperatorNode" && f === "pow" && args.length === 2) {
      const e = constantValue(args[1]);
      if (e && e.d === 1 && (e.n === 2 || e.n === 3) && lettersOf(args[0]).length > 0) return form(e.n === 2 ? "square" : "cube", args[0]);
      const baseNode = stripParens(args[0]) as MathNode & { name?: string };
      if (baseNode.type === "SymbolNode" && baseNode.name === "e") return form("exp", args[1], "e");
      const b = lettersOf(args[0]).length === 0 ? constantValue(args[0]) : null;
      if (b && b.d === 1 && b.n >= 2 && b.n <= 10) return form("exp", args[1], String(b.n));
      return null;
    }
    if (core.type === "FunctionNode" && args.length === 1) {
      if (f === "abs") return form("abs", args[0]);
      if (f === "sqrt") return form("sqrt", args[0]);
      if (f === "exp") return form("exp", args[0], "e");
      return null;
    }
    if (core.type === "OperatorNode" && f === "divide" && args.length === 2) {
      const n = lettersOf(args[0]).length === 0 ? constantValue(args[0]) : null;
      if (!n || n.n === 0) return null;
      a = qMul(a, n);
      return form("reciprocal", args[1]);
    }
    return null;
  });
}

/** The parent as written: `x^{2}`, `|x|`, `\frac{1}{x}`, `2^{x}`. */
export function familyLatex(f: Family, v: string, base?: string): string {
  switch (f) {
    case "square":
      return `${v}^{2}`;
    case "cube":
      return `${v}^{3}`;
    case "abs":
      return `|${v}|`;
    case "sqrt":
      return `\\sqrt{${v}}`;
    case "reciprocal":
      return `\\frac{1}{${v}}`;
    case "exp":
      return `${base ?? "e"}^{${v}}`;
  }
}

/** The point every sketch of the parent is drawn through: a vertex, an end point, (1, 1) on 1/x, (0, 1) on bˣ. */
function familyKeyPoint(f: Family): [Q, Q] {
  if (f === "reciprocal") return [ONE(), ONE()];
  if (f === "exp") return [ZERO(), ONE()];
  return [ZERO(), ZERO()];
}

const isIdentity = (t: Affine): boolean => qEq(t.a, ONE()) && qEq(t.b, ONE()) && t.c.n === 0 && t.k.n === 0;

/** Where (x, y) lands: ((x - c)/b, a·y + k). */
export function mapPoint(t: Affine, [x, y]: [Q, Q]): [Q, Q] {
  return [qDiv(qAdd(x, qNeg(t.c)), t.b), qAdd(qMul(t.a, y), t.k)];
}

/** `(x, y) \to (x + 3, y + 1)`. */
export function ruleLatex(t: Affine, v = "x"): string {
  const X: Term[] = [{ c: qDiv(ONE(), t.b), vars: { [v]: 1 } }];
  const cx = qDiv(qNeg(t.c), t.b);
  if (cx.n !== 0) X.push({ c: cx, vars: {} });
  const Y: Term[] = [{ c: t.a, vars: { y: 1 } }];
  if (t.k.n !== 0) Y.push({ c: t.k, vars: {} });
  return `(${v}, y) \\to (${termsLatex(X)}, ${termsLatex(Y)})`;
}

const pointTex = ([x, y]: [Q, Q]): string => `(${qLatex(x)}, ${qLatex(y)})`;

/** The key point of a parent written in LaTeX (`x^{2}`, `(x - 1)^{2}`, `x^{2} - 4x`), or null. */
export function keyPointOf(deps: CourseDeps, body: string, v: string): [Q, Q] | null {
  const node = parseExpr(deps, body);
  if (!node) return null;
  return exactly(() => {
    const fam = familyOf(node, v);
    if (fam) return mapPoint(fam, familyKeyPoint(fam.family));
    const p = polyOf(node, v);
    if (p && deg(p) === 2) {
      const x = qDiv(qNeg(p[1] ?? ZERO()), qMul(q(2), p[2]));
      return [x, polyEval(p, x)] as [Q, Q];
    }
    return null;
  });
}

/**
 * The points that show the moves, parent → image: the key point when it moves; when the moves
 * include a stretch or a flip, also the parent's point one to the right of it (`(1, 1) \to
 * (\frac{1}{2}, 1)` for f(2x), where the vertex stays put). Only exact points.
 */
export function tellingPoints(deps: CourseDeps, parentBody: string, v: string, t: Affine): Array<[[Q, Q], [Q, Q]]> {
  const key = keyPointOf(deps, parentBody, v);
  if (!key) return [];
  const out: Array<[[Q, Q], [Q, Q]]> = [];
  const moved = (p: [Q, Q]) => exactly(() => mapPoint(t, p));
  const k2 = moved(key);
  const same = (a: [Q, Q], b: [Q, Q]) => qEq(a[0], b[0]) && qEq(a[1], b[1]);
  if (k2 && !same(key, k2)) out.push([key, k2]);
  const stretched = !qEq(t.a, ONE()) || !qEq(t.b, ONE());
  if (stretched) {
    const node = parseExpr(deps, parentBody);
    const x1 = exactly(() => qAdd(key[0], ONE()));
    const y = node && x1 ? evalNode(node, { [v]: qNum(x1) }) : null;
    const y1 = y === null ? null : exactly(() => q(Math.round(y * 12), 12));
    if (x1 && y1 !== null && Math.abs(qNum(y1) - y!) < 1e-12) {
      const p: [Q, Q] = [x1, y1];
      const p2 = moved(p);
      if (p2 && !same(p, p2)) out.push([p, p2]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- a function written from another

interface Derived {
  /** `g(x)` / `y` */
  head: string;
  name: string;
  v: string;
  parent: FunctionDef;
  t: Affine;
  /** the call's argument as written, and the right side with the placeholder in */
  arg: string;
  rhs: string;
  callStart: number;
  callEnd: number;
}

/** `g(x) = -2f(x)` / `y = \frac{1}{2}f(x + 1) - 4` under a definition of f: the parent and the moves, or null. */
function derivedOf(deps: CourseDeps, target: string, defs: ReadonlyMap<string, FunctionDef>): Derived | null {
  const fn = functionInfo(target) ?? (/^\s*y\s*=/.test(target) ? { name: "y", param: "x", rhs: target.replace(/^\s*y\s*=\s*/, "").trim() } : null);
  if (!fn || defs.has(fn.name)) return null;
  const rhs = fn.rhs;
  const calls = callsOf(rhs, new Set(defs.keys()));
  if (calls.length !== 1 || calls[0].inverse) return null;
  const call = calls[0];
  const parent = defs.get(call.name)!;
  if (parent.pieces) return null;
  const v = fn.param;
  const inner = parseExpr(deps, call.arg);
  const outer = parseExpr(deps, `${rhs.slice(0, call.start)} u ${rhs.slice(call.end)}`);
  if (!inner || !outer) return null;
  if (lettersOf(inner).some((l) => l !== v) || lettersOf(outer).some((l) => l !== "u")) return null;
  const t = exactly((): Affine | null => {
    const lin = linearIn(inner, v);
    const out = polyOf(outer, "u");
    if (!lin || !out || deg(out) !== 1) return null;
    return { a: out[1], b: lin.b, c: lin.c, k: out[0] ?? ZERO() };
  });
  if (!t) return null;
  const head = fn.name === "y" ? "y" : `${fn.name}(${v})`;
  return { head, name: fn.name, v, parent, t, arg: call.arg, rhs, callStart: call.start, callEnd: call.end };
}

/** The right side with the call replaced by the parent's body, bracketed where a student would. */
function imageLatex(d: Derived): string {
  const body = substituteParam(d.parent.rhs, d.parent.param, d.arg);
  const before = d.rhs.slice(0, d.callStart);
  const after = d.rhs.slice(d.callEnd);
  const whole = !before.trim() && !after.trim();
  const numberBefore = /\d\s*$/.test(before);
  let piece = body;
  if (!whole) {
    if (isSumLatex(body) || body.trim().startsWith("-") || /^\s*\^/.test(after)) piece = `(${body})`;
    else if (numberBefore && /^\s*(?:\d|\\frac)/.test(body)) piece = `\\cdot ${body}`;
  }
  const glue = numberBefore && piece.startsWith("\\cdot") ? " " : "";
  // `|x|` at `x + 2` is `|x + 2|`: the bars already group it
  return `${before.replace(/\s+$/, "")}${glue}${piece}${after}`
    .replace(/\|\(([^()|]*)\)\|/g, "|$1|")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sample points spread wide enough that a square root's domain (x ≥ 3 for f(2x - 6)) still has several. */
const SAMPLES = [-9.1, -5.3, -2.7, -1.3, -0.41, 0.37, 0.93, 1.61, 2.2, 3.4, 4.9, 6.1, 7.7, 9.3, 12.1];

/** Numerically: the image line has the values a·f(bx + c) + k. */
function imageAgrees(deps: CourseDeps, d: Derived, latex: string): boolean {
  const node = parseExpr(deps, latex);
  if (!node) return false;
  let n = 0;
  for (const x of SAMPLES) {
    const u = qNum(d.t.b) * x + qNum(d.t.c);
    const fu = evalLatex(deps, d.parent.rhs, { [d.parent.param]: u });
    if (!fu || Math.abs(fu.im) > 1e-12) continue;
    const want = qNum(d.t.a) * fu.re + qNum(d.t.k);
    const got = evalNode(node, { [d.v]: x });
    if (got === null) return false;
    if (Math.abs(got - want) > 1e-8 * Math.max(1, Math.abs(want))) return false;
    n++;
  }
  return n >= 4;
}

function evalNode(node: MathNode, scope: Record<string, number>): number | null {
  try {
    const y = node.compile().evaluate({ ...scope }) as unknown;
    return typeof y === "number" && Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}

/** The rule and the key point, checked: the rule carries points of f onto g, the points are on them. */
function ruleAgrees(deps: CourseDeps, parentBody: string, parentParam: string, imageBody: string, v: string, t: Affine, key: [Q, Q] | null): boolean {
  const image = parseExpr(deps, imageBody);
  const parent = parseExpr(deps, parentBody);
  if (!image || !parent) return false;
  let n = 0;
  for (const s of SAMPLES) {
    const y = evalNode(parent, { [parentParam]: s });
    if (y === null) continue;
    const X = (s - qNum(t.c)) / qNum(t.b);
    const Y = qNum(t.a) * y + qNum(t.k);
    const g = evalNode(image, { [v]: X });
    if (g === null || Math.abs(g - Y) > 1e-8 * Math.max(1, Math.abs(Y))) return false;
    n++;
  }
  if (n < 3) return false;
  if (key) {
    const [P, Qv] = mapPoint(t, key);
    const fy = evalNode(parent, { [parentParam]: qNum(key[0]) });
    const gy = evalNode(image, { [v]: qNum(P) });
    if (fy === null || gy === null || Math.abs(fy - qNum(key[1])) > 1e-9 || Math.abs(gy - qNum(Qv)) > 1e-9) return false;
  }
  return true;
}

/** `g(x) = (2x)^{2}` → `g(x) = 4x^{2}`: a pure stretch of a polynomial, multiplied out. */
function tidied(deps: CourseDeps, d: Derived, image: string): string | null {
  if (d.t.c.n !== 0 || qEq(d.t.b, ONE())) return null;
  const node = parseExpr(deps, image);
  if (!node) return null;
  const terms = termsOf(node, [d.v]);
  if (!terms) return null;
  const tex = termsLatex(standardOrder(combineTerms(terms)));
  return deps.normalize(tex) === deps.normalize(image) ? null : tex;
}

/**
 * Solve on `g(x) = a·f(bx + c) + k` under the definition of f: g written out, the rule, and the
 * parent's key point carried across. Null when the line is not such a transformation.
 */
export function transformSteps(deps: CourseDeps, lines: readonly string[]): { latex: string; steps: string[] } | null {
  try {
    const target = lines[lines.length - 1] ?? "";
    const defs = definitionsIn(lines.slice(0, -1));
    if (defs.size === 0) return null;
    const d = derivedOf(deps, target, defs);
    if (!d) return null;
    const image = imageLatex(d);
    if (!imageAgrees(deps, d, image)) return null;
    const w = new StepWriter(deps.normalize, target);
    w.write(`${d.head} = ${image}`);
    const tidy = tidied(deps, d, image);
    if (tidy && imageAgrees(deps, d, tidy)) w.write(`${d.head} = ${tidy}`);
    const shown = tellingPoints(deps, d.parent.rhs, d.parent.param, d.t)[0] ?? null;
    if (!ruleAgrees(deps, d.parent.rhs, d.parent.param, tidy ?? image, d.v, d.t, shown ? shown[0] : null)) return null;
    w.write(ruleLatex(d.t, d.v));
    if (shown) w.write(`${pointTex(shown[0])} \\to ${pointTex(shown[1])}`);
    const steps = w.lines();
    return steps.length ? { latex: steps[0], steps } : null;
  } catch {
    return null;
  }
}

/** `2f(x - 1) + 3` for the moves on a parent called `name`. */
function callForm(name: string, t: Affine, v: string): string {
  const inner: Term[] = [{ c: t.b, vars: { [v]: 1 } }];
  if (t.c.n !== 0) inner.push({ c: t.c, vars: {} });
  const a = qEq(t.a, ONE()) ? "" : qEq(t.a, q(-1)) ? "-" : qLatex(t.a);
  let out = `${a}${name}(${termsLatex(inner)})`;
  if (t.k.n !== 0) out += t.k.n < 0 ? ` - ${qLatex(qNeg(t.k))}` : ` + ${qLatex(t.k)}`;
  return out;
}

/**
 * Solve on a line that is a school parent moved (`y = 2(x - 1)^{2} + 3`, `h(x) = -|x + 2|`): the
 * parent named, the line as that parent's transformation, the rule and the key point. Null for
 * the parent itself, or a line that is not one.
 */
export function impliedSteps(deps: CourseDeps, latex: string): { latex: string; steps: string[] } | null {
  try {
    const fn = functionInfo(latex);
    if (!fn) return null;
    const node = parseExpr(deps, fn.rhs);
    if (!node || lettersOf(node).some((l) => l !== fn.param)) return null;
    const fam = familyOf(node, fn.param);
    if (!fam || isIdentity(fam)) return null;
    const v = fn.param;
    const name = ["f", "g", "h", "p"].find((n) => n !== fn.name)!;
    const head = fn.name === "y" ? "y" : `${fn.name}(${v})`;
    const parentBody = familyLatex(fam.family, v, fam.base);
    const shown = tellingPoints(deps, parentBody, v, fam)[0] ?? null;
    const moved = callForm(name, fam, v);
    // the call form, written out, is the student's line
    const expanded = parseExpr(deps, substituteCall(moved, name, parentBody, v));
    const own = parseExpr(deps, fn.rhs);
    if (!expanded || !own) return null;
    for (const x of [-1.7, -0.3, 0.6, 1.9, 3.3, 5.1]) {
      const a = evalNode(own, { [v]: x });
      const b = evalNode(expanded, { [v]: x });
      if ((a === null) !== (b === null)) return null;
      if (a !== null && b !== null && !closeC({ re: a, im: 0 }, { re: b, im: 0 }, 1e-9)) return null;
    }
    if (!ruleAgrees(deps, parentBody, v, fn.rhs, v, fam, shown ? shown[0] : null)) return null;
    const w = new StepWriter(deps.normalize, latex);
    w.write(`${name}(${v}) = ${parentBody}`);
    w.write(`${head} = ${moved}`);
    w.write(ruleLatex(fam, v));
    if (shown) w.write(`${pointTex(shown[0])} \\to ${pointTex(shown[1])}`);
    const steps = w.lines();
    return { latex: steps[1] ?? steps[0], steps };
  } catch {
    return null;
  }
}

function substituteCall(s: string, name: string, body: string, v: string): string {
  const calls = callsOf(s, new Set([name]));
  if (calls.length !== 1) return s;
  const c = calls[0];
  return `${s.slice(0, c.start)}(${substituteParam(body, v, c.arg)})${s.slice(c.end)}`;
}

// ---------------------------------------------------------------- checking the student's line

/**
 * A function line under another (`ctx.previous`):
 *  - `g(x) = f(x - 3) + 1` right under `f(x) = …`: g as a function of x (its graph, and what a
 *    rewrite of it is checked against), marked `derived`;
 *  - `g(x) = …` / `y = …` right under such a line (or a rewrite of it that was right): the same
 *    function is ✓, a different one is ringed — it claims to be g.
 * Null for any other line (the engine's own rules apply).
 */
export function analyzeDerived(deps: CourseDeps, latex: string, ctx: AnalyzeContext): LineAnalysis | null {
  try {
    const fn = functionInfo(latex);
    const prev = ctx.previous;
    if (!fn || !prev || prev.kind !== "function" || !prev.math) return null;
    const prevDef = /^([a-zA-Z])(?:\(([a-zA-Z])\))?\s*=\s*([\s\S]+)$/.exec(prev.math);
    if (!prevDef) return null;
    const [, prevName, prevParam = "x", prevSource] = prevDef;
    const v = fn.param;
    const head = fn.name === "y" ? "y" : `${fn.name}(${v})`;
    // a rewrite of g
    if (prev.derived && prev.plot && (fn.name === prevName || fn.name === "y") && prevParam === v) {
      const t = deps.translate(fn.rhs);
      if (!t.source.trim() || t.hasUnits || t.hasText || t.variables.some((x) => x !== v)) return null;
      const verdict = sameValues(deps, prev.plot.expr, t.source, v);
      if (verdict === null) return null;
      const plot = plotFor(deps.math, t.source, fn.rhs, v) ?? undefined;
      return { kind: "function", math: `${head} = ${t.source}`, resultLatex: "", verdict: verdict ? "ok" : "mismatch", note: "", variable: v, ...(plot ? { plot } : {}), ...(verdict ? { derived: true } : {}) };
    }
    // g from f
    if (prevName === "y" || fn.name === prevName) return null;
    const calls = callsOf(fn.rhs, new Set([prevName]));
    if (calls.length !== 1 || calls[0].inverse) return null;
    const call = calls[0];
    const inner = deps.translate(call.arg);
    const outer = deps.translate(`${fn.rhs.slice(0, call.start)} u ${fn.rhs.slice(call.end)}`);
    if (inner.variables.some((x) => x !== v) || outer.variables.some((x) => x !== "u")) return null;
    const parent = deps.math.parse(prevSource);
    const composed = deps.math
      .parse(outer.source)
      .transform((n: MathNode) => (n.type === "SymbolNode" && (n as MathNode & { name: string }).name === "u" ? new deps.math.ParenthesisNode(substituteSymbol(deps, parent, prevParam, inner.source)) : n));
    const source = composed.toString();
    const plot = plotFor(deps.math, source, fn.rhs, v);
    if (!plot) return null;
    return { kind: "function", math: `${head} = ${source}`, resultLatex: "", verdict: "none", note: "", variable: v, plot, derived: true };
  } catch {
    return null;
  }
}

function substituteSymbol(deps: CourseDeps, node: MathNode, name: string, source: string): MathNode {
  const replacement = deps.math.parse(`(${source})`);
  return node.transform((n: MathNode) => (n.type === "SymbolNode" && (n as MathNode & { name: string }).name === name ? replacement : n));
}

/** Same values at sample points where both are defined (true / false), null when too few are. */
function sameValues(deps: CourseDeps, a: string, b: string, v: string): boolean | null {
  let fa: { evaluate: (s: Record<string, number>) => unknown };
  let fb: { evaluate: (s: Record<string, number>) => unknown };
  try {
    fa = deps.math.compile(a);
    fb = deps.math.compile(b);
  } catch {
    return null;
  }
  let n = 0;
  for (const x of [-3.7, -2.2, -1.1, -0.35, 0.45, 1.2, 1.9, 2.8, 3.6, 5.3]) {
    let ya: unknown;
    let yb: unknown;
    try {
      ya = fa.evaluate({ [v]: x });
      yb = fb.evaluate({ [v]: x });
    } catch {
      continue;
    }
    if (typeof ya !== "number" || typeof yb !== "number" || !Number.isFinite(ya) || !Number.isFinite(yb)) continue;
    if (Math.abs(ya - yb) > 1e-8 * Math.max(1, Math.abs(ya))) return false;
    n++;
  }
  return n >= 4 ? true : null;
}

/** The moves of `g(x) = a·f(bx + c) + k` (LaTeX of the right side, the parent's name) for the graph. */
export function affineCall(deps: CourseDeps, rhs: string, parentName: string, v: string): Affine | null {
  const calls = callsOf(rhs, new Set([parentName]));
  if (calls.length !== 1 || calls[0].inverse) return null;
  const call = calls[0];
  const inner = parseExpr(deps, call.arg);
  const outer = parseExpr(deps, `${rhs.slice(0, call.start)} u ${rhs.slice(call.end)}`);
  if (!inner || !outer || lettersOf(inner).some((l) => l !== v) || lettersOf(outer).some((l) => l !== "u")) return null;
  return exactly(() => {
    const lin = linearIn(inner, v);
    const out = polyOf(outer, "u");
    if (!lin || !out || deg(out) !== 1) return null;
    return { a: out[1], b: lin.b, c: lin.c, k: out[0] ?? ZERO() };
  });
}


