/**
 * The keyboard map (docs/KEYS.md, "Keys"): a key on a slot of the page becomes an intent, and the
 * column's cells know their neighbours. Pure, so the whole map is tested without a browser; the
 * page's components only carry the intents out.
 */
import { kidCells, type Cell, type MathItem } from "./item";

/** Where focus is: a column cell, a typed step, the answer row, the smaller problem's box. */
export type SlotKind = "cell" | "step" | "answer" | "box";

export type Dir = "left" | "right" | "up" | "down";

export type Intent =
  | { type: "digit"; digit: string }
  | { type: "erase" }
  | { type: "move"; dir: Dir }
  | { type: "carry" }
  | { type: "enter" }
  | { type: "check" }
  | { type: "help" }
  | { type: "add_block" };

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

const ARROWS: Record<string, Dir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

/**
 * The intent of a key, or null to let the browser have it (Tab, typing in a text line, Ctrl+R).
 * The page calls `preventDefault` only for a non-null intent.
 */
export function intentFor(e: KeyLike, slot: SlotKind): Intent | null {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return { type: "check" };
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === "?") return { type: "help" };
  if (e.key === "Enter") return { type: "enter" };
  const digit = /^[0-9]$/.test(e.key) ? e.key : null;
  switch (slot) {
    case "cell":
      if (digit) return { type: "digit", digit };
      if (e.key === "Backspace" || e.key === "Delete") return { type: "erase" };
      if (ARROWS[e.key]) return { type: "move", dir: ARROWS[e.key] };
      if (e.key === "c" || e.key === "C") return { type: "carry" };
      return null;
    case "box":
      if (digit) return { type: "digit", digit };
      if (e.key === " ") return { type: "add_block" };
      if (e.key === "Backspace" || e.key === "Delete") return { type: "erase" };
      if (e.key === "ArrowUp" || e.key === "ArrowDown") return { type: "move", dir: ARROWS[e.key] };
      return null;
    case "step":
      if (e.key === "ArrowUp" || e.key === "ArrowDown") return { type: "move", dir: ARROWS[e.key] };
      // Backspace edits the text; the page removes the line only when it is already empty.
      if (e.key === "Backspace") return { type: "erase" };
      return null;
    case "answer":
      if (e.key === "ArrowUp") return { type: "move", dir: "up" };
      return null;
  }
}

// ---------------------------------------------------------------- the column's cells

interface GridCell {
  cell: Cell;
  row: number;
  col: number;
}

/** The kid cells of a column item with their row (line) and column on the page. */
function grid(item: MathItem): GridCell[] {
  if (item.layout.kind !== "columns") return kidCells(item).map((cell, i) => ({ cell, row: 0, col: i }));
  const out: GridCell[] = [];
  item.layout.lines.forEach((line, row) =>
    line.cells.forEach((cell, col) => {
      if (cell && cell.role !== "given") out.push({ cell, row, col });
    }),
  );
  return out;
}

function at(item: MathItem, id: string): GridCell | undefined {
  return grid(item).find((g) => g.cell.id === id);
}

/** The cell an arrow moves to, or null at the column's edge. Up and down skip lines with no kid cell. */
export function gridMove(item: MathItem, id: string, dir: Dir): string | null {
  const here = at(item, id);
  if (!here) return null;
  const cells = grid(item);
  if (dir === "left" || dir === "right") {
    const row = cells.filter((g) => g.row === here.row && (dir === "left" ? g.col < here.col : g.col > here.col));
    row.sort((p, q) => (dir === "left" ? q.col - p.col : p.col - q.col));
    return row[0]?.cell.id ?? null;
  }
  const rows = cells.filter((g) => (dir === "up" ? g.row < here.row : g.row > here.row));
  if (!rows.length) return null;
  const nextRow = dir === "up" ? Math.max(...rows.map((g) => g.row)) : Math.min(...rows.map((g) => g.row));
  const inRow = rows.filter((g) => g.row === nextRow);
  inRow.sort((p, q) => Math.abs(p.col - here.col) - Math.abs(q.col - here.col));
  return inRow[0].cell.id;
}

/**
 * Where focus goes after a digit. In a line of digits, one cell left (digits fill right to left);
 * after a carry, back down to its column.
 */
export function afterDigit(item: MathItem, id: string): string | null {
  const here = at(item, id);
  if (!here) return null;
  if (here.cell.role === "carry") return gridMove(item, id, "down");
  return gridMove(item, id, "left");
}

/** `c`: the carry cell over this column, or over the next column left (from the ones). */
export function carryFor(item: MathItem, id: string): string | null {
  const here = at(item, id);
  if (!here || here.cell.role === "carry") return null;
  const carries = grid(item).filter((g) => g.cell.role === "carry");
  return (carries.find((g) => g.cell.place === here.cell.place) ?? carries.find((g) => g.cell.place === here.cell.place + 1))?.cell.id ?? null;
}

/** Where the kid starts: a sum's ones cell, a missing digit's box. */
export function firstCell(item: MathItem): string | null {
  const cells = grid(item).filter((g) => g.cell.role !== "carry" && !g.cell.spare);
  const ones = cells.filter((g) => g.cell.place === Math.min(...cells.map((c) => c.cell.place)));
  return ones[ones.length - 1]?.cell.id ?? null;
}

/** The bottom line's cells (the arrow down from them leaves the column). */
export function isBottomRow(item: MathItem, id: string): boolean {
  const here = at(item, id);
  return !!here && gridMove(item, id, "down") === null;
}
