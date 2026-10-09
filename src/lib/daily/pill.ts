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
  /** a control in the top-right corner beside the bar (the simple board's More), when there is one */
  corner?: { left: number; bottom: number } | null;
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

export function pillSpot(area: PillArea, size: { width: number; height: number } = PILL): PillSpot {
  const { bar, corner } = area;
  // the right edge the pill keeps clear in the bar's row: the swatch's corner, or More and a gap
  const reserve = Math.max(PILL.swatch, corner ? Math.round(area.width - corner.left + PILL.gap) : 0);
  // under the bar, and under the corner's control too
  const below = Math.max(bar?.bottom ?? 0, corner?.bottom ?? 0);
  if (!bar) return { top: below ? Math.round(below + PILL.gap - 4) : PILL.top, right: PILL.gap, inline: false };
  const rowHeight = bar.bottom - bar.top;
  const room = area.width - reserve - bar.right;
  if (rowHeight <= PILL.oneRow && room >= size.width + PILL.gap * 2) {
    return { top: Math.round(bar.top + Math.max(0, (rowHeight - size.height) / 2)), right: reserve, inline: true };
  }
  return { top: Math.round(below + PILL.gap - 4), right: PILL.gap, inline: false };
}
