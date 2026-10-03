import { getIndexBetween, type Box, type Editor, type TLPage, type TLPageId } from "tldraw";
import type { Rect } from "@/lib/live/contracts";

/**
 * Screens: a board is a stack of fixed 16:9 whiteboards instead of one infinite canvas.
 *
 * Each screen is a tldraw page whose `meta.screen` records its rect in page space. The camera
 * is held inside that rect (`contain`), so the student cannot pan off it and Live only ever
 * reads one screen at a time — two problems on two screens can never be mistaken for one
 * derivation. The rect is stored rather than implied so a board drawn before screens existed
 * keeps all of its ink: its first screen grows to fit what is already there.
 */

export const SCREEN = { w: 1600, h: 900 } as const;
export const SCREEN_ASPECT = SCREEN.w / SCREEN.h;
/** page-space breathing room around ink that predates screens */
const LEGACY_PAD = 40;
/**
 * Screen-space gap between the screen edge and the board's edge. Taller than wide: the top bar
 * (16 + 36 px) and tldraw's toolbar (48 + 8 px) float over the board, and on a laptop or a monitor —
 * where the 16:9 screen is fitted by height — a 16 px gap put the first line's top-left corner
 * under the help tabs and the bottom of the screen under the tools. 64 px clears both. An iPad
 * (fitted by width, with room to spare above and below) is unaffected. See `screenViewPadding`.
 */
export const SCREEN_VIEW_PADDING = { x: 16, y: 64 } as const;

/**
 * The gap for a board this tall. Clearing the chrome costs 96 px of screen height, a few per cent on
 * a monitor but over a quarter on a phone on its side (358 → 262 px tall at 390), where the screen
 * is better big with the bar over its edge. So the vertical gap is 64 px from a 640 px tall board
 * up (every laptop), the edge gap of 16 px at 400 px and below, and in between in proportion.
 */
export function screenViewPadding(boardHeight: number): { x: number; y: number } {
  const y = Math.round(Math.min(SCREEN_VIEW_PADDING.y, Math.max(SCREEN_VIEW_PADDING.x, SCREEN_VIEW_PADDING.x + (boardHeight - 400) * 0.2)));
  return { x: SCREEN_VIEW_PADDING.x, y };
}
export const MAX_SCREENS = 50;

