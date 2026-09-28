/**
 * Coordinate geometry the way a teacher writes it, in maths only:
 *
 *   A(1, 2), \ B(4, 6)                        A(1, 2), \ B(4, 6)                          x^{2} + y^{2} - 6x + 4y - 12 = 0
 *   AB = ?                                    M = ?                                       x^{2} - 6x + y^{2} + 4y = 12
 *   ─────────                                 ─────────                                   x^{2} - 6x + 9 + y^{2} + 4y + 4 = 12 + 9 + 4
 *   AB = \sqrt{(4 - 1)^{2} + (6 - 2)^{2}}     M = \left(\frac{1 + 4}{2}, \frac{2 + 6}{2}\right)   (x - 3)^{2} + (y + 2)^{2} = 25
 *   AB = \sqrt{3^{2} + 4^{2}}                 M = \left(\frac{5}{2}, 4\right)             (h, k) = (3, -2), \ r = 5
 *   AB = \sqrt{9 + 16}
 *   AB = \sqrt{25}                            R_{90^{\circ}}(2, 3)
 *   AB = 5                                    (x, y) \to (-y, x)
 *                                             (2, 3) \to (-3, 2)
 *
 *  - points: `A(1, 2)`, `A = (1, 2)`, `(1, 2)`, several on a line;
 *  - the distance, the midpoint and the slope between two of them, asked for by name
 *    (`AB = ?`, `d = ?`, `M = ?`, `m = ?`, `m_{AB} = ?`) or by the formula with `x_{1}`, `y_{2}`, …;
 *    the perpendicular and parallel slopes (`m_{\perp} = ?`);
 *  - a segment divided in a ratio (`AP : PB = 2 : 3`, `P = ?`); a triangle's area from its
 *    vertices by the formula written with `x_{1}`, …, `y_{3}`;
 *  - transformations about the origin, written as maths: `R_{90^{\circ}}(2, 3)` (rotation,
 *    anticlockwise), `r_{y = x}(2, 5)` (reflection in a line — `y = 0` is the x-axis),
 *    `T_{\langle 3, -2 \rangle}(1, 4)` (translation), `D_{2}(3, -1)` (dilation), or a mapping rule
 *    `(x, y) \to (x + 3, y - 2)` beside a point;
 *  - circles: centre and radius from the standard or the general form (completing the square),
 *    and the standard form from `h`, `k`, `r`.
 *
 * Every answer is exact and checked numerically; a line this module does not recognise is `null`.
 */
import { q, type Q } from "./algebra";
import type { EquationOptions, EquationSolution } from "./geometryEquation";
import { evalExact, evalNumber, gLatex, gNum, gVal, NoValue, NotExact, reduceOnce, substitute, symbolsOf, type G } from "./geometryExpr";
import { isSegmentName } from "./geometryNotation";
import { vIsRational, vLatex, vNeg, vNum, vQ, vRational, vSqrt, type Val } from "./geometryValue";
import { preprocessLatex } from "./latex";
import { qFromNumber } from "./poly";
import { MAX_STEPS, StepWriter } from "./solution";

export interface CoordinateDeps {
  tree(latex: string): G | null;
  relation(latex: string): { L: G; R: G; pre: string } | null;
  solveEquation(L: G, R: G, u: string, opts: EquationOptions): EquationSolution | null;
}

export interface Solved {
  latex: string;
  steps: string[];
}

interface Point {
  name: string | null;
  x: G;
  y: G;
  xv: Val;
  yv: Val;
}

const keyOf = (s: string): string => s.replace(/\\left|\\right|\\,|\\ |\s|[{}]/g, "");

// ---------------------------------------------------------------- reading points

/** Top-level pieces of `a, b` (commas outside brackets). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0 && s[i - 1] !== "\\") {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((p) => p.trim().replace(/^\\\s+/, "").replace(/\\[,;: ]\s*$/, "").trim()).filter(Boolean);
}

/** The inside of `( … )` / `\left( … \right)` spanning the whole string, or null. */
function tupleBody(s: string): string | null {
  const t = s.trim().replace(/^\\left\s*\(/, "(").replace(/\\right\s*\)$/, ")");
  if (!t.startsWith("(") || !t.endsWith(")")) return null;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "(") depth++;
    else if (t[i] === ")" && --depth === 0 && i !== t.length - 1) return null;
  }
  return t.slice(1, -1).replace(/\\left|\\right/g, "");
}

/** `(1, 2)` / `\left(\frac{5}{2}, 4\right)` as two trees (any expressions). */
function tuple(s: string, deps: CoordinateDeps): [G, G] | null {
  const body = tupleBody(s);
  if (body === null) return null;
  const parts = splitTop(body);
  if (parts.length !== 2) return null;
  const x = deps.tree(parts[0]);
  const y = deps.tree(parts[1]);
  return x && y ? [x, y] : null;
}

function valueOf(g: G): Val | null {
  try {
    const v = evalExact(g);
    return v.deg === 0 && v.len === 0 ? v : null;
  } catch {
    return null;
  }
}

