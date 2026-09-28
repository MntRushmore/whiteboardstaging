import type { MathSize, Rect } from "./contracts";

/**
 * Placement geometry (spec §6.6) in tldraw page coordinates. Pure: takes bounds
 * arrays so it is testable without an editor.
 */

export const ECHO_HEIGHTS: Record<MathSize, number> = { s: 34, m: 44, l: 56 };

export const PLACEMENT = {
  echoGapX: 24,
  belowGapY: 12,
  viewportMargin: 16,
  slotStepX: 40,
  slotTries: 6,
  rowTries: 4,
  rowGap: 8,
  graphGap: 16,
  stepGap: 16,
  stepPitch: 52,
  /** measured KaTeX at 24 px runs ~13 px per visible character (s: 18 px, l: 32 px font) */
  charWidth: 13,
  echoPadding: 40,
  /**
   * The space the tutor leaves between the student's own `=` and the answer it writes after
   * it, as a fraction of the height of their writing: the gap a person leaves when they
   * finish someone else's line, not the 24 px a separate card is set off by.
   */
  answerGapFactor: 0.4,
  answerGapMin: 10,
  /** a block moved beside the work (it would run off the bottom of the screen) sits this far right of it */
  sideGap: 48,
} as const;

/** px per visible character by echo size (KaTeX 18 / 24 / 32 px). */
export const CHAR_WIDTH: Record<MathSize, number> = { s: 10, m: PLACEMENT.charWidth, l: 17 };

/** A graph / step anchored to an echo is re-placed when the echo's measured width moves by more than this. */
export const ECHO_WIDTH_RELAYOUT_PX = 8;

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rectMaxX(r: Rect): number {
  return r.x + r.w;
}
export function rectMaxY(r: Rect): number {
  return r.y + r.h;
}

/**
 * Rough KaTeX width before the shape's ResizeObserver corrects it. Deliberately
 * generous (measured `y=x^{2}-4` at size m is ~129 px) so a graph placed in the same
 * write batch as its echo does not overlap it. Each command counts as one glyph; a
 * script marker (`^`/`_`) also counts as one, because the raised/lowered glyph plus its
 * kerning takes about a full character of width.
 */
export function estimateEchoWidth(latex: string, size: MathSize = "m"): number {
  const visible = latex.replace(/\\[a-zA-Z]+/g, "x").replace(/[{}\s]/g, "");
  return Math.max(48, Math.round(CHAR_WIDTH[size] * visible.length + PLACEMENT.echoPadding));
}

/** Gap between the student's last glyph and the answer the tutor writes on the same line. */
export function inlineAnswerGap(inkHeight: number): number {
  return Math.max(PLACEMENT.answerGapMin, Math.round(inkHeight * PLACEMENT.answerGapFactor));
}

/** Echo size from the ink height: small ink -> s, tall ink -> l. */
export function echoSizeFor(lineHeight: number): MathSize {
  if (lineHeight < 28) return "s";
  if (lineHeight > 70) return "l";
  return "m";
}

/**
 * Echo: 24 px right of the ink, vertically centred; when that would overflow the
 * viewport's right edge, below the ink instead.
 */
export function placeEcho(line: Rect, latex: string, size: MathSize, viewport: Rect): Rect {
  const h = ECHO_HEIGHTS[size];
  const w = estimateEchoWidth(latex, size);
  const right: Rect = { x: rectMaxX(line) + PLACEMENT.echoGapX, y: line.y + line.h / 2 - h / 2, w, h };
  if (right.x + w > rectMaxX(viewport) - PLACEMENT.viewportMargin) {
    return { x: line.x, y: rectMaxY(line) + PLACEMENT.belowGapY, w, h };
  }
  return right;
}

/**
 * Scans for a slot that does not intersect `avoid`.
 *
 * `right` (echoes, notes): the candidate shifted right by i*40 for i = 0..5, then below.
 * `below` (a worked solution under the work): straight under the line first.
 * Below means just under whatever is in the way — never jumps of the block's own height, which
 * sent an 8-line solution to the bottom of the screen when a ring sat under the last line.
 */
