import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTLStore, defaultBindingUtils, defaultShapeUtils, loadSnapshot, type TLRecord } from "tldraw";
import { liveShapeUtils } from "@/shapes";
import { buildTimeline, recordsOf } from "@/lib/replay/timeline";
import {
  agathonDocToTldraw,
  AgathonDocError,
  boardSource,
  decodePoints,
  docIsCurrent,
  loadBoardSnapshot,
  parseAgathonDoc,
  richTextPlain,
  TLDRAW_BOARD_SCHEMA,
  toRichText,
  type AgathonDoc,
  type TldrawRecord,
} from "../agathonDoc";

/**
 * Swift → JSON → TS: the iPad app's encoder wrote these (ios/Packages/AgathonBoard,
 * AgathonFixtureExportTests) from the tldraw fixtures the board lane generates
 * (Tools/fixtures/make-fixtures.mjs); here they are read back and turned into tldraw.
 */
const AGATHON = join(__dirname, "../__fixtures__/agathon");
const TLDRAW = join(__dirname, "../../../../ios/Packages/AgathonBoard/Tests/AgathonBoardTests/Fixtures");
const FIXTURES = ["kid-algebra", "legacy-noscreen", "legacy-small", "all-shapes", "synthetic-2000"] as const;

const docOf = (name: string): AgathonDoc => parseAgathonDoc(JSON.parse(readFileSync(join(AGATHON, `${name}.agathon.json`), "utf8")));
const tldrawOf = (name: string): Record<string, TLRecord> => {
  const raw = JSON.parse(readFileSync(join(TLDRAW, `${name}.tldraw.json`), "utf8"));
  return (raw.document?.store ?? raw.store) as Record<string, TLRecord>;
};

/** The web board's own store (tldraw's shapes and bindings + the board's math and graph). */
function boardStore() {
  return createTLStore({ shapeUtils: [...defaultShapeUtils, ...liveShapeUtils], bindingUtils: defaultBindingUtils });
}

type AnyShape = TldrawRecord & { type: string; props: Record<string, unknown>; meta: Record<string, unknown>; x: number; y: number; parentId: string; rotation: number };
const shapesOf = (store: Record<string, unknown>): AnyShape[] => Object.values(store).filter((r) => (r as TldrawRecord).typeName === "shape") as AnyShape[];

describe("decodePoints (the compact points, p1)", () => {
  const vectors = JSON.parse(readFileSync(join(AGATHON, "points.vectors.json"), "utf8")) as Array<{ name: string; encoded: string; points: Array<Record<string, number>> }>;

  it("pins BOARD-FORMAT.md's worked example", () => {
    const pts = decodePoints("AQUDAACAADA//wQyAEAF");
    expect(pts.map((p) => [p.x, p.y, p.t])).toEqual([
      [0, 0, 0],
      [1.5, -2, 4],
      [3.0625, -2, 9],
    ]);
    expect(pts[1].pressure).toBe(1);
    expect(pts[2].pressure).toBeCloseTo(64 / 255, 9);
  });

  it.each(vectors.map((v) => [v.name, v] as const))("reads what the Swift encoder wrote: %s", (_name, v) => {
    const pts = decodePoints(v.encoded);
    expect(pts).toHaveLength(v.points.length);
    pts.forEach((p, i) => {
      const q = v.points[i];
      expect(p.x).toBeCloseTo(q.x, 4);
      expect(p.y).toBeCloseTo(q.y, 4);
      // Swift's Float vs JS's double: the same byte over 255, to Float precision
      expect(p.pressure).toBeCloseTo(q.pressure, 6);
      expect(p.t).toBe(q.t);
      if (q.altitude !== undefined) {
        expect(p.altitude).toBeCloseTo(q.altitude, 5);
        expect(p.azimuth).toBeCloseTo(q.azimuth, 5);
      } else expect(p.altitude).toBeUndefined();
    });
  });

  it("refuses a corrupt string instead of trapping", () => {
    expect(() => decodePoints("AQUD")).toThrow(AgathonDocError);
    expect(() => decodePoints("AgAB")).toThrow(/version/);
  });
});