/** `A(1, 2)`, `A = (1, 2)`, `(1, 2)`: one point with numbers for coordinates. */
function pointOf(s: string, deps: CoordinateDeps): Point | null {
  const m = /^(?:([A-Z])(?:_\{?(\d)\}?)?\s*=?\s*)?((?:\\left\s*)?\([\s\S]*\))$/.exec(s.trim());
  if (!m) return null;
  const t = tuple(m[3], deps);
  if (!t) return null;
  const xv = valueOf(t[0]);
  const yv = valueOf(t[1]);
  if (!xv || !yv) return null;
  const name = m[1] ? (m[2] ? `${m[1]}_${m[2]}` : m[1]) : null;
  return { name, x: t[0], y: t[1], xv, yv };
}

/** A line that is only points (`A(1, 2), \ B(4, 6)`, `(1, 2), (4, 6)`); null otherwise. */
export function pointsOf(latex: string, deps: CoordinateDeps): Point[] | null {
  const s = preprocessLatex(latex)
    .replace(/\\text\s*\{\s*(?:and|,)\s*\}/g, ",")
    .replace(/\\q?quad\b|;/g, ",")
    .trim();
  if (!s.includes("(")) return null;
  // split between points: `A(1, 2), \ B(4, 6)` / `(1, 2)(4, 6)`
  const pieces: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        pieces.push(s.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  const tail = s.slice(start).replace(/\\right\s*$/, "");
  if (tail.replace(/[\s,]|\\[ ,;:]|\\right/g, "") !== "") return null;
  const points: Point[] = [];
  for (const raw of pieces) {
    const p = pointOf(raw.replace(/^[\s,]*(?:\\[ ,;:]\s*)*/, "").replace(/\\right\s*\)$/, ")"), deps);
    if (!p) return null;
    points.push(p);
  }
  return points.length > 0 ? points : null;
}

/** `(1, 2)`, `\left(\frac{5}{2}, 4\right)` as its two coordinates' trees, or null. */
export function tupleOf(s: string, deps: CoordinateDeps): [G, G] | null {
  return tuple(s, deps);
}

/** `R_{90^{\circ}}(2, 3)`, `r_{y = x}(2, 5)`, `(x, y) \to (x + 3, y - 2)`, `(2, 3) \to (-3, 2)`: transformation notation. */
export function isTransformationLine(pre: string): boolean {
  const s = pre.trim();
  if (TRANSFORM.test(s)) return true;
  return /^(?:\\left\s*)?\(/.test(s) && /\)\s*$/.test(s) && /\\(?:to|rightarrow|longrightarrow|mapsto)(?![a-zA-Z])/.test(s);
}

// ---------------------------------------------------------------- printing

function pointLatex(x: G, y: G): string {
  const a = gLatex(x);
  const b = gLatex(y);
  return /\\frac/.test(a + b) ? `\\left(${a}, ${b}\\right)` : `(${a}, ${b})`;
}

/** A substituted coordinate: a negative number in brackets (`4 - (-2)`). */
function coord(v: Val): G {
  return vNum(v) < 0 ? { k: "paren", g: gVal(v) } : gVal(v);
}

/** Round by round on both coordinates together; the finished point, or null when it is not exact. */
function reducePoint(x0: G, y0: G, write: (x: G, y: G) => void): [G, G] | null {
  let x = x0;
  let y = y0;
  for (let guard = 0; guard < 16; guard++) {
    const nx = reduceOnce(x);
    const ny = reduceOnce(y);
    if (!nx && !ny) break;
    x = nx ?? x;
    y = ny ?? y;
    write(x, y);
  }
  return x.k === "val" && y.k === "val" ? [x, y] : null;
}

// ---------------------------------------------------------------- one line

/** `M = \left(\frac{1 + 4}{2}, \frac{2 + 6}{2}\right)`: a point worked out coordinate by coordinate. */
function pointAssignment(pre: string, deps: CoordinateDeps): Solved | null {
  const m = /^([A-Z](?:_\{?\d\}?)?|\\left\s*\(\s*h\s*,\s*k\s*\\right\s*\)|\(\s*h\s*,\s*k\s*\))\s*=\s*([\s\S]+)$/.exec(pre);
  const name = m ? m[1] : null;
  const body = m ? m[2] : pre.replace(/=\s*$/, "").trim();
  const t = tuple(body, deps);
  if (!t) return null;
  if (symbolsOf(t[0]).size + symbolsOf(t[1]).size > 0) return null;
  const lead = name ? `${name.replace(/\s+/g, "")} = ` : "= ";
  const writer = new StepWriter(keyOf, `${lead}${pointLatex(t[0], t[1])}`);
  const done = reducePoint(t[0], t[1], (x, y) => writer.write(`${lead}${pointLatex(x, y)}`));
  if (!done) return null;
  const steps = writer.lines(MAX_STEPS);
  if (steps.length === 0) return null;
  return { latex: steps[steps.length - 1], steps };
}

type Transform = { rule: [string, string]; apply: (x: G, y: G) => [G, G] } | null;

const neg = (g: G): G => ({ k: "neg", g });
const add = (a: G, b: G, minus = false): G => ({ k: "add", items: [{ neg: false, g: a }, { neg: minus, g: b }] });
const mulG = (a: G, b: G): G => ({ k: "mul", items: [a, b] });

