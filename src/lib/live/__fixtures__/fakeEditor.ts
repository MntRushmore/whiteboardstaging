import {
  Box,
  Mat,
  Rectangle2d,
  ShapeUtil,
  T,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  getIndexAbove,
  loadSnapshot,
  PageRecordType,
  TLINSTANCE_ID,
  type IndexKey,
  type JsonObject,
  type TLInstance,
  type TLPage,
  type RecordProps,
  type TLDrawShape,
  type TLPageId,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
  type TLStore,
} from "tldraw";
import {
  GRAPH_SHAPE_DEFAULTS,
  LIVE_VERDICTS,
  MATH_SHAPE_DEFAULTS,
  MATH_SIZES,
  MATH_SOURCES,
  MATH_TONES,
  type GraphShape,
  type MathShape,
} from "../contracts";
import type { LiveEditorLike } from "../liveLoop";

/**
 * Headless tldraw store + a minimal editor double for driving LiveLoop in node.
 * The math/graph utils here only exist so records validate; WP-A owns the real ones.
 */

class FixtureMathUtil extends ShapeUtil<MathShape> {
  static override type = "math" as const;
  static override props: RecordProps<MathShape> = {
    w: T.number,
    h: T.number,
    latex: T.string,
    source: T.literalEnum(...MATH_SOURCES),
    status: T.literalEnum(...LIVE_VERDICTS),
    resultLatex: T.string,
    note: T.string,
    anchorIds: T.arrayOf(T.string),
    lineId: T.string,
    size: T.literalEnum(...MATH_SIZES),
    tone: T.literalEnum(...MATH_TONES),
  };
  getDefaultProps(): MathShape["props"] {
    return { ...MATH_SHAPE_DEFAULTS };
  }
  getGeometry(shape: MathShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }
  component() {
    return null;
  }
  indicator() {
    return null;
  }
}

class FixtureGraphUtil extends ShapeUtil<GraphShape> {
  static override type = "graph" as const;
  static override props: RecordProps<GraphShape> = {
    w: T.number,
    h: T.number,
    fns: T.arrayOf(T.object({ id: T.string, expr: T.string, latex: T.string, color: T.string })),
    points: T.arrayOf(T.object({ x: T.number, y: T.number, label: T.string })),
    xMin: T.number,
    xMax: T.number,
    yMin: T.number,
    yMax: T.number,
    autoY: T.boolean,
    grid: T.boolean,
    title: T.string,
    lineId: T.string,
  };
  getDefaultProps(): GraphShape["props"] {
    return { ...GRAPH_SHAPE_DEFAULTS };
  }
  getGeometry(shape: GraphShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }
  component() {
    return null;
  }
  indicator() {
    return null;
  }
}

export function createHeadlessStore(): TLStore {
  const store = createTLStore({
    shapeUtils: [...defaultShapeUtils, FixtureMathUtil, FixtureGraphUtil],
    bindingUtils: defaultBindingUtils,
  });
  // Headless stores start empty; loading an empty document makes tldraw create the
  // document/page/instance records (public API — `ensureStoreIsUsable` is internal).
  loadSnapshot(store, { store: {}, schema: store.schema.serialize() });
  return store;
}

export function pageIdOf(store: TLStore): TLPageId {
  const page = store.allRecords().find((r) => r.typeName === "page");
  if (!page) throw new Error("store has no page");
  return page.id as TLPageId;
}

function isShape(r: { typeName: string }): r is TLShape {
  return r.typeName === "shape";
}

