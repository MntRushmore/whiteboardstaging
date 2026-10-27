/**
 * What a screen reader says for each cell of a Keys problem (docs/KEYS.md, Phase 4): where it is,
 * what it holds ("Tens digit of the answer, empty"), and "Look again." on a cell the tutor ringed.
 * Pure, so every layout's names are tested without a browser.
 */
import { cellById, lineOfCell, placeName, type Cell, type MathItem } from "./item";

const ROW_NAMES: Readonly<Record<string, string>> = { p0: "the first row", p1: "the second row", result: "the answer" };

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Where a cell is, in words: "tens digit of the answer", "carry into the hundreds", "top of your fraction". */
export function cellName(item: MathItem, cell: Cell): string {
  const place = placeName(cell.place);
  if (item.layout.kind === "fraction") return cell.place === 0 ? "top of your fraction (the numerator)" : "bottom of your fraction (the denominator)";
  if (item.layout.kind === "equation") return "the box";
  if (cell.role === "carry") return item.kind === "difference" ? `${place} digit after regrouping` : `carry into the ${place}`;
  if (cell.role === "blank") return `missing ${place} digit`;
  const line = lineOfCell(item, cell.id) ?? "result";
  if (cell.spare) return `spare box, left of ${ROW_NAMES[line] ?? "the answer"}`;
  return `${place} digit of ${ROW_NAMES[line] ?? "the answer"}`;
}

/** The whole label: where, what it holds, and the tutor's ring. */
export function cellLabel(item: MathItem, cell: Cell, value: string, ringed: boolean): string {
  const holds = value.trim() ? value.trim() : "empty";
  return `${cap(cellName(item, cell))}, ${holds}${ringed ? ". Look again." : ""}`;
}

/** "Look again." with where: the first cell ringed, else the line. */
export function lookAgainWhere(item: MathItem, ringed: readonly string[]): string {
  const cell = ringed.length ? cellById(item, ringed[0]) : undefined;
  return cell ? `Look again at the ${cellName(item, cell)}.` : "Look again.";
}
