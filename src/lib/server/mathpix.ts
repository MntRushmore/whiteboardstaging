import { getServerEnv, hasMathpix } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { StrokePayload } from "@/lib/live/contracts";

/**
 * Mathpix handwriting recognition over the strokes API.
 * Docs: https://docs.mathpix.com/reference/post-v3-strokes (shape re-verified against the docs + a live call on 2026-09-12)
 * Request shape (verified with a real call on 2026-09-11):
 *   { strokes: { strokes: { x: number[][], y: number[][] } }, formats: ["latex_styled", "text"] }
 * Response: { latex_styled, text, confidence, confidence_rate, is_handwritten, ... }
 */
export const MATHPIX_STROKES_URL = "https://api.mathpix.com/v3/strokes";
export const MATHPIX_TIMEOUT_MS = 4000;

export type MathpixStrokesResult = {
  latex: string;
  text: string;
  /** 0..1 — Mathpix `confidence` (falls back to `confidence_rate`) */
  confidence: number;
};

/**
 * Why a strokes call produced no result. `auth` means the credentials are wrong or expired
 * (401/403) — retrying Mathpix is pointless and the caller should degrade to the vision
 * recognizer; `api_error` is Mathpix telling us it could not read the ink (a recognition
 * miss); the rest are transport-level failures. Before BUG-1 every one of these was an
 * indistinguishable `null`, which is why a production credential problem looked exactly
 * like an unreadable scribble in the logs.
 */
export type MathpixFailureReason =
  | "unconfigured"
  | "invalid_payload"
  | "auth"
  | "http"
  | "api_error"
  | "timeout"
  | "aborted"
  | "network";

export type MathpixFailure = {
  ok: false;
  reason: MathpixFailureReason;
  /** HTTP status, when there was a response */
  status?: number;
  /** Mathpix `error` / `error_info.id` (never strokes, never a key) */
  detail?: string;
};

export type MathpixOutcome = ({ ok: true } & MathpixStrokesResult) | MathpixFailure;

/** True when Mathpix rejected our credentials: the recognizer is down, not the handwriting. */
export function isMathpixAuthFailure(outcome: MathpixOutcome): boolean {
  return outcome.ok === false && outcome.reason === "auth";
}

const mathpixLogger = logger.child({ module: "mathpix" });

/** Minimal logger surface so a route can pass its request-scoped child logger. */
export type WarnLogger = { warn: (obj: Record<string, unknown>, msg: string) => void };

export type MathpixStrokesResponse = {
  request_id?: string;
  latex_styled?: string;
  latex?: string;
  text?: string;
  confidence?: number;
  confidence_rate?: number;
  is_handwritten?: boolean;
  error?: string;
  error_info?: { id?: string; message?: string };
};

/** True when both MATHPIX_APP_ID and MATHPIX_APP_KEY are configured. */
export function isMathpixConfigured(): boolean {
  try {
    return hasMathpix();
  } catch {
    return false;
  }
}

/** Build the exact JSON body Mathpix expects for `POST /v3/strokes`. */
export function buildStrokesBody(payload: StrokePayload, dataOptions?: Record<string, unknown>) {
  const body: Record<string, unknown> = {
    strokes: { strokes: { x: payload.x, y: payload.y } },
    formats: ["latex_styled", "text"],
  };
  if (dataOptions) body.data_options = dataOptions;
  return body;
}

