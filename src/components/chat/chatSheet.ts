/**
 * The chat panel's host on the board page: docked on the right on a wide screen held sideways, a
 * bottom sheet on a phone or an upright iPad (docked there it would leave the 16:9 board a postcard).
 * In the board's first load: classes only.
 */

/**
 * The board above a sheet pulled up tall keeps at least this much height: its bar at the top and
 * tldraw's toolbars at the foot (about 280 px on a phone) with some board between. At 88% of a
 * 390×844 phone the board was 100 px, and tldraw's toolbar and the page counter were pushed up into
 * the bar, over Suggest and Solve (QA, 2026-10-12). Never shorter than the sheet's resting height.
 */
export const CHAT_SHEET_MIN_BOARD_PX = 320;

/** The sheet's height: resting (46%), or pulled up tall (88%, but the board keeps `CHAT_SHEET_MIN_BOARD_PX`). */
export const CHAT_SHEET_HEIGHT = {
  rest: "h-[46dvh]",
  tall: "h-[max(46dvh,min(88dvh,calc(100dvh_-_320px)))]",
} as const;

/** The host's classes: hidden while the panel is closed. */
export function chatHostClass(open: boolean, tall: boolean): string {
  if (!open) return "hidden";
  return `relative z-[1100] ${tall ? CHAT_SHEET_HEIGHT.tall : CHAT_SHEET_HEIGHT.rest} shrink-0 overflow-hidden transition-[height] duration-200 motion-reduce:transition-none border-t border-gray-200 bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.06)] md:landscape:h-auto md:landscape:w-[360px] md:landscape:border-l md:landscape:border-t-0 md:landscape:shadow-none`;
}
