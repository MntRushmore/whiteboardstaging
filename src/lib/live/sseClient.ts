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
}

/**
 * POSTs `body` and yields typed events until `done`, `error`, the stream closes, or
 * `signal` aborts (the generator then returns quietly). Non-2xx responses throw ApiError
 * so callers can reuse the shared error handling.
 */
export async function* streamLiveSse(
  path: string,
  body: unknown,
  opts: StreamOptions = {},
): AsyncGenerator<LiveSseEvent, void, undefined> {
  const fetchImpl = opts.fetchImpl ?? authedFetch;
  const res = await fetchImpl(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) throw await apiErrorFromResponse(res);
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseFrameParser();
  try {
    for (;;) {
      if (opts.signal?.aborted) return;
      const { value, done } = await reader.read();
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
    throw err;
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
}
