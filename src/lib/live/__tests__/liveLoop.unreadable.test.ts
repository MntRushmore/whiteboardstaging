import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TLDrawShape, TLShape } from "tldraw";

const reported = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/lib/reportAppError", () => ({
  reportUserError: (input: Record<string, unknown>) => reported.push(input),
  reportAppError: () => {},
}));

import { ApiError, apiErrorFromResponse } from "@/lib/api-client";
import { createFakeEditor, type FakeEditor } from "../__fixtures__/fakeEditor";
import { writeLine } from "../__fixtures__/strokes";
import { LIVE_TIMING, type LineAnalysis, type LiveEngine, type LiveSseEvent, type MathShapeProps, type RecognizeRequest, type RecognizeResponse, type UseLiveMathOptions } from "../contracts";
import { createLiveLoop, type LiveLoop } from "../liveLoop";
import { liveStore, resetLiveStore } from "../liveStore";
import { RecognizeClient, type FetchJson } from "../recognizeClient";
import { settle } from "@/lib/live/__fixtures__/settle";
import { useSyncHash } from "@/lib/live/__fixtures__/syncHash";

/**
 * Ink the recognizer could not make sense of is not the tutor service failing (production,
 * 2026-10-01..07: "The tutor service had a hiccup", 12 times for 4 kids, mostly iPads, where
 * Mathpix answered that it could not read the ink and the board then had no crop to send). It is a
 * line the tutor could not read: the gentle "Couldn't read this — tap to type it" and "?", after the
 * same delay as an unsure read, no pill and no error card, reported at info (`unreadable`). A Mathpix
 * timeout is a blip: read again once on its own before anything is shown.
 *
 * Production, 2026-10-12 (an iPad, release a64cddd): the route's 502 never reached the board.
 * Cloudflare, in front of www.agathon.app, replaces every origin 502 with its own HTML page, so the
 * board got a bare 502 (no `error`, no hints, no X-Request-Id): no crop retry was ever sent, the same
 * ink was read again 1.6 s later as a blip, and "The tutor service had a hiccup" was reported with no
 * request id, twice (the second "tried 2 times" after Retry). The route now answers 503; the board
 * tries the crop on a bare 5xx too, keeps the route's `unreadable` when the crop retry fails, and
 * says in the report why it failed.
 */

const engine: LiveEngine = {
  analyzeLine: (latex): LineAnalysis => ({ kind: "equation", math: latex, resultLatex: "", verdict: latex === "x=4" ? "ok" : "unknown", note: "" }),
  compileExpr: () => () => 0,
  solveLatex: () => null,
  verifyExpected: () => "unknown",
  balance: () => null,
  calculate: () => null,
};

const QUIET = LIVE_TIMING.rewriteQuietMs + LIVE_TIMING.quietMs + 1;
const REQUEST_ID = "4f1c2d3e-aaaa-4bbb-8ccc-123456789abc";
const markOf = (s: TLShape) => String((s.meta as Record<string, unknown>).mark ?? "");

function read(latex: string): RecognizeResponse {
  return { latex, text: latex, kind: "math", confidence: 0.97, provider: "mathpix", ms: 100 };
}

/** The recognize route's `recognizer_failed`, as apiErrorFromResponse builds it, with its hints. */
function recognizerFailed(hints: Record<string, unknown>): ApiError {
  const err = new ApiError("Couldn't read this line right now.", 503, "recognizer_failed");
  err.body = { error: "recognizer_failed", message: "Couldn't read this line right now.", provider: null, ...hints };
  err.requestId = REQUEST_ID;
  return err;
}

