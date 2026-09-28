/**
 * Both-sides operation lines: the notation a class writes UNDER an equation to say what it does to
 * both sides next. Algebra 1's commonest line of working after the equations themselves:
 *
 *     2x + 3 = 11          2x = 8            2\sin x = 1
 *       -3    -3         ÷2    ÷2          ‾‾‾‾‾‾‾‾‾‾‾‾‾
 *                                               2
 *
 * It is not an expression: read as one, `-3 \quad -3` is -6 and was judged against the equation
 * above it (nonsense), and a bar with a `2` under it was a drawing and a lone `2` (silent). Here
 * it is a line kind of its own, `operation`, with the operation and its operand:
 *
 *  - TWICE, once under each side (or three times under a chain `a < px + q < b`): `-3 \quad -3`,
 *    `+5+5`, `-2x - 2x`, `-\frac{1}{2} \quad -\frac{1}{2}`, `\div 2 \div 2`, `/2 \quad /2`,
 *    `\times 3 \times 3`, `\cdot 3 \quad \cdot 3`, `\frac{}{2}` twice. The same operation under
 *    each side; two different operands (`-3 \quad -4`) is the classic mistake and a `mismatch`.
 *    Two different operations (`-3 \quad +3`) are not read as an operation line at all.
 *  - ONCE, as a divisor or a factor: `\div 2`, `/2`, `\frac{}{2}`, `\frac{\square}{2}`,
 *    `\overline{2}`, `\times 3`. A lone `-3` is a number, never an operation.
 *  - A BAR under the whole equation with the divisor under it: `diagrams.ts` finds the bar
 *    (`DivisionBar`), the loop reads the bar and what is under it together and writes the line as
 *    `\div 2` (`barDivisionLatex`).
 *
 * What Mathpix returns for them (the tutor's hand writing as the student, clean / slanted / steep
 * / messy, 39 calls): `-3` under each side → `\begin{array}{ll} -3 & -3 \end{array}` or
 * `-3 \quad-3`; `-3` and `-4` → `-3 \quad-4`; `÷2 ÷2` → `\div 2 \div 2`; `÷2` once → `\div 2`;
 * `×3 ×3` → `\times 3 \times 3`; `+5 +5` → `+5+5`; `-2x -2x` → `-2 x-2 x`; `-½ -½` →
 * `-\frac{1}{2} \quad-\frac{1}{2}`; a bar with `2` (or `4`, or `-3`) under it → `2` (`4`, `-3`) —
 * the bar is dropped; `/2 /2` → `1212` or `12 / 2` (the hand's slash is a 1), but a slash leaning
 * well over reads `/ 2 \quad / 2`; `·3 ·3` → `3.3` (the dot is a decimal point). The last two are
 * in the grammar, for when the ink says so; a read that is a number is never taken for one.
 *
 * The verdict, against the line above in the column (an equation, an inequality, or a chain —
 * the problem the tutor wrote counts, `LiveLoop.columnHeads`): `ok` for the same valid operation
 * on every side; `mismatch` for different operands, or multiplying or dividing by 0; `none` when
 * it cannot say (multiplying or dividing by an expression in a letter, which may be 0 — dividing
 * `x^2 = 3x` by x loses x = 0 —, or a number of operands that does not match the sides). Dividing
 * an inequality by a negative is a valid operation: the NEXT line must turn the sign round, and
 * the ordinary equivalence check of that line says whether it did.
 *
 * The line after an operation line is checked against the equation ABOVE the operation line
 * (`LiveLoop.columnContext`, `localSolve`'s `contextAbove` skip operation lines), so what counts is
 * that it is equivalent — not that it followed from the operation written.
 *
 * Pure string work: no mathjs. `engine/index.ts` asks `parseOperationLine` first in `analyzeLine`
 * and works out the equation the operation leads to (`operationResult`).
 */

import type { LineAnalysis } from "../contracts";

/** The operation a line of operation stands for, on the analysis (`LineAnalysis.operation`). */
export type OperationInfo = NonNullable<LineAnalysis["operation"]>;
export type OperationOp = OperationInfo["op"];

export interface ParsedOperation {
  op: OperationOp;
  /** the operand as written, sign included for × and ÷ (`3`, `2x`, `\frac{1}{2}`, `-3`) */
  operands: string[];
  /** under each side (two or three operands) or once, a divisor or a factor in the margin */
  form: "both" | "once";
}

const SIDE_OPS = /(?:<=|>=|==|<|>)/g;