function drawBounds(shape: TLDrawShape): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seg of shape.props.segments) {
    for (const p of seg.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return new Box(shape.x, shape.y, 0, 0);
  return new Box(shape.x + minX, shape.y + minY, maxX - minX, maxY - minY);
}

export interface FakeEditor extends LiveEditorLike {
  store: TLStore;
  /** user-sourced put of full records (what the draw tool / undo does) */
  putUser(records: TLShape[]): void;
  removeUser(ids: TLShapeId[]): void;
  updateUser(id: TLShapeId, fn: (shape: TLShape) => TLShape): void;
  shapesOfType(type: string): TLShape[];
  getCurrentPage(): TLPage;
  /** adds a page (a board screen) after the others; does not switch to it */
  addPage(meta?: JsonObject): TLPageId;
  /** what the screen strip does: changes the instance's current page */
  switchPage(id: TLPageId): void;
  /** the slice of the editor `addScreen` uses (the board chat's `new_screen`) */
  getPages(): TLPage[];
  createPage(page: { name: string; meta?: JsonObject }): void;
  setCurrentPage(id: TLPageId): void;
  run(fn: () => void): void;
}

/** An editor double over a headless store implementing exactly what LiveLoop uses. */
export function createFakeEditor(store: TLStore = createHeadlessStore(), viewport = new Box(0, 0, 1600, 1000)): FakeEditor {
  const currentPageId = (): TLPageId => (store.get(TLINSTANCE_ID) as TLInstance | undefined)?.currentPageId ?? pageIdOf(store);
  const resolve = (s: TLShape | TLShapeId): TLShape | undefined => (typeof s === "string" ? (store.get(s) as TLShape | undefined) : s);
  const defaults: Record<string, object> = {
    math: MATH_SHAPE_DEFAULTS,
    graph: GRAPH_SHAPE_DEFAULTS,
  };
  let lastIndex: IndexKey = "a1" as IndexKey;

  const editor: FakeEditor = {
    store,
    getCurrentPageShapes: () => store.allRecords().filter(isShape).filter((s) => s.parentId === currentPageId()),
    getCurrentPage: () => store.get(currentPageId()) as TLPage,
    addPage: (meta = {}) => {
      const pages = store.allRecords().filter((r) => r.typeName === "page") as TLPage[];
      const last = pages.map((p) => p.index).sort().at(-1) ?? ("a1" as IndexKey);
      const page = PageRecordType.create({ name: `Page ${pages.length + 1}`, index: getIndexAbove(last), meta });
      store.put([page]);
      return page.id;
    },
    switchPage: (id) => {
      const instance = store.get(TLINSTANCE_ID) as TLInstance;
      store.put([{ ...instance, currentPageId: id }]);
    },
    getPages: () => (store.allRecords().filter((r) => r.typeName === "page") as TLPage[]).sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)),
    createPage: (page) => {
      editor.addPage(page.meta ?? {});
    },
    setCurrentPage: (id) => editor.switchPage(id),
    run: (fn) => fn(),
    getShape: (id) => store.get(id) as TLShape | undefined,
    getShapePageBounds: (s) => {
      const shape = resolve(s);
      if (!shape) return undefined;
      if (shape.type === "draw") return drawBounds(shape as TLDrawShape);
      const props = shape.props as { w?: number; h?: number };
      return new Box(shape.x, shape.y, props.w ?? 0, props.h ?? 0);
    },
    getShapePageTransform: (s) => {
      const shape = resolve(s);
      return shape ? Mat.Translate(shape.x, shape.y) : Mat.Identity();
    },
    getViewportPageBounds: () => viewport,
    createShapes: (partials: TLShapePartial[]) => {
      const records = partials.map((p) => {
        lastIndex = getIndexAbove(lastIndex);
        return store.schema.types.shape.create({
          id: p.id,
          type: p.type,
          x: p.x ?? 0,
          y: p.y ?? 0,
          rotation: 0,
          index: lastIndex,
          parentId: currentPageId(),
          isLocked: false,
          opacity: 1,
          meta: (p.meta ?? {}) as TLShape["meta"],
          props: { ...(defaults[p.type] ?? {}), ...(p.props ?? {}) } as TLShape["props"],
        } as TLShape);
      });
      store.put(records);
    },
    updateShapes: (partials: TLShapePartial[]) => {
      for (const p of partials) {
        const cur = store.get(p.id) as TLShape | undefined;
        if (!cur) continue;
        store.put([
          {
            ...cur,
            ...(p.x !== undefined ? { x: p.x } : {}),
            ...(p.y !== undefined ? { y: p.y } : {}),
            props: { ...cur.props, ...(p.props ?? {}) },
            meta: { ...cur.meta, ...(p.meta ?? {}) },
          } as TLShape,
        ]);
      }
    },
    deleteShapes: (ids) => store.remove(ids),
    putUser: (records) => store.put(records.map((r) => ({ ...r, parentId: currentPageId() }) as TLShape)),
    removeUser: (ids) => store.remove(ids),
    updateUser: (id, fn) => {
      const cur = store.get(id) as TLShape | undefined;
      if (cur) store.put([fn(cur)]);
    },
    shapesOfType: (type) => store.allRecords().filter(isShape).filter((s) => s.type === type),
  };
  return editor;
}
