/**
 * Local STEM engine (WP-B). `getEngine()` loads mathjs once and resolves the real `LiveEngine`.
 * Pure TypeScript: no DOM, no React, no tldraw. Every entry point catches and degrades to
 * kind 'unknown' / verdict 'unknown' / null — the engine never throws.
 */
import type { MathJsInstance } from "mathjs";
import type { AnalyzeContext, EngineVerdict, LineAnalysis, LiveEngine } from "../contracts";
import { balance as balanceChem, balanceEquation, equationLatex, isBalanced, molarMassLatex, normalizeChemText, parseEquation, looksLikeChemEquation } from "./chem";
import { preClassify } from "./classify";
import { PHYSICS_SCOPE_NAMES, physicsScope } from "./constants";
import {
  compareRelations,
  compareValuesToRelation,
  decimalsIn,
  equationRoots,
  expressionsEquivalent,
  parseRelation,
  rootToNumber,
  solvesRelation,
  type Relation,
  type RootValue,
} from "./equivalence";
import { asSmallFraction, complexToLatex, formatNumberLatex, nodeToLatex, valueToLatex, type NumberFormatOptions } from "./format";
import { compileExpr, plotFor } from "./graph";
import { APPROX_OP, latexToMath, preprocessLatex, splitRelations, UnsupportedLatex, type Translated } from "./latex";
import { countOperations, createMathInstance, integralsExact, isComplexValue, isNodeValue, isUnitValue, safeEvaluate, safeParse, toNumber, translate, type MathModule } from "./math";
import { evaluateUnits, unitValueToLatex, valuesMatch } from "./units";

const UNKNOWN: LineAnalysis = { kind: "unknown", math: "", resultLatex: "", verdict: "unknown", note: "" };

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

const TRIG = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "asin", "acos", "atan", "sinh", "cosh", "tanh"]);

/**
 * Calculus/aggregate calls the engine evaluates even when the line still mentions a variable:
 * `\frac{d}{dx} x^3` is an answerable line whose answer contains x.
 */
const SYMBOLIC_FUNCTIONS: ReadonlySet<string> = new Set(["derivative", "integral", "summation"]);

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
  return { preferFraction: !decimals && !t.hasDegrees && !trig && !t.hasUnits && !numeric && !t.hasPercent };
}

function rootLatex(r: RootValue, opts: NumberFormatOptions = { preferFraction: true }): string {
  const n = rootToNumber(r);
  if (n !== null) return formatNumberLatex(n, opts);
  return complexToLatex(r as { re: number; im: number }, opts);
}