/** `\div 2` → divide; the operator families a line may repeat. */
const OPERATORS: ReadonlyArray<[RegExp, OperationOp]> = [
  [/^\\div(?![a-zA-Z])/, "divide"],
  [/^\//, "divide"],
  [/^\\times(?![a-zA-Z])/, "multiply"],
  [/^\\cdot(?![a-zA-Z])/, "multiply"],
  [/^\\ast(?![a-zA-Z])/, "multiply"],
  [/^\*/, "multiply"],
  [/^\+/, "add"],
  [/^-/, "subtract"],
];

/**
 * The line flattened to one row of tokens: an array's cells side by side (Mathpix wrote `-3`
 * under each side as `\begin{array}{ll} -3 & -3 \end{array}`), spacing and `\left` / `\right`
 * gone, the unicode signs as commands. Null for two rows.
 */
export function flattenOperationLatex(latex: string): string | null {
  let s = (latex ?? "")
    .replace(/\\begin\{(?:array|aligned|matrix|gathered)\}(?:\{[^{}]*\})?/g, " ")
    .replace(/\\end\{(?:array|aligned|matrix|gathered)\}/g, " ");
  if (/\\\\/.test(s)) return null;
  s = s
    .replace(/&/g, " ")
    .replace(/\\(?:qquad|quad)(?![a-zA-Z])/g, " ")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/~/g, " ")
    .replace(/\\left\s*([([])/g, "$1")
    .replace(/\\right\s*([)\]])/g, "$1")
    .replace(/\\[dt]frac(?![a-zA-Z])/g, "\\frac")
    // `\text { -3 }`: a number Mathpix put in a text box
    .replace(/\\(?:text|mathrm)\s*\{([-+0-9.\s/]*)\}/g, " $1 ")
    .replace(/÷/g, "\\div ")
    .replace(/[×✕]/g, "\\times ")
    .replace(/[·⋅]/g, "\\cdot ")
    .replace(/[−–]/g, "-");
  return s.replace(/\s+/g, " ").trim();
}

const NUMBER = String.raw`\d+(?:\.\d+)?`;
const PART = String.raw`\s*[0-9a-zA-Z.]+(?:\s*[0-9a-zA-Z.]+)*\s*`;
const FRACTION = String.raw`\\frac\s*\{${PART}\}\s*\{${PART}\}`;
const LETTER = String.raw`[a-zA-Z](?:\s*\^\s*(?:\{\s*\d+\s*\}|\d))?`;
/** a simple term: a number or a fraction, then letters with small powers; or a fraction of letters */
const TERM = String.raw`(?:(?:${NUMBER}|${FRACTION})(?:\s*${LETTER})*|(?:${LETTER})(?:\s*${LETTER})*)`;
const TERM_RE = new RegExp(`^${TERM}`);
const SIGNED_TERM_RE = new RegExp(`^[-+]?\\s*${TERM}$`);

/** A simple term from the start of `s` (after a sign for × and ÷), with how much it took. */
function readOperand(s: string, signed: boolean): { operand: string; rest: string } | null {
  let t = s.trimStart();
  // `(-3)`, `(\frac{1}{2})`
  if (t.startsWith("(")) {
    const close = t.indexOf(")");
    if (close < 0) return null;
    const inner = t.slice(1, close).trim();
    if (!SIGNED_TERM_RE.test(inner)) return null;
    return { operand: tidy(inner), rest: t.slice(close + 1) };
  }
  let sign = "";
  if (signed && /^[-+]/.test(t)) {
    sign = t[0] === "-" ? "-" : "";
    t = t.slice(1).trimStart();
  }
  const m = TERM_RE.exec(t);
  if (!m) return null;
  return { operand: sign + tidy(m[0]), rest: t.slice(m[0].length) };
}

/** An operand in one spelling: no spaces, `x^{2}` for `x^2`. */
function tidy(term: string): string {
  return term
    .replace(/\s+/g, "")
    .replace(/\^(\d)/g, "^{$1}")
    .replace(/^\+/, "");
}

/** `\frac{}{2}` / `\frac{\square}{2}` / `\overline{2}` at the start of `s`: a divisor written as a bar. */
function readBarDivisor(s: string): { operand: string; rest: string } | null {
  const t = s.trimStart();
  const frac = /^\\frac\s*\{\s*(?:\\square|\\Box|\\quad|\\qquad)?\s*\}\s*\{([^{}]*)\}/.exec(t);
  const over = frac ? null : /^\\overline\s*\{([^{}]*)\}/.exec(t);
  const m = frac ?? over;
  if (!m) return null;
  const inner = m[1].trim();
  if (!SIGNED_TERM_RE.test(inner)) return null;
  return { operand: tidy(inner), rest: t.slice(m[0].length) };
}

