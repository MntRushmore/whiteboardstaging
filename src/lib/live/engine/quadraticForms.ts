/**
 * A quadratic function's vertex form and vertex (A-SSE.3b, F-IF.8a), the way an Algebra 1
 * teacher writes them. The student writes the quadratic, then what they want under it:
 *
 *   y = 2x^{2} - 12x + 7              y = x^{2} + 6x + 5             y = 2(x - 3)^{2} + 1
 *   y = a(x - h)^{2} + k              (h, k) = ?                     y = ax^{2} + bx + c
 *   y = 2(x^{2} - 6x) + 7             h = -\frac{6}{2(1)}            y = 2(x^{2} - 6x + 9) + 1
 *   \left(\frac{-6}{2}\right)^{2} = 9 h = -3                         y = 2x^{2} - 12x + 18 + 1
 *   y = 2(x^{2} - 6x + 9 - 9) + 7     k = (-3)^{2} + 6(-3) + 5       y = 2x^{2} - 12x + 19
 *   y = 2(x^{2} - 6x + 9) - 18 + 7    k = 9 - 18 + 5
 *   y = 2(x - 3)^{2} - 11             k = -4
 *                                     (h, k) = (-3, -4)
 *
 * Completing the square round by round: a factored out of the x terms (when a ≠ 1), half the x
 * coefficient squared beside the working, added and subtracted inside the bracket, the
 * subtracted part brought out (times a), the perfect square and the constant collected. The
 * vertex is read off a vertex form (`y = 2(x - (-3))^{2} + 1` first when h is negative), or
 * found as h = -\frac{b}{2a} and k = f(h) substituted into the student's own right side. Back to
 * standard form: the square expanded, a distributed, like terms collected.
 *
 * How the student asks, under the quadratic: the template `y = a(x - h)^{2} + k` (or
 * `f(x) = …`) or `\text{vertex form}` for the vertex form; `(h, k) = ?`, `\text{vertex} = ?` or
 * `\text{vertex}` for the vertex; `y = ax^{2} + bx + c` or `\text{standard form}` for standard
 * form. A template or a form named ABOVE the line Solve is pressed on works too (`vertexFormOf`).
 * Exact fractions throughout; every answer is checked against the quadratic it came from.
 *
 * The student's own lines (`quadraticAnalysis`): a vertex claim `(h, k) = (-3, -4)` under the
 * quadratic is `ok` or `mismatch`; a rewrite that slips — the constant (`y = (x + 3)^{2} + 4`
 * for `y = x^{2} + 6x + 5`), or the sign of h with the right k — is `mismatch` when it changes
 * the form (expanded ↔ bracketed). Any other different quadratic stays unmarked: it may be a new
 * function (a translation, the next exercise), the engine's rule for functions.
 */
import type { MathNode } from "mathjs";
import type { AnalyzeContext, LineAnalysis } from "../contracts";
import { q, qAdd, qDiv, qMul, qNeg, simplifyExpressionSteps, termsLatex, termsOf, type Q, type Term } from "./algebra";
import { exactNode, parseExpr, splitEquation, type CourseDeps } from "./courseKit";
import { arithmetic, substituteParam } from "./functionNotation";
import { plotFor } from "./graph";
import { argsOf, coefficientOf, constantValue, fnOf, stripParens, summands } from "./nodes";
import { exactly, qIsZero, qNum, qSub } from "./poly";
import { StepWriter } from "./solution";

export interface Quadratic {
  /** `y`, or `f(x)` */
  head: string;
  a: Q;
  b: Q;
  c: Q;
  /** the right side as the student wrote it */
  rhs: string;
  /** written as a(x - h)^{2} + k: its h and k */
  vertex: { h: Q; k: Q } | null;
  /** written with a bracket round a sum in x (factored, vertex form, half-way) */
  bracketed: boolean;
}

interface Solved {
  latex: string;
  steps: string[];
}

const qTex = (a: Q): string => (a.d === 1 ? String(a.n) : `${a.n < 0 ? "-" : ""}\\frac{${Math.abs(a.n)}}{${a.d}}`);
const signed = (a: Q): string => (a.n < 0 ? `(${qTex(a)})` : qTex(a));
const eq = (a: Q, b: Q): boolean => a.n === b.n && a.d === b.d;

