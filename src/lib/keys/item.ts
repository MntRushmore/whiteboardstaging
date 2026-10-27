/**
 * Keys (docs/KEYS.md): one problem as the page lays it out. A MathItem is a layout of cells. The
 * tutor's cells are `given`; the kid fills `digit`, `blank` and `carry` cells. Pure data, no DOM, so
 * the same engine can run on the iPad later.
 *
 * Four layouts: `columns` (a sum, a difference or a product set out in place-value columns, with a
 * carry or regroup row, and a product's partial rows), `equation` (one line with a box: a fact, and
 * the smaller problem the tutor writes under a slip), `fraction` (fractions stacked, the kid's
 * numerator over denominator) and `lines` (an equation solved on typed lines, Phase 3).
 *
 * Phase 1 built adding; the other kinds keep their own numbers in `math` (`families/`).
 */
import type { SkillId } from "@/lib/learning/contracts";

export type CellRole = "digit" | "carry" | "blank" | "given";

export interface Cell {
  /** unique in its item: `c1` carry into the tens, `a0` the first addend's ones, `r1` the answer's tens, `x` a blank */
  id: string;
  /** how many characters it holds (a fraction's numerator, a box like `12`); 1 when absent */
  width?: number;
  role: CellRole;
  /** what a right kid cell holds; a carry cell's due carry (absent when none is due) */
  expect?: string;
  /** a given cell's number */
  value?: string;
  /** place value: 0 ones, 1 tens, 2 hundreds (column cells); the part's index in an equation */
  place: number;
  /** the spare cell left of a column answer: it should stay empty */
  spare?: boolean;
}

/** `partial`: a product's partial row (`34 × 6`, `34 × 20`); `carry` is a carry or regroup row */
export type LineRole = "carry" | "operand" | "partial" | "result";

/** The operation signs a page writes. */
export type Op = "+" | "−" | "×" | "÷";

export interface ColumnLine {
  id: string;
  role: LineRole;
  /** the sign written before the line: `+` on the last addend, `−` on what is taken away, `×` on the multiplier */
  op?: Op;
  /** one slot per place, highest place first; null where nothing is written */
  cells: (Cell | null)[];
}

export interface ColumnsLayout {
  kind: "columns";
  /** columns on the page, the spare one included */
  places: number;
  lines: ColumnLine[];
}

export interface EquationLine {
  id: string;
  /** numbers and boxes are cells, signs are strings, in reading order */
  parts: (Cell | string)[];
}

export interface EquationLayout {
  kind: "equation";
  line: EquationLine;
}

/** A fraction on the page: the tutor's (both given) or the kid's (cells, `width` 3). */
export interface FracPart {
  id: string;
  num: Cell;
  den: Cell;
}

export interface FractionLayout {
  kind: "fraction";
  /** fractions and signs, in reading order: `2/7 + 3/7 = ?/?`, `3/4 = ?/12` */
  parts: (FracPart | string)[];
}

/** An equation solved on typed lines: no cells, the kid's steps and the answer row are the work. */
export interface LinesLayout {
  kind: "lines";
}

export type Layout = ColumnsLayout | EquationLayout | FractionLayout | LinesLayout;

export type ItemKind = "sum" | "missing_addend" | "fact" | "difference" | "product" | "fraction_sum" | "equivalent" | "equation";

export interface Frac {
  n: number;
  d: number;
}

/** The numbers of a problem that is not adding (Phase 3), by family. */
export type ItemMath =
  | { kind: "subtract"; top: number; bottom: number }
  | { kind: "multiply"; a: number; b: number }
  | { kind: "fractions"; op: "+"; left: Frac; right: Frac }
  | { kind: "equivalent"; from: Frac; to: number }
  | { kind: "equation"; form: EquationForm; a: number; b: number; letter: string; x: number };

/** `x + a = b`, `x − a = b`, `a + x = b`, `ax = b` (a times x). */
export type EquationForm = "x+a" | "x-a" | "a+x" | "ax";

