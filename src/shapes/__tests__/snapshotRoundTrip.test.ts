import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createShapeId,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  getIndexAbove,
  getSnapshot,
  loadSnapshot,
  PageRecordType,
  toRichText,
  ZERO_INDEX_KEY,
  type IndexKey,
  type TLDrawShape,
  type TLPageId,
  type TLShape,
  type TLStore,
  type TLTextShape,
} from "tldraw";
import {
  GRAPH_COLORS,
  GRAPH_SHAPE_DEFAULTS,
  MATH_SHAPE_DEFAULTS,
  type GraphShape,
  type LiveShapeMeta,
  type MathShape,
} from "@/lib/live/contracts";
import { GraphShapeUtil } from "../graph/GraphShapeUtil";
import { MathShapeUtil } from "../math/MathShapeUtil";
import { LIVE_SHAPE_TYPES, liveShapeUtils, liveTools, liveUiOverrides } from "../index";

/**
 * Headless stores start completely empty; loading an empty document makes tldraw create the
 * document/page/instance records that `getSnapshot` needs (public API, no Editor / DOM).
 */
function usable(store: TLStore): TLStore {
  loadSnapshot(store, { store: {}, schema: store.schema.serialize() });
  return store;
}
function liveStore(): TLStore {
  return usable(
    createTLStore({ shapeUtils: [...defaultShapeUtils, ...liveShapeUtils], bindingUtils: defaultBindingUtils }),
  );
}
function legacyStore(): TLStore {
  return usable(createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils }));
}

/** Headless stores start empty: create the page every shape record needs as its parent. */
function pageIdOf(store: TLStore): TLPageId {
  const existing = store.allRecords().find((r) => r.typeName === "page");
  if (existing) return existing.id as TLPageId;
  const page = PageRecordType.create({ id: PageRecordType.createId("page"), name: "Page 1", index: ZERO_INDEX_KEY });
  store.put([page]);
  return page.id;
}

