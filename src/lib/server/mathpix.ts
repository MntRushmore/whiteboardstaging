import { getServerEnv, hasMathpix } from "@/lib/env";
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

/**
 * Recognize a normalized stroke payload with Mathpix. 4 s timeout.
 * Returns null when Mathpix is unconfigured, times out, errors, or returns nothing usable —
 * callers fall back to the vision recognizer.
 */
export async function recognizeStrokes(
  payload: StrokePayload,
  signal?: AbortSignal,
  opts: { timeoutMs?: number; requestId?: string } = {},
): Promise<MathpixStrokesResult | null> {
  if (!isMathpixConfigured()) return null;
  if (payload.x.length === 0 || payload.x.length !== payload.y.length) return null;

  const env = getServerEnv();
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? MATHPIX_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    if (!response.ok) return null;

    const data = (await response.json()) as MathpixStrokesResponse;
    if (data.error) return null;

    const latex = latexFromMathpix(data);
    const text = typeof data.text === "string" ? stripMathDelimiters(data.text) : latex;
    const confidence = clamp01(data.confidence ?? data.confidence_rate ?? 0);
    return { latex, text, confidence };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