export interface MathItem {
  /** stable: the same problem has the same id */
  id: string;
  skill: SkillId;
  kind: ItemKind;
  /** the problem as the tutor writes it: `47 + 38`, `26 + ?6 = 92`, `1 + 2 + ? = 9` */
  text: string;
  /** the problem read aloud (screen readers) */
  words: string;
  /** the true addends, in order */
  addends: readonly number[];
  total: number;
  /** a missing digit: which addend, at which place, and that addend as written (`?6`) */
  hidden?: { addend: number; place: number; template: string };
  /** the answer row's right answer: a number, a fraction `5/7`, the unknown's value */
  answer: string;
  layout: Layout;
  /** a problem that is not adding: its own numbers (`addends` and `total` are its operands and result) */
  math?: ItemMath;
}

/** Cell values the kid typed, by cell id. */
export type Values = Readonly<Record<string, string>>;

export const PLACE_NAMES = ["ones", "tens", "hundreds", "thousands"] as const;

export function placeName(place: number): string {
  return PLACE_NAMES[place] ?? `place ${place + 1}`;
}

/** The digit of `n` at `place` (0 ones). */
export function digitAt(n: number, place: number): number {
  return Math.floor(Math.abs(n) / 10 ** place) % 10;
}

export function digitCount(n: number): number {
  return String(Math.abs(Math.trunc(n))).length;
}

/** A typed number as the page compares it: no spaces, no leading zeros (`007` is `7`, `0` stays). */
export function normalizeNumber(raw: string): string {
  const s = raw.replace(/\s+/g, "");
  if (!/^\d+$/.test(s)) return s;
  return s.replace(/^0+(?=\d)/, "");
}

/** Is a carry due into `place` when adding these numbers? */
export function carryInto(addends: readonly number[], place: number): number {
  if (place <= 0) return 0;
  let carry = 0;
  for (let p = 0; p < place; p++) {
    const s = addends.reduce((acc, n) => acc + digitAt(n, p), 0) + carry;
    carry = Math.floor(s / 10);
  }
  return carry;
}

function skillFor(total: number, columns: boolean): SkillId {
  if (!columns) return total <= 10 ? "add_within_10" : total <= 20 ? "add_within_20" : "add_within_100";
  return total <= 100 ? "add_within_100" : "add_subtract_within_1000";
}

function carryLine(addends: readonly number[], realPlaces: number, places: number): ColumnLine {
  const cells: (Cell | null)[] = [];
  for (let p = places - 1; p >= 0; p--) {
    if (p < 1 || p >= realPlaces) {
      cells.push(null);
      continue;
    }
    const due = carryInto(addends, p);
    cells.push({ id: `c${p}`, role: "carry", place: p, ...(due ? { expect: String(due) } : {}) });
  }
  return { id: "carry", role: "carry", cells };
}

function givenLine(id: string, n: number, places: number, op?: "+"): ColumnLine {
  const cells: (Cell | null)[] = [];
  for (let p = places - 1; p >= 0; p--) {
    cells.push(p < digitCount(n) ? { id: `${id}${p}`, role: "given", place: p, value: String(digitAt(n, p)) } : null);
  }
  return { id, role: "operand", cells, ...(op ? { op } : {}) };
}

/** `a + b`, the kid writes the sum in the column (and a spare cell to its left). */
export function sumItem(a: number, b: number): MathItem {
  const total = a + b;
  const realPlaces = Math.max(digitCount(a), digitCount(b), digitCount(total));
  const places = realPlaces + 1;
  const result: (Cell | null)[] = [];
  for (let p = places - 1; p >= 0; p--) {
    result.push(
      p >= realPlaces
        ? { id: `r${p}`, role: "digit", place: p, expect: "", spare: true }
        : { id: `r${p}`, role: "digit", place: p, expect: String(digitAt(total, p)) },
    );
  }
  const text = `${a} + ${b}`;
  return {
    id: `add:${a}+${b}`,
    skill: skillFor(total, true),
    kind: "sum",
    text,
    words: `${a} plus ${b}`,
    addends: [a, b],
    total,
    answer: String(total),
    layout: {
      kind: "columns",
      places,
      lines: [
        carryLine([a, b], realPlaces, places),
        givenLine("a", a, places),
        givenLine("b", b, places, "+"),
        { id: "result", role: "result", cells: result },
      ],
    },
  };
}

/**
 * `a + b = total` with one digit of `b` hidden (`26 + ?6 = 92`): the kid finds the missing digit,
 * in the column. `place` is the hidden digit's place in `b`.
 */
