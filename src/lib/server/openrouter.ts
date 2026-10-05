import type { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { recordEvent } from "@/lib/server/events";
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

/**
 * Provider preferences on EVERY request this server sends to OpenRouter: what goes in is a child's
 * work (pictures of their board, their handwriting read as maths, their chat messages).
 *  - `data_collection: "deny"`: only providers that do not store prompts to train on them.
 *  - `zdr: true`: only Zero Data Retention endpoints, which keep nothing at all once they answer
 *    (OpenRouter's own list: GET /api/v1/endpoints/zdr). Stronger than the first: it also rules out
 *    the 30-day "abuse monitoring" copies some first-party APIs keep.
 * OpenRouter itself keeps no prompts unless the account opts in to input/output logging, which
 * must stay off (openrouter.ai/settings/privacy; the go-live checklist in docs/RUNBOOK-billing.md).
 * Every model in LIVE_MODELS answers this way (a real call per model on 2026-10-03, with the
 * provider that served it: `npm run eval:privacy`, docs/eval/privacy.md); a model with no ZDR
 * endpoint is refused with a 404 ("No endpoints found matching your data policy"), never sent to
 * a provider that keeps data, so a new model must pass that probe before it ships. Applied
 * in the two functions that POST (openrouterChat, streamChatText), so no caller can leave it out;
 * a caller's own `provider` preferences (`sort: "latency"`) are kept, these always win.
 */
export const PROVIDER_PRIVACY = { data_collection: "deny", zdr: true } as const;

/** `body` with PROVIDER_PRIVACY merged into its `provider` preferences (a copy; the caller's object is untouched). */
export function withProviderPrivacy(body: Record<string, unknown>): Record<string, unknown> {
  const own = body.provider && typeof body.provider === "object" && !Array.isArray(body.provider) ? (body.provider as Record<string, unknown>) : {};
  return { ...body, provider: { ...own, ...PROVIDER_PRIVACY } };
}

/**
 * Thrown when OpenRouter reports the OPERATOR's account is out of credits (its own billing, not
 * the student's ink). Routes answer it with a 503 (request.ts `errorResponse`), never a 402: the
 * student cannot fix it by buying ink. The message is for the logs only.
 */
export class CreditsExhaustedError extends Error {
  readonly status = 402;
  constructor(message = "OpenRouter reports the account is out of credits: top it up.") {
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
export function openrouterHeaders(title = "Agathon"): Record<string, string> {
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
  /** The provider that served the request (e.g. "Google", "Azure"). */
  provider?: string;
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
    body: JSON.stringify(withProviderPrivacy(body)),
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
    body: JSON.stringify(withProviderPrivacy(body)),
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

/* ------------------------------------------------------------------------- */
/* Model failures as app events (the /admin page's AI routes)                 */
/* ------------------------------------------------------------------------- */

/**
 * The X-Title words that are not the route's own name: the setup route's figure read
 * ("Agathon Live - figure") and the title route's "board title".
 */
const MODEL_ROUTE_ALIASES: Record<string, string> = { figure: "setup", board: "title" };

/**
 * An event's `kind` for a model call: `model.<route>`, the route named like usage_events.route
 * with `.` for `/` (`live/solve` -> `model.live.solve`), read from the X-Title every Live call
 * sends ("Agathon Live - solve", "Agathon Live - chat proof" -> `model.live.chat`). The fallback
 * helpers know no route otherwise, and the title is already set at every call. `model.other`
 * without one.
 */
export function modelEventKind(title: string | undefined): string {
  const word = /^Agathon Live - ([a-z]+)/i.exec(title ?? "")?.[1]?.toLowerCase();
  return word ? `model.live.${MODEL_ROUTE_ALIASES[word] ?? word}` : "model.other";
}

/**
 * Why a model call failed, as an event's code: `credits` (the operator's OpenRouter account is
 * empty), `timeout` (the first-byte watchdog, or the per-attempt timeout's 504), `invalid` (it
 * answered, but not JSON or not the schema), else `upstream` (an error status, a network failure).
 */
export function modelFailureCode(err: unknown): "credits" | "timeout" | "invalid" | "upstream" {
  if (err instanceof CreditsExhaustedError) return "credits";
  if (err instanceof WatchdogTimeoutError) return "timeout";
  if (err instanceof UpstreamError) {
    if (err.status === 504) return "timeout";
    // chatJson's own wording for a reply it could not use
    if (/^Model (returned|output)/.test(err.message)) return "invalid";
    return "upstream";
  }
  if (err instanceof Error && err.name === "TimeoutError") return "timeout";
  return "upstream";
}

/** One fallback-wrapped call, for its events. */
type ModelCall = { primary: string; fallback: string; title?: string; requestId?: string; startedAt: number };

const errorText = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 200);

/** What the call was for, from its title ("chat proof"), so `meta` tells a route's calls apart. */
const callName = (title: string | undefined) => title?.replace(/^Agathon Live - /, "").slice(0, 40);

/** The primary failed and the fallback answered: a warn, code `fallback` (fire and forget). */
function recordModelFallback(call: ModelCall, primaryErr: unknown, primaryMs: number): void {
  const reason = modelFailureCode(primaryErr);
  recordEvent({
    source: "server",
    level: "warn",
    kind: modelEventKind(call.title),
    code: "fallback",
    message: `${call.primary} failed (${reason}); ${call.fallback} answered`,
    requestId: call.requestId,
    meta: {
      primary: call.primary,
      fallback: call.fallback,
      call: callName(call.title),
      reason,
      primaryMs,
      ms: Date.now() - call.startedAt,
      error: errorText(primaryErr),
    },
  });
}

/**
 * A call that failed for good: both models (`both`, after `primaryErr`), the only one there was
 * (`only`: no distinct fallback, or out of credits, which is never retried), or a model that broke
 * off after it had started answering (`mid-answer`, never retried). An error, code from
 * `modelFailureCode`. A caller that went away is never recorded.
 */
function recordModelFailure(call: ModelCall, model: string, err: unknown, how: "both" | "only" | "mid-answer", primaryErr?: unknown): void {
  const code = modelFailureCode(err);
  const message =
    code === "credits"
      ? "OpenRouter is out of credits"
      : how === "both"
        ? `${call.primary} and ${call.fallback} both failed`
        : how === "mid-answer"
          ? `${model} failed mid-answer`
          : `${model} failed`;
  recordEvent({
    source: "server",
    level: "error",
    kind: modelEventKind(call.title),
    code,
    message,
    requestId: call.requestId,
    meta: {
      model,
      primary: call.primary,
      fallback: call.fallback,
      call: callName(call.title),
      ms: Date.now() - call.startedAt,
      error: errorText(err),
      ...(primaryErr === undefined ? {} : { primaryCode: modelFailureCode(primaryErr), primaryError: errorText(primaryErr) }),
    },
  });
}

export type FallbackStreamEvent = { type: "model"; model: string } | { type: "text"; text: string };

/**
 * Stream from `primary`; when nothing has arrived within `watchdogMs` (or the primary fails
 * before yielding any content) abort it and retry once on `fallback`.
 * Yields a `model` event first (which model is actually answering) and then `text` deltas.
 * Credits exhaustion and client aborts are never retried.
 *
 * App events (`model.<route>`, fire and forget): a warn `fallback` once the fallback answers, and
 * an error when the call fails for good (both models, the only one, or mid-answer); nothing when
 * the client went away.
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
  const call: ModelCall = { primary, fallback, title: opts.title, requestId: opts.requestId, startedAt: Date.now() };
  const callerLeft = (err: unknown) => Boolean(opts.signal?.aborted) || isAbortError(err);

  let yieldedAny = false;
  let primaryErr: unknown;
  yield { type: "model", model: primary };
  try {
    for await (const text of attempt(primary, true)) {
      yieldedAny = true;
      yield { type: "text", text };
    }
    return;
  } catch (err) {
    if (callerLeft(err)) throw err;
    if (yieldedAny || err instanceof CreditsExhaustedError || !fallback || fallback === primary) {
      recordModelFailure(call, primary, err, yieldedAny ? "mid-answer" : "only");
      throw err;
    }
    primaryErr = err;
  }
  const primaryMs = Date.now() - call.startedAt;

  yield { type: "model", model: fallback };
  let answered = false;
  try {
    for await (const text of attempt(fallback, false)) {
      if (!answered) {
        answered = true;
        recordModelFallback(call, primaryErr, primaryMs);
      }
      yield { type: "text", text };
    }
  } catch (err) {
    if (!callerLeft(err)) recordModelFailure(call, fallback, err, answered ? "mid-answer" : "both", primaryErr);
    throw err;
  }
  // an empty answer is still the fallback answering
  if (!answered) recordModelFallback(call, primaryErr, primaryMs);
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
  /** OpenRouter unified reasoning control; omitted when unset (the model's default). */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** `provider.sort: latency`, as the Live streams route (the model bench measured this way). */
  latencyFirst?: boolean;
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
  if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };
  if (opts.latencyFirst) body.provider = { sort: "latency" };

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

export type ChatJsonFallbackOptions<S extends z.ZodTypeAny> = Omit<ChatJsonOptions<S>, "model" | "reasoningEffort"> & {
  /** reasoning effort per model (Anthropic models take none: their thinking budget starts at 1024 tokens) */
  reasoningFor?: (model: string) => ChatJsonOptions<S>["reasoningEffort"];
  /** abort one attempt after this long and try the fallback (the caller's signal still ends both) */
  attemptTimeoutMs: number;
};

/**
 * `chatJson` on `primary`, then once on `fallback` when the primary fails or times out — the
 * non-streaming twin of `streamWithFallback`. Out-of-credits and a caller abort are never
 * retried. Resolves with the parsed reply and the model that produced it.
 *
 * App events as the stream's (`model.<route>`): a warn `fallback` when the fallback answered, an
 * error when the call failed for good, nothing when the caller went away.
 */
export async function chatJsonWithFallback<S extends z.ZodTypeAny>(
  primary: string,
  fallback: string,
  opts: ChatJsonFallbackOptions<S>,
): Promise<{ data: z.infer<S>; model: string }> {
  const { reasoningFor, attemptTimeoutMs, signal, ...rest } = opts;
  const attempt = async (model: string) => {
    const timeout = AbortSignal.timeout(attemptTimeoutMs);
    try {
      const data = await chatJson({
        ...rest,
        model,
        reasoningEffort: reasoningFor?.(model),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      return { data, model };
    } catch (err) {
      // our own per-attempt timeout is the provider being slow (upstream), not the caller leaving
      if (timeout.aborted && !signal?.aborted) throw new UpstreamError(504, `${model} did not answer within ${attemptTimeoutMs} ms`);
      throw err;
    }
  };
  const call: ModelCall = { primary, fallback, title: rest.title, requestId: rest.requestId, startedAt: Date.now() };
  let primaryErr: unknown;
  try {
    return await attempt(primary);
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof CreditsExhaustedError || !fallback || fallback === primary) {
      recordModelFailure(call, primary, err, "only");
      throw err;
    }
    primaryErr = err;
  }
  const primaryMs = Date.now() - call.startedAt;
  try {
    const answer = await attempt(fallback);
    recordModelFallback(call, primaryErr, primaryMs);
    return answer;
  } catch (err) {
    if (!signal?.aborted) recordModelFailure(call, fallback, err, "both", primaryErr);
    throw err;
  }
}
