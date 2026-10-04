/**
 * Where the Live hint and error cards go on the board: pure placement math, unit-tested at a
 * phone's and an iPad's size (`__tests__/hintPlacement.test.ts`).
 *
 * The cards float over the canvas (z 900) but under the board's top bar (z 1000), so a card
 * placed where the bar is cannot be read or tapped. On a phone-narrow board the bar wraps to
 * three rows (help tabs / Solve it + Ask / status pill + ink + bug), about 150 px of the screen,
 * which is where the old "park it at the top" fallback (72 px down) put an error card. So every
 * card is kept between the bar's bottom and the top of tldraw's bottom toolbar, measured by the
 * hint layer (`CardArea.top` / `bottom`), and a card that would run into the toolbar below its
 * line goes above the line instead.
 *
 * Type-only tldraw import: nothing here pulls the editor into a bundle.
 */
import type { Editor } from "tldraw";
import type { LiveLineState, Rect } from "@/lib/live/contracts";
import type { LiveError } from "@/lib/live/liveStore";
import { showsHintCard } from "./errorView";

/**
 * The board's top bar carries this attribute (src/app/board/[id]/page.tsx) so the hint layer can
 * measure where it ends; it wraps to more rows on a narrow board.
 */
export const BOARD_BAR_ATTR = "data-board-bar";
/** tldraw's bottom row (the tool palette, the screen strip): cards stay above it */
export const BOTTOM_UI_SELECTOR = ".tlui-layout__bottom";

export const CARD_MAX_W = 280;
export const CARD_MIN_W = 160;
/** a card's height is not known before it renders; this covers a two-line hint with its buttons */
export const CARD_EST_H = 112;
/** room kept between a card and the edges of the area it may use */
export const EDGE = 8;
/** between a line and its card */
export const ANCHOR_GAP = 8;
/** between two cards on the same line (a hint and the error of the More help that followed it) */
export const STACK_GAP = 8;

/** The tldraw container's size, and how much of its top and bottom the board's own UI covers. */
export interface CardArea {
  width: number;
  height: number;
  /** px from the container's top to the bottom of the board's top bar */
  top: number;
  /** px from the container's bottom to the top of tldraw's bottom toolbar */
  bottom: number;
}

export interface CardPlacement {
  left: number;
  top: number;
  width: number;
}

export function cardWidth(areaWidth: number): number {
  return Math.min(CARD_MAX_W, Math.max(CARD_MIN_W, areaWidth - EDGE * 2));
}

/**
 * A card of `width` x `height` for a line at `anchor` (container px; null when the card has no
 * line to sit by). `stack` is how many cards already sit on the same line: this one goes after
 * them, never on top of them.
 *
 *  - no anchor: top-centre of the free area, just under the bar (stacked downwards).
 *  - below the line when it fits above the bottom toolbar; else above the line when that clears
 *    the bar; else as close to below the line as the free area allows.
 *  - never under the bar: when the free area is shorter than the card, it starts under the bar
 *    and may overlap the toolbar (a card the student cannot see helps no one; the toolbar is
 *    still reachable around it).
 */
export function placeCard(anchor: Rect | null, area: CardArea, opts: { width: number; height?: number; stack?: number }): CardPlacement {
  const width = opts.width;
  const height = opts.height ?? CARD_EST_H;
  const stack = Math.max(0, opts.stack ?? 0);
  const step = stack * (height + STACK_GAP);
  const minTop = Math.max(0, area.top) + EDGE;
  const maxTop = Math.max(minTop, area.height - Math.max(0, area.bottom) - height - EDGE);
  const maxLeft = Math.max(EDGE, area.width - width - EDGE);
  const clampTop = (t: number) => Math.min(Math.max(t, minTop), maxTop);

  if (!anchor) {
    return { left: Math.min(Math.max((area.width - width) / 2, EDGE), maxLeft), top: clampTop(minTop + step), width };
  }
  const left = Math.min(Math.max(anchor.x, EDGE), maxLeft);
  const below = anchor.y + anchor.h + ANCHOR_GAP + step;
  if (below <= maxTop) return { left, top: Math.max(below, minTop), width };
  const above = anchor.y - ANCHOR_GAP - height - step;
  if (above >= minTop) return { left, top: Math.min(above, maxTop), width };
  return { left, top: clampTop(below), width };
}

/** Any part of `rect` (container px) is inside the container. */
export function onScreen(rect: Rect, area: Pick<CardArea, "width" | "height">): boolean {
  return rect.x + rect.w > 0 && rect.y + rect.h > 0 && rect.x < area.width && rect.y < area.height;
}

export type AnchorEditor = Pick<Editor, "getShapePageBounds" | "pageToScreen" | "getViewportScreenBounds">;

/**
 * The line's ink and its readback together (container px), or null when the line is not one Live
 * knows (a drawing's id, a line rubbed out). Reads the camera through `pageToScreen`, so a
 * reactive caller re-runs on pan and zoom.
 */
export function lineAnchor(editor: AnchorEditor, state: LiveLineState | undefined): Rect | null {
  if (!state?.line) return null;
  let page: Rect = state.line.bounds;
  const echo = state.mathShapeId ? editor.getShapePageBounds(state.mathShapeId) : undefined;
  if (echo) {
    const x = Math.min(page.x, echo.x);
    const y = Math.min(page.y, echo.y);
    page = { x, y, w: Math.max(page.x + page.w, echo.x + echo.w) - x, h: Math.max(page.y + page.h, echo.y + echo.h) - y };
  }
  const screen = editor.getViewportScreenBounds();
  const a = editor.pageToScreen({ x: page.x, y: page.y });
  const b = editor.pageToScreen({ x: page.x + page.w, y: page.y + page.h });
  return { x: a.x - screen.x, y: a.y - screen.y, w: b.x - a.x, h: b.y - a.y };
}

/**
 * The line an error card sits by (container px), or null when the error belongs in the status
 * pill instead. An error shows in exactly one place: beside its line when it is one the student
 * asked about (`showsHintCard`) and that line is on the screen, else in the pill. A Solve on a
 * drawing fails with the drawing's id, which is no line: before, its card parked at the top of
 * the board, under the bar on a phone, and the pill said the same thing again.
 */
export function errorCardAnchor(editor: AnchorEditor, err: LiveError | null, lines: Readonly<Record<string, LiveLineState>>): Rect | null {
  if (!showsHintCard(err)) return null;
  const anchor = lineAnchor(editor, lines[err.lineId]);
  if (!anchor) return null;
  const screen = editor.getViewportScreenBounds();
  return onScreen(anchor, { width: screen.width, height: screen.height }) ? anchor : null;
}