/** Splits `2, -2` / `2 \text{ or } -2` / `x = 2 \text{ or } x = -2` into value LaTeX fragments. */
function splitValueList(rhsLatex: string, variable: string): string[] {
  const s = rhsLatex.replace(/\\text\s*\{\s*or\s*\}|\\quad|\\;|\\,|\bor\b/g, ",");
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
  const s = latex.replace(/\\text\s*\{\s*(?:or|and)\s*\}|\\quad|\\qquad|\\;|\bor\b/g, ",");
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

export function createEngine(mod: MathModule): LiveEngine {
  const math = createMathInstance(mod);

  const tr = (latex: string, plain = false): Translated => translate(math, latex, { plain });

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
      const out: LineAnalysis = { kind: "expression", math: t.source, resultLatex: "", verdict: "none", note: ev.note };
      if (t.hasUnits) out.units = { ok: ev.ok };
      if (ev.error) out.error = ev.error;
      if (ev.ok) {
        if (trailingEquals) out.resultLatex = ctx.mode === "answer" ? ev.latex : "";
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
      let verdict: EngineVerdict = "ok";
      for (let i = 1; i < evals.length; i++) {
        const decimals = Math.max(decimalsIn(sides[0]) ?? -1, decimalsIn(sides[i]) ?? -1);
        const eq = valuesMatch(math, evals[0].value, evals[i].value, { decimals: decimals < 0 ? null : decimals, loose });
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
        else if (prevRel) out.verdict = compareRelations(math, prevRel, rel, variable);
        return out;
      }
      const out: LineAnalysis = { kind: "equation", math: source, resultLatex: "", verdict: "unknown", note: "" };
      if (claim) out.verdict = expressionsEquivalent(math, L.source, R.source, unknowns);
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

  /** `x = 4`, `x = \pm 2`, `x = 2, -2`, `F = 2 kg * 9.8 m/s^2` */
  const analyzeSolvedOrAssignment = (variable: string, rhsLatex: string, ctx: AnalyzeContext): LineAnalysis => {
    const decimals = decimalsIn(rhsLatex);
    const fragments = splitValueList(rhsLatex, variable);
    const values: RootValue[] = [];
    let valueLatex = "";
    let unitsOk: boolean | undefined;
    let note = "";
    const translations = (fragments.length > 0 ? fragments : [rhsLatex]).map((f) => tr(f));
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
        }
      }
    }
    const prevRel = relationFromAnalysis(math, ctx.previous, variable);
    const origRel = relationFromAnalysis(math, ctx.original, variable);
    const reference = prevRel ?? origRel;
    if (reference && values.length > 0) {
      const out: LineAnalysis = { kind: "equation", math: values.length > 1 ? `${productSource(values)} == 0` : `${variable} == ${R.source}`, resultLatex: "", verdict: "none", note: "", variable };
      out.solutions = values.map((v) => rootLatex(v));
      out.verdict = compareValuesToRelation(math, reference, variable, values, decimals);
      const target = origRel ?? prevRel;
      out.solved = out.verdict !== "mismatch" && target !== null && solvesRelation(math, target, variable, values, decimals);
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

  // --- entry points --------------------------------------------------------
  const analyze = (latex: string, ctx: AnalyzeContext): LineAnalysis => {
    // preClassify needs the raw line (it tells "decorations only" from "empty"), so the rewritten
    // form is only substituted when a rewrite actually happened.
    const cleaned = preprocessLatex(latex);
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
              if (a.kind === "expression" && !a.error) return a;
            }
          } catch (e) {
            // `\lim ... =`, `\begin{pmatrix} ... =`: not an unfinished line, a line we cannot read
            if (e instanceof UnsupportedLatex) return { ...UNKNOWN, error: errorMessage(e) };
          }
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
            out.verdict = expressionsEquivalent(math, prev.plot.expr, out.plot.expr, ["x"]);
          }
        } catch (e) {
          out.error = errorMessage(e);
        }
        return out;
      }
      default: {
        const orList = solutionList(pre.latex);
        if (orList) return analyzeSolvedOrAssignment(orList.variable, orList.values.join(", "), ctx);
        const split = splitRelations(pre.latex);
        if (split.ops.length === 0) return analyzeExpression(pre.latex, ctx, false);
        return analyzeRelation(pre.latex, ctx);
      }
    }
  };

  const analyzeLine = (latex: string, ctx: AnalyzeContext): LineAnalysis => {
    try {
      return analyze(latex ?? "", ctx ?? { mode: "feedback" });
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

  const solveLatex = (latex: string): { latex: string; steps: string[] } | null => {
    try {
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
      const opts: NumberFormatOptions = { preferFraction: true };
      const fmt = (n: number) => formatNumberLatex(n, opts);
      const c = info.coefficients;
      const lastIsZero = R.source.trim() === "0";
      if (c && info.exact && c.length === 2) {
        const [c0, c1] = c;
        if (Math.abs(c0) > 1e-12 && Math.abs(c1 - 1) > 1e-12) steps.push(`${fmt(c1)}${variable} = ${fmt(-c0)}`);
        else if (Math.abs(c0) > 1e-12 && !/^-?\d/.test(pre) && !new RegExp(`^${variable}\\s*=`).test(pre)) steps.push(`${variable} = ${fmt(-c0)}`);
        const root = -c0 / c1;
        const final = `${variable} = ${fmt(root)}`;
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
          steps.push(`${variable} = \\frac{${fmt(-c1)} \\pm \\sqrt{${fmt(c1)}^{2} - 4 \\cdot ${fmt(c2)} \\cdot ${fmt(c0)}}}{2 \\cdot ${fmt(c2)}}`);
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
      const final = finalLatex(variable, info.roots, { preferFraction: false }, false);
      steps.push(final);
      return { latex: final, steps };
    } catch {
      return null;
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

  const finalLatex = (variable: string, roots: RootValue[], opts: NumberFormatOptions, exactHint: boolean): string => {
    const exact = exactHint && roots.every(isExactValue);
    const seen: string[] = [];
    for (const r of sortRoots(roots)) {
      const tex = rootLatex(r, opts);
      if (!seen.includes(tex)) seen.push(tex);
    }
    const rel = exact ? "=" : "\\approx";
    return seen.map((t) => `${variable} ${rel} ${t}`).join(" \\text{ or } ");
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
      const ev = evaluateTranslated(t, s);
      if (!ev.ok) return null;
      return ev.latex ? { latex: ev.latex } : null;
    } catch {
      return null;
    }
  };

  return {
    analyzeLine,
    compileExpr: (expr: string) => {
      try {
        return compileExpr(math, expr);
      } catch {
        return null;
      }
    },
    solveLatex,
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
