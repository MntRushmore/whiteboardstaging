/**
 * Column (stacked) arithmetic, worked as a class works it: grade-school maths, often a child's.
 *
 *        ¹
 *       286          52          23
 *     + 680        - 17        x  4
 *     -----        ----        ----
 *       966          35          92
 *
 * The numbers right-aligned one under the other, the operator at the left of the last of them, a
 * rule, and the answer under it — empty, filled in from the right, or complete. The small `1` over
 * the `2` is a carry mark; a crossed-out digit with a small one over it is a borrow. They are the
 * student's working, not part of the numbers: `stackedSums.ts` finds the layout in the ink and
 * sets them aside, and the block is read as ONE line, which Mathpix reads as an array:
 *
 *     \begin{array}{r} 286 \\ +680 \\ \hline 966 \end{array}
 *
 * (the tutor's hand writing as the student: 13 layouts, every one read so, at confidence ~1 — the
 * owner's sum, a wrong answer, a partial and an empty one, subtraction, `\times 4`, three addends,
 * decimals, four digits with carries, a phone's ink, a one-digit sum). Before, the clusterer joined
 * `+680`, the rule and `966` as a fraction (the rule took them for a numerator and a denominator),
 * Mathpix read `\frac{+680}{966}`, and Solve wrote `= 0.7039` under the student's right sum.
 *
 * Here that read is parsed (`parseStacked`) and worked column by column (`workStacked`): the right
 * digit in each place, what is carried into it (or, taking away, borrowed from it), which of the
 * student's digits are wrong — the rightmost first, as the sum is done — and a short note for it in
 * a child's words ("Add the 1 you carried to the hundreds."). The loop marks it (a tick, or a ring
 * round the first wrong digit), writes the next column's digit and its carry for Help, and the
 * missing digits for Solve, in the student's hand, in their columns. No model is ever asked.
 *
 * In scope: `+` with two or more numbers, `-` and `x` with two, whole numbers, and decimals lined up
 * on the point for `+` and `-`. Out of it, and quiet (`null`): long multiplication's rows of partial
 * products and long division (more than one row under the rule, or a second rule), a subtraction
 * whose answer would be negative, decimals in a product, a read that is not numbers. Quiet is the
 * point: the tutor says nothing rather than write a wrong "answer" under a child's sum.
 *
 * Pure string and digit work: no mathjs, so it is small, and the loop calls it directly.
 */
import type { LineAnalysis } from "../contracts";

export type StackOp = "+" | "-" | "×";

/** A stacked sum as read: the numbers above the rule, its operator, what is written under it. */
export interface StackedRead {
  op: StackOp;
  /** the numbers above the rule, top to bottom, as written (`286`, `3.50`) — no sign, no commas */
  operands: string[];
  /** the student's answer under the rule as written ('' while it is empty) */
  answer: string;
}

/** The sum worked out and the student's answer judged, place by place. */
export interface StackedWork extends StackedRead {
  /** the right answer as it is written (`966`, `15.75`) */
  result: string;
  /** decimal places the sum is lined up to: place `decimals` is the ones (0 for whole numbers) */
  decimals: number;
  /** the right digit in each place; place 0 is the rightmost column of the sum */
  digits: number[];
  /** the places of the numbers above the rule: 0 .. `width` - 1 (the answer may have one more) */
  width: number;
  /**
   * Into each place: what is carried (`+`, and `x` by one digit), or what the place lends to the one
   * on its right (`-`: 1 when it was borrowed from). Empty for `x` by a number of two digits or more,
   * whose columns are long multiplication's rows, not single digits.
   */
  carries: number[];
  /** the student's digit in each place they have written, by place */
  written: Map<number, number>;
  /** the rightmost place whose digit is wrong (or written where the answer has none), or -1 */
  wrong: number;
  /** every place of the answer written, and right */
  right: boolean;
  /** a short note about the first wrong place, in a child's words ('' when nothing is wrong) */
  note: string;
}

const PLACE_NAMES = ["ones", "tens", "hundreds", "thousands", "ten thousands", "hundred thousands", "millions"];
const DECIMAL_NAMES = ["tenths", "hundredths", "thousandths"];
/** more digits than this is not a sum written by hand in columns */
const MAX_DIGITS = 15;

