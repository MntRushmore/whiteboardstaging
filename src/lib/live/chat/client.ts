"use client";

import { apiJson } from "@/lib/api-client";
import type { CallOptions } from "../modelCalls";
import type { FetchJson } from "../recognizeClient";
import { ChatResponseSchema, type ChatRequest, type ChatResponse } from "./contracts";

/** POST /api/live/chat: a typed request → a short reply and the actions for the board. */
export const CHAT_PATH = "/api/live/chat";

export async function requestChat(req: ChatRequest, opts: CallOptions = {}, fetchJson: FetchJson = apiJson as FetchJson): Promise<ChatResponse> {
  const parsed = ChatResponseSchema.safeParse(await fetchJson(CHAT_PATH, req, { signal: opts.signal }));
  if (!parsed.success) throw new Error("The chat returned an unexpected response");
  return parsed.data;
}