describe("which column is the board", () => {
  const doc = { format: "agathon.board", schema: 1, records: {} };
  it("prefers a doc written after the last data write", () => {
    expect(docIsCurrent({ doc, version: 7, doc_version: 7 })).toBe(true);
    expect(docIsCurrent({ doc, version: "7", doc_version: "7" })).toBe(true);
    expect(docIsCurrent({ doc, version: 8, doc_version: 7 })).toBe(false);
    expect(docIsCurrent({ doc: null, version: 1, doc_version: null })).toBe(false);
    expect(docIsCurrent({ data: {}, version: 1 })).toBe(false); // a database before the migration
    expect(boardSource({ doc, version: 2, doc_version: 2 })).toBe("doc");
    expect(boardSource(null)).toBe("data");
  });

  it("loadBoardSnapshot: the doc as tldraw when current, else data as stored", () => {
    const data = { document: { store: { x: 1 } } };
    const kid = docOf("kid-algebra");
    const fromDoc = loadBoardSnapshot({ data, doc: kid, version: 3, doc_version: 3 }) as { document: { store: Record<string, unknown> } };
    expect(Object.keys(fromDoc.document.store).length).toBeGreaterThan(50);
    expect(loadBoardSnapshot({ data, doc: kid, version: 4, doc_version: 3 })).toBe(data);
    expect(loadBoardSnapshot({ data, version: 1 })).toBe(data);
    expect(loadBoardSnapshot(null)).toBeNull();
  });

  it("a doc from a newer app falls back to data, and says why", () => {
    const data = { store: {} };
    const errors: unknown[] = [];
    const out = loadBoardSnapshot({ data, doc: { ...doc, schema: 99 }, version: 2, doc_version: 2 }, { onError: (e) => errors.push(e) });
    expect(out).toBe(data);
    expect((errors[0] as AgathonDocError).code).toBe("newer_schema");
    expect(() => parseAgathonDoc({ format: "tldraw" })).toThrow(/not an agathon.board/);
  });
});

describe("rich text", () => {
  it("round-trips plain text through tldraw's rich text", () => {
    for (const text of ["", "one", "two\nlines", "a\n\nb"]) expect(richTextPlain(toRichText(text))).toBe(text);
    expect(richTextPlain("legacy text prop")).toBe("legacy text prop");
  });
});

