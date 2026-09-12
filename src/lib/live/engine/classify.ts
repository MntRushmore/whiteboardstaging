/**
 * Line classification heuristics that run BEFORE translation (pure string work, no mathjs):
 * label (problem numbers, single letters, bare small integers), incomplete (trailing operator /
 * unbalanced brackets / empty groups), chem (arrow + element formulas), point `(a, b)`,
 * function `y = f(x)` / `f(x) = ...`, and prose.
 * The final LineKind (expression / equation / assignment / inequality) is decided in index.ts.
 */
import { FUNCTION_WORDS, preprocessLatex, splitRelations } from "./latex";
import { looksLikeChemEquation, looksLikeChemFormula } from "./chem";

export type PreKind = "empty" | "label" | "incomplete" | "chem" | "chemFormula" | "point" | "function" | "text";

export interface FunctionInfo {
  /** 'y' or the function name (f) */
  name: string;
  /** independent variable (x, t, ...) */
  param: string;
  /** raw LaTeX right-hand side */
  rhs: string;
}

export interface PointInfo {
  x: string;
  y: string;
}

export interface PreClassification {
  kind: PreKind | null;
  /** normalized LaTeX */
  latex: string;
  /** set when kind === 'incomplete' because the line ends in '=' */
  trailingEquals?: boolean;
  /** LaTeX before the trailing '=' */
  lhs?: string;
  fn?: FunctionInfo;
  point?: PointInfo;
}

const LABEL_PATTERNS: RegExp[] = [
  /^\(?\d{1,3}\s*[.):]\)?$/, // 1)  1.  (1)  12:
  /^\(?\d{1,2}\)?$/, // 3  (7)
  /^\(?[a-zA-Z]\s*[.):]\)?$/, // a)  b.  (c)
  /^\([a-zA-Z]\)$/,
  /^[a-zA-Z]$/, // lone letter
  /^\d{1,3}[a-z][.):]?$/, // 1a  2b)  (but not `2 g`)
  /^\(?(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)\s*[.):]\)?$/i,
  /^(?:Q|q|No|no|#|Problem|problem|Ex|ex|Exercise|exercise|Part|part|Step|step)\.?\s*\d+\s*[.):]?$/,
  /^#\s*\d+$/,
];

export function isLabel(latex: string): boolean {
  const s = preprocessLatex(latex).replace(/\\text\{([^}]*)\}/g, "$1").replace(/\s+/g, " ").trim();
  if (!s) return false;
  return LABEL_PATTERNS.some((re) => re.test(s));
}

/** `{ ( [ | \left` balance, ignoring escaped braces. */
export function bracketsBalanced(latex: string): boolean {
  let brace = 0;
  let paren = 0;
  let square = 0;
  let left = 0;
  let bars = 0;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(latex.slice(i));
      if (m) {
        const name = m[1];
        if (name === "left") left++;
        else if (name === "right") left--;
        else if (name === "|" || name === "lvert" || name === "rvert" || name === "vert") bars++;
        else if (name === "{") brace++;
        else if (name === "}") brace--;
        i += m[0].length - 1;
      }
      continue;
    }
    if (ch === "{") brace++;
    else if (ch === "}") brace--;
    else if (ch === "(") paren++;
    else if (ch === ")") paren--;
    else if (ch === "[") square++;
    else if (ch === "]") square--;
    else if (ch === "|") bars++;
    if (brace < 0 || paren < 0 || square < 0 || left < 0) return false;
  }
  return brace === 0 && paren === 0 && square === 0 && left === 0 && bars % 2 === 0;
}

const TRAILING_OP = /(?:[+\-*/^=<>]|\\(?:cdot|times|div|pm|mp|le|ge|ne|leq|geq|neq|to|rightarrow|Rightarrow|frac|sqrt)\s*)$/;
const LEADING_OP = /^(?:[+*/^=<>]|\\(?:cdot|times|div|le|ge|ne|leq|geq|neq))\s*/;
const EMPTY_GROUP = /\{\s*\}/;

export interface IncompleteInfo {
  incomplete: boolean;
  trailingEquals: boolean;
  lhs: string;
}

export function incompleteInfo(latex: string): IncompleteInfo {
  const s = preprocessLatex(latex);
  const none = { incomplete: false, trailingEquals: false, lhs: "" };
  if (!s) return none;
  if (/=\s*$/.test(s) && !/[<>!]=\s*$/.test(s)) {
    return { incomplete: true, trailingEquals: true, lhs: s.replace(/=\s*$/, "").trim() };
  }
  if (TRAILING_OP.test(s)) return { incomplete: true, trailingEquals: false, lhs: "" };
  if (LEADING_OP.test(s)) return { incomplete: true, trailingEquals: false, lhs: "" };
  if (EMPTY_GROUP.test(s)) return { incomplete: true, trailingEquals: false, lhs: "" };
  if (!bracketsBalanced(s)) return { incomplete: true, trailingEquals: false, lhs: "" };
  return none;
}

