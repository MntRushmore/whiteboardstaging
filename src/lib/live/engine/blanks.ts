/**
 * The blanks of a primary worksheet: `4 + \square = 9`, `? \times 6 = 42`, `\frac{2}{3} =
 * \frac{\square}{12}`, `1 + 2 = \square`, and the comparison `\frac{3}{4} \bigcirc \frac{5}{8}`.
 *
 * Prod (2026-10-04 to 10-11): a first-grader's "fill in the blank addition" came back as `4 +
 * \square = 9` and `\square + 6 = 10`, and the engine read the box as a mark on the page and threw
 * it away (`4 + = 9`): nothing to check, so the board wrote nothing ("I couldn't check those
 * problems…"). A blank IN a relation is the unknown, and is read as one here: the line is the same
 * equation with a letter in the blank's place (`4 + x = 9`), and what is written back puts the blank
 * where the letter was (`\square = 5`). A blank that is the whole last side (`1 + 2 = \square`) is
 * the place for the answer — the engine already reads that as `1 + 2 =` — and is left alone.
 *
 * Only lines with no letters of their own (a blank beside an `x` is no worksheet), one blank, and a
 * blank that stands where a number would (an operator, a relation, a bracket or a fraction's brace
 * either side of it): a checkbox before a line (`\square 2 + 3 = 5`) is still a mark.
 *
 * Pure string work: no mathjs.
 */

/** One blank, however it is written: a box, a question mark, a line to write on, a circle. */
const BLANK =
  /\\square(?![a-zA-Z])|\\Box(?![a-zA-Z])|\\bigcirc(?![a-zA-Z])|[□☐◻○◯]|\\boxed\s*\{(?:\s|\\(?:quad|qquad|[,;: ]|phantom\s*\{[^{}]*\}|hspace\s*\{[^{}]*\}))*\}|\\underline\s*\{(?:\s|~|\\(?:quad|qquad|[,;: ]|phantom\s*\{[^{}]*\}|hspace\s*\{[^{}]*\}))*\}|(?:\\_\s*)+|_{2,}|\?/g;

/** The board's own blank (the hand draws a box) and its comparison circle. */
export const BOARD_BLANK = "\\square";
export const BOARD_COMPARE_BLANK = "\\bigcirc";

/** The letter a blank is read as. A line with a blank has no letters of its own, so it is free. */
const BLANK_LETTER = "x";

/** Spacing a blank may have round it: `\;`, `\,`, `\ `, `~`, `\quad`. */
const SPACING = /^(?:\s|~|\\(?:[,;:! ]|quad\b|qquad\b))+/;
const SPACING_END = /(?:\s|~|\\(?:[,;:! ]|quad|qquad))+$/;

/** A relation, as a worksheet writes one. */
const RELATION = /=|<|>|\\(?:le|ge|leq|geq|lt|gt|ne|neq|leqslant|geqslant)(?![a-zA-Z])/;

/** What may stand right before a blank that is a number's place: nothing, an operator, a relation, an opening bracket. */
const BEFORE = /(?:^|[+\-*/:=<>([{×÷−]|\\(?:times|cdot|div|le|ge|leq|geq|lt|gt|ne|neq|left\s*[([]))$/;
/** …and right after it: nothing, an operator, a relation, a closing bracket. */
const AFTER = /^(?:$|[+\-*/:=<>)\]}×÷−]|\\(?:times|cdot|div|le|ge|leq|geq|lt|gt|ne|neq|right\s*[)\]]))/;

interface Found {
  index: number;
  length: number;
}

/** The blanks of a line, in order. `\stackrel{?}{=}` ("is it equal?") is a question, not a blank. */
function blanksOf(latex: string): Found[] {
  if (/\\(?:stackrel|overset|underset)\b/.test(latex)) return [];
  const out: Found[] = [];
  for (const m of latex.matchAll(BLANK)) out.push({ index: m.index ?? 0, length: m[0].length });
  return out;
}

/** Letters of the line's own, outside commands and the blank itself (`\frac`, `\times` are not letters). */
function hasOwnLetters(latex: string): boolean {
  const s = latex.replace(BLANK, " ").replace(/\\[a-zA-Z]+/g, " ");
  return /[a-zA-Z]/.test(s);
}

function trimmedBefore(latex: string, at: number): string {
  return latex.slice(0, at).replace(SPACING_END, "").trimEnd();
}