// ---------------------------------------------------------------- reading

type AnyNode = MathNode & { type: string; value?: unknown; name?: string; content?: MathNode };

/** A bracket round a sum in x, anywhere in the tree. */
function hasSumBracket(node: MathNode): boolean {
  let found = false;
  node.traverse((n: MathNode) => {
    const a = n as AnyNode;
    if (found || a.type !== "ParenthesisNode" || !a.content) return;
    const inner = stripParens(a.content);
    const f = fnOf(inner);
    let hasX = false;
    inner.traverse((m: MathNode) => {
      if ((m as AnyNode).type === "SymbolNode" && (m as AnyNode).name === "x") hasX = true;
    });
    if (inner.type === "OperatorNode" && (f === "add" || f === "subtract") && hasX) found = true;
  });
  return found;
}

/** `a(x - h)^{2} + k` (h and k from the bracket and the numbers beside it), or null. */
function vertexOfNode(node: MathNode): { a: Q; h: Q; k: Q } | null {
  return exactly(() => {
    let square: { a: Q; h: Q } | null = null;
    let k = q(0);
    for (const s of summands(node)) {
      const v = constantValue(s.node);
      if (v) {
        k = qAdd(k, s.sign < 0 ? qNeg(v) : v);
        continue;
      }
      if (square) return null;
      const co = coefficientOf(s.node);
      if (!co) return null;
      const core = stripParens(co.core);
      if (fnOf(core) !== "pow") return null;
      const [base, exp] = argsOf(core);
      const e = constantValue(exp);
      if (!e || !eq(e, q(2)) || (base as AnyNode).type !== "ParenthesisNode") return null;
      const inner = termsOf(stripParens(base), ["x"]);
      if (!inner) return null;
      let one = q(0);
      let shift = q(0);
      for (const t of inner) {
        const p = t.vars.x ?? 0;
        if (p === 1) one = qAdd(one, t.c);
        else if (p === 0) shift = qAdd(shift, t.c);
        else return null;
      }
      // `(x - 3)`: the x alone, coefficient 1
      if (!eq(one, q(1))) return null;
      square = { a: s.sign < 0 ? qNeg(co.k) : co.k, h: qNeg(shift) };
    }
    return square ? { ...square, k } : null;
  });
}

const HEAD = /^\s*(y|[a-zA-Z]\s*(?:\\left\s*)?\(\s*x\s*(?:\\right\s*)?\))\s*$/;

/** `y = x^{2} + 6x + 5`, `f(x) = 2(x - 3)^{2} + 1`: a quadratic in x with exact coefficients, or null. */
export function quadraticOf(deps: CourseDeps, latex: string): Quadratic | null {
  const sides = splitEquation(latex ?? "");
  if (!sides) return null;
  const head = HEAD.exec(sides[0]);
  if (!head) return null;
  const raw = parseExpr(deps, sides[1]);
  const node = raw && exactNode(deps, raw);
  if (!node) return null;
  const terms = termsOf(node, ["x"]);
  if (!terms) return null;
  return exactly(() => {
    const coef = [q(0), q(0), q(0)];
    for (const t of terms) {
      const keys = Object.keys(t.vars);
      if (keys.some((k) => k !== "x")) return null;
      const p = t.vars.x ?? 0;
      if (p > 2) return null;
      coef[p] = qAdd(coef[p], t.c);
    }
    if (qIsZero(coef[2])) return null;
    const v = vertexOfNode(node);
    const name = head[1].replace(/\s+/g, "").replace(/\\left|\\right/g, "");
    return { head: name, a: coef[2], b: coef[1], c: coef[0], rhs: sides[1].trim(), vertex: v && eq(v.a, coef[2]) ? { h: v.h, k: v.k } : null, bracketed: hasSumBracket(node) };
  });
}

