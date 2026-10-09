import { describe, expect, it } from "vitest";
import type { TLRecord } from "tldraw";
import { buildTimeline, firstOnPage, frameAt, realToReplay, recordsOf, replayToReal, REPLAY_PACE, STROKE_TIME } from "../timeline";
import { nthIndex, syntheticBoard } from "../synthetic";

// ------------------------------------------------------------------ tiny record builders

const T0 = Date.UTC(2026, 9, 6, 20, 0);

function page(id: string, index: string, name = id): TLRecord {
  return { id, typeName: "page", index, name, meta: {} } as unknown as TLRecord;
}

function pts(n: number) {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: i, z: 0.5 }));
}

let auto = 0;
function draw(opts: { id?: string; page?: string; index: string; n?: number; meta?: Record<string, unknown>; parentId?: string; segments?: number }): TLRecord {
  const n = opts.n ?? 10;
  const segs = opts.segments ?? 1;
  return {
    id: opts.id ?? `shape:s${auto++}`,
    typeName: "shape",
    type: "draw",
    parentId: opts.parentId ?? opts.page ?? "page:a",
    index: opts.index,
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    isLocked: false,
    meta: opts.meta ?? {},
    props: { segments: Array.from({ length: segs }, () => ({ type: "free", points: pts(n) })), isComplete: true },
  } as unknown as TLRecord;
}

function other(type: string, opts: { id: string; index: string; page?: string; meta?: Record<string, unknown>; parentId?: string }): TLRecord {
  return { id: opts.id, typeName: "shape", type, parentId: opts.parentId ?? opts.page ?? "page:a", index: opts.index, x: 0, y: 0, rotation: 0, opacity: 1, isLocked: false, meta: opts.meta ?? {}, props: { w: 10, h: 10 } } as unknown as TLRecord;
}

const tutor = (createdAt: number, extra: Record<string, unknown> = {}) => ({ live: true, source: "ai", lineId: "ln_1", createdAt, ...extra });
const timed = (t: number, t1?: number) => ({ [STROKE_TIME.start]: t, ...(t1 !== undefined ? { [STROKE_TIME.end]: t1 } : {}) });
const ids = (tl: { items: { id: string }[] }) => tl.items.map((i) => i.id);

// ------------------------------------------------------------------ recordsOf

describe("recordsOf", () => {
  const rec = draw({ id: "shape:x", index: "a1" });
  const pg = page("page:a", "a1");

  it("reads the board's editor snapshot, a bare store snapshot, or a plain record map", () => {
    expect(recordsOf({ document: { store: { [pg.id]: pg, [rec.id]: rec }, schema: {} }, session: {} })).toHaveLength(2);
    expect(recordsOf({ store: { [pg.id]: pg, [rec.id]: rec }, schema: {} })).toHaveLength(2);
    expect(recordsOf({ [pg.id]: pg, [rec.id]: rec })).toHaveLength(2);
  });

  it("is empty for anything else, and skips what is not a record", () => {
    expect(recordsOf(null)).toEqual([]);
    expect(recordsOf("board")).toEqual([]);
    expect(recordsOf({})).toEqual([]);
    expect(recordsOf({ document: { store: { a: 1, b: { id: "x" } } } })).toEqual([]);
    expect(recordsOf({ store: { [rec.id]: rec, junk: 3 } })).toEqual([rec]);
  });
});

// ------------------------------------------------------------------ order

