import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TLPage, TLPageId, TLShape, TLShapePartial } from "tldraw";
import type { Stroke } from "@/lib/hand";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import { createFakeEditor, type FakeEditor } from "../../__fixtures__/fakeEditor";
import { useSyncHash } from "../../__fixtures__/syncHash";
import { isLiveMeta, type HelpMode, type LiveEngine, type LiveSseEvent } from "../../contracts";
import { getEngine } from "../../engine";
import type { HandPlan } from "../../handwriting";
import { createLiveLoop, LECTURE_META_FLUSH_MS, type LiveLoop, type LiveLoopDeps } from "../../liveLoop";
import { liveStore, resetLiveStore } from "../../liveStore";
import { RecognizeClient } from "../../recognizeClient";
import { LECTURE_BLOCK_META, LECTURE_ID_META, LECTURE_PAGE_META, LECTURE_WHAT_META, type ChartSpec, type LectureAction, type LecturePageMeta, type LectureRunReport } from "../contracts";
import { HAND_PART_META } from "../../handwriting";
import type { LecturePlanners } from "../desk";
import { LECTURE_BOXES } from "../plan";

/**
 * Lecture mode in the live loop, on a headless tldraw store: the director's actions written by the
 * tutor's hand whatever the Live switch and the help mode say; the screen's lecture meta saved on
 * its page record outside the undo history (heard text in batches); lecture blocks outside the
 * live shape cap and kept by "Clear marks"; a block cut short by a screen switch finished on the
 * screen it was started on.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

/** `lines` rows of a w × h box each, one after the other: a multi-line block, slow enough to be cut short. */
function rowsPlan(w: number, h: number, lines: number, label: string): HandPlan {
  const seg = (a: [number, number], b: [number, number], order: number): Stroke => ({ points: [a, b].map(([x, y]) => ({ x, y, z: 0.5 })), order, kind: "rule" }) as Stroke;
  const out: HandPlan["lines"] = [];
  for (let i = 0; i < lines; i++) {
    const strokes = [seg([0, 0], [w, 0], 0), seg([w, 0], [w, h], 1), seg([w, h], [0, h], 2), seg([0, h], [0, 0], 3)];
    out.push({ latex: `${label} ${i}`, x: 0, y: i * (h + 8), strokes, baseline: h, startMs: i * 1000, durationMs: 800 });
  }
  return { lines: out, bounds: { x: 0, y: 0, w, h: lines * (h + 8) - 8 }, size: 30, totalMs: lines * 1000 - 200 };
}

/** A bar chart with named parts: the axes, and per category its bar (10 px a unit, in its own slot). */
function partsChart(spec: ChartSpec, { box }: { box: { w: number; h: number } }): HandPlan | null {
  if (spec.kind !== "bar") return rowsPlan(box.w, box.h, 1, "chart");
  const base = box.h - 40;
  const lines: HandPlan["lines"] = [{ ...rowsPlan(box.w - 20, base, 1, "axis").lines[0], part: "axis" }];
  spec.series[0].values.forEach((v, i) => {
    if (v === null) return;
    const bar = rowsPlan(40, v * 10, 1, `bar ${i}`).lines[0];
    lines.push({ ...bar, x: 40 + i * 60, y: base - v * 10, startMs: 1000 * (i + 1), part: `bar:${spec.labels[i]}` });
  });
  return { lines, bounds: { x: 0, y: 0, w: box.w - 20, h: base }, size: 30, totalMs: 1000 * (lines.length + 1), pace: 2 };
}

const planners: LecturePlanners = {
  boxes: LECTURE_BOXES,
  heading: (text, { maxW }) => rowsPlan(Math.min(text.length * 20, maxW), 44, 1, text),
  note: (text, { maxW }) => rowsPlan(Math.min(text.length * 12, maxW), 32, 3, text),
  chart: (spec, opts) => partsChart(spec, opts),
  diagram: (_s, { box }) => rowsPlan(box.w, box.h, 1, "diagram"),
};

const sales = (values: Array<number | null>): ChartSpec => ({ kind: "bar", title: "Sales", labels: ["Q1", "Q2", "Q3"].slice(0, values.length), series: [{ values }] });