/** The quadratic a line's analysis is about (`y = x ^ 2 + 6 * x + 5`, a function line), or null. */
function quadraticOfAnalysis(deps: CourseDeps, a: LineAnalysis | undefined): (Omit<Quadratic, "rhs" | "head"> & { head: string }) | null {
  if (!a || a.kind !== "function" || !a.math) return null;
  const m = /^\s*(y|[a-zA-Z]\(x\))\s*=\s*([\s\S]+)$/.exec(a.math);
  if (!m) return null;
  let node: MathNode | null;
  try {
    node = exactNode(deps, deps.math.parse(m[2]));
  } catch {
    return null;
  }
  const terms = node && termsOf(node, ["x"]);
  if (!node || !terms) return null;
  return exactly(() => {
    const coef = [q(0), q(0), q(0)];
    for (const t of terms) {
      if (Object.keys(t.vars).some((k) => k !== "x") || (t.vars.x ?? 0) > 2) return null;
      coef[t.vars.x ?? 0] = qAdd(coef[t.vars.x ?? 0], t.c);
    }
    if (qIsZero(coef[2])) return null;
    const v = vertexOfNode(node!);
    return { head: m[1], a: coef[2], b: coef[1], c: coef[0], vertex: v ? { h: v.h, k: v.k } : null, bracketed: hasSumBracket(node!) };
  });
}

// ---------------------------------------------------------------- what is asked

export type QuadraticForm = "vertex-form" | "standard" | "vertex";

export interface QuadraticAsk {
  want: QuadraticForm;
  /** the vertex's name on the answer line: `(h, k)`, or the student's own `\text{vertex}` */
  label: string;
}

const compact = (latex: string): string =>
  latex
    .replace(/\\left|\\right|\\[,;:! ]|\\cdot|\s+/g, "")
    .replace(/\^\{2\}/g, "^2")
    .replace(/\\text\{\?\}/g, "?");

const VERTEX_TEMPLATE = /^(?:y|[a-zA-Z]\(x\))=a\(x-h\)\^2\+k$/;
const STANDARD_TEMPLATE = /^(?:y|[a-zA-Z]\(x\))=ax\^2\+bx\+c$/;
const WORDS = /^\\(?:text|textrm|mathrm|operatorname)\s*\{\s*([a-zA-Z][a-zA-Z\s-]*?)\s*\}\s*(?:=\s*(?:\?|\\text\s*\{\s*\?\s*\})?)?\s*$/;

/** The quadratic's form or vertex the line asks for: a template, `(h, k) = ?`, or the student's word. */
export function quadraticAsk(latex: string): QuadraticAsk | null {
  const s = compact(latex ?? "");
  if (VERTEX_TEMPLATE.test(s)) return { want: "vertex-form", label: "" };
  if (STANDARD_TEMPLATE.test(s)) return { want: "standard", label: "" };
  if (/^\(h,k\)(?:=\??)?$/.test(s)) return { want: "vertex", label: "(h, k)" };
  const w = WORDS.exec((latex ?? "").trim());
  if (!w) return null;
  const key = w[1].replace(/[\s-]+/g, "").toLowerCase();
  if (key === "vertexform") return { want: "vertex-form", label: "" };
  if (key === "standardform") return { want: "standard", label: "" };
  if (key === "vertex") return { want: "vertex", label: `\\text{${w[1].trim()}}` };
  return null;
}

// ---------------------------------------------------------------- printing

/** `x^{2} - 6x + 9`: terms in x, highest power first, zero terms dropped. */
function inX(...coefs: Array<[number, Q]>): string {
  const terms: Term[] = coefs.filter(([, c]) => !qIsZero(c)).map(([p, c]): Term => ({ c, vars: p === 0 ? {} : { x: p } }));
  return termsLatex(terms);
}

/** `2`, `-`, `` in front of a bracket. */
function factorTex(a: Q): string {
  if (eq(a, q(1))) return "";
  if (eq(a, q(-1))) return "-";
  return qTex(a);
}

/** ` + 5`, ` - \frac{9}{8}`, `` for 0: a number added on the end of a line. */
function plus(c: Q): string {
  if (qIsZero(c)) return "";
  return c.n < 0 ? ` - ${qTex(qNeg(c))}` : ` + ${qTex(c)}`;
}