/** `\text{+680}` → `+680`, `{ }^{1}` and other scripts (a carry read with a row) dropped, spaces gone. */
function cleanRow(row: string): string {
  return row
    .replace(/\\(?:text|mathrm|mathbf|textrm|textbf|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:left|right)(?![a-zA-Z])/g, "")
    .replace(/[\^_]\s*(?:\{[^{}]*\}|\d)/g, "")
    .replace(/\\(?:[,;:! ]|quad|qquad)|~|&/g, "")
    .replace(/\{\s*,\s*\}/g, ",")
    .replace(/[{}\s]/g, "");
}

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** A number as written: digits, maybe a point, maybe thousands commas (`1,250`). Null for anything else. */
function numberOf(s: string): string | null {
  const plain = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s) ? s.replace(/,/g, "") : s;
  if (!NUMBER.test(plain) || plain.replace(".", "").length > MAX_DIGITS) return null;
  return plain;
}

/** A row above the rule: its operator, if it has one, and its number. */
function operandRow(raw: string): { op: StackOp | null; number: string } | null {
  const s = cleanRow(raw);
  const m = /^(\+|-|−|\\times(?![a-zA-Z])|\\cdot(?![a-zA-Z])|[xX×*])?(.*)$/.exec(s);
  if (!m) return null;
  const number = numberOf(m[2]);
  if (number === null) return null;
  const sign = m[1];
  const op: StackOp | null = !sign ? null : sign === "+" ? "+" : sign === "-" || sign === "−" ? "-" : "×";
  return { op, number };
}

/**
 * The rows of an array read, top to bottom, with where the rule is: Mathpix writes `\hline` at the
 * start of the row under it, or `\underline{+680}` round the row over it.
 */
function arrayRows(latex: string): Array<string | "rule"> | null {
  const m = /^\\begin\{(array|aligned|gathered|matrix|tabular)\}(?:\{[^{}]*\})?([\s\S]*)\\end\{\1\}$/.exec(latex.trim());
  if (!m) return null;
  const out: Array<string | "rule"> = [];
  for (const piece of m[2].split(/\\\\/)) {
    let row = piece.trim();
    while (row.startsWith("\\hline")) {
      out.push("rule");
      row = row.slice(6).trim();
    }
    let ruleAfter = false;
    const under = /^\\underline\s*\{([\s\S]*)\}$/.exec(row);
    if (under) {
      row = under[1];
      ruleAfter = true;
    }
    while (row.endsWith("\\hline")) {
      row = row.slice(0, -6).trim();
      ruleAfter = true;
    }
    if (row) out.push(row);
    if (ruleAfter) out.push("rule");
  }
  return out;
}

/**
 * Mathpix's read of a stacked sum, or null when it is not one this file works: at least two numbers
 * over ONE rule, an operator on the rows under the first (one kind of it), and at most one row
 * under the rule, of digits. `-` and `x` take exactly two numbers. A carry Mathpix read as a
 * script on a digit (`2^{1} 86`) is dropped. Two rules or two rows under the rule (long
 * multiplication, long division) are not.
 */
export function parseStacked(latex: string): StackedRead | null {
  const rows = arrayRows(latex);
  if (!rows) return null;
  const rule = rows.indexOf("rule");
  if (rule < 2 || rows.lastIndexOf("rule") !== rule) return null;
  const above = rows.slice(0, rule) as string[];
  const below = rows.slice(rule + 1) as string[];
  if (below.length > 1) return null;
  const parsed = above.map(operandRow);
  if (parsed.some((p) => p === null)) return null;
  const items = parsed as Array<{ op: StackOp | null; number: string }>;
  // the first number has no operator; the others agree on one, and the last carries it
  if (items[0].op !== null) return null;
  const ops = new Set(items.slice(1).map((p) => p.op).filter((o): o is StackOp => o !== null));
  if (ops.size !== 1 || items[items.length - 1].op === null) return null;
  const op = [...ops][0];
  if (op !== "+" && items.length !== 2) return null;
  let answer = "";
  if (below.length === 1) {
    const n = numberOf(cleanRow(below[0]));
    if (n === null) return null;
    answer = n;
  }
  return { op, operands: items.map((p) => p.number), answer };
}

/** How many digits a number has after its point. */
function decimalsOf(n: string): number {
  const i = n.indexOf(".");
  return i === -1 ? 0 : n.length - i - 1;
}

/**
 * How many digits each number above the rule has, and the place of its last one (lined up on the
 * point): what `stackedSums.ts`' `stackGrid` maps the rows' glyphs to columns with.
 */
