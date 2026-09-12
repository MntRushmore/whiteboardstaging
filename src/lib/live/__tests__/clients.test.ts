import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSseEvent, RecognizeRequest, RecognizeResponse } from "../contracts";
import { LiveAbortError, RecognizeClient, RecognizeTimeoutError, fetchCapabilities } from "../recognizeClient";
import { SseFrameParser, streamLiveSse, toLiveSseEvent, type FetchLike } from "../sseClient";

const req = (lineId: string): RecognizeRequest => ({
  boardId: "b1",
  lineId,
  strokes: { x: [[0, 1]], y: [[0, 1]] },
  bounds: { w: 10, h: 10 },
});
const response: RecognizeResponse = { latex: "2x", text: "2x", kind: "math", confidence: 0.97, provider: "mathpix", ms: 300 };

describe("RecognizeClient", () => {
  it("caches by content hash and evicts the oldest entry past the cap", async () => {
    const fetchJson = vi.fn(async () => response);
    const client = new RecognizeClient({ fetchJson, cacheEntries: 2 });
    await client.recognize(req("a"), "h1");
    await client.recognize(req("a"), "h1");
    expect(fetchJson).toHaveBeenCalledTimes(1);
    await client.recognize(req("b"), "h2");
    await client.recognize(req("c"), "h3");
    expect(client.cacheSize).toBe(2);
    expect(client.peek("h1")).toBeUndefined();
    expect(client.peek("h3")).toEqual(response);
  });

  it("runs at most two requests concurrently and queues the rest", async () => {
    let active = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];
    const fetchJson = vi.fn(
      () =>
        new Promise<RecognizeResponse>((resolve) => {
          active++;
          peak = Math.max(peak, active);
          resolvers.push(() => {
            active--;
            resolve(response);
          });
        }),
    );
    const client = new RecognizeClient({ fetchJson });
    const p = [client.recognize(req("a"), "1"), client.recognize(req("b"), "2"), client.recognize(req("c"), "3")];
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchJson).toHaveBeenCalledTimes(2);
    resolvers.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchJson).toHaveBeenCalledTimes(3);
    while (resolvers.length) resolvers.shift()!();
    await Promise.all(p);
    expect(peak).toBe(2);
  });

  it("a new burst on the same line aborts the in-flight request", async () => {
    const fetchJson = vi.fn(
      (_path: string, _body: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<RecognizeResponse>((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          setTimeout(() => resolve(response), 50);
        }),
    );
    const client = new RecognizeClient({ fetchJson });
    const first = client.recognize(req("a"), "h-first");
    const second = client.recognize(req("a"), "h-second");
    await expect(first).rejects.toBeInstanceOf(LiveAbortError);
    await expect(second).resolves.toEqual(response);
    expect(client.inFlight).toBe(0);
  });

  it("times out and reports RecognizeTimeoutError", async () => {
    vi.useFakeTimers();
    try {
      const fetchJson = vi.fn(
        (_path: string, _body: unknown, init?: { signal?: AbortSignal }) =>
          new Promise<RecognizeResponse>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      const client = new RecognizeClient({ fetchJson, timeoutMs: 1000 });
      const p = client.recognize(req("a"), "h");
      const assertion = expect(p).rejects.toBeInstanceOf(RecognizeTimeoutError);
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed responses", async () => {
    const client = new RecognizeClient({ fetchJson: vi.fn(async () => ({ nope: true })) });
    await expect(client.recognize(req("a"), "h")).rejects.toThrow(/unexpected/i);
  });

  it("fetchCapabilities GETs and validates", async () => {
    const fetchJson = vi.fn(async () => ({ recognizer: "mathpix", liveEnabled: true, models: { check: "a", solve: "b", vision: "c" } }));
    const caps = await fetchCapabilities(fetchJson);
    expect(caps.recognizer).toBe("mathpix");
    expect(fetchJson).toHaveBeenCalledWith("/api/live/recognize", undefined, expect.objectContaining({ method: "GET" }));
  });
});

describe("SseFrameParser", () => {
  it("parses frames split across arbitrary chunk boundaries", () => {
    const text = 'event: meta\ndata: {"requestId":"r1","model":"m"}\n\nevent: annotation\ndata: {"lineId":"ln_1","verdict":"warn","kind":"sign","message":"Look at the sign on the right","confidence":0.9}\n\n: keepalive\n\nevent: done\ndata: {"count":1,"ms":900}\n\n';
    for (const size of [1, 3, 7, 1000]) {
      const parser = new SseFrameParser();
      const frames = [];
      for (let i = 0; i < text.length; i += size) frames.push(...parser.push(text.slice(i, i + size)));
      frames.push(...parser.flush());
      expect(frames.map((f) => f.event)).toEqual(["meta", "annotation", "done"]);
      const events = frames.map(toLiveSseEvent).filter((e): e is LiveSseEvent => e !== null);
      expect(events[1].event).toBe("annotation");
      expect(events[2]).toEqual({ event: "done", data: { count: 1, ms: 900 } });
    }
  });

  it("handles CRLF, multi-line data and drops invalid payloads", () => {
    const parser = new SseFrameParser();
    const frames = parser.push('event: step\r\ndata: {"index":1,\r\ndata: "latex":"2x=8","explanation":"subtract 3","final":false}\r\n\r\nevent: annotation\r\ndata: {"bad":true}\r\n\r\n');
    expect(frames).toHaveLength(2);
    expect(toLiveSseEvent(frames[0])).toEqual({ event: "step", data: { index: 1, latex: "2x=8", explanation: "subtract 3", final: false } });
    expect(toLiveSseEvent(frames[1])).toBeNull();
    expect(toLiveSseEvent({ event: "annotation", data: "not json" })).toBeNull();
    expect(toLiveSseEvent({ event: "mystery", data: "{}" })).toBeNull();
  });
});

describe("streamLiveSse", () => {
  function streamResponse(chunks: string[], status = 200): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
  }

  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.restoreAllMocks());

  it("POSTs the body and yields typed events until done", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      streamResponse(['event: meta\ndata: {"requestId":"r","model":"m"}\n\n', 'event: annotation\ndata: {"lineId":null,"verdict":"info","kind":"praise","message":"Nice chain","confidence":0.9}\n\nevent: done\ndata: {"count":1,"ms":5}\n\nevent: annotation\ndata: {}\n\n']),
    );
    const events: LiveSseEvent[] = [];
    for await (const ev of streamLiveSse("/api/live/check", { boardId: "b" }, { fetchImpl })) events.push(ev);
    expect(events.map((e) => e.event)).toEqual(["meta", "annotation", "done"]);
    const init = fetchImpl.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ boardId: "b" });
  });

  it("throws ApiError on non-2xx using the error contract", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "rate_limited", message: "Slow down" }), { status: 429 }));
    const gen = streamLiveSse("/api/live/check", {}, { fetchImpl });
    await expect(gen.next()).rejects.toMatchObject({ status: 429, code: "rate_limited", message: "Slow down" });
  });

  it("stops quietly when aborted", async () => {
    const ctrl = new AbortController();
    const fetchImpl = vi.fn(async () => streamResponse(['event: meta\ndata: {"requestId":"r","model":"m"}\n\n', 'event: done\ndata: {"count":0,"ms":1}\n\n']));
    const events: LiveSseEvent[] = [];
    for await (const ev of streamLiveSse("/api/live/solve", {}, { fetchImpl, signal: ctrl.signal })) {
      events.push(ev);
      ctrl.abort();
    }
    expect(events.map((e) => e.event)).toEqual(["meta"]);
  });
});