function shapesOf(store: TLStore): TLShape[] {
  return store
    .allRecords()
    .filter((r): r is TLShape => r.typeName === "shape")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

let index: IndexKey = ZERO_INDEX_KEY;
function base(parentId: TLPageId, x: number, y: number) {
  index = getIndexAbove(index);
  return { typeName: "shape" as const, x, y, rotation: 0, index, parentId, isLocked: false, opacity: 1 };
}

const liveMeta = (source: LiveShapeMeta["source"], lineId: string): LiveShapeMeta => ({
  live: true,
  source,
  lineId,
  createdAt: 1_700_000_000_000,
});

function mathRecord(parentId: TLPageId, over: Partial<MathShape["props"]> = {}): MathShape {
  return {
    id: createShapeId(),
    type: "math",
    ...base(parentId, 100, 40),
    props: { ...MATH_SHAPE_DEFAULTS, anchorIds: ["shape:a1", "shape:a2"], ...over },
    meta: liveMeta("echo", "ln_1"),
  };
}

function graphRecord(parentId: TLPageId): GraphShape {
  return {
    id: createShapeId(),
    type: "graph",
    ...base(parentId, 400, 40),
    props: {
      ...GRAPH_SHAPE_DEFAULTS,
      fns: [{ id: "f1", expr: "x^2 - 4", latex: "x^{2}-4", color: GRAPH_COLORS[0] }],
      points: [{ x: 2, y: 0, label: "(2, 0)" }],
      title: "y = x^2 - 4",
      lineId: "ln_1",
    },
    meta: liveMeta("echo", "ln_1"),
  };
}

function drawRecord(parentId: TLPageId): TLDrawShape {
  return {
    id: createShapeId(),
    type: "draw",
    ...base(parentId, 10, 10),
    props: {
      color: "black",
      fill: "none",
      dash: "draw",
      size: "m",
      segments: [
        {
          type: "free",
          points: [
            { x: 0, y: 0, z: 0.5 },
            { x: 10, y: 4, z: 0.5 },
            { x: 22, y: 18, z: 0.5 },
          ],
        },
      ],
      isComplete: true,
      isClosed: false,
      isPen: false,
      scale: 1,
    },
    meta: {},
  };
}

function textRecord(parentId: TLPageId): TLTextShape {
  return {
    id: createShapeId(),
    type: "text",
    ...base(parentId, 200, 10),
    props: {
      color: "black",
      size: "m",
      font: "draw",
      textAlign: "start",
      w: 120,
      richText: toRichText("2x + 3 = 11"),
      scale: 1,
      autoSize: true,
    },
    meta: {},
  };
}

describe("shape registration", () => {
  it("exports the utils, tool and override", () => {
    expect(liveShapeUtils).toEqual([MathShapeUtil, GraphShapeUtil]);
    expect(liveTools.map((t) => t.id)).toEqual(["math"]);
    expect(LIVE_SHAPE_TYPES).toEqual(["math", "graph"]);
    expect(MathShapeUtil.type).toBe("math");
    expect(GraphShapeUtil.type).toBe("graph");
    expect(typeof liveUiOverrides.tools).toBe("function");
  });

  it("both utils declare static migrations with an empty, reserved sequence", () => {
    for (const Util of [MathShapeUtil, GraphShapeUtil]) {
      expect(Util.migrations).toBeDefined();
      expect(Util.migrations).toEqual({ sequence: [] });
    }
  });

  it("never touches the DOM at module scope (this file runs under environment: node)", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("validators require every prop so a record is never partially valid", () => {
    const store = liveStore();
    const pageId = pageIdOf(store);
    const good = mathRecord(pageId, { latex: "x^2" });
    expect(() => store.put([good])).not.toThrow();
    const partialProps: Record<string, unknown> = { ...good.props };
    delete partialProps.status;
    const bad = { ...good, id: createShapeId(), props: partialProps } as unknown as MathShape;
    expect(() => store.put([bad])).toThrow();
    const wrongEnum = { ...good, id: createShapeId(), props: { ...good.props, tone: "loud" } } as unknown as MathShape;
    expect(() => store.put([wrongEnum])).toThrow();
    const badFn = graphRecord(pageId);
    (badFn.props.fns as unknown[]).push({ id: "x", expr: "x" });
    expect(() => store.put([badFn])).toThrow();
  });
});

describe("snapshot round trip", () => {
  it("math + graph records survive getSnapshot -> loadSnapshot into a fresh store", () => {
    const a = liveStore();
    const pageId = pageIdOf(a);
    const math = mathRecord(pageId, { latex: "2x+3=11", status: "ok", source: "echo", tone: "muted", resultLatex: "" });
    const typed = mathRecord(pageId, { latex: "\\frac{1}{2}", source: "student", anchorIds: [], lineId: "" });
    typed.meta = {};
    const graph = graphRecord(pageId);
    a.put([math, typed, graph]);

    const snapshot = getSnapshot(a);
    const json = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;

    const b = liveStore();
    expect(() => loadSnapshot(b, json)).not.toThrow();

    const before = shapesOf(a);
    const after = shapesOf(b);
    expect(after).toHaveLength(3);
    expect(after).toEqual(before);
    const loadedGraph = after.find((s) => s.type === "graph") as GraphShape;
    expect(loadedGraph.props.fns[0].expr).toBe("x^2 - 4");
    expect(loadedGraph.props.points[0].label).toBe("(2, 0)");
    const loadedMath = after.find((s) => s.type === "math" && (s as MathShape).props.status === "ok") as MathShape;
    expect(loadedMath.meta).toEqual(liveMeta("echo", "ln_1"));
    expect(loadedMath.props.anchorIds).toEqual(["shape:a1", "shape:a2"]);
  });

  it("a legacy snapshot (store without live utils) loads into a live store and keeps its shapes", () => {
    const legacy = legacyStore();
    const pageId = pageIdOf(legacy);
    legacy.put([drawRecord(pageId), textRecord(pageId)]);
    const snapshot = JSON.parse(JSON.stringify(getSnapshot(legacy))) as ReturnType<typeof getSnapshot>;
    expect(JSON.stringify(snapshot)).not.toContain('"math"');

    const live = liveStore();
    expect(() => loadSnapshot(live, snapshot)).not.toThrow();
    const shapes = shapesOf(live);
    expect(shapes).toHaveLength(2);
    expect(shapes.map((s) => s.type).sort()).toEqual(["draw", "text"]);
    expect(shapes).toEqual(shapesOf(legacy));
  });

  it("the recorded legacy fixture loads without throwing and keeps its shape count", () => {
    const raw = readFileSync(join(__dirname, "fixtures", "legacy-board-snapshot.json"), "utf8");
    const fixture = JSON.parse(raw) as ReturnType<typeof getSnapshot>;
    const expected = Object.values(fixture.document.store).filter((r) => r.typeName === "shape").length;
    expect(expected).toBeGreaterThan(0);

    const live = liveStore();
    expect(() => loadSnapshot(live, fixture)).not.toThrow();
    expect(shapesOf(live)).toHaveLength(expected);
    // and the document-only form (what the board page persists) loads too
    const live2 = liveStore();
    expect(() => loadSnapshot(live2, fixture.document)).not.toThrow();
    expect(shapesOf(live2)).toHaveLength(expected);
  });

  it("a live snapshot re-loads into a store that has live utils but a snapshot saved with them (deploy skew forward)", () => {
    const a = liveStore();
    const pageId = pageIdOf(a);
    a.put([drawRecord(pageId), mathRecord(pageId), graphRecord(pageId)]);
    const snapshot = JSON.parse(JSON.stringify(getSnapshot(a))) as ReturnType<typeof getSnapshot>;
    const b = liveStore();
    loadSnapshot(b, snapshot);
    expect(shapesOf(b)).toHaveLength(3);
    // a store WITHOUT the utils cannot load it: this is why both <Tldraw> mounts register the utils
    expect(() => loadSnapshot(legacyStore(), snapshot)).toThrow();
  });
});
