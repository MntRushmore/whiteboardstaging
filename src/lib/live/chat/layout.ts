import type { Rect } from "../contracts";
import { paceFor, type HandPlan } from "../handwriting";

/**
 * Where the board chat writes: a problem set as a grid on a 1600×900 screen with room to work
 * under each problem, and everything else (lines, a graph, a figure) in the first free space in
 * reading order. Pure geometry; the desk (`desk.ts`) measures the hand plans and places them.
 */

export const PROBLEM_GRID = {
  /** the tutor's hand for a problem (the largest it writes: problems are read from across a room) */
  size: 48,
  /** the smallest it shrinks to when a long problem does not fit its cell */
  minSize: 28,
  /** space kept to the screen's sides and bottom */
  marginX: 48,
  marginBottom: 28,
  /** space kept at the top: the board's bar floats over the screen's top edge */
  marginTop: 72,
  /** inside a cell, before the number and above it */
  cellPad: 14,
  /** between the number and the problem, as a fraction of the hand size */
  numberGap: 0.55,
  /** problems per screen: two rows of three leave ~400 px under each to work in */
  perScreen: 6,
} as const;

export const FREE_AREA = {
  margin: 40,
  top: 72,
  /** space kept round what is already on the screen */
  clearance: 18,
  step: 24,
} as const;

/** How many problems go on each screen: at most `perScreen`, spread evenly (8 → 4 + 4, not 6 + 2). */
export function chunkProblems(n: number, perScreen: number = PROBLEM_GRID.perScreen): number[] {
  if (n <= 0) return [];
  const screens = Math.ceil(n / perScreen);
  const base = Math.floor(n / screens);
  const extra = n % screens;
  return Array.from({ length: screens }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Columns and rows for n problems on one screen: 1, 2, 3 side by side; 4 as 2×2; 5–6 as 3×2. */
export function gridShape(n: number, maxCols = 3): { cols: number; rows: number } {
  const want = n <= 3 ? Math.max(1, n) : n === 4 ? 2 : 3;
  const cols = Math.max(1, Math.min(maxCols, want));
  return { cols, rows: Math.ceil(n / cols) };
}

/** The cells of a cols × rows grid on the screen, in reading order (row by row). */
export function gridCells(screen: Rect, cols: number, rows: number, count: number = cols * rows): Rect[] {
  const x0 = screen.x + PROBLEM_GRID.marginX;
  const y0 = screen.y + PROBLEM_GRID.marginTop;
  const w = (screen.w - 2 * PROBLEM_GRID.marginX) / cols;
  const h = (screen.h - PROBLEM_GRID.marginTop - PROBLEM_GRID.marginBottom) / rows;
  const out: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push({ x: x0 + c * w, y: y0 + r * h, w, h });
  }
  return out;
}

export interface GridPlan {
  cols: number;
  rows: number;
  size: number;
  cells: Rect[];
}

/**
 * The grid for one screen's problems. `width(i, size)` is how wide problem i is written at that
 * hand size, number included. Three columns when they fit, else two, else one; a problem still
 * too wide for a one-column cell shrinks the hand (never below `minSize`). Null when even that
 * does not fit (the caller drops that problem).
 */
export function planGrid(screen: Rect, count: number, width: (i: number, size: number) => number): GridPlan | null {
  if (count <= 0) return null;
  const pad = PROBLEM_GRID.cellPad;
  const fits = (cols: number, size: number) => {
    const cellW = (screen.w - 2 * PROBLEM_GRID.marginX) / cols;
    for (let i = 0; i < count; i++) if (width(i, size) > cellW - 2 * pad) return false;
    return true;
  };
  const start = gridShape(count).cols;
  for (const size of sizesDown()) {
    for (let cols = start; cols >= 1; cols--) {
      if (!fits(cols, size)) continue;
      const rows = Math.ceil(count / cols);
      return { cols, rows, size, cells: gridCells(screen, cols, rows, count) };
    }
  }
  return null;
}

function sizesDown(): number[] {
  const out: number[] = [];
  for (let s = PROBLEM_GRID.size; s >= PROBLEM_GRID.minSize; s -= 4) out.push(s);
  if (out[out.length - 1] !== PROBLEM_GRID.minSize) out.push(PROBLEM_GRID.minSize);
  return out;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * The first place a block of `size` fits on the screen without touching anything there, in
 * reading order (top to bottom, left to right), inside the margins and under the board's bar.
 * Null when the screen has no such room.
 */
export function findFreeArea(size: { w: number; h: number }, screen: Rect, avoid: readonly Rect[], opts: Partial<typeof FREE_AREA> = {}): Rect | null {
  const { margin, top, clearance, step } = { ...FREE_AREA, ...opts };
  const maxX = screen.x + screen.w - margin - size.w;
  const maxY = screen.y + screen.h - margin - size.h;
  for (let y = screen.y + top; y <= maxY; y += step) {
    for (let x = screen.x + margin; x <= maxX; x += step) {
      const r = { x, y, w: size.w, h: size.h };
      const grown = { x: x - clearance, y: y - clearance, w: size.w + 2 * clearance, h: size.h + 2 * clearance };
      if (!avoid.some((a) => intersects(grown, a))) return r;
    }
  }
  return null;
}

/**
 * Several placed plans as ONE block, written one after the other (a problem's number, then the
 * problem; a graph's equation, then the graph). Each part keeps its place; the clock runs on.
 */
export function joinPlans(parts: readonly HandPlan[], gapMs = 200, paceOf: (naturalMs: number) => number = paceFor): HandPlan | null {
  const live = parts.filter((p) => p.lines.length > 0);
  if (live.length === 0) return null;
  let t = 0;
  const lines: HandPlan["lines"] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of live) {
    for (const l of p.lines) lines.push({ ...l, startMs: t + l.startMs });
    t += p.totalMs + gapMs;
    minX = Math.min(minX, p.bounds.x);
    minY = Math.min(minY, p.bounds.y);
    maxX = Math.max(maxX, p.bounds.x + p.bounds.w);
    maxY = Math.max(maxY, p.bounds.y + p.bounds.h);
  }
  const totalMs = Math.max(0, t - gapMs);
  return { lines, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, size: live[0].size, totalMs, pace: paceOf(totalMs) };
}
