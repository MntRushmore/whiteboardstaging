import { describe, expect, it } from "vitest";
import { createTLStore, defaultBindingUtils, defaultShapeUtils, loadSnapshot, type TLRecord, type TLStore } from "tldraw";
import { liveShapeUtils } from "@/shapes";
import { buildTimeline, frameAt, recordsOf } from "@/lib/replay/timeline";
import { syntheticBoard } from "@/lib/replay/synthetic";
import { partialStroke, ReplayStage } from "../stage";

/** The replay's store as the player sets it up: the board's document, pages and assets, no shapes. */
function stageFor(records: TLRecord[]): { store: TLStore; stage: ReplayStage; timeline: ReturnType<typeof buildTimeline> } {
  const store = createTLStore({ shapeUtils: [...defaultShapeUtils, ...liveShapeUtils], bindingUtils: defaultBindingUtils });
  const base = Object.fromEntries(records.filter((r) => r.typeName !== "shape" && r.typeName !== "binding").map((r) => [r.id, r]));
  loadSnapshot(store, { store: base, schema: store.schema.serialize() } as Parameters<typeof loadSnapshot>[1]);
  const timeline = buildTimeline(records);
  return { store, stage: new ReplayStage(store, records, timeline), timeline };
}

const shapeIds = (store: TLStore) =>
  store
    .allRecords()
    .filter((r) => r.typeName === "shape")
    .map((r) => r.id)
    .sort();

const pointsOf = (rec: TLRecord | undefined) => ((rec as { props?: { segments?: { points: unknown[] }[] } })?.props?.segments ?? []).reduce((n, s) => n + s.points.length, 0);

const board = () => recordsOf(syntheticBoard({ strokes: 40, perPage: 25 }));

