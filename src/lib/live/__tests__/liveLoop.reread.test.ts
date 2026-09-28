import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError } from "@/lib/api-client";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { drawShapeFromPoints, fixtureSingleLine, writeLine } from "../__fixtures__/strokes";
import { settle, settleUntil } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";
import {
  isLiveMeta,
  type LiveEngine,
  type LiveSseEvent,
  type MathShapeProps,
  type RecognizeResponse,
  type RereadRequest,
  type RereadResponse,
  type UseLiveMathOptions,
} from "../contracts";
import { getEngine } from "../engine";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveDebugStore } from "../liveDebug";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";

/**
 * The second reader: after Mathpix's read is on the board, a read that looks wrong (the engine
 * cannot read it, a symbol implausible in its column, or low confidence) sends a crop of the ink
 * to /api/live/reread — at most once per ink. Its read replaces Mathpix's only when it differs,
 * has no words and the engine can read it; the line is then re-analysed and re-rendered.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
});

const CROP = "data:image/jpeg;base64,ZmFrZQ==";

class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(_blob: Blob): void {
    void _blob;
    this.result = CROP;
    queueMicrotask(() => this.onload?.());
  }
}

describe("live loop — the second reader", () => {
  useSyncHash();

  let editor: FakeEditor;
  let fetchJson: Mock<FetchJson>;
  let loop: LiveLoop;
  let online: boolean;
  let crops: number;
  /** what Mathpix reads next (last one repeats) */
  let reads: Array<Partial<RecognizeResponse>>;
  let rereadBodies: RereadRequest[];
  /** what the second reader answers (a function to control timing; an Error rejects) */
  let answer: (req: RereadRequest) => Promise<RereadResponse>;

  const reply = (latex: string): RereadResponse => ({ latex, changed: true, model: "google/gemini-3.1-flash-lite", ms: 850 });

  function start(mode: UseLiveMathOptions["mode"] = "feedback"): void {
    loop?.stop();
    resetLiveStore();
    loop = createLiveLoop(
      editor,
      { boardId: "board-1", mode, enabled: true },
      {
        recognizer: new RecognizeClient({ fetchJson }),
        stream: async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {},
        getEngine: async () => engine,
        fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
        events: null,
        isOnline: () => online,
        handwritingEnabled: () => true,
        reducedMotion: () => true,
        setup: async () => {
          throw new Error("no setup in this file");
        },
        reread: async (req) => {
          rereadBodies.push(req);
          return answer(req);
        },
      },
    );
    loop.start();
  }

  async function write(strokes = fixtureSingleLine()): Promise<string> {
    const before = fetchJson.mock.calls.length;
    editor.putUser(strokes);
    await vi.advanceTimersByTimeAsync(2000);
    await settleUntil(() => fetchJson.mock.calls.length > before);
    await settle(8);
    const line = Object.values(liveStore.lines.get()).find((st) => st.line.strokeIds.includes(strokes[0].id));
    if (!line) throw new Error("the strokes just written are on no line");
    return line.line.id;
  }

  /** Lets a second reading that is under way finish and land. */
  async function drain(): Promise<void> {
    await settle(12);
  }

  const lineOf = (id: string) => liveStore.lines.get()[id];
  const echoOf = (id: string) => {
    const shapeId = lineOf(id)?.mathShapeId;
    const shape = shapeId ? editor.getShape(shapeId) : undefined;
    return shape ? (shape.props as MathShapeProps) : null;
  };
  const marksOf = (kind: string) =>
    editor.shapesOfType("draw").filter((s) => isLiveMeta(s.meta) && String((s.meta as Record<string, unknown>).mark ?? "").startsWith(`${kind}:`));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.stubGlobal("FileReader", FakeFileReader);
    editor = createFakeEditor();
    crops = 0;
    editor.toImage = (async () => {
      crops++;
      return { blob: new Blob(["jpeg-bytes"], { type: "image/jpeg" }), width: 200, height: 40 };
    }) as unknown as FakeEditor["toImage"];
    online = true;
    reads = [{ latex: "0=5" }];
    rereadBodies = [];
    answer = async () => reply("a=5");
    fetchJson = vi.fn<FetchJson>(async (): Promise<RecognizeResponse> => {
      const next = reads.length > 1 ? reads.shift()! : reads[0];
      return { latex: "", text: "", kind: "math", confidence: 0.99, provider: "mathpix", ms: 100, ...next };
    });
    liveDebugStore.set({});
    start();
  });

  afterEach(() => {
    loop.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("a suspicious read goes to the second reader, whose read replaces it and is re-rendered", async () => {
    const lineId = await write();
    await drain();

    expect(rereadBodies).toEqual([{ boardId: "board-1", lineId, crop: CROP, latex: "0=5", above: [], below: [] }]);
    expect(crops).toBe(1);
    expect(lineOf(lineId)).toMatchObject({ latex: "a=5", provider: "reread" });
    expect(lineOf(lineId).analysis?.kind).toBe("assignment");
    expect(echoOf(lineId)?.latex).toBe("a=5");
    // the dev panel keeps both reads
    expect(liveDebugStore.get()[lineId]).toMatchObject({
      response: { latex: "0=5", provider: "mathpix" },
      reread: { signal: "false-number", mathpix: "0=5", latex: "a=5", accepted: true, model: "google/gemini-3.1-flash-lite" },
    });
  });

  it("sends the column: the lines above (and below) as read", async () => {
    reads = [{ latex: "v=u+a t" }, { latex: "U=3" }];
    answer = async () => reply("u=3");
    await write(writeLine("2x+3=11", 100, 200, 40));
    const second = await write(writeLine("x=4", 100, 280, 40));
    await drain();
    expect(rereadBodies).toHaveLength(1);
    expect(rereadBodies[0]).toMatchObject({ lineId: second, latex: "U=3", above: ["v=u+a t"], below: [] });
    expect(lineOf(second).latex).toBe("u=3");
  });

  it("a read that looks right is never sent, and no crop is taken", async () => {
    reads = [{ latex: "2x+3=11" }];
    const lineId = await write();
    await drain();
    expect(rereadBodies).toEqual([]);
    expect(crops).toBe(0);
    expect(lineOf(lineId)).toMatchObject({ latex: "2x+3=11", provider: "mathpix" });
  });

  it.each([
    ["words", "\\text{a equals 5}"],
    ["the same read", "0 = 5"],
    ["LaTeX the engine cannot read", "a=\\frac{5}{"],
    ["a worked answer instead of a transcription", "a = 5, \\ b = 2a - 3, \\ b = 7, \\ c = 12"],
    ["itself a likely misread", "\\sigma = 5"],
  ])("an answer that is %s is ignored: Mathpix's read stands", async (_why, latex) => {
    answer = async () => reply(latex);
    const lineId = await write();
    await drain();
    expect(rereadBodies).toHaveLength(1);
    expect(lineOf(lineId)).toMatchObject({ latex: "0=5", provider: "mathpix" });
    expect(echoOf(lineId)?.latex).toBe("0=5");
    expect(liveDebugStore.get()[lineId].reread).toMatchObject({ latex, accepted: false });
  });

  it("asks at most once per ink: the same ink again uses the accepted read with no second call", async () => {
    reads = [{ latex: "0=5" }, { latex: "2x+3=11" }];
    const lineId = await write();
    await drain();
    expect(lineOf(lineId).latex).toBe("a=5");

    // a stray mark on the line (a new ink version, read and left alone) ...
    const mark = drawShapeFromPoints([
      { x: 356, y: 214 },
      { x: 362, y: 222 },
    ]);
    editor.putUser([mark]);
    await vi.advanceTimersByTimeAsync(2000);
    await settleUntil(() => fetchJson.mock.calls.length === 2);
    await drain();
    expect(lineOf(lineId)).toMatchObject({ latex: "2x+3=11", provider: "mathpix" });

    // ... rubbed out again: the very ink the second reader already read
    editor.removeUser([mark.id]);
    await vi.advanceTimersByTimeAsync(2000);
    await settleUntil(() => lineOf(lineId)?.latex === "a=5");
    await drain();

    expect(fetchJson.mock.calls.length).toBe(2); // Mathpix from the client cache
    expect(rereadBodies).toHaveLength(1); // and no second reading
    expect(lineOf(lineId)).toMatchObject({ latex: "a=5", provider: "reread" });
  });

  it("a low-confidence read the board would not show: an accepted reading shows it, and no '?' follows", async () => {
    reads = [{ latex: "2x+3=1l", confidence: 0.4 }];
    answer = async () => reply("2x+3=11");
    const lineId = await write();
    await drain();
    await vi.advanceTimersByTimeAsync(4_000); // past the "couldn't read this" chip
    await settle(8);
    expect(lineOf(lineId)).toMatchObject({ latex: "2x+3=11", provider: "reread" });
    expect(lineOf(lineId).confidence).toBeGreaterThanOrEqual(0.6);
    expect(echoOf(lineId)?.latex).toBe("2x+3=11");
    expect(echoOf(lineId)?.note).toBe("");
    expect(marksOf("question")).toEqual([]);
  });

  it("a failed second reading is silent: no error, Mathpix's read stands", async () => {
    answer = async () => {
      throw new ApiError("The AI service returned an error. Please try again.", 502, "upstream_error");
    };
    const lineId = await write();
    await drain();
    expect(rereadBodies).toHaveLength(1);
    expect(liveStore.lastError.get()).toBeNull();
    expect(lineOf(lineId)).toMatchObject({ latex: "0=5", provider: "mathpix" });
    expect(liveDebugStore.get()[lineId].reread).toMatchObject({ accepted: false, error: expect.any(String) });
  });

  it("offline: no second reading (the line waits in the offline queue like any other)", async () => {
    online = false;
    loop.setOnline(false);
    editor.putUser(fixtureSingleLine());
    await vi.advanceTimersByTimeAsync(2000);
    await drain();
    expect(fetchJson).not.toHaveBeenCalled();
    expect(rereadBodies).toEqual([]);
    expect(crops).toBe(0);
    expect(liveStore.offlineQueued.get()).toBe(1);
  });

  it("only Mathpix's reads are proofread: a vision read is never sent back to a vision model", async () => {
    reads = [{ latex: "0=5", provider: "vision" }];
    const lineId = await write();
    await drain();
    expect(rereadBodies).toEqual([]);
    expect(lineOf(lineId)).toMatchObject({ latex: "0=5", provider: "vision" });
  });

  it("an answer that lands after the student retyped the line is dropped", async () => {
    let release: (r: RereadResponse) => void = () => undefined;
    answer = () => new Promise<RereadResponse>((resolve) => (release = resolve));
    const lineId = await write();
    await settleUntil(() => rereadBodies.length === 1);
    loop.retypeLine(lineId, "b=5");
    await settle(4);
    release(reply("a=5"));
    await drain();
    expect(lineOf(lineId)).toMatchObject({ latex: "b=5", provider: "typed" });
  });
});