/** A transformation written as maths: `R_{90^{\circ}}`, `r_{y = x}`, `T_{\langle 3, -2 \rangle}`, `D_{2}`. */
function transformOf(sub: string, letter: string, deps: CoordinateDeps): Transform {
  const s = sub.replace(/\\left|\\right/g, "").replace(/\s+/g, "");
  if (/^[Rr]$/.test(letter) || letter === "rho") {
    // a rotation by an angle about the origin (`R_{90^{\circ}}`, `R_{O, 90^{\circ}}`)
    const deg = /^(?:O,)?(-?\d+)(?:\^\{?\\circ\}?|°)?$/.exec(s);
    if (deg && letter === "R") {
      const d = ((Number(deg[1]) % 360) + 360) % 360;
      if (d === 90) return { rule: ["-y", "x"], apply: (x, y) => [neg(y), x] };
      if (d === 180) return { rule: ["-x", "-y"], apply: (x, y) => [neg(x), neg(y)] };
      if (d === 270) return { rule: ["y", "-x"], apply: (x, y) => [y, neg(x)] };
      return null;
    }
    // a reflection in a line (`r_{y = x}`, `r_{y = 0}`, `r_{x = 2}`)
    const line = /^([xy])=(-?)([xy]|-?\d+)$/.exec(s);
    if (!line) return null;
    const [, lhs, sign, rhs] = line;
    if (lhs === "y" && rhs === "x") return sign ? { rule: ["-y", "-x"], apply: (x, y) => [neg(y), neg(x)] } : { rule: ["y", "x"], apply: (x, y) => [y, x] };
    if (/^\d+$/.test(rhs)) {
      const a = Number(`${sign}${rhs}`);
      if (a === 0) return lhs === "y" ? { rule: ["x", "-y"], apply: (x, y) => [x, neg(y)] } : { rule: ["-x", "y"], apply: (x, y) => [neg(x), y] };
      const twoA = gNum(2 * a);
      return lhs === "x"
        ? { rule: [`${2 * a} - x`, "y"], apply: (x, y) => [add(twoA, x, true), y] }
        : { rule: ["x", `${2 * a} - y`], apply: (x, y) => [x, add(twoA, y, true)] };
    }
    return null;
  }
  if (letter === "T") {
    // a translation by a vector (`T_{\langle 3, -2 \rangle}`, `T_{(3, -2)}`, `T_{3, -2}`)
    const body = s.replace(/^\\langle|\\rangle$/g, "").replace(/^\(|\)$/g, "");
    const parts = splitTop(body);
    if (parts.length !== 2) return null;
    const a = deps.tree(parts[0]);
    const b = deps.tree(parts[1]);
    const av = a && valueOf(a);
    const bv = b && valueOf(b);
    if (!av || !bv) return null;
    const term = (v: Val, name: string): string => (vNum(v) < 0 ? `${name} - ${vLatex(vNeg(v))}` : `${name} + ${vLatex(v)}`);
    const shift = (g: G, v: Val): G => (vNum(v) < 0 ? add(g, gVal(vNeg(v)), true) : add(g, gVal(v)));
    return { rule: [term(av, "x"), term(bv, "y")], apply: (x, y) => [shift(x, av), shift(y, bv)] };
  }
  if (letter === "D") {
    // a dilation about the origin (`D_{2}`, `D_{\frac{1}{2}}`, `D_{O, 2}`)
    const k = deps.tree(s.replace(/^O,/, ""));
    const kv = k && valueOf(k);
    if (!k || !kv || vNum(kv) === 0) return null;
    const kt = vLatex(kv);
    const kTex = /\\frac/.test(kt) ? kt : kt;
    return { rule: [`${kTex}x`, `${kTex}y`], apply: (x, y) => [mulG(gVal(kv), x), mulG(gVal(kv), y)] };
  }
  return null;
}

const TRANSFORM = /^\\?(R|r|T|D|rho|mathrm\s*\{\s*[RrTD]\s*\})\s*_\s*\{([\s\S]*?)\}\s*((?:\\left\s*)?\([\s\S]*\))\s*=?\s*$/;

/** `R_{90^{\circ}}(2, 3)`: the rule, then the image. */
function transformation(pre: string, deps: CoordinateDeps, points: readonly Point[] = []): Solved | null {
  const m = TRANSFORM.exec(pre.trim());
  if (!m) return null;
  const letter = m[1].replace(/^mathrm\s*\{\s*|\s*\}$/g, "");
  const tr = transformOf(m[2], letter, deps);
  if (!tr) return null;
  let p = pointOf(m[3], deps);
  if (!p) {
    // `R_{90^{\circ}}(A)`: a point named on a line above
    const named = /^\(\s*([A-Z])\s*\)$/.exec(m[3].trim());
    p = named ? (points.find((q) => q.name === named[1]) ?? null) : null;
  }
  if (!p) return null;
  return applyRule(tr.rule, (x, y) => tr.apply(x, y), p);
}