function trimmedAfter(latex: string, from: number): string {
  return latex.slice(from).replace(SPACING, "").trimStart();
}

/** The line's only blank, when it stands where a number would; else null. */
function operandBlank(latex: string): Found | null {
  if (hasOwnLetters(latex)) return null;
  const blanks = blanksOf(latex);
  if (blanks.length !== 1) return null;
  const b = blanks[0];
  const before = trimmedBefore(latex, b.index);
  const after = trimmedAfter(latex, b.index + b.length);
  if (!BEFORE.test(before) || !AFTER.test(after)) return null;
  return b;
}

/**
 * The line with its blank read as the unknown (`4 + \square = 9` → `4 + x = 9`), or null when it is
 * no such line: no relation, letters of its own, more than one blank, a blank that is not a number's
 * place, or the blank as the whole last side (`1 + 2 = \square`: the answer's place).
 */
export function blankAsUnknown(latex: string): { latex: string; letter: string } | null {
  if (!latex || !RELATION.test(latex.replace(BLANK, " "))) return null;
  const b = operandBlank(latex);
  if (!b) return null;
  const before = trimmedBefore(latex, b.index);
  const after = trimmedAfter(latex, b.index + b.length);
  // `1 + 2 = \square`, `7 \times 8 = ?`: the place for the answer, which the engine reads already
  if (after === "" && /(?:=|\\approx)$/.test(before)) return null;
  // `\square = 3 + 4` is the same question the other way round: still the unknown
  return { latex: putInPlace(latex, b, BLANK_LETTER), letter: BLANK_LETTER };
}

/** `latex` with `found` replaced by `what`, spaced from its neighbours except a brace or bracket. */
function putInPlace(latex: string, found: Found, what: string): string {
  const before = latex[found.index - 1] ?? "";
  const after = latex[found.index + found.length] ?? "";
  const lead = before === "" || /[\s{(]/.test(before) ? "" : " ";
  const trail = after === "" || /[\s})]/.test(after) ? "" : " ";
  return `${latex.slice(0, found.index)}${lead}${what}${trail}${latex.slice(found.index + found.length)}`.trim();
}

/**
 * What the engine wrote about the unknown, with the blank back in the letter's place: `x = 5` →
 * `\square = 5`, and a number before it a product (`6x = 42` → `6 \times \square = 42`: a child reads
 * `6□` as sixty-something).
 */
export function blankBack(latex: string, letter: string): string {
  let out = "";
  for (const m of latex.matchAll(/\\[a-zA-Z]+|[a-zA-Z]|[^a-zA-Z\\]+|\\./g)) {
    const t = m[0];
    if (t !== letter) out += t;
    else out = /[\d)}]\s*$/.test(out) ? `${out.replace(/\s+$/, "")} \\times ${BOARD_BLANK} ` : `${out}${BOARD_BLANK} `;
  }
  return out.replace(/\s+/g, " ").replace(/\s+([)}\]])/g, "$1").trim();
}

/**
 * A comparison to fill in: two numbers (or sums, fractions…) with a blank between them and no
 * relation (`\frac{3}{4} \; ? \; \frac{5}{8}`, `345 \bigcirc 354`, `0.5 \square 0.45`). Its sides,
 * or null.
 */
export function compareBlank(latex: string): { left: string; right: string } | null {
  if (!latex || RELATION.test(latex.replace(BLANK, " ")) || hasOwnLetters(latex)) return null;
  const blanks = blanksOf(latex);
  if (blanks.length !== 1) return null;
  const b = blanks[0];
  const left = trimmedBefore(latex, b.index);
  const right = trimmedAfter(latex, b.index + b.length);
  if (!left || !right || !/\d/.test(left) || !/\d/.test(right)) return null;
  // each side a whole thing: it neither ends nor starts with an operator
  if (/[+\-*/:(]$|\\(?:times|cdot|div)$/.test(left) || /^[+*/:)]|^\\(?:times|cdot|div)(?![a-zA-Z])/.test(right)) return null;
  return { left, right };
}

/**
 * Every blank written the way the board writes one: a box, and a circle between two sides to
 * compare (`?`, `\_\_`, `\underline{\quad}`, `\boxed{}` → `\square`; `\frac{3}{4} ? \frac{5}{8}` →
 * `\frac{3}{4} \bigcirc \frac{5}{8}`). The hand draws both; the engine reads both. A line with no
 * blank, or one that asks "is it equal?" (`\stackrel{?}{=}`), comes back as it was.
 */
