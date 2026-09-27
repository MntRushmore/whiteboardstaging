/**
 * Geometry on the board: the maths a student writes beside a figure, solved and checked the way
 * a geometry teacher does — exact, in maths only.
 *
 *  - one line (`solveLine`, through `solveLatex`): angle equations in degrees, named angles and
 *    segments, the Pythagorean theorem (a length is positive), trig ratios for a side or an
 *    angle, the laws of sines and cosines, proportions (cross-multiplied), a formula with its
 *    values in (`A = \pi(5)^{2}` → `A = 25\pi`), a Pythagorean check (`169 = 169` / `85 \neq 81`);
 *  - several lines (`fromLines`, through `solveFromLines`): a formula under its known values
 *    (`r = 5`, `A = \pi r^{2}`, `A = ?`), named parts defined in x (`AB = 2x + 3`, `BC = 3x - 1`,
 *    `AB + BC = AC`), coordinates (`coordinates.ts`);
 *  - an expression (`simplify`, through `simplifySteps`): `\pi(5)^{2}`, `(8 - 2) \cdot 180^{\circ}`;
 *  - checking (`analyze`, first in `analyzeLine`): statements about figures are read, angle
 *    equations in degrees are compared as numbers of degrees, and a length's positive root is a
 *    right answer (`c = 13` under `5^{2} + 12^{2} = c^{2}` is not ringed).
 *
 * Everything algebra already does (a linear equation in x with plain numbers, a quadratic) is
 * left to it: this module claims a line only when it carries geometry (a degree sign, π, a root
 * or a trig value among the numbers, a named angle or segment, a Pythagorean shape, a
 * proportion). Every answer is checked numerically before it is returned.
 */
import type { MathNode } from "mathjs";
import type { AnalyzeContext, LineAnalysis } from "../contracts";
import { isTransformationLine, pointsOf, solveCoordinates, solveCoordinateLine, simplifyCoordinates, tupleOf, type CoordinateDeps } from "./coordinates";
import { solveEquationG, type EquationOptions } from "./geometryEquation";
import {
  evalExact,
  evalNumber,
  fromNode,
  gLatex,
  gSym,
  gVal,
  hasAbs,
  hasDegrees,
  hasPi,
  hasRoot,
  hasTrig,
  hasUnits,
  isClosed,
  NotGeometry,
  reduceOnce,
  someNode,
  substitute,
  symbolsOf,
  type G,
  type GPrint,
} from "./geometryExpr";
import { isAngleName, isFigureStatement, isGeometryName, isSegmentName, nameLatex } from "./geometryNotation";
import { decimalLatex, NoValue, NotExact, vHasPi, vHasRoot, vIsRational, vLatex, vNum, type Val } from "./geometryValue";
import { preprocessLatex, splitRelations, type Translated } from "./latex";
import { MAX_STEPS, StepWriter } from "./solution";

export interface GeometryDeps {
  translate(latex: string): Translated;
  parse(source: string): MathNode | null;
  /** the engine's one-line solver (algebra): a line with the degree signs gone, a cross-multiplied proportion */
  solveLatex(latex: string): { latex: string; steps: string[] } | null;
}

export interface Solved {
  latex: string;
  steps: string[];
}

export interface Geometry {
  /** `"refuse"`: a geometry line with nothing to write (the caller must not try other methods) */
  solveLine(latex: string): Solved | "refuse" | null;
  /** `"refuse"`: lines about named angles or segments with nothing to write (no other method may try) */
  fromLines(lines: readonly string[]): Solved | "refuse" | null;
  simplify(latex: string): string[] | null;
  /**
   * The relation (mathjs sources) is about a length — Pythagorean, a trig ratio, π, a named
   * segment, units — so its unknown's value is its positive root.
   */
  lengthRelation(lhs: string, rhs: string, variable: string): boolean;
  /** the exact value a closed expression with π or a root asks for (`\pi(5)^{2} =` → `25\pi`), else null */
  exactAnswer(latex: string): string | null;
  /** a geometry reading of the line for checking, or null for the ordinary rules */
  analyze(latex: string, ctx: AnalyzeContext, analyzeLine: (latex: string, ctx: AnalyzeContext) => LineAnalysis): LineAnalysis | null;
}