describe("buildTimeline: order", () => {
  it("an empty board is an empty timeline", () => {
    const tl = buildTimeline([page("page:a", "a1")]);
    expect(tl).toMatchObject({ items: [], durationMs: 0, pages: [], timedShare: 0, realStart: null, realEnd: null, marks: [] });
    const f = frameAt(tl, 0);
    expect(f).toMatchObject({ upTo: 0, current: null, pageId: null, currentPoints: Infinity });
    expect(f.shown.size).toBe(0);
    expect(frameAt(buildTimeline([]), 500).upTo).toBe(0);
  });

  it("a timed board plays in real-time order, whatever the indices say", () => {
    const tl = buildTimeline([
      page("page:a", "a1"),
      draw({ id: "shape:late", index: "a1", meta: timed(T0 + 5_000, T0 + 5_400) }),
      draw({ id: "shape:early", index: "a2", meta: timed(T0, T0 + 300) }),
      draw({ id: "shape:mid", index: "a3", meta: timed(T0 + 1_000, T0 + 1_250) }),
    ]);
    expect(ids(tl)).toEqual(["shape:early", "shape:mid", "shape:late"]);
    expect(tl.timedShare).toBe(1);
    expect(tl.realStart).toBe(T0);
    expect(tl.realEnd).toBe(T0 + 5_400);
    expect(tl.items.every((i) => i.by === "student" && i.realAt !== null)).toBe(true);
  });

  it("an old board with no times plays page by page, then by index (plain code-unit order, not the locale's)", () => {
    const tl = buildTimeline([
      page("page:b", "a2"),
      page("page:a", "a1"),
      draw({ id: "shape:b1", page: "page:b", index: "a1" }),
      draw({ id: "shape:a2", page: "page:a", index: "aV" }),
      draw({ id: "shape:a3", page: "page:a", index: "aa" }),
      draw({ id: "shape:a1", page: "page:a", index: "a5" }),
    ]);
    // "aV" < "aa" in code units ("V" is 86, "a" 97), though a locale compare says otherwise
    expect(ids(tl)).toEqual(["shape:a1", "shape:a2", "shape:a3", "shape:b1"]);
    expect(tl.pages).toEqual(["page:a", "page:b"]);
    expect(tl.timedShare).toBe(0);
    expect(tl.realStart).toBeNull();
  });

  it("an old board's ink plays just before the tutor's answer that followed it in index order", () => {
    // the student wrote a line (untimed), the tutor echoed and ticked it (timed), the student wrote on
    const tl = buildTimeline([
      page("page:a", "a1"),
      draw({ id: "shape:s1", index: "a1" }),
      draw({ id: "shape:s2", index: "a2" }),
      other("math", { id: "shape:echo", index: "a3", meta: tutor(T0 + 10_000, { source: "echo" }) }),
      draw({ id: "shape:s3", index: "a4" }),
      draw({ id: "shape:tick", index: "a5", meta: tutor(T0 + 30_000, { mark: "check:1,1,1,1" }) }),
      draw({ id: "shape:s4", index: "a6" }),
    ]);
    expect(ids(tl)).toEqual(["shape:s1", "shape:s2", "shape:echo", "shape:s3", "shape:tick", "shape:s4"]);
    expect(tl.items.map((i) => i.by)).toEqual(["student", "student", "tutor", "student", "tutor", "student"]);
    expect(tl.items.map((i) => i.realAt)).toEqual([null, null, T0 + 10_000, null, T0 + 30_000, null]);
    expect(tl.timedShare).toBeCloseTo(2 / 6);
  });

  it("old untimed strokes come first, then the timed ones (a board continued after times were stamped)", () => {
    const tl = buildTimeline([
      page("page:a", "a1"),
      draw({ id: "shape:new1", index: "a3", meta: timed(T0 + 2_000, T0 + 2_200) }),
      draw({ id: "shape:old2", index: "a2" }),
      draw({ id: "shape:old1", index: "a1" }),
      draw({ id: "shape:new2", index: "a4", meta: timed(T0 + 4_000, T0 + 4_100) }),
    ]);
    expect(ids(tl)).toEqual(["shape:old1", "shape:old2", "shape:new1", "shape:new2"]);
  });

  it("the tutor's shapes are timed by createdAt (a block shares one: its strokes go in index order)", () => {
    const tl = buildTimeline([
      page("page:a", "a1"),
      draw({ id: "shape:b3", index: "a3", meta: tutor(T0) }),
      draw({ id: "shape:b1", index: "a1", meta: tutor(T0) }),
      draw({ id: "shape:b2", index: "a2", meta: tutor(T0) }),
      draw({ id: "shape:me", index: "a0", meta: timed(T0 - 4_000, T0 - 3_800) }),
    ]);
    expect(ids(tl)).toEqual(["shape:me", "shape:b1", "shape:b2", "shape:b3"]);
    const [, b1, b2, b3] = tl.items;
    expect(b2.start - b1.end).toBe(REPLAY_PACE.tutorGapMs);
    expect(b3.start - b2.end).toBe(REPLAY_PACE.tutorGapMs);
  });

  it("a timed stamp (t) wins over createdAt", () => {
    const tl = buildTimeline([
      page("page:a", "a1"),
      draw({ id: "shape:x", index: "a1", meta: { ...tutor(T0 + 9_000), ...timed(T0 + 1_000) } }),
      draw({ id: "shape:y", index: "a2", meta: timed(T0 + 5_000) }),
    ]);
    expect(ids(tl)).toEqual(["shape:x", "shape:y"]);
    expect(tl.items[0].realAt).toBe(T0 + 1_000);
  });

  it("an untimed stroke after the last timed one plays after it, not before", () => {
    const tl = buildTimeline([
      page("page:a", "a1"),
      draw({ id: "shape:t", index: "a1", meta: timed(T0) }),
      draw({ id: "shape:u", index: "a2" }),
      draw({ id: "shape:t0", index: "a0", meta: timed(T0 - 50_000) }),
    ]);
    expect(ids(tl)).toEqual(["shape:t0", "shape:t", "shape:u"]);
  });

  it("who: the student, the tutor (meta.live), something placed (an image)", () => {
    const tl = buildTimeline([
      page("page:a", "a1"),
      draw({ id: "shape:s", index: "a1" }),
      other("image", { id: "shape:img", index: "a2" }),
      other("text", { id: "shape:txt", index: "a3" }),
      other("math", { id: "shape:m", index: "a4", meta: tutor(T0) }),
    ]);
    expect(Object.fromEntries(tl.items.map((i) => [i.id, i.by]))).toEqual({ "shape:s": "student", "shape:img": "placed", "shape:txt": "student", "shape:m": "tutor" });
    expect(Object.fromEntries(tl.items.map((i) => [i.id, i.points]))).toEqual({ "shape:s": 10, "shape:img": 0, "shape:txt": 0, "shape:m": 0 });
  });

  it("a group's children are on the group's page, after it in board order", () => {
    const tl = buildTimeline([
      page("page:a", "a1"),
      page("page:b", "a2"),
      other("group", { id: "shape:g", index: "a1", page: "page:b" }),
      draw({ id: "shape:c2", index: "a2", parentId: "shape:g" }),
      draw({ id: "shape:c1", index: "a1", parentId: "shape:g" }),
      draw({ id: "shape:first", index: "a1", page: "page:a" }),
      draw({ id: "shape:orphan", index: "a1", parentId: "shape:missing" }),
    ]);
    expect(ids(tl)).toEqual(["shape:first", "shape:g", "shape:c1", "shape:c2"]);
    expect(tl.items.slice(1).every((i) => i.pageId === "page:b")).toBe(true);
  });

  it("pages are listed in the order they were first drawn on", () => {
    const tl = buildTimeline([
      page("page:a", "a1"),
      page("page:b", "a2"),
      page("page:c", "a3"),
      draw({ id: "shape:b", page: "page:b", index: "a1", meta: timed(T0) }),
      draw({ id: "shape:a", page: "page:a", index: "a1", meta: timed(T0 + 1_000) }),
      draw({ id: "shape:b2", page: "page:b", index: "a2", meta: timed(T0 + 2_000) }),
    ]);
    expect(tl.pages).toEqual(["page:b", "page:a"]);
  });

  it("accepts a stored board (not only its records)", () => {
    const board = syntheticBoard({ strokes: 20 });
    const tl = buildTimeline(board as unknown as TLRecord[]);
    expect(tl.items.filter((i) => i.by === "student")).toHaveLength(20);
  });
});

