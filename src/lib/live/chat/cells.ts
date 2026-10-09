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
 * The line is written on the problem's own row, after it: `= 4` beside `2 + 2`. Level with it (they
 * overlap by at least a third of the shorter one's height) and starting past the middle of it — a
 * young hand's digits stand taller than the tutor's problem, their middle often above its top.
 */
export function besideProblem(bounds: Rect, head: Rect): boolean {
  const overlap = Math.min(bounds.y + bounds.h, head.y + head.h) - Math.max(bounds.y, head.y);
  return overlap >= Math.max(1, Math.min(bounds.h, head.h)) / 3 && bounds.x >= head.x + head.w / 2;
}

/** The middle of `r` is in the cell's column (between its left and right edges). */
function inColumn(r: Rect, c: ProblemCell): boolean {
  const cx = r.x + r.w / 2;
  return cx >= c.cell.x && cx <= c.cell.x + c.cell.w;
}

/**
 * Strokes the clusterer made one line that are two problems' work: some beside one of the chat's
 * problems, on its row (`besideProblem`), and others UNDER another one — in its cell, below its
 * number and its sum. A young hand's `= - 10` beside `1. -3 - 7`, its 0 ending just before
 * `2. (-4)(-3)`, ran into the minus she had started under problem 2 (a row apart only by the
 * problems' layout: the minus is level with her tall digits), and `=-10-` was read. The strokes under
 * the other problem are lines of their own, one per problem; anything else stays as it was — a line
 * written under its problem that runs on under the next one (nothing of it beside a problem) is one line.
 */
export function splitAcrossProblems<S extends { bounds: Rect }>(group: S[], cells: readonly ProblemCell[]): S[][] {
  if (cells.length < 2 || group.length < 2) return [group];
  const beside = splitBesideProblem(group, cells);
  return beside.length > 1 ? beside : splitAtCells(group, cells);
}

/** `splitAcrossProblems`' first case: ink beside one problem, and ink under another. */
function splitBesideProblem<S extends { bounds: Rect }>(group: S[], cells: readonly ProblemCell[]): S[][] {
  const besideOf = (s: S) => cells.find((c) => inColumn(s.bounds, c) && besideProblem(s.bounds, c.head))?.key;
  const underOf = (s: S) =>
    cells.find((c) => inColumn(s.bounds, c) && s.bounds.y >= c.head.y + c.head.h && s.bounds.y + s.bounds.h / 2 <= c.cell.y + c.cell.h)?.key;
  const homes = new Set(group.map(besideOf).filter((k): k is string => Boolean(k)));
  if (homes.size !== 1) return [group];
  const [home] = homes;
  const rest: S[] = [];
  const others = new Map<string, S[]>();
  for (const s of group) {
    const under = besideOf(s) ? undefined : underOf(s);
    if (under && under !== home) others.set(under, [...(others.get(under) ?? []), s]);
    else rest.push(s);
  }
  return others.size === 0 || rest.length === 0 ? [group] : [rest, ...others.values()];
}

/**
 * A gap in a line at least this many of its glyphs wide is a cut between two problems' cells
 * (`splitAtCells`): the clusterer's own reach between neighbouring glyphs (`CLUSTER_RULES.gapFactor`),
 * so ink closer than that is one written run. Kept here so the pages that read problem cells
 * (`lib/daily`, the tour) do not load the clusterer.
 */
const CELL_CUT_GAP_FACTOR = 1.2;

function boxOf(rects: readonly Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  return { x: x0, y: y0, w: Math.max(...rects.map((r) => r.x + r.w)) - x0, h: Math.max(...rects.map((r) => r.y + r.h)) - y0 };
}

/**
 * `splitAcrossProblems`' second case: answers written across a row of the chat's problems, one
 * under each. Today's practice writes a young class's sums side by side (`1. 9 + 3   2. 4 + 9`), and
 * a child writes `12` under the first and `13` under the second: on a phone or an iPad the two are
 * less than `sameRowMaxGapFactor` of her big digits apart, so the clusterer made them ONE line, read
 * `12 13`, ringed as one, the first answer's tick taken away. The group is cut where its ink moves
 * from one problem's cell to the next: at a gap in it at least `gapFactor` of its glyphs wide (no
 * stroke crosses it), the ink on each side of the gap in a different cell (`cellOf`: under the
 * problem, or beside it on its row). Ink in no cell goes with the ink before it. A line written
 * under one problem that runs on under the next with no such gap (its next glyph a glyph's space
 * on) has no cut, and stays one line.
 */
function splitAtCells<S extends { bounds: Rect }>(group: S[], cells: readonly ProblemCell[]): S[][] {
  // the hand's size: its glyphs' median height, level bars left out (`medianStrokeHeight`)
  const tall = group.map((s) => s.bounds).filter((r) => r.h >= 4 && r.w <= 3 * r.h);
  const heights = (tall.length > 0 ? tall : group.map((s) => s.bounds)).map((r) => r.h).sort((a, b) => a - b);
  const mid = Math.floor(heights.length / 2);
  const glyph = Math.max(8, heights.length % 2 === 1 ? heights[mid] : (heights[mid - 1] + heights[mid]) / 2);
  const minGap = CELL_CUT_GAP_FACTOR * glyph;
  // runs of ink left to right, cut at each gap at least `minGap` wide
  const runs: S[][] = [];
  let reach = -Infinity;
  for (const s of [...group].sort((a, b) => a.bounds.x - b.bounds.x)) {
    const last = runs[runs.length - 1];
    if (last && s.bounds.x - reach < minGap) last.push(s);
    else runs.push([s]);
    reach = Math.max(reach, s.bounds.x + s.bounds.w);
  }
  if (runs.length < 2) return [group];
  const keys = runs.map((run) => cellOf(boxOf(run.map((s) => s.bounds)), cells)?.key ?? null);
  const first = keys.find((k): k is string => k !== null);
  if (first === undefined) return [group];
  const parts: Array<{ key: string; strokes: S[] }> = [];
  runs.forEach((run, i) => {
    const key = keys[i] ?? parts[parts.length - 1]?.key ?? first;
    const last = parts[parts.length - 1];
    if (last && last.key === key) last.strokes.push(...run);
    else parts.push({ key, strokes: [...run] });
  });
  return parts.length < 2 ? [group] : parts.map((p) => p.strokes);
}

/**
 * The problem a line of the student's is written under: the cell its middle is in, level with
 * the problem or below it (a line beside the problem, `= 4` after it, counts — however tall; one
 * above it does not).
 */
export function cellOf(bounds: Rect, cells: readonly ProblemCell[]): ProblemCell | null {
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  for (const c of cells) {
    const r = c.cell;
    if (cx < r.x || cx > r.x + r.w || cy > r.y + r.h) continue;
    if ((cy < r.y || cy < c.head.y) && !besideProblem(bounds, c.head)) continue;
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
