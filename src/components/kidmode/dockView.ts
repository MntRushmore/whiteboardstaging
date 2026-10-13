/**
 * Pure view logic for the simple board's dock (`KidDock`), the one dock of tools every student gets
 * in place of tldraw's palette: Select, Pen, Eraser, Shapes, Picture and Type, Undo and Redo, a few
 * big colours, the board's pages, and a big Ask (the tutor to talk to: a kid's button, not a grown-up
 * setting behind More). Decided here, like the bar (`boardToolbarView`), so what a 6-year-old sees is
 * pinned by tests rather than read off the JSX.
 *
 * How much fits one row is decided here too (`dockFit`), from the board's width and what the dock
 * holds: everything on a laptop; the less-used tools (Shapes, Picture, Redo) behind one More button
 * where they do not fit, then the colours behind one Color button; and on a phone two rows in one
 * dock. It never wraps on its own.
 *
 * Also "little hands": the slightly thicker pen and wider eraser of the simple board, and the rules
 * that keep them from leaking into the classic board.
 */

/**
 * The dock's words, for a 6-year-old: one short word under each picture, read at a glance or not at
 * all. Pages are the board's screens (src/lib/screens), named as a kid names them.
 */
export const DOCK_COPY = {
  dock: "Tools",
  select: "Select",
  selectHint: "Tap or circle your work to move it, resize it or delete it",
  pen: "Pen",
  eraser: "Eraser",
  shapes: "Shapes",
  shapesHint: "Lines, arrows, boxes and circles",
  shapeName: {
    line: "Line",
    arrow: "Arrow",
    rectangle: "Rectangle",
    ellipse: "Circle",
  },
  picture: "Picture",
  pictureHint: "Add a photo or a page of a PDF",
  undo: "Undo",
  redo: "Redo",
  /** the less-used tools, folded (Shapes, Picture, Redo) */
  more: "More",
  moreHint: "More tools: shapes, a picture, redo",
  /**
   * Type it's button, off the board since 2026-10-13. Kept only for the landing page's v3 dock
   * pictures (Devices, AskDemo) until landing v4, which drops them, is on main; then delete.
   */
  type: "Type",
  typeHint: "Type your math",
  colour: "Color",
  colours: "Colors",
  colourName: {
    black: "Black",
    red: "Red",
    green: "Green",
    violet: "Purple",
  },
  pages: "Pages",
  newPage: "New page",
  full: "This board is full",
  prev: "Page before",
  next: "Next page",
  pageOf: (index: number, count: number) => `Page ${index} of ${count}`,
  /** the tutor to talk to (the board chat): CHAT_BUTTON_COPY.button, pinned equal in the tests */
  ask: "Ask",
  askHint: "Ask your tutor anything",
} as const;

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
 * The shapes behind Shapes, for a graph or a geometry sketch: tldraw's line and arrow tools, and its
 * geo tool as a rectangle or an ellipse. Drawn in the kid's colour, like the pen.
 */
export const KID_SHAPES = ["line", "arrow", "rectangle", "ellipse"] as const;
export type KidShape = (typeof KID_SHAPES)[number];

/** tldraw's tool for a shape, and the geo style it draws with (`GeoShapeGeoStyle`) when it is the geo tool. */
export function shapeTool(shape: KidShape): { tool: "line" | "arrow" | "geo"; geo?: "rectangle" | "ellipse" } {
  return shape === "rectangle" || shape === "ellipse" ? { tool: "geo", geo: shape } : { tool: shape };
}

/**
 * The shape in hand, from tldraw's tool and the geo style of the next shape: null for another tool,
 * and for a geo shape the dock does not offer (a triangle picked on the classic board).
 */