describe("live loop — lecture mode", () => {
  useSyncHash();

  let editor: FakeEditor;
  let loop: LiveLoop;

  function start(mode: HelpMode = "feedback", enabled = true, deps: Partial<LiveLoopDeps> = {}): void {
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled },
      {
        recognizer: new RecognizeClient({ fetchJson: async () => ({ latex: "x", text: "", kind: "math", confidence: 0.9, provider: "mathpix", ms: 1 }) }),
        stream: async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {},
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
        lecturePlanners: planners,
        ...deps,
      },
    );
    loop.start();
  }

  async function run(actions: LectureAction[]): Promise<LectureRunReport> {
    let result: LectureRunReport | null = null;
    let error: unknown = null;
    loop.runLectureActions(actions).then(
      (r) => (result = r),
      (e) => (error = e),
    );
    for (let i = 0; i < 400 && !result && !error; i++) await vi.advanceTimersByTimeAsync(50);
    if (error) throw error;
    if (!result) throw new Error("the lecture never finished");
    return result;
  }

  const page = (): TLPage => editor.getCurrentPage();
  const lectureMeta = (p: TLPage = page()): LecturePageMeta | undefined => (p.meta as Record<string, unknown>)[LECTURE_PAGE_META] as LecturePageMeta | undefined;
  const lectureShapes = (): TLShape[] => editor.getCurrentPageShapes().filter((s) => isLiveMeta(s.meta) && (s.meta as Record<string, unknown>)[LECTURE_BLOCK_META]);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    const p = editor.getCurrentPage();
    editor.store.put([{ ...p, meta: { screen: { ...DEFAULT_SCREEN } } }]);
  });

  afterEach(() => {
    loop?.stop();
    vi.useRealTimers();
  });

  it.each([
    ["Live on, Feedback", "feedback", true],
    ["help mode Off", "off", true],
    ["the Live switch off", "answer", false],
  ] as const)("sketches in every help mode (%s)", async (_name, mode, enabled) => {
    start(mode, enabled);
    const report = await run([
      { type: "heading", text: "Cells" },
      { type: "note", text: "Mitochondria make ATP" },
    ]);
    expect(report.outcomes.map((o) => o.ok)).toEqual([true, true]);
    const kinds = new Set(lectureShapes().map((s) => (s.meta as Record<string, unknown>)[LECTURE_BLOCK_META]));
    expect([...kinds].sort()).toEqual(["heading", "note"]);
    expect(loop.lectureScreen()).toMatchObject({ empty: false, topic: "Cells", drawn: ["heading: Cells", "note: Mitochondria make ATP"] });
  });

  it("the topic goes on the page record at once, outside the undo history", async () => {
    start();
    const userChanges: string[] = [];
    const stop = editor.store.listen((e) => userChanges.push(...Object.keys(e.changes.updated)), { source: "user", scope: "document" });
    await run([{ type: "heading", text: "Photosynthesis" }]);
    stop();
    expect(lectureMeta()).toEqual({ topic: "Photosynthesis" });
    expect(userChanges.filter((id) => id.startsWith("page:"))).toEqual([]);
  });

  it("heard text is read back at once, written to the page in a batch, and flushed when the loop stops", async () => {
    start();
    loop.saveLectureTranscript("Light is absorbed by chlorophyll.");
    loop.saveLectureTranscript("Then water is split.");
    // not on the record yet, but already the screen's
    expect(lectureMeta()).toBeUndefined();
    expect(loop.chatScreen().lecture).toBe("Light is absorbed by chlorophyll. Then water is split.");
    await vi.advanceTimersByTimeAsync(LECTURE_META_FLUSH_MS + 10);
    expect(lectureMeta()).toEqual({ transcript: "Light is absorbed by chlorophyll. Then water is split." });
    loop.saveLectureTranscript("Oxygen is released.");
    loop.stop();
    expect(lectureMeta()?.transcript).toBe("Light is absorbed by chlorophyll. Then water is split. Oxygen is released.");
  });

  it("heard text stays with the screen it was heard on", async () => {
    start();
    loop.saveLectureTranscript("on the first screen");
    const first = page().id;
    const second = editor.addPage({ screen: { ...DEFAULT_SCREEN } });
    editor.switchPage(second);
    loop.saveLectureTranscript("on the second");
    await vi.advanceTimersByTimeAsync(LECTURE_META_FLUSH_MS + 10);
    expect(lectureMeta(editor.store.get(first) as TLPage)?.transcript).toBe("on the first screen");
    expect(lectureMeta(editor.store.get(second as TLPageId) as TLPage)?.transcript).toBe("on the second");
  });

  it("the board chat sees the lecture's transcript, not its words as tutor lines", async () => {
    start();
    await run([{ type: "heading", text: "Cells" }, { type: "note", text: "Mitochondria make ATP" }]);
    loop.saveLectureTranscript("the powerhouse of the cell");
    const screen = loop.chatScreen();
    expect(screen.tutor).toEqual([]);
    expect(screen.lecture).toBe("the powerhouse of the cell");
    expect(screen.empty).toBe(false);
  });

  it("lecture blocks do not count against the live shape cap; a chat block counts as one", async () => {
    start();
    await run([{ type: "heading", text: "Cells" }, { type: "note", text: "one" }, { type: "note", text: "two" }]);
    expect(lectureShapes().length).toBeGreaterThan(10);
    expect(liveStore.liveShapeCount.get()).toBe(0);
    let done = false;
    void loop.runChatActions([{ type: "write_lines", lines: ["E = mc^{2}"] }]).then(() => (done = true));
    for (let i = 0; i < 200 && !done; i++) await vi.advanceTimersByTimeAsync(50);
    expect(done).toBe(true);
    expect(liveStore.liveShapeCount.get()).toBe(1);
    expect(loop.lectureScreen().drawn).toContain("formula: E = mc^{2}");
  });

  it("Clear marks keeps the lecture's notes (it is not undoable) and clears the rest of the tutor's ink", async () => {
    start();
    await run([{ type: "heading", text: "Cells" }]);
    let done = false;
    void loop.runChatActions([{ type: "write_lines", lines: ["E = mc^{2}"] }]).then(() => (done = true));
    for (let i = 0; i < 200 && !done; i++) await vi.advanceTimersByTimeAsync(50);
    const before = lectureShapes().length;
    loop.clearMarks();
    await vi.advanceTimersByTimeAsync(10);
    expect(lectureShapes().length).toBe(before);
    const other = editor.getCurrentPageShapes().filter((s) => isLiveMeta(s.meta) && s.meta.source === "ai" && !(s.meta as Record<string, unknown>)[LECTURE_BLOCK_META]);
    expect(other).toEqual([]);
  });

  it("a note's summary is on its first stroke only (the rest of its ~70 strokes do not repeat it)", async () => {
    start();
    await run([{ type: "note", text: "Mitochondria make ATP" }]);
    const withWhat = lectureShapes().filter((s) => (s.meta as Record<string, unknown>)[LECTURE_WHAT_META]);
    expect(lectureShapes().length).toBe(12);
    expect(withWhat).toHaveLength(1);
    expect((withWhat[0].meta as Record<string, unknown>)[LECTURE_WHAT_META]).toBe("note: Mitochondria make ATP");
  });

  it("LIVE: a chart's spec is on its page at once; an update rubs out only the changed bar, outside the undo history", async () => {
    start();
    const userChanges: string[] = [];
    const stop = editor.store.listen((e) => userChanges.push(...Object.keys(e.changes.added), ...Object.keys(e.changes.removed), ...Object.keys(e.changes.updated)), { source: "user", scope: "document" });
    const t0 = Date.now();
    const first = await run([{ type: "chart", chart: sales([12, 15]) }]);
    const id = first.outcomes[0].id!;
    expect(Date.now() - t0).toBeLessThan(LECTURE_META_FLUSH_MS);
    expect(lectureMeta()?.visuals?.[id]).toMatchObject({ chart: sales([12, 15]), box: LECTURE_BOXES.visual[0] });
    const partsOf = () =>
      lectureShapes()
        .filter((s) => (s.meta as Record<string, unknown>)[LECTURE_ID_META] === id)
        .map((s) => ({ id: s.id, part: String((s.meta as Record<string, unknown>)[HAND_PART_META]) }));
    const before = partsOf();
    const q2 = before.filter((p) => p.part === "bar:Q2").map((p) => p.id);
    expect(q2.length).toBeGreaterThan(0);
    const second = await run([{ type: "update_chart", target: id, chart: sales([12, 18]) }]);
    stop();
    expect(second.outcomes).toEqual([{ type: "update_chart", ok: true, id, what: "bar chart: Sales" }]);
    const after = partsOf();
    // Q1 and the axes are the very same strokes; Q2's are new ones
    expect(after.filter((p) => p.part !== "bar:Q2").map((p) => p.id).sort()).toEqual(before.filter((p) => p.part !== "bar:Q2").map((p) => p.id).sort());
    expect(after.filter((p) => p.part === "bar:Q2").some((p) => q2.includes(p.id))).toBe(false);
    expect(after.filter((p) => p.part === "bar:Q2")).toHaveLength(q2.length);
    expect(lectureMeta()?.visuals?.[id]?.chart).toEqual(sales([12, 18]));
    expect(loop.lectureScreen().active).toEqual([{ id, chart: sales([12, 18]) }]);
    expect(userChanges).toEqual([]);
    expect(liveStore.liveShapeCount.get()).toBe(0);
  });

  it("a block cut short by a screen switch is finished whole on the screen it was started on", async () => {
    start("feedback", true, { reducedMotion: () => false });
    // the fake editor puts every shape on the current page; tldraw honours a given parentId
    const create = editor.createShapes.bind(editor);
    editor.createShapes = (partials: TLShapePartial[]) => {
      create(partials);
      const moved = partials.filter((p) => p.parentId).map((p) => ({ ...(editor.store.get(p.id) as TLShape), parentId: p.parentId! }));
      if (moved.length) editor.store.put(moved);
    };
    const first = page().id;
    const second = editor.addPage({ screen: { ...DEFAULT_SCREEN } });
    let result: LectureRunReport | null = null;
    void loop.runLectureActions([{ type: "note", text: "three rows of it" }]).then((r) => (result = r));
    // the first of its three rows is being written
    await vi.advanceTimersByTimeAsync(400);
    const partway = editor.store.allRecords().filter((r) => r.typeName === "shape").length;
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(12);
    editor.switchPage(second);
    for (let i = 0; i < 100 && !result; i++) await vi.advanceTimersByTimeAsync(50);
    expect(result).not.toBeNull();
    const strokes = editor.store.allRecords().filter((r): r is TLShape => r.typeName === "shape" && isLiveMeta((r as TLShape).meta));
    expect(strokes).toHaveLength(12);
    expect(new Set(strokes.map((s) => s.parentId))).toEqual(new Set([first]));
  });
});