/** `(x - 3)`, `(x + \frac{3}{4})`, `x` (h = 0 is written `(x - 0)` by the caller when wanted). */
function bracket(h: Q): string {
  return `(x ${h.n > 0 ? "-" : "+"} ${qTex({ n: Math.abs(h.n), d: h.d })})`;
}

/** `y = 2(x - 3)^{2} - 11`. */
function vertexFormLine(head: string, a: Q, h: Q, k: Q): string {
  const square = qIsZero(h) ? "(x - 0)" : bracket(h);
  return `${head} = ${factorTex(a)}${square}^{2}${plus(k)}`;
}

// ---------------------------------------------------------------- the working

/** `y = ax^{2} + bx + c` rewritten as `y = a(x - h)^{2} + k`, round by round. */
function completeSquare(deps: CourseDeps, quad: Quadratic, input: string): Solved | null {
  return exactly(() => {
    const { a, b, c, head } = quad;
    const w = new StepWriter(deps.normalize, input);
    const standard = `${head} = ${inX([2, a], [1, b], [0, c])}`;
    if (deps.normalize(`${head} = ${quad.rhs}`) !== deps.normalize(standard)) w.write(standard);
    const p = qDiv(b, a);
    const half = qDiv(p, q(2));
    const sq = qMul(half, half);
    const h = qNeg(half);
    const k = qSub(c, qMul(a, sq));
    if (qIsZero(b)) {
      w.write(vertexFormLine(head, a, h, k));
      return { latex: w.last!, steps: w.lines() };
    }
    const one = eq(a, q(1));
    // a out of the x terms
    if (!one) w.write(`${head} = ${factorTex(a)}(${inX([2, q(1)], [1, p])})${plus(c)}`);
    // half the x coefficient, squared
    const halfTex = p.d === 1 ? `\\frac{${p.n}}{2}` : qTex(half);
    w.write(`\\left(${halfTex}\\right)^{2} = ${qTex(sq)}`);
    if (one) {
      w.write(`${head} = (${inX([2, q(1)], [1, p], [0, sq])})${plus(qNeg(sq))}${plus(c)}`);
    } else {
      w.write(`${head} = ${factorTex(a)}(${inX([2, q(1)], [1, p], [0, sq])}${plus(qNeg(sq))})${plus(c)}`);
      w.write(`${head} = ${factorTex(a)}(${inX([2, q(1)], [1, p], [0, sq])})${plus(qNeg(qMul(a, sq)))}${plus(c)}`);
    }
    const final = vertexFormLine(head, a, h, k);
    w.write(final);
    // the check: the vertex form expanded is the quadratic
    const back = [qAdd(qMul(a, qMul(h, h)), k), qMul(q(-2), qMul(a, h)), a];
    if (!eq(back[0], c) || !eq(back[1], b) || !eq(back[2], a)) return null;
    return { latex: final, steps: w.lines() };
  });
}

/** `y = 2(x - 3)^{2} + 1` (or any bracketed form) expanded to `y = 2x^{2} - 12x + 19`. */
function expand(deps: CourseDeps, quad: Quadratic, input: string): Solved | null {
  return exactly(() => {
    const { a, b, c, head } = quad;
    const w = new StepWriter(deps.normalize, input);
    const final = `${head} = ${inX([2, a], [1, b], [0, c])}`;
    if (quad.vertex) {
      const { h, k } = quad.vertex;
      const square: Array<[number, Q]> = [
        [2, q(1)],
        [1, qMul(q(-2), h)],
        [0, qMul(h, h)],
      ];
      // the square written out, then a through the bracket
      if (eq(a, q(1))) w.write(`${head} = ${inX(...square)}${plus(k)}`);
      else {
        w.write(`${head} = ${factorTex(a)}(${inX(...square)})${plus(k)}`);
        w.write(`${head} = ${inX(...square.map(([p, v]) => [p, qMul(a, v)] as [number, Q]))}${plus(k)}`);
      }
    } else {
      const node = parseExpr(deps, quad.rhs);
      const lines = node ? simplifyExpressionSteps(node, ["x"], quad.rhs, deps.normalize) : null;
      if (lines) w.writeAll(lines.map((l) => `${head} = ${l}`));
    }
    w.write(final);
    if (w.last !== final) return null;
    return { latex: final, steps: w.lines() };
  });
}