export interface ScreenMeta {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEFAULT_SCREEN: ScreenMeta = { x: 0, y: 0, ...SCREEN };

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** The screen rect stored on a page, or null for a page that predates screens (or a bad value). */
export function readScreenMeta(meta: unknown): ScreenMeta | null {
  if (!meta || typeof meta !== "object") return null;
  const s = (meta as { screen?: unknown }).screen;
  if (!s || typeof s !== "object") return null;
  const { x, y, w, h } = s as Record<string, unknown>;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) return null;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/**
 * The screen for a page that has none yet: the default screen, grown (keeping 16:9) to hold
 * any content already on the page so nothing a student drew before screens is cut off.
 */
export function screenForContent(content: Rect | null): ScreenMeta {
  if (!content || content.w <= 0 || content.h <= 0) return { ...DEFAULT_SCREEN };
  const x0 = Math.min(DEFAULT_SCREEN.x, content.x - LEGACY_PAD);
  const y0 = Math.min(DEFAULT_SCREEN.y, content.y - LEGACY_PAD);
  const x1 = Math.max(DEFAULT_SCREEN.x + DEFAULT_SCREEN.w, content.x + content.w + LEGACY_PAD);
  const y1 = Math.max(DEFAULT_SCREEN.y + DEFAULT_SCREEN.h, content.y + content.h + LEGACY_PAD);
  let w = x1 - x0;
  let h = y1 - y0;
  // Grow the short side so the screen keeps the shape every other screen has.
  if (w / h > SCREEN_ASPECT) h = w / SCREEN_ASPECT;
  else w = h * SCREEN_ASPECT;
  return { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(w), h: Math.ceil(h) };
}

/** Screen number (1-based) and count for the strip. */
export function screenPosition(pageIds: readonly TLPageId[], current: TLPageId): { index: number; count: number } {
  const i = pageIds.indexOf(current);
  return { index: i === -1 ? 1 : i + 1, count: pageIds.length };
}

export type ScreensEditor = Pick<
  Editor,
  | "getPages"
  | "getCurrentPage"
  | "getCurrentPageId"
  | "getPageShapeIds"
  | "getShapePageBounds"
  | "updatePage"
  | "createPage"
  | "setCurrentPage"
  | "setCameraOptions"
  | "getCameraOptions"
  | "setCamera"
  | "getCamera"
  | "getViewportScreenBounds"
  | "run"
>;

function contentBounds(editor: ScreensEditor, pageId: TLPageId): Rect | null {
  let box: Box | null = null;
  for (const id of editor.getPageShapeIds(pageId)) {
    const b = editor.getShapePageBounds(id);
    if (!b) continue;
    box = box ? box.union(b) : b.clone();
  }
  return box ? { x: box.x, y: box.y, w: box.w, h: box.h } : null;
}

/** The current page's screen, writing one onto the page first when it has none. */
export function ensureScreen(editor: ScreensEditor, page: TLPage = editor.getCurrentPage()): ScreenMeta {
  const existing = readScreenMeta(page.meta);
  if (existing) return existing;
  const screen = screenForContent(contentBounds(editor, page.id));
  editor.run(() => editor.updatePage({ id: page.id, meta: { ...page.meta, screen: { ...screen } } }), { history: "ignore" });
  return screen;
}

/** Page-space room kept between a screen's edge and something sized to fill it (a PDF page). */
export const SCREEN_FIT_MARGIN = 40;

/**
 * Where something of `size` goes to fill `screen`: scaled down (never up) to fit inside it with
 * `margin` on every side, and centred. A portrait worksheet page fills the screen's height.
 */
export function fitInScreen(size: { w: number; h: number }, screen: ScreenMeta, margin = SCREEN_FIT_MARGIN): ScreenMeta {
  const room = { w: Math.max(1, screen.w - 2 * margin), h: Math.max(1, screen.h - 2 * margin) };
  const scale = Math.min(1, room.w / size.w, room.h / size.h);
  const w = size.w * scale;
  const h = size.h * scale;
  return { x: screen.x + (screen.w - w) / 2, y: screen.y + (screen.h - h) / 2, w, h };
}

/** The current screen rect without writing anything (for readers such as Live placement). */
export function currentScreen(editor: Pick<Editor, "getCurrentPage">): ScreenMeta | null {
  return readScreenMeta(editor.getCurrentPage().meta);
}

/** Holds the camera inside the current screen and fits the screen to the window. */
export function applyScreenCamera(editor: ScreensEditor): void {
  const screen = ensureScreen(editor);
  const prev = editor.getCameraOptions();
  editor.setCameraOptions({
    ...prev,
    // Zooming out past "the whole screen" would only show empty margin.
    zoomSteps: [1, 1.5, 2, 3, 4],
    wheelBehavior: "pan",
    constraints: {
      bounds: { x: screen.x, y: screen.y, w: screen.w, h: screen.h },
      padding: screenViewPadding(editor.getViewportScreenBounds().h),
      origin: { x: 0.5, y: 0.5 },
      initialZoom: "fit-max",
      baseZoom: "fit-max",
      behavior: "contain",
    },
  });
  editor.setCamera(editor.getCamera(), { reset: true, immediate: true });
}

/** Adds a blank screen after the last one and moves to it. Returns false at the cap. */
export function addScreen(editor: ScreensEditor): boolean {
  const pages = editor.getPages();
  if (pages.length >= MAX_SCREENS) return false;
  editor.run(() => {
    editor.createPage({ name: `Screen ${pages.length + 1}`, meta: { screen: { ...DEFAULT_SCREEN } } });
    const created = editor.getPages()[editor.getPages().length - 1];
    editor.setCurrentPage(created.id);
  });
  return true;
}

export type DeleteScreenEditor = ScreensEditor & Pick<Editor, "deletePage" | "getShape" | "getBindingsInvolvingShape" | "store" | "markHistoryStoppingPoint">;

/**
 * Deletes the current screen (never the only one) with its ink, and shows the one before it (the
 * next, when it was the first). Resolves to a function that puts it back as it was — the strip's
 * "Undo" — or null when there was nothing to delete.
 *
 * `finishWriting` (Live's, `liveStore.finishWriting`) is called first and its writes let land: a
 * step the tutor was half way through would otherwise go on writing onto the next screen, and the
 * restore would bring it back half written ("x = 1" for "x = 14"). The delete is its own undo step,
 * so Ctrl+Z brings the screen back with every stroke. The restore does not lean on the undo stack,
 * which by then may hold the student's next strokes, and does nothing once the screen is back.
 */
export async function deleteScreen(editor: DeleteScreenEditor, finishWriting?: () => void): Promise<(() => void) | null> {
  const page = editor.getCurrentPage();
  if (editor.getPages().length <= 1) return null;
  // twice: a pen that finished can hand the line to the next one (a ring, then its step)
  for (let i = 0; i < 2 && finishWriting; i++) {
    finishWriting();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  // the student moved on (or the screen went) while the writing landed: delete nothing
  if (editor.getCurrentPageId() !== page.id || editor.getPages().length <= 1) return null;
  const shapes = [...editor.getPageShapeIds(page.id)].map((id) => editor.getShape(id)).filter((s) => s !== undefined);
  const bindings = new Map(shapes.flatMap((s) => editor.getBindingsInvolvingShape(s)).map((b) => [b.id, b]));
  const deleted = editor.getCurrentPage();
  editor.markHistoryStoppingPoint("delete screen");
  editor.deletePage(page.id);
  return () => {
    const pages = editor.getPages();
    // already back (Ctrl+Z), or no room for it
    if (pages.some((p) => p.id === deleted.id) || pages.length >= MAX_SCREENS) return;
    // where it was, before a screen added since in its place
    const below = [...pages].reverse().find((p) => p.index < deleted.index);
    const index = pages.some((p) => p.index === deleted.index) ? getIndexBetween(below?.index, deleted.index) : deleted.index;
    editor.run(() => {
      editor.store.put([{ ...deleted, index }, ...shapes, ...bindings.values()]);
      editor.setCurrentPage(deleted.id);
    });
  };
}

/** Moves `delta` screens forward/back; clamps at the ends. Returns whether it moved. */
export function goToScreen(editor: ScreensEditor, delta: number): boolean {
  const ids = editor.getPages().map((p) => p.id);
  const i = ids.indexOf(editor.getCurrentPageId());
  const next = Math.min(ids.length - 1, Math.max(0, i + delta));
  if (next === i || next < 0) return false;
  editor.setCurrentPage(ids[next]);
  return true;
}
