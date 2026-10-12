"use client";
/**
 * POST /api/live/ask from the panel (docs/ASK-V2.md, part "panel"): one ask, streamed. Built on
 * `streamLiveSse`'s pattern — an authed fetch, `SseFrameParser`, an idle timeout — but with a
 * handler per event (each frame zod-validated against the contract), because the panel paints
 * every word as it comes rather than waiting for a list of events.
 *
 * Errors, so the panel's one mapping (`chatErrorFor`) covers them all:
 *  - a JSON error response before the stream (signed out, rate limited, out of ink, bad request):
 *    the same ApiError `apiJson` throws (`apiErrorFromResponse`);
 *  - an `error` event once streaming: AskStreamError, with the route's code;
 *  - a stream that goes quiet for ASK_IDLE_TIMEOUT_MS: AskTimeoutError (named "TimeoutError");
 *  - the stream closing before `done`: AskStreamError `incomplete`;
 *  - the caller's signal: an AbortError (a Stop, a closed board), never reported as a failure.
 */
import { apiErrorFromResponse, authedFetch } from "@/lib/api-client";
import { abortable } from "../abortable";
import { SseFrameParser, type FetchLike, type RawSseFrame } from "../sseClient";
import {
  ASK_EVENTS,
  ASK_PATH,
  AskActionsEventSchema,
  AskDeltaEventSchema,
  AskDoneEventSchema,
  AskErrorEventSchema,
  AskModelEventSchema,
  AskReplyEventSchema,
  type AskActionsEvent,
  type AskDoneEvent,
  type AskErrorEvent,
  type AskRequest,
} from "./contracts";

export interface AskStreamHandlers {
  onModel?(model: string): void;
  /** reply text as it is written */
  onDelta?(text: string): void;
  /** the reply as finally shown (replaces what the deltas built) */
  onReply?(text: string): void;
  onActions?(event: AskActionsEvent): void;
  onDone?(event: AskDoneEvent): void;
}

export interface AskStreamOptions {
  signal?: AbortSignal;
  /** tests: a fake fetch (default: `authedFetch`) */
  fetchImpl?: FetchLike;
  /** see ASK_IDLE_TIMEOUT_MS */
  idleTimeoutMs?: number;
}

/**
 * How long the stream may go without a byte. The route pings while the model thinks and its
 * first-content watchdog hands a slow model to the fallback in about 5 s, so 30 s of silence is a
 * stalled connection (an iPad's Wi-Fi dropping mid-answer): the ask fails as a timeout the kid can
 * retry, never "Thinking…" for ever.
 */
export const ASK_IDLE_TIMEOUT_MS = 30_000;

/** An `error` event from the route (or the stream closing before `done`: code `incomplete`). */
export class AskStreamError extends Error {
  constructor(readonly event: AskErrorEvent) {
    super(event.message);
    this.name = "AskStreamError";
  }
}

/** The stream went silent for ASK_IDLE_TIMEOUT_MS (`chatErrorFor` reads the name: a timeout, retryable). */
export class AskTimeoutError extends Error {
  constructor() {
    super("The tutor stopped answering");
    this.name = "TimeoutError";
  }
}

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

/**
 * Hands one frame to its handler. Answers true on `done`; throws AskStreamError on `error`. A
 * frame that does not parse, or an event this client does not know, is skipped: a newer route may
 * send more than this tab understands.
 */
function dispatch(frame: RawSseFrame, h: AskStreamHandlers): boolean {
  let json: unknown;
  try {
    json = JSON.parse(frame.data);
  } catch {
    return false;
  }
  switch (frame.event) {
    case ASK_EVENTS.model: {
      const p = AskModelEventSchema.safeParse(json);
      if (p.success) h.onModel?.(p.data.model);
      return false;
    }
    case ASK_EVENTS.delta: {
      const p = AskDeltaEventSchema.safeParse(json);
      if (p.success && p.data.text) h.onDelta?.(p.data.text);
      return false;
    }
    case ASK_EVENTS.reply: {
      const p = AskReplyEventSchema.safeParse(json);
      if (p.success) h.onReply?.(p.data.text);
      return false;
    }
    case ASK_EVENTS.actions: {
      const p = AskActionsEventSchema.safeParse(json);
      if (p.success) h.onActions?.(p.data);
      return false;
    }
    case ASK_EVENTS.done: {
      const p = AskDoneEventSchema.safeParse(json);
      h.onDone?.(p.success ? p.data : { model: "", ms: 0 });
      return true;
    }
    case ASK_EVENTS.error: {
      const p = AskErrorEventSchema.safeParse(json);
      throw new AskStreamError(p.success ? p.data : { code: "upstream", message: "The tutor ran into a problem" });
    }
    default:
      return false;
  }
}

/** Streams one ask. Resolves on `done`; rejects with an ApiError (before the stream), an AskStreamError (`error` event), a timeout, or an AbortError. */
export async function streamAsk(req: AskRequest, handlers: AskStreamHandlers, opts: AskStreamOptions = {}): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? authedFetch;
  // one controller for the request: the caller's abort and the idle timer both end it
  const ctrl = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const onAbort = () => {
    ctrl.abort();
    // a body deaf to the abort still ends: the pending read resolves `done`
    reader?.cancel().catch(() => {});
  };
  if (opts.signal?.aborted) throw abortError();
  opts.signal?.addEventListener("abort", onAbort);
  let timedOut = false;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const armIdle = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
      // a body that ignores the abort still ends: the pending read resolves or rejects
      reader?.cancel().catch(() => {});
    }, opts.idleTimeoutMs ?? ASK_IDLE_TIMEOUT_MS);
  };
  /** what a failure means: the caller stopped it, it went quiet, or what it was */
  const settle = (err: unknown): unknown => {
    if (opts.signal?.aborted) return abortError();
    if (timedOut) return new AskTimeoutError();
    return err;
  };
  try {
    armIdle();
    let res: Response;
    try {
      // raced against the abort as well: authedFetch's session read happens before fetch sees it
      res = await abortable(
        fetchImpl(ASK_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(req),
          signal: ctrl.signal,
        }),
        ctrl.signal,
      );
    } catch (err) {
      throw settle(err);
    }
    if (!res.ok) throw await apiErrorFromResponse(res);
    if (!res.body) throw new AskStreamError({ code: "incomplete", message: "The answer was cut off" });
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseFrameParser();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (opts.signal?.aborted) throw abortError();
        if (timedOut) throw new AskTimeoutError();
        armIdle();
        const frames = done ? parser.flush() : parser.push(decoder.decode(value, { stream: true }));
        for (const frame of frames) if (dispatch(frame, handlers)) return;
        if (done) throw new AskStreamError({ code: "incomplete", message: "The answer was cut off" });
      }
    } catch (err) {
      if (err instanceof AskStreamError || err instanceof AskTimeoutError) throw err;
      throw settle(err);
    } finally {
      reader.cancel().catch(() => {
        /* already closed */
      });
    }
  } finally {
    if (idle) clearTimeout(idle);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