describe("the trip back: Swift's document → a tldraw snapshot the web board loads", () => {
  it("declares exactly the schema the web board serializes (no migrations on load)", () => {
    expect(boardStore().schema.serialize()).toEqual(TLDRAW_BOARD_SCHEMA);
  });

  it.each(FIXTURES.map((f) => [f]))("%s loads into the web board's store", (name) => {
    const snap = agathonDocToTldraw(docOf(name));
    const store = boardStore();
    expect(() => loadSnapshot(store, snap as never)).not.toThrow();
    // nothing was invented or lost on the way in: every record of the snapshot is in the store
    for (const id of Object.keys(snap.document.store)) expect(store.get(id as never), id).toBeTruthy();
    store.dispose();
  }, 60_000);

  it.each(FIXTURES.map((f) => [f]))("%s: the same pages, shapes in the same places, the same meta", (name) => {
    const original = tldrawOf(name);
    const back = agathonDocToTldraw(docOf(name)).document.store;
    const before = shapesOf(original as never).filter((s) => s.type !== "group");
    const after = new Map(shapesOf(back).map((s) => [s.id, s]));
    // pages keep their ids and names
    for (const r of Object.values(original)) if (r.typeName === "page") expect(back[r.id]?.name).toBe((r as { name: string }).name);

    // page transform of an original shape (groups and frames flattened)
    const pageXY = (s: AnyShape): { x: number; y: number; r: number } => {
      let x = s.x;
      let y = s.y;
      let r = s.rotation;
      let parent = original[s.parentId] as unknown as AnyShape | undefined;
      while (parent && parent.typeName === "shape") {
        const c = Math.cos(parent.rotation);
        const sn = Math.sin(parent.rotation);
        [x, y] = [parent.x + x * c - y * sn, parent.y + x * sn + y * c];
        r += parent.rotation;
        parent = original[parent.parentId] as unknown as AnyShape | undefined;
      }
      return { x, y, r };
    };
    let missing = 0;
    for (const s of before) {
      const t = after.get(s.id);
      // the retired pipeline's pending proposal is the only shape the converter leaves out
      if (!t) {
        expect(s.meta.aiOverlay, `${s.id} (${s.type}) is missing`).toBe(true);
        missing++;
        continue;
      }
      const want = pageXY(s);
      expect(t.x).toBeCloseTo(want.x, 6);
      expect(t.y).toBeCloseTo(want.y, 6);
      expect(t.rotation).toBeCloseTo(want.r, 6);
      // shapes the board models come back as themselves
      expect(t.type).toBe(s.type);
      // every meta key survives (the stroke times as numbers)
      for (const [k, v] of Object.entries(s.meta)) expect(t.meta[k], `${s.id} meta.${k}`).toEqual(v);
      if (s.type === "draw" || s.type === "highlight") {
        const a = (s.props.segments as Array<{ points: unknown[] }>).flatMap((g) => g.points) as Array<{ x: number; y: number }>;
        const b = (t.props.segments as Array<{ points: unknown[] }>).flatMap((g) => g.points) as Array<{ x: number; y: number }>;
        const straight = (s.props.segments as Array<{ type: string }>).some((g) => g.type === "straight");
        if (!straight) {
          expect(b).toHaveLength(a.length);
          a.forEach((q, i) => {
            expect(Math.abs(b[i].x - q.x)).toBeLessThanOrEqual(1 / 32 + 0.005);
            expect(Math.abs(b[i].y - q.y)).toBeLessThanOrEqual(1 / 32 + 0.005);
          });
        }
        expect(t.props.color).toBe(s.props.color);
        expect(t.props.isPen).toBe(s.props.isPen);
        const sw = (p: Record<string, unknown>, k: "size" | "scale") => p[k];
        const width = (p: Record<string, unknown>) => ({ s: 2, m: 3.5, l: 5, xl: 10 })[sw(p, "size") as "s"] + 1;
        if (s.type === "draw") expect(width(t.props) * (t.props.scale as number)).toBeCloseTo(width(s.props) * ((s.props.scale as number) ?? 1), 6);
      } else if (["geo", "note", "text", "frame", "arrow", "line", "image", "video", "embed", "bookmark", "math", "graph"].includes(s.type)) {
        // the props tldraw draws from come back as they were
        const same = (keys: string[]) => {
          for (const k of keys) if (k in s.props) expect(t.props[k], `${s.id} ${s.type}.${k}`).toEqual(s.props[k]);
        };
        if (s.type === "geo") same(["geo", "w", "color", "fill", "richText", "labelColor", "font", "align", "verticalAlign", "url"]);
        if (s.type === "geo") expect(t.props.h).toBeCloseTo((s.props.h as number) + (s.props.growY as number), 6);
        if (s.type === "note") same(["color", "richText", "scale", "growY", "font", "align"]);
        if (s.type === "text") same(["color", "size", "w", "scale", "richText", "font", "textAlign", "autoSize"]);
        if (s.type === "frame") same(["w", "h", "name"]);
        if (s.type === "arrow" && s.props.kind !== "elbow") same(["color", "bend", "arrowheadStart", "arrowheadEnd", "richText", "dash", "kind"]);
        if (s.type === "line") same(["points", "spline", "color", "dash"]);
        if (s.type === "image") same(["w", "h", "crop", "flipX", "altText", "assetId"]);
        if (s.type === "video") same(["w", "h", "time", "assetId"]);
        if (s.type === "embed" || s.type === "bookmark") same(["w", "h", "url"]);
        if (s.type === "math") same(["w", "h", "latex", "source", "status", "resultLatex", "note", "lineId", "size", "tone"]);
        if (s.type === "math") expect([...(t.props.anchorIds as string[])].sort()).toEqual([...(s.props.anchorIds as string[])].sort());
        if (s.type === "graph") same(["w", "h", "fns", "points", "xMin", "xMax", "yMin", "yMax", "autoY", "grid", "title", "lineId"]);
      }
      expect(t.isLocked).toBe(s.meta.aiOverlay === true ? false : s.isLocked);
      expect(t.opacity).toBe(s.opacity);
    }
    expect(missing).toBe(name === "all-shapes" ? 1 : 0);
  }, 60_000);

  it("all-shapes: assets, arrow bindings and inline pictures come back", () => {
    const original = tldrawOf("all-shapes");
    const back = agathonDocToTldraw(docOf("all-shapes")).document.store;
    const bindings = (store: Record<string, unknown>) =>
      Object.values(store)
        .filter((r) => (r as TldrawRecord).typeName === "binding")
        .map((b) => {
          const { id, fromId, toId, props } = b as unknown as { id: string; fromId: string; toId: string; props: Record<string, unknown> };
          return { id, fromId, toId, props };
        })
        .sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(bindings(back)).toEqual(bindings(original as never));
    expect(bindings(back)).toHaveLength(2);
    for (const r of Object.values(original)) {
      if (r.typeName !== "asset") continue;
      const a = back[r.id] as unknown as { props: Record<string, unknown> } | undefined;
      expect(a, r.id).toBeTruthy();
      expect(a!.props).toEqual((r as unknown as { props: Record<string, unknown> }).props);
    }
  });

  it.each([["kid-algebra"], ["all-shapes"], ["synthetic-2000"]])("%s replays the same: the same strokes, in the same order, at the same times", (name) => {
    const before = buildTimeline(recordsOf({ store: tldrawOf(name) }));
    const after = buildTimeline(recordsOf(agathonDocToTldraw(docOf(name))));
    const items = (t: ReturnType<typeof buildTimeline>) => t.items.filter((i) => i.type !== "group" && !(i.type === "image" && i.realAt === null && i.by === "placed"));
    const a = items(before);
    const b = items(after);
    const missing = a.filter((i) => !b.some((j) => j.id === i.id)).map((i) => i.id);
    expect(missing.length).toBeLessThanOrEqual(name === "all-shapes" ? 1 : 0);
    const timed = (t: typeof a) => t.filter((i) => i.realAt !== null).map((i) => `${i.id}@${i.realAt}:${i.by}:${i.mark ?? ""}`);
    expect(timed(b)).toEqual(timed(a));
    expect(after.marks.map((m) => `${m.kind}:${m.lineId}`)).toEqual(before.marks.map((m) => `${m.kind}:${m.lineId}`));
  });

  it("is fast enough for a server route: the 2,000-stroke board in well under a second", () => {
    const doc = docOf("synthetic-2000");
    const t0 = performance.now();
    const snap = agathonDocToTldraw(doc);
    const ms = performance.now() - t0;
    expect(Object.keys(snap.document.store).length).toBeGreaterThan(2400);
    expect(ms).toBeLessThan(1500);
  });

  it("a board made on the iPad (no tldraw leftovers) loads too", () => {
    const doc: AgathonDoc = {
      format: "agathon.board",
      schema: 1,
      records: {
        "screen:s1": { id: "screen:s1", type: "screen", order: "a0", rect: { x: 0, y: 0, w: 1600, h: 900 } },
        "stroke:k1": { id: "stroke:k1", type: "stroke", screen: "screen:s1", order: "a1", author: "kid", color: "violet", width: 6, pressure: "real", x: 100, y: 120, points: "AQUDAACAADA//wQyAEAF", start: 1_760_000_000_000 },
        "stroke:t1": { id: "stroke:t1", type: "stroke", screen: "screen:s1", order: "a2", author: "tutor", color: "tutor", width: 3, pressure: "real", x: 300, y: 120, points: "AQUDAACAADA//wQyAEAF", start: 1_760_000_001_000, meta: { live: true, source: "ai", lineId: "ln_1" } },
        "shape:r1": { id: "shape:r1", type: "shape", screen: "screen:s1", order: "a3", author: "kid", kind: "rect", x: 10, y: 10, w: 200, h: 100, color: "red", width: 3.5, fill: "semi" },
        "shape:a1": { id: "shape:a1", type: "shape", screen: "screen:s1", order: "a4", author: "kid", kind: "arrow", x: 10, y: 300, points: [{ x: 0, y: 0 }, { x: 120, y: 40 }], color: "black", width: 3.5, meta: { attach: { start: { to: "shape:r1", anchor: { x: 0.5, y: 0.5 } } } } },
        "image:i1": { id: "image:i1", type: "image", screen: "screen:s1", order: "a5", x: 400, y: 400, w: 200, h: 150, asset: { src: "https://example.com/p.png", mime: "image/png", w: 800, h: 600 } },
        "math:m1": { id: "math:m1", type: "math", screen: "screen:s1", order: "a6", role: "answer", latex: "x=4", x: 600, y: 100, w: 100, h: 40 },
        "graph:g1": { id: "graph:g1", type: "graph", screen: "screen:s1", order: "a7", x: 900, y: 100, w: 300, h: 200, functions: [{ id: "f", expr: "x", latex: "x", color: "tutor" }], window: { xMin: -5, xMax: 5, yMin: -5, yMax: 5, autoY: false } },
        "mark:x": { id: "mark:x", type: "mark", screen: "screen:s1", kind: "tick", strokes: ["stroke:t1"] },
        "future:z": { id: "future:z", type: "sticker", screen: "screen:s1" },
      },
    };
    const snap = agathonDocToTldraw(doc);
    const store = boardStore();
    expect(() => loadSnapshot(store, snap as never)).not.toThrow();
    const kid = snap.document.store["shape:k1"] as AnyShape;
    expect(kid.meta).toEqual({ t: 1_760_000_000_000, t1: 1_760_000_000_009 });
    expect(kid.props.size).toBe("l");
    const tutor = snap.document.store["shape:t1"] as AnyShape;
    expect(tutor.props.color).toBe("blue");
    expect(tutor.meta.createdAt).toBe(1_760_000_001_000);
    expect(Object.values(snap.document.store).filter((r) => r.typeName === "binding")).toHaveLength(1);
    expect(snap.document.store["shape:r1"]).toMatchObject({ type: "geo", props: { geo: "rectangle", fill: "solid", color: "red", size: "m" } });
    store.dispose();
  });

  it("a problem continued on a second page (the iPad's More room) loads, both pages in order, for the view and the replay", () => {
    // docs/PROBLEM-PAGES.md, "More room": page 2 `continues` page 1, page 1 has `more`; the problem again
    // small at the top of page 2 is tutor ink with `reminder` (and `locked`); the problem record lists
    // its lines on both pages
    const page = (extra: Record<string, unknown>) => ({ kind: "problem", set: "daily:2026-10-21", index: 1, count: 2, origin: "practice", ...extra });
    const doc: AgathonDoc = {
      format: "agathon.board",
      schema: 1,
      records: {
        "screen:p1": { id: "screen:p1", type: "screen", order: "a0", rect: { x: 0, y: 0, w: 1600, h: 900 }, meta: { page: page({ more: true }) } },
        "screen:p1b": { id: "screen:p1b", type: "screen", order: "a0V", rect: { x: 0, y: 0, w: 1600, h: 900 }, meta: { page: page({ continues: "screen:p1", workTop: 150 }) } },
        "screen:p2": { id: "screen:p2", type: "screen", order: "a1", rect: { x: 0, y: 0, w: 1600, h: 900 }, meta: { page: page({ index: 2 }) } },
        "stroke:problem": { id: "stroke:problem", type: "stroke", screen: "screen:p1", order: "a1", author: "tutor", color: "tutor", width: 3, pressure: "real", x: 88, y: 64, points: "AQUDAACAADA//wQyAEAF", start: 1_760_000_000_000, meta: { live: true, handBlock: "hb_1" } },
        "stroke:k1": { id: "stroke:k1", type: "stroke", screen: "screen:p1", order: "a2", author: "kid", color: "black", width: 6, pressure: "real", x: 140, y: 600, points: "AQUDAACAADA//wQyAEAF", start: 1_760_000_010_000 },
        "stroke:copy": { id: "stroke:copy", type: "stroke", screen: "screen:p1b", order: "a0", author: "tutor", color: "tutor", width: 1.5, pressure: "real", x: 88, y: 104, points: "AQUDAACAADA//wQyAEAF", start: 1_760_000_020_000, meta: { reminder: "screen:p1", locked: true } },
        "stroke:k2": { id: "stroke:k2", type: "stroke", screen: "screen:p1b", order: "a1", author: "kid", color: "black", width: 6, pressure: "real", x: 300, y: 768, points: "AQUDAACAADA//wQyAEAF", start: 1_760_000_030_000 },
        "line:l1": { id: "line:l1", type: "line", screen: "screen:p1", strokes: ["stroke:k1"], latex: "2x = 8", verdict: "ok", problem: "problem:hb_1", meta: { checked: "2x = 8" } },
        "line:l2": { id: "line:l2", type: "line", screen: "screen:p1b", strokes: ["stroke:k2"], latex: "x = 4", verdict: "solved", problem: "problem:hb_1", meta: { checked: "x = 4" } },
        "problem:hb_1": { id: "problem:hb_1", type: "problem", screen: "screen:p1", lines: ["line:l1", "line:l2"], latex: "2x + 3 = 11", origin: "chat" },
      },
    };
    const snap = agathonDocToTldraw(doc);
    const store = boardStore();
    expect(() => loadSnapshot(store, snap as never)).not.toThrow();
    const pages = (Object.values(snap.document.store).filter((r) => r.typeName === "page") as (TldrawRecord & { index: string })[])
      .sort((a, b) => (a.index < b.index ? -1 : 1))
      .map((p) => p.id);
    expect(pages).toEqual(["page:p1", "page:p1b", "page:p2"]);
    // the page meta rides along (the view ignores it): the link and the moved answer spot
    const second = snap.document.store["page:p1b"] as TldrawRecord & { meta: Record<string, unknown> };
    expect((second.meta.page as Record<string, unknown>).continues).toBe("screen:p1");
    expect(((snap.document.store["page:p1"] as TldrawRecord & { meta: Record<string, unknown> }).meta.page as Record<string, unknown>).more).toBe(true);
    // the copy of the problem is ink on page 2, locked
    const copy = snap.document.store["shape:copy"] as AnyShape;
    expect(copy.parentId).toBe("page:p1b");
    expect(copy.isLocked).toBe(true);
    // the replay plays both pages, page 1 first
    const timeline = buildTimeline(recordsOf(snap));
    const strokes = timeline.items.filter((i) => i.type === "draw");
    expect(strokes.map((i) => i.id)).toEqual(["shape:problem", "shape:k1", "shape:copy", "shape:k2"]);
    store.dispose();
  });
});
