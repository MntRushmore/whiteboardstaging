import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { DEVICE_ZOOMS, writeLine } from "../__fixtures__/strokes";
import { settle, settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { LIVE_TIMING, isLiveMeta, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse, type Rect } from "../contracts";
import { getEngine } from "../engine";
import { handLinesOf, handSeedFor, handSizeFor, planHandwriting } from "../handwriting";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { PLACEMENT, rectsIntersect } from "../placement";
import { unionRects } from "../strokeClusters";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";

/**
 * The tutor's hand at the board's fit zoom (seen in a real WebKit iPhone run, zoom 0.224): a board
 * is a 1600 x 900 screen fitted to the window, so a student writing 50 px tall on a phone writes 250
 * page px — and the tutor, bounded at a desktop's 40, answered `x = 2` about 7 px tall beside it.
 * Now the tutor writes as it does on a desktop beside writing that looks the same on screen: its
 * steps sized from the student's line, its answer in their line at their glyph height, never under
 * 14 px on screen, set off from their ink by gaps that grow with it. A desktop is unchanged.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

describe("live loop — the tutor's hand at the board's zoom", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let script: string[];
  let assigned: Map<string, string>;

  /** A board shown at `zoom` (undefined: an editor with no camera, as every other test file). */
  function start(zoom: number | undefined): void {
    loop?.stop();
    resetLiveStore();
    editor = createFakeEditor();
    const page = editor.getCurrentPage();
    editor.store.put([{ ...page, meta: { screen: { ...DEFAULT_SCREEN } } }]);
    if (zoom !== undefined) editor.getBaseZoom = () => zoom;
    loop = createLiveLoop(
      editor,
      // Auto off: what is written is what Solve it writes, when asked
      { boardId: "board-1", mode: "answer", enabled: true, auto: false },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {},
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
      },
    );
    loop.start();
  }

  /** The student writes `ink` looking 40 px tall on screen at this zoom, read as `latex`. */
  async function pen(ink: string, x: number, y: number, latex: string, zoom = 1): Promise<string> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(writeLine(ink, x, y, 40 / zoom, 12 / zoom));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.analysis)));
    return Object.keys(liveStore.lines.get()).find((id) => !before.has(id))!;
  }

  async function solve(): Promise<void> {
    loop.noteAsked();
    loop.requestSolve();
    await settle();
    await vi.advanceTimersByTimeAsync(5_000);
    await settleStable(() => String(editor.getCurrentPageShapes().length));
  }

  const boundsOf = (s: TLShape): Rect => {
    const b = editor.getShapePageBounds(s)!;
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  };
  /** the tutor's writing (not its marks), as written lines: each line's strokes share its origin */
  const tutorLines = (): TLShape[][] => {
    const by = new Map<string, TLShape[]>();
    for (const s of editor.getCurrentPageShapes()) {
      const meta = s.meta as Record<string, unknown>;
      if (s.type !== "draw" || !isLiveMeta(s.meta) || meta.mark) continue;
      const key = `${s.x},${s.y}`;
      by.set(key, [...(by.get(key) ?? []), s]);
    }
    return [...by.values()].sort((a, b) => a[0].y - b[0].y);
  };
  const studentInk = () => editor.getCurrentPageShapes().filter((s) => s.type === "draw" && !isLiveMeta(s.meta));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    script = [];
    assigned = new Map();
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      const { lineId } = body as RecognizeRequest;
      let latex = assigned.get(lineId);
      if (latex === undefined) {
        latex = script[assigned.size] ?? "\\Delta";
        assigned.set(lineId, latex);
      }
      return { latex, text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };
    });
  });

  afterEach(() => {
    loop?.stop();
    vi.useRealTimers();
  });

  describe.each(DEVICE_ZOOMS)("on %s (zoom %s)", (_device, zoom) => {
    it("Solve it writes its steps the size the student writes, as on a desktop — readable, and clear of their ink", async () => {
      start(zoom);
      const line = await pen("2x=8", 100, 60, "2x+3=11", zoom);
      await solve();
      const lines = tutorLines();
      expect(lines.map((l) => handLinesOf(l)[0])).toEqual(["2x = 8", "x = 4"]);

      // the digits of `2x = 8`: as tall beside the student's line as a desktop's are beside theirs
      // (the hand is the line's height there: a digit is `digitRatio` of it), and readable on screen
      const studentH = liveStore.lines.get()[line].line.bounds.h;
      const digitH = unionRects(lines[0].map(boundsOf)).h;
      expect(digitH / studentH).toBeGreaterThan(0.5);
      expect(digitH / studentH).toBeLessThan(0.75);
      expect(digitH * zoom).toBeGreaterThanOrEqual(14);

      // under the work, set off from it as on a desktop (the gap grows with the hand), on nothing
      const ink = studentInk().map(boundsOf);
      const inkBottom = Math.max(...ink.map((r) => r.y + r.h));
      const block = unionRects(lines.flat().map(boundsOf));
      expect(block.y - inkBottom).toBeGreaterThanOrEqual((PLACEMENT.stepGap / zoom) * 0.99);
      for (const r of lines.flat().map(boundsOf)) for (const i of ink) expect(rectsIntersect(r, i)).toBe(false);
      // the second line under the first, not on it
      expect(unionRects(lines[1].map(boundsOf)).y).toBeGreaterThan(unionRects(lines[0].map(boundsOf)).y + digitH);
    });

    it("an answer after the student's `=` is their own glyph height", async () => {
      start(zoom);
      const line = await pen("3+4=", 100, 60, "3+4=", zoom);
      await solve();
      const lines = tutorLines();
      expect(lines.map((l) => handLinesOf(l)[0])).toEqual(["7"]);
      const studentH = liveStore.lines.get()[line].line.bounds.h;
      const answer = unionRects(lines[0].map(boundsOf));
      expect(answer.h / studentH).toBeGreaterThan(0.85);
      expect(answer.h / studentH).toBeLessThan(1.15);
      for (const i of studentInk().map(boundsOf)) expect(rectsIntersect(answer, i)).toBe(false);
    });
  });

  it("a desktop board (zoom 1) is written exactly as before: the desktop hand, the desktop gap", async () => {
    start(1);
    const line = await pen("2x=8", 100, 60, "2x+3=11");
    await solve();
    const st = liveStore.lines.get()[line];
    // the plan a desktop wrote before boards knew their zoom: sized from the line, seeded from its id
    const plan = planHandwriting(["2x = 8", "x = 4"], { size: handSizeFor(st.line.bounds.h), seed: handSeedFor(line) }).plan!;
    const block = unionRects(tutorLines().flat().map(boundsOf));
    expect(block.w).toBeCloseTo(plan.bounds.w, 1);
    expect(block.h).toBeCloseTo(plan.bounds.h, 1);
    expect(block.y - (st.line.bounds.y + st.line.bounds.h)).toBeCloseTo(PLACEMENT.stepGap, 1);
    expect(block.x).toBeCloseTo(st.line.bounds.x, 1);
  });
});