export function rowPlaces(read: StackedRead): Array<{ digits: number; last: number }> {
  const decimals = Math.max(...read.operands.map(decimalsOf));
  return read.operands.map((n) => ({ digits: n.replace(".", "").length, last: decimals - decimalsOf(n) }));
}

/** A number's digits by place, its last digit at place `last` (place 0 is the sum's rightmost column). */
function placesOf(n: string, last: number): Map<number, number> {
  const digits = n.replace(".", "");
  const out = new Map<number, number>();
  for (let i = 0; i < digits.length; i++) out.set(last + digits.length - 1 - i, Number(digits[i]));
  return out;
}

const at = (m: Map<number, number>, p: number) => m.get(p) ?? 0;

/** `[6, 6, 9]` (place 0 first) with the point before place `decimals` → `966`; leading zeros dropped down to the ones. */
function written(digits: readonly number[], decimals: number): string {
  let top = digits.length - 1;
  while (top > decimals && digits[top] === 0) top--;
  let s = "";
  for (let p = top; p >= 0; p--) {
    s += String(digits[p]);
    if (p === decimals && decimals > 0) s += ".";
  }
  return s;
}

/** The name of a place, for the note: `ones`, `tens`, … `tenths`. */
export function placeName(place: number, decimals: number): string {
  const k = place - decimals;
  return (k >= 0 ? PLACE_NAMES[k] : DECIMAL_NAMES[-k - 1]) ?? "";
}

export interface WorkOptions {
  /**
   * The place of the student's last written digit, from where it sits on the page
   * (`stackedSums.ts`, `StackGrid.answerLast`): a digit written under the hundreds first is the
   * hundreds, not the ones. Default: the answer lined up as the numbers are (right-aligned, or on
   * the point).
   */
  answerLast?: number;
}

/**
 * The sum worked out and the student's answer judged (see `StackedWork`), or null when it is out of
 * this file's scope (a negative difference, decimals in a product).
 */
export function workStacked(read: StackedRead, opts: WorkOptions = {}): StackedWork | null {
  const { op, operands, answer } = read;
  const decimals = Math.max(...operands.map(decimalsOf));
  if (op === "×" && decimals > 0) return null;
  const nums = operands.map((n) => placesOf(n, decimals - decimalsOf(n)));
  const width = Math.max(...nums.map((m) => Math.max(...m.keys()) + 1));
  const digits: number[] = [];
  const carries: number[] = [0];
  if (op === "+") {
    for (let p = 0; p < width || carries[p] > 0; p++) {
      const s = nums.reduce((sum, m) => sum + at(m, p), carries[p]);
      digits.push(s % 10);
      carries.push(Math.floor(s / 10));
    }
  } else if (op === "-") {
    const [a, b] = nums;
    for (let p = 0; p < width; p++) {
      let d = at(a, p) - at(b, p) - carries[p];
      carries.push(d < 0 ? 1 : 0);
      if (d < 0) d += 10;
      digits.push(d);
    }
    // the bottom number was bigger: a negative answer is not column subtraction
    if (carries[width] > 0) return null;
  } else {
    const [a, b] = nums;
    const bTop = Math.max(...b.keys());
    const product: number[] = [];
    for (const [pb, db] of b) {
      for (const [pa, da] of a) product[pa + pb] = (product[pa + pb] ?? 0) + da * db;
    }
    let carry = 0;
    for (let p = 0; p < product.length || carry > 0; p++) {
      const s = (product[p] ?? 0) + carry;
      digits.push(s % 10);
      carry = Math.floor(s / 10);
      if (bTop === 0) carries.push(carry);
    }
    if (bTop > 0) carries.length = 0;
  }
  while (digits.length > 1 && digits.length > decimals + 1 && digits[digits.length - 1] === 0) digits.pop();

  const last = opts.answerLast ?? decimals - decimalsOf(answer);
  const mine = answer ? placesOf(answer, last) : new Map<number, number>();
  // a leading zero the student wrote is no mistake
  for (const [p, d] of mine) if (p >= digits.length && d === 0) mine.delete(p);
  let wrong = -1;
  for (const p of [...mine.keys()].sort((x, y) => x - y)) {
    if (mine.get(p) !== (p < digits.length ? digits[p] : -1)) {
      wrong = p;
      break;
    }
  }
  const right = wrong === -1 && digits.every((d, p) => mine.get(p) === d);
  const work: StackedWork = { ...read, result: written(digits, decimals), decimals, digits, width, carries, written: mine, wrong, right, note: "" };
  work.note = wrong === -1 ? "" : noteFor(work, nums, wrong, decimalsOf(answer));
  return work;
}