// ------------------------------------------------------------------ pace

describe("buildTimeline: pace", () => {
  it("a timed stroke takes as long as it took (within min and max), a long pause is squeezed", () => {
    const tl = buildTimeline([
      page("page:a", "a1"),
      draw({ id: "shape:1", index: "a1", meta: timed(T0, T0 + 400) }),
      draw({ id: "shape:2", index: "a2", meta: timed(T0 + 400 + 250, T0 + 650 + 30) }),
      draw({ id: "shape:3", index: "a3", meta: timed(T0 + 3_600_000, T0 + 3_600_000 + 60_000) }),
    ]);
    const [a, b, c] = tl.items;
    expect(a.start).toBe(REPLAY_PACE.leadMs);
    expect(a.end - a.start).toBe(400);
    expect(b.start - a.end).toBe(250);
    expect(b.end - b.start).toBe(REPLAY_PACE.minStrokeMs);
    expect(c.start - b.end).toBe(REPLAY_PACE.maxGapMs);
    expect(c.end - c.start).toBe(REPLAY_PACE.maxStrokeMs);
    expect(tl.durationMs).toBe(c.end + REPLAY_PACE.tailMs);
  });

  it("an untimed stroke is paced by its points, across its segments", () => {
    const tl = buildTimeline([page("page:a", "a1"), draw({ id: "shape:1", index: "a1", n: 30, segments: 2 }), draw({ id: "shape:2", index: "a2", n: 2 })]);
    const [a, b] = tl.items;
    expect(a.points).toBe(60);
    expect(a.end - a.start).toBe(60 * REPLAY_PACE.msPerPoint);
    expect(b.end - b.start).toBe(REPLAY_PACE.minStrokeMs);
    expect(b.start - a.end).toBe(REPLAY_PACE.untimedGapMs);
  });

  it("options override the pace", () => {
    const tl = buildTimeline([page("page:a", "a1"), draw({ id: "shape:1", index: "a1", n: 30 }), draw({ id: "shape:2", index: "a2", meta: timed(T0) }), draw({ id: "shape:3", index: "a3", meta: timed(T0 + 99_000) })], {
      msPerPoint: 2,
      minStrokeMs: 10,
      maxGapMs: 100,
    });
    expect(tl.items[0].end - tl.items[0].start).toBe(60);
    expect(tl.items[2].start - tl.items[1].end).toBe(100);
  });

  it("a move to another screen gets a pause long enough to see", () => {
    const tl = buildTimeline([
      page("page:a", "a1"),
      page("page:b", "a2"),
      draw({ id: "shape:a", page: "page:a", index: "a1", meta: timed(T0, T0 + 100) }),
      draw({ id: "shape:b", page: "page:b", index: "a1", meta: timed(T0 + 150, T0 + 300) }),
    ]);
    expect(tl.items[1].start - tl.items[0].end).toBe(REPLAY_PACE.pageTurnMs);
  });

  it("items never overlap", () => {
    const tl = buildTimeline(recordsOf(syntheticBoard({ strokes: 300, perPage: 120 })));
    for (let i = 1; i < tl.items.length; i++) expect(tl.items[i].start).toBeGreaterThanOrEqual(tl.items[i - 1].end);
    expect(tl.items[tl.items.length - 1].end).toBeLessThan(tl.durationMs);
  });
});

