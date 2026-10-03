import { describe, expect, it, vi } from "vitest";
import { Box, type TLPage, type TLPageId, type TLShapeId } from "tldraw";
import {
  DEFAULT_SCREEN,
  MAX_SCREENS,
  SCREEN_ASPECT,
  addScreen,
  applyScreenCamera,
  ensureScreen,
  goToScreen,
  readScreenMeta,
  screenForContent,
  screenPosition,
  type ScreensEditor,
} from "../screens";

describe("readScreenMeta", () => {
  it("reads a stored screen", () => {
    expect(readScreenMeta({ screen: { x: 0, y: 0, w: 1600, h: 900 } })).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
  });

  it.each([
    ["no meta", undefined],
    ["no screen", {}],
    ["a string", { screen: "big" }],
    ["a missing field", { screen: { x: 0, y: 0, w: 1600 } }],
    ["a zero size", { screen: { x: 0, y: 0, w: 0, h: 900 } }],
    ["NaN", { screen: { x: Number.NaN, y: 0, w: 1600, h: 900 } }],
  ])("is null for %s", (_label, meta) => {
    expect(readScreenMeta(meta)).toBeNull();
  });
});

describe("screenForContent", () => {
  it("is the default screen for an empty page", () => {
    expect(screenForContent(null)).toEqual(DEFAULT_SCREEN);
  });

  it("is the default screen when the ink already fits", () => {
    expect(screenForContent({ x: 100, y: 100, w: 400, h: 200 })).toEqual(DEFAULT_SCREEN);
  });

  it("grows to hold ink drawn before screens, keeping 16:9", () => {
    const s = screenForContent({ x: -300, y: 50, w: 800, h: 2400 });
    expect(s.x).toBeLessThanOrEqual(-300);
    expect(s.y).toBeLessThanOrEqual(50);
    expect(s.y + s.h).toBeGreaterThanOrEqual(2450);
    expect(s.x + s.w).toBeGreaterThanOrEqual(1600);
    expect(s.w / s.h).toBeCloseTo(SCREEN_ASPECT, 2);
  });
});

describe("screenPosition", () => {
  const ids = ["page:a", "page:b", "page:c"] as TLPageId[];
  it("is 1-based", () => {
    expect(screenPosition(ids, ids[1])).toEqual({ index: 2, count: 3 });
  });
  it("falls back to the first screen for an unknown page", () => {
    expect(screenPosition(ids, "page:x" as TLPageId)).toEqual({ index: 1, count: 3 });
  });
});

/** Just enough editor for the screen helpers: pages, one current page, shapes by page. */
function fakeEditor(opts: { pages?: number; shapes?: Record<string, Box[]> } = {}) {
  let pages: TLPage[] = Array.from({ length: opts.pages ?? 1 }, (_, i) => ({
    id: `page:${i + 1}` as TLPageId,
    typeName: "page",
    name: `Page ${i + 1}`,
    index: `a${i + 1}`,
    meta: {},
  })) as TLPage[];
  let current = pages[0].id;
  const shapeBounds = new Map<string, Box>();
  const byPage = new Map<string, TLShapeId[]>();
  for (const [pageId, boxes] of Object.entries(opts.shapes ?? {})) {
    byPage.set(
      pageId,
      boxes.map((b, i) => {
        const id = `shape:${pageId}-${i}` as TLShapeId;
        shapeBounds.set(id, b);
        return id;
      }),
    );
  }
  const setCameraOptions = vi.fn();
  const setCamera = vi.fn();
  const editor = {
    getPages: () => pages,
    getCurrentPage: () => pages.find((p) => p.id === current)!,
    getCurrentPageId: () => current,
    getPageShapeIds: (id: TLPageId) => new Set(byPage.get(id) ?? []),
    getShapePageBounds: (id: TLShapeId) => shapeBounds.get(id),
    updatePage: (partial: Partial<TLPage> & { id: TLPageId }) => {
      pages = pages.map((p) => (p.id === partial.id ? { ...p, ...partial } : p));
    },
    createPage: (page: Partial<TLPage>) => {
      pages = [...pages, { id: `page:${pages.length + 1}` as TLPageId, typeName: "page", name: page.name ?? "", index: `a${pages.length + 1}`, meta: page.meta ?? {} } as TLPage];
    },
    setCurrentPage: (id: TLPageId) => {
      current = id;
    },
    setCameraOptions,
    getCameraOptions: () => ({ isLocked: false, panSpeed: 1, zoomSpeed: 1, zoomSteps: [0.1, 1, 8], wheelBehavior: "pan" as const }),
    setCamera,
    getCamera: () => ({ x: 0, y: 0, z: 1 }),
    run: (fn: () => void) => fn(),
  };
  return { editor: editor as unknown as ScreensEditor, setCameraOptions, setCamera, pages: () => pages };
}

