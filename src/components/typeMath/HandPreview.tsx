"use client";

import { polylineToSvgD, type MathLayout } from "@/lib/hand";

/** The hand's size in the preview (layoutMath's `size`, px of cap height plus descender room). */
export const PREVIEW_HAND_SIZE = 24;
/** One seed for every preview, so the line does not change its letters as the kid types on. */
export const PREVIEW_SEED = 11;

/**
 * The line as Enter will write it: the strokes of the board's hand (`layoutMath`), drawn as an SVG
 * in the kid's ink colour, so `1/2` is a real fraction while they type. It shrinks to fit its slot
 * (a tall fraction, a long line), never grows past the hand's own size. `muted`: what the parser
 * could make of a line it cannot read yet, greyed.
 */
export function HandPreview({ layout, color, muted }: { layout: MathLayout | null; color: string; muted?: boolean }) {
  if (!layout || layout.strokes.length === 0) return null;
  const pad = 3;
  const w = layout.width + pad * 2;
  const h = layout.height + pad * 2;
  return (
    <svg
      data-type-preview=""
      data-muted={muted ? "" : undefined}
      viewBox={`${-pad} ${-pad} ${w} ${h}`}
      width={w}
      height={h}
      preserveAspectRatio="xMinYMid meet"
      aria-hidden
      className="block max-h-full max-w-full shrink"
      style={{ opacity: muted ? 0.4 : 1 }}
    >
      <g fill="none" stroke={muted ? "#64748b" : color} strokeLinecap="round" strokeLinejoin="round">
        {layout.strokes.map((s) => (
          <path key={s.order} d={polylineToSvgD(s.points)} strokeWidth={2.1 * (s.weight ?? 1)} />
        ))}
      </g>
    </svg>
  );
}
