/**
 * The Ask eval's model call, streamed the way the route streams it: `streamChatText` (the app's own
 * OpenRouter stream, with `withProviderPrivacy`: ZDR endpoints only, no prompt collection) on one
 * model, its text through `AskStreamSplitter` as it comes. So the time to the first words a kid
 * sees (`ttftMs`) is real: the first reply text the splitter lets through, not the first byte.
 *
 * Like the model bench's client (../models/client.ts) every answer is cached on disk by its
 * request (a rerun costs nothing and reports the times measured the first time), and every call is
 * held under the eval's spend cap: its worst case reserved before, its real cost (`usage.cost`, from
 * the stream's last frame) settled after. `streamChatText` does not hand the usage frame on, so a
 * tap on `fetch` reads it from a copy of the stream (`tee`), matched by the request id.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AskStreamSplitter } from "@/lib/live/ask/splitter";
import { OPENROUTER_CHAT_URL, streamChatText, withProviderPrivacy, type ChatMessage } from "@/lib/server/openrouter";
import { MODELS_CACHE_DIR, worstCaseUsd, type BenchMessage, type CallContext } from "../models/client";

export interface AskStreamSpec {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  reasoning?: "none" | "minimal" | "low";
  timeoutMs: number;
}

export interface AskStreamRecord {
  model: string;
  key: string;
  ok: boolean;
  error?: string;
  /** the whole answer as streamed (reply and board block) */
  content: string;
  /** the reply as the splitter let it through, and the board block's JSON (null: none) */
  reply: string;
  board: string | null;
  overflow: boolean;
  /** first content from the model; first reply text a kid would see; the whole stream */
  firstTokenMs: number | null;
  ttftMs: number | null;
  totalMs: number;
  promptTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costUsd: number;
  costSource: "usage" | "reserved" | "none";
  provider?: string;
  attempts: number;
  at: string;
  cached: boolean;
}

interface UsageFrame {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  provider?: string;
}

const waiting = new Map<string, (u: UsageFrame) => void>();
let tapped = false;

/** Reads the SSE frames of a stream copy for the last `usage` and the provider. */
async function readUsage(body: ReadableStream<Uint8Array>): Promise<UsageFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const out: UsageFrame = {};
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const frame = JSON.parse(payload) as UsageFrame;
          if (frame.usage) out.usage = frame.usage;
          if (frame.provider) out.provider = frame.provider;
        } catch {
          // a partial frame: ignore
        }
      }
    }
  } catch {
    // the stream broke off: what was read so far
  }
  return out;
}

/** Puts the usage tap on `fetch` (once): a chat completion with a request id someone waits for is read twice. */
function tapFetch(): void {
  if (tapped) return;
  tapped = true;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const res = await real(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const id = new Headers(init?.headers).get("X-Request-Id");
    const done = id ? waiting.get(id) : undefined;
    if (url !== OPENROUTER_CHAT_URL || !done || !res.ok || !res.body) return res;
    const [mine, theirs] = res.body.tee();
    void readUsage(theirs).then(done);
    return new Response(mine, { status: res.status, statusText: res.statusText, headers: res.headers });
  }) as typeof fetch;
}

/** The `fetchImpl` for the bench client's calls (repairs, the judge): the app's provider privacy on every body. */
export const privateFetch: typeof fetch = (input, init) => {
  if (typeof init?.body === "string") {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    return globalThis.fetch(input, { ...init, body: JSON.stringify(withProviderPrivacy(body)) });
  }
  return globalThis.fetch(input, init);
};

export function askStreamKey(spec: AskStreamSpec): string {
  return createHash("sha1")
    .update(JSON.stringify({ v: 1, model: spec.model, messages: spec.messages, maxTokens: spec.maxTokens, reasoning: spec.reasoning ?? null }))
    .digest("hex");
}