describe("ReplayStage", () => {
  it("plays forward: what has started is on the store, the stroke being drawn part drawn and not complete", () => {
    const { store, stage, timeline } = stageFor(board());
    const first = timeline.items[0];
    stage.apply(frameAt(timeline, first.start + (first.end - first.start) / 2));
    expect(shapeIds(store)).toEqual([first.id]);
    const part = store.get(first.id as TLRecord["id"]) as { props: { isComplete: boolean } };
    expect(part.props.isComplete).toBe(false);
    expect(pointsOf(part as unknown as TLRecord)).toBeLessThan(first.points);

    stage.apply(frameAt(timeline, first.end + 1));
    const whole = store.get(first.id as TLRecord["id"]) as unknown as TLRecord;
    expect(pointsOf(whole)).toBe(first.points);
    expect((whole as unknown as { props: { isComplete: boolean } }).props.isComplete).toBe(true);

    const mid = timeline.items[20];
    stage.apply(frameAt(timeline, mid.start + 1));
    expect(shapeIds(store)).toEqual(timeline.items.slice(0, 21).map((i) => i.id).sort());
  });

  it("goes back: takes off what starts after the new position, and only that", () => {
    const { store, stage, timeline } = stageFor(board());
    stage.apply(frameAt(timeline, timeline.durationMs));
    expect(shapeIds(store)).toHaveLength(timeline.items.length);
    const kept = store.get(timeline.items[3].id as TLRecord["id"]);
    stage.apply(frameAt(timeline, timeline.items[10].start));
    expect(shapeIds(store)).toEqual(timeline.items.slice(0, 10).map((i) => i.id).sort());
    // untouched records are the very same objects (not put again)
    expect(store.get(timeline.items[3].id as TLRecord["id"])).toBe(kept);
    stage.apply(frameAt(timeline, 0));
    expect(shapeIds(store)).toEqual([]);
  });

  it("writes once per frame, and not at all when nothing changed", () => {
    const { stage, timeline } = stageFor(board());
    const f = frameAt(timeline, timeline.items[5].end + 1);
    stage.apply(f);
    const writes = stage.writes;
    stage.apply(frameAt(timeline, timeline.items[5].end + 2));
    expect(stage.writes).toBe(writes);
    stage.apply(frameAt(timeline, timeline.items[8].end + 1));
    expect(stage.writes).toBe(writes + 1);
  });

  it("shows the whole board, and clears it", () => {
    const { store, stage, timeline } = stageFor(board());
    stage.showAll();
    expect(shapeIds(store)).toHaveLength(timeline.items.length);
    stage.clear();
    expect(shapeIds(store)).toEqual([]);
  });

  it("puts a group before the shapes inside it, and rebuilds when going back through one", () => {
    const records = board();
    const pageId = timeline0(records).items[0].pageId;
    const group = { id: "shape:grp", typeName: "shape", type: "group", parentId: pageId, index: "c0zz", x: 0, y: 0, rotation: 0, opacity: 1, isLocked: false, meta: { t: 1 }, props: {} } as unknown as TLRecord;
    const child = { ...(records.find((r) => r.id === "shape:syn3") as TLRecord), parentId: "shape:grp", meta: { t: 9_999_999_999_999 } } as unknown as TLRecord;
    const withGroup = [...records.filter((r) => r.id !== "shape:syn3"), group, child];
    const { store, stage, timeline } = stageFor(withGroup);
    // the child is drawn last; the group (t: 1) first
    const childAt = timeline.items.findIndex((i) => i.id === "shape:syn3");
    expect(childAt).toBe(timeline.items.length - 1);
    stage.apply(frameAt(timeline, timeline.durationMs));
    expect(store.get("shape:syn3" as TLRecord["id"])).toBeTruthy();
    // back to before the group: both go
    stage.apply(frameAt(timeline, 0));
    expect(shapeIds(store)).toEqual([]);
  });

  it("puts a binding once both its ends are there", () => {
    const records = board();
    const tl = timeline0(records);
    const [a, b] = [tl.items[0].id, tl.items[5].id];
    const binding = { id: "binding:x", typeName: "binding", type: "arrow", fromId: a, toId: b, meta: {}, props: { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: "none" } } as unknown as TLRecord;
    const { store, stage, timeline } = stageFor([...records, binding]);
    stage.apply(frameAt(timeline, timeline.items[2].end + 1));
    expect(store.has("binding:x" as TLRecord["id"])).toBe(false);
    stage.apply(frameAt(timeline, timeline.items[5].end + 1));
    expect(store.has("binding:x" as TLRecord["id"])).toBe(true);
  });

  it("follows a board that changed: new shapes put, changed ones put again, gone ones removed, the rest untouched", () => {
    const records = board();
    const { store, stage, timeline } = stageFor(records);
    stage.showAll();
    const untouched = store.get("shape:syn1" as TLRecord["id"]);
    const moved = { ...(records.find((r) => r.id === "shape:syn2") as TLRecord), x: 999 } as TLRecord;
    const fresh = { ...(records.find((r) => r.id === "shape:syn4") as TLRecord), id: "shape:fresh", index: "czzz", meta: { t: 9_999_999_999_999 } } as unknown as TLRecord;
    const next = [...records.filter((r) => r.id !== "shape:syn2" && r.id !== "shape:syn5").map((r) => ({ ...r }) as TLRecord), moved, fresh];
    const nextTl = buildTimeline(next);
    stage.setBoard(next, nextTl, frameAt(nextTl, nextTl.durationMs));
    expect(store.get("shape:syn1" as TLRecord["id"])).toBe(untouched);
    expect((store.get("shape:syn2" as TLRecord["id"]) as unknown as { x: number }).x).toBe(999);
    expect(store.has("shape:syn5" as TLRecord["id"])).toBe(false);
    expect(store.has("shape:fresh" as TLRecord["id"])).toBe(true);
    expect(shapeIds(store)).toHaveLength(nextTl.items.length);
    void timeline;
  });

  it("a part-drawn stroke is cut across its segments and never filled", () => {
    const rec = {
      id: "shape:p",
      typeName: "shape",
      type: "draw",
      props: { segments: [{ type: "free", points: [1, 2, 3] }, { type: "free", points: [4, 5, 6] }], isComplete: true, isClosed: true, fill: "solid" },
    } as unknown as TLRecord;
    const part = partialStroke(rec, 4) as unknown as { props: { segments: { points: number[] }[]; isComplete: boolean; isClosed: boolean; fill: string } };
    expect(part.props.segments.map((s) => s.points)).toEqual([[1, 2, 3], [4]]);
    expect(part.props).toMatchObject({ isComplete: false, isClosed: false, fill: "none" });
  });

  it("plays a 2,000-stroke board frame by frame cheaply (the store side; drawing is the browser's)", () => {
    const records = recordsOf(syntheticBoard({ strokes: 2_000, perPage: 500 }));
    const { stage, timeline } = stageFor(records);
    const step = (1000 / 60) * 16; // 16x, 60 frames a second
    let worst = 0;
    let total = 0;
    let frames = 0;
    for (let ms = 0; ms <= timeline.durationMs; ms += step) {
      const t0 = performance.now();
      stage.apply(frameAt(timeline, ms));
      const dt = performance.now() - t0;
      worst = Math.max(worst, dt);
      total += dt;
      frames++;
    }
    expect(stage.shownCount).toBe(timeline.items.length);
    // a frame's store work is a small fraction of a 16 ms frame
    expect(total / frames).toBeLessThan(2);
    // and a seek back to the start then to the end is one write each
    const before = stage.writes;
    stage.apply(frameAt(timeline, 0));
    stage.apply(frameAt(timeline, timeline.durationMs));
    expect(stage.writes).toBe(before + 2);
    void worst;
  });
});

function timeline0(records: TLRecord[]) {
  return buildTimeline(records);
}
