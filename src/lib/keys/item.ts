/**
 * Keys (docs/KEYS.md): one problem as the page lays it out. A MathItem is a layout of cells. The
 * tutor's cells are `given`; the kid fills `digit`, `blank` and `carry` cells. Pure data, no DOM, so
 * the same engine can run on the iPad later.
 *
 * Phase 1 builds two layouts: `columns` (a sum set out in place-value columns, with a carry row) and
 * `equation` (one line, for the smaller problem the tutor writes under a slip). Fractions and free
 * lines are Phase 3.
 */
import type { SkillId } from "@/lib/learning/contracts";

export type CellRole = "digit" | "carry" | "blank" | "given";

export interface Cell {
  /** unique in its item: `c1` carry into the tens, `a0` the first addend's ones, `r1` the answer's tens, `x` a blank */
  id: string;
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

export type LineRole = "carry" | "operand" | "result";

export interface ColumnLine {
  id: string;
  role: LineRole;
  /** the sign written before the line: `+` on the last addend */
  op?: "+";
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

export type Layout = ColumnsLayout | EquationLayout;

export type ItemKind = "sum" | "missing_addend" | "fact";

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
  /** the answer row's right answer */
  answer: string;
  layout: Layout;
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
  if (item.layout.kind === "equation") return item.layout.line.parts.filter((p): p is Cell => typeof p !== "string");
  return item.layout.lines.flatMap((l) => l.cells.filter((c): c is Cell => c !== null));
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
  return item.layout.kind === "equation" ? [item.layout.line.id] : item.layout.lines.map((l) => l.id);
}

export function lineOfCell(item: MathItem, cellId: string): string | null {
  if (item.layout.kind === "equation") return item.layout.line.parts.some((p) => typeof p !== "string" && p.id === cellId) ? item.layout.line.id : null;
  return item.layout.lines.find((l) => l.cells.some((c) => c?.id === cellId))?.id ?? null;
}

/** The kid cells that hold the answer: the result row of a sum, the box of a missing digit. */
export function answerCells(item: MathItem): Cell[] {
  if (item.kind === "sum") return kidCells(item).filter((c) => c.role === "digit");
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
  if (cells.some((c) => !c.spare && !(values[c.id] ?? "").trim())) return null;
  const text = cells.map((c) => (values[c.id] ?? "").trim()).join("");
  return text ? normalizeNumber(text) : null;
}

/**
 * The kid's answer in the form `item.answer` is written in. For a missing digit the whole addend
 * counts too: `66` for `?6` reads as `6`.
 */
export function canonicalAnswer(item: MathItem, raw: string): string {
  const s = normalizeNumber(raw);
  const hidden = item.hidden;
  if (!hidden || s.length !== hidden.template.length || s.length < 2) return s;
  for (let i = 0; i < s.length; i++) {
    if (hidden.template[i] !== "?" && hidden.template[i] !== s[i]) return s;
  }
  return s[hidden.template.indexOf("?")];
}

/** The answer with the digit at `place` replaced (a carry back into an answer typed on its own). */
export function patchAnswer(item: MathItem, answer: string, place: number, digit: string): string {
  const s = normalizeNumber(answer);
  if (!s) return s;
  if (item.kind === "missing_addend") {
    const hidden = item.hidden!;
    return s.length === hidden.template.length && s.length > 1 ? hidden.template.replace("?", digit) : digit;
  }
  const i = s.length - 1 - place;
  if (i < 0) return s;
  return s.slice(0, i) + digit + s.slice(i + 1);
}