export function isIncomplete(latex: string): boolean {
  return incompleteInfo(latex).incomplete;
}

const FN_DEF = /^([a-zA-Z])\s*(?:\\left)?\(\s*([a-zA-Z])\s*(?:\\right)?\)\s*=\s*([^=]+)$/;
const Y_DEF = /^y\s*=\s*([^=]+)$/;

/** `y = 2x + 1`, `f(x) = x^2`, `g(t) = \sin t`; null when the right side does not use the parameter. */
export function functionInfo(latex: string): FunctionInfo | null {
  const s = preprocessLatex(latex);
  const fm = FN_DEF.exec(s);
  if (fm) {
    const [, name, param, rhs] = fm;
    if (!usesSymbol(rhs, param)) return null;
    return { name, param, rhs: rhs.trim() };
  }
  const ym = Y_DEF.exec(s);
  if (ym) {
    const rhs = ym[1].trim();
    if (usesSymbol(rhs, "y")) return null;
    if (usesSymbol(rhs, "x")) return { name: "y", param: "x", rhs };
    return null;
  }
  return null;
}

/** does the LaTeX use the letter `sym` (commands, \text groups and function words removed; `2x`, `xy` count)? */
export function usesSymbol(latex: string, sym: string): boolean {
  const stripped = latex
    .replace(/\\(?:text|mathrm|textrm|mbox)\s*\{[^}]*\}/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[a-zA-Z]{2,}/g, (w) => (FUNCTION_WORDS[w] ? " " : w));
  return stripped.includes(sym);
}

const POINT_RE = /^(?:\\left)?\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*(?:\\right)?\)$/;

export function pointInfo(latex: string): PointInfo | null {
  const s = preprocessLatex(latex);
  const m = POINT_RE.exec(s);
  if (!m) return null;
  return { x: m[1].trim(), y: m[2].trim() };
}

const PROSE_ALLOWED = new Set([
  ...Object.keys(FUNCTION_WORDS),
  "deg",
  "mol",
  "mph",
  "kph",
  "rad",
  "atm",
  "bar",
  "cal",
  "kcal",
  "psi",
  "rpm",
  "hour",
  "min",
  "sec",
  "and",
  "or",
  "to",
  "in",
  "for",
  "with",
  "dx",
  "dy",
  "dt",
  "mod",
  "gram",
  "grams",
  "meter",
  "meters",
  "metre",
  "liter",
  "litre",
  "second",
  "seconds",
  "minute",
  "minutes",
  "hours",
  "newton",
  "joule",
  "watt",
  "volt",
  "kelvin",
  "mole",
  "moles",
  "degrees",
  "degC",
  "degF",
]);

/** Words of >= 4 letters that are not functions/units/greek make a line prose (`solve for x`, `Answer`). */
export function looksLikeProse(latex: string): boolean {
  const s = preprocessLatex(latex);
  if (!s) return false;
  let plain = s.replace(/\\text\s*\{\s*(or|and)\s*\}/g, " ");
  const textGroups = plain.match(/\\(?:text|mathrm|textrm|mbox)\s*\{([^}]*)\}/g) ?? [];
  for (const g of textGroups) {
    const inner = g.replace(/^\\[a-zA-Z]+\s*\{/, "").replace(/\}$/, "").trim();
    const words = inner.split(/\s+/).filter(Boolean);
    if (words.length >= 3) return true;
    if (words.some((w) => /^[a-zA-Z]{4,}$/.test(w) && !PROSE_ALLOWED.has(w) && !PROSE_ALLOWED.has(w.toLowerCase()))) {
      if (!/^[A-Z][a-z]?$/.test(inner)) return true;
    }
  }
  plain = plain.replace(/\\[a-zA-Z]+/g, " ").replace(/[{}]/g, " ");
  const runs = plain.match(/[a-zA-Z]{4,}/g) ?? [];
  return runs.some((w) => !PROSE_ALLOWED.has(w) && !PROSE_ALLOWED.has(w.toLowerCase()));
}

export function preClassify(latex: string): PreClassification {
  const s = preprocessLatex(latex);
  if (!s) return { kind: "empty", latex: s };
  if (isLabel(s)) return { kind: "label", latex: s };
  const inc = incompleteInfo(s);
  if (inc.incomplete) return { kind: "incomplete", latex: s, trailingEquals: inc.trailingEquals, lhs: inc.lhs };
  if (looksLikeChemEquation(s)) return { kind: "chem", latex: s };
  const point = pointInfo(s);
  if (point) return { kind: "point", latex: s, point };
  const fn = functionInfo(s);
  if (fn) return { kind: "function", latex: s, fn };
  if (looksLikeProse(s)) return { kind: "text", latex: s };
  if (splitRelations(s).ops.length === 0 && looksLikeChemFormula(s)) return { kind: "chemFormula", latex: s };
  return { kind: null, latex: s };
}
