import type { z } from "zod";
import { getServerEnv } from "@/lib/env";

/**
 * Image-generation models on OpenRouter (verified against /api/v1/models on 2026-09-11).
 * Note: `openai/gpt-image-1` does NOT exist on OpenRouter; the GPT option maps to gpt-5.4-image-2.
 */
export const IMAGE_MODELS = {
  gemini: "google/gemini-3-pro-image-preview",
  "gemini-fast": "google/gemini-2.5-flash-image",
  gpt: "openai/gpt-5.4-image-2",
} as const;

export type ImageModelKey = keyof typeof IMAGE_MODELS;

/** Text / vision models on OpenRouter used by the non-image routes. */
export const TEXT_MODELS = {
  fast: "google/gemini-3.5-flash",
  cheap: "google/gemini-3.1-flash-lite",
  helpCheck: "openai/gpt-4.1-mini",
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
  images?: unknown;
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

/**
 * Pull a generated image (data URL or https URL) out of a chat message as
 * flexibly as possible — providers structure image outputs differently.
 * Mirrors the extraction logic that generate-solution has always used.
 */
export function extractImageUrl(message: OpenRouterMessage | undefined | null): string | null {
  let imageUrl: string | null = null;

  // 1) Legacy / hypothetical format: message.images[0].image_url.url
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacyImages = (message as any)?.images;
  if (Array.isArray(legacyImages) && legacyImages.length > 0) {
    const first = legacyImages[0];
    imageUrl = first?.image_url?.url ?? first?.url ?? null;
  }

  // 2) OpenAI-style content array: look for any image-like item
  if (!imageUrl) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (message as any)?.content;

    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === "image_url" && part.image_url?.url) {
          imageUrl = part.image_url.url;
          break;
        }
        if (part?.type === "output_image" && (part.url || part.image_url?.url)) {
          imageUrl = part.url || part.image_url?.url;
          break;
        }
      }
    } else if (typeof content === "string") {
      // 3) Fallback: scan text content for a plausible image URL or data URL
      const text: string = content;
      const dataUrlMatch = text.match(/data:image\/[a-zA-Z+]+;base64,[^\s")'}]+/);
      const httpUrlMatch = text.match(/https?:\/\/[^\s")'}]+?\.(?:png|jpg|jpeg|gif|webp)/i);

      if (dataUrlMatch) {
        imageUrl = dataUrlMatch[0];
      } else if (httpUrlMatch) {
        imageUrl = httpUrlMatch[0];
      }
    }
  }

  return imageUrl;
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
    parsed = JSON.parse(extractJsonObject(text));
  } catch {
    throw new UpstreamError(502, "Model returned non-JSON output");
  }
  const result = opts.schema.safeParse(parsed);
  if (!result.success) {
    throw new UpstreamError(502, `Model output failed validation: ${result.error.issues[0]?.message ?? "invalid"}`);
  }
  return result.data;
}