export function boardBlanks(latex: string): string {
  if (blanksOf(latex).length === 0) return latex;
  const compare = compareBlank(latex);
  if (compare) return `${compare.left} ${BOARD_COMPARE_BLANK} ${compare.right}`;
  // spaced from what is round it, except a brace or bracket (`\frac{\square}{12}`, `(\square)`)
  return latex
    .replace(BLANK, (m: string, at: number) => {
      const before = latex[at - 1] ?? "";
      const after = latex[at + m.length] ?? "";
      return `${/[\s{(]/.test(before) || before === "" ? "" : " "}${BOARD_BLANK}${/[\s})]/.test(after) || after === "" ? "" : " "}`;
    })
    .trim();
}

/** Is there a blank in the line (a box, a `?`, a line to write on, a circle)? */
export function hasBlank(latex: string): boolean {
  return blanksOf(latex).length > 0;
}

/** A line with every blank taken out: what is left to read (`isArithmetic`: no letters, only digits). */
export function withoutBlanks(latex: string): string {
  return blanksOf(latex).length > 0 ? latex.replace(BLANK, " ") : latex;
}

/** A number as a child writes one in a blank: `5`, `-3`, `2.5`, `\frac{3}{4}`. */
const NUMBER = String.raw`-?\s*(?:\d+(?:\.\d+)?|\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\})`;
/** A lone answer for a box: `5`, `= 5`, `\square = 5` (the blank itself written before it). */
const LONE_ANSWER = new RegExp(String.raw`^\s*(?:(?:\\square|\\Box|\?|□)\s*)?=?\s*(${NUMBER})\s*$`);
/** A lone sign for a comparison's circle: `>`, `<`, `=`, `\gt`, `\lt`. */
const LONE_SIGN = /^\s*(<|>|=|\\lt(?![a-zA-Z])|\\gt(?![a-zA-Z]))\s*$/;

/** Without spacing, for comparing a child's line with the problem: `4+5=9` is `4 + 5 = 9`. */
const squash = (s: string) => s.replace(/\\[,;:! ]|\\q?quad(?![a-zA-Z])|~|\s+/g, "");

/**
 * A young student's answer to a worksheet's blank, as the closed line it makes with the answer in
 * the blank: `5` (or `= 5`, `\square = 5`) under `4 + \square = 9` → `4 + 5 = 9`; the problem written
 * out with a number in its box (`4 + 5 = 9`) → itself; a sign under a comparison (`>`) or the
 * comparison written out (`\frac{3}{4} > \frac{5}{8}`) → `\frac{3}{4} > \frac{5}{8}`. The engine
 * judges that line as it judges `2 + 2 = 5` (true: the answer; false: ringed). `lone`: the answer
 * was written alone (a number, a sign). Null when the problem has no blank to answer (`1 + 2 =
 * \square`'s is read as `1 + 2 =`) or the line is no such answer.
 */
export function filledBlank(problem: string, answer: string): { line: string; lone: boolean } | null {
  const compare = compareBlank(problem);
  if (compare) {
    const sign = LONE_SIGN.exec(answer)?.[1];
    if (sign) return { line: `${compare.left} ${sign} ${compare.right}`, lone: true };
    // written out: the problem's two sides with a relation between them
    const [l, r] = [squash(compare.left), squash(answer)];
    const right = squash(compare.right);
    if (r.startsWith(l) && r.endsWith(right) && /^(?:<|>|=|\\lt|\\gt)$/.test(r.slice(l.length, r.length - right.length))) return { line: answer.trim(), lone: false };
    return null;
  }
  if (!blankAsUnknown(problem)) return null;
  const b = operandBlank(problem)!;
  const lone = LONE_ANSWER.exec(answer)?.[1];
  if (lone) {
    const value = /^-/.test(lone.trim()) ? `(${lone.trim()})` : lone.trim();
    return { line: putInPlace(problem, b, value), lone: true };
  }
  // the problem written out with a number where the blank was
  const head = squash(problem.slice(0, b.index));
  const tail = squash(problem.slice(b.index + b.length));
  const line = squash(answer);
  if (!line.startsWith(head) || !line.endsWith(tail) || line.length <= head.length + tail.length) return null;
  const middle = line.slice(head.length, line.length - tail.length);
  return new RegExp(`^${NUMBER}$`).test(middle) ? { line: answer.trim(), lone: false } : null;
}
