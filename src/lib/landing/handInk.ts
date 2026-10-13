/**
 * Maths in the board's own hand, for the landing page (v3, 2026-10-12): LaTeX in, SVG paths and a
 * writing schedule out. The strokes come from the hand engine (src/lib/hand), the same one that
 * writes the tutor's steps and a laptop kid's typed lines on the board, so the page's handwriting
 * is the product's. The page is static, so this runs once on the server per render; a line the
 * hand cannot write throws (a build-time failure, never a half-written line on the page).
 *
 * Pure: no React, no DOM, no network. Unit-tested in `__tests__/handInk.test.ts`.
 */
import { layoutMath, polylineToSvgD, STROKE_GAP_MS, strokeDurationMs } from "@/lib/hand";

/** One stroke: its path, its pen weight (1 = the usual pen), and when it is drawn. */
export interface HandStroke {
  d: string;
  weight: number;
  /** ms after the line starts */
  atMs: number;
  /** ms the stroke takes */
  forMs: number;
}

export interface HandInk {
  strokes: HandStroke[];
  /** the box every stroke lies in, in px at `size` */
  width: number;
  height: number;
  /** from the top of the box down to the writing line */
  baseline: number;
  /** when the last stroke is done, in ms after the line starts */
  durationMs: number;
}

export interface HandInkOptions {
  /** the hand's cap height in px (the hand engine's `size`); default 40 */
  size?: number;
  /** glyph alternates and tremor; the same seed writes the same strokes */
  seed?: number;
  /** >1 writes faster, <1 slower; default 1 (a quick child's pace) */
  speed?: number;
}

const round = (n: number) => Math.round(n * 10) / 10;

export function handInk(latex: string, { size = 40, seed = 1, speed = 1 }: HandInkOptions = {}): HandInk {
  const layout = layoutMath(latex, { size, seed });
  if (layout.unsupported.length > 0) {
    throw new Error(`handInk: the hand cannot write ${JSON.stringify(latex)} (${layout.unsupported.join(", ")})`);
  }
  let t = 0;
  const strokes: HandStroke[] = layout.strokes.map((stroke) => {
    const forMs = Math.round(strokeDurationMs(stroke) / speed);
    const out: HandStroke = {
      d: polylineToSvgD(stroke.points.map((p) => ({ x: round(p.x), y: round(p.y) }))),
      weight: stroke.weight ?? 1,
      atMs: t,
      forMs,
    };
    t += forMs + Math.round(STROKE_GAP_MS / speed);
    return out;
  });
  const last = strokes.at(-1);
  return {
    strokes,
    width: layout.width,
    height: layout.height,
    baseline: layout.baseline,
    durationMs: last ? last.atMs + last.forMs : 0,
  };
}