// ------------------------------------------------------------------ frames

describe("frameAt", () => {
  const tl = buildTimeline([
    page("page:a", "a1"),
    page("page:b", "a2"),
    draw({ id: "shape:1", page: "page:a", index: "a1", n: 10, meta: timed(T0, T0 + 1_000) }),
    other("math", { id: "shape:m", page: "page:a", index: "a2", meta: tutor(T0 + 1_500) }),
    draw({ id: "shape:2", page: "page:b", index: "a1", n: 4, meta: timed(T0 + 2_000, T0 + 2_400) }),
  ]);
  const [s1, m, s2] = tl.items;

  it("before anything: nothing shown, on the first page", () => {
    const f = frameAt(tl, 0);
    expect(f).toMatchObject({ upTo: 0, current: null, pageId: "page:a" });
    expect(frameAt(tl, -100).upTo).toBe(0);
    expect(frameAt(tl, s1.start).upTo).toBe(0);
  });

  it("mid-stroke: the stroke part drawn, at least two points", () => {
    const f = frameAt(tl, s1.start + 1);
    expect(f.upTo).toBe(1);
    expect(f.current?.id).toBe("shape:1");
    expect(f.currentPoints).toBe(2);
    const half = frameAt(tl, s1.start + 500);
    expect(half.currentPoints).toBe(5);
    expect([...half.shown]).toEqual([["shape:1", 5]]);
  });

  it("between items: what was drawn is whole, nothing current", () => {
    const f = frameAt(tl, (s1.end + m.start) / 2);
    expect(f).toMatchObject({ upTo: 1, current: null, currentPoints: Infinity });
    expect([...f.shown]).toEqual([["shape:1", Infinity]]);
  });

  it("a shape that is not a stroke appears whole the moment after it starts", () => {
    const f = frameAt(tl, m.start + 0.5);
    expect(f.upTo).toBe(2);
    expect(f.shown.get("shape:m")).toBe(Infinity);
    expect(f.current).toBeNull();
  });

  it("follows the page of the latest item", () => {
    expect(frameAt(tl, s2.start + 1).pageId).toBe("page:b");
    expect(frameAt(tl, m.start + 1).pageId).toBe("page:a");
  });

  it("at the end, everything is whole", () => {
    const f = frameAt(tl, tl.durationMs);
    expect(f.upTo).toBe(3);
    expect(f.current).toBeNull();
    expect([...f.shown.values()]).toEqual([Infinity, Infinity, Infinity]);
    expect(frameAt(tl, tl.durationMs * 10).upTo).toBe(3);
  });

  it("a frame's shown map is built once, when read", () => {
    const f = frameAt(tl, s2.start + 1);
    expect(f.shown).toBe(f.shown);
  });
});