const cacheFile = (dir: string, model: string, key: string) => join(dir, "ask", model.replace(/[^a-zA-Z0-9._-]+/g, "_"), `${key}.json`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The cached answer to exactly this request, or null. */
export function cachedAskStream(spec: AskStreamSpec, cacheDir = MODELS_CACHE_DIR): AskStreamRecord | null {
  const file = cacheFile(cacheDir, spec.model, askStreamKey(spec));
  return existsSync(file) ? { ...(JSON.parse(readFileSync(file, "utf8")) as AskStreamRecord), cached: true } : null;
}

/** One streamed ask: from the cache, or over the network (one retry when nothing came), under the spend cap. */
export async function streamAsk(spec: AskStreamSpec, ctx: CallContext): Promise<AskStreamRecord> {
  const cacheDir = ctx.cacheDir ?? MODELS_CACHE_DIR;
  const key = askStreamKey(spec);
  const file = cacheFile(cacheDir, spec.model, key);
  if (existsSync(file)) return { ...(JSON.parse(readFileSync(file, "utf8")) as AskStreamRecord), cached: true };
  const info = ctx.catalog.get(spec.model);
  const base = { model: spec.model, key, content: "", reply: "", board: null, overflow: false, firstTokenMs: null, ttftMs: null, totalMs: 0, promptTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, completionTokens: 0, reasoningTokens: 0, cached: false };
  if (!info) return { ...base, ok: false, error: "model not in the OpenRouter catalog", costUsd: 0, costSource: "none", attempts: 0, at: new Date().toISOString() };
  tapFetch();

  let record: AskStreamRecord | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const worst = worstCaseUsd({ model: spec.model, messages: spec.messages as BenchMessage[], maxTokens: spec.maxTokens, json: false, reasoning: null, timeoutMs: spec.timeoutMs }, info);
    if (!ctx.ledger.reserve(worst)) {
      return { ...base, ok: false, error: `spend cap $${ctx.ledger.capUsd.toFixed(2)} reached`, costUsd: 0, costSource: "none", attempts: attempt - 1, at: new Date().toISOString() };
    }
    const requestId = `ask-eval-${key.slice(0, 10)}-${attempt}-${Date.now().toString(36)}`;
    const usage = new Promise<UsageFrame>((resolve) => waiting.set(requestId, resolve));
    const splitter = new AskStreamSplitter();
    let content = "";
    let firstTokenMs: number | null = null;
    let ttftMs: number | null = null;
    let error: string | undefined;
    const started = performance.now();
    try {
      for await (const chunk of streamChatText({
        model: spec.model,
        messages: spec.messages,
        maxTokens: spec.maxTokens,
        reasoningEffort: spec.reasoning,
        requestId,
        title: "Agathon eval - ask",
        signal: AbortSignal.timeout(spec.timeoutMs),
      })) {
        const now = performance.now() - started;
        if (firstTokenMs === null) firstTokenMs = now;
        content += chunk;
        if (splitter.push(chunk).trim() && ttftMs === null) ttftMs = now;
      }
    } catch (err) {
      error = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 300) : String(err);
    }
    const totalMs = performance.now() - started;
    const end = splitter.end();
    if (end.tail.trim() && ttftMs === null) ttftMs = totalMs;
    // the usage frame is the stream's last; a broken stream may never send it
    const frame = await Promise.race([usage, sleep(error ? 1_000 : 8_000).then(() => ({}) as UsageFrame)]);
    waiting.delete(requestId);
    const u = frame.usage;
    const costUsd = typeof u?.cost === "number" ? u.cost : error ? worst : 0;
    ctx.ledger.settle(spec.model, worst, costUsd);
    record = {
      ...base,
      ok: !error && content.trim().length > 0,
      error: error ?? (content.trim() ? undefined : "empty answer"),
      content,
      reply: end.reply,
      board: end.board,
      overflow: splitter.overflow,
      firstTokenMs: firstTokenMs === null ? null : Math.round(firstTokenMs),
      ttftMs: ttftMs === null ? null : Math.round(ttftMs),
      totalMs: Math.round(totalMs),
      promptTokens: u?.prompt_tokens ?? 0,
      cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: u?.prompt_tokens_details?.cache_write_tokens ?? 0,
      completionTokens: u?.completion_tokens ?? 0,
      reasoningTokens: u?.completion_tokens_details?.reasoning_tokens ?? 0,
      costUsd,
      costSource: typeof u?.cost === "number" ? "usage" : error ? "reserved" : "none",
      provider: frame.provider,
      attempts: attempt,
      at: new Date().toISOString(),
    };
    // nothing came at all (a 429, a 5xx, a dropped connection): once more
    if (record.ok || content.length > 0 || attempt === 2) break;
    await sleep(2_000);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(record) + "\n");
  return record!;
}