export function missingAddendItem(a: number, b: number, place = 1): MathItem {
  if (place < 0 || place >= digitCount(b)) throw new Error("missingAddendItem: no digit at that place");
  const total = a + b;
  const realPlaces = Math.max(digitCount(a), digitCount(b), digitCount(total));
  const hiddenDigit = String(digitAt(b, place));
  const template = String(b)
    .split("")
    .map((d, i, all) => (all.length - 1 - i === place ? "?" : d))
    .join("");
  const bLine = givenLine("b", b, realPlaces, "+");
  bLine.cells = bLine.cells.map((c) => (c && c.place === place ? { id: `b${place}`, role: "blank", place, expect: hiddenDigit } : c));
  const resultLine = givenLine("result", total, realPlaces);
  resultLine.role = "result";
  resultLine.cells = resultLine.cells.map((c) => (c ? { ...c, id: `r${c.place}` } : c));
  const text = `${a} + ${template} = ${total}`;
  return {
    id: `add:${a}+${template}=${total}`,
    skill: skillFor(total, true),
    kind: "missing_addend",
    text,
    words: `${a} plus ${template.replace("?", " blank ").trim()} equals ${total}. Find the missing ${placeName(place)} digit.`,
    addends: [a, b],
    total,
    hidden: { addend: 1, place, template },
    answer: hiddenDigit,
    layout: { kind: "columns", places: realPlaces, lines: [carryLine([a, b], realPlaces, realPlaces), givenLine("a", a, realPlaces), bLine, resultLine] },
  };
}

/**
 * One line of adding with one box: `1 + 2 + ? = 9` (an addend missing) or `1 + 4 + 3 = ?` (the
 * total). `null` marks the box. The smaller problem the tutor writes under a slip.
 */
export function factItem(addends: readonly (number | null)[], total: number | null): MathItem {
  const boxes = addends.filter((n) => n === null).length + (total === null ? 1 : 0);
  if (boxes !== 1) throw new Error("factItem: exactly one box");
  const known = addends.filter((n): n is number => n !== null);
  const sum = total ?? known.reduce((s, n) => s + n, 0);
  const missing = total === null ? sum : sum - known.reduce((s, n) => s + n, 0);
  const trueAddends = addends.map((n) => n ?? missing);
  const parts: (Cell | string)[] = [];
  const box = (i: number): Cell => ({ id: "x", role: "blank", place: i, expect: String(missing) });
  addends.forEach((n, i) => {
    if (i > 0) parts.push("+");
    parts.push(n === null ? box(parts.length) : { id: `q${parts.length}`, role: "given", place: parts.length, value: String(n) });
  });
  parts.push("=");
  parts.push(total === null ? box(parts.length) : { id: `q${parts.length}`, role: "given", place: parts.length, value: String(total) });
  const show = (n: number | null) => (n === null ? "?" : String(n));
  const text = `${addends.map(show).join(" + ")} = ${show(total)}`;
  const say = (n: number | null) => (n === null ? "blank" : String(n));
  return {
    id: `fact:${text.replace(/\s+/g, "")}`,
    skill: skillFor(sum, false),
    kind: "fact",
    text,
    words: `${addends.map(say).join(" plus ")} equals ${say(total)}`,
    addends: trueAddends,
    total: sum,
    answer: String(missing),
    layout: { kind: "equation", line: { id: "fact", parts } },
  };
}

/**
 * A problem from its text, for tests and the page's `?p=` QA list: `47 + 38` (or `47 + 38 = ?`) and
 * `26 + ?6 = 92` (one `?` digit in an addend). Null for anything else, or a sum that does not add up.
 */
export function itemFromText(text: string): MathItem | null {
  const t = text.replace(/\s+/g, "");
  const sum = /^(\d{1,3})\+(\d{1,3})(=\?)?$/.exec(t);
  if (sum) return sumItem(Number(sum[1]), Number(sum[2]));
  const miss = /^([\d?]{1,3})\+([\d?]{1,3})=(\d{1,4})$/.exec(t);
  if (!miss) return null;
  const [, left, right, totalText] = miss;
  const marks = (left + right).split("?").length - 1;
  if (marks !== 1) return null;
  const total = Number(totalText);
  const hiddenLeft = left.includes("?");
  const known = Number(hiddenLeft ? right : left);
  const template = hiddenLeft ? left : right;
  const value = total - known;
  if (value < 0 || String(value).length !== template.length) return null;
  const place = template.length - 1 - template.indexOf("?");
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== "?" && template[i] !== String(value)[i]) return null;
  }
  // The missing digit always goes in the column's second line: `?6 + 26 = 92` is set as `26 + ?6 = 92`.
  return missingAddendItem(known, value, place);
}

