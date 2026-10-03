"use client";

import { apiJson } from "@/lib/api-client";
import { abortable } from "../abortable";
import type { CallOptions } from "../modelCalls";
import type { FetchJson } from "../recognizeClient";
import { ChatResponseSchema, type ChatRequest, type ChatResponse } from "./contracts";

/** POST /api/live/chat: a typed request → a short reply and the actions for the board. */
export const CHAT_PATH = "/api/live/chat";

/**
 * The route ends a request at its 45 s maxDuration; a reply that has not come by this is a stalled
 * connection, and the panel says so (with Retry) instead of "Thinking…" for ever.
 */
export const CHAT_TIMEOUT_MS = 60_000;

/** The chat request outlived CHAT_TIMEOUT_MS. */
export class ChatTimeoutError extends Error {
  constructor() {
    super("The tutor took too long to answer");
    this.name = "TimeoutError";
  }
}

export async function requestChat(
  req: ChatRequest,
  opts: CallOptions & { timeoutMs?: number } = {},
  fetchJson: FetchJson = apiJson as FetchJson,
): Promise<ChatResponse> {
  // a controller of our own (not AbortSignal.timeout: iPadOS 15 has none) the caller's signal also ends
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (opts.signal?.aborted) ctrl.abort();
  else opts.signal?.addEventListener("abort", onAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs ?? CHAT_TIMEOUT_MS);
  try {
    // raced against the abort as well: authedFetch's session read happens before fetch sees it
    const parsed = ChatResponseSchema.safeParse(await abortable(fetchJson(CHAT_PATH, req, { signal: ctrl.signal }), ctrl.signal));
    if (!parsed.success) throw new Error("The chat returned an unexpected response");
    return parsed.data;
  } catch (err) {
    throw timedOut ? new ChatTimeoutError() : err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
