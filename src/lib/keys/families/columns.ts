/**
 * What the column families share (docs/KEYS.md, Phase 3): a given number as a line of cells, a kid's
 * result row (leading places it does not need are spare), and the place names.
 */
import { digitAt, digitCount, type Cell, type ColumnLine, type Op } from "../item";

/** A number written by the tutor, one cell per place, highest first; null left of its first digit. */
export function givenRow(id: string, n: number, places: number, op?: Op, role: ColumnLine["role"] = "operand"): ColumnLine {
  const cells: (Cell | null)[] = [];
  for (let p = places - 1; p >= 0; p--) {
    cells.push(p < digitCount(n) ? { id: `${id}${p}`, role: "given", place: p, value: String(digitAt(n, p)) } : null);
  }
  return { id, role, cells, ...(op ? { op } : {}) };
}

/**
 * A row the kid writes `n` in: one digit cell per place. Places left of `n`'s first digit are spare
 * (they should stay empty); `from` leaves the places under it out (a partial row's ones, never).
 */
export function kidRow(id: string, n: number, places: number, role: ColumnLine["role"], op?: Op, cellPrefix = id): ColumnLine {
  const cells: (Cell | null)[] = [];
  for (let p = places - 1; p >= 0; p--) {
    cells.push(p >= digitCount(n) ? { id: `${cellPrefix}${p}`, role: "digit", place: p, expect: "", spare: true } : { id: `${cellPrefix}${p}`, role: "digit", place: p, expect: String(digitAt(n, p)) });
  }
  return { id, role, cells, ...(op ? { op } : {}) };
}

/** A column problem's digits by place, ones first. */
export function digitsOf(n: number, places = digitCount(n)): number[] {
  return Array.from({ length: places }, (_, p) => digitAt(n, p));
}

/** Digits (ones first) back to a number. */
export function fromDigits(ds: readonly number[]): number {
  return ds.reduce((acc, d, p) => acc + d * 10 ** p, 0);
}
