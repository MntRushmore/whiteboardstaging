import { splitAtCommas } from "./compound";
import { preprocessLatex, splitRelations } from "./latex";

/**
 * A problem written with where its unknown lives, on the same line:
 *
 *   2\cos x = 1, 0^{\circ} \le x < 360^{\circ}      \sin x = -\frac{1}{2}, \ 0 \le x < 2\pi
 *   \tan x = \sqrt{3}, \quad x \in [0, 360^{\circ})
 *
 * That is an EQUATION and a DOMAIN, not one inequality: the equation is what the student works,
 * step by step, and the domain is which of its solutions the answer lists. Pure string parsing —
 * the engine (`index.ts`) reads the bounds' values; the trig solver (`trigEquation.ts`) reads the
 * `\in` form through `domainChain`.
 */

export interface DomainBounds {
  /** the unknown as written (`x`, `\theta`) */
  variable: string;
  loTex: string;
  hiTex: string;
  loIn: boolean;
  hiIn: boolean;
}

/** A lone unknown: one letter, or a Greek one. */
const VARIABLE = /^(?:[a-zA-Z]|\\(?:theta|alpha|beta|phi|varphi|gamma|omega|psi))$/;

function variableOf(s: string): string | null {
  const v = s.replace(/\s+/g, "").replace(/^\{(.*)\}$/, "$1");
  return VARIABLE.test(v) ? v : null;
}

/** The equation names the unknown: `x` on its own (not the x of `\exp`), `\theta` anywhere. */
function usesVariable(latex: string, variable: string): boolean {
  if (variable.startsWith("\\")) return new RegExp(`\\${variable}(?![a-zA-Z])`).test(latex);
  return new RegExp(`(^|[^a-zA-Z\\\\])${variable}(?![a-zA-Z])`).test(latex);
}

/** Where a top-level comma splits `inner` (`0, 360^{\circ}`); null for none or several. */
function splitPair(inner: string): [string, string] | null {
  let depth = 0;
  let at = -1;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0 && inner[i - 1] !== "\\") {
      if (at !== -1) return null;
      at = i;
    }
  }
  if (at === -1) return null;
  const a = inner.slice(0, at).trim();
  const b = inner.slice(at + 1).trim();
  return a && b ? [a, b] : null;
}

/**
 * A domain on its own: `0^{\circ} \le x < 360^{\circ}` (a chain with the unknown in the middle,
 * `<` or `\le` both sides), or `x \in [0, 2\pi)` (interval notation, `\left[`…`\right)` too).
 * Null for anything else — a one-sided inequality is an answer, not a domain.
 */
export function parseDomainPiece(latex: string): DomainBounds | null {
  const s = preprocessLatex(latex).replace(/^(?:\s|\\[ ,;:!]|\\q?quad)+|(?:\s|\\[ ,;:!]|\\q?quad)+$/g, "");
  if (!s) return null;
  const inMatch = /^(.+?)\s*\\in\s*(?:\\left\s*)?([[(])([\s\S]*?)(?:\\right\s*)?([\])])$/.exec(s);
  if (inMatch) {
    const variable = variableOf(inMatch[1]);
    const pair = splitPair(inMatch[3]);
    if (!variable || !pair) return null;
    return { variable, loTex: pair[0], hiTex: pair[1], loIn: inMatch[2] === "[", hiIn: inMatch[4] === "]" };
  }
  const split = splitRelations(s);
  if (split.sides.length !== 3 || !split.ops.every((o) => o === "<" || o === "<=")) return null;
  const variable = variableOf(split.sides[1]);
  if (!variable || !split.sides[0] || !split.sides[2]) return null;
  return { variable, loTex: split.sides[0], hiTex: split.sides[2], loIn: split.ops[0] === "<=", hiIn: split.ops[1] === "<=" };
}

/**
 * `2\cos x = 1, 0^{\circ} \le x < 360^{\circ}` → the equation and its domain (either order, split
 * at a comma or a `\quad`). Null when the line is not exactly one relation with `=` and one domain
 * on a lone unknown the equation uses.
 */
export function splitDomain(latex: string): { equation: string; domain: string; bounds: DomainBounds } | null {
  const pre = preprocessLatex(latex ?? "").replace(/\\q?quad\b/g, ",");
  if (!/\\l(?:e|eq|t)(?![a-z])|<|\\in(?![a-z])/.test(pre)) return null;
  const parts = splitAtCommas(pre);
  if (!parts || parts.length < 2) return null;
  // the domain is the last piece (or the first); the rest is the equation, commas and all (`x = 1, 2`)
  for (const [domainAt, rest] of [
    [parts.length - 1, parts.slice(0, -1)],
    [0, parts.slice(1)],
  ] as const) {
    const bounds = parseDomainPiece(parts[domainAt]);
    if (!bounds) continue;
    const equation = rest.join(", ");
    const split = splitRelations(equation);
    if (split.ops.length !== 1 || split.ops[0] !== "==") continue;
    if (!usesVariable(equation, bounds.variable)) continue;
    return { equation, domain: parts[domainAt], bounds };
  }
  return null;
}

/** The domain as the chain the trig solver reads: `0 \le x < 2\pi` (the `\in` form rewritten). */
export function domainChain(b: DomainBounds): string {
  return `${b.loTex} ${b.loIn ? "\\le" : "<"} ${b.variable} ${b.hiIn ? "\\le" : "<"} ${b.hiTex}`;
}

/** Trig of the unknown on the line: its domain is in angles. */
export function isTrigLine(latex: string): boolean {
  return /\\(?:sin|cos|tan|sec|csc|cot)(?![a-z])/.test(latex);
}

/**
 * The domain the lines above set, as a chain (`0 \le x < 2\pi`): the last line that is a domain on
 * its own, or an equation with its domain. Null when none does.
 */
export function domainAbove(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    const split = splitDomain(line);
    if (split) return domainChain(split.bounds);
    const alone = parseDomainPiece(line);
    if (alone) return domainChain(alone);
  }
  return null;
}
