import type { ChartSpec } from "../contracts";
import { measureWords, type WordsLayout } from "../words";
import { INK, LECTURE_PACE, LECTURE_TEXT, Sketch, TITLE_GAP, closedStroke, fitTitle, innerBox, inside, shapeStyle, type LectureSketch } from "./sketch";

/**
 * A table as a teacher rules one on the board: the frame, the column lines, the headings with a
 * double line under them, the rows ruled off, each cell's words centred in it. Columns are as wide
 * as their writing needs; when the whole is too wide, the columns with the most to say give up
 * width first and their cells wrap (at most three lines), then the writing shrinks. Null when even
 * the smallest writing will not fit the box.
 */

export type TableChart = Extract<ChartSpec, { kind: "table" }>;

export const TABLE = {
  levels: [1, 0.93, 0.86, 0.8, 0.75],
  pad: { x: 9, y: 7 },
  /** the second line under the headings */
  doubleGap: 4,
  maxLines: 3,
  /** the headings' row is tinted in this colour */
  headerInk: "light-blue",
} as const;

interface Grid {
  size: number;
  colW: number[];
  rowH: number[];
  cells: Array<Array<WordsLayout | null>>;
}

/** The cells wrapped into columns of these widths (padding excluded); null when one will not fit. */
function wrapInto(spec: TableChart, size: number, colW: readonly number[], maxH: number): Grid | null {
  const P = TABLE.pad;
  const rows = [spec.columns, ...spec.rows];
  const cells: Array<Array<WordsLayout | null>> = [];
  const rowH: number[] = [];
  // a cell not said yet ("") is left empty, its row as tall as a line of writing
  const lineH = measureWords("Hg", size)!.h;
  for (const row of rows) {
    const laid: Array<WordsLayout | null> = [];
    for (let j = 0; j < colW.length; j++) {
      const text = (row[j] ?? "").trim();
      if (!text) {
        laid.push(null);
        continue;
      }
      const m = measureWords(text, size, { maxWidth: colW[j] + 0.5, maxLines: TABLE.maxLines, balance: true });
      if (!m) return null;
      laid.push(m);
    }
    cells.push(laid);
    rowH.push(Math.max(lineH, ...laid.map((m) => m?.h ?? 0)) + 2 * P.y);
  }
  if (rowH.reduce((a, b) => a + b, 0) + TABLE.doubleGap > maxH) return null;
  return { size, colW: colW.map((w) => w + 2 * P.x), rowH, cells };
}

/**
 * Column widths and wrapped cells at hand size `size`, or null when they cannot fit `maxW` × `maxH`.
 * Every column as wide as its widest cell when that fits; else the table that comes out shortest
 * of a few ways of taking the width back (from every column in proportion, or from the widest).
 */
function grid(spec: TableChart, size: number, maxW: number, maxH: number): Grid | null {
  const P = TABLE.pad;
  const rows = [spec.columns, ...spec.rows];
  const nCols = spec.columns.length;
  const natural: number[] = Array(nCols).fill(0);
  const least: number[] = Array(nCols).fill(0);
  for (const row of rows) {
    row.forEach((cell, j) => {
      const one = measureWords(cell, size);
      if (!one) return;
      natural[j] = Math.max(natural[j], one.w);
      for (const word of cell.split(/\s+|(?<=-)/)) least[j] = Math.max(least[j], measureWords(word, size)?.w ?? 0);
    });
  }
  const room = maxW - nCols * 2 * P.x;
  if (natural.reduce((a, b) => a + b, 0) <= room) return wrapInto(spec, size, natural, maxH);
  const spare = room - least.reduce((a, b) => a + b, 0);
  if (spare < 0) return null;
  const candidates: number[][] = [];
  const want = natural.map((n, j) => n - least[j]);
  const total = want.reduce((a, b) => a + b, 0) || 1;
  candidates.push(least.map((l, j) => l + (spare * want[j]) / total));
  // only the widest columns give up width, the others keep theirs
  const order = natural.map((_, j) => j).sort((a, b) => natural[b] - natural[a]);
  for (let give = 1; give < nCols; give++) {
    const takers = order.slice(0, give);
    const keep = natural.reduce((a, n, j) => a + (takers.includes(j) ? 0 : n), 0);
    const left = room - keep;
    const need = takers.reduce((a, j) => a + least[j], 0);
    if (left < need) continue;
    const tw = takers.reduce((a, j) => a + want[j], 0) || 1;
    candidates.push(natural.map((n, j) => (takers.includes(j) ? least[j] + ((left - need) * want[j]) / tw : n)));
  }
  let best: Grid | null = null;
  for (const colW of candidates) {
    const g = wrapInto(spec, size, colW, maxH);
    if (g && (!best || g.rowH.reduce((a, b) => a + b, 0) < best.rowH.reduce((a, b) => a + b, 0))) best = g;
  }
  return best;
}

