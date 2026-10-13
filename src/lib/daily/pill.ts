/**
 * Where the day's progress pill sits on the board (`DailyBoard`): somewhere it never covers the
 * board's controls and covers as little of the writing as it can. Pure math over measured boxes,
 * unit-tested in `__tests__/pill.test.ts`.
 *
 *   one-row bar with room after it (a laptop)   in the bar's row, left of the pen's swatch
 *   otherwise (a phone, an upright iPad)        just under the bar, at the right edge
 *
 * The simple board has no swatch there but its More button, wider (about 92 px): measured
 * (`corner`), the pill keeps left of it in the bar's row, and drops under it otherwise — never
 * under it in the same row, where it read "1 c" (QA, 2026-10-09).
 *
 * The pill also lets every touch through (`pointer-events: none`), so even where it sits over the
 * canvas a stroke under it still draws.
 */

/** Boxes in px, relative to the board's container. */
export interface PillArea {
  width: number;
  /** the board's top bar (`data-board-bar`), or null when it is not there */
  bar: { top: number; right: number; bottom: number } | null;
  /**
   * a control in the top-right corner beside the bar (the simple board's More), when there is one;
   * with its `right` edge, a pill under it lines up with it
   */
  corner?: { left: number; bottom: number; right?: number } | null;
}

export interface PillSpot {
  top: number;
  right: number;
  /** in the bar's row (true) or under it */
  inline: boolean;
}

export const PILL = {
  /** the pill's size, about: five stars and "3 of 5" */
  width: 168,
  height: 36,
  /** the top-right corner the pen's swatch keeps (the bar leaves 72 px for it) */
  swatch: 72,
  /** space between the pill and anything else */
  gap: 12,
  /** a bar taller than this has wrapped onto more rows */
  oneRow: 64,
  /** the board bar's own top inset, when there is no bar to measure */
  top: 16,
} as const;

/** The simple board's pill: as tall as its bar's buttons (48 px), "Today" before the stars. */
export const BIG_PILL = { width: 234, height: 48 } as const;

/**
 * ...and where that would not fit the bar's row (a phone): one star and "0/5", so the bar stays one
 * row instead of the pill dropping under it (QA, 2026-10-12).
 */
export const COMPACT_PILL = { width: 64, height: 48 } as const;

export function pillSpot(area: PillArea, size: { width: number; height: number } = PILL): PillSpot {
  const { bar, corner } = area;
  // the right edge the pill keeps clear in the bar's row: the swatch's corner, or More and a gap
  const reserve = Math.max(PILL.swatch, corner ? Math.round(area.width - corner.left + PILL.gap) : 0);
  // under the bar, and under the corner's control too
  const below = Math.max(bar?.bottom ?? 0, corner?.bottom ?? 0);
  // under the bar, its right edge on the corner control's (More's), else a gap in from the board's
  const right = corner?.right !== undefined ? Math.round(area.width - corner.right) : PILL.gap;
  if (!bar) return { top: below ? Math.round(below + PILL.gap - 4) : PILL.top, right, inline: false };
  const rowHeight = bar.bottom - bar.top;
  // the gap on the right is in `reserve` already: the room needs the pill and the gap on its left
  const room = area.width - reserve - bar.right;
  if (rowHeight <= PILL.oneRow && room >= size.width + PILL.gap) {
    return { top: Math.round(bar.top + Math.max(0, (rowHeight - size.height) / 2)), right: reserve, inline: true };
  }
  return { top: Math.round(below + PILL.gap - 4), right, inline: false };
}
