import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { chatErrorFor } from "@/components/chat/chatView";
import { ASK_PATH, type AskRequest } from "../contracts";
import { ASK_IDLE_TIMEOUT_MS, AskStreamError, AskTimeoutError, streamAsk, type AskStreamHandlers } from "../client";

/** POST /api/live/ask from the panel: the stream, event by event, and every way it can end. */

const REQ: AskRequest = { boardId: "b1", message: "why is the sky blue?", history: [], screen: { empty: true, student: [], tutor: [], problems: [] } };

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A Response whose body yields `chunks` (strings), then closes; `hang` keeps it open after them. */
function sse(chunks: string[], opts: { hang?: boolean; status?: number } = {}): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      if (!opts.hang) c.close();
    },
  });
  return new Response(body, { status: opts.status ?? 200, headers: { "Content-Type": "text/event-stream" } });
}

function recorder() {
  const seen: string[] = [];
  const h: AskStreamHandlers = {
    onModel: (m) => seen.push(`model:${m}`),
    onDelta: (t) => seen.push(`delta:${t}`),
    onReply: (t) => seen.push(`reply:${t}`),
    onActions: (e) => seen.push(`actions:${e.actions.length}:${e.notes.join("|")}`),
    onDone: (e) => seen.push(`done:${e.model}:${e.turnId ?? "-"}`),
  };
  return { seen, h };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("streamAsk", () => {
  it("POSTs the ask to the route as JSON, asking for a stream", async () => {
    const fetchImpl = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => sse([frame("done", { model: "m", ms: 1 })]));
    await streamAsk(REQ, {}, { fetchImpl });
    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe(ASK_PATH);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Accept")).toBe("text/event-stream");
    expect(JSON.parse(String(init?.body))).toMatchObject({ boardId: "b1", message: "why is the sky blue?" });
  });

  it("hands each event to its handler, in order, and resolves on done", async () => {
    const { seen, h } = recorder();
    const body = [
      frame("model", { model: "haiku" }),
      frame("delta", { text: "The sky " }),
      frame("delta", { text: "scatters blue light." }),
      frame("reply", { text: "The sky scatters **blue** light." }),
      frame("actions", { actions: [{ type: "new_screen" }], notes: ["The figure couldn't be drawn."] }),
      frame("done", { model: "haiku", ms: 812, turnId: "t9" }),
    ];
    await streamAsk(REQ, h, { fetchImpl: async () => sse(body) });
    expect(seen).toEqual([
      "model:haiku",
      "delta:The sky ",
      "delta:scatters blue light.",
      "reply:The sky scatters **blue** light.",
      "actions:1:The figure couldn't be drawn.",
      "done:haiku:t9",
    ]);
  });

  it("frames split anywhere across chunks still arrive whole (a byte at a time)", async () => {
    const { seen, h } = recorder();
    const whole = frame("delta", { text: "½ of 8 is 4 — easy!" }) + frame("done", { model: "m", ms: 1 });
    await streamAsk(REQ, h, { fetchImpl: async () => sse([...whole]) });
    expect(seen).toEqual(["delta:½ of 8 is 4 — easy!", "done:m:-"]);
  });

  it("skips frames that do not parse or that it does not know (a newer route), and pings", async () => {
    const { seen, h } = recorder();
    const body = [": ping\n\n", "event: delta\ndata: {not json\n\n", frame("sparkle", { x: 1 }), frame("delta", { nope: 1 }), frame("delta", { text: "ok" }), frame("done", { model: "m", ms: 1 })];
    await streamAsk(REQ, h, { fetchImpl: async () => sse(body) });
    expect(seen).toEqual(["delta:ok", "done:m:-"]);
  });

  it("a JSON error before the stream is the same ApiError apiJson throws: out of ink, rate limited, signed out", async () => {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => async () =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
    const ink = await streamAsk(REQ, {}, { fetchImpl: json(402, { error: "ink_empty", message: "Out of ink" }) }).catch((e: unknown) => e);
    expect(ink).toBeInstanceOf(ApiError);
    expect(chatErrorFor(ink).kind).toBe("ink");
    const limited = await streamAsk(REQ, {}, { fetchImpl: json(429, { error: "rate_limited", retryAfterMs: 4200 }) }).catch((e: unknown) => e);
    expect(chatErrorFor(limited)).toMatchObject({ kind: "rate_limited", message: "That's a lot of questions. Try again in 5 s." });
    const out = await streamAsk(REQ, {}, { fetchImpl: json(401, { error: "unauthorized" }) }).catch((e: unknown) => e);
    expect(chatErrorFor(out).kind).toBe("unauthorized");
    // the contract's stub (501) is an ordinary failure with Retry
    const stub = await streamAsk(REQ, {}, { fetchImpl: json(501, { error: "Not built yet", code: "not_implemented" }) }).catch((e: unknown) => e);
    expect(chatErrorFor(stub)).toMatchObject({ kind: "other", retry: true });
  });

  it("an error event becomes AskStreamError with the route's code, after the text that came before it", async () => {
    const { seen, h } = recorder();
    const body = [frame("delta", { text: "Let me" }), frame("error", { code: "upstream", message: "The model failed" }), frame("done", { model: "m", ms: 1 })];
    const err = await streamAsk(REQ, h, { fetchImpl: async () => sse(body) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AskStreamError);
    expect((err as AskStreamError).event).toEqual({ code: "upstream", message: "The model failed" });
    expect(seen).toEqual(["delta:Let me"]);
    expect(chatErrorFor(err)).toMatchObject({ kind: "other", retry: true });
  });

  it("an error event saying the ink ran out mid-way shows as out of ink", async () => {
    const body = [frame("error", { code: "credits_exhausted", message: "x", status: 402 })];
    const err = await streamAsk(REQ, {}, { fetchImpl: async () => sse(body) }).catch((e: unknown) => e);
    expect(chatErrorFor(err).kind).toBe("ink");
  });

  it("a stream that closes before done is cut off, not a success", async () => {
    const err = await streamAsk(REQ, {}, { fetchImpl: async () => sse([frame("delta", { text: "Half an ans" })]) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AskStreamError);
    expect((err as AskStreamError).event.code).toBe("incomplete");
  });

  it("a stream that goes quiet ends as a timeout with Retry, never Thinking… for ever", async () => {
    vi.useFakeTimers();
    const pending = streamAsk(REQ, {}, { fetchImpl: async () => sse([frame("delta", { text: "Hmm" })], { hang: true }) });
    const assertion = expect(pending).rejects.toBeInstanceOf(AskTimeoutError);
    await vi.advanceTimersByTimeAsync(ASK_IDLE_TIMEOUT_MS + 1);
    await assertion;
    expect(chatErrorFor(new AskTimeoutError())).toMatchObject({ kind: "timeout", retry: true });
    expect(ASK_IDLE_TIMEOUT_MS).toBeGreaterThanOrEqual(25_000);
    expect(ASK_IDLE_TIMEOUT_MS).toBeLessThanOrEqual(35_000);
  });

  it("a fetch stuck before it starts (a session read deaf to the abort) still times out", async () => {
    vi.useFakeTimers();
    const pending = streamAsk(REQ, {}, { fetchImpl: () => new Promise<Response>(() => undefined) });
    const assertion = expect(pending).rejects.toBeInstanceOf(AskTimeoutError);
    await vi.advanceTimersByTimeAsync(ASK_IDLE_TIMEOUT_MS + 1);
    await assertion;
  });

  it("each byte resets the quiet clock: a slow but steady answer is not a timeout", async () => {
    vi.useFakeTimers();
    const enc = new TextEncoder();
    let push: ((s: string) => void) | null = null;
    let close: (() => void) | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => c.enqueue(enc.encode(s));
        close = () => c.close();
      },
    });
    const { seen, h } = recorder();
    const pending = streamAsk(REQ, h, { fetchImpl: async () => new Response(body, { status: 200 }) });
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(ASK_IDLE_TIMEOUT_MS - 1000);
      push!(frame("delta", { text: `${i}` }));
    }
    push!(frame("done", { model: "m", ms: 1 }));
    close!();
    await pending;
    expect(seen).toEqual(["delta:0", "delta:1", "delta:2", "delta:3", "done:m:-"]);
  });

  it("Stop: the caller's signal ends it as an AbortError, mid-stream or before", async () => {
    const ctrl = new AbortController();
    const { seen, h } = recorder();
    const pending = streamAsk(REQ, { ...h, onDelta: (t) => (seen.push(t), ctrl.abort()) }, { signal: ctrl.signal, fetchImpl: async () => sse([frame("delta", { text: "One" })], { hang: true }) });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual(["One"]);
    const already = new AbortController();
    already.abort();
    const fetchImpl = vi.fn(async () => sse([]));
    await expect(streamAsk(REQ, {}, { signal: already.signal, fetchImpl })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("an abort while the request is starting is an abort, not a network failure", async () => {
    const ctrl = new AbortController();
    const pending = streamAsk(REQ, {}, { signal: ctrl.signal, fetchImpl: () => new Promise<Response>(() => undefined) });
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