function applyRule(rule: [string, string], apply: (x: G, y: G) => [G, G], p: Point): Solved | null {
  const from = pointLatex(gVal(p.xv), gVal(p.yv));
  const writer = new StepWriter(keyOf);
  writer.write(`(x, y) \\to (${rule[0]}, ${rule[1]})`);
  const [x0, y0] = apply(coord(p.xv), coord(p.yv));
  const shown = `${from} \\to ${pointLatex(x0, y0)}`;
  const done = reducePoint(x0, y0, () => {});
  if (!done) return null;
  const image = `${from} \\to ${pointLatex(done[0], done[1])}`;
  // the substitution only when there is arithmetic in it (`(1 + 3, 4 - 2)`)
  if (keyOf(shown) !== keyOf(image) && /[+]|\d\s*-|\)\s*-/.test(pointLatex(x0, y0))) writer.write(shown, true);
  writer.write(image);
  // checked: the image by the rule at decimal values
  const nx = evalNumber(x0).n;
  const ny = evalNumber(y0).n;
  if (!(Math.abs(nx - vNum((done[0] as { v: Val }).v)) < 1e-9 && Math.abs(ny - vNum((done[1] as { v: Val }).v)) < 1e-9)) return null;
  const steps = writer.lines(MAX_STEPS);
  return { latex: steps[steps.length - 1], steps };
}

/** `(x, y) \to (x + 3, y - 2)`: a mapping rule, as two trees in x and y. */
function mappingRule(latex: string, deps: CoordinateDeps): { rule: [string, string]; x: G; y: G } | null {
  const s = preprocessLatex(latex);
  const m = /^(?:\\left\s*)?\(\s*x\s*,\s*y\s*(?:\\right\s*)?\)\s*\\(?:to|rightarrow|longrightarrow|mapsto)\s*([\s\S]+)$/.exec(s);
  if (!m) return null;
  const body = tupleBody(m[1]);
  if (body === null) return null;
  const parts = splitTop(body);
  if (parts.length !== 2) return null;
  const x = deps.tree(parts[0]);
  const y = deps.tree(parts[1]);
  if (!x || !y) return null;
  const syms = new Set([...symbolsOf(x), ...symbolsOf(y)]);
  if ([...syms].some((v) => v !== "x" && v !== "y")) return null;
  return { rule: [parts[0], parts[1]], x, y };
}

// ---------------------------------------------------------------- circles

interface Conic {
  /** a(x² + y²) + D x + E y + F = 0 */
  a: Q;
  D: Q;
  E: Q;
  F: Q;
}

/** `x^{2} + y^{2} - 6x + 4y - 12 = 0` / `(x - 3)^{2} + (y + 2)^{2} = 25` as a(x² + y²) + Dx + Ey + F = 0; null for any other curve. */
function circleOf(L: G, R: G): Conic | null {
  const syms = new Set([...symbolsOf(L), ...symbolsOf(R)]);
  if (syms.size !== 2 || !syms.has("x") || !syms.has("y")) return null;
  const f = (x: number, y: number): number => {
    const scope = new Map([
      ["x", { n: x, deg: 0, pi: false }],
      ["y", { n: y, deg: 0, pi: false }],
    ]);
    return evalNumber(L, scope).n - evalNumber(R, scope).n;
  };
  const F = f(0, 0);
  const a = (f(1, 0) + f(-1, 0)) / 2 - F;
  const ay = (f(0, 1) + f(0, -1)) / 2 - F;
  const D = (f(1, 0) - f(-1, 0)) / 2;
  const E = (f(0, 1) - f(0, -1)) / 2;
  if (!Number.isFinite(a) || Math.abs(a) < 1e-12 || Math.abs(a - ay) > 1e-9 * Math.max(1, Math.abs(a))) return null;
  // exactly that polynomial (no xy term, nothing of higher degree)
  for (const [x, y] of [
    [1.7, -2.3],
    [-3.1, 0.9],
    [2.2, 4.4],
    [0.37, -1.61],
  ]) {
    const want = a * (x * x + y * y) + D * x + E * y + F;
    if (Math.abs(f(x, y) - want) > 1e-7 * Math.max(1, Math.abs(want))) return null;
  }
  const qa = qFromNumber(a);
  const qD = qFromNumber(D);
  const qE = qFromNumber(E);
  const qF = qFromNumber(F);
  if (!qa || !qD || !qE || !qF) return null;
  return { a: qa, D: qD, E: qE, F: qF };
}

const qv = (x: Q): number => x.n / x.d;
const tex = (x: Q): string => vLatex(vQ(x));

/** `(x - 3)^{2}`, `(y + \frac{1}{2})^{2}`, `x^{2}` for a centre coordinate h. */
function squareTex(name: string, h: Q): string {
  if (h.n === 0) return `${name}^{2}`;
  const inner = `${name} ${h.n > 0 ? "-" : "+"} ${tex({ n: Math.abs(h.n), d: h.d })}`;
  return /\\frac/.test(inner) ? `\\left(${inner}\\right)^{2}` : `(${inner})^{2}`;
}

/** `x^{2} - 6x`: one variable's part of the expanded equation (divided through by a). */
function linearPart(name: string, b: Q): string {
  if (b.n === 0) return `${name}^{2}`;
  const abs = { n: Math.abs(b.n), d: b.d };
  return `${name}^{2} ${b.n < 0 ? "-" : "+"} ${abs.n === 1 && abs.d === 1 ? "" : tex(abs)}${name}`;
}

