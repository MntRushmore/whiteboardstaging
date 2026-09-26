import type { Box, Editor, TLPage, TLPageId } from "tldraw";
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
/** screen-space gap between the screen edge and the window edge */
export const SCREEN_VIEW_PADDING = 16;
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
      padding: { x: SCREEN_VIEW_PADDING, y: SCREEN_VIEW_PADDING },
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

/** Moves `delta` screens forward/back; clamps at the ends. Returns whether it moved. */
export function goToScreen(editor: ScreensEditor, delta: number): boolean {
  const ids = editor.getPages().map((p) => p.id);
  const i = ids.indexOf(editor.getCurrentPageId());
  const next = Math.min(ids.length - 1, Math.max(0, i + delta));
  if (next === i || next < 0) return false;
  editor.setCurrentPage(ids[next]);
  return true;
}