describe("live loop — ink the recognizer could not read", () => {
  useSyncHash();

  let editor: FakeEditor;
  let loop: LiveLoop;
  let opts: UseLiveMathOptions;
  let fetchJson: Mock<FetchJson>;
  let requests: RecognizeRequest[];
  let script: Array<RecognizeResponse | Error>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    resetLiveStore();
    reported.length = 0;
    editor = createFakeEditor();
    // an iPad where the board's export fails: no crop to send
    editor.toImage = (async () => {
      throw new Error("Could not construct image.");
    }) as unknown as FakeEditor["toImage"];
    requests = [];
    script = [read("x=4")];
    fetchJson = vi.fn<FetchJson>(async (_path, body) => {
      requests.push(body as RecognizeRequest);
      const next = script.length > 1 ? script.shift()! : script[0];
      if (next instanceof Error) throw next;
      return next;
    });
    opts = { boardId: "board-1", mode: "feedback", enabled: true };
    loop = createLiveLoop(editor, opts, {
      recognizer: new RecognizeClient({ fetchJson }),
      stream: async function* (): AsyncGenerator<LiveSseEvent, void, undefined> {},
      getEngine: async () => engine,
      fetchCapabilities: async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "c", solve: "s", vision: "v" } }),
      events: null,
      isOnline: () => true,
      handwritingEnabled: () => true,
      reducedMotion: () => false,
    });
    loop.start();
    await settle(2);
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A browser that can make a crop: tldraw's export answers, and FileReader turns it into a data URL. */
  function cropsWork(): void {
    editor.toImage = (async () => ({ blob: new Blob(["jpeg-bytes"], { type: "image/jpeg" }), width: 200, height: 40 })) as unknown as FakeEditor["toImage"];
    stubFileReader();
  }

  function stubFileReader(): void {
    vi.stubGlobal(
      "FileReader",
      class {
        result: string | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(): void {
          this.result = "data:image/jpeg;base64,ZmFrZQ==";
          queueMicrotask(() => this.onload?.());
        }
      },
    );
  }

  async function wait(ms: number): Promise<void> {
    for (let t = 0; t < ms; t += 50) {
      await vi.advanceTimersByTimeAsync(50);
      await settle(1);
    }
    await settle(4);
  }

  async function penUp(shapes: TLDrawShape[]): Promise<void> {
    editor.putUser(shapes);
    await vi.advanceTimersByTimeAsync(QUIET);
    await settle(8);
  }

  const questions = () => [...new Set(editor.getCurrentPageShapes().map(markOf).filter((m) => m.startsWith("question:")))];
  const echo = () => (editor.shapesOfType("math")[0]?.props as MathShapeProps | undefined) ?? null;

  it("Mathpix could not read it and no crop could be made: no pill, the gentle 'couldn't read this' and '?' after the delay, reported at info", async () => {
    script = [recognizerFailed({ needsCrop: true, unreadable: true })];
    await penUp(writeLine("x=4", 100, 200));
    expect(fetchJson).toHaveBeenCalledTimes(1);
    // before: the pill's "The tutor service had a hiccup" and the "tap Retry" chip, at once
    expect(liveStore.lastError.get()).toBeNull();
    expect(questions()).toHaveLength(0);
    // and why no crop was read instead (here: no FileReader at all)
    expect(reported).toEqual([
      { kind: "live.recognize", code: "unreadable:no_crop", message: "Couldn't read this — tap to type it", level: "info", requestId: REQUEST_ID, facts: "tried=no-filereader" },
    ]);

    // the student may still be writing: the "?" waits as an unsure read's does
    await wait(LIVE_TIMING.unreadableChipMs + 200);
    expect(questions()).toHaveLength(1);
    expect(echo()).toMatchObject({ latex: "", status: "unknown", note: "Couldn't read this — tap to type it" });
    expect(liveStore.lastError.get()).toBeNull();
    // never read again on its own: it would not read the second time either
    await wait(5000);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("writing on the line before the delay is up: no '?' for the old ink, the new ink is read", async () => {
    script = [recognizerFailed({ needsCrop: true, unreadable: true }), read("x=4")];
    const line = writeLine("x=4", 100, 200);
    const last = line.pop()!;
    await penUp(line);
    await wait(1000);
    await penUp([last]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    await wait(LIVE_TIMING.unreadableChipMs + 200);
    expect(questions()).toHaveLength(0);
    expect(Object.values(liveStore.lines.get())[0].latex).toBe("x=4");
  });

  it("a Mathpix timeout (transient) is read again once on its own, 1.5 s later, before anything is shown", async () => {
    script = [recognizerFailed({ needsCrop: true, transient: true }), read("x=4")];
    await penUp(writeLine("x=4", 100, 200));
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(liveStore.lastError.get()).toBeNull();
    await wait(1600);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(liveStore.lastError.get()).toBeNull();
    expect(Object.values(liveStore.lines.get())[0].latex).toBe("x=4");
    expect(reported).toEqual([]);
  });

  it("a transient failure that fails again is shown, with the request id in its report", async () => {
    script = [recognizerFailed({ needsCrop: true, transient: true })];
    await penUp(writeLine("x=4", 100, 200));
    await wait(1600);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(liveStore.lastError.get()).toMatchObject({ kind: "recognize", code: "upstream", requestId: REQUEST_ID });
    expect(reported).toEqual([expect.objectContaining({ kind: "live.recognize", code: "upstream", requestId: REQUEST_ID })]);
    expect(questions()).toHaveLength(1);
  });

  it("with a crop the retry is `cropOnly` (vision reads it) and an unsure vision read keeps its own gentle path", async () => {
    cropsWork();
    script = [recognizerFailed({ needsCrop: true, unreadable: true }), { ...read("x=4"), provider: "vision", confidence: 0.3 }];
    await penUp(writeLine("x=4", 100, 200));
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(requests[1]).toMatchObject({ cropOnly: true, crop: "data:image/jpeg;base64,ZmFrZQ==" });
    expect(liveStore.lastError.get()).toBeNull();
    await wait(LIVE_TIMING.unreadableChipMs + 200);
    expect(questions()).toHaveLength(1);
  });

  describe("production 2026-10-12: Cloudflare's page in place of the route's 502", () => {
    /** What the board got: apiErrorFromResponse of Cloudflare's HTML 502 (no `error`, no hints, no X-Request-Id). */
    const cloudflare502 = () =>
      apiErrorFromResponse(
        new Response("<!DOCTYPE html><html><head><title>www.agathon.app | 502: Bad gateway</title></head><body>cloudflare</body></html>", {
          status: 502,
          headers: { "Content-Type": "text/html; charset=UTF-8", Server: "cloudflare", "cf-ray": "a4925f9e3b1509ae-SJC" },
        }),
      );

    it("the bare 502 hid `needsCrop`: the board sends the crop anyway, and vision reads the line", async () => {
      cropsWork();
      script = [await cloudflare502(), { ...read("x=4"), provider: "vision" }];
      await penUp(writeLine("x=4", 100, 200));
      // before: no crop retry, the same strokes again 1.6 s later, then the pill
      expect(fetchJson).toHaveBeenCalledTimes(2);
      expect(requests[0]).not.toHaveProperty("crop");
      expect(requests[1]).toMatchObject({ cropOnly: true, crop: "data:image/jpeg;base64,ZmFrZQ==" });
      expect(Object.values(liveStore.lines.get())[0].latex).toBe("x=4");
      expect(liveStore.lastError.get()).toBeNull();
      expect(reported).toEqual([]);
    });

    it("the iPad replay: a bare 502 and no crop to send is read once more, then shown, reported as `upstream:bare_502` with what the crop tried", async () => {
      // the board's export fails and no canvas can draw the strokes (the iPad's case): no crop
      stubFileReader();
      script = [await cloudflare502()];
      await penUp(writeLine("x=4", 100, 200));
      expect(fetchJson).toHaveBeenCalledTimes(1);
      expect(liveStore.lastError.get()).toBeNull();
      // the blip retry, 1.6 s after (the pairs 2 s apart in the route's logs)
      await wait(1600);
      expect(fetchJson).toHaveBeenCalledTimes(2);
      expect(requests.every((r) => !r.crop)).toBe(true);
      // nothing said why this ink could not be read: an honest "hiccup", but the report says no route of ours answered
      expect(liveStore.lastError.get()).toMatchObject({ kind: "recognize", code: "upstream", message: "The tutor service had a hiccup" });
      expect(liveStore.lastError.get()).not.toHaveProperty("requestId");
      expect(reported).toEqual([
        {
          kind: "live.recognize",
          code: "upstream:bare_502",
          message: "The tutor service had a hiccup",
          facts: "retry=no_crop,tried=export:Could_not_construct_image.+drawn:none",
        },
      ]);
    });

    it("the route said `unreadable` and the crop retry got Cloudflare's 502: the gentle '?', the original request id, never a blip or the pill", async () => {
      cropsWork();
      script = [recognizerFailed({ needsCrop: true, unreadable: true }), await cloudflare502()];
      await penUp(writeLine("x=4", 100, 200));
      expect(fetchJson).toHaveBeenCalledTimes(2);
      expect(requests[1]).toMatchObject({ cropOnly: true });
      // before: the crop's 502 was rethrown, read as a blip, and shown as "The tutor service had a hiccup"
      expect(liveStore.lastError.get()).toBeNull();
      expect(reported).toEqual([
        {
          kind: "live.recognize",
          code: "unreadable:crop_bare_502",
          message: "Couldn't read this — tap to type it",
          level: "info",
          requestId: REQUEST_ID,
          facts: "how=export,bytes=10,status=502,name=ApiError",
        },
      ]);
      await wait(LIVE_TIMING.unreadableChipMs + 200);
      expect(questions()).toHaveLength(1);
      expect(echo()).toMatchObject({ note: "Couldn't read this — tap to type it" });
      // the same unreadable strokes are never sent again on their own
      await wait(5000);
      expect(fetchJson).toHaveBeenCalledTimes(2);
      expect(liveStore.lastError.get()).toBeNull();
    });

    it("the route said `unreadable` and the crop retry never answered (its 6 s): the gentle '?', reported `unreadable:crop_timeout`", async () => {
      cropsWork();
      fetchJson.mockImplementationOnce(async (_path, body) => {
        requests.push(body as RecognizeRequest);
        throw recognizerFailed({ needsCrop: true, unreadable: true });
      });
      fetchJson.mockImplementationOnce(async (_path, body) => {
        requests.push(body as RecognizeRequest);
        return new Promise<never>(() => {});
      });
      await penUp(writeLine("x=4", 100, 200));
      expect(fetchJson).toHaveBeenCalledTimes(2);
      expect(liveStore.lastError.get()).toBeNull();
      await wait(LIVE_TIMING.recognizeTimeoutMs + 100);
      expect(liveStore.lastError.get()).toBeNull();
      expect(reported).toEqual([
        expect.objectContaining({ code: "unreadable:crop_timeout", level: "info", requestId: REQUEST_ID, facts: "how=export,bytes=10,name=TimeoutError" }),
      ]);
      await wait(LIVE_TIMING.unreadableChipMs + 200);
      expect(questions()).toHaveLength(1);
      expect(fetchJson).toHaveBeenCalledTimes(2);
    });

    it("not `unreadable` (a Mathpix timeout) and the crop retry fails too: the crop's error goes on as before, its report says how the crop went", async () => {
      cropsWork();
      const crop502 = await cloudflare502();
      script = [recognizerFailed({ needsCrop: true, transient: true }), crop502, recognizerFailed({ needsCrop: true, transient: true }), crop502];
      await penUp(writeLine("x=4", 100, 200));
      expect(fetchJson).toHaveBeenCalledTimes(2);
      expect(liveStore.lastError.get()).toBeNull();
      await wait(1600);
      expect(fetchJson).toHaveBeenCalledTimes(4);
      expect(liveStore.lastError.get()).toMatchObject({ kind: "recognize", code: "upstream" });
      expect(reported).toEqual([
        {
          kind: "live.recognize",
          code: "upstream:bare_502",
          message: "The tutor service had a hiccup",
          facts: "retry=crop_bare_502,how=export,bytes=10,status=502,name=ApiError",
        },
      ]);
    });
  });
});
