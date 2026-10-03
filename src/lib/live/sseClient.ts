"use client";

import { apiErrorFromResponse, authedFetch } from "@/lib/api-client";
import {
  AnnotationSchema,
  SolveStepSchema,
  SseDoneSchema,
  SseErrorSchema,
  SseMetaSchema,
  type LiveSseEvent,
} from "./contracts";

/**
 * SSE client for /api/live/check and /api/live/solve: POST via authedFetch, parse
 * `event:` / `data:` frames incrementally from the ReadableStream, yield typed
 * LiveSseEvent values (validated with the shared zod schemas). Abortable.
 */

export interface RawSseFrame {
  event: string;
  data: string;
}

/** Incremental SSE frame parser; feed text chunks, get completed frames back. */
export class SseFrameParser {
  private buffer = "";
  private event = "";
  private data: string[] = [];

  push(chunk: string): RawSseFrame[] {
    this.buffer += chunk;
    const frames: RawSseFrame[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const frame = this.consumeLine(line);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  /** Call at end of stream: dispatches a trailing frame without a final blank line. */
  flush(): RawSseFrame[] {
    const frames: RawSseFrame[] = [];
    if (this.buffer.length > 0) {
      const frame = this.consumeLine(this.buffer.replace(/\r$/, ""));
      this.buffer = "";
      if (frame) frames.push(frame);
    }
    const last = this.dispatch();
    if (last) frames.push(last);
    return frames;
  }

  private consumeLine(line: string): RawSseFrame | null {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    // id / retry are ignored
    return null;
  }

  private dispatch(): RawSseFrame | null {
    if (this.data.length === 0 && this.event === "") return null;
    const frame: RawSseFrame = { event: this.event || "message", data: this.data.join("\n") };
    this.event = "";
    this.data = [];
    return frame.data === "" && frame.event === "message" ? null : frame;
  }
}

/** Validates a raw frame against the live contracts; unknown/invalid frames yield null. */
export function toLiveSseEvent(frame: RawSseFrame): LiveSseEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(frame.data);
  } catch {
    return null;
  }
  switch (frame.event) {
    case "meta": {
      const p = SseMetaSchema.safeParse(json);
      return p.success ? { event: "meta", data: p.data } : null;
    }
    case "annotation": {
      const p = AnnotationSchema.safeParse(json);
      return p.success ? { event: "annotation", data: p.data } : null;
    }
    case "step": {
      const p = SolveStepSchema.safeParse(json);
      return p.success ? { event: "step", data: p.data } : null;
    }
    case "done": {
      const p = SseDoneSchema.safeParse(json);
      return p.success ? { event: "done", data: p.data } : null;
    }
    case "error": {
      const p = SseErrorSchema.safeParse(json);
      return p.success ? { event: "error", data: p.data } : null;
    }
    default:
      return null;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StreamOptions {
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  /** see SSE_IDLE_TIMEOUT_MS */
  idleTimeoutMs?: number;
}

/**
 * How long a stream may go without a byte. The routes send a `: ping` every 15 s while the model
 * thinks (SSE_PING_MS) and the platform ends them at their maxDuration, so silence this long is a
 * stalled connection (an iPad's Wi-Fi dropping mid-check): the call fails as a timeout the student
 * can retry, instead of "Checking…" / "Solving…" for ever.
 */
export const SSE_IDLE_TIMEOUT_MS = 45_000;

/** A stream that went silent for SSE_IDLE_TIMEOUT_MS (classified as `timeout`, retryable). */
export class SseTimeoutError extends Error {
  constructor() {
    super("The tutor stopped answering");
    this.name = "TimeoutError";
  }
}

/**
 * POSTs `body` and yields typed events until `done`, `error`, the stream closes, or
 * `signal` aborts (the generator then returns quietly). Non-2xx responses throw ApiError
 * so callers can reuse the shared error handling; a stream silent for `idleTimeoutMs`
 * (before the response or between chunks) throws SseTimeoutError.
 */
export async function* streamLiveSse(
  path: string,
  body: unknown,
  opts: StreamOptions = {},
): AsyncGenerator<LiveSseEvent, void, undefined> {
  const fetchImpl = opts.fetchImpl ?? authedFetch;
  // One controller for the request: the caller's abort and the idle timer both end it.
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (opts.signal?.aborted) ctrl.abort();
  else opts.signal?.addEventListener("abort", onAbort);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let timedOut = false;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const armIdle = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
      // a body that ignores the abort still ends: the pending read resolves `done`
      reader?.cancel().catch(() => {});
    }, opts.idleTimeoutMs ?? SSE_IDLE_TIMEOUT_MS);
  };
  try {
    armIdle();
    let res: Response;
    try {
      res = await fetchImpl(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      if (timedOut) throw new SseTimeoutError();
      throw err;
    }
    if (!res.ok) throw await apiErrorFromResponse(res);
    if (!res.body) return;
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseFrameParser();
    try {
      for (;;) {
        if (opts.signal?.aborted) return;
        const { value, done } = await reader.read();
        if (timedOut) throw new SseTimeoutError();
        armIdle();
        const frames = done ? parser.flush() : parser.push(decoder.decode(value, { stream: true }));
        for (const frame of frames) {
          const ev = toLiveSseEvent(frame);
          if (!ev) continue;
          yield ev;
          if (ev.event === "done" || ev.event === "error") return;
        }
        if (done) return;
      }
    } catch (err) {
      if (opts.signal?.aborted) return;
      if (timedOut && !(err instanceof SseTimeoutError)) throw new SseTimeoutError();
      throw err;
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
    }
  } finally {
    if (idle) clearTimeout(idle);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