const keyOf = (s: string): string => s.replace(/\\left|\\right|\\,|\\ |\s|[{}]/g, "").replace(/\\cdot|\\times/g, "*");

/** `m\angle A` written by the student: the tutor answers in the same style. */
const measureStyle = (latex: string): boolean => /(^|[^a-zA-Z\\])m\s*\\(?:angle|measuredangle)/.test(latex);

export function createGeometry(deps: GeometryDeps): Geometry {
  /** One side (no relation) as a geometry tree; null when it is not one. */
  const tree = (latex: string): G | null => {
    try {
      const t = deps.translate(latex);
      if (t.hasText || t.hasPercent || t.hasPm || !t.source.trim()) return null;
      if (t.functions.some((f) => !["sin", "cos", "tan", "sec", "csc", "cot", "asin", "acos", "atan", "sqrt", "nthRoot", "abs", "cbrt"].includes(f))) return null;
      const node = deps.parse(t.source);
      if (!node) return null;
      return fromNode(node, { units: new Set(t.units.filter((u) => u !== "deg")) });
    } catch (e) {
      if (e instanceof NotGeometry || e instanceof NotExact) return null;
      return null;
    }
  };

  /** Two sides of a relation line (`=`, `\cong` between measures), or null. */
  const relation = (latex: string): { L: G; R: G; pre: string } | null => {
    const pre = preprocessLatex(latex);
    if (/\?/.test(pre)) return null;
    const split = splitRelations(pre);
    if (split.sides.length !== 2 || !(split.ops[0] === "==" || split.ops[0] === "~")) return null;
    if (split.ops[0] === "~" && !/\\cong/.test(pre)) return null;
    const L = tree(split.sides[0]);
    const R = tree(split.sides[1]);
    return L && R ? { L, R, pre } : null;
  };

  const printOpts = (latex: string, decimals: boolean): GPrint => ({ measure: measureStyle(latex), decimals });

  // ---------------------------------------------------------------- one line

  /** Every term a written square (`a^{2} + b^{2} = c^{2}` with numbers): the Pythagorean theorem. */
  const pythagorean = (L: G, R: G): boolean => {
    const terms = (g: G): G[] => (g.k === "add" ? g.items.map((i) => i.g) : [g]);
    const all = [...terms(L), ...terms(R)];
    const square = (g: G) => g.k === "pow" && g.exp.k === "val" && vNum(g.exp.v) === 2;
    return all.length >= 3 && all.every(square);
  };

  /** Geometry among the numbers: a degree sign, π, a root, a trig value, units, |…|. */
  const featured = (g: G): boolean => hasDegrees(g) || hasPi(g) || hasRoot(g) || hasTrig(g) || hasUnits(g) || hasAbs(g);

  /**
   * `\frac{x}{6} = \frac{8}{12}`, `\frac{P}{24} = \frac{5}{4}`, `\frac{A}{20} = \left(\frac{3}{2}\right)^{2}`:
   * a fraction with the unknown in one slot against another fraction (or a fraction's value) —
   * not against a whole number (`\frac{3}{x} = 6` is algebra's rational equation).
   */
  const proportion = (L: G, R: G, u: string): boolean => {
    const bare = (g: G) => (g.k === "paren" ? g.g : g);
    const fractionValue = (g: G) => {
      if (!isClosed(g)) return false;
      try {
        const v = evalExact(g);
        return vIsRational(v) && v.terms.length === 1 && v.terms[0].c.d !== 1;
      } catch {
        return false;
      }
    };
    for (const [a, b] of [
      [bare(L), bare(R)],
      [bare(R), bare(L)],
    ]) {
      if (a.k !== "div") continue;
      if (b.k === "div") return [a.num, a.den, b.num, b.den].filter((g) => symbolsOf(g).has(u)).length === 1;
      if (fractionValue(b)) return [a.num, a.den].filter((g) => symbolsOf(g).has(u)).length === 1;
    }
    return false;
  };

  const radiansIn = (g: G): boolean => someNode(g, (x) => x.k === "fn" && hasPi(x.arg));

  /** A capital or a named angle (`A`, `\angle B`): an angle of a triangle, answered by its principal value. */
  const triangleAngle = (u: string): boolean => /^[A-Z]$/.test(u) || isAngleName(u);

  const solveLine = (latex: string): Solved | "refuse" | null => {
    try {
      const coord = solveCoordinateLine(latex, coordinateDeps);
      if (coord) return coord;
      const rel = relation(latex);
      if (!rel) return null;
      const { L, R, pre } = rel;
      const symbols = new Set([...symbolsOf(L), ...symbolsOf(R)]);
      const decimals = /\d\.\d/.test(pre);
      const opts = printOpts(latex, decimals);
      if (symbols.size === 0) return checkLine(L, R, opts);
      if (symbols.size !== 1) return null;
      const u = [...symbols][0];
      const both = [L, R];
      const named = isGeometryName(u);
      const pyth = pythagorean(L, R);
      const features = both.some(featured);
      const prop = proportion(L, R, u);
      // a formula with its values in and a bracket to work out first (`A = \frac{1}{2}(8 + 12)(5)`)
      const filled = (L.k === "sym" && isClosed(R) ? R : R.k === "sym" && isClosed(L) ? L : null) as G | null;
      const bracketed = filled !== null && someNode(filled, (x) => x.k === "paren" && x.g.k === "add");
      if (!named && !pyth && !features && !prop && !bracketed) return null;
      // the unknown inside a trig ratio: `x` is a trig equation's (trigEquation.ts — a list over a
      // turn, or nothing); a capital, a named angle or a Greek letter is an angle of the figure
      if (/^[a-z]$/.test(u) && [L, R].some((s) => someNode(s, (g) => g.k === "fn" && symbolsOf(g).has(u)))) return null;
      const eq: EquationOptions = {
        ...opts,
        length: pyth || hasTrig(L) || hasTrig(R) || hasPi(L) || hasPi(R) || isSegmentName(u) || hasUnits(L) || hasUnits(R),
        radians: radiansIn(L) || radiansIn(R),
        triangleAngle: triangleAngle(u),
      };
      const out = solveEquationG(L, R, u, eq);
      // a named angle or segment the steps cannot take (or already an answer, `AB = 5`): nothing
      // — never the numeric root-finder, which would write the internal name (`angle_A = 50`)
      if (!out) return named ? "refuse" : null;
      // `\sin x = \frac{1}{2}` in x or θ at a special value is a trig EQUATION (every angle in a turn): trigEquation.ts's
      if (!eq.triangleAngle && /\\(?:sin|cos|tan)\^\{-1\}/.test(out.steps.join(" ")) && out.exact) return null;
      return { latex: out.final, steps: out.steps };
    } catch (e) {
      if (e instanceof NotGeometry || e instanceof NotExact || e instanceof NoValue) return null;
      return null;
    }
  };

  /** `5^{2} + 12^{2} = 13^{2}` → `25 + 144 = 169`, `169 = 169`; `6^{2} + 7^{2} = 9^{2}` → … `85 \neq 81`. */
  const checkLine = (L: G, R: G, opts: GPrint): Solved | null => {
    if (![L, R].some((g) => someNode(g, (x) => x.k === "pow" || x.k === "root" || x.k === "fn" || (x.k === "val" && (x.v.deg !== 0 || vHasPi(x.v)))))) return null;
    let l: Val;
    let r: Val;
    try {
      l = evalExact(L);
      r = evalExact(R);
    } catch {
      return null;
    }
    const equal = Math.abs(vNum(l) - vNum(r)) <= 1e-9 * Math.max(1, Math.abs(vNum(l)), Math.abs(vNum(r)));
    const rel = equal ? "=" : "\\neq";
    const writer = new StepWriter(keyOf, `${gLatex(L, opts)} ${rel} ${gLatex(R, opts)}`);
    let a = L;
    let b = R;
    for (let guard = 0; guard < 12; guard++) {
      const na = reduceOnce(a);
      const nb = reduceOnce(b);
      if (!na && !nb) break;
      a = na ?? a;
      b = nb ?? b;
      writer.write(`${gLatex(a, opts)} ${rel} ${gLatex(b, opts)}`, true);
    }
    const steps = writer.lines(MAX_STEPS);
    if (steps.length === 0) return null;
    return { latex: steps[steps.length - 1], steps };
  };

  // ---------------------------------------------------------------- an expression

  const simplify = (latex: string): string[] | null => {
    try {
      const coord = simplifyCoordinates(latex, coordinateDeps);
      if (coord) return coord;
      const pre = preprocessLatex(latex).replace(/=\s*$/, "").trim();
      if (!pre || splitRelations(pre).ops.length > 0) return null;
      const g = tree(pre);
      if (!g || !isClosed(g) || !(hasDegrees(g) || hasPi(g) || hasRoot(g) || hasAbs(g))) return null;
      const opts = printOpts(latex, /\d\.\d/.test(pre));
      const writer = new StepWriter(keyOf, pre);
      let cur = g;
      for (let guard = 0; guard < 16; guard++) {
        const next = reduceOnce(cur);
        if (!next) break;
        cur = next;
        writer.write(gLatex(cur, opts), true);
      }
      // not exact (`\sin 20^{\circ}`): the calculator's decimal stays the answer (`localAnswerFor`)
      if (cur.k !== "val") return null;
      if (opts.decimals && (vHasPi(cur.v) || vHasRoot(cur.v))) writer.write(`\\approx ${decimalLatex(vNum(cur.v))}`);
      const lines = writer.lines(MAX_STEPS);
      if (lines.length === 0) return null;
      // the value checked against the expression as written
      const want = evalNumber(g).n;
      const got = cur.k === "val" ? vNum(cur.v) : evalNumber(cur).n;
      if (!(Math.abs(want - got) <= 1e-9 * Math.max(1, Math.abs(want)))) return null;
      return lines.map((l) => (l.startsWith("\\approx") ? l : `= ${l}`));
    } catch {
      return null;
    }
  };

  // ---------------------------------------------------------------- several lines

  const coordinateDeps: CoordinateDeps = {
    tree,
    relation: (latex) => relation(latex),
    solveEquation: (L, R, u, opts) => solveEquationG(L, R, u, opts),
  };

  const fromLines = (lines: readonly string[]): Solved | "refuse" | null => {
    try {
      const coord = solveCoordinates(lines, coordinateDeps);
      if (coord) return coord;
      return formulaFromLines(lines);
    } catch {
      return null;
    }
  };

  /** `x = ?`, `AB = ?`, `\angle C =`, `m\angle C = ?`: the quantity asked for. */
  const question = (latex: string): string | null => {
    const s = preprocessLatex(latex).replace(/\\text\s*\{\s*\?\s*\}/g, "?").trim();
    const m = /^(.+?)=\s*\??\s*$/.exec(s);
    if (!m || /=/.test(m[1])) return null;
    const g = tree(m[1]);
    return g && g.k === "sym" ? g.name : null;
  };

  /**
   * A formula under (or above) its known values, and parts defined in another unknown:
   *
   *   r = 5                AB = 2x + 3        m\angle 1 = 3x + 10
   *   A = \pi r^{2}        BC = 3x - 1        m\angle 2 = 5x - 30
   *   A = ?                AC = 22            m\angle 1 = m\angle 2
   *   ─────────            AB + BC = AC       ─────────
   *   A = \pi(5)^{2}       ─────────          3x + 10 = 5x - 30
   *   A = 25\pi            (2x + 3) + (3x - 1) = 22   …   x = 20
   */
  const formulaFromLines = (lines: readonly string[]): Solved | "refuse" | null => {
    let want: string | null = null;
    let named = false;
    const known = new Map<string, { g: G; v: Val }>();
    const defs = new Map<string, G>();
    const facts: Array<{ L: G; R: G; latex: string }> = [];
    let geometric = false;
    const decimals = lines.some((l) => /\d\.\d/.test(l));
    const opts = printOpts(lines.join(" "), decimals);
    for (const raw of lines) {
      if (!raw || !raw.trim()) continue;
      const q = question(raw);
      if (q) {
        want = q;
        if (isGeometryName(q)) geometric = true;
        continue;
      }
      const rel = relation(raw);
      if (!rel) continue;
      const { L, R } = rel;
      const syms = new Set([...symbolsOf(L), ...symbolsOf(R)]);
      if ([L, R].some(featured) || [...syms].some(isGeometryName)) geometric = true;
      // `r = 5`, `\angle A = 50^{\circ}`: a known value
      const lone = L.k === "sym" && isClosed(R) ? { name: L.name, g: R } : R.k === "sym" && isClosed(L) ? { name: R.name, g: L } : null;
      if (lone) {
        try {
          known.set(lone.name, { g: lone.g, v: evalExact(lone.g) });
          continue;
        } catch {
          // a known the tutor cannot write exactly stays a fact
        }
      }
      // `AB = 2x + 3`: a part defined in another unknown (not `\angle 1 = \angle 2`, a fact about two parts)
      const rs = [...symbolsOf(R)];
      if (L.k === "sym" && rs.length >= 1 && !rs.includes(L.name) && !rs.some(isGeometryName)) defs.set(L.name, R);
      facts.push({ L, R, latex: raw });
    }
    if (facts.length === 0) return null;
    if ([...defs.keys(), ...known.keys(), ...(want ? [want] : [])].some(isGeometryName)) named = true;
    // the formula: the latest fact that, with the knowns in, has one unknown left (the one asked for)
    for (let i = facts.length - 1; i >= 0; i--) {
      const f = facts[i];
      const own = new Set([...symbolsOf(f.L), ...symbolsOf(f.R)]);
      const values = new Map<string, G>();
      for (const [name, k] of known) if (own.has(name)) values.set(name, bracket(k.g));
      // parts defined in x, when the fact is about the parts (`AB + BC = AC`)
      const usedDefs: string[] = [];
      for (const [name, g] of defs) {
        if (!own.has(name) || values.has(name) || facts[i].L === gSym(name)) continue;
        if (f.L.k === "sym" && f.L.name === name && defs.get(name) === f.R) continue;
        values.set(name, bracket(g));
        usedDefs.push(name);
      }
      if (values.size === 0) continue;
      // a whole side substituted needs no bracket: `3x + 10 = 5x - 30`
      const whole = (g: G): G => (g.k === "paren" ? g.g : g);
      const L = whole(substitute(f.L, values));
      const R = whole(substitute(f.R, values));
      const left = new Set([...symbolsOf(L), ...symbolsOf(R)]);
      if (left.size !== 1) continue;
      const u = [...left][0];
      // the unknown asked for is this one, or a part defined in it (`AB = ?` with `AB = 2x + 3`)
      const target = want && want !== u ? (defs.has(want) && symbolsOf(defs.get(want)!).has(u) ? want : null) : want;
      if (want && target === null && !(known.has(want) || want === u)) continue;
      const power = someNode(L, (x) => x.k === "pow" && x.base.k === "sym" && x.base.name === u) || someNode(R, (x) => x.k === "pow" && x.base.k === "sym" && x.base.name === u);
      // plain algebra (`l = w + 3`, `l \cdot w = 40`; `y = x`, `x^{2} + y^{2} = 4`) is the systems
      // solver's; a formula whose known values leave a power of a length (`A = s^{2}`, `A = 49`) is ours
      // … and so is one in subscripted names (`A_{2} = k^{2} A_{1}`), which the systems solver cannot substitute
      const subscripted = usedDefs.length === 0 && [...values.keys(), u].some((n) => n.includes("_"));
      if (!geometric && !(power && usedDefs.length === 0) && !subscripted) return null;
      const writer = new StepWriter(keyOf, f.latex);
      writer.write(`${gLatex(L, opts)} = ${gLatex(R, opts)}`);
      const eq: EquationOptions = { ...opts, length: true, triangleAngle: /^[A-Z]$/.test(u) || isAngleName(u), radians: someNode(L, (x) => x.k === "fn" && hasPi(x.arg)) };
      const solved = solveEquationG(L, R, u, eq) ?? viaAlgebra(L, R, opts);
      if (!solved) continue;
      writer.writeAll(solved.steps);
      let finalLine = solved.steps[solved.steps.length - 1];
      if (target && target !== u) {
        // the part asked for, from its definition with the unknown's value in
        const value = solved.exact;
        if (!value) continue;
        const part = substitute(defs.get(target)!, new Map([[u, bracket(gVal(value))]]));
        const name = gLatex(gSym(target), opts);
        writer.write(`${name} = ${gLatex(part, opts)}`);
        let cur = part;
        for (let guard = 0; guard < 12; guard++) {
          const next = reduceOnce(cur);
          if (!next) break;
          cur = next;
          writer.write(`${name} = ${gLatex(cur, opts)}`, cur.k !== "val");
        }
        if (cur.k !== "val") continue;
        finalLine = `${name} = ${gLatex(cur, opts)}`;
      }
      const steps = writer.lines(MAX_STEPS);
      if (steps[steps.length - 1] !== finalLine) continue;
      return { latex: finalLine, steps };
    }
    // named angles and segments the formula path cannot take: nothing, never the systems solver's
    // lines (which would write the internal names, `angle_1 - 5x = -30`)
    return named ? "refuse" : null;
  };

  /** A substituted equation in plain numbers (`2x + 3 + 3x - 1 = 22`): the algebra module's steps. */
  const viaAlgebra = (L: G, R: G, opts: GPrint): { steps: string[]; exact: Val | null } | null => {
    const line = `${gLatex(L, opts)} = ${gLatex(R, opts)}`;
    const solved = deps.solveLatex(line);
    if (!solved) return null;
    const m = /^([a-zA-Z])\s*=\s*(.+)$/.exec(solved.latex);
    let exact: Val | null = null;
    if (m) {
      const g = tree(m[2]);
      try {
        exact = g ? evalExact(g) : null;
      } catch {
        exact = null;
      }
    }
    return { steps: solved.steps, exact };
  };

  // ---------------------------------------------------------------- checking

  const analyze = (latex: string, ctx: AnalyzeContext, analyzeLine: (latex: string, ctx: AnalyzeContext) => LineAnalysis): LineAnalysis | null => {
    try {
      const pre = preprocessLatex(latex);
      const label: LineAnalysis = { kind: "label", math: "", resultLatex: "", verdict: "none", note: "" };
      if (isFigureStatement(pre)) return label;
      // a figure's name alone (`\odot O`, `\triangle ABC`), a transformation's rule or notation, a
      // circle's centre and radius: read, nothing to compute or ring
      if (/^\\(?:odot|triangle|square)\s*\{?\s*[A-Z](?:\s*[A-Z]){0,4}\s*\}?$/.test(pre) || isTransformationLine(pre) || /^\(\s*h\s*,\s*k\s*\)\s*=/.test(pre.replace(/\\left|\\right/g, ""))) return label;
      const point = pointReading(pre, ctx);
      if (point) return point;
      // `6^{2} + 7^{2} \stackrel{?}{=} 9^{2}`: a question, not a claim — never ringed
      if (/\\(?:stackrel|overset)\s*\{\s*\?\s*\}/.test(latex)) {
        const a = analyzeLine(pre, ctx);
        return a.verdict === "mismatch" ? { ...a, verdict: "none" } : a;
      }
      const stripped = degreeFree(pre, ctx);
      if (stripped !== null) return analyzeLine(stripped, ctx);
      return null;
    } catch {
      return null;
    }
  };

  /**
   * `A(1, 2), \ B(4, 6)`, `(1, 2)`, `M = \left(\frac{5}{2}, 4\right)`: points. A named point worked
   * out under the same name on the line above (`M = (\frac{1 + 4}{2}, …)` → `M = (\frac{5}{2}, 4)`)
   * is ticked or ringed by value.
   */
  const pointReading = (pre: string, ctx: AnalyzeContext): LineAnalysis | null => {
    const out = (name: string | null, x: number, y: number): LineAnalysis => {
      const reading: LineAnalysis = { kind: "point", math: `[${x}, ${y}]`, resultLatex: "", verdict: "none", note: "", ...(name ? { variable: name } : {}) };
      const prev = ctx.previous;
      if (name && prev?.kind === "point" && prev.variable === name && prev.math) {
        const [px, py] = JSON.parse(prev.math) as number[];
        reading.verdict = Math.abs(px - x) < 1e-9 && Math.abs(py - y) < 1e-9 ? "ok" : "mismatch";
      }
      return reading;
    };
    const list = pointsOf(pre, coordinateDeps);
    if (list) return out(list.length === 1 ? list[0].name : null, vNum(list[0].xv), vNum(list[0].yv));
    const m = /^([A-Z](?:_\{?\d\}?)?)\s*=\s*((?:\\left\s*)?\([\s\S]*\)(?:\\right\s*\))?)$/.exec(pre);
    const body = m ? tupleOf(m[2], coordinateDeps) : null;
    if (!m || !body) return null;
    try {
      return out(m[1].replace(/[{}]/g, ""), vNum(evalExact(body[0])), vNum(evalExact(body[1])));
    } catch {
      return null;
    }
  };

  /** The value `\pi(5)^{2} =` asks for, exact when it has π or a root in it (`25\pi`, `6\sqrt{2}`); null otherwise. */
  const exactAnswer = (latex: string): string | null => {
    try {
      const pre = preprocessLatex(latex).replace(/=\s*$/, "").trim();
      if (!pre || splitRelations(pre).ops.length > 0) return null;
      const g = tree(pre);
      if (!g || !isClosed(g)) return null;
      const v = evalExact(g);
      if (!(vHasPi(v) || vHasRoot(v))) return null;
      // `\sqrt{2} =` asks for its decimal: the exact value would only write the question again
      return keyOf(vLatex(v)) === keyOf(pre) ? null : vLatex(v);
    } catch {
      return null;
    }
  };

  /**
   * An angle equation in degrees (`x + 35^{\circ} + 75^{\circ} = 180^{\circ}`, `x = 70^{\circ}`),
   * compared as numbers of degrees: the line without its degree signs. Null when the line has
   * none, has a trig ratio (its degrees are an angle's), or answers a trig equation above.
   */
  const degreeFree = (pre: string, ctx: AnalyzeContext): string | null => {
    const DEG = /\^\s*\{?\s*\\circ\s*\}?|\\degree(?![a-zA-Z])/g;
    if (!DEG.test(pre)) return null;
    if (/\\(?:sin|cos|tan|sec|csc|cot|arcsin|arccos|arctan)(?![a-zA-Z])/.test(pre)) return null;
    if (!/[=<>]/.test(pre)) return null;
    const trigAbove = [ctx.previous?.math, ctx.original?.math].some((m) => m && /\b(?:sin|cos|tan|sec|csc|cot)\(/.test(m));
    if (trigAbove) return null;
    return pre.replace(DEG, "").replace(/\s+/g, " ").trim();
  };

  const lengthRelation = (lhs: string, rhs: string, variable: string): boolean => {
    try {
      const a = deps.parse(lhs);
      const b = deps.parse(rhs);
      if (!a || !b) return false;
      const L = fromNode(a);
      const R = fromNode(b);
      return pythagorean(L, R) || hasTrig(L) || hasTrig(R) || hasPi(L) || hasPi(R) || isSegmentName(variable);
    } catch {
      return false;
    }
  };

  return { solveLine, fromLines, simplify, analyze, lengthRelation, exactAnswer };
}

/** A substituted value in brackets where the student would write them: `(2x + 3)`, `(-3)`; a number is bracketed by the printer where it needs one (`\pi(5)^{2}`). */
function bracket(g: G): G {
  if (g.k === "add" || g.k === "neg" || (g.k === "val" && vNum(g.v) < 0)) return { k: "paren", g };
  return g;
}

export { nameLatex, vLatex };