/** Centre and radius, completing the square when the equation is in general form. */
function circleCentre(L: G, R: G, general: boolean): Solved | null {
  const c = circleOf(L, R);
  if (!c) return null;
  const div = (x: Q): Q => q(x.n * c.a.d, x.d * c.a.n);
  const b = div(c.D);
  const e = div(c.E);
  const f = div(c.F);
  const h = q(-b.n, 2 * b.d);
  const k = q(-e.n, 2 * e.d);
  const hh = q(h.n * h.n, h.d * h.d);
  const kk = q(k.n * k.n, k.d * k.d);
  const r2 = q(hh.n * kk.d * f.d + kk.n * hh.d * f.d - f.n * hh.d * kk.d, hh.d * kk.d * f.d);
  if (qv(r2) <= 0) return null;
  const writer = new StepWriter(keyOf);
  if (general) {
    const rhs = q(-f.n, f.d);
    writer.write(`${linearPart("x", b)} + ${linearPart("y", e)} = ${tex(rhs)}`);
    const addX = hh.n === 0 ? "" : ` + ${tex(hh)}`;
    const addY = kk.n === 0 ? "" : ` + ${tex(kk)}`;
    if (addX || addY) writer.write(`${linearPart("x", b)}${addX} + ${linearPart("y", e)}${addY} = ${tex(rhs)}${addX}${addY}`);
    writer.write(`${squareTex("x", h)} + ${squareTex("y", k)} = ${tex(r2)}`);
  }
  let r: Val;
  try {
    r = vSqrt(vQ(r2));
  } catch {
    return null;
  }
  const centre = `(h, k) = ${pointLatex(gVal(vQ(h)), gVal(vQ(k)))}`;
  const rational = vIsRational(r);
  if (!rational || vRational(r)!.d !== 1 || !(r2.d === 1 && Number.isInteger(Math.sqrt(r2.n)))) writer.write(`${centre}, \\ r = \\sqrt{${tex(r2)}}`, true);
  writer.write(`${centre}, \\ r = ${vLatex(r)}`);
  // checked: the centre and the radius give back the equation
  const back = (x: number, y: number) => (x - qv(h)) ** 2 + (y - qv(k)) ** 2 - vNum(r) ** 2;
  const scope = (x: number, y: number) =>
    new Map([
      ["x", { n: x, deg: 0, pi: false }],
      ["y", { n: y, deg: 0, pi: false }],
    ]);
  for (const [x, y] of [
    [0.3, 1.7],
    [-2.2, 0.4],
  ]) {
    const got = (evalNumber(L, scope(x, y)).n - evalNumber(R, scope(x, y)).n) / qv(c.a);
    if (Math.abs(got - back(x, y)) > 1e-7 * Math.max(1, Math.abs(got))) return null;
  }
  const steps = writer.lines(MAX_STEPS);
  return { latex: steps[steps.length - 1], steps };
}

// ---------------------------------------------------------------- entry points

export function solveCoordinateLine(latex: string, deps: CoordinateDeps): Solved | null {
  try {
    const pre = preprocessLatex(latex);
    if (/\?/.test(pre)) return null;
    const t = transformation(pre, deps);
    if (t) return t;
    if (/,/.test(pre)) {
      const p = pointAssignment(pre, deps);
      if (p) return p;
    }
    const rel = deps.relation(latex);
    // a circle in general form (completing the square); one already in standard form is read
    // only when asked (`r = ?`) — alone it may be half of a system with a line
    if (rel && !isStandard(pre)) {
      const circle = circleCentre(rel.L, rel.R, true);
      if (circle) return circle;
    }
    return null;
  } catch (e) {
    if (e instanceof NotExact || e instanceof NoValue) return null;
    return null;
  }
}

/** `(x - 3)^{2} + (y + 2)^{2} = 25`, `x^{2} + y^{2} = 49`: already the standard form. */
function isStandard(pre: string): boolean {
  const s = pre.replace(/\\left|\\right|\s/g, "");
  const sq = String.raw`(?:\(x[-+][^()]+\)\^\{?2\}?|x\^\{?2\}?)`;
  const sqy = String.raw`(?:\(y[-+][^()]+\)\^\{?2\}?|y\^\{?2\}?)`;
  return new RegExp(`^${sq}\\+${sqy}=[^xy]+$`).test(s);
}

export function simplifyCoordinates(latex: string, deps: CoordinateDeps): string[] | null {
  try {
    const pre = preprocessLatex(latex).replace(/=\s*$/, "").trim();
    const t = transformation(pre, deps);
    if (t) return t.steps;
    if (/,/.test(pre) && !/=/.test(pre)) {
      const p = pointAssignment(pre, deps);
      if (p) return p.steps;
    }
    return null;
  } catch {
    return null;
  }
}

/** `AB = ?`, `d = ?`, `M = ?`, `m_{AB} = ?`, `m_{\perp} = ?`, `P = ?`: what is asked, as written. */
function questionOf(latex: string): string | null {
  const s = preprocessLatex(latex).replace(/\\text\s*\{\s*\?\s*\}/g, "?").replace(/\s+/g, " ").trim();
  const m = /^(.+?)\s*=\s*\??$/.exec(s);
  return m && !/=/.test(m[1]) ? gLatexName(m[1]) : null;
}

