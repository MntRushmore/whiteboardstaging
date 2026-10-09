/**
 * Pure view logic for the simple board's dock (`KidDock`), the one row of tools a young kid gets in
 * place of tldraw's palette: Pen, Eraser, Undo, a few big colours, and the board's pages. Decided
 * here, like the bar (`boardToolbarView`), so what a 6-year-old sees is pinned by tests rather than
 * read off the JSX.
 *
 * Also "little hands": the slightly thicker pen and wider eraser of the simple board, and the rules
 * that keep them from leaking into the grown-up board.
 */

/**
 * The dock's colours: a few, big. Never blue: the tutor writes, ticks and rings in blue
 * (`TUTOR_INK_COLOR`), and a kid's blue line would read as the tutor's.
 */
export const KID_COLORS = ["black", "red", "green", "violet"] as const;
export type KidColor = (typeof KID_COLORS)[number];

export function isKidColor(color: string): color is KidColor {
  return (KID_COLORS as readonly string[]).includes(color);
}

/**
 * Little hands. A small finger, or a stylus held in a fist, draws a thin wobbly line and misses
 * what it means to rub out, so on the simple board:
 *
 *  - the pen is tldraw's `l` (5 px) instead of `m` (3.5 px). Safe for reading: Mathpix gets the
 *    stroke POINTS, never their width (/api/live/recognize), and the vision crop's own drawing
 *    (`drawInk`) has a fixed width. What the width changes is tldraw's outline of a speck: a stroke
 *    smaller than 2 × (width + 1) both ways is a dot of that radius (`DrawShapeUtil.getGeometry`),
 *    12 px instead of 9 px of page — the screen is 1600 px wide and a young kid's digits ~100 px tall,
 *    so that only ever touches the dots and specks it already treated as dots.
 *  - the eraser reaches 16 px (screen) either side of the finger instead of tldraw's 8
 *    (`hitTestMargin`, read by the eraser on every move), and only while the eraser is in hand: the
 *    select tool's hit test, which reads the same option, is left as it was.
 */
export const LITTLE_HANDS = {
  /** tldraw's `DefaultSizeStyle` for the kid's pen */
  pen: "l",
  /** the size it replaces: tldraw's default, and the grown-up board's */
  grownUpPen: "m",
  /** px on screen, either side of the eraser's path */
  eraserReach: 16,
} as const;

/**
 * The pen size to set as the simple board opens, or null to leave it: only tldraw's default is
 * thickened. A size someone picked on purpose (`s`, `xl`) is theirs.
 */
export function penSizeOnOpen(current: string): string | null {
  return current === LITTLE_HANDS.grownUpPen ? LITTLE_HANDS.pen : null;
}

/** The pen size to put back as the simple board closes: only the one it set, if it is still set. */
export function penSizeOnClose(current: string, thickened: boolean): string | null {
  return thickened && current === LITTLE_HANDS.pen ? LITTLE_HANDS.grownUpPen : null;
}

/** tldraw's `hitTestMargin` for the tool in hand: the eraser's wider reach, anything else as it was. */
export function hitMarginFor(tool: string, base: number): number {
  return tool === "eraser" ? Math.max(base, LITTLE_HANDS.eraserReach) : base;
}

export interface KidDockState {
  /** a phone-narrow board (`screenStripSlot` is "corner"): the colours fold into one button */
  narrow: boolean;
  /** tldraw's current tool id */
  tool: string;
  /** the colour of the next stroke */
  color: string;
  canUndo: boolean;
  /** the screen shown, from 1 (`screenPosition`) */
  page: number;
  pages: number;
  maxPages: number;
}

export interface KidDockView {
  /** which of Pen / Eraser shows as the one in hand; neither for a tool only a grown-up can pick */
  pen: boolean;
  eraser: boolean;
  undo: boolean;
  /**
   * The colours: a row of big swatches, or (on a phone, where the row and the tools do not fit
   * at 48 px a target) one Colour button that opens them. `current` is null for a colour picked on
   * the grown-up board that the dock does not offer.
   */
  colours: { layout: "row" | "button"; current: KidColor | null };
  /**
   * The pages: "‹ 2 / 3 ›" only once there is more than one (a kid must be able to get back to the
   * page before), and New page always, greyed out when the board is full.
   */
  pages: { arrows: boolean; label: string | null; canPrev: boolean; canNext: boolean; canAdd: boolean };
}

export function kidDockView(state: KidDockState): KidDockView {
  const several = state.pages > 1;
  return {
    pen: state.tool === "draw",
    eraser: state.tool === "eraser",
    undo: state.canUndo,
    colours: { layout: state.narrow ? "button" : "row", current: isKidColor(state.color) ? state.color : null },
    pages: {
      arrows: several,
      label: several ? `${state.page} / ${state.pages}` : null,
      canPrev: several && state.page > 1,
      canNext: several && state.page < state.pages,
      canAdd: state.pages < state.maxPages,
    },
  };
}