/**
 * A stacked sum's line analysis, as the loop marks it (`LiveLoop.stackAnalysis`) and the young kids'
 * scoreboard replays it: complete and right is `solved` (a tick); a wrong digit is a `mismatch` with
 * its note (a ring) — only on a read the caller is `sure` of; empty or right so far is nothing yet. A
 * sum this file cannot work (`work` null) is `unknown`: read back, never marked, never answered,
 * never sent to a model.
 */
export function stackedAnalysis(work: StackedWork | null, sure: boolean): LineAnalysis {
  const quiet: LineAnalysis = { kind: "unknown", math: "", resultLatex: "", verdict: "unknown", note: "" };
  if (!work) return quiet;
  const wrong = work.wrong !== -1;
  if (wrong && !sure) return quiet;
  return {
    kind: wrong || work.right ? "equation" : "expression",
    math: "",
    resultLatex: "",
    verdict: wrong ? "mismatch" : work.right ? "ok" : "none",
    note: work.note,
    ...(work.right ? { solved: true } : {}),
  };
}

/** The note about the first wrong place: the classic slip when it is one, else where to look. */
function noteFor(work: StackedWork, nums: Array<Map<number, number>>, p: number, answerDecimals: number): string {
  const { op, decimals, carries } = work;
  const name = placeName(p, decimals);
  const theirs = work.written.get(p);
  const carry = carries[p] ?? 0;
  if (decimals > 0 && answerDecimals > 0 && answerDecimals !== decimals) return "Line up the decimal points.";
  if (p >= work.digits.length || !name) return "Check the answer's first digit.";
  if (op === "+" && carry > 0 && theirs === nums.reduce((s, m) => s + at(m, p), 0) % 10) return `Add the ${carry} you carried to the ${name}.`;
  if (op === "×" && carry > 0 && theirs === (at(nums[0], p) * at(nums[1], 0)) % 10) return `Add the ${carry} you carried to the ${name}.`;
  if (op === "-") {
    const top = at(nums[0], p) - carry;
    const bottom = at(nums[1], p);
    const next = placeName(p + 1, decimals);
    if (top < bottom && theirs === bottom - top && next) return `${top} is less than ${bottom}: borrow from the ${next}.`;
    if (carry > 0 && theirs === at(nums[0], p) - bottom) return `The ${name} lent 1, so the ${at(nums[0], p)} is ${top} now.`;
  }
  return `Check the ${name} column.`;
}

/**
 * The places still to write, given those written already (the student's and the tutor's):
 * every place of the answer that has no digit yet, rightmost first.
 */
export function placesLeft(work: StackedWork, filled: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (let p = 0; p < work.digits.length; p++) if (!filled.has(p) && !work.written.has(p)) out.push(p);
  return out;
}

export interface StackStep {
  /** the answer's digits to write, by place */
  digits: Array<{ place: number; digit: number }>;
  /** the carry to write small over the next column, when there is one */
  carry: { place: number; digit: number } | null;
}

/**
 * Help's next step: the rightmost column with no digit yet — its digit, and the carry it sends to
 * the column on its left (`+`, `x` by one digit). The leftmost column of the numbers takes the rest
 * of the answer with it (`2 + 7 + 1` is written `10`, not `0` and a carry over nothing). Null when
 * the answer is all written, something written is wrong (the ring and its fix come first), or the
 * columns are not single steps (`x` by two digits or more).
 */
export function nextStep(work: StackedWork, filled: ReadonlySet<number>): StackStep | null {
  if (work.wrong !== -1 || (work.op === "×" && work.carries.length === 0)) return null;
  const left = placesLeft(work, filled);
  if (left.length === 0) return null;
  const p = left[0];
  const end = p >= work.width - 1;
  const digits = (end ? left : [p]).map((place) => ({ place, digit: work.digits[place] }));
  const carry = !end && work.op !== "-" && (work.carries[p + 1] ?? 0) > 0 ? { place: p + 1, digit: work.carries[p + 1] } : null;
  return { digits, carry };
}
