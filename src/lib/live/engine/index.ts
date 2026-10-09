/**
 * Local STEM engine (WP-B). `getEngine()` loads mathjs once and resolves the real `LiveEngine`.
 * Pure TypeScript: no DOM, no React, no tldraw. Every entry point catches and degrades to
 * kind 'unknown' / verdict 'unknown' / null — the engine never throws.
 */
import type { MathJsInstance, MathNode } from "mathjs";
import type { AnalyzeContext, EngineVerdict, LineAnalysis, LineDomain, LiveEngine, SolveOptions } from "../contracts";
import { balance as balanceChem, balanceEquation, equationLatex, isBalanced, molarMassLatex, normalizeChemText, parseEquation, looksLikeChemEquation } from "./chem";
import { preClassify } from "./classify";
import { PHYSICS_SCOPE_NAMES, physicsScope } from "./constants";
import {
  compareMultiRelations,
  compareRelations,
  compareValuesToRelation,
  decimalsIn,
  equationRoots,
  expressionsEquivalent,
  parseRelation,
  rootToNumber,
  satisfies,
  snapToRoots,
  solvesRelation,
  type Relation,
  type RootValue,
} from "./equivalence";
import { asSmallFraction, complexToLatex, formatNumberLatex, shortExactDecimal, nodeToLatex, valueToLatex, type NumberFormatOptions } from "./format";
import { compileExpr, plotFor } from "./graph";
import { createGraphIntent } from "./graphIntent";
import { APPROX_OP, latexToMath, preprocessLatex, splitRelations, UnsupportedLatex, type Translated } from "./latex";
import { countOperations, createMathInstance, integralsExact, isComplexValue, isNodeValue, isUnitValue, safeEvaluate, safeParse, toNumber, translate, type MathModule } from "./math";
import { evaluateUnits, unitValueToLatex, valuesMatch } from "./units";
import { solveFromLines, substituteLatex, type SystemDeps } from "./systems";
import { combineTerms, linearSolveSteps, simplifyExpressionSteps, standardOrder, termsLatex, termsOf, type LinearSteps, type RelOp } from "./algebra";
import { createCalculus } from "./calculus";
import { createIntegration } from "./integration";
import { createLimits } from "./limits";
import { createTrig } from "./trig";
import { solveTrigEquation } from "./trigEquation";
import { solveAdvanced, solveExactly, type AdvancedDeps } from "./advanced";
import { factorExpressionSteps, rationalExpressionSteps } from "./polynomial";
import { hasFunctionCall } from "./functionNotation";
import { chainRelation, isSolutionSet, relaxVerdict, splitAtCommas, unionRelation, type Part } from "./compound";
import { ALL_REALS, EVERY_REAL, LIST_SEP, NO_SOLUTION } from "./solution";
import { createCourses } from "./courses";
import { createGeometry } from "./geometry";
import { isGeometryName } from "./geometryNotation";
import { judgeOperation, operandMath, parseOperationLine, plainRelation } from "./operationLine";
import { linearRelation, operationResult } from "./operationResult";
import { domainChain, isTrigLine, parseDomainPiece, splitDomain, type DomainBounds } from "./domain";
import { judgePrimaryLine } from "./primaryWork";

const UNKNOWN: LineAnalysis = { kind: "unknown", math: "", resultLatex: "", verdict: "unknown", note: "" };

/** An inverse trig call in a mathjs source: its value is in radians. */
const INVERSE_TRIG = /\ba(?:sin|cos|tan|sec|csc|cot)\(/;

/** Kinds a domain is carried down the column on (the lines the next line is checked against). */
const SILENT_FOR_DOMAIN: ReadonlySet<LineAnalysis["kind"]> = new Set(["label", "incomplete", "text", "unknown"]);

/** The note on an answer outside the problem's interval (shown with the line's readback). */
export const OUTSIDE_DOMAIN_NOTE = "Outside the interval";

function insideDomain(d: LineDomain, v: number): boolean {
  const eps = 1e-9 * Math.max(1, Math.abs(v));
  return (v > d.lo + eps || (d.loIn && Math.abs(v - d.lo) <= eps)) && (v < d.hi - eps || (d.hiIn && Math.abs(v - d.hi) <= eps));
}

function sameDomain(a: LineDomain, b: LineDomain): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  return a.variable === b.variable && near(a.lo, b.lo) && near(a.hi, b.hi) && a.loIn === b.loIn && a.hiIn === b.hiIn;
}

/** The same values, each once, as the domain's solutions (to 1e-6). */
function sameValueSet(values: readonly number[], solutions: readonly number[]): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(y));
  return values.every((v) => solutions.some((s) => near(v, s))) && solutions.every((s) => values.some((v) => near(v, s)));
}

/** Notes attached to parsed chemical equations (the shape renders `Balanced…` notes as a secondary line). */
export const CHEM_BALANCED_NOTE = "Balanced";
export const CHEM_UNBALANCED_NOTE = "Count the atoms on each side";

function base(kind: LineAnalysis["kind"], math = "", verdict: EngineVerdict = "none"): LineAnalysis {
  return { kind, math, resultLatex: "", verdict, note: "" };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function normalizeLatex(s: string): string {
  return s.replace(/\\,|\\;|\\!|\\ |~/g, "").replace(/\\mathrm|\\text|\\left|\\right|[{}\s]/g, "");
}

/** Two step lines are the same line: `\leq` is `\le`, `2 \cdot x` is `2x`, spacing never counts. */
function stepKey(s: string): string {
  return normalizeLatex(
    s
      .replace(/\\leqslant|\\leq\b/g, "\\le")
      .replace(/\\geqslant|\\geq\b/g, "\\ge")
      .replace(/\\lt\b/g, "<")
      .replace(/\\gt\b/g, ">")
      .replace(/\\cdot|\\times|\*/g, ""),
  );
}

const REL_OPS: ReadonlySet<string> = new Set(["==", "<", ">", "<=", ">="]);
const isRelOp = (op: string | undefined): op is RelOp => op !== undefined && REL_OPS.has(op);

const TRIG = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "asin", "acos", "atan", "sinh", "cosh", "tanh"]);

/**
 * Calculus/aggregate calls the engine evaluates even when the line still mentions a variable:
 * `\frac{d}{dx} x^3` is an answerable line whose answer contains x.
 */
const SYMBOLIC_FUNCTIONS: ReadonlySet<string> = new Set(["derivative", "integral", "summation", "antiderivative"]);
/** Calculus the engine may be unable to do (`calculus.ts`): refused as `unknown`, never "keep writing". */
const REFUSABLE_CALCULUS: ReadonlySet<string> = new Set(["limit", "antiderivative"]);

function isSymbolic(t: Translated): boolean {
  return t.functions.some((f) => SYMBOLIC_FUNCTIONS.has(f));
}

/** `\frac{dy}{dx}`, `\frac{d\theta}{dt}` — the function name and the variable it varies with. */
const LEIBNIZ = /\\frac\s*\{\s*(?:\\mathrm\s*\{\s*d\s*\}|d)\s*([a-zA-Z])\s*\}\s*\{\s*(?:\\mathrm\s*\{\s*d\s*\}|d)\s*([a-zA-Z])\s*\}/;
/** `f'(x)`, `y'` — the function name and, when written, the variable. */
const PRIME = /(^|[^a-zA-Z\\])([a-zA-Z])\s*(?:'|\\prime|\^\{?\\prime\}?)\s*(?:\(\s*([a-zA-Z])\s*\))?/;

/**
 * `exactIntegral` is true when every integral on the line was integrated exactly (a polynomial
 * over rational limits): only then may `\int_0^1 x^2 dx` be shown as `\frac{1}{3}` instead of a
 * 4-significant-figure decimal. A Simpson approximation is never dressed up as an exact value.
 */
function formatOptions(t: Translated, latex: string, exactIntegral: boolean): NumberFormatOptions {
  const decimals = /\d\.\d/.test(latex);
  const trig = t.functions.some((f) => TRIG.has(f));
  const numeric = t.functions.includes("integral") && !exactIntegral;
  return {
    preferFraction: !decimals && !t.hasDegrees && !trig && !t.hasUnits && !numeric && !t.hasPercent,
    // plain arithmetic in decimals is exact (`1234.5 + 1 = 1235.5`); measurements keep 4 s.f.
    exactDecimals: !t.hasUnits && !trig && !numeric && !t.hasDegrees,
  };
}

function rootLatex(r: RootValue, opts: NumberFormatOptions = { preferFraction: true }): string {
  const n = rootToNumber(r);
  if (n !== null) return formatNumberLatex(n, opts);
  return complexToLatex(r as { re: number; im: number }, opts);
}

/** Splits `2, -2` / `2 \text{ or } -2` / `x = 2 \text{ or } x = -2` into value LaTeX fragments. */
function splitValueList(rhsLatex: string, variable: string): string[] {
  // `2, \ -2`: the space after a list comma is the tutor's own separator, not part of a value
  const s = rhsLatex.replace(/,\s*\\ /g, ", ").replace(/\\text\s*\{\s*or\s*\}|\\quad|\\;|\\,|\bor\b/g, ",");
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.replace(new RegExp(`^${variable}\\s*=\\s*`), "").trim())
    .filter(Boolean);
}

/** `x = 2 \text{ or } x = -2`, `x = 2, x = -2`, `x_1 = 2, x_2 = -2` -> { variable, values } */
function solutionList(latex: string): { variable: string; values: string[] } | null {
  // `x = 2, \ x = 3` (the tutor's own answer lines) as well as `x = 2 \text{ or } x = 3`
  const s = latex.replace(/,\s*\\ /g, ", ").replace(/\\text\s*\{\s*(?:or|and)\s*\}|\\quad|\\qquad|\\;|\bor\b/g, ",");
  if (!s.includes(",")) return null;
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  let variable = "";
  const values: string[] = [];
  for (const part of parts) {
    const m = /^([a-zA-Z])(?:_\{?\d\}?)?\s*=\s*([^=]+)$/.exec(part);
    if (!m) return null;
    if (variable && m[1] !== variable) return null;
    variable = m[1];
    values.push(m[2].trim());
  }
  return { variable, values };
}

function relationFromAnalysis(math: MathJsInstance, a: LineAnalysis | undefined, variable?: string): Relation | null {
  if (!a || !a.math) return null;
  if (a.kind !== "equation" && a.kind !== "inequality") return null;
  const rel = parseRelation(math, a.math);
  if (!rel) return null;
  const own = a.variable ?? (rel.variables.length === 1 ? rel.variables[0] : undefined);
  if (!own || !rel.variables.includes(own)) return null;
  if (variable && own !== variable) return null;
  return rel;
}

/**
 * The previous line as an equation in two or more unknowns: an `equation` whose relation has
 * several free symbols, or a `y = ...` line (kind `function`) read as the equation `y == ...`.
 */
function multiRelationFromAnalysis(math: MathJsInstance, a: LineAnalysis | undefined): Relation | null {
  if (!a || !a.math) return null;
  if (a.kind === "equation") {
    const rel = parseRelation(math, a.math);
    return rel && rel.op === "==" && new Set(rel.variables).size >= 2 ? rel : null;
  }
  if (a.kind === "function" && a.math.startsWith("y = ")) {
    const rhs = a.math.slice(4);
    const rel = parseRelation(math, `y == ${rhs}`);
    return rel && new Set(rel.variables).size >= 2 ? rel : null;
  }
  return null;
}