// ------------------------------------------------------------------ marks and real time

describe("marks and real time", () => {
  it("one marker per line and mark, the first stroke's start", () => {
    const tl = buildTimeline([
      page("page:a", "a1"),
      draw({ id: "shape:q1", index: "a1", meta: tutor(T0, { mark: "question:1,1,1,1", lineId: "ln_q" }) }),
      draw({ id: "shape:q2", index: "a2", meta: tutor(T0, { mark: "question:1,1,1,1", lineId: "ln_q" }) }),
      draw({ id: "shape:c", index: "a3", meta: tutor(T0 + 1_000, { mark: "check:2,2,2,2", lineId: "ln_c" }) }),
      draw({ id: "shape:r", index: "a4", meta: tutor(T0 + 2_000, { mark: "circle:3,3,3,3", lineId: "ln_r" }) }),
      // a student's stroke with a mark-like meta is not the tutor's mark
      draw({ id: "shape:fake", index: "a5", meta: { mark: "check:1,1,1,1" } }),
    ]);
    expect(tl.marks.map((m) => [m.kind, m.lineId, m.id])).toEqual([
      ["question", "ln_q", "shape:q1"],
      ["check", "ln_c", "shape:c"],
      ["circle", "ln_r", "shape:r"],
    ]);
    expect(tl.marks[1].at).toBe(tl.items[2].start);
    expect(tl.items.map((i) => i.mark)).toEqual(["question", "question", "check", "circle", null]);
  });

  it("maps real times to the replay's clock and back", () => {
    const tl = buildTimeline([
      page("page:a", "a1"),
      draw({ id: "shape:u", index: "a0" }),
      draw({ id: "shape:1", index: "a1", meta: timed(T0, T0 + 500) }),
      draw({ id: "shape:2", index: "a2", meta: timed(T0 + 60_000, T0 + 60_500) }),
    ]);
    const [, a, b] = tl.items;
    expect(realToReplay(tl, T0 - 10_000)).toBe(0);
    expect(realToReplay(tl, T0 + 30_000)).toBe(a.end);
    expect(realToReplay(tl, T0 + 60_000)).toBe(b.end);
    expect(realToReplay(tl, T0 + 3_600_000)).toBe(tl.durationMs);
    expect(replayToReal(tl, 0)).toBeNull();
    expect(replayToReal(tl, a.start + 1)).toBe(T0);
    expect(replayToReal(tl, b.start + 1)).toBe(T0 + 60_000);
    expect(realToReplay(buildTimeline([page("page:a", "a1"), draw({ index: "a1" })]), T0)).toBeNull();
    expect(firstOnPage(tl, "page:a")).toBe(tl.items[0].start);
    expect(firstOnPage(tl, "page:none")).toBeNull();
  });
});

// ------------------------------------------------------------------ a big board

describe("a big board", () => {
  it("builds a 5,000-stroke timeline fast, and a frame is a binary search", () => {
    const records = recordsOf(syntheticBoard({ strokes: 5_000, perPage: 600 }));
    const t0 = performance.now();
    const tl = buildTimeline(records);
    const built = performance.now() - t0;
    expect(tl.items.length).toBeGreaterThan(5_000);
    expect(built).toBeLessThan(400);

    const t1 = performance.now();
    let sum = 0;
    for (let i = 0; i < 100_000; i++) sum += frameAt(tl, (i / 100_000) * tl.durationMs).upTo;
    const framed = performance.now() - t1;
    expect(sum).toBeGreaterThan(0);
    // 100k frames: well under a microsecond each (the player asks once per animation frame)
    expect(framed).toBeLessThan(400);
  });

  it("an untimed copy of the same board keeps the student's order", () => {
    const timedTl = buildTimeline(recordsOf(syntheticBoard({ strokes: 400, perPage: 150 })));
    const untimedTl = buildTimeline(recordsOf(syntheticBoard({ strokes: 400, perPage: 150, timed: false })));
    const student = (tl: typeof timedTl) => tl.items.filter((i) => i.by === "student").map((i) => i.id);
    expect(student(untimedTl)).toEqual(student(timedTl));
    // and the tutor's answers still follow the lines they answered
    expect(ids(untimedTl)).toEqual(ids(timedTl));
  });

  it("nthIndex keys sort in order", () => {
    const keys = Array.from({ length: 5_000 }, (_, i) => nthIndex(i));
    expect([...keys].sort()).toEqual(keys);
  });
});