export function solveCoordinates(lines: readonly string[], deps: CoordinateDeps): Solved | null {
  try {
    return solve(lines, deps);
  } catch (e) {
    if (e instanceof NotExact || e instanceof NoValue) return null;
    return null;
  }
}

function solve(lines: readonly string[], deps: CoordinateDeps): Solved | null {
  const points: Point[] = [];
  const knowns = new Map<string, Val>();
  let ratio: { a: number; b: number; from?: string; to?: string; name?: string } | null = null;
  let rule: ReturnType<typeof mappingRule> = null;
  const used = lines.filter((l) => l && l.trim());
  if (used.length < 2) return null;
  const target = used[used.length - 1];
  for (const raw of used.slice(0, -1)) {
    const ps = pointsOf(raw, deps);
    if (ps) {
      points.push(...ps);
      continue;
    }
    const r = mappingRule(raw, deps);
    if (r) {
      rule = r;
      continue;
    }
    const rr = ratioOf(raw);
    if (rr) {
      ratio = rr;
      continue;
    }
    const rel = deps.relation(raw);
    if (rel && rel.L.k === "sym") {
      const v = valueOf(rel.R);
      if (v) knowns.set(rel.L.name, v);
    }
  }

  // a mapping rule beside a point (either one last)
  const lastPoints = pointsOf(target, deps);
  const lastRule = mappingRule(target, deps);
  if (rule && lastPoints && lastPoints.length === 1) return applyRule(rule.rule, (x, y) => [substituteXY(rule!.x, x, y), substituteXY(rule!.y, x, y)], lastPoints[0]);
  if (lastRule && points.length === 1) return applyRule(lastRule.rule, (x, y) => [substituteXY(lastRule.x, x, y), substituteXY(lastRule.y, x, y)], points[0]);
  // a transformation of a point named above: `R_{90^{\circ}}(A)`
  const t = transformation(preprocessLatex(target).replace(/=\s*\??\s*$/, ""), deps, points);
  if (t) return t;
  // circles: `(x - h)^{2} + (y - k)^{2} = r^{2}` under h, k, r (or a centre point and r)
  const circle = circleFromCentre(target, points, knowns, deps);
  if (circle) return circle;
  // `r = ?`, `(h, k) = ?` under a circle's equation: its centre and radius
  const asked = questionOf(target)?.replace(/\\left|\\right|\s/g, "");
  if (asked && /^(?:r|h|k|\(h,k\))$/.test(asked)) {
    for (let i = used.length - 2; i >= 0; i--) {
      const rel = deps.relation(used[i]);
      const c = rel ? circleCentre(rel.L, rel.R, !isStandard(preprocessLatex(used[i]))) : null;
      if (c) return c;
    }
  }

  if (points.length < 2) return null;
  const q = questionOf(target);
  const [p1, p2] = pickPair(q, points);
  if (!p1 || !p2) return null;

  // the formula as written, with x_{1}, y_{1}, x_{2}, y_{2} (and x_{3}, y_{3})
  const formula = subscriptFormula(target, points, deps);
  if (formula) return formula;
  if (!q) return null;
  const name = q.replace(/\s+/g, "");
  // distance: `AB = ?` (the two points named), `d = ?`, `d_{AB} = ?`
  if ((isSegmentName(name) && p1.name && p2.name) || /^d(?:_\{?[A-Z]{2}\}?)?$/.test(name)) return distance(q, p1, p2);
  // slope: `m = ?`, `m_{AB} = ?`; the perpendicular / parallel slope
  if (/^m(?:_\{?[A-Z]{2}\}?)?$/.test(name)) return slope(q, p1, p2);
  const perp = /^m_\{?\\(perp|parallel)\}?$/.exec(name);
  if (perp) return otherSlope(q, p1, p2, perp[1] === "perp");
  // midpoint `M = ?` (no point of that name), or the point dividing AB in a ratio
  if (/^[A-Z]$/.test(name) && !points.some((p) => p.name === name)) return ratio ? partition(q, p1, p2, ratio) : midpoint(q, p1, p2);
  return null;
}