export function findFreeSlot(candidate: Rect, avoid: Rect[], line: Rect, prefer: "right" | "below" = "right"): Rect {
  const free = (r: Rect) => !avoid.some((a) => rectsIntersect(r, a));
  const below = (): Rect | null => {
    let r: Rect = { ...candidate, x: prefer === "below" ? candidate.x : line.x, y: Math.max(candidate.y, rectMaxY(line) + PLACEMENT.belowGapY) };
    if (prefer === "right") r = { ...r, y: rectMaxY(line) + PLACEMENT.belowGapY + candidate.h + PLACEMENT.rowGap };
    // no further below the line than the old row search reached (4 rows of the block)
    const limit = rectMaxY(line) + PLACEMENT.belowGapY + PLACEMENT.rowTries * (candidate.h + PLACEMENT.rowGap);
    for (let k = 0; k < 12 && r.y <= limit; k++) {
      const hits = avoid.filter((a) => rectsIntersect(r, a));
      if (hits.length === 0) return r;
      r = { ...r, y: Math.max(...hits.map(rectMaxY)) + PLACEMENT.rowGap };
    }
    return null;
  };
  if (prefer === "below") {
    if (free(candidate)) return candidate;
    return below() ?? candidate;
  }
  for (let i = 0; i < PLACEMENT.slotTries; i++) {
    const r = { ...candidate, x: candidate.x + i * PLACEMENT.slotStepX };
    if (free(r)) return r;
  }
  return below() ?? candidate;
}

/** Graph: right of the echo at the line's top; overflow -> below both. */
export function placeGraph(line: Rect, echo: Rect | null, size: { w: number; h: number }, viewport: Rect): Rect {
  const anchorRight = echo ? rectMaxX(echo) : rectMaxX(line);
  const right: Rect = { x: anchorRight + PLACEMENT.graphGap, y: line.y, w: size.w, h: size.h };
  if (right.x + size.w > rectMaxX(viewport) - PLACEMENT.viewportMargin) {
    const below = Math.max(rectMaxY(line), echo ? rectMaxY(echo) : -Infinity);
    return { x: line.x, y: below + PLACEMENT.graphGap, w: size.w, h: size.h };
  }
  return right;
}

/** Solution step i (1-based): column x, stacked below the last line at a 52 px pitch. */
export function placeStep(column: Rect, lastLine: Rect, index: number, latex: string, size: MathSize = "m"): Rect {
  return {
    x: column.x,
    y: rectMaxY(lastLine) + PLACEMENT.stepGap + (index - 1) * PLACEMENT.stepPitch,
    w: estimateEchoWidth(latex, size),
    h: ECHO_HEIGHTS[size],
  };
}

/**
 * A screen has a bottom edge. A block that would run past it moves beside the work instead:
 * right of `column`, level with its top (plus `offsetY`, for the n-th step of a list). Left
 * where it was when it fits, when there is no screen, or when beside does not fit either —
 * on a full screen, below is still better than nowhere.
 */
export function keepOnScreen(rect: Rect, screen: Rect | null, column: Rect, offsetY = 0): Rect {
  if (!screen) return rect;
  const bottom = rectMaxY(screen) - PLACEMENT.viewportMargin;
  if (rectMaxY(rect) <= bottom) return rect;
  const beside: Rect = { ...rect, x: rectMaxX(column) + PLACEMENT.sideGap, y: column.y + offsetY };
  if (rectMaxX(beside) <= rectMaxX(screen) - PLACEMENT.viewportMargin && rectMaxY(beside) <= bottom) return beside;
  return rect;
}

/** Slides `rect` left so it does not run past the right edge of `bounds` (never past its left edge). */
export function keepInsideX(rect: Rect, bounds: Rect): Rect {
  const maxX = rectMaxX(bounds) - PLACEMENT.viewportMargin;
  if (rectMaxX(rect) <= maxX) return rect;
  return { ...rect, x: Math.max(bounds.x + PLACEMENT.viewportMargin, maxX - rect.w) };
}

/** Somewhere sensible for a shape the tutor places without a line: below the anchor or viewport centre. */
export function placeFloating(anchor: Rect | null, size: { w: number; h: number }, viewport: Rect): Rect {
  if (anchor) {
    return { x: anchor.x, y: rectMaxY(anchor) + PLACEMENT.stepGap, w: size.w, h: size.h };
  }
  return {
    x: viewport.x + viewport.w / 2 - size.w / 2,
    y: viewport.y + viewport.h / 2 - size.h / 2,
    w: size.w,
    h: size.h,
  };
}

/** Normalizes a rect into [x0, y0, x1, y1] relative to `region` (0..1). */
export function normalizeBBox(r: Rect, region: Rect): [number, number, number, number] {
  const w = Math.max(1, region.w);
  const h = Math.max(1, region.h);
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  return [
    clamp01((r.x - region.x) / w),
    clamp01((r.y - region.y) / h),
    clamp01((rectMaxX(r) - region.x) / w),
    clamp01((rectMaxY(r) - region.y) / h),
  ];
}

export function expandRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}