describe("ensureScreen", () => {
  it("writes the default screen onto a blank page that has none", () => {
    const { editor, pages } = fakeEditor();
    expect(ensureScreen(editor)).toEqual(DEFAULT_SCREEN);
    expect(readScreenMeta(pages()[0].meta)).toEqual(DEFAULT_SCREEN);
  });

  it("sizes a legacy page's screen to its existing ink", () => {
    const { editor } = fakeEditor({ shapes: { "page:1": [new Box(0, 0, 200, 50), new Box(100, 2000, 200, 50)] } });
    const s = ensureScreen(editor);
    expect(s.y + s.h).toBeGreaterThanOrEqual(2050);
  });

  it("keeps a screen that is already there", () => {
    const { editor } = fakeEditor();
    editor.updatePage({ id: "page:1" as TLPageId, meta: { screen: { x: 5, y: 5, w: 160, h: 90 } } });
    expect(ensureScreen(editor)).toEqual({ x: 5, y: 5, w: 160, h: 90 });
  });
});

describe("applyScreenCamera", () => {
  it("holds the camera inside the screen and fits it", () => {
    const { editor, setCameraOptions, setCamera } = fakeEditor();
    applyScreenCamera(editor);
    const opts = setCameraOptions.mock.calls[0][0];
    expect(opts.constraints.bounds).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
    expect(opts.constraints.behavior).toBe("contain");
    expect(opts.constraints.baseZoom).toBe("fit-max");
    expect(opts.zoomSteps[0]).toBe(1);
    expect(setCamera).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reset: true }));
  });

  it("keeps the screen clear of the top bar and the toolbar floating over the board", () => {
    const { editor, setCameraOptions } = fakeEditor();
    applyScreenCamera(editor);
    const { padding } = setCameraOptions.mock.calls[0][0].constraints;
    // the help tabs end 52 px down and tldraw's toolbar is 56 px tall: the screen starts below both
    expect(padding.y).toBeGreaterThanOrEqual(60);
    expect(padding.x).toBe(16);
  });
});

describe("addScreen / goToScreen", () => {
  it("adds a screen at the end and moves to it", () => {
    const { editor } = fakeEditor();
    expect(addScreen(editor)).toBe(true);
    expect(editor.getPages()).toHaveLength(2);
    expect(editor.getCurrentPageId()).toBe("page:2");
    expect(readScreenMeta(editor.getCurrentPage().meta)).toEqual(DEFAULT_SCREEN);
  });

  it("stops at the cap", () => {
    const { editor } = fakeEditor({ pages: MAX_SCREENS });
    expect(addScreen(editor)).toBe(false);
    expect(editor.getPages()).toHaveLength(MAX_SCREENS);
  });

  it("moves between screens and clamps at the ends", () => {
    const { editor } = fakeEditor({ pages: 3 });
    expect(goToScreen(editor, -1)).toBe(false);
    expect(goToScreen(editor, 1)).toBe(true);
    expect(editor.getCurrentPageId()).toBe("page:2");
    expect(goToScreen(editor, 5)).toBe(true);
    expect(editor.getCurrentPageId()).toBe("page:3");
    expect(goToScreen(editor, 1)).toBe(false);
  });
});
