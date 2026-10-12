import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { drawShapeFromPoints, writeLine as inkLine } from "../__fixtures__/strokes";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import { LIVE_TIMING, type LiveEngine, type LiveSseEvent, type RecognizeResponse } from "../contracts";
import { getEngine } from "../engine";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { DEFAULT_SCREEN } from "@/lib/screens/screens";
import type { ChatAction, ChatRunReport } from "../chat/contracts";

/**
 * Ask's picture of the screen, from the loop (`LiveLoop.chatImage`): asked for only when the screen
 * holds something its LaTeX cannot say. The policy is tested on its own in `ask/__tests__`; here it
 * meets the shapes the loop really writes, so a tutor's problem that gains a new kind of meta
 * cannot quietly start sending a picture with every ask.
 */

const PICTURE = "data:image/jpeg;base64,AAAA";
const capture = vi.fn(async (): Promise<string | null> => PICTURE);

vi.mock("../ask/boardImage", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ask/boardImage")>();
  return { ...real, captureAskImage: () => capture() };
});

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
  await import("../chat/teachWrite");
  await import("../ask/boardImage");
});

describe("live loop — Ask's picture of the screen", () => {
  useSyncHash();

  let editor: FakeEditor;
  let loop: LiveLoop;
  let fetchJson: Mock<FetchJson>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    capture.mockClear();
    capture.mockImplementation(async () => PICTURE);
    editor = createFakeEditor();
    const page = editor.getCurrentPage();
    editor.store.put([{ ...page, meta: { screen: { ...DEFAULT_SCREEN } } }]);
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => ({ latex: "2x=8", text: "", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 }));
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode: "feedback", enabled: true },
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
  });

  afterEach(() => {
    loop?.stop();
    vi.useRealTimers();
  });

  async function run(actions: ChatAction[]): Promise<ChatRunReport> {
    let result: ChatRunReport | null = null;
    let error: unknown = null;
    loop.runChatActions(actions).then(
      (r) => (result = r),
      (e) => (error = e),
    );
    for (let i = 0; i < 400 && !result && !error; i++) await vi.advanceTimersByTimeAsync(50);
    if (error) throw error;
    if (!result) throw new Error("the chat never finished");
    return result;
  }

  it("an empty screen: no picture, and no capture", async () => {
    expect(await loop.chatImage()).toBeNull();
    expect(capture).not.toHaveBeenCalled();
  });

  it("only the tutor's problems, in its hand: the LaTeX says it all, no picture", async () => {
    const report = await run([{ type: "write_problems", problems: [["2x + 3 = 11"], ["x + y = 10", "x - y = 2"]] }]);
    expect(report.problemsWritten).toBe(2);
    expect(editor.getCurrentPageShapes().length).toBeGreaterThan(0);
    expect(await loop.chatImage()).toBeNull();
    expect(capture).not.toHaveBeenCalled();
  });

  it("the student's ink under them: the picture", async () => {
    await run([{ type: "write_problems", problems: [["2x + 3 = 11"]] }]);
    editor.putUser(inkLine("2x=8", 100, 600, 40));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.quietMs + 300);
    expect(await loop.chatImage()).toBe(PICTURE);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("a drawing of the student's alone: the picture", async () => {
    editor.putUser([drawShapeFromPoints([{ x: 300, y: 300 }, { x: 420, y: 340 }, { x: 360, y: 420 }])]);
    expect(await loop.chatImage()).toBe(PICTURE);
  });

  it("a capture that fails or throws: null, never an error in the ask", async () => {
    editor.putUser([drawShapeFromPoints([{ x: 300, y: 300 }, { x: 420, y: 340 }])]);
    capture.mockImplementationOnce(async () => null);
    expect(await loop.chatImage()).toBeNull();
    capture.mockImplementationOnce(async () => {
      throw new Error("canvas gone");
    });
    expect(await loop.chatImage()).toBeNull();
  });
});
