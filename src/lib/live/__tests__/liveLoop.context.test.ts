import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine as inkLine } from "../__fixtures__/strokes";
import { settleStable, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import {
  LIVE_TIMING,
  isLiveMeta,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeRequest,
  type RecognizeResponse,
} from "../contracts";
import { getEngine } from "../engine";
import { handBlockOf } from "../handwriting";
import { createLiveLoop, normalizeStep, unwrapBoxed, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * The board a student sent back: `x + y = 18`, `y = 9`, `x = ?`, then Solve. It came back
 * with a handwritten `y = 9` (their own line, copied), and two stacks of model steps side by
 * side. The engine can do this alone — substitute, then solve — so no model, one answer.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const INK = ["2x=8", "x=4", "4x=8", "1+2="];

describe("live loop — solving from the lines above", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let streamCalls: string[];
  let streamQueue: LiveSseEvent[][];
  let script: string[];
  let assigned: Map<string, string>;

  async function penLine(row: number, latex: string): Promise<string> {
    script.push(latex);
    const before = new Set(Object.keys(liveStore.lines.get()));
    editor.putUser(inkLine(INK[row], 100, 120 + row * 110, 40));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    await settleUntil(() => Object.entries(liveStore.lines.get()).some(([id, st]) => !before.has(id) && Boolean(st.latex)));
    return Object.keys(liveStore.lines.get()).find((id) => !before.has(id))!;
  }

  const tutor = (): TLShape[] => editor.store.allRecords().filter((r): r is TLShape => r.typeName === "shape" && isLiveMeta((r as TLShape).meta) && (r as TLShape).meta.source === "ai");
  const handBlocks = () => new Set(tutor().map((s) => handBlockOf(s.meta)).filter(Boolean)).size;
  const typesetSteps = () => tutor().filter((s) => s.type === "math").map((s) => (s.props as MathShapeProps).latex);
  const quiesce = () => settleStable(() => `${tutor().length}|${streamCalls.length}`);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    streamCalls = [];
    streamQueue = [];
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
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode: "answer", enabled: true, voiceActive: false },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (path: string): AsyncGenerator<LiveSseEvent, void, undefined> {
          streamCalls.push(path);
          for (const ev of streamQueue.shift() ?? []) yield ev;
        },
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => true,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
      },
    );
    loop.start();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  it("`x = ?` under `x + y = 18` and `y = 9`: one handwritten answer, no model", async () => {
    await penLine(0, "x+y=18");
    await penLine(1, "y=9");
    const ask = await penLine(2, "x=?");
    loop.requestSolve(ask);
    await quiesce();
    expect(streamCalls).toEqual([]);
    expect(handBlocks()).toBe(1);
    const meta = tutor()[0].meta as Record<string, unknown>;
    expect(meta.solvedLatex).toBe("x+9=18 ; x = 9");
  });

  it("pressing Solve again does not add a second answer", async () => {
    await penLine(0, "x+y=18");
    await penLine(1, "y=9");
    const ask = await penLine(2, "x=?");
    loop.requestSolve(ask);
    await quiesce();
    const shapes = tutor().length;
    loop.requestSolve(ask);
    await quiesce();
    expect(tutor().length).toBe(shapes);
    expect(handBlocks()).toBe(1);
  });

  it("Solve on `y = 9` itself solves for x instead of copying `y = 9`", async () => {
    await penLine(0, "x+y=18");
    const known = await penLine(1, "y=9");
    loop.requestSolve(known);
    await quiesce();
    expect(streamCalls).toEqual([]);
    expect((tutor()[0].meta as Record<string, unknown>).solvedLatex).toBe("x+9=18 ; x = 9");
  });

  it("Solve on an expression in x simplifies it by hand, as a chain of `=` lines, no model", async () => {
    const line = await penLine(0, "3(x+2)-x");
    loop.requestSolve(line);
    await quiesce();
    expect(streamCalls).toEqual([]);
    expect(handBlocks()).toBe(1);
    expect((tutor()[0].meta as Record<string, unknown>).solvedLatex).toBe("= 3x + 6 - x ; = 2x + 6");
    // pressed again: the same working is already on the page
    const shapes = tutor().length;
    loop.requestSolve(line);
    await quiesce();
    expect(tutor().length).toBe(shapes);
  });

  it("Solve on an inequality writes the steps by hand, no model", async () => {
    const line = await penLine(0, "-2x+1<7");
    loop.requestSolve(line);
    await quiesce();
    expect(streamCalls).toEqual([]);
    expect(handBlocks()).toBe(1);
    expect((tutor()[0].meta as Record<string, unknown>).solvedLatex).toBe("-2x+1<7");
  });

  it("the model's steps: no copy of the student's line, no repeated boxed answer, and a second solve replaces the first", async () => {
    // three unknowns in one line: nothing the engine can solve, so the model is asked
    const line = await penLine(0, "x+y+z=6");
    const step = (index: number, latex: string, final = false): LiveSseEvent => ({ event: "step", data: { index, latex, explanation: "", final } });
    streamQueue.push([step(1, "x + y + z = 6"), step(2, "z = 6 - x - y"), step(3, "\\boxed{z = 6 - x - y}", true)]);
    loop.requestSolve(line);
    await quiesce();
    expect(streamCalls).toHaveLength(1);
    expect(typesetSteps()).toEqual(["z = 6 - x - y"]);

    streamQueue.push([step(1, "x = 6 - y - z"), step(2, "\\boxed{x = 6 - y - z}", true)]);
    loop.requestSolve(line);
    await quiesce();
    expect(streamCalls).toHaveLength(2);
    expect(typesetSteps()).toEqual(["x = 6 - y - z"]);
  });
});

describe("step helpers", () => {
  it("unwraps a box and compares steps loosely", () => {
    expect(unwrapBoxed("\\boxed{x = 9}")).toBe("x = 9");
    expect(unwrapBoxed("x = 9")).toBe("x = 9");
    expect(normalizeStep("x + y = 18")).toBe(normalizeStep("x+y=18"));
    expect(normalizeStep("\\boxed{2 \\cdot x = 8}")).toBe(normalizeStep("2x=8"));
  });
});
