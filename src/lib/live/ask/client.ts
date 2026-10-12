"use client";
/**
 * POST /api/live/ask from the panel (docs/ASK-V2.md, part "panel"). CONTRACT STUB: the panel part
 * writes it on `streamLiveSse`'s pattern (authed fetch, SseFrameParser, an idle timeout), mapping a
 * JSON error response before the stream to the usual ApiError.
 */
import type { AskActionsEvent, AskDoneEvent, AskErrorEvent, AskRequest } from "./contracts";

export interface AskStreamHandlers {
  onModel?(model: string): void;
  /** reply text as it is written */
  onDelta?(text: string): void;
  /** the reply as finally shown (replaces what the deltas built) */
  onReply?(text: string): void;
  onActions?(event: AskActionsEvent): void;
  onDone?(event: AskDoneEvent): void;
}

/** Streams one ask. Resolves on `done`; rejects with an ApiError (before the stream), an AskStreamError (`error` event), or a timeout. */
export async function streamAsk(_req: AskRequest, _handlers: AskStreamHandlers, _opts: { signal?: AbortSignal } = {}): Promise<void> {
  throw new Error("streamAsk is not built yet");
}

/** An `error` event from the route. */
export class AskStreamError extends Error {
  constructor(readonly event: AskErrorEvent) {
    super(event.message);
    this.name = "AskStreamError";
  }
}
