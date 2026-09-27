import type { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { repairJsonEscapes } from "./sse";

/**
 * Text / vision models on OpenRouter for the non-Live routes. The app never calls an
 * image-GENERATION model: AI output is always text/LaTeX the client renders ("read, never paint").
 */
export const TEXT_MODELS = {
  fast: "google/gemini-3.5-flash",
} as const;

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits";

/** Thrown when OpenRouter reports the account is out of credits. */
export class CreditsExhaustedError extends Error {
  readonly status = 402;
  constructor(message = "Account credits depleted — please talk to Rushil to refill your account!") {
    super(message);
    this.name = "CreditsExhaustedError";
  }
}

/** Thrown for any other non-OK response from OpenRouter. */
export class UpstreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

const CREDITS_MESSAGE_RE =
  /insufficient (credit|balance|fund)|out of credit|exceeded.*credit|payment required/i;

/** Build the standard OpenRouter headers (auth + app attribution). */
export function openrouterHeaders(title = "Agathon Classroom Staging"): Record<string, string> {
  const env = getServerEnv();
  return {
    Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    "X-Title": title,
  };
}

export type OpenRouterChatOptions = {
  signal?: AbortSignal;
  requestId?: string;
  /** Optional X-Title override (shown in the OpenRouter activity log). */
  title?: string;
};

// Minimal shape of the parts of a chat completion response we read.
export type OpenRouterMessage = {
  role?: string;
  content?: unknown;
  text?: unknown;
};

export type OpenRouterChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{ message?: OpenRouterMessage; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { code?: number | string; message?: string };
};

/**
 * POST a chat-completions request to OpenRouter.
 * - 402 (or a credit-exhaustion message) -> CreditsExhaustedError
 * - any other non-OK response          -> UpstreamError(status, message)
 * The request `body` is sent as-is so routes keep full control of what the model sees.
 */
export async function openrouterChat(
  body: Record<string, unknown>,
  { signal, requestId, title }: OpenRouterChatOptions = {},
): Promise<OpenRouterChatResponse> {
  const headers = openrouterHeaders(title);
  if (requestId) headers["X-Request-Id"] = requestId;

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as OpenRouterChatResponse;
    const errMsg = (errorData?.error?.message || "").toString();
    const isOutOfCredits =
      response.status === 402 ||
      errorData?.error?.code === 402 ||
      CREDITS_MESSAGE_RE.test(errMsg.toLowerCase());

    if (isOutOfCredits) throw new CreditsExhaustedError();
    throw new UpstreamError(response.status, errMsg || `OpenRouter API error (${response.status})`);
  }

  return (await response.json()) as OpenRouterChatResponse;
}

/* ------------------------------------------------------------------------- */
/* Streaming + structured helpers (Live Math routes)                          */
/* ------------------------------------------------------------------------- */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: unknown };

export type StreamChatOptions = {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  temperature?: number;
  /** OpenRouter unified reasoning control (`reasoning: { effort }`). */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  maxTokens?: number;
  requestId?: string;
  title?: string;
};

type StreamDelta = {
  choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string | null }>;
  error?: { code?: number | string; message?: string };
};

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

async function throwForBadResponse(response: Response): Promise<never> {
  const errorData = (await response.json().catch(() => ({}))) as OpenRouterChatResponse;
  const errMsg = (errorData?.error?.message || "").toString();
  const isOutOfCredits =
    response.status === 402 ||
    errorData?.error?.code === 402 ||
    CREDITS_MESSAGE_RE.test(errMsg.toLowerCase());
  if (isOutOfCredits) throw new CreditsExhaustedError();
  throw new UpstreamError(response.status, errMsg || `OpenRouter API error (${response.status})`);
}

/**
 * Stream the text deltas of a chat completion (`stream: true`).
 * Parses `data:` frames, skips `:` comments (OpenRouter keep-alives) and `[DONE]`.
 * Errors: 402 -> CreditsExhaustedError, other non-OK -> UpstreamError (same as openrouterChat).
 * A mid-stream `error` frame also throws UpstreamError.
 */
export async function* streamChatText(opts: StreamChatOptions): AsyncGenerator<string, void, undefined> {
  const headers = openrouterHeaders(opts.title);
  if (opts.requestId) headers["X-Request-Id"] = opts.requestId;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
    provider: { sort: "latency" },
  };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!response.ok) await throwForBadResponse(response);
  if (!response.body) throw new UpstreamError(502, "OpenRouter returned an empty stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let frame: StreamDelta;
        try {
          frame = JSON.parse(payload) as StreamDelta;
        } catch {
          continue; // partial / malformed frame: ignore
        }
        if (frame.error) {
          const msg = frame.error.message || "OpenRouter stream error";
          if (frame.error.code === 402 || CREDITS_MESSAGE_RE.test(msg.toLowerCase())) throw new CreditsExhaustedError();
          throw new UpstreamError(typeof frame.error.code === "number" ? frame.error.code : 502, msg);
        }
        const content = frame.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) yield content;
      }
    }
  } finally {
    reader.releaseLock();
    // Make sure the upstream socket is released when the consumer stops early.
    await response.body.cancel().catch(() => undefined);
  }
}