// ---------------------------------------------------------------- reading an item

/** Every cell, in page order (top line first, left to right). */
export function allCells(item: MathItem): Cell[] {
  const layout = item.layout;
  switch (layout.kind) {
    case "equation":
      return layout.line.parts.filter((p): p is Cell => typeof p !== "string");
    case "fraction":
      return layout.parts.flatMap((p) => (typeof p === "string" ? [] : [p.num, p.den]));
    case "lines":
      return [];
    case "columns":
      return layout.lines.flatMap((l) => l.cells.filter((c): c is Cell => c !== null));
  }
}

/** The cells the kid types in. */
export function kidCells(item: MathItem): Cell[] {
  return allCells(item).filter((c) => c.role !== "given");
}

export function cellById(item: MathItem, id: string): Cell | undefined {
  return allCells(item).find((c) => c.id === id);
}

/** The lines of the item, in page order. */
export function lineIds(item: MathItem): string[] {
  const layout = item.layout;
  switch (layout.kind) {
    case "equation":
      return [layout.line.id];
    case "fraction":
      return [FRACTION_LINE];
    case "lines":
      return [];
    case "columns":
      return layout.lines.map((l) => l.id);
  }
}

/** A fraction problem is one line on the page. */
export const FRACTION_LINE = "fractions";

export function lineOfCell(item: MathItem, cellId: string): string | null {
  const layout = item.layout;
  switch (layout.kind) {
    case "equation":
      return layout.line.parts.some((p) => typeof p !== "string" && p.id === cellId) ? layout.line.id : null;
    case "fraction":
      return allCells(item).some((c) => c.id === cellId) ? FRACTION_LINE : null;
    case "lines":
      return null;
    case "columns":
      return layout.lines.find((l) => l.cells.some((c) => c?.id === cellId))?.id ?? null;
  }
}

/** The kid cells that hold the answer: the result row of a sum (a difference, a product), the box of a missing digit, a fraction's. */
export function answerCells(item: MathItem): Cell[] {
  if (item.layout.kind === "columns" && item.kind !== "missing_addend") {
    const result = item.layout.lines.find((l) => l.role === "result");
    return (result?.cells ?? []).filter((c): c is Cell => c !== null && c.role !== "given");
  }
  if (item.layout.kind === "fraction") {
    const kid = item.layout.parts.filter((p): p is FracPart => typeof p !== "string").find((p) => p.num.role !== "given" || p.den.role !== "given");
    return kid ? [kid.num, kid.den].filter((c) => c.role !== "given") : [];
  }
  return kidCells(item).filter((c) => c.role === "blank");
}

/** The line the answer is written on in the work (a sum's result row; the missing digit's line). */
export function answerLine(item: MathItem): string | null {
  const first = answerCells(item)[0];
  return first ? lineOfCell(item, first.id) : null;
}

/**
 * The answer the work shows, once every cell of it is filled: a sum's result row as a number (the
 * spare cell too, when used), a missing digit's box. Null while a cell of it is empty.
 */
export function answerFromWork(item: MathItem, values: Values): string | null {
  const cells = answerCells(item);
  if (!cells.length || cells.some((c) => !c.spare && !(values[c.id] ?? "").trim())) return null;
  if (item.kind === "fraction_sum") return `${normalizeNumber(values[cells[0].id] ?? "")}/${normalizeNumber(values[cells[1]?.id] ?? "")}`;
  const text = cells.map((c) => (values[c.id] ?? "").trim()).join("");
  return text ? normalizeNumber(text) : null;
}

// ---------------------------------------------------------------- answers