/**
 * A number written exactly for a line in decimals: a terminating decimal with at most 6 places
 * as itself (`2315.25`, `3.75`), anything else as an exact fraction (`\frac{1}{3}`) — never
 * rounded to the display precision, which silently wrote `1234.5 + 1` as `1236`.
 */
export function exactDecimalLatex(n: number): string {
  if (!Number.isFinite(n)) return formatNumberLatex(n);
  return shortExactDecimal(n) ?? formatNumberLatex(n, { preferFraction: true });
}

export function createEngine(mod: MathModule): LiveEngine {
  const math = createMathInstance(mod);

  const tr = (latex: string, plain = false): Translated => translate(math, latex, { plain });
  // derivatives, integrals and limits with teacher-style steps; registers limit/antiderivative/bracketEval on `math`
  // substitution, parts, identities, standard forms, partial fractions (`integration.ts`), tried
  // when the term-by-term rules have nothing; they use those rules for the inner integral
  const integration = createIntegration(() => ({ basic: (f, x) => calculus.basicIntegral(f, x) }));
  // 0/0 beyond factorising: the conjugate, L'Hôpital (`limits.ts`)
  const limits = createLimits();
  const calculus = createCalculus(math, {
    translate: (latex) => tr(latex),
    integrate: (f, x, constant) => integration.integrate(f, x, constant),
    integrateDefinite: (f, x, a, b) => integration.integrateDefinite(f, x, a, b),
    limit: (operand, x, a, prefix) => limits.limit(operand, x, a, prefix),
  });
  // exact trig values, identities and equations (`trig.ts`, `trigEquation.ts`)
  const trig = createTrig(math, { translate: (latex) => tr(latex) });
  // what to graph for a column of work (`graphIntent.ts`): the maths of the tutor's sketch
  const graphing = createGraphIntent(math, { translate: (latex) => tr(latex) });
  // Algebra 1 / Algebra 2 methods (`courses.ts`): asked first at the hooks below, never instead of a path they do not own
  const courses = createCourses({
    math,
    translate: (latex) => translate(math, latex, { letterUnits: false }),
    normalize: (latex) => stepKey(latex),
    solveOne: (latex) => solveLatex(latex),
  });
  // the maths of a figure: angles in degrees, named angles and segments, Pythagoras, trig ratios,
  // formulas with their values, coordinates (`geometry.ts`)
  const geometry = createGeometry({ translate: (latex) => tr(latex), parse: (source) => safeParse(math, source), solveLatex: (latex) => solveLatex(latex) });

  const evaluateTranslated = (t: Translated, latex: string): { value: unknown; latex: string; ok: boolean; note: string; error?: string } => {
    const exact = t.functions.includes("integral") && integralsExact(math, t.source);
    const opts = formatOptions(t, latex, exact);
    const scope = t.hasUnits ? physicsScope(math) : undefined;
    if (t.hasUnits) {
      const ev = evaluateUnits(math, t.source, scope, opts);
      return { value: ev.value, latex: ev.latex, ok: ev.ok, note: ev.note, error: ev.error };
    }
    const res = safeEvaluate(math, t.source, scope);
    if (!res.ok) return { value: undefined, latex: "", ok: false, note: "", error: res.error };
    const v = res.value;
    const out = isUnitValue(v) ? unitValueToLatex(math, v, opts) : isNodeValue(v) ? nodeToLatex(v) : valueToLatex(v, opts);
    return { value: v, latex: out, ok: true, note: "" };
  };

  /** effective unknowns: physics constant letters do not count on lines that carry units */
  const unknownsOf = (t: Translated): string[] => t.variables.filter((v) => !(t.hasUnits && PHYSICS_SCOPE_NAMES.has(v)));

  const shouldShowResult = (t: Translated, latex: string, resultLatex: string): boolean => {
    if (!resultLatex) return false;
    const ops = countOperations(t.source);
    const conversion = /\bto\b/.test(t.source);
    // `15% of 80` is worth answering (>= 2 operations once `%` became /100); a bare `50%` is not
    const percentOf = t.hasPercent && ops >= 2;
    const interesting = t.hasUnits || t.constants.length > 0 || t.functions.length > 0 || ops >= 3 || conversion || percentOf;
    if (!interesting) return false;
    if (t.hasUnits && ops === 0 && !conversion && t.functions.length === 0) return false;
    if (normalizeLatex(resultLatex) === normalizeLatex(latex)) return false;
    return true;
  };

  // --- expressions ---------------------------------------------------------
  const analyzeExpression = (latex: string, ctx: AnalyzeContext, trailingEquals: boolean): LineAnalysis => {
    const t = tr(latex);
    if (!t.source.trim()) return t.hasText ? base("text") : base("incomplete");
    const unknowns = unknownsOf(t);
    const symbolic = isSymbolic(t);
    if (unknowns.length === 0 || symbolic) {
      const ev = evaluateTranslated(t, latex);
      if (!ev.ok && t.functions.some((f) => REFUSABLE_CALCULUS.has(f))) return { ...UNKNOWN, error: ev.error };
      // the calculus answer as the steps end (`6x + 2`, `\ln 2`, `\frac{x^{3}}{3} + C`), not mathjs's rendering
      const exact = ev.ok && t.functions.length > 0 ? calculus.resultLatex(t.source) : null;
      if (exact) ev.latex = exact;
      // `\sin 60^{\circ}` is `\frac{\sqrt{3}}{2}`, not 0.866; `\tan 90^{\circ}` has no value (not 1.633 × 10¹⁶)
      const trigValue = !exact && ev.ok && t.functions.length > 0 ? trig.value(t.source) : null;
      if (trigValue?.kind === "exact") ev.latex = trigValue.latex;
      if (trigValue?.kind === "undefined") ev.ok = false;
      const out: LineAnalysis = { kind: "expression", math: t.source, resultLatex: "", verdict: "none", note: ev.note };
      if (t.hasUnits) out.units = { ok: ev.ok };
      if (ev.error) out.error = ev.error;
      if (ev.ok) {
        // `\pi(5)^{2} =` is `25\pi`, as Solve writes it (`geometry.ts`), not its decimal
        if (trailingEquals) out.resultLatex = ctx.mode === "answer" ? ((!exact && trigValue?.kind !== "exact" ? geometry.exactAnswer(latex) : null) ?? ev.latex) : "";
        else if (symbolic || shouldShowResult(t, latex, ev.latex)) out.resultLatex = ev.latex;
      }
      const prev = ctx.previous;
      if (prev && prev.kind === "expression" && prev.math && unknowns.length === 0 && !symbolic) {
        const cmp = expressionsEquivalent(math, prev.math, t.source, []);
        out.verdict = cmp === "ok" ? "ok" : "none";
      }
      return out;
    }
    const out: LineAnalysis = { kind: "expression", math: t.source, resultLatex: "", verdict: "none", note: "" };
    const prev = ctx.previous;
    if (prev && prev.kind === "expression" && prev.math) {
      const prevVars = safeVars(prev.math);
      if (prevVars && sameSet(prevVars, unknowns)) out.verdict = expressionsEquivalent(math, prev.math, t.source, unknowns);
    }
    return out;
  };

  const safeVars = (source: string): string[] | null => {
    try {
      const node = math.parse(source);
      const names: string[] = [];
      node.traverse((n, path, parent) => {
        if (n.type === "SymbolNode" && !(parent && parent.type === "FunctionNode" && path === "fn")) {
          const name = (n as { name?: string }).name ?? "";
          if (name && !names.includes(name) && !["e", "pi", "i", "Infinity"].includes(name) && !math.Unit.isValuelessUnit(name)) names.push(name);
        }
      });
      return names;
    } catch {
      return null;
    }
  };

  const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

  // --- relations -----------------------------------------------------------
  const analyzeRelation = (latex: string, ctx: AnalyzeContext): LineAnalysis => {
    const split = splitRelations(latex);
    const lastImplication = split.ops.lastIndexOf("=>");
    if (lastImplication !== -1) {
      const tail = split.sides.slice(lastImplication + 1).join(" = ");
      return analyzeRelation(tail, ctx);
    }
    const { sides } = split;
    const loose = split.ops.includes(APPROX_OP);
    const ops = split.ops.map((op) => (op === APPROX_OP ? "==" : op));
    if (sides.some((s) => !s.trim())) return base("incomplete");
    // f(2) = 4 style function evaluations are for the LLM
    if (sides.some((side) => /(^|[^a-zA-Z\\])[fgh]\s*(?:\\left)?\(\s*-?[0-9.]+\s*(?:\\right)?\)/.test(side))) {
      return { kind: "equation", math: "", resultLatex: "", verdict: "unknown", note: "" };
    }
    const raw = sides.map((s) => tr(s));
    // `\int 2x \, dx = x^2 + C`: checked by differentiating the right-hand side
    const antiderivativeClaim = calculus.claimVerdict(
      raw.map((t) => t.source),
      ops,
    );
    if (antiderivativeClaim) return { kind: "equation", math: raw.map((t) => t.source).join(" == "), resultLatex: "", verdict: antiderivativeClaim, note: "" };
    const ts = raw.map(resolveSymbolicSide);
    /** a side was a derivative/integral: the line claims a result, which is checked on its own */
    const claim = ts.some((t, i) => t !== raw[i]);
    const unknowns = [...new Set(ts.flatMap(unknownsOf))];
    const anyUnits = ts.some((t) => t.hasUnits);
    const allEqual = ops.every((op) => op === "==");
    const source = ts.map((t) => t.source).reduce((acc, s, i) => (i === 0 ? s : `${acc} ${ops[i - 1]} ${s}`), "");

    if (allEqual && unknowns.length === 0) {
      // 3 + 4 = 7, 1 m + 1 cm = 101 cm, 2/3 ~ 0.67
      const evals = ts.map((t, i) => evaluateTranslated(t, sides[i]));
      const out: LineAnalysis = { kind: "equation", math: source, resultLatex: "", verdict: "unknown", note: "" };
      if (anyUnits) out.units = { ok: evals.every((e) => e.ok) };
      const failing = evals.find((e) => !e.ok);
      if (failing) {
        out.note = failing.note;
        if (failing.error) out.error = failing.error;
        return out;
      }
      // `\cos^{-1}\left(\frac{1}{2}\right) = 60^{\circ}`, the reference angle: an inverse trig function
      // gives radians, so beside an angle its number is that many radians (not 60° ≠ 1.047)
      const angled = evals.some((e) => angleRadians(e.value) !== null);
      const values = evals.map((e, i) => (angled && typeof e.value === "number" && INVERSE_TRIG.test(ts[i].source) ? math.unit(e.value, "rad") : e.value));
      let verdict: EngineVerdict = "ok";
      for (let i = 1; i < evals.length; i++) {
        const decimals = Math.max(decimalsIn(sides[0]) ?? -1, decimalsIn(sides[i]) ?? -1);
        const eq = valuesMatch(math, values[0], values[i], { decimals: decimals < 0 ? null : decimals, loose });
        if (eq === null) return { ...out, verdict: "unknown" };
        if (!eq) verdict = "mismatch";
      }
      out.verdict = verdict;
      if (verdict === "mismatch") out.note = "Re-check the arithmetic here";
      return out;
    }

    if (allEqual && sides.length === 2) {
      let [L, R] = ts;
      let [lhsLatex, rhsLatex] = sides;
      const isSymbol = (t: Translated) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(t.source) && t.variables.length === 1 && !t.hasUnits;
      if (!isSymbol(L) && isSymbol(R) && unknownsOf(L).length === 0) {
        [L, R] = [R, L];
        [lhsLatex, rhsLatex] = [rhsLatex, lhsLatex];
      }
      if (isSymbol(L) && unknownsOf(R).length === 0) return analyzeSolvedOrAssignment(L.source, rhsLatex, ctx);
      if (unknowns.length === 1) {
        const variable = unknowns[0];
        const rel: Relation = { op: "==", lhs: L.source, rhs: R.source, source: `${L.source} == ${R.source}`, variables: [variable] };
        const info = equationRoots(math, rel, variable);
        const out: LineAnalysis = { kind: "equation", math: rel.source, resultLatex: "", verdict: "none", note: "", variable };
        if (info.roots) out.solutions = sortRoots(info.roots).slice(0, 8).map((r) => rootLatex(r));
        const prevRel = relationFromAnalysis(math, ctx.previous, variable) ?? relationFromAnalysis(math, ctx.original, variable);
        if (info.identity) out.verdict = "ok"; // a true identity such as (x+1)(x-1) = x^2 - 1 or d/dx x^2 = 2x
        else if (claim) out.verdict = "mismatch"; // d/dx x^2 = 3x
        else if (prevRel) {
          // squaring a root away or clearing a denominator may add a root: still a correct step (compound.ts)
          const verdict = compareRelations(math, prevRel, rel, variable);
          out.verdict = relaxVerdict(math, verdict, rel, variable, relationFromAnalysis(math, ctx.previous, variable), relationFromAnalysis(math, ctx.original, variable));
        }
        return out;
      }
      const out: LineAnalysis = { kind: "equation", math: source, resultLatex: "", verdict: "unknown", note: "" };
      if (claim) out.verdict = expressionsEquivalent(math, L.source, R.source, unknowns);
      else if (!anyUnits) {
        // Two or more unknowns (`2x + 3y = 12` → `3y = 12 - 2x`): a step is checked against the
        // line above by solution set. A first line (`x + y = 18`, `KE = 1/2 m v^2`) is a
        // statement, not a step: nothing to check, so `none` — as `unknown` it sent the model a
        // line with nothing wrong in it, and the student got "a great starting equation".
        const rel: Relation = { op: "==", lhs: L.source, rhs: R.source, source, variables: unknowns };
        const prevRel = multiRelationFromAnalysis(math, ctx.previous) ?? multiRelationFromAnalysis(math, ctx.original);
        out.verdict = prevRel ? compareMultiRelations(math, prevRel, rel) : "none";
        // `BC = 3x - 1` under `AB = 2x + 3`: another fact about the figure, not a step of the line above
        if (out.verdict === "unknown" && unknowns.some(isGeometryName)) out.verdict = "none";
      }
      if (anyUnits) out.units = { ok: true };
      return out;
    }

    if (allEqual) {
      // a = b = c chains with unknowns: adjacent sides must be equivalent
      let verdict: EngineVerdict = "ok";
      for (let i = 1; i < ts.length; i++) {
        const vars = [...new Set([...unknownsOf(ts[i - 1]), ...unknownsOf(ts[i])])];
        const cmp = expressionsEquivalent(math, ts[i - 1].source, ts[i].source, vars);
        if (cmp === "mismatch") verdict = "mismatch";
        else if (cmp === "unknown" && verdict === "ok") verdict = "unknown";
      }
      return { kind: "equation", math: source, resultLatex: "", verdict, note: "" };
    }

    // inequalities
    const out: LineAnalysis = { kind: "inequality", math: source, resultLatex: "", verdict: "unknown", note: "" };
    if (sides.length === 3 && unknowns.length === 1 && !anyUnits) {
      // `-3 < x - 1 < 3`: both halves at once, as `max(...) < 0` (compound.ts)
      const chain = chainRelation(ts.map((t) => t.source), ops, unknowns[0]);
      if (chain) {
        const prevRel = relationFromAnalysis(math, ctx.previous, unknowns[0]) ?? relationFromAnalysis(math, ctx.original, unknowns[0]);
        return { ...out, math: chain.source, variable: unknowns[0], verdict: prevRel ? compareRelations(math, prevRel, chain, unknowns[0]) : "none" };
      }
    }
    if (sides.length !== 2 || ops.includes("==")) return out;
    const op = ops[0] as Relation["op"];
    if (unknowns.length === 0) {
      const res = safeEvaluate(math, source, anyUnits ? physicsScope(math) : undefined);
      if (res.ok && typeof res.value === "boolean") out.verdict = res.value ? "ok" : "mismatch";
      return out;
    }
    if (unknowns.length === 1) {
      const variable = unknowns[0];
      out.variable = variable;
      const rel: Relation = { op, lhs: ts[0].source, rhs: ts[1].source, source, variables: [variable] };
      const prevRel = relationFromAnalysis(math, ctx.previous, variable) ?? relationFromAnalysis(math, ctx.original, variable);
      out.verdict = prevRel ? compareRelations(math, prevRel, rel, variable) : "none";
    }
    return out;
  };

  /** `\frac{d}{dx} x^2` (or `\int`, `\sum`) on one side of a relation becomes its evaluated form (`2 * x`). */
  const resolveSymbolicSide = (t: Translated): Translated => {
    if (!isSymbolic(t)) return t;
    const res = safeEvaluate(math, t.source);
    if (!res.ok) return t;
    if (isNodeValue(res.value)) {
      const node = res.value;
      const vars = safeVars(node.toString()) ?? t.variables;
      return { ...t, source: node.toString(), variables: vars, functions: t.functions.filter((f) => !SYMBOLIC_FUNCTIONS.has(f)) };
    }
    if (typeof res.value === "number") return { ...t, source: String(res.value), variables: [], functions: [] };
    return t;
  };

  /** An angle (`30^{\circ}`) as its radian measure; null for any other quantity. */
  const angleRadians = (v: unknown): number | null => {
    try {
      const u = v as { dimensions?: number[]; toNumber(unit: string): number };
      const dims = u.dimensions ?? [];
      // mathjs base dimensions: MASS, LENGTH, TIME, CURRENT, TEMPERATURE, LUMINOUS_INTENSITY, AMOUNT_OF_SUBSTANCE, ANGLE, BIT
      return dims.length >= 8 && dims[7] === 1 && dims.every((d, i) => i === 7 || d === 0) ? u.toNumber("rad") : null;
    } catch {
      return null;
    }
  };

  /** The unknown inside sin / cos / tan in this relation (a trig equation: a solution in every turn). */
  const trigOfVariable = (rel: Relation, variable: string): boolean => {
    const node = safeParse(math, rel.source);
    if (!node) return false;
    let hit = false;
    node.traverse((n) => {
      const f = n as MathNode & { fn?: { name?: string }; args?: MathNode[] };
      if (hit || n.type !== "FunctionNode" || !TRIG.has(f.fn?.name ?? "")) return;
      (f.args ?? []).forEach((a) =>
        a.traverse((s) => {
          if (s.type === "SymbolNode" && (s as MathNode & { name: string }).name === variable) hit = true;
        }),
      );
    });
    return hit;
  };

  /**
   * A value line that does not give every root of the line above and is still right: one angle of
   * a trig equation (it has one in every turn: `\theta = \tan^{-1}\left(\frac{3}{4}\right)`), or a
   * length's positive root (`c = 13` under `5^{2} + 12^{2} = c^{2}`: a side is never -13).
   */
  const rightAnyway = (reference: Relation, refs: Array<Relation | null>, variable: string, values: RootValue[], decimals: number | null): boolean => {
    const roots = equationRoots(math, reference, variable).roots ?? [];
    const snapped = snapToRoots(values, roots, decimals);
    if (!snapped.every((v) => satisfies(math, reference, variable, v) === true)) return false;
    if (trigOfVariable(reference, variable)) return true;
    const positive = roots.map(rootToNumber).filter((r): r is number => r !== null && r > 1e-12);
    const vals = snapped.map(rootToNumber);
    const lengthy = refs.some((r) => r !== null && geometry.lengthRelation(r.lhs, r.rhs, variable));
    return lengthy && vals.length === 1 && positive.length === 1 && vals[0] !== null && Math.abs(vals[0] - positive[0]) <= 1e-9 * Math.max(1, positive[0]);
  };

  /** `x = 4`, `x = \pm 2`, `x = 2, -2`, `F = 2 kg * 9.8 m/s^2` */
  const analyzeSolvedOrAssignment = (variable: string, rhsLatex: string, ctx: AnalyzeContext): LineAnalysis => {
    const decimals = decimalsIn(rhsLatex);
    const fragments = splitValueList(rhsLatex, variable);
    const values: RootValue[] = [];
    let valueLatex = "";
    let unitsOk: boolean | undefined;
    let note = "";
    const translations = (fragments.length > 0 ? fragments : [rhsLatex]).map((f) => tr(f));
    const angles: number[] = [];
    const R = translations[0];
    if (translations.some((t) => unknownsOf(t).length > 0)) return { kind: "equation", math: "", resultLatex: "", verdict: "unknown", note: "", variable };
    const productSource = (vals: RootValue[]) => vals.map((v) => `(${variable} - (${typeof v === "number" ? v : `${v.re} + ${v.im}i`}))`).join(" * ");
    for (const t of translations) {
      for (const branch of t.branches) {
        const bt: Translated = { ...t, source: branch };
        const ev = evaluateTranslated(bt, rhsLatex);
        if (t.hasUnits) unitsOk = unitsOk === false ? false : ev.ok;
        if (!ev.ok) {
          note = ev.note;
          continue;
        }
        if (!valueLatex) valueLatex = ev.latex;
        const v = ev.value;
        if (typeof v === "number") values.push(v);
        else if (isComplexValue(v)) values.push(Math.abs(v.im) < 1e-9 ? v.re : v);
        else {
          const n = toNumber(v);
          if (n !== null) values.push(n);
          else if (isUnitValue(v)) {
            const rad = angleRadians(v);
            if (rad !== null) angles.push(rad);
          }
        }
      }
    }
    const prevRel = relationFromAnalysis(math, ctx.previous, variable);
    const origRel = relationFromAnalysis(math, ctx.original, variable);
    const reference = prevRel ?? origRel;
    const trigRef = reference !== null && [prevRel, origRel].some((r) => r !== null && trigOfVariable(r, variable));
    // `x = 30^{\circ}` under `\sin x = \frac{1}{2}`: the angle's radian measure, as sin reads x
    if (values.length === 0 && angles.length > 0 && trigRef) values.push(...angles);
    // the problem's domain (`0^{\circ} \le x < 360^{\circ}`), carried down the column
    const domain = domainFor(ctx, variable);
    // an interval in degrees: `x = 210` under it is 210°, as the student means it (π says radians)
    if (domain?.unit === "deg" && trigRef && angles.length === 0 && values.length > 0 && !/\\pi/.test(rhsLatex) && values.every((v) => typeof v === "number")) {
      values.splice(0, values.length, ...values.map((v) => ((v as number) * Math.PI) / 180));
    }
    if (reference && values.length > 0) {
      const out: LineAnalysis = { kind: "equation", math: values.length > 1 ? `${productSource(values)} == 0` : `${variable} == ${R.source}`, resultLatex: "", verdict: "none", note: "", variable };
      out.solutions = values.map((v) => rootLatex(v));
      out.verdict = compareValuesToRelation(math, reference, variable, values, decimals);
      // the extraneous root dropped: exactly the first line's solutions is right whatever the line above
      if (out.verdict === "mismatch" && origRel && isSolutionSet(math, origRel, variable, values)) out.verdict = "ok";
      if (out.verdict === "mismatch" && rightAnyway(reference, [prevRel, origRel], variable, values, decimals)) out.verdict = "ok";
      const target = origRel ?? prevRel;
      out.solved = out.verdict !== "mismatch" && target !== null && solvesRelation(math, target, variable, values, decimals);
      if (domain) {
        const numbers = values.filter((v): v is number => typeof v === "number");
        const inside = numbers.length === values.length && numbers.every((v) => insideDomain(domain, v));
        // solutions of the problem in its interval are right whatever the line above says (a ringed
        // `x = 50^{\circ}` and the answer written under it): as the extraneous-root rule above
        if (out.verdict !== "ok" && inside && origRel) {
          const near = (v: number) => domain.solutions!.some((s) => Math.abs(v - s) <= 1e-6 * Math.max(1, Math.abs(s)));
          if (domain.solutions ? numbers.every(near) : rightAnyway(origRel, [origRel], variable, values, decimals)) out.verdict = "ok";
        }
      }
      if (domain && out.verdict !== "mismatch") {
        const numbers = values.filter((v): v is number => typeof v === "number");
        if (numbers.some((v) => !insideDomain(domain, v))) {
          // 420° solves `2\cos x = 1`, but not the problem: it asked for 0° ≤ x < 360°
          out.verdict = "mismatch";
          out.note = OUTSIDE_DOMAIN_NOTE;
          out.solved = false;
        } else if (domain.solutions && numbers.length === values.length) {
          // every answer right is a tick; the problem is solved only when all of them are listed
          out.solved = out.verdict === "ok" && sameValueSet(numbers, domain.solutions);
        }
      }
      return out;
    }
    const out: LineAnalysis = { kind: "assignment", math: `${variable} = ${R.source}`, resultLatex: "", verdict: "none", note, variable };
    if (R.hasUnits) out.units = { ok: unitsOk !== false };
    if (values.length > 0 || valueLatex) out.solutions = valueLatex ? [valueLatex] : undefined;
    const ops = countOperations(R.source);
    if (valueLatex && (R.hasUnits || R.functions.length > 0 || R.constants.length > 0 || ops >= 3) && (ops >= 1 || /\bto\b/.test(R.source))) {
      if (normalizeLatex(valueLatex) !== normalizeLatex(rhsLatex)) out.resultLatex = valueLatex;
    }
    const prev = ctx.previous;
    if (prev && prev.kind === "assignment" && prev.variable === variable && prev.math) {
      const prevRhs = prev.math.replace(/^[a-zA-Z][a-zA-Z0-9_]*\s*=\s*/, "");
      const prevValue = safeEvaluate(math, prevRhs, physicsScope(math));
      const curValue = safeEvaluate(math, R.source, physicsScope(math));
      if (prevValue.ok && curValue.ok) {
        const eq = valuesMatch(math, prevValue.value, curValue.value, { decimals });
        out.verdict = eq === null ? "none" : eq ? "ok" : "mismatch";
      }
    }
    return out;
  };

  /**
   * `2x - 3 = 5, \ 2x - 3 = -5` or `x < -2, \ x > 4`: branches in one unknown on one line,
   * checked as the one relation they amount to (`compound.ts`). Null when the line is not that.
   */
  const analyzeRelationList = (latex: string, ctx: AnalyzeContext): LineAnalysis | null => {
    const pieces = splitAtCommas(latex);
    if (!pieces) return null;
    const parts: Part[] = [];
    const vars = new Set<string>();
    for (const piece of pieces) {
      const split = splitRelations(piece);
      if (split.sides.length !== 2 || !isRelOp(split.ops[0])) return null;
      const [L, R] = split.sides.map((side) => tr(side));
      if (L.hasUnits || R.hasUnits || isSymbolic(L) || isSymbolic(R)) return null;
      for (const v of [...unknownsOf(L), ...unknownsOf(R)]) vars.add(v);
      parts.push({ op: split.ops[0] as RelOp, lhs: L.source, rhs: R.source });
    }
    if (vars.size !== 1) return null;
    const variable = [...vars][0];
    const rel = unionRelation(parts, variable);
    if (!rel) return null;
    const out: LineAnalysis = { kind: rel.op === "==" ? "equation" : "inequality", math: rel.source, resultLatex: "", verdict: "none", note: "", variable };
    if (rel.op === "==") {
      const info = equationRoots(math, rel, variable);
      if (info.roots) out.solutions = sortRoots(info.roots).slice(0, 8).map((r) => rootLatex(r));
    }
    const prevRel = relationFromAnalysis(math, ctx.previous, variable);
    const origRel = relationFromAnalysis(math, ctx.original, variable);
    const reference = prevRel ?? origRel;
    if (reference) out.verdict = relaxVerdict(math, compareRelations(math, reference, rel, variable), rel, variable, prevRel, origRel, false);
    return out;
  };

  // --- derivative notation that needs an earlier line -----------------------
  /** `y = 2x + 1` / `f(t) = t^2` from an earlier line, as LaTeX the scanner can read again. */
  const definitionLatex = (ctx: AnalyzeContext, name: string, variable?: string): { latex: string; param: string } | null => {
    for (const a of [ctx.previous, ctx.original]) {
      if (!a || a.kind !== "function" || !a.math) continue;
      const m = /^([a-zA-Z])(?:\(([a-zA-Z])\))?\s*=\s*([\s\S]+)$/.exec(a.math);
      if (!m || m[1] !== name) continue;
      const param = m[2] ?? a.variable ?? "x";
      if (variable && param !== variable) continue;
      const node = safeParse(math, m[3]);
      if (!node) continue;
      const latex = nodeToLatex(node);
      if (latex) return { latex, param };
    }
    return null;
  };

  /**
   * `\frac{dy}{dx}` and `f'(x)` only mean something next to a definition, so they are rewritten
   * to `\frac{d}{dx}(...)` when an earlier line defined the function and left alone otherwise
   * (where they stay unsupported rather than becoming a guess).
   */
  const expandDerivativeNotation = (latex: string, ctx: AnalyzeContext): string => {
    if (!ctx.previous && !ctx.original) return latex;
    const leibniz = LEIBNIZ.exec(latex);
    if (leibniz) {
      const def = definitionLatex(ctx, leibniz[1], leibniz[2]);
      if (!def) return latex;
      return `${latex.slice(0, leibniz.index)}\\frac{d}{d${leibniz[2]}}\\left(${def.latex}\\right)${latex.slice(leibniz.index + leibniz[0].length)}`;
    }
    const prime = PRIME.exec(latex);
    if (prime) {
      const def = definitionLatex(ctx, prime[2], prime[3]);
      if (!def) return latex;
      const head = prime.index + prime[1].length;
      return `${latex.slice(0, head)}\\frac{d}{d${def.param}}\\left(${def.latex}\\right)${latex.slice(prime.index + prime[0].length)}`;
    }
    return latex;
  };

  // --- chemistry -----------------------------------------------------------
  const analyzeChem = (latex: string): LineAnalysis => {
    const eq = parseEquation(latex);
    if (!eq) return { ...UNKNOWN };
    const coeffs = balanceEquation(eq);
    const balanced = isBalanced(eq);
    // A parsed equation is either balanced (ok, "Balanced") or not (mismatch -> amber dot with a
    // local hint). 'none' is reserved for lines that are chemistry but not an equation (formulas).
    const out: LineAnalysis = {
      kind: "chem",
      math: normalizeChemText(latex),
      resultLatex: "",
      verdict: balanced ? "ok" : "mismatch",
      note: balanced ? CHEM_BALANCED_NOTE : CHEM_UNBALANCED_NOTE,
      chem: { balanced, balancedLatex: coeffs ? equationLatex(eq, coeffs) : "" },
    };
    return out;
  };

  /**
   * `= 2\cos x` under `\frac{\sin 2x}{\sin x}`: the next line of a chain (a simplification, an
   * identity proved one rewrite at a time), checked against the line above by sampling. Null
   * when the line is not that, and the ordinary rules apply (a lone `=` stays incomplete).
   */
  const continuation = (cleaned: string, ctx: AnalyzeContext): LineAnalysis | null => {
    const m = /^=(?!=)\s*/.exec(cleaned);
    if (!m || ctx.previous?.kind !== "expression" || !ctx.previous.math) return null;
    const rest = cleaned.slice(m[0].length).trim();
    const pre = preClassify(rest).kind;
    // `= 5`, `= i`: after `=`, a lone number or letter is the value, not a label
    if (!rest || splitRelations(rest).ops.length > 0 || (pre !== null && pre !== "label")) return null;
    // the student's own step: checked, never finished for them
    const out: LineAnalysis = { ...analyzeExpression(rest, ctx, false), resultLatex: "" };
    // it claims the value of the line above: a closed value that differs is wrong (`\sqrt{50}`,
    // `= 5\sqrt{5}`); a decimal is the calculator's rounding, not a claim, and stays unmarked
    const closed = (source: string) => safeVars(source)?.length === 0;
    if (out.verdict === "none" && out.math && !/\d\.\d/.test(rest) && closed(out.math) && closed(ctx.previous.math) && !/\d\.\d/.test(ctx.previous.math)) {
      if (expressionsEquivalent(math, ctx.previous.math, out.math, []) === "mismatch") out.verdict = "mismatch";
    }
    return out;
  };

  /**
   * `A = \pi(5)^{2} =`: a named quantity, its value, and a trailing `=` asking for it. Returns the
   * value side (`\pi(5)^{2}`), answered as if it were written alone before the `=`; null for
   * anything else. The name is a lone quantity: `A`, `SA` (read as the segment `\overline{SA}`),
 * `\theta`, `V_{1}`, `f(3)`.
   */
  const namedValue = (latex: string): string | null => {
    const { sides, ops } = splitRelations(latex);
    if (ops.length !== 2 || ops.some((op) => op !== "==") || sides[2]?.trim() || !sides[1]?.trim()) return null;
    const name = sides[0].replace(/\s+/g, "");
    if (!/^(?:[A-Za-z]{1,3}|\\[a-zA-Z]+|\\overline\{[A-Z]{2}\}|[A-Za-z]\([^()=]*\))(?:_\{[^{}]+\}|_[A-Za-z0-9])?$/.test(name)) return null;
    return sides[1].trim();
  };

  /**
   * The value of a line the student ended with `=` at the values the column gives its letters
   * (`ctx.givens`, from `givens.ts`):
   *
   *   3x + 24 =        →  substituted `3(3) + 24`, and in Solve the answer `33`
   *   x = 3
   *
   * `valueLatex` is what comes before the `=` (`3x + 24`, or the value side of `A = \pi r^{2} =`).
   * It is analysed as the line with every letter replaced by its value, bracketed as a teacher
   * writes it (`substituteLatex`: `3x` at 3 is `3(3)`, `x^{2}` at -2 is `(-2)^{2}`), so the result
   * is exactly what Solve writes for `3(3) + 24 =`. Null unless every letter is given, the line is
   * no relation, and what is left has a value (`\frac{1}{x - 3}` at x = 3 has none): the line then
   * stays the unfinished line it was.
   */
  const valueAtGivens = (valueLatex: string, ctx: AnalyzeContext): LineAnalysis | null => {
    const givens = ctx.givens;
    if (!givens || Object.keys(givens).length === 0) return null;
    try {
      // `f(4)` is a call, not `4f` (`functionNotation.ts` has it)
      if (splitRelations(valueLatex).ops.length > 0 || hasFunctionCall(valueLatex)) return null;
      const t = tr(valueLatex);
      const unknowns = unknownsOf(t);
      if (unknowns.length === 0 || isSymbolic(t) || t.hasUnits || !unknowns.every((v) => typeof givens[v] === "string")) return null;
      const substituted = substituteLatex(valueLatex, Object.fromEntries(unknowns.map((v) => [v, givens[v]])));
      if (unknownsOf(tr(substituted)).length > 0) return null;
      // worked out as Solve would answer it, so a line with no value is never called one
      const a = analyzeExpression(substituted, { ...ctx, mode: "answer" }, true);
      if (a.kind !== "expression" || a.error || !a.resultLatex) return null;
      // `\frac{1}{x - 3}` at 3 is no number at all, not `\infty`
      const v = safeEvaluate(math, a.math);
      if (!v.ok || (typeof v.value === "number" && !Number.isFinite(v.value))) return null;
      return { ...a, resultLatex: ctx.mode === "answer" ? a.resultLatex : "", substituted, nextStep: substituted };
    } catch {
      return null;
    }
  };

  /**
   * A line in letters the student ended with `=` to have it expanded or simplified:
   *
   *   (x + y)^{2} =        →  x^{2} + 2xy + y^{2}
   *   (x - 3)(x + 2) =     →  x^{2} + 2x - 3x - 6, then x^{2} - x - 6
   *   2(x + 4) - 3x =      →  2x + 8 - 3x, then 8 - x
   *   \frac{x^{2} - 1}{x - 1} =  →  x + 1
   *
   * Its simplest form is unambiguous when the working expands brackets and collects like terms
   * (`simplifyExpressionSteps`) or cancels a common factor (`rationalExpressionSteps`): the line is
   * then an `expression` whose `resultLatex` (Solve only, as for `36 + 2 =`) is that form, written
   * after the student's `=`, and whose `nextStep` is the first line of the working (Help's step).
   * Null otherwise, and the line stays the unfinished line it was: one already as simple as it
   * goes (`x^{2} + 3x + 5 =`), or one whose only "simplification" is a factorisation, which is a
   * choice and not the answer to a `=` (`3x + 24 =` is not asking to become `3(x + 8)`).
   */
  const simplestForm = (lhs: string, ctx: AnalyzeContext): LineAnalysis | null => {
    try {
      const pre = preprocessLatex(lhs).trim();
      if (!pre || /\d\.\d/.test(pre) || splitRelations(pre).ops.length > 0 || hasFunctionCall(pre)) return null;
      const t = tr(pre);
      if (t.hasUnits || t.hasText || t.hasPercent || t.hasPm || t.functions.length > 0 || isSymbolic(t)) return null;
      const unknowns = unknownsOf(t);
      if (unknowns.length === 0 || unknowns.some((v) => !/^[a-zA-Z]$/.test(v))) return null;
      const node = safeParse(math, t.source);
      if (!node) return null;
      const steps = simplifyExpressionSteps(node, unknowns, pre, stepKey) ?? rationalExpressionSteps(node, unknowns, pre, stepKey);
      if (!steps || steps.length === 0) return null;
      const a = analyzeExpression(pre, ctx, false);
      if (a.kind !== "expression" || a.error) return null;
      return { ...a, resultLatex: ctx.mode === "answer" ? steps[steps.length - 1] : "", nextStep: steps[0] };
    } catch {
      return null;
    }
  };

  /**
   * `-3 \quad -3`, `\div 2 \div 2`, `\div 2` under an equation: what is done to both sides next
   * (`operationLine.ts`), checked against the relation above. Null when the line is not one: a
   * sum or difference of terms with no relation above it is arithmetic (`-3 - 3` is -6).
   */
  const analyzeOperation = (latex: string, ctx: AnalyzeContext): LineAnalysis | null => {
    const parsed = parseOperationLine(latex);
    if (!parsed) return null;
    const prev = ctx.previous;
    const relation = prev && (prev.kind === "equation" || prev.kind === "inequality") && prev.math ? prev.math : null;
    if (!relation && (parsed.op === "add" || parsed.op === "subtract")) return null;
    // two different operands are a mistake under a linear relation, scratch under any other
    // (`-2 \quad -5` under `x^2 - 7x + 10 = 0`: a factor pair)
    const linear = relation !== null && linearRelation(relation, (s) => safeParse(math, s));
    const judged = judgeOperation(parsed, relation, linear);
    const operand = parsed.operands[0];
    const source = operandMath(operand) ?? "";
    const result = judged.verdict === "ok" && relation && plainRelation(relation) && source ? operationResult(relation, parsed.op, source, (s) => safeParse(math, s)) : "";
    return {
      kind: "operation",
      math: "",
      resultLatex: "",
      verdict: judged.verdict,
      note: judged.note,
      operation: { op: parsed.op, operand, operandMath: source, result },
    };
  };

  // --- entry points --------------------------------------------------------
  const analyze = (latex: string, ctx: AnalyzeContext): LineAnalysis => {
    // what is done to both sides of the equation above (`operationLine.ts`): before anything reads
    // `-3 \quad -3` as a sum or a data list
    const operation = analyzeOperation(latex, ctx);
    if (operation) return operation;
    // a line about the data list above, a form of the line / quadratic above asked for (`courses.ts`)
    const course = courses.analyzeFirst(latex, ctx);
    if (course) return course;
    // statements about figures, angle equations in degrees (`geometry.ts`)
    const geo = geometry.analyze(latex, ctx, analyze);
    if (geo) return geo;
    // `\text{holes}` under a function: an ask, not prose (`courses.ts`)
    const ask = courses.askLine(latex, ctx);
    if (ask) return ask;
    // preClassify needs the raw line (it tells "decorations only" from "empty"), so the rewritten
    // form is only substituted when a rewrite actually happened.
    const cleaned = preprocessLatex(latex);
    const chained = continuation(cleaned, ctx);
    if (chained) return chained;
    const expanded = expandDerivativeNotation(cleaned, ctx);
    const pre = preClassify(expanded === cleaned ? latex : expanded);
    switch (pre.kind) {
      case "empty":
        return { ...UNKNOWN };
      case "label":
        return base("label");
      case "text":
        return base("text");
      case "unsupported":
        return { ...UNKNOWN };
      case "incomplete": {
        if (pre.trailingEquals && pre.lhs) {
          try {
            const t = tr(pre.lhs);
            // a bound-variable line (`\int_0^1 x^2 dx =`, `\frac{d}{dx} x^3 =`) is answerable
            if (t.source.trim() && (unknownsOf(t).length === 0 || isSymbolic(t)) && splitRelations(pre.lhs).ops.length === 0) {
              const a = analyzeExpression(pre.lhs, ctx, true);
              if ((a.kind === "expression" && !a.error) || a.kind === "unknown") return a;
            }
          } catch (e) {
            // `\lim ... =`, `\begin{pmatrix} ... =`: not an unfinished line, a line we cannot read
            if (e instanceof UnsupportedLatex) return { ...UNKNOWN, error: errorMessage(e) };
          }
          // `3x + 24 =` with `x = 3` in the column: its value there
          const at = valueAtGivens(pre.lhs, ctx);
          if (at) return at;
          // `(x + y)^{2} =`: expanded and collected
          const simplest = simplestForm(pre.lhs, ctx);
          if (simplest) return simplest;
        }
        const value = pre.trailingEquals ? namedValue(expanded) : null;
        if (value) {
          const t = tr(value);
          if (t.source.trim() && unknownsOf(t).length === 0) {
            const a = analyzeExpression(value, ctx, true);
            if (a.kind === "expression" && !a.error) return a;
          }
          // `A = \pi r^{2} =` with `r = 5` in the column
          const at = valueAtGivens(value, ctx);
          if (at) return at;
        }
        return base("incomplete");
      }
      case "chem":
        return analyzeChem(pre.latex);
      case "chemFormula": {
        const mass = molarMassLatex(pre.latex);
        const out = base("chem", normalizeChemText(pre.latex));
        if (mass) out.resultLatex = mass;
        return out;
      }
      case "point": {
        const p = pre.point!;
        const out = base("point");
        try {
          const tx = tr(p.x);
          const ty = tr(p.y);
          if (unknownsOf(tx).length === 0 && unknownsOf(ty).length === 0) {
            const vx = safeEvaluate(math, tx.source);
            const vy = safeEvaluate(math, ty.source);
            if (vx.ok && vy.ok && typeof vx.value === "number" && typeof vy.value === "number") out.math = `[${vx.value}, ${vy.value}]`;
          }
        } catch {
          // a point with symbolic coordinates is still a point
        }
        return out;
      }
      case "function": {
        // `g(x) = f(x - 3) + 1` under f, and a rewrite of it (checked) (`courses.ts`)
        const derived = courses.analyzeFunction(pre.latex, ctx);
        if (derived) return derived;
        const fn = pre.fn!;
        const out = base("function");
        out.variable = fn.param;
        try {
          const t = tr(fn.rhs);
          const others = unknownsOf(t).filter((v) => v !== fn.param);
          out.math = fn.name === "y" ? `y = ${t.source}` : `${fn.name}(${fn.param}) = ${t.source}`;
          if (others.length === 0) {
            const plot = plotFor(math, t.source, fn.rhs, fn.param);
            if (plot) out.plot = plot;
          }
          const prev = ctx.previous;
          if (prev && prev.kind === "function" && prev.plot && out.plot) {
            // The same function rewritten (`y = 2(x + 1)` → `y = 2x + 2`) is a tick. A DIFFERENT
            // function is a new line — two lines to graph, a system — never a ring: `y = 2x + 1`
            // then `y = -x + 4` is correct work.
            const same = expressionsEquivalent(math, prev.plot.expr, out.plot.expr, ["x"]);
            out.verdict = same === "mismatch" ? "none" : same;
          }
          // `x + y = 10` then `y = 10 - x`: the student isolated y — a step to check, not only
          // a function to graph. (`y = ...` under another `y = ...` is the comparison above.)
          const prevRel = fn.name === "y" && prev?.kind !== "function" ? multiRelationFromAnalysis(math, prev) : null;
          if (prevRel) {
            const cur = parseRelation(math, `y == ${t.source}`);
            if (cur) out.verdict = compareMultiRelations(math, prevRel, cur);
          }
        } catch (e) {
          out.error = errorMessage(e);
        }
        return out;
      }
      default: {
        // `f(4) = 11` under `f(x) = 2x + 3`: a claim about the function, not `4f = 11`
        const claim = courses.analyze(pre.latex, ctx);
        if (claim) return claim;
        const orList = solutionList(pre.latex);
        if (orList) return analyzeSolvedOrAssignment(orList.variable, orList.values.join(", "), ctx);
        const branches = analyzeRelationList(pre.latex, ctx);
        if (branches) return branches;
        const split = splitRelations(pre.latex);
        if (split.ops.length === 0) return analyzeExpression(pre.latex, ctx, false);
        return analyzeRelation(pre.latex, ctx);
      }
    }
  };

  // --- an equation and its domain (`domain.ts`) ------------------------------
  /**
   * A domain's bounds as values, in the measure the unknown is read in: an angle in radians
   * (`360^{\circ}` → 2π; plain numbers beside an angle's equation are degrees when they are that
   * large, radians otherwise), the numbers themselves for any other equation. Null when a bound is
   * not a number or the domain is empty.
   */
  const readDomain = (b: DomainBounds, trig: boolean): LineDomain | null => {
    let variable: string;
    try {
      const t = tr(b.variable);
      if (t.variables.length !== 1 || t.source.trim() !== t.variables[0]) return null;
      variable = t.variables[0];
    } catch {
      return null;
    }
    const read = (tex: string): { v: number; kind: "deg" | "rad" | "plain" } | null => {
      try {
        const t = tr(tex);
        if (unknownsOf(t).length > 0) return null;
        const ev = evaluateTranslated(t, tex);
        if (!ev.ok) return null;
        if (typeof ev.value === "number" && Number.isFinite(ev.value)) return { v: ev.value, kind: /\\pi/.test(tex) ? "rad" : "plain" };
        const rad = angleRadians(ev.value);
        return rad === null ? null : { v: rad, kind: "deg" };
      } catch {
        return null;
      }
    };
    const lo = read(b.loTex);
    const hi = read(b.hiTex);
    if (!lo || !hi) return null;
    const unit: LineDomain["unit"] =
      lo.kind === "deg" || hi.kind === "deg" ? "deg" : lo.kind === "rad" || hi.kind === "rad" ? "rad" : !trig ? "plain" : Math.max(Math.abs(lo.v), Math.abs(hi.v)) >= 7 ? "deg" : "rad";
    const measure = (x: { v: number; kind: string }) => (x.kind === "plain" && unit === "deg" ? (x.v * Math.PI) / 180 : x.v);
    const d: LineDomain = { variable, lo: measure(lo), hi: measure(hi), loIn: b.loIn, hiIn: b.hiIn, unit, latex: domainChain(b) };
    return d.hi > d.lo ? d : null;
  };

  /** Solutions in a domain, by the equation and its domain (memoised: the problem does not change). */
  const domainSolutionMemo = new Map<string, number[] | null>();
  /**
   * Every solution of `equation` inside `d`, exactly as Solve lists them (`x = 60^{\circ}, \ x =
   * 300^{\circ}`), in the domain's measure; undefined when the engine cannot list them.
   */
  const domainSolutions = (equation: string, d: LineDomain): number[] | undefined => {
    const key = `${equation} | ${d.latex}`;
    if (!domainSolutionMemo.has(key)) {
      let found: number[] | null = null;
      try {
        const res = solveLatex(`${equation}, \\ ${d.latex}`) ?? solveLatex(equation);
        if (res && /\\varnothing|\\emptyset/.test(res.latex)) found = [];
        else if (res) {
          const one = new RegExp(`^\\s*${d.variable}\\s*=\\s*([^=]+)$`).exec(res.latex);
          const list = solutionList(res.latex)?.values ?? (one ? [one[1]] : null);
          const values = (list ?? []).map((tex) => {
            const ev = evaluateTranslated(tr(tex), tex);
            if (!ev.ok) return null;
            if (typeof ev.value === "number") return d.unit === "deg" && !/\\pi/.test(tex) ? (ev.value * Math.PI) / 180 : ev.value;
            return angleRadians(ev.value);
          });
          if (list && values.every((v): v is number => v !== null && Number.isFinite(v))) found = (values as number[]).filter((v) => insideDomain(d, v));
        }
      } catch {
        found = null;
      }
      domainSolutionMemo.set(key, found);
      while (domainSolutionMemo.size > 128) domainSolutionMemo.delete(domainSolutionMemo.keys().next().value as string);
    }
    return domainSolutionMemo.get(key) ?? undefined;
  };

  /**
   * A line that is only a domain, under an equation in its unknown: the problem's own domain
   * written again (a tick; a different one is a ring), or — under an angle's equation that had none
   * — the student naming the interval (a tick for the one turn from 0 that Solve writes, no mark
   * for another). Null otherwise: `-2 < x < 3` under `|x - \frac{1}{2}| < \frac{5}{2}` is an answer.
   * It is not a relation to work from (`math` is empty): the next line is checked against the
   * equation above it.
   */
  const domainLine = (b: DomainBounds, ctx: AnalyzeContext, inherited: LineDomain | undefined): LineAnalysis | null => {
    const line = (d: LineDomain, verdict: EngineVerdict): LineAnalysis => ({ kind: "inequality", math: "", resultLatex: "", verdict, note: "", variable: d.variable, domain: d });
    if (inherited) {
      const d = readDomain(b, inherited.unit !== "plain");
      if (!d || d.variable !== inherited.variable) return null;
      // a different interval is a ring; the problem's own stays the one the answer is held to
      return line(inherited, sameDomain(d, inherited) ? "ok" : "mismatch");
    }
    const d = readDomain(b, true);
    if (!d) return null;
    const rel = relationFromAnalysis(math, ctx.previous, d.variable) ?? relationFromAnalysis(math, ctx.original, d.variable);
    if (!rel || rel.op !== "==" || !trigOfVariable(rel, d.variable)) return null;
    const oneTurn = Math.abs(d.lo) < 1e-9 && Math.abs(d.hi - 2 * Math.PI) < 1e-9 && d.loIn && !d.hiIn;
    return line(d, oneTurn ? "ok" : "none");
  };

  /** The domain the column above set for this unknown, if any. */
  const domainFor = (ctx: AnalyzeContext, variable: string): LineDomain | null => {
    const d = ctx.previous?.domain ?? ctx.original?.domain;
    return d && d.variable === variable ? d : null;
  };

  /**
   * `analyze`, with domains: an equation written with its domain is analysed as the equation (in
   * its context, as any line) and carries the domain, with its solutions there; a line that is only
   * a domain is read as one; and every other line carries the domain of the lines above down the
   * column, so the answer at the bottom is held to it.
   */
  const analyzeInDomain = (latex: string, ctx: AnalyzeContext): LineAnalysis => {
    const inherited = ctx.previous?.domain ?? ctx.original?.domain;
    const split = splitDomain(latex);
    if (split) {
      const d = readDomain(split.bounds, isTrigLine(split.equation));
      if (d) {
        const a = analyze(split.equation, ctx);
        if (a.kind === "equation" && a.variable === d.variable) {
          const solutions = domainSolutions(split.equation, d);
          const own: LineDomain = solutions ? { ...d, solutions } : d;
          const out: LineAnalysis = { ...a, domain: own };
          if (solutions) out.solutions = solutions.map((v) => rootLatex(v));
          // the problem written again with another interval is another problem
          if (inherited && inherited.variable === own.variable && !sameDomain(inherited, own)) out.verdict = "mismatch";
          return out;
        }
      }
    }
    const alone = parseDomainPiece(latex);
    if (alone) {
      const d = domainLine(alone, ctx, inherited);
      if (d) return d;
    }
    const a = analyze(latex, ctx);
    return inherited && !a.domain && !SILENT_FOR_DOMAIN.has(a.kind) ? { ...a, domain: inherited } : a;
  };

  const analyzeLine = (latex: string, ctx: AnalyzeContext): LineAnalysis => {
    try {
      return analyzeInDomain(latex ?? "", ctx ?? { mode: "feedback" });
    } catch (e) {
      const out: LineAnalysis = { ...UNKNOWN, error: errorMessage(e) };
      if (e instanceof UnsupportedLatex) out.note = "";
      return out;
    }
  };

  // --- solve ---------------------------------------------------------------
  const polyLatex = (coeffs: number[], variable: string): string => {
    const opts: NumberFormatOptions = { preferFraction: true };
    let out = "";
    for (let d = coeffs.length - 1; d >= 0; d--) {
      const c = coeffs[d];
      if (Math.abs(c) < 1e-12) continue;
      const sign = c < 0 ? "-" : "+";
      const mag = Math.abs(c);
      const magTex = formatNumberLatex(mag, opts);
      let body: string;
      if (d === 0) body = magTex;
      else {
        const coef = Math.abs(mag - 1) < 1e-12 ? "" : magTex;
        body = d === 1 ? `${coef}${variable}` : `${coef}${variable}^{${d}}`;
      }
      if (!out) out = sign === "-" ? `-${body}` : body;
      else out += ` ${sign} ${body}`;
    }
    return out || "0";
  };

  /**
   * The teacher-style steps for a linear equation or inequality in one unknown (`algebra.ts`),
   * or null when the line is not one — the caller then keeps the CAS path below.
   */
  const linearSteps = (latex: string): (LinearSteps & { pre: string; variable: string; op: RelOp }) | null => {
    const pre = preprocessLatex(latex);
    if (/\d\.\d/.test(pre)) return null; // decimals stay on the CAS path: no `\frac{1}{2}` for `0.5`
    const split = splitRelations(pre);
    if (split.sides.length !== 2 || !isRelOp(split.ops[0])) return null;
    const [L, R] = split.sides.map((s) => tr(s));
    if (L.hasUnits || R.hasUnits || isSymbolic(L) || isSymbolic(R) || L.functions.length > 0 || R.functions.length > 0) return null;
    const unknowns = [...new Set([...unknownsOf(L), ...unknownsOf(R)])];
    if (unknowns.length !== 1 || !/^[a-zA-Z]$/.test(unknowns[0])) return null;
    const lhs = safeParse(math, L.source);
    const rhs = safeParse(math, R.source);
    if (!lhs || !rhs) return null;
    const op = split.ops[0] as RelOp;
    const out = linearSolveSteps(lhs, rhs, op, unknowns[0], pre, stepKey);
    return out ? { ...out, pre, variable: unknowns[0], op } : null;
  };

  /** Functions a one-unknown line may use and still be solved exactly by `advanced.ts`. */
  const ADVANCED_FUNCTIONS: ReadonlySet<string> = new Set(["abs", "sqrt", "nthRoot", "log", "log10", "exp"]);

  const advancedDeps: AdvancedDeps = {
    relation: (latex) => {
      try {
        const pre = preprocessLatex(latex);
        if (/\d\.\d/.test(pre)) return null; // exact answers only: decimals stay on the CAS path
        const split = splitRelations(pre);
        if (split.sides.length !== 2 || !isRelOp(split.ops[0])) return null;
        const [L, R] = split.sides.map((side) => tr(side));
        for (const t of [L, R]) {
          if (t.hasUnits || t.hasText || t.hasPercent || t.hasPm || isSymbolic(t)) return null;
          if (t.functions.some((f) => !ADVANCED_FUNCTIONS.has(f))) return null;
        }
        const unknowns = [...new Set([...unknownsOf(L), ...unknownsOf(R)])];
        if (unknowns.length !== 1 || !/^[a-zA-Z]$/.test(unknowns[0])) return null;
        const lhs = safeParse(math, L.source);
        const rhs = safeParse(math, R.source);
        if (!lhs || !rhs) return null;
        return { lhs, rhs, op: split.ops[0] as RelOp, variable: unknowns[0], latex: pre };
      } catch {
        return null;
      }
    },
    // `-3 < 2x + 1 < 7`: the same restrictions, three sides (inequality.ts)
    chain: (latex) => {
      try {
        const pre = preprocessLatex(latex);
        if (/\d\.\d/.test(pre)) return null;
        const split = splitRelations(pre);
        if (split.sides.length !== 3 || !split.ops.every(isRelOp)) return null;
        const ts = split.sides.map((side) => tr(side));
        if (ts.some((t) => t.hasUnits || t.hasText || t.hasPercent || t.hasPm || t.functions.length > 0)) return null;
        const unknowns = [...new Set(ts.flatMap(unknownsOf))];
        if (unknowns.length !== 1 || !/^[a-zA-Z]$/.test(unknowns[0])) return null;
        const nodes = ts.map((t) => safeParse(math, t.source));
        if (nodes.some((n) => !n)) return null;
        return { sides: nodes as [MathNode, MathNode, MathNode], ops: split.ops as [RelOp, RelOp], variable: unknowns[0], latex: pre };
      } catch {
        return null;
      }
    },
    normalize: stepKey,
  };

  const solveLatex = (written: string, solveOptions?: SolveOptions): { latex: string; steps: string[] } | null => {
    try {
      // `x \in [0, 360^{\circ})` beside the equation is the chain `0 \le x < 360^{\circ}` (`domain.ts`)
      const inForm = /\\in(?![a-z])/.test(written) ? splitDomain(written) : null;
      const latex = inForm ? `${inForm.equation}, \\ ${domainChain(inForm.bounds)}` : written;
      // a function applied by name is refused (not `3f = 9`); a line in x and y, complex roots, …
      const course = courses.solve(latex, solveOptions);
      if (course === "refuse") return null;
      if (course) return course;
      // a line with geometry in it: degrees, π, a root or a trig value among the numbers, a named angle or segment
      const geo = geometry.solveLine(latex);
      if (geo === "refuse") return null;
      if (geo) return geo;
      const linear = linearSteps(latex);
      if (linear) {
        if (linear.outcome !== "solved") {
          // the unknown cancelled: `0 = -9` has no solution, `0 = 0` every one
          const final = linear.outcome === "contradiction" ? NO_SOLUTION : linear.op === "==" ? EVERY_REAL(linear.variable) : ALL_REALS(linear.variable);
          return { latex: final, steps: [...linear.steps, final] };
        }
        if (linear.steps.length === 0) return null;
        // `x = 4` / `x > 4` is already solved: writing it again under itself says nothing.
        if (stepKey(linear.final) === stepKey(linear.pre)) return null;
        return { latex: linear.final, steps: linear.steps };
      }
      // quadratics, |x|, radicals, exponentials and logs, the unknown in a denominator (advanced.ts)
      const advanced = solveAdvanced(latex, advancedDeps);
      // `x = \log_{5} 7` gets its change of base (`courses.ts`)
      if (advanced) return courses.polish({ latex: advanced.final, steps: advanced.steps });
      // the unknown inside sin / cos / tan: exact angles in an interval, or no answer at all —
      // never the numeric root-finder's thirty values in radians (`trigEquation.ts`)
      const trigEquation = solveTrigEquation(math, latex, { translate: (l) => tr(l), solveAlgebra: (l) => solveLatex(l) });
      if (trigEquation === "refuse") return null;
      if (trigEquation) return trigEquation;
      const pre = preprocessLatex(latex);
      const split = splitRelations(pre);
      if (split.sides.length !== 2 || split.ops[0] !== "==") return null;
      const [L, R] = split.sides.map((s) => tr(s));
      const unknowns = [...new Set([...unknownsOf(L), ...unknownsOf(R)])];
      if (unknowns.length !== 1) return null;
      const variable = unknowns[0];
      const rel: Relation = { op: "==", lhs: L.source, rhs: R.source, source: `${L.source} == ${R.source}`, variables: [variable] };
      const info = equationRoots(math, rel, variable);
      if (!info.roots || info.identity || info.contradiction) return null;
      const steps: string[] = [];
      // a line written in decimals is worked in decimals (`0.2x = 1.6`, not `\frac{1}{5}x = \frac{8}{5}`)
      // — EXACT decimals: `2000(1.05)^3` is 2315.25, not the 4-significant-figure 2315; a value
      // with no short terminating decimal stays an exact fraction rather than being rounded.
      const decimalLine = /\d\.\d/.test(pre);
      const opts: NumberFormatOptions = { preferFraction: !decimalLine };
      const fmt = (n: number) => (decimalLine ? exactDecimalLatex(n) : formatNumberLatex(n, opts));
      const c = info.coefficients;
      const lastIsZero = R.source.trim() === "0";
      if (c && info.exact && c.length === 2) {
        // `ax = b` with a positive a (`2.5 = 0.5x` → `0.5x = 2.5`), never the input again
        const [c0, c1] = c[1] < 0 ? [-c[0], -c[1]] : c;
        const axb = `${Math.abs(c1 - 1) < 1e-12 ? "" : fmt(c1)}${variable} = ${fmt(-c0)}`;
        if (Math.abs(c0) > 1e-12 && Math.abs(c1 - 1) > 1e-12 && normalizeLatex(axb) !== normalizeLatex(pre)) steps.push(axb);
        else if (Math.abs(c0) > 1e-12 && !/^-?\d/.test(pre) && !new RegExp(`^${variable}\\s*=`).test(pre)) steps.push(`${variable} = ${fmt(-c0)}`);
        const root = -c0 / c1;
        const final = `${variable} = ${fmt(root)}`;
        // `y = 9` is already solved: writing it again under itself says nothing.
        if (normalizeLatex(final) === normalizeLatex(pre)) return null;
        if (steps[steps.length - 1] !== final) steps.push(final);
        return { latex: final, steps };
      }
      if (c && info.exact && c.length === 3) {
        const [c0, c1, c2] = c;
        const standard = `${polyLatex(c, variable)} = 0`;
        if (!lastIsZero || normalizeLatex(standard) !== normalizeLatex(pre)) steps.push(standard);
        const reals = sortRoots(info.roots).map(rootToNumber);
        const disc = c1 * c1 - 4 * c2 * c0;
        const integerRoots = reals.every((r) => r !== null && Number.isInteger(Number(r.toFixed(9))));
        if (integerRoots && reals.length === 2 && Math.abs(c2 - 1) < 1e-12) {
          const [r1, r2] = reals as number[];
          const factor = (r: number) => (r === 0 ? variable : `(${variable} ${r < 0 ? "+" : "-"} ${fmt(Math.abs(r))})`);
          steps.push(`${factor(r1)}${factor(r2)} = 0`);
        } else {
          // a negative number squared or multiplied is bracketed: `(-2)^{2}`, not `-2^{2}`
          const paren = (n: number) => (n < 0 ? `(${fmt(n)})` : fmt(n));
          steps.push(`${variable} = \\frac{${fmt(-c1)} \\pm \\sqrt{${paren(c1)}^{2} - 4 \\cdot ${paren(c2)} \\cdot ${paren(c0)}}}{2 \\cdot ${paren(c2)}}`);
          steps.push(`${variable} = \\frac{${fmt(-c1)} \\pm \\sqrt{${fmt(disc)}}}{${fmt(2 * c2)}}`);
        }
        const final = finalLatex(variable, info.roots, opts, true);
        steps.push(final);
        return { latex: final, steps };
      }
      if (c && info.exact && c.length === 4) {
        const standard = `${polyLatex(c, variable)} = 0`;
        if (!lastIsZero || normalizeLatex(standard) !== normalizeLatex(pre)) steps.push(standard);
        const final = finalLatex(variable, info.roots, opts, true);
        steps.push(final);
        return { latex: final, steps };
      }
      if (info.roots.length === 0) return null;
      // a root the root-finder found that IS a whole number or a simple fraction (both sides agree
      // there to the last bit) is written with `=`, not `\approx`
      const exact = exactRoots(rel, variable, info.roots);
      const final = exact ? finalLatex(variable, exact, { preferFraction: true }, true) : finalLatex(variable, info.roots, { preferFraction: false }, false);
      steps.push(final);
      return { latex: final, steps };
    } catch {
      return null;
    }
  };

  /** Every real root snapped to a whole number or a fraction (denominator ≤ 12) that satisfies `rel` exactly; null when one does not. */
  const exactRoots = (rel: Relation, variable: string, roots: RootValue[]): number[] | null => {
    const out: number[] = [];
    for (const r of roots) {
      const n = rootToNumber(r);
      if (n === null) continue;
      let hit: number | null = null;
      for (let d = 1; d <= 12 && hit === null; d++) {
        const c = Math.round(n * d) / d;
        if (Math.abs(c - n) > 1e-6 * Math.max(1, Math.abs(n))) continue;
        const l = safeEvaluate(math, rel.lhs, { [variable]: c });
        const rr = safeEvaluate(math, rel.rhs, { [variable]: c });
        const a = l.ok ? toNumber(l.value) : null;
        const b = rr.ok ? toNumber(rr.value) : null;
        if (a !== null && b !== null && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))) hit = c;
      }
      if (hit === null) return null;
      out.push(hit);
    }
    return out.length > 0 ? out : null;
  };

  /** `3(x+2) - x` (or `3(x+2) - x =`) → `3x + 6 - x`, `2x + 6`; null when there is nothing to simplify. */
  const simplifySteps = (latex: string): string[] | null => {
    try {
      // `A = \pi(5)^{2} =`: the steps of its value, carrying on the student's `=` chain
      const value = namedValue(latex);
      if (value) return simplifySteps(`${value} =`);
      // a derivative, an integral or a limit: the rule applied, then simplified (`calculus.ts`)
      const calc = calculus.steps(latex);
      if (calc) return calc;
      // exact trig values, the reference angle first (`trig.ts`)
      const trigSteps = trig.steps(latex);
      if (trigSteps) return trigSteps;
      // exponent rules, radicals, complex numbers, log properties, … (`courses.ts`); `f(4)` alone is refused
      const course = courses.simplify(latex);
      if (course === "refuse") return null;
      if (course) return course;
      // π, a root, degrees: worked out round by round, exact (`geometry.ts`)
      const geoSteps = geometry.simplify(latex);
      if (geoSteps) return geoSteps;
      const pre = preprocessLatex(latex).trim().replace(/=\s*$/, "").trim();
      if (!pre || /\d\.\d/.test(pre)) return null;
      if (splitRelations(pre).ops.length > 0) return null;
      const t = tr(pre);
      if (t.hasUnits || t.hasText || t.hasPercent || t.functions.length > 0 || isSymbolic(t)) return null;
      const unknowns = unknownsOf(t);
      if (unknowns.length === 0 || unknowns.some((v) => !/^[a-zA-Z]$/.test(v))) return null;
      const node = safeParse(math, t.source);
      if (!node) return null;
      // simplify when there is something to expand or collect; otherwise factor it (polynomial.ts)
      return simplifyExpressionSteps(node, unknowns, pre, stepKey) ?? factorExpressionSteps(node, unknowns, pre, stepKey) ?? rationalExpressionSteps(node, unknowns, pre, stepKey) ?? courses.simplifyLate(latex);
    } catch {
      return null;
    }
  };

  /**
   * `2x^{2}`, `3x + 2`: Solve on a lone expression with nothing to do. Only a polynomial the engine
   * reads term by term counts, and only when collecting it gives back what is written, in the
   * engine's own form — `\frac{8x}{2}` is one term too, but it is `4x`, and the model gets to say so.
   */
  const alreadySimplest = (latex: string): boolean => {
    try {
      const pre = preprocessLatex(latex ?? "").trim();
      if (!pre || /\d\.\d/.test(pre) || splitRelations(pre).ops.length > 0) return false;
      if (simplifySteps(latex)) return false;
      const t = tr(pre);
      if (t.hasUnits || t.hasText || t.hasPercent || t.hasPm || t.functions.length > 0 || isSymbolic(t)) return false;
      const unknowns = unknownsOf(t);
      if (unknowns.length === 0 || unknowns.some((v) => !/^[a-zA-Z]$/.test(v))) return false;
      const node = safeParse(math, t.source);
      const terms = node ? termsOf(node, unknowns) : null;
      if (!terms || terms.length === 0) return false;
      const collected = standardOrder(combineTerms(terms));
      return collected.length === terms.length && stepKey(termsLatex(collected)) === stepKey(pre);
    } catch {
      return false;
    }
  };

  const isExactValue = (r: RootValue): boolean => {
    const exactNumber = (n: number) => Number.isInteger(Number(n.toFixed(9))) || asSmallFraction(n) !== null;
    return typeof r === "number" ? exactNumber(r) : exactNumber(r.re) && exactNumber(r.im);
  };

  const sortRoots = (roots: RootValue[]): RootValue[] =>
    [...roots].sort((a, b) => {
      const na = rootToNumber(a);
      const nb = rootToNumber(b);
      if (na !== null && nb !== null) return na - nb;
      if (na !== null) return -1;
      if (nb !== null) return 1;
      return (a as { im: number }).im - (b as { im: number }).im;
    });

  /** The answer line: real roots only, as a list (`x = 2, \ x = 3`), `\varnothing` when there is none. */
  const finalLatex = (variable: string, allRoots: RootValue[], opts: NumberFormatOptions, exactHint: boolean): string => {
    const roots = allRoots.filter((r) => rootToNumber(r) !== null);
    if (roots.length === 0) return NO_SOLUTION;
    const exact = exactHint && roots.every(isExactValue);
    const seen: string[] = [];
    for (const r of sortRoots(roots)) {
      const tex = rootLatex(r, opts);
      if (!seen.includes(tex)) seen.push(tex);
    }
    const rel = exact ? "=" : "\\approx";
    return seen.map((t) => `${variable} ${rel} ${t}`).join(LIST_SEP);
  };

  // --- verify / calculate ----------------------------------------------------
  const verifyExpected = (expected: string, latex: string): "equal" | "unequal" | "unknown" => {
    try {
      const exp = safeEvaluate(math, expected, physicsScope(math));
      if (!exp.ok) return "unknown";
      const split = splitRelations(latex);
      const targetLatex = split.sides[split.sides.length - 1];
      if (!targetLatex.trim()) return "unknown";
      const t = tr(targetLatex);
      if (unknownsOf(t).length > 0) return "unknown";
      const ev = evaluateTranslated(t, targetLatex);
      if (!ev.ok) return "unknown";
      const eq = valuesMatch(math, exp.value, ev.value, { decimals: decimalsIn(targetLatex) });
      if (eq === null) return "unknown";
      return eq ? "equal" : "unequal";
    } catch {
      return "unknown";
    }
  };

  const balance = (equation: string): { coeffs: number[]; latex: string } | null => {
    try {
      const r = balanceChem(equation);
      return r ? { coeffs: r.coeffs, latex: r.latex } : null;
    } catch {
      return null;
    }
  };

  const derivativeLatex = (operand: string, variable: string, plain: boolean): string | null => {
    const t = tr(operand, plain);
    const node = math.derivative(t.source, variable);
    let simplified = node;
    try {
      simplified = math.simplify(node);
    } catch {
      simplified = node;
    }
    return nodeToLatex(simplified);
  };

  const calculate = (input: string): { latex: string } | null => {
    try {
      const s = (input ?? "").trim();
      if (!s) return null;
      const plain = !/\\/.test(s);
      let m: RegExpExecArray | null;
      if ((m = /^balance\s+(.+)$/i.exec(s))) {
        const r = balance(m[1]);
        return r ? { latex: r.latex } : null;
      }
      if (looksLikeChemEquation(s)) {
        const r = balance(s);
        return r ? { latex: r.latex } : null;
      }
      if ((m = /^(?:molar\s*mass|mass)\s+(?:of\s+)?(.+)$/i.exec(s))) {
        const tex = molarMassLatex(m[1]);
        return tex ? { latex: tex } : null;
      }
      if ((m = /^solve\s+(.+)$/i.exec(s))) {
        const r = solveLatex(m[1]);
        return r ? { latex: r.latex } : null;
      }
      if ((m = /^d\s*\/\s*d([a-zA-Z])\s*(.+)$/.exec(s))) {
        const tex = derivativeLatex(m[2], m[1], plain);
        return tex ? { latex: tex } : null;
      }
      if ((m = /^(?:derivative|differentiate|diff)\s+(?:of\s+)?(.+?)(?:\s+(?:wrt|with respect to)\s+([a-zA-Z]))?$/i.exec(s))) {
        const tex = derivativeLatex(m[1], m[2] ?? "x", plain);
        return tex ? { latex: tex } : null;
      }
      if ((m = /^(?:integrate|integral(?:\s+of)?)\s+(.+?)\s+from\s+(\S+)\s+to\s+(\S+)(?:\s+d([a-zA-Z]))?$/i.exec(s))) {
        const variable = m[4] ?? "x";
        const t = tr(m[1], plain);
        const lo = tr(m[2], plain).source;
        const hi = tr(m[3], plain).source;
        const res = safeEvaluate(math, `integral(${JSON.stringify(t.source)}, ${JSON.stringify(variable)}, ${lo}, ${hi})`);
        if (!res.ok) return null;
        return { latex: valueToLatex(res.value, { preferFraction: false }) };
      }
      const t = tr(s, plain);
      if (!t.source.trim()) return null;
      const unknowns = unknownsOf(t);
      if (unknowns.length > 0 && !t.functions.includes("derivative") && !t.functions.includes("integral")) {
        const simplified = math.simplify(t.source);
        const tex = nodeToLatex(simplified);
        return tex ? { latex: tex } : null;
      }
      if (trig.value(t.source)?.kind === "undefined") return null; // tan 90°: no value, not 1.633 × 10¹⁶
      const ev = evaluateTranslated(t, s);
      if (!ev.ok) return null;
      return ev.latex ? { latex: ev.latex } : null;
    } catch {
      return null;
    }
  };

  const systemDeps: SystemDeps = {
    parse: (latex) => {
      try {
        const pre = preprocessLatex(latex);
        const split = splitRelations(pre);
        if (split.sides.length !== 2 || split.ops[0] !== "==") return null;
        const [L, R] = split.sides.map((side) => tr(side));
        if (L.hasUnits || R.hasUnits || isSymbolic(L) || isSymbolic(R)) return null;
        return { lhs: L.source, rhs: R.source, unknowns: [...new Set([...unknownsOf(L), ...unknownsOf(R)])], latex: pre };
      } catch {
        return null;
      }
    },
    // a substituted line whose unknown cancels is the system's own case (`cancelled`), not an answer
    solveOne: (latex) => (systemDeps.cancelled?.(latex) ? null : solveLatex(latex)),
    cancelled: (latex) => {
      try {
        const linear = linearSteps(latex);
        if (!linear || linear.outcome === "solved") return null;
        return { steps: linear.steps, outcome: linear.outcome };
      } catch {
        return null;
      }
    },
    singleRoot: (latex, variable) => {
      const rel = systemDeps.parse(latex);
      if (!rel || rel.unknowns.length !== 1 || rel.unknowns[0] !== variable) return null;
      const info = equationRoots(math, { op: "==", lhs: rel.lhs, rhs: rel.rhs, source: `${rel.lhs} == ${rel.rhs}`, variables: [variable] }, variable);
      if (!info.roots || info.identity || info.roots.length !== 1) return null;
      return rootToNumber(info.roots[0]);
    },
    evalG: (lhs, rhs, scope) => {
      const res = safeEvaluate(math, `(${lhs}) - (${rhs})`, scope);
      if (!res.ok) return null;
      const n = toNumber(res.value);
      return n === null || !Number.isFinite(n) ? null : n;
    },
    // a substituted line with the unknown squared (`(w + 3)w = 40`): exact steps and roots
    solveRoots: (latex) => {
      try {
        return solveExactly(latex, advancedDeps);
      } catch {
        return null;
      }
    },
    fmt: (n) => formatNumberLatex(n, { preferFraction: true }),
    normalize: normalizeLatex,
  };

  /**
   * A young student's line of working under a problem with no letters (`primaryWork.ts`), as a line
   * analysis: the line's own analysis (its kind and maths, as any line's), its mark and whether it
   * solves the problem judged against the problem. Null when it is not such a line.
   */
  const judgeWork: NonNullable<LiveEngine["judgeWork"]> = ({ problem, above, latex, ctx }) => {
    try {
      const judged = judgePrimaryLine(problem, above, latex);
      if (!judged) return null;
      const kind = judged.relation ? "equation" : "expression";
      const own = analyzeLine(latex, ctx);
      const same = own.kind === kind;
      const out: LineAnalysis = { kind, math: same && own.math ? own.math : judged.math, resultLatex: same ? own.resultLatex : "", verdict: judged.verdict, note: judged.note };
      if (judged.solved) out.solved = true;
      if (judged.bare) out.bareAnswer = true;
      if (judged.carried) out.carried = true;
      return out;
    } catch {
      return null;
    }
  };

  return {
    analyzeLine,
    judgeWork,
    solveFromLines: (lines: readonly string[]) => {
      try {
        // `\frac{dy}{dx}` / `f'(2)` under a definition, or a calculus line under a system: calculus answers
        const calc = calculus.fromLines(lines);
        // `\lim_{x \to \infty} f(x) =` under the definition of f: the definition put in, then the limit (`courses.ts`)
        if (calc === null) return courses.calculusOfDefined(lines, calculus.fromLines);
        if (calc !== undefined) return calc;
        // function notation, lines through points, sequences, … (`courses.ts`); then the systems; then a formula for a letter
        const course = courses.fromLines(lines);
        if (course === "refuse") return null;
        if (course) return course;
        // a formula under its values, parts defined in x, coordinates (`geometry.ts`)
        const geo = geometry.fromLines(lines);
        if (geo === "refuse") return null;
        if (geo) return geo;
        return solveFromLines(lines, systemDeps) ?? courses.fromLinesLate(lines);
      } catch {
        return null;
      }
    },
    compileExpr: (expr: string) => {
      try {
        return compileExpr(math, expr);
      } catch {
        return null;
      }
    },
    solveLatex,
    simplifySteps,
    alreadySimplest,
    graphFor: (lines: readonly string[]) => {
      try {
        return graphing.graphFor(lines);
      } catch {
        return null;
      }
    },
    verifyExpected,
    balance,
    calculate,
  };
}

// --- lazy singleton ----------------------------------------------------------
const stub: LiveEngine = {
  analyzeLine: () => ({ ...UNKNOWN }),
  compileExpr: () => null,
  solveLatex: () => null,
  solveFromLines: () => null,
  simplifySteps: () => null,
  alreadySimplest: () => false,
  graphFor: () => null,
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};

let enginePromise: Promise<LiveEngine> | null = null;

/** Lazily loads mathjs once and builds the engine. Safe to call at mount to pre-warm; never rejects. */
export function getEngine(): Promise<LiveEngine> {
  if (!enginePromise) {
    enginePromise = import("mathjs")
      .then((mod) => createEngine(mod))
      .catch(() => stub);
  }
  return enginePromise;
}

export { latexToMath };