function clamp01(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Strip the `\( ... \)` / `\[ ... \]` wrappers Mathpix puts around `text`. */
export function stripMathDelimiters(text: string): string {
  return text
    .trim()
    .replace(/^\\\(/, "")
    .replace(/\\\)$/, "")
    .replace(/^\\\[/, "")
    .replace(/\\\]$/, "")
    .trim();
}

/** Pick the best LaTeX from a Mathpix response (`latex_styled` > `latex` > unwrapped `text`). */
export function latexFromMathpix(data: MathpixStrokesResponse): string {
  const styled = typeof data.latex_styled === "string" ? data.latex_styled.trim() : "";
  if (styled) return styled;
  const latex = typeof data.latex === "string" ? data.latex.trim() : "";
  if (latex) return latex;
  const text = typeof data.text === "string" ? data.text : "";
  return text ? stripMathDelimiters(text) : "";
}

/** Mathpix's own error text, capped and free of anything we sent. */
function errorDetail(data: Pick<MathpixStrokesResponse, "error" | "error_info">): string | undefined {
  const parts = [data.error, data.error_info?.id, data.error_info?.message].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  return parts.length > 0 ? [...new Set(parts)].join(" | ").slice(0, 300) : undefined;
}

/**
 * Recognize a normalized stroke payload with Mathpix. 4 s timeout.
 *
 * Never throws. On failure it returns `{ ok: false, reason, status?, detail? }` and logs
 * the HTTP status plus Mathpix's `error` / `error_info` at warn — never the strokes and
 * never a credential — so `401 invalid_credentials` is distinguishable from an unreadable
 * scribble both in the logs and to the caller (which uses `auth` to degrade to vision).
 */
export async function recognizeStrokes(
  payload: StrokePayload,
  signal?: AbortSignal,
  opts: { timeoutMs?: number; requestId?: string; log?: WarnLogger } = {},
): Promise<MathpixOutcome> {
  const log = opts.log ?? mathpixLogger;
  const fail = (f: MathpixFailure, msg: string): MathpixFailure => {
    log.warn({ requestId: opts.requestId, reason: f.reason, status: f.status, error: f.detail }, msg);
    return f;
  };

  if (!isMathpixConfigured()) return { ok: false, reason: "unconfigured" };
  if (payload.x.length === 0 || payload.x.length !== payload.y.length) {
    return fail({ ok: false, reason: "invalid_payload" }, "mathpix skipped: stroke payload is empty or misaligned");
  }

  const env = getServerEnv();
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? MATHPIX_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();

  try {
    const response = await fetch(MATHPIX_STROKES_URL, {
      method: "POST",
      headers: {
        app_id: env.MATHPIX_APP_ID ?? "",
        app_key: env.MATHPIX_APP_KEY ?? "",
        "Content-Type": "application/json",
        ...(opts.requestId ? { "X-Request-Id": opts.requestId } : {}),
      },
      body: JSON.stringify(buildStrokesBody(payload)),
      signal: controller.signal,
    });
    if (!response.ok) {
      // The body of a 4xx/5xx still carries Mathpix's reason ("Invalid credentials").
      const body = (await response.json().catch(() => ({}))) as MathpixStrokesResponse;
      const auth = response.status === 401 || response.status === 403;
      return fail(
        { ok: false, reason: auth ? "auth" : "http", status: response.status, detail: errorDetail(body) },
        auth ? "mathpix rejected our credentials" : "mathpix returned a non-2xx response",
      );
    }

    const data = (await response.json()) as MathpixStrokesResponse;
    if (data.error) {
      // 200 + `error` is Mathpix saying it could not read the ink (image_no_content, ...),
      // except when it hands back a credential problem with a 200 anyway.
      const id = data.error_info?.id ?? "";
      const auth = /credential|unauthorized|forbidden|api_key|app_key|app_id/i.test(`${data.error} ${id}`);
      return fail(
        { ok: false, reason: auth ? "auth" : "api_error", status: response.status, detail: errorDetail(data) },
        auth ? "mathpix rejected our credentials" : "mathpix could not read the strokes",
      );
    }

    const latex = latexFromMathpix(data);
    const text = typeof data.text === "string" ? stripMathDelimiters(data.text) : latex;
    const confidence = clamp01(data.confidence ?? data.confidence_rate ?? 0);
    return { ok: true, latex, text, confidence };
  } catch (err) {
    if (timedOut) return fail({ ok: false, reason: "timeout" }, "mathpix timed out");
    if (signal?.aborted) return { ok: false, reason: "aborted" };
    return fail(
      { ok: false, reason: "network", detail: err instanceof Error ? err.message.slice(0, 300) : undefined },
      "mathpix call failed before a response",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
