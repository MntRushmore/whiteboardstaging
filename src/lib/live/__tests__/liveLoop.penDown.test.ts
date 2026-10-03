import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape, TLShape } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { drawShapeFromPoints, writeLine } from "../__fixtures__/strokes";
import { LIVE_TIMING, type CapabilitiesResponse, type LineAnalysis, type LiveEngine, type LiveSseEvent, type RecognizeRequest, type RecognizeResponse } from "../contracts";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { settle } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";

/**
 * "Never render while the pen is down" (LIVE-MATH-SPEC). The quiet gate used to start at a pen-up
 * and run out 600 ms later whatever the pen was doing — so a student who took 300 ms to start the
 * next stroke and 400 ms to draw it had the line read WITHOUT that stroke, mid-stroke: `2x = 8`
 * read as `2x = 0` from the first half of its 8 and ringed, then re-read and ticked. Every slow
 * writer paid an extra read per line and saw marks flip as they wrote.
 */

const engine: LiveEngine = {
  analyzeLine: (latex): LineAnalysis => ({ kind: "equation", math: latex, resultLatex: "", verdict: "unknown", note: "" }),
  compileExpr: () => () => 0,
  solveLatex: () => null,
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};
const CAPS: CapabilitiesResponse = { recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } };

describe("live loop — the quiet gate waits while the pen is down", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let sent: RecognizeRequest[];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    sent = [];
    fetchJson = vi.fn<FetchJson>(async (_path, body): Promise<RecognizeResponse> => {
      sent.push(body as RecognizeRequest);
      return { latex: "2x=8", text: "2x=8", kind: "math", confidence: 0.97, provider: "mathpix", ms: 100 };
    });
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode: "feedback", enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {},
        getEngine: async () => engine,
        fetchCapabilities: async () => CAPS,
        events: null,
        isOnline: () => true,
      },
    );
    loop.start();
    await settle(2);
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  /** The draw tool: the shape appears at pen-down (incomplete), grows, and completes at pen-up. */
  function penDown(stroke: TLDrawShape): void {
    editor.putUser([{ ...stroke, props: { ...stroke.props, isComplete: false } } as TLShape]);
  }
  function penUp(stroke: TLDrawShape): void {
    editor.updateUser(stroke.id, (s) => ({ ...s, props: { ...s.props, isComplete: true } }) as TLShape);
  }

  it("a stroke started before the gate ran out is read with the line, once", async () => {
    const [first, ...rest] = writeLine("2x=8", 100, 100);
    const last = rest.pop()!;
    editor.putUser([first, ...rest]);
    // 300 ms later the next stroke starts and takes 500 ms: the gate would have run out mid-stroke
    await vi.advanceTimersByTimeAsync(300);
    penDown(last);
    await vi.advanceTimersByTimeAsync(500);
    await settle();
    expect(fetchJson).not.toHaveBeenCalled();
    penUp(last);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    // the read had every stroke of the line, the one finished last included
    expect(sent[0].strokes.x).toHaveLength(rest.length + 2);
  });

  it("a stroke the student abandons (the pointer is cancelled) does not stall the line", async () => {
    const ink = writeLine("2x=8", 100, 100);
    editor.putUser(ink);
    await vi.advanceTimersByTimeAsync(300);
    const stray = drawShapeFromPoints([
      { x: 400, y: 400 },
      { x: 420, y: 430 },
    ]);
    penDown(stray);
    editor.removeUser([stray.id]);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 1);
    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("with the pen up, the gate runs as before: 600 ms after the last pen-up", async () => {
    editor.putUser(writeLine("2x=8", 100, 100));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs - 50);
    await settle();
    expect(fetchJson).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    await settle();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});