/**
 * The operation a line writes (see the module comment), or null when it is not an operation line.
 * Pure grammar: whether it IS one also depends on the line above (`analyzeOperation`).
 */
export function parseOperationLine(latex: string): ParsedOperation | null {
  const flat = flattenOperationLatex(latex);
  if (!flat) return null;
  // a relation is an equation, not an operation (`-3 - 3 = -6` is arithmetic)
  if (/=|<|>|\\[lg]eq?(?![a-zA-Z])|\\neq(?![a-zA-Z])/.test(flat)) return null;
  const pairs: Array<{ op: OperationOp; operand: string }> = [];
  let rest = flat;
  while (rest.trim()) {
    if (pairs.length >= 3) return null;
    const bar = readBarDivisor(rest);
    if (bar) {
      pairs.push({ op: "divide", operand: bar.operand });
      rest = bar.rest;
      continue;
    }
    const t = rest.trimStart();
    const found = OPERATORS.find(([re]) => re.test(t));
    if (!found) return null;
    const [re, op] = found;
    const after = t.replace(re, "");
    const read = readOperand(after, op === "multiply" || op === "divide");
    if (!read || !read.operand) return null;
    pairs.push({ op, operand: read.operand });
    rest = read.rest;
  }
  if (pairs.length === 0) return null;
  const op = pairs[0].op;
  if (pairs.some((p) => p.op !== op)) return null;
  if (pairs.length === 1) {
    // once: a divisor or a factor in the margin; `-3` or `+5` alone is a number
    if (op === "add" || op === "subtract") return null;
    return { op, operands: [pairs[0].operand], form: "once" };
  }
  return { op, operands: pairs.map((p) => p.operand), form: "both" };
}

/** The value of an operand with no letters in it (`3`, `-\frac{1}{2}`, `0.5`), or null. */
export function operandValue(operand: string): number | null {
  let s = operand.replace(/\s+/g, "");
  let sign = 1;
  while (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1);
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (/^\d+(?:\.\d+)?$/.test(s)) return sign * Number(s);
  const f = /^\\frac\{(\d+(?:\.\d+)?)\}\{(\d+(?:\.\d+)?)\}$/.exec(s);
  if (f) {
    const d = Number(f[2]);
    return d === 0 ? null : (sign * Number(f[1])) / d;
  }
  return null;
}

/** Does the operand have a letter in it (`2x`, `\frac{x}{2}`)? */
export function operandHasLetter(operand: string): boolean {
  return /[a-zA-Z]/.test(operand.replace(/\\frac/g, ""));
}

/** The operand as a mathjs source: `2x` → `2*x`, `\frac{1}{2}` → `(1/2)`, `-3` → `(-3)`. Null when it is not a simple term. */
export function operandMath(operand: string): string | null {
  let s = operand.replace(/\s+/g, "");
  let paren = false;
  while (s.startsWith("(") && s.endsWith(")")) {
    s = s.slice(1, -1);
    paren = true;
  }
  let sign = "";
  if (/^[-+]/.test(s)) {
    sign = s[0] === "-" ? "-" : "";
    s = s.slice(1);
  }
  const factors: string[] = [];
  const re = /^(?:(\d+(?:\.\d+)?)|\\frac\{([0-9a-zA-Z.]+)\}\{([0-9a-zA-Z.]+)\}|([a-zA-Z])(?:\^\{(\d+)\})?)/;
  while (s) {
    const m = re.exec(s);
    if (!m) return null;
    if (m[1] !== undefined) factors.push(m[1]);
    else if (m[2] !== undefined) factors.push(`(${splitLetters(m[2])}/${splitLetters(m[3])})`);
    else factors.push(m[5] ? `${m[4]}^${m[5]}` : m[4]);
    s = s.slice(m[0].length);
  }
  if (factors.length === 0) return null;
  const body = factors.join("*");
  return sign || paren || factors.length > 1 ? `(${sign}${body})` : body;
}

/** `2xy` → `2*x*y` inside a fraction's part. */
function splitLetters(part: string): string {
  const m = /^(\d+(?:\.\d+)?)?([a-zA-Z]*)$/.exec(part);
  if (!m) return part;
  const out = [...(m[1] ? [m[1]] : []), ...m[2].split("")];
  return out.length > 1 ? `(${out.join("*")})` : out[0] ?? part;
}