export class WatchdogTimeoutError extends Error {
  constructor(model: string, ms: number) {
    super(`No content from ${model} within ${ms} ms`);
    this.name = "WatchdogTimeoutError";
  }
}

/**
 * Wrap a text stream with a first-byte watchdog: if no content arrives within `ms`
 * the upstream request is aborted and the generator throws WatchdogTimeoutError.
 */
async function* withFirstByteWatchdog(
  opts: StreamChatOptions,
  ms: number,
): AsyncGenerator<string, void, undefined> {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
  if (opts.signal?.aborted) controller.abort();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);

  const inner = streamChatText({ ...opts, signal: controller.signal });
  try {
    let first = true;
    for (;;) {
      let next: IteratorResult<string, void>;
      try {
        next = await inner.next();
      } catch (err) {
        if (timedOut) throw new WatchdogTimeoutError(opts.model, ms);
        throw err;
      }
      if (next.done) break;
      if (first) {
        clearTimeout(timer);
        first = false;
      }
      yield next.value;
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
    await inner.return(undefined).catch(() => undefined);
  }
}

export type FallbackStreamEvent = { type: "model"; model: string } | { type: "text"; text: string };

/**
 * Stream from `primary`; when nothing has arrived within `watchdogMs` (or the primary fails
 * before yielding any content) abort it and retry once on `fallback`.
 * Yields a `model` event first (which model is actually answering) and then `text` deltas.
 * Credits exhaustion and client aborts are never retried.
 */
export async function* streamWithFallback(
  primary: string,
  fallback: string,
  opts: Omit<StreamChatOptions, "model">,
  watchdogMs: number,
): AsyncGenerator<FallbackStreamEvent, void, undefined> {
  const attempt = async function* (model: string, guard: boolean): AsyncGenerator<string, void, undefined> {
    yield* guard ? withFirstByteWatchdog({ ...opts, model }, watchdogMs) : streamChatText({ ...opts, model });
  };

  let yieldedAny = false;
  yield { type: "model", model: primary };
  try {
    for await (const text of attempt(primary, true)) {
      yieldedAny = true;
      yield { type: "text", text };
    }
    return;
  } catch (err) {
    if (yieldedAny || err instanceof CreditsExhaustedError || opts.signal?.aborted || isAbortError(err)) throw err;
    if (!fallback || fallback === primary) throw err;
  }

  yield { type: "model", model: fallback };
  for await (const text of attempt(fallback, false)) yield { type: "text", text };
}

/** Strip ```json fences and surrounding prose from a model reply and return the first JSON object. */
export function extractJsonObject(text: string): string {
  const unfenced = text.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end < start) return unfenced;
  return unfenced.slice(start, end + 1);
}

export type ChatJsonOptions<S extends z.ZodTypeAny> = {
  model: string;
  messages: ChatMessage[];
  schema: S;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  requestId?: string;
  title?: string;
};

/**
 * Non-streaming chat completion with `response_format: { type: "json_object" }`, parsed and
 * validated with zod. Throws UpstreamError when the reply is not valid JSON for the schema.
 */
export async function chatJson<S extends z.ZodTypeAny>(opts: ChatJsonOptions<S>): Promise<z.infer<S>> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    response_format: { type: "json_object" },
    temperature: opts.temperature ?? 0,
  };
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

  const data = await openrouterChat(body, { signal: opts.signal, requestId: opts.requestId, title: opts.title });
  const raw = data.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? JSON.stringify(raw) : "";
  if (!text) throw new UpstreamError(502, "Model returned an empty response");

  let parsed: unknown;
  try {
    // Models write LaTeX in JSON with single backslashes: without the repair `\frac` parses as
    // a form feed + "rac" and `\times` as a tab + "imes" — silently (5 of 225 replies in the
    // model benchmark). The streaming routes already repair; this is the vision reader's path.
    parsed = JSON.parse(repairJsonEscapes(extractJsonObject(text)));
  } catch {
    throw new UpstreamError(502, "Model returned non-JSON output");
  }
  const result = opts.schema.safeParse(parsed);
  if (!result.success) {
    throw new UpstreamError(502, `Model output failed validation: ${result.error.issues[0]?.message ?? "invalid"}`);
  }
  return result.data;
}