export function shapeInHand(tool: string, geo: string): KidShape | null {
  if (tool === "line" || tool === "arrow") return tool;
  if (tool === "geo" && (geo === "rectangle" || geo === "ellipse")) return geo;
  return null;
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
  /** the size it replaces: tldraw's default, and the classic board's */
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

/**
 * The dock's sizes in px, as `KidDock` draws them (its classes say the same numbers): what decides
 * how much of it fits one row. A tool is a 48 px wide, 52 px tall target with its picture and word
 * (measured: the dock is 947 px wide on a laptop with Type and three pages, as `dockRowWidth` says).
 */
export const DOCK_SIZE = {
  /** a tool's button: its least width */
  button: 48,
  /** on a phone's two rows */
  compact: 46,
  /** between the buttons of one group */
  gap: 2,
  /** a group's divider and the room either side of it */
  divider: 13,
  /** a colour's target */
  swatch: 44,
  /** ‹ and › */
  arrow: 44,
  /** the "2 / 3" between them */
  pageLabel: 40,
  /** New page: the widest word in the dock */
  newPage: 70,
  /** Ask, the dock's big blue button */
  ask: 104,
  /** between the pages and Ask */
  askGap: 8,
  /** the dock's own padding and border, both sides */
  chrome: 14,
  /** what the dock leaves clear either side of it on the board */
  margin: 8,
} as const;

/**
 * How the dock is laid out on a board this wide:
 *  - `row`: everything in one row (a laptop, an iPad on its side);
 *  - `fold`: one row, with Shapes, Picture and Redo behind More (an upright iPad, a board beside the
 *    Ask panel), and, where even that is too wide, the colours behind one Color button;
 *  - `stack`: a phone. Two rows in one dock: the pages and Ask over the tools, the less-used tools
 *    behind More and the colours behind Color. Never a row that wraps on its own.
 */
export type DockFit = "row" | "fold" | "stack";

/** What the dock holds, for its width. */
export interface DockContents {
  /** a Type button (Type it, taken off the board on 2026-10-13: KidDock passes false; kept so the layout can still fit one) */
  type: boolean;
  /** the pages' ‹ n / N › (there is more than one page) */
  arrows: boolean;
}

/** The width of a group of `n` buttons `size` px wide. */
function group(n: number, size: number = DOCK_SIZE.button): number {
  return n > 0 ? n * size + (n - 1) * DOCK_SIZE.gap : 0;
}

/**
 * The dock's width in one row: the tools | Undo and Redo (or More) | the colours (or Color) | the
 * pages | Ask. `fold`: Shapes, Picture and Redo behind More; `colourButton`: the colours behind Color.
 */
export function dockRowWidth(c: DockContents, opts: { fold: boolean; colourButton: boolean }): number {
  const tools = group(3 + (c.type ? 1 : 0) + (opts.fold ? 0 : 2));
  const edits = group(2);
  const colours = opts.colourButton ? DOCK_SIZE.button : KID_COLORS.length * DOCK_SIZE.swatch + (KID_COLORS.length - 1) * DOCK_SIZE.gap;
  const pages = (c.arrows ? 2 * DOCK_SIZE.arrow + DOCK_SIZE.pageLabel + 3 * DOCK_SIZE.gap : 0) + DOCK_SIZE.newPage;
  return DOCK_SIZE.chrome + tools + DOCK_SIZE.divider + edits + DOCK_SIZE.divider + colours + DOCK_SIZE.divider + pages + DOCK_SIZE.askGap + DOCK_SIZE.ask;
}

/**
 * A phone's dock, its widest row: the tools (Select, Pen, Eraser, Type), Color | Undo and More.
 * (The other row, the pages and Ask, is narrower: Ask takes what is left.) `typeInMore`: Type
 * behind More too, on a phone narrower than most (`dockFit`).
 */
export function dockStackWidth(c: DockContents, typeInMore = false): number {
  return DOCK_SIZE.chrome + group(4 + (c.type && !typeInMore ? 1 : 0), DOCK_SIZE.compact) + DOCK_SIZE.divider + group(2, DOCK_SIZE.compact);
}

/**
 * The most of the dock that fits a board `width` px wide (`DockFit`), whether its colours fold, and
 * whether Type goes behind More as well (a phone under about 375 px, where even the two rows' tools
 * would not fit with it).
 */
export function dockFit(width: number, c: DockContents): { fit: DockFit; colourButton: boolean; typeInMore: boolean } {
  const room = width - 2 * DOCK_SIZE.margin;
  if (dockRowWidth(c, { fold: false, colourButton: false }) <= room) return { fit: "row", colourButton: false, typeInMore: false };
  if (dockRowWidth(c, { fold: true, colourButton: false }) <= room) return { fit: "fold", colourButton: false, typeInMore: false };
  if (dockRowWidth(c, { fold: true, colourButton: true }) <= room) return { fit: "fold", colourButton: true, typeInMore: false };
  return { fit: "stack", colourButton: true, typeInMore: c.type && dockStackWidth(c) > room };
}

export interface KidDockState {
  /** the board's width in px (tldraw's viewport: beside a docked Ask panel, what is left of it) */
  width: number;
  /** tldraw's current tool id */
  tool: string;
  /** the geo style of the next shape (`GeoShapeGeoStyle`): which of Rectangle and Circle is in hand */
  geo: string;
  /** the colour of the next stroke */
  color: string;
  canUndo: boolean;
  canRedo: boolean;
  /** a Type button is offered (never since 2026-10-13: everything on the board is written) */
  type: boolean;
  /** the Ask panel is open (a phone's bottom sheet, or docked beside the board) */
  chatOpen?: boolean;
  /** the screen shown, from 1 (`screenPosition`) */
  page: number;
  pages: number;
  maxPages: number;
}

export interface KidDockView {
  /** which tool shows as the one in hand; none for a tool only the classic board offers */
  select: boolean;
  pen: boolean;
  eraser: boolean;
  /** Shapes: pressed while one of its shapes is in hand, and which one (`shapeInHand`) */
  shapes: { pressed: boolean; current: KidShape | null };
  undo: boolean;
  redo: boolean;
  /** a Type button (never since 2026-10-13) */
  type: boolean;
  /** ...behind More, on a phone too narrow for it in the tools' row (`dockFit`) */
  typeInMore: boolean;
  /** how much fits one row (`dockFit`) */
  fit: DockFit;
  /** Shapes, Picture and Redo are behind More (`fold` and `stack`) */
  folded: boolean;
  /**
   * The colours: a row of big swatches, or (where the row and the tools do not fit at 44 px a
   * target) one Color button that opens them. `current` is null for a colour picked on the classic
   * board that the dock does not offer.
   */
  colours: { layout: "row" | "button"; current: KidColor | null };
  /**
   * The pages: "‹ 2 / 3 ›" only once there is more than one (a kid must be able to get back to the
   * page before), and New page always, greyed out when the board is full.
   */
  pages: { arrows: boolean; label: string | null; canPrev: boolean; canNext: boolean; canAdd: boolean };
  /** a phone: two rows in one dock, the pages and Ask over the tools (`fit` is `stack`) */
  stack: boolean;
  /**
   * A phone's top row (the pages and Ask) is shown. Not while the Ask panel is open: the sheet is
   * Ask, with its own close, and the dock's second row over the board left it a strip (the screen's
   * foot under the dock, QA 2026-10-12). The tools stay.
   */
  askRow: boolean;
}

export function kidDockView(state: KidDockState): KidDockView {
  const several = state.pages > 1;
  const { fit, colourButton, typeInMore } = dockFit(state.width, { type: state.type, arrows: several });
  const shape = shapeInHand(state.tool, state.geo);
  return {
    select: state.tool === "select",
    pen: state.tool === "draw",
    eraser: state.tool === "eraser",
    shapes: { pressed: shape !== null || state.tool === "geo", current: shape },
    undo: state.canUndo,
    redo: state.canRedo,
    type: state.type,
    typeInMore,
    fit,
    folded: fit !== "row",
    colours: { layout: colourButton ? "button" : "row", current: isKidColor(state.color) ? state.color : null },
    pages: {
      arrows: several,
      label: several ? `${state.page} / ${state.pages}` : null,
      canPrev: several && state.page > 1,
      canNext: several && state.page < state.pages,
      canAdd: state.pages < state.maxPages,
    },
    stack: fit === "stack",
    askRow: fit === "stack" && !state.chatOpen,
  };
}
