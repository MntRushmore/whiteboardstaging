import { describe, expect, it, vi } from "vitest";
import { Box, type TLPage, type TLPageId, type TLShapeId } from "tldraw";
import {
  DEFAULT_SCREEN,
  MAX_SCREENS,
  SCREEN_ASPECT,
  addScreen,
  deleteScreen,
  applyScreenCamera,
  ensureScreen,
  goToScreen,
  readScreenMeta,
  screenForContent,
  screenPosition,
  screenViewPadding,
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
function fakeEditor(opts: { pages?: number; shapes?: Record<string, Box[]>; boardHeight?: number } = {}) {
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
  /** the order things happened in when a screen was deleted */
  const log: string[] = [];
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
    getViewportScreenBounds: () => new Box(0, 0, 1280, opts.boardHeight ?? 800),
    run: (fn: () => void) => fn(),
    // deleting and restoring a screen (tldraw's deletePage moves to the page before, else after)
    getShape: (id: TLShapeId) => {
      const pageId = [...byPage].find(([, ids]) => ids.includes(id))?.[0];
      return pageId ? { id, typeName: "shape", parentId: pageId } : undefined;
    },
    getBindingsInvolvingShape: () => [],
    markHistoryStoppingPoint: (name: string) => log.push(`mark:${name}`),
    deletePage: (id: TLPageId) => {
      log.push(`delete:${id}`);
      const i = pages.findIndex((p) => p.id === id);
      if (current === id) current = (pages[i - 1] ?? pages[i + 1]).id;
      pages = pages.filter((p) => p.id !== id);
      byPage.delete(id);
    },
    store: {
      put: (records: Array<{ id: string; typeName: string; parentId?: string }>) => {
        for (const r of records) {
          if (r.typeName === "page") pages = [...pages, r as TLPage].sort((a, b) => (a.index < b.index ? -1 : 1));
          else if (r.parentId) byPage.set(r.parentId, [...(byPage.get(r.parentId) ?? []), r.id as TLShapeId]);
        }
      },
    },
  };
  return { editor: editor as unknown as ScreensEditor, setCameraOptions, setCamera, pages: () => pages, shapesOn: (id: string) => byPage.get(id) ?? [], log };
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

  it("on a phone on its side the screen stays big: the gap shrinks with the board's height", () => {
    const at = (boardHeight: number) => {
      const { editor, setCameraOptions } = fakeEditor({ boardHeight });
      applyScreenCamera(editor);
      return setCameraOptions.mock.calls[0][0].constraints.padding.y;
    };
    expect(at(390)).toBe(16);
    expect(at(520)).toBe(40);
    expect(at(640)).toBe(64);
    expect(at(1080)).toBe(64);
    expect(screenViewPadding(300)).toEqual({ x: 16, y: 16 });
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

  it("deletes the current screen and its ink, shows the one before it, and puts it all back on Undo", async () => {
    const { editor, pages, shapesOn } = fakeEditor({ pages: 3, shapes: { "page:2": [new Box(0, 0, 10, 10), new Box(20, 0, 10, 10)] } });
    goToScreen(editor, 1);
    const restore = await deleteScreen(editor as never);
    expect(restore).toBeTypeOf("function");
    expect(pages().map((p) => p.id)).toEqual(["page:1", "page:3"]);
    expect(editor.getCurrentPageId()).toBe("page:1");
    expect(shapesOn("page:2")).toEqual([]);
    restore!();
    // the screen and both of its strokes come back where they were, and the student is shown it
    expect(pages().map((p) => p.id)).toEqual(["page:1", "page:2", "page:3"]);
    expect(shapesOn("page:2")).toHaveLength(2);
    expect(editor.getCurrentPageId()).toBe("page:2");
  });

  it("the tutor's pens finish (and their writes land) before the screen goes, and the delete is its own undo step", async () => {
    const { editor, log } = fakeEditor({ pages: 2 });
    goToScreen(editor, 1);
    // a finished pen's last strokes are written a microtask later, as Live's writes are
    const finishWriting = vi.fn(() => queueMicrotask(() => log.push("strokes landed")));
    await deleteScreen(editor as never, finishWriting);
    expect(finishWriting).toHaveBeenCalled();
    expect(log.slice(-2)).toEqual(["mark:delete screen", "delete:page:2"]);
    expect(log.indexOf("strokes landed")).toBeLessThan(log.indexOf("delete:page:2"));
  });

  it("Undo from the toast does nothing once Ctrl+Z has brought the screen back", async () => {
    const { editor, pages } = fakeEditor({ pages: 2 });
    goToScreen(editor, 1);
    const page = editor.getCurrentPage();
    const restore = await deleteScreen(editor as never);
    // Ctrl+Z: tldraw puts the page back itself (the student may have changed it since)
    (editor as unknown as { store: { put: (r: unknown[]) => void } }).store.put([page]);
    const before = pages().length;
    restore!();
    expect(pages()).toHaveLength(before);
  });

  it("a screen added since takes no index from the one put back: it returns to where it was", async () => {
    const { editor, pages } = fakeEditor({ pages: 2 });
    goToScreen(editor, 1);
    const restore = await deleteScreen(editor as never);
    // a new screen at the end now has the deleted screen's index (tldraw: the index above the last)
    (editor as unknown as { store: { put: (r: unknown[]) => void } }).store.put([{ id: "page:new", typeName: "page", name: "Screen 2", index: "a2", meta: {} }]);
    expect(pages().map((p) => p.index)).toEqual(["a1", "a2"]);
    restore!();
    const indexes = pages().map((p) => p.index);
    expect(new Set(indexes).size).toBe(3);
    expect(pages().map((p) => p.id)[1]).toBe("page:2");
  });

  it("never deletes a board's only screen", async () => {
    const { editor } = fakeEditor();
    expect(await deleteScreen(editor as never)).toBeNull();
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
