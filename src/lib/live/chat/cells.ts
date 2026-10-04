import type { InkLine, Rect } from "../contracts";

/**
 * A problem the board chat wrote, and the space under it where the student works it — so a
 * student solving it gets the same ticks and rings as on a problem of their own. The problem is
 * the FIRST LINE of the column the student writes under it: the context their first line is
 * checked against (`LiveLoop.columnContext`), the line a wrong first step is corrected from
 * (`rightNextStep`), and the problem a model check sees (`buildCheckLines`).
 *
 * Every stroke of a problem the chat writes (its number and its lines) carries
 * `meta[CHAT_PROBLEM_META] = { n, lines, cell }`: the problem as LaTeX and its grid cell. That is
 * all the board needs, also after a reload: the cells come back from the strokes.
 */
export const CHAT_PROBLEM_META = "chatProblem";

export interface ProblemCell {
  /** the block the problem was written as (one per problem) */
  key: string;
  n: number;
  /** the problem's lines, as LaTeX (a system has two or three) */
  lines: string[];
  /** where the problem's ink is */
  head: Rect;
  /** the grid cell: the problem at its top, the student's working under it */
  cell: Rect;
}

function isRect(v: unknown): v is Rect {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return ["x", "y", "w", "h"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k] as number)) && (r.w as number) > 0 && (r.h as number) > 0;
}

/** The problem meta of a shape, or null. */
export function problemMetaOf(meta: unknown): { n: number; lines: string[]; cell: Rect } | null {
  if (!meta || typeof meta !== "object") return null;
  const v = (meta as Record<string, unknown>)[CHAT_PROBLEM_META];
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const lines = Array.isArray(p.lines) ? p.lines.filter((l): l is string => typeof l === "string" && l.length > 0) : [];
  if (lines.length === 0 || !isRect(p.cell)) return null;
  return { n: typeof p.n === "number" ? p.n : 0, lines, cell: p.cell };
}

/** A problem's cell key (`ProblemCell.key`): the block it was written as, else its number and lines. */
export function problemKeyOf(block: string, p: { n: number; lines: string[] }): string {
  return block || `${p.n}:${p.lines.join(";")}`;
}

/**
 * The problems on a screen, from the tutor's strokes: grouped by the block they were written as,
 * each with where its ink is. A problem the student rubbed out entirely is gone; one partly rubbed
 * out still heads its cell.
 */
export function readProblemCells(shapes: ReadonlyArray<{ block: string; meta: unknown; bounds: Rect }>): ProblemCell[] {
  const byKey = new Map<string, ProblemCell>();
  for (const s of shapes) {
    const p = problemMetaOf(s.meta);
    if (!p) continue;
    const key = problemKeyOf(s.block, p);
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { key, n: p.n, lines: p.lines, head: { ...s.bounds }, cell: p.cell });
      continue;
    }
    const x0 = Math.min(cur.head.x, s.bounds.x);
    const y0 = Math.min(cur.head.y, s.bounds.y);
    const x1 = Math.max(cur.head.x + cur.head.w, s.bounds.x + s.bounds.w);
    const y1 = Math.max(cur.head.y + cur.head.h, s.bounds.y + s.bounds.h);
    cur.head = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return [...byKey.values()].sort((a, b) => a.cell.y - b.cell.y || a.cell.x - b.cell.x);
}

/**
 * Where each of a problem's lines is written, without its number (`1.`): the rects the tutor lines
 * its own work up under, as a student would. Every stroke of the tutor's hand carries the LaTeX of
 * its line (`line`, the loop's `meta.handLine`); a line with no stroke found (the hand was off and
 * the problem is typeset, or the student rubbed that line out) is the whole head.
 */
export function problemLines(shapes: ReadonlyArray<{ block: string; meta: unknown; bounds: Rect; line: string }>, cell: ProblemCell): Rect[] {
  const rects = cell.lines.map((): Rect | null => null);
  for (const s of shapes) {
    const p = problemMetaOf(s.meta);
    if (!p || problemKeyOf(s.block, p) !== cell.key) continue;
    const i = cell.lines.indexOf(s.line);
    if (i === -1) continue;
    const cur = rects[i];
    if (!cur) {
      rects[i] = { ...s.bounds };
      continue;
    }
    const x0 = Math.min(cur.x, s.bounds.x);
    const y0 = Math.min(cur.y, s.bounds.y);
    rects[i] = { x: x0, y: y0, w: Math.max(cur.x + cur.w, s.bounds.x + s.bounds.w) - x0, h: Math.max(cur.y + cur.h, s.bounds.y + s.bounds.h) - y0 };
  }
  return rects.map((r) => r ?? { ...cell.head });
}

/**
 * The problem a line of the student's is written under: the cell its middle is in, level with
 * the problem or below it (a line beside the problem, `= 4` after it, counts; one above it does not).
 */
export function cellOf(bounds: Rect, cells: readonly ProblemCell[]): ProblemCell | null {
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  for (const c of cells) {
    const r = c.cell;
    if (cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.h) continue;
    if (cy < c.head.y) continue;
    return c;
  }
  return null;
}

/**
 * The columns with the chat's problems taken into account: work in two cells is never one column
 * (a student finishing problem 1 low in its cell and starting problem 4 just under it would
 * otherwise be read as one derivation), and each column under a problem knows its head.
 *
 * `lines` come from `clusterLines` (columns by overlap and gaps). Lines are regrouped by (their
 * column, their cell), columns renumbered left to right as `assignColumns` does, rows top to
 * bottom. With no line in any cell nothing changes.
 */
export function splitColumnsAtProblems(lines: readonly InkLine[], cells: readonly ProblemCell[]): { lines: InkLine[]; heads: Map<number, ProblemCell> } {
  const heads = new Map<number, ProblemCell>();
  if (cells.length === 0 || lines.length === 0) return { lines: [...lines], heads };
  const cellOfLine = lines.map((l) => cellOf(l.bounds, cells));
  if (cellOfLine.every((c) => c === null)) return { lines: [...lines], heads };
  const groups = new Map<string, { lines: InkLine[]; cell: ProblemCell | null }>();
  lines.forEach((l, i) => {
    const cell = cellOfLine[i];
    const key = `${l.column}|${cell?.key ?? ""}`;
    const g = groups.get(key);
    if (g) g.lines.push(l);
    else groups.set(key, { lines: [l], cell });
  });
  const ordered = [...groups.values()]
    .map((g) => ({ ...g, x0: Math.min(...g.lines.map((l) => l.bounds.x)), y0: Math.min(...g.lines.map((l) => l.bounds.y)) }))
    .sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  const out: InkLine[] = [];
  ordered.forEach((g, column) => {
    const sorted = [...g.lines].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
    sorted.forEach((l, row) => out.push({ ...l, column, row }));
    if (g.cell) heads.set(column, g.cell);
  });
  return { lines: out, heads };
}
