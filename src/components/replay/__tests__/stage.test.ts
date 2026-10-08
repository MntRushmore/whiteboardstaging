import { describe, expect, it } from "vitest";
import { createTLStore, defaultBindingUtils, defaultShapeUtils, loadSnapshot, type TLRecord, type TLStore } from "tldraw";
import { liveShapeUtils } from "@/shapes";
import { buildTimeline, frameAt, recordsOf } from "@/lib/replay/timeline";
import { syntheticBoard } from "@/lib/replay/synthetic";
import { partialStroke, ReplayStage } from "../stage";

/** The replay's store as the player sets it up: the board's document, pages and assets, then the stage mounted at `ms`. */
function stageFor(records: TLRecord[], ms = 0): { store: TLStore; stage: ReplayStage; timeline: ReturnType<typeof buildTimeline> } {
  const store = createTLStore({ shapeUtils: [...defaultShapeUtils, ...liveShapeUtils], bindingUtils: defaultBindingUtils });
  const base = Object.fromEntries(records.filter((r) => r.typeName !== "shape" && r.typeName !== "binding").map((r) => [r.id, r]));
  loadSnapshot(store, { store: base, schema: store.schema.serialize() } as Parameters<typeof loadSnapshot>[1]);
  const timeline = buildTimeline(records);
  const stage = new ReplayStage(store, records, timeline);
  stage.mount(frameAt(timeline, ms));
  return { store, stage, timeline };
}

const shapes = (store: TLStore) => store.allRecords().filter((r) => r.typeName === "shape") as unknown as { id: string; opacity: number; parentId: string }[];
/** what can be seen: shapes on the store at their own opacity */
const visible = (store: TLStore) =>
  shapes(store)
    .filter((s) => s.opacity > 0)
    .map((s) => s.id)
    .sort();
const get = (store: TLStore, id: string) => store.get(id as TLRecord["id"]) as unknown as { opacity: number; x: number; props: { isComplete: boolean; segments?: { points: unknown[] }[] } } | undefined;
const pointsOf = (rec: ReturnType<typeof get>) => (rec?.props.segments ?? []).reduce((n, s) => n + s.points.length, 0);

const board = () => recordsOf(syntheticBoard({ strokes: 40, perPage: 25 }));