/** h = -\frac{b}{2a}, k = f(h) in the student's own right side; or read off a vertex form. */
function vertexSteps(deps: CourseDeps, quad: Quadratic, label: string, input: string): Solved | null {
  return exactly(() => {
    const { a, b, c, head } = quad;
    const w = new StepWriter(deps.normalize, input);
    const h = qDiv(qNeg(b), qMul(q(2), a));
    const k = qAdd(qAdd(qMul(a, qMul(h, h)), qMul(b, h)), c);
    if (quad.vertex) {
      if (quad.vertex.h.n < 0) w.write(`${head} = ${factorTex(a)}(x - ${signed(quad.vertex.h)})^{2}${plus(quad.vertex.k)}`);
    } else {
      if (a.d === 1 && b.d === 1) w.write(`h = -\\frac{${b.n}}{2(${a.n})}`);
      w.write(`h = ${qTex(h)}`);
      const sub = substituteParam(quad.rhs, "x", qTex(h));
      w.write(`k = ${sub}`);
      const worked = arithmetic(deps, sub, false);
      if (!worked) return null;
      for (const l of worked.lines) w.write(`k = ${l}`);
      if (Math.abs(worked.value - k.n / k.d) > 1e-9 * Math.max(1, Math.abs(worked.value))) return null;
    }
    const final = `${label} = (${qTex(h)}, ${qTex(k)})`;
    w.write(final);
    // the check: the vertex from the vertex form and from -b/2a agree
    if (quad.vertex && (!eq(quad.vertex.h, h) || !eq(quad.vertex.k, k))) return null;
    return { latex: final, steps: w.lines() };
  });
}

/** Mid-way through completing the square (`(x^{2} + 6x + 9) - 9 + 5`): x² and x in one bracket. */
function halfWay(deps: CourseDeps, rhs: string): boolean {
  const node = parseExpr(deps, rhs);
  if (!node) return false;
  let found = false;
  node.traverse((n: MathNode) => {
    const a = n as AnyNode;
    if (found || a.type !== "ParenthesisNode" || !a.content) return;
    const t = termsOf(a.content, ["x"]);
    if (t && t.some((x) => x.vars.x === 2) && t.some((x) => x.vars.x === 1)) found = true;
  });
  return found;
}

/**
 * The quadratic written in the form asked for: its vertex form, its standard form, or its
 * vertex. Null when the line is already in that form, or the working does not check out.
 */
export function quadraticIn(deps: CourseDeps, quad: Quadratic, ask: QuadraticAsk, input: string): Solved | null {
  if (ask.want === "vertex") return vertexSteps(deps, quad, ask.label, input);
  if (ask.want === "standard") return quad.bracketed ? expand(deps, quad, input) : null;
  if (quad.vertex) return null;
  // a line half-way through (the student's own): its vertex form, one line
  if (halfWay(deps, quad.rhs)) {
    const h = qDiv(qNeg(quad.b), qMul(q(2), quad.a));
    const k = qSub(quad.c, qMul(quad.a, qMul(h, h)));
    const final = vertexFormLine(quad.head, quad.a, h, k);
    return { latex: final, steps: [final] };
  }
  return completeSquare(deps, quad, input);
}

/** The column's last line asks about the quadratic above it (the nearest one): answered, or null. */
export function quadraticAnswer(deps: CourseDeps, lines: readonly string[]): Solved | null {
  try {
    const target = lines[lines.length - 1] ?? "";
    const ask = quadraticAsk(target);
    if (!ask) return null;
    for (let i = lines.length - 2; i >= 0; i--) {
      const quad = quadraticOf(deps, lines[i]);
      if (quad) return quadraticIn(deps, quad, ask, target);
    }
    return null;
  } catch {
    return null;
  }
}

/** The line is this quadratic again, rewritten (the same a, b and c). */
export function sameQuadratic(deps: CourseDeps, latex: string, quad: Quadratic): boolean {
  const other = quadraticOf(deps, latex);
  return other !== null && eq(other.a, quad.a) && eq(other.b, quad.b) && eq(other.c, quad.c);
}

