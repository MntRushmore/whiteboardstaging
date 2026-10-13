/**
 * The try board's ink, as SVG: the visitor's strokes in the kid's pen, the tutor's marks (its real
 * mark strokes, `markStrokes` from src/lib/live/marks.ts: the check mark, the circle and the
 * question mark the live board draws), and the tutor's step from "Show me a step" (the server's
 * hand engine, `TryInk`) sized to the page's lines.
 *
 * Pure geometry, in the page's first load: it imports only the marks' own geometry and the hand's
 * path writer (src/lib/hand/path.ts, no imports of its own), never the hand engine's layout or
 * glyphs; the problem itself is server-rendered `HandMath`. Unit-tested in `__tests__/tryInk.test.ts`.
 */
import type { TryInk } from "@/lib/try/contracts";
import type { Rect } from "@/lib/live/contracts";
import { markStrokes, type MarkKind } from "@/lib/live/marks";
import { polylineToSvgD } from "@/lib/hand/path";

/** One stroke of the visitor's ink, in CSS px relative to its line's top-left: x and y side by side, as the read takes them. */
export interface InkStroke {
  x: number[];
  y: number[];
}

const round = (n: number) => Math.round(n * 10) / 10;

/** A stroke's SVG path. A tap (one point) is a dot: a hair of a line, which the round cap turns into one. */
export function inkD(stroke: InkStroke): string {
  const points = stroke.x.map((x, i) => ({ x: round(x), y: round(stroke.y[i]) }));
  if (points.length === 1) points.push({ x: points[0].x + 0.1, y: points[0].y });
  return polylineToSvgD(points);
}

/** The box the strokes lie in, or null for no ink. */
export function inkBox(strokes: readonly InkStroke[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (let i = 0; i < s.x.length; i++) {
      minX = Math.min(minX, s.x[i]);
      maxX = Math.max(maxX, s.x[i]);
      minY = Math.min(minY, s.y[i]);
      maxY = Math.max(maxY, s.y[i]);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * The tutor's mark for a line whose ink lies in `box`, as SVG paths in the line's coordinates: the
 * live board's own strokes (`markStrokes`). A mark that would run past the line's width (a check
 * mark after ink that reaches the edge, a circle round a long line) is moved or narrowed to stay on
 * the page, so a phone never scrolls sideways.
 */
export function markPaths(kind: MarkKind, box: Rect, seed: number, lineWidth: number, pad = 4): string[] {
  // a dot or a single stroke still gets a mark of a sensible size
  const line: Rect = { x: box.x, y: box.y, w: Math.max(box.w, 8), h: Math.max(box.h, 16) };
  const strokes = markStrokes(kind, line, seed);
  const xs = strokes.flatMap((s) => s.points.map((p) => p.x));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const lo = pad;
  const hi = Math.max(lo + 1, lineWidth - pad);
  let fit = (x: number) => x;
  if (kind === "circle" && (minX < lo || maxX > hi)) {
    // narrow the ring about its centre, keeping it round the words
    const cx = line.x + line.w / 2;
    const k = Math.min(1, (cx - lo) / Math.max(1, cx - minX), (hi - cx) / Math.max(1, maxX - cx));
    fit = (x) => cx + (x - cx) * Math.max(0.6, k);
  } else if (maxX > hi) {
    const dx = hi - maxX;
    fit = (x) => x + dx;
  }
  return strokes.map((s) => polylineToSvgD(s.points.map((p) => ({ x: round(fit(p.x)), y: round(p.y) }))));
}

/** The tutor's hand size on this page: the problem's `HandMath` (page.tsx), and so the step's too. */
export const TRY_HAND_SIZE = 60;

/**
 * The hand size the server writes the tutor's step at (`/api/try/help`: `handInk` at its default,
 * 40). `TryInk` does not carry it, so it is pinned here; the step is scaled to the problem's size on
 * this page so the two lines of the tutor's hand match.
 */
export const HELP_INK_SIZE = 40;

/**
 * How much to scale the tutor's step: from the server's hand size to the page's (`handSize`), but
 * never so big it leaves its line (`lineHeight`, `lineWidth`: the space it may take).
 */
export function helpScale(ink: Pick<TryInk, "width" | "height">, handSize: number, lineHeight: number, lineWidth: number): number {
  const scale = handSize / HELP_INK_SIZE;
  const fitH = ink.height > 0 ? (lineHeight * 0.92) / ink.height : scale;
  const fitW = ink.width > 0 ? lineWidth / ink.width : scale;
  return Math.max(0.2, Math.min(scale, fitH, fitW));
}