/** A fraction as typed (`5/7`, `5 / 7`), or null. */
export function parseFrac(raw: string): Frac | null {
  const m = /^\s*(-?\d+)\s*\/\s*(\d+)\s*$/.exec(raw);
  if (!m) return null;
  const f = { n: Number(m[1]), d: Number(m[2]) };
  return f.d > 0 ? f : null;
}

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** Is the kid's answer (already canonical) the item's? A fraction sum takes any equal fraction (`6/8` for `3/4`). */
export function answersEqual(item: MathItem, kid: string): boolean {
  if (!kid) return false;
  if (kid === item.answer) return true;
  if (item.kind === "fraction_sum") {
    const a = parseFrac(kid);
    const b = parseFrac(item.answer);
    return a !== null && b !== null && a.n * b.d === b.n * a.d;
  }
  return false;
}

/**
 * The kid's answer in the form `item.answer` is written in. For a missing digit the whole addend
 * counts too: `66` for `?6` reads as `6`.
 */
export function canonicalAnswer(item: MathItem, raw: string): string {
  if (item.math?.kind === "equation") {
    const t = raw.replace(/\s+/g, "").replace(/[−–—]/g, "-");
    const m = new RegExp(`^(?:${item.math.letter}=)?(-?\\d+)$`, "i").exec(t);
    return m ? String(Number(m[1])) : t;
  }
  if (item.kind === "fraction_sum") {
    const f = parseFrac(raw);
    return f ? `${f.n}/${f.d}` : raw.replace(/\s+/g, "");
  }
  if (item.kind === "equivalent" && item.math?.kind === "equivalent") {
    // `9/12` for `?/12` reads as 9
    const f = parseFrac(raw);
    if (f && f.d === item.math.to) return String(f.n);
  }
  const s = normalizeNumber(raw);
  const hidden = item.hidden;
  if (!hidden || s.length !== hidden.template.length || s.length < 2) return s;
  for (let i = 0; i < s.length; i++) {
    if (hidden.template[i] !== "?" && hidden.template[i] !== s[i]) return s;
  }
  return s[hidden.template.indexOf("?")];
}

/**
 * The answer with the digits from `place` up replaced (a carry back into an answer typed on its own):
 * one digit (`8` into the tens of `75`), or more (`24` into the tens and hundreds of `2400`).
 */
export function patchAnswer(item: MathItem, answer: string, place: number, digit: string): string {
  const s = normalizeNumber(answer);
  if (!s) return s;
  if (item.kind === "missing_addend") {
    const hidden = item.hidden!;
    return s.length === hidden.template.length && s.length > 1 ? hidden.template.replace("?", digit) : digit;
  }
  if (!/^\d+$/.test(s) || !/^\d+$/.test(digit)) return s;
  let out = s;
  for (let k = 0; k < digit.length; k++) {
    const p = place + (digit.length - 1 - k);
    while (out.length - 1 < p) out = `0${out}`;
    const i = out.length - 1 - p;
    out = out.slice(0, i) + digit[k] + out.slice(i + 1);
  }
  return normalizeNumber(out);
}

// ---------------------------------------------------------------- the smaller problem's line

const SIGN_WORDS: Readonly<Record<string, string>> = { "+": "plus", "−": "minus", "×": "times", "÷": "divided by", "=": "equals" };

/**
 * One line with one box (Phase 3's smaller problems): `12 − 7 = ?`, `30 + 12 = ?`, `4 × 7 + 4 = ?`.
 * Numbers are the tutor's, `?` is the box (as wide as its answer), signs are written between.
 */
export function lineFact(tokens: readonly (number | "?" | Op | "=")[], answer: number, skill: SkillId): MathItem {
  if (tokens.filter((t) => t === "?").length !== 1) throw new Error("lineFact: exactly one box");
  const parts: (Cell | string)[] = tokens.map((t, i) =>
    t === "?"
      ? { id: "x", role: "blank", place: i, expect: String(answer), ...(String(answer).length > 1 ? { width: String(answer).length } : {}) }
      : typeof t === "number"
        ? { id: `q${i}`, role: "given", place: i, value: String(t) }
        : t,
  );
  const text = tokens.map(String).join(" ");
  const words = tokens.map((t) => (t === "?" ? "blank" : typeof t === "number" ? String(t) : SIGN_WORDS[t])).join(" ");
  const numbers = tokens.filter((t): t is number => typeof t === "number");
  return {
    id: `fact:${text.replace(/\s+/g, "")}`,
    skill,
    kind: "fact",
    text,
    words,
    addends: numbers,
    total: answer,
    answer: String(answer),
    layout: { kind: "equation", line: { id: "fact", parts } },
  };
}