/** Two operands the same (`3` and `3.0`, `\frac{1}{2}` and `0.5`, `2x` and `2 x`)? */
export function sameOperand(a: string, b: string): boolean {
  if (tidy(a) === tidy(b)) return true;
  const va = operandValue(a);
  const vb = operandValue(b);
  return va !== null && vb !== null && Math.abs(va - vb) <= 1e-9 * Math.max(1, Math.abs(va));
}

/**
 * The relation above as the engine holds it (`LineAnalysis.math`) is `lhs op rhs` — or, for the
 * compound lines (`compound.ts`), a chain `a < f < b` as `max(a - f, f - b) < 0`, a union of
 * inequalities as `min(…) < 0`, branches `2x - 3 = 5, \ 2x - 3 = -5` as a product equal to 0.
 */
function compoundOf(relationMath: string): "chain" | "union" | "branches" | null {
  const m = relationMath.trim();
  if (/^max\(/.test(m)) return "chain";
  if (/^min\(/.test(m)) return "union";
  if (/^\(\(.*\)\) \* \(\(.*\)\) == 0$/.test(m)) return "branches";
  return null;
}

/** A relation written `lhs op rhs` (`op rhs`…) that an operation can be applied to side by side. */
export function plainRelation(relationMath: string): boolean {
  return compoundOf(relationMath) === null && !/!=/.test(relationMath);
}

/** How many sides the relation above has: 2 for `2x + 3 = 11`, 3 for `-3 < 2x + 1 < 7`; 0 for a union or branches. */
export function sidesOf(relationMath: string): number {
  const compound = compoundOf(relationMath);
  if (compound === "chain") return 3;
  if (compound || /!=/.test(relationMath)) return 0;
  return (relationMath.match(SIDE_OPS) ?? []).length + 1;
}

export interface OperationVerdict {
  verdict: "ok" | "mismatch" | "none";
  /** what the echo's note says (hover only): a teacher's few words, or '' */
  note: string;
}

/** The note on a ringed operation line. */
export const OPERATION_NOTES = {
  different: "Do the same to both sides",
  byZero: "Not by 0",
} as const;

/**
 * Is this operation right under the relation above (`relationMath`: the line's mathjs source,
 * `2 * x + 3 == 11`)? See the module comment. `relationMath` null: nothing to check it against.
 */
export function judgeOperation(parsed: ParsedOperation, relationMath: string | null): OperationVerdict {
  if (!relationMath) return { verdict: "none", note: "" };
  const [first, ...others] = parsed.operands;
  if (others.some((o) => !sameOperand(first, o))) return { verdict: "mismatch", note: OPERATION_NOTES.different };
  const sides = sidesOf(relationMath);
  if (sides < 2 || (parsed.form === "both" && parsed.operands.length !== sides)) return { verdict: "none", note: "" };
  if (parsed.op === "multiply" || parsed.op === "divide") {
    if (operandHasLetter(first)) return { verdict: "none", note: "" };
    const v = operandValue(first);
    if (v === 0) return { verdict: "mismatch", note: OPERATION_NOTES.byZero };
    if (v === null) return { verdict: "none", note: "" };
  }
  return { verdict: "ok", note: "" };
}

/**
 * What the loop writes for a line that is a division bar and what is under it (`DivisionBar`,
 * read by Mathpix as one line — it drops the bar: `2`, `-3`): `\div 2`, `\div (-3)`. A read that
 * already says so (`\frac{}{2}`, `\overline{2}`, `\div 2`) is written the same way. Null when the
 * read is not a simple divisor (a word, a relation, nothing); the loop then keeps the read.
 */
export function barDivisionLatex(read: string): string | null {
  const flat = flattenOperationLatex(read);
  if (!flat) return null;
  const parsed = parseOperationLine(flat);
  if (parsed) return parsed.op === "divide" && parsed.form === "once" ? divideBy(parsed.operands[0]) : null;
  const unwrapped = flat
    .replace(/^\\(?:overline|underline)\s*\{([^{}]*)\}$/, "$1")
    .replace(/^\\frac\s*\{\s*(?:\\square|\\Box)?\s*\}\s*\{([^{}]*)\}$/, "$1")
    .trim();
  if (!unwrapped || !SIGNED_TERM_RE.test(unwrapped)) {
    const paren = /^\(([^()]*)\)$/.exec(unwrapped);
    if (!paren || !SIGNED_TERM_RE.test(paren[1].trim())) return null;
    return divideBy(paren[1].trim());
  }
  return divideBy(unwrapped);
}

function divideBy(operand: string): string {
  const t = tidy(operand);
  return /^-/.test(t) ? `\\div (${t})` : `\\div ${t}`;
}