describe("ReplayStage", () => {
  it("mounts every shape, the ones not drawn yet hidden", () => {
    const { store, timeline } = stageFor(board());
    expect(shapes(store)).toHaveLength(timeline.items.length);
    expect(visible(store)).toEqual([]);
  });

  it("plays forward: what has started shows, the stroke being drawn part drawn and not complete", () => {
    const { store, stage, timeline } = stageFor(board());
    const first = timeline.items[0];
    stage.apply(frameAt(timeline, first.start + (first.end - first.start) / 2));
    expect(visible(store)).toEqual([first.id]);
    const part = get(store, first.id);
    expect(part?.props.isComplete).toBe(false);
    expect(pointsOf(part)).toBeLessThan(first.points);

    stage.apply(frameAt(timeline, first.end + 1));
    const whole = get(store, first.id);
    expect(pointsOf(whole)).toBe(first.points);
    expect(whole?.props.isComplete).toBe(true);

    const mid = timeline.items[20];
    stage.apply(frameAt(timeline, mid.start + 1));
    expect(visible(store)).toEqual(timeline.items.slice(0, 21).map((i) => i.id).sort());
  });

  it("goes back: hides what starts after the new position, and touches nothing else", () => {
    const { store, stage, timeline } = stageFor(board());
    stage.apply(frameAt(timeline, timeline.durationMs));
    expect(visible(store)).toHaveLength(timeline.items.length);
    const kept = store.get(timeline.items[3].id as TLRecord["id"]);
    stage.apply(frameAt(timeline, timeline.items[10].start));
    expect(visible(store)).toEqual(timeline.items.slice(0, 10).map((i) => i.id).sort());
    expect(shapes(store)).toHaveLength(timeline.items.length);
    // untouched records are the very same objects (not put again)
    expect(store.get(timeline.items[3].id as TLRecord["id"])).toBe(kept);
    stage.apply(frameAt(timeline, 0));
    expect(visible(store)).toEqual([]);
  });

  it("writes once per frame, and not at all when nothing changed", () => {
    const { stage, timeline } = stageFor(board());
    stage.apply(frameAt(timeline, timeline.items[5].end + 1));
    const writes = stage.writes;
    stage.apply(frameAt(timeline, timeline.items[5].end + 2));
    expect(stage.writes).toBe(writes);
    stage.apply(frameAt(timeline, timeline.items[8].end + 1));
    expect(stage.writes).toBe(writes + 1);
  });

  it("shows the whole board, and none of it", () => {
    const { store, stage, timeline } = stageFor(board());
    stage.showAll();
    expect(visible(store)).toHaveLength(timeline.items.length);
    stage.clear();
    expect(visible(store)).toEqual([]);
  });

  it("never hides a group (it would hide what is inside), and its children come and go inside it", () => {
    const records = board();
    const pageId = buildTimeline(records).items[0].pageId;
    const group = { id: "shape:grp", typeName: "shape", type: "group", parentId: pageId, index: "c0zz", x: 0, y: 0, rotation: 0, opacity: 1, isLocked: false, meta: { t: 9_999_999_999_998 }, props: {} } as unknown as TLRecord;
    const child = { ...(records.find((r) => r.id === "shape:syn3") as TLRecord), parentId: "shape:grp" } as unknown as TLRecord;
    const { store, stage, timeline } = stageFor([...records.filter((r) => r.id !== "shape:syn3"), group, child]);
    expect(get(store, "shape:grp")?.opacity).toBe(1);
    expect(get(store, "shape:syn3")?.opacity).toBe(0);
    stage.apply(frameAt(timeline, timeline.durationMs));
    expect(get(store, "shape:syn3")?.opacity).toBe(1);
    stage.apply(frameAt(timeline, 0));
    expect(get(store, "shape:syn3")?.opacity).toBe(0);
    expect(get(store, "shape:grp")?.opacity).toBe(1);
    expect((store.get("shape:syn3" as TLRecord["id"]) as unknown as { parentId: string }).parentId).toBe("shape:grp");
  });

  it("puts the bindings between shapes once, with the shapes", () => {
    const records = board();
    const tl = buildTimeline(records);
    const [a, b] = [tl.items[0].id, tl.items[5].id];
    const binding = { id: "binding:x", typeName: "binding", type: "arrow", fromId: a, toId: b, meta: {}, props: { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false, snap: "none" } } as unknown as TLRecord;
    const { store, stage, timeline } = stageFor([...records, binding]);
    expect(store.has("binding:x" as TLRecord["id"])).toBe(true);
    stage.apply(frameAt(timeline, timeline.durationMs));
    stage.apply(frameAt(timeline, 0));
    expect(store.has("binding:x" as TLRecord["id"])).toBe(true);
  });

  it("follows a board that changed: new shapes put, changed ones put again, gone ones removed, the rest untouched", () => {
    const records = board();
    const { store, stage } = stageFor(records);
    stage.showAll();
    const untouched = store.get("shape:syn1" as TLRecord["id"]);
    const moved = { ...(records.find((r) => r.id === "shape:syn2") as TLRecord), x: 999 } as TLRecord;
    const fresh = { ...(records.find((r) => r.id === "shape:syn4") as TLRecord), id: "shape:fresh", index: "czzz", meta: { t: 9_999_999_999_999 } } as unknown as TLRecord;
    const next = [...records.filter((r) => r.id !== "shape:syn2" && r.id !== "shape:syn5").map((r) => ({ ...r }) as TLRecord), moved, fresh];
    const nextTl = buildTimeline(next);
    const writes = stage.writes;
    stage.setBoard(next, nextTl, frameAt(nextTl, nextTl.durationMs));
    expect(stage.writes).toBe(writes + 1);
    expect(store.get("shape:syn1" as TLRecord["id"])).toBe(untouched);
    expect(get(store, "shape:syn2")?.x).toBe(999);
    expect(store.has("shape:syn5" as TLRecord["id"])).toBe(false);
    expect(get(store, "shape:fresh")?.opacity).toBe(1);
    expect(visible(store)).toHaveLength(nextTl.items.length);
    // following while replaying: the new stroke is there, hidden, until its turn
    stage.setBoard(next, nextTl, frameAt(nextTl, 0));
    expect(get(store, "shape:fresh")?.opacity).toBe(0);
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
    let total = 0;
    let frames = 0;
    for (let ms = 0; ms <= timeline.durationMs; ms += step) {
      const t0 = performance.now();
      stage.apply(frameAt(timeline, ms));
      total += performance.now() - t0;
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
  });
});
