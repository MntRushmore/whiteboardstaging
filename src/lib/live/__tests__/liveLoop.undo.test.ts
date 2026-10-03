import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape, TLShape, TLShapeId } from "tldraw";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { fixtureSingleLine, writeLine } from "../__fixtures__/strokes";
import {
  LIVE_TIMING,
  type CapabilitiesResponse,
  type LineAnalysis,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeResponse,
} from "../contracts";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { settle } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";

/**
 * The student rubs a line out (or selects everything and deletes it) and then presses Undo. The
 * tutor's readback of that line (its hidden echo) was deleted with the ink by the same user action,
 * so Undo brings it back as well — under the line id of a line Live has since dropped. Live used to
 * write a second echo for the restored ink beside it: two (then, after another delete and undo,
 * three) echoes on one line, shown typeset beside the ink whenever it was selected, and on the next
 * screen switch rebuilt into a second "line" that ticked the student's problem statement and cheered.
 */

const engine: LiveEngine = {
  analyzeLine: (latex): LineAnalysis => ({ kind: "equation", math: latex, resultLatex: "", verdict: latex === "x=4" ? "ok" : "unknown", note: "" }),
  compileExpr: () => () => 0,
  solveLatex: () => null,
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};

const CAPS: CapabilitiesResponse = { recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } };
const QUIET = LIVE_TIMING.rewriteQuietMs + LIVE_TIMING.quietMs + 1;

function ok(latex: string): RecognizeResponse {
  return { latex, text: latex, kind: "math", confidence: 0.97, provider: "mathpix", ms: 120 };
}

describe("live loop — undo brings the ink back, not a second readback", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;

  function makeLoop(): LiveLoop {
    const stream = async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {};
    return createLiveLoop(
      editor,
      { boardId: "board-1", mode: "feedback", enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream,
        getEngine: async () => engine,
        fetchCapabilities: async () => CAPS,
        events: null,
        isOnline: () => true,
      },
    );
  }

  async function quiet(): Promise<void> {
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle();
  }

  const echoes = () => editor.shapesOfType("math").filter((s) => (s.props as MathShapeProps).source === "echo");

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    editor = createFakeEditor();
    fetchJson = vi.fn<FetchJson>(async () => ok("2x=8"));
    loop = makeLoop();
    loop.start();
    await settle(2);
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  it("rub out a line, Undo: one echo, the restored one, and it is the line's", async () => {
    const ink = fixtureSingleLine();
    editor.putUser(ink);
    await quiet();
    expect(echoes()).toHaveLength(1);
    const echo = echoes()[0];

    // the eraser takes the ink and the hidden readback under it: one user action
    editor.removeUser([...ink.map((s) => s.id), echo.id]);
    await quiet();
    expect(echoes()).toHaveLength(0);
    expect(Object.keys(liveStore.lines.get())).toHaveLength(0);

    // Undo puts both back
    editor.putUser([...ink, echo] as TLShape[]);
    await quiet();
    expect(echoes()).toHaveLength(1);
    const [line] = Object.values(liveStore.lines.get());
    expect(line.mathShapeId).toBe(echoes()[0].id);
    expect((echoes()[0].props as MathShapeProps).lineId).toBe(line.line.id);
    expect(echoes()[0].meta.lineId).toBe(line.line.id);
  });

  it("delete everything and Undo, twice: still one echo per line", async () => {
    const first = writeLine("2x=8", 100, 100);
    const second = writeLine("x=4", 100, 200);
    editor.putUser([...first, ...second]);
    await quiet();
    expect(echoes()).toHaveLength(2);
    for (let round = 0; round < 2; round++) {
      const all = editor.getCurrentPageShapes();
      editor.removeUser(all.map((s) => s.id));
      await quiet();
      editor.putUser(all);
      await quiet();
    }
    expect(echoes()).toHaveLength(2);
    const lines = Object.values(liveStore.lines.get());
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((l) => l.mathShapeId))).toEqual(new Set(echoes().map((e) => e.id)));
  });

  it("Undo straight away (before Live saw the delete) keeps the one echo too", async () => {
    const ink = fixtureSingleLine();
    editor.putUser(ink);
    await quiet();
    const echo = echoes()[0];
    editor.removeUser([...ink.map((s) => s.id), echo.id]);
    editor.putUser([...ink, echo] as TLShape[]);
    await quiet();
    expect(echoes()).toHaveLength(1);
    expect(Object.values(liveStore.lines.get())[0].mathShapeId).toBe(echoes()[0].id);
  });

  it("a board saved with two echoes on the same ink comes back as one line, and the extra echo goes", async () => {
    loop.stop();
    resetLiveStore();
    const ink = writeLine("2x=8", 100, 100) as TLDrawShape[];
    editor.putUser(ink);
    const anchorIds = ink.map((s) => s.id as string);
    const props = { w: 80, h: 30, latex: "2x=8", source: "echo", status: "none", resultLatex: "", note: "", anchorIds, size: "m", tone: "muted" };
    editor.createShapes([
      { id: "shape:echoA" as TLShapeId, type: "math", x: 300, y: 100, props: { ...props, lineId: "ln_a" }, meta: { live: true, source: "echo", lineId: "ln_a", createdAt: 1, edited: false } },
      { id: "shape:echoB" as TLShapeId, type: "math", x: 300, y: 100, props: { ...props, lineId: "ln_b" }, meta: { live: true, source: "echo", lineId: "ln_b", createdAt: 2, edited: false } },
    ]);
    loop = makeLoop();
    loop.start();
    await settle(3);
    expect(Object.keys(liveStore.lines.get())).toHaveLength(1);
    expect(echoes()).toHaveLength(1);
  });
});