function attempt(spec: TableChart, box: { w: number; h: number }, k: number, seed: number): LectureSketch | null {
  const T = LECTURE_TEXT;
  const title = fitTitle(spec.title, box.w, k);
  if (spec.title && !title) return null;
  const top = title ? title.h + TITLE_GAP : 0;
  const size = Math.max(T.label.min, Math.round(T.label.size * k));
  const g = grid(spec, size, box.w, box.h - top);
  if (!g) return null;
  const W = g.colW.reduce((a, b) => a + b, 0);
  const x0 = (box.w - W) / 2;
  const colX = g.colW.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [x0]);
  // the headings' row is followed by a double line: every row below it moves down by the gap
  const rowY = g.rowH.reduce<number[]>((acc, h, i) => [...acc, acc[acc.length - 1] + h + (i === 0 ? TABLE.doubleGap : 0)], [top]);
  const bottom = rowY[rowY.length - 1];
  const right = x0 + W;

  const s = new Sketch(seed);
  const ink = { color: INK.line };
  if (title) s.write("title", title, { x: box.w / 2, y: 0 }, "center", "top");

  // the headings' row tinted, then the frame and the column lines over it
  const hy = rowY[0] + g.rowH[0];
  s.draw(
    "header",
    (pen) =>
      closedStroke(pen, [
        { x: x0, y: hy + TABLE.doubleGap },
        { x: x0, y: top },
        { x: right, y: top },
        { x: right, y: hy + TABLE.doubleGap },
      ]),
    shapeStyle(TABLE.headerInk),
  );
  s.draw(
    "frame",
    (pen) => [
      ...pen.line({ x: x0, y: top }, { x: right, y: top }),
      ...pen.line({ x: right, y: top }, { x: right, y: bottom }),
      ...pen.line({ x: right, y: bottom }, { x: x0, y: bottom }),
      ...pen.line({ x: x0, y: bottom }, { x: x0, y: top }),
    ],
    ink,
  );
  for (let j = 1; j < g.colW.length; j++) s.draw(`column:${j}`, (pen) => pen.line({ x: colX[j], y: top }, { x: colX[j], y: bottom }), ink);

  const cell = (i: number, j: number) => {
    const m = g.cells[i][j];
    if (!m) return;
    s.write(i === 0 ? `head:${j}` : `cell:${i}:${j}`, m, { x: colX[j] + g.colW[j] / 2, y: rowY[i] + g.rowH[i] / 2 }, "center", "middle");
  };
  // the headings, and the double line under them
  for (let j = 0; j < g.colW.length; j++) cell(0, j);
  s.draw("rule:0", (pen) => [...pen.line({ x: x0, y: hy }, { x: right, y: hy }), ...pen.line({ x: x0, y: hy + TABLE.doubleGap }, { x: right, y: hy + TABLE.doubleGap })], ink);
  // each row, ruled off from the next
  for (let i = 1; i < g.cells.length; i++) {
    if (i > 1) s.draw(`rule:${i - 1}`, (pen) => pen.line({ x: x0, y: rowY[i] }, { x: right, y: rowY[i] }), ink);
    for (let j = 0; j < g.colW.length; j++) cell(i, j);
  }
  return s.finish(box, LECTURE_PACE.chart, size, { x: 0, y: 0 });
}

export function sketchTable(spec: TableChart, box: { w: number; h: number }, seed: number): LectureSketch | null {
  if (spec.columns.length < 1 || spec.rows.some((r) => r.length !== spec.columns.length)) return null;
  for (const k of TABLE.levels) {
    const r = attempt(spec, innerBox(box), k, seed);
    if (r && inside(r.plan.bounds, box)) return r;
  }
  return null;
}