/** A form of the quadratic asked for above the line (a template or its word): the form, or null. */
export function quadraticFormAbove(lines: readonly string[]): QuadraticAsk | null {
  for (const l of lines) {
    const ask = quadraticAsk(l);
    if (ask && ask.want !== "vertex") return ask;
  }
  return null;
}

// ---------------------------------------------------------------- the student's own lines

/** A vertex claim: `(h, k) = (-3, -4)`, `\text{vertex} = (-3, -4)`. */
function vertexClaim(deps: CourseDeps, latex: string): { h: number; k: number } | null {
  const m = /^\s*(?:\(\s*h\s*,\s*k\s*\)|\\left\s*\(\s*h\s*,\s*k\s*\\right\s*\)|\\text\s*\{\s*vertex\s*\})\s*=\s*(?:\\left\s*)?\(([^,]+),([^)]+?)(?:\\right\s*)?\)\s*$/i.exec(latex ?? "");
  if (!m) return null;
  const at = (s: string) => {
    const node = parseExpr(deps, s.trim());
    if (!node) return null;
    try {
      const v = node.compile().evaluate({});
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };
  const h = at(m[1]);
  const k = at(m[2]);
  return h === null || k === null ? null : { h, k };
}

/**
 * A line under a quadratic (`ctx.previous` is one): a form or the vertex asked for (kind
 * `unknown`: not a step, so the line under it is checked against the quadratic, and Solve answers
 * it); a vertex claim (`ok` / `mismatch`); a rewrite that slips in the constant or the sign of h
 * (`mismatch`). Null for anything else — the engine's own rules then apply.
 */
export function quadraticAnalysis(deps: CourseDeps, latex: string, ctx: AnalyzeContext): LineAnalysis | null {
  if (ctx.previous?.kind !== "function" || !latex) return null;
  const ask = quadraticAsk(latex);
  // (cheap first: only an ask, a vertex claim or a function line with a bracket in it is looked at)
  const rewrite = HEAD.test(latex.split("=")[0] ?? "") && (/\(/.test(latex) || /\(/.test(ctx.previous.math));
  if (!ask && !rewrite && !/[hk]\s*\)|vertex/.test(latex)) return null;
  const prev = quadraticOfAnalysis(deps, ctx.previous);
  if (!prev) return null;
  const line = (kind: LineAnalysis["kind"], verdict: LineAnalysis["verdict"]): LineAnalysis => ({ kind, math: "", resultLatex: "", verdict, note: "" });
  if (ask) return line("unknown", "unknown");
  const claim = vertexClaim(deps, latex);
  if (claim) {
    const h = -qNum(prev.b) / (2 * qNum(prev.a));
    const k = qNum(prev.a) * h * h + qNum(prev.b) * h + qNum(prev.c);
    const close = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));
    return line("equation", close(claim.h, h) && close(claim.k, k) ? "ok" : "mismatch");
  }
  // a rewrite of the quadratic above that slips
  const cur = quadraticOf(deps, latex);
  if (!cur || cur.head !== prev.head || !eq(cur.a, prev.a) || cur.bracketed === prev.bracketed) return null;
  const slip = exactly(() => {
    if (eq(cur.b, prev.b) && !eq(cur.c, prev.c)) return true;
    if (!cur.vertex || prev.bracketed) return false;
    const h = qDiv(qNeg(prev.b), qMul(q(2), prev.a));
    const k = qSub(prev.c, qMul(prev.a, qMul(h, h)));
    return !qIsZero(h) && eq(cur.vertex.h, qNeg(h)) && eq(cur.vertex.k, k);
  });
  if (!slip) return null;
  const rhs = parseExpr(deps, cur.rhs);
  const source = rhs ? rhs.toString() : "";
  const out: LineAnalysis = { kind: "function", math: `${cur.head} = ${source}`, resultLatex: "", verdict: "mismatch", note: "", variable: "x" };
  const plot = source ? plotFor(deps.math, source, cur.rhs, "x") : null;
  if (plot) out.plot = plot;
  return out;
}
