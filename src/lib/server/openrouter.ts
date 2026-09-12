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