/** The two points a question is about: `AB` names them; otherwise the first two. */
function pickPair(q: string | null, points: readonly Point[]): [Point | null, Point | null] {
  const letters = q ? /([A-Z])\s*([A-Z])/.exec(q.replace(/^[dm]_?\{?/, "")) : null;
  if (letters) {
    const a = points.find((p) => p.name === letters[1]);
    const b = points.find((p) => p.name === letters[2]);
    if (a && b) return [a, b];
  }
  return [points[0] ?? null, points[1] ?? null];
}

function substituteXY(g: G, x: G, y: G): G {
  return substitute(g, new Map([
    ["x", x],
    ["y", y],
  ]));
}

function ratioOf(latex: string): { a: number; b: number; from?: string; to?: string; name?: string } | null {
  const s = preprocessLatex(latex).replace(/\\overline\{([A-Z]{2})\}/g, "$1").replace(/\s+/g, "");
  const m = /^(?:([A-Z])([A-Z]):([A-Z])([A-Z])=)?(\d+):(\d+)$/.exec(s);
  if (!m) return null;
  const a = Number(m[5]);
  const b = Number(m[6]);
  if (!(a > 0 && b > 0)) return null;
  if (m[1] && m[2] === m[3]) return { a, b, from: m[1], name: m[2], to: m[4] };
  return m[1] ? null : { a, b };
}

function evaluateLine(lead: string, g: G, writer: StepWriter): G {
  let cur = g;
  for (let guard = 0; guard < 16; guard++) {
    const next = reduceOnce(cur);
    if (!next) break;
    cur = next;
    writer.write(`${lead} = ${gLatex(cur)}`, cur.k !== "val");
  }
  return cur;
}

const diff = (a: Val, b: Val): G => ({ k: "add", items: [{ neg: false, g: gVal(a) }, { neg: true, g: coord(b) }] });

function distance(name: string, p: Point, r: Point): Solved | null {
  const sq = (a: Val, b: Val): G => ({ k: "pow", base: { k: "paren", g: diff(a, b) }, exp: gNum(2) });
  const g: G = { k: "root", n: 2, arg: { k: "add", items: [{ neg: false, g: sq(r.xv, p.xv) }, { neg: false, g: sq(r.yv, p.yv) }] } };
  const lead = gLatexName(name);
  const writer = new StepWriter(keyOf);
  writer.write(`${lead} = ${gLatex(g)}`);
  const done = evaluateLine(lead, g, writer);
  if (done.k !== "val") return null;
  const want = Math.hypot(vNum(r.xv) - vNum(p.xv), vNum(r.yv) - vNum(p.yv));
  if (Math.abs(vNum(done.v) - want) > 1e-9 * Math.max(1, want)) return null;
  const steps = writer.lines(MAX_STEPS);
  return { latex: steps[steps.length - 1], steps };
}

function slope(name: string, p: Point, r: Point): Solved | null {
  if (vNum(r.xv) === vNum(p.xv)) return null;
  const g: G = { k: "div", num: diff(r.yv, p.yv), den: diff(r.xv, p.xv) };
  const lead = gLatexName(name);
  const writer = new StepWriter(keyOf);
  writer.write(`${lead} = ${gLatex(g)}`);
  const done = evaluateLine(lead, g, writer);
  if (done.k !== "val") return null;
  if (Math.abs(vNum(done.v) - (vNum(r.yv) - vNum(p.yv)) / (vNum(r.xv) - vNum(p.xv))) > 1e-9) return null;
  const steps = writer.lines(MAX_STEPS);
  return { latex: steps[steps.length - 1], steps };
}

/** `m_{\perp} = -\frac{3}{4}` (the negative reciprocal), `m_{\parallel}` the same slope. */
function otherSlope(name: string, p: Point, r: Point, perpendicular: boolean): Solved | null {
  const first = slope("m", p, r);
  if (!first) return null;
  const mv = evalExact({ k: "div", num: diff(r.yv, p.yv), den: diff(r.xv, p.xv) });
  if (perpendicular && vNum(mv) === 0) return null;
  const lead = gLatexName(name);
  const writer = new StepWriter(keyOf);
  writer.writeAll(first.steps);
  if (!perpendicular) writer.write(`${lead} = ${vLatex(mv)}`);
  else {
    const m = vRational(mv);
    if (!m) return null;
    const recip = q(-m.d, m.n);
    writer.write(`${lead} = ${vLatex(vQ(recip))}`);
    if (Math.abs(qv(recip) * vNum(mv) + 1) > 1e-12) return null;
  }
  const steps = writer.lines(MAX_STEPS);
  return { latex: steps[steps.length - 1], steps };
}

function midpoint(name: string, p: Point, r: Point): Solved | null {
  const half = (a: Val, b: Val): G => ({ k: "div", num: { k: "add", items: [{ neg: false, g: gVal(a) }, { neg: false, g: coord(b) }] }, den: gNum(2) });
  const x = half(p.xv, r.xv);
  const y = half(p.yv, r.yv);
  const lead = gLatexName(name);
  const writer = new StepWriter(keyOf);
  writer.write(`${lead} = ${pointLatex(x, y)}`);
  const done = reducePoint(x, y, (a, b) => writer.write(`${lead} = ${pointLatex(a, b)}`, true));
  if (!done) return null;
  writer.write(`${lead} = ${pointLatex(done[0], done[1])}`);
  const ok = (g: G, want: number) => g.k === "val" && Math.abs(vNum(g.v) - want) < 1e-9;
  if (!ok(done[0], (vNum(p.xv) + vNum(r.xv)) / 2) || !ok(done[1], (vNum(p.yv) + vNum(r.yv)) / 2)) return null;
  const steps = writer.lines(MAX_STEPS);
  return { latex: steps[steps.length - 1], steps };
}

/** P on AB with AP : PB = a : b: P = A + \frac{a}{a + b}(B - A), coordinate by coordinate. */
function partition(name: string, p: Point, r: Point, ratio: { a: number; b: number; from?: string; to?: string }): Solved | null {
  let [A, B] = [p, r];
  if (ratio.from && ratio.to && A.name === ratio.to && B.name === ratio.from) [A, B] = [B, A];
  const t = q(ratio.a, ratio.a + ratio.b);
  const part = (a: Val, b: Val): G => ({ k: "add", items: [{ neg: false, g: gVal(a) }, { neg: false, g: { k: "mul", items: [gVal(vQ(t)), { k: "paren", g: diff(b, a) }] } }] });
  const x = part(A.xv, B.xv);
  const y = part(A.yv, B.yv);
  const lead = gLatexName(name);
  const writer = new StepWriter(keyOf);
  writer.write(`${lead} = ${pointLatex(x, y)}`);
  const done = reducePoint(x, y, (a, b) => writer.write(`${lead} = ${pointLatex(a, b)}`, true));
  if (!done) return null;
  writer.write(`${lead} = ${pointLatex(done[0], done[1])}`);
  const want = (a: Val, b: Val) => vNum(a) + qv(t) * (vNum(b) - vNum(a));
  const ok = (g: G, w: number) => g.k === "val" && Math.abs(vNum(g.v) - w) < 1e-9;
  if (!ok(done[0], want(A.xv, B.xv)) || !ok(done[1], want(A.yv, B.yv))) return null;
  const steps = writer.lines(MAX_STEPS);
  return { latex: steps[steps.length - 1], steps };
}

/** `d = \sqrt{(x_{2} - x_{1})^{2} + …}`, `M = \left(\frac{x_{1} + x_{2}}{2}, …\right)`, the area formula: the points' coordinates in. */
function subscriptFormula(latex: string, points: readonly Point[], deps: CoordinateDeps): Solved | null {
  const pre = preprocessLatex(latex);
  if (!/[xy]_\{?[123]\}?/.test(pre)) return null;
  const m = /^([A-Za-z](?:_\{?[A-Za-z0-9]+\}?)?)\s*=\s*([\s\S]+)$/.exec(pre);
  if (!m) return null;
  const values = new Map<string, G>();
  points.slice(0, 3).forEach((p, i) => {
    values.set(`x_${i + 1}`, coord(p.xv));
    values.set(`y_${i + 1}`, coord(p.yv));
  });
  const lead = m[1];
  const writer = new StepWriter(keyOf, pre);
  const t = tuple(m[2], deps);
  if (t) {
    const x = substitute(t[0], values);
    const y = substitute(t[1], values);
    if (symbolsOf(x).size + symbolsOf(y).size > 0) return null;
    writer.write(`${lead} = ${pointLatex(x, y)}`);
    const done = reducePoint(x, y, (a, b) => writer.write(`${lead} = ${pointLatex(a, b)}`, true));
    if (!done) return null;
    writer.write(`${lead} = ${pointLatex(done[0], done[1])}`);
    const steps = writer.lines(MAX_STEPS);
    return { latex: steps[steps.length - 1], steps };
  }
  const g = deps.tree(m[2]);
  if (!g) return null;
  const sub = substitute(g, values);
  if (symbolsOf(sub).size > 0) return null;
  writer.write(`${lead} = ${gLatex(sub)}`);
  const done = evaluateLine(lead, sub, writer);
  if (done.k !== "val") return null;
  if (Math.abs(vNum(done.v) - evalNumber(sub).n) > 1e-9 * Math.max(1, Math.abs(vNum(done.v)))) return null;
  const steps = writer.lines(MAX_STEPS);
  return { latex: steps[steps.length - 1], steps };
}

/** `(x - h)^{2} + (y - k)^{2} = r^{2}` under h, k, r (or a centre point and r): the circle's equation. */
function circleFromCentre(target: string, points: readonly Point[], knowns: ReadonlyMap<string, Val>, deps: CoordinateDeps): Solved | null {
  const s = preprocessLatex(target).replace(/\\left|\\right|\s/g, "");
  if (!/^\(x-h\)\^\{?2\}?\+\(y-k\)\^\{?2\}?=r\^\{?2\}?$/.test(s)) return null;
  let h = knowns.get("h");
  let k = knowns.get("k");
  const r = knowns.get("r");
  if ((!h || !k) && points.length === 1) {
    h = points[0].xv;
    k = points[0].yv;
  }
  if (!h || !k || !r || vNum(r) <= 0) return null;
  const hq = vRational(h);
  const kq = vRational(k);
  if (!hq || !kq) return null;
  const rTex = vLatex(r);
  const rSq = rTex.length === 1 || /^\d+$/.test(rTex) ? `${rTex}^{2}` : `\\left(${rTex}\\right)^{2}`;
  const writer = new StepWriter(keyOf, target);
  const left = `${squareTex("x", hq)} + ${squareTex("y", kq)}`;
  writer.write(`${left} = ${rSq}`);
  const r2 = evalExact({ k: "pow", base: gVal(r), exp: gNum(2) });
  writer.write(`${left} = ${vLatex(r2)}`);
  void deps;
  const steps = writer.lines(MAX_STEPS);
  return { latex: steps[steps.length - 1], steps };
}

function gLatexName(name: string): string {
  return name.replace(/\\overline\{([A-Z]{2})\}/g, "$1").trim();
}
