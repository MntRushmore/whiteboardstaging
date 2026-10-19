import { getServerEnv, hasMathpix } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { StrokePayload } from "@/lib/live/contracts";
import { recordEvent } from "@/lib/server/events";
import { eventContext } from "@/lib/server/request";

/**
 * Mathpix handwriting recognition over the strokes API.
 * Docs: https://docs.mathpix.com/reference/post-v3-strokes (shape re-verified against the docs + a live call on 2026-09-12)
 * Request shape (verified with a real call on 2026-09-11; `metadata.improve_mathpix: false` with one
 * on 2026-10-03):
 *   { strokes: { strokes: { x: number[][], y: number[][] } }, formats: ["latex_styled", "text"],
 *     metadata: { improve_mathpix: false } }
 * Response: { latex_styled, text, confidence, confidence_rate, is_handwritten, ... }
 */
export const MATHPIX_STROKES_URL = "https://api.mathpix.com/v3/strokes";
export const MATHPIX_TIMEOUT_MS = 4000;

export type MathpixStrokesResult = {
  latex: string;
  text: string;
  /** 0..1 — Mathpix `confidence` (falls back to `confidence_rate`) */
  confidence: number;
  /** Mathpix's whole response body, for the dev-only debug panel (never credentials: we only read the body) */
  raw: MathpixStrokesResponse;
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
    // Ink on a whiteboard is never upside down, but Mathpix's auto-rotation can decide it is:
    // a student's `3(x+2)=21` (flat-topped 3, looped 2s) came back rotated 180° as
    // `1 e=(e+x) \varepsilon` at 93 % confidence, and the model then "solved" that. 1 = never.
    auto_rotate_confidence_threshold: 1,
    // The strokes are a child's handwriting. Off, Mathpix persists no image data or anything
    // derived from it, its QA team sees none, and nothing shows in its console; only the request's
    // metadata (status, time) is kept for billing (docs.mathpix.com/concepts/privacy; the default
    // is on). An account-level value (set by Mathpix support) would override this one: keep it unset.
    metadata: { improve_mathpix: false },
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
 * The failures that are Mathpix's (or the way to it), as app events: kind `mathpix`, with the
 * level, code and message each records. Not the others: `api_error` is Mathpix saying it could not
 * read the ink (a scribble, not an outage), `aborted` is the client going away, and
 * `unconfigured` / `invalid_payload` never reach Mathpix. A timeout is a warn: the route goes on to
 * the vision reader, and the health checks watch Mathpix itself.
 */
function mathpixEvent(f: MathpixFailure): { level: "error" | "warn"; code: string; message: string } | null {
  switch (f.reason) {
    case "auth":
      return { level: "error", code: "unauthorized", message: "Mathpix rejected our credentials" };
    case "http":
      return { level: "error", code: f.status === 429 ? "rate_limited" : "upstream", message: `Mathpix answered HTTP ${f.status ?? "?"}` };
    case "timeout":
      return { level: "warn", code: "timeout", message: "Mathpix did not answer in time" };
    case "network":
      return { level: "error", code: "network", message: "Mathpix could not be reached" };
    default:
      return null;
  }
}

/** A failed call as an app event (fire and forget), with the route, user and request from the caller's logger. */
function recordMathpixFailure(f: MathpixFailure, requestId: string | undefined, log: unknown, timeoutMs: number): void {
  const what = mathpixEvent(f);
  if (!what) return;
  const at = eventContext(log);
  recordEvent({
    source: "server",
    kind: "mathpix",
    ...what,
    ...at,
    requestId: requestId ?? at.requestId,
    meta: {
      reason: f.reason,
      ...(f.status ? { status: f.status } : {}),
      ...(f.detail ? { detail: f.detail } : {}),
      ...(f.reason === "timeout" ? { timeoutMs } : {}),
    },
  });
}

/** What `postMathpix` hands back: Mathpix's body on a 2xx with no `error`, or why there is none. */
type MathpixPost<T> = { ok: true; data: T } | MathpixFailure;

/**
 * One POST to Mathpix with our credentials (headers only), a deadline and the caller's abort, and
 * every way it can fail told apart (see `MathpixFailureReason`). Shared by the strokes reader and
 * the image reader; `what` only names the input in the warn ("could not read the strokes").
 */
async function postMathpix<T extends Pick<MathpixStrokesResponse, "error" | "error_info">>(
  url: string,
  body: Record<string, unknown>,
  what: "strokes" | "image",
  signal: AbortSignal | undefined,
  opts: { timeoutMs?: number; requestId?: string; log?: WarnLogger },
  defaultTimeoutMs: number,
): Promise<MathpixPost<T>> {
  const log = opts.log ?? mathpixLogger;
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs;
  const fail = (f: MathpixFailure, msg: string): MathpixFailure => {
    log.warn({ requestId: opts.requestId, reason: f.reason, status: f.status, error: f.detail }, msg);
    // the route's own logger names the route and the user; this module's own names neither
    recordMathpixFailure(f, opts.requestId, opts.log, timeoutMs);
    return f;
  };

  const env = getServerEnv();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        app_id: env.MATHPIX_APP_ID ?? "",
        app_key: env.MATHPIX_APP_KEY ?? "",
        "Content-Type": "application/json",
        ...(opts.requestId ? { "X-Request-Id": opts.requestId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      // The body of a 4xx/5xx still carries Mathpix's reason ("Invalid credentials").
      const errBody = (await response.json().catch(() => ({}))) as MathpixStrokesResponse;
      const auth = response.status === 401 || response.status === 403;
      return fail(
        { ok: false, reason: auth ? "auth" : "http", status: response.status, detail: errorDetail(errBody) },
        auth ? "mathpix rejected our credentials" : "mathpix returned a non-2xx response",
      );
    }

    const data = (await response.json()) as T;
    if (data.error) {
      // 200 + `error` is Mathpix saying it could not read the input (image_no_content, ...),
      // except when it hands back a credential problem with a 200 anyway.
      const id = data.error_info?.id ?? "";
      const auth = /credential|unauthorized|forbidden|api_key|app_key|app_id/i.test(`${data.error} ${id}`);
      return fail(
        { ok: false, reason: auth ? "auth" : "api_error", status: response.status, detail: errorDetail(data) },
        auth ? "mathpix rejected our credentials" : `mathpix could not read the ${what}`,
      );
    }
    return { ok: true, data };
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

/**
 * Recognize a normalized stroke payload with Mathpix. 4 s timeout.
 *
 * Never throws. On failure it returns `{ ok: false, reason, status?, detail? }` and logs
 * the HTTP status plus Mathpix's `error` / `error_info` at warn — never the strokes and
 * never a credential — so `401 invalid_credentials` is distinguishable from an unreadable
 * scribble both in the logs and to the caller (which uses `auth` to degrade to vision). A
 * failure that is Mathpix's is also an app event (`recordMathpixFailure`).
 */
export async function recognizeStrokes(
  payload: StrokePayload,
  signal?: AbortSignal,
  opts: { timeoutMs?: number; requestId?: string; log?: WarnLogger } = {},
): Promise<MathpixOutcome> {
  if (!isMathpixConfigured()) return { ok: false, reason: "unconfigured" };
  if (payload.x.length === 0 || payload.x.length !== payload.y.length) {
    const f: MathpixFailure = { ok: false, reason: "invalid_payload" };
    (opts.log ?? mathpixLogger).warn({ requestId: opts.requestId, reason: f.reason, status: f.status, error: f.detail }, "mathpix skipped: stroke payload is empty or misaligned");
    return f;
  }
  const res = await postMathpix<MathpixStrokesResponse>(MATHPIX_STROKES_URL, buildStrokesBody(payload), "strokes", signal, opts, MATHPIX_TIMEOUT_MS);
  if (!res.ok) return res;
  const data = res.data;
  const latex = latexFromMathpix(data);
  const text = typeof data.text === "string" ? stripMathDelimiters(data.text) : latex;
  const confidence = clamp01(data.confidence ?? data.confidence_rate ?? 0);
  return { ok: true, latex, text, confidence, raw: data };
}

/* ------------------------------------------------------------------------- */
/* v3/text: a picture of the ink (SuperNet-201, 2026-09-30)                    */
/* ------------------------------------------------------------------------- */

/**
 * Mathpix's image reader, `POST /v3/text` (docs.mathpix.com/reference/post-v3-text). Since
 * SuperNet-201 (2026-09-30; 201p1 on 10-01) each region in `line_data` carries `text_confidence`
 * and `layout_confidence` beside the combined `confidence` (the lower of the two). It is NOT the
 * strokes reader: v3/strokes is unchanged by it.
 *
 * Here it is a possible crop reader for /api/live/recognize (`RECOGNIZE_CROP_READER=mathpix-text`,
 * off by default): the same JPEG crop the vision model gets (src/lib/live/inkCrop.ts). The eval
 * that decides whether it should be is `src/__eval__/mpx-text` (docs/eval/mpx-supernet.md).
 */
export const MATHPIX_TEXT_URL = "https://api.mathpix.com/v3/text";
/**
 * A crop read comes after a failed strokes read, inside the client's 6 s, and the vision model must
 * still have its turn when it fails: 2 s, where the eval measured p50 0.21 s / p90 0.31 s / max 0.61 s.
 */
export const MATHPIX_TEXT_TIMEOUT_MS = 2000;

/** One region of `line_data` (the fields we read; Mathpix sends more). */
export type MathpixLineData = {
  type?: string;
  subtype?: string;
  text?: string;
  /** the lower of `text_confidence` and `layout_confidence`; null when unknown */
  confidence?: number | null;
  confidence_rate?: number | null;
  /** SuperNet-201: OCR-only confidence in the text; null for non-text regions */
  text_confidence?: number | null;
  /** SuperNet-201: confidence in the region's structure; omitted when unavailable */
  layout_confidence?: number | null;
  /** whether the region is in the top-level `text` (`included` is the deprecated name) */
  conversion_output?: boolean;
  included?: boolean;
  is_handwritten?: boolean;
  is_printed?: boolean;
  error_id?: string;
  /** contour, (x, y) pixel pairs; an axis-aligned box runs TL, TR, BR, BL */
  cnt?: number[][];
};

export type MathpixTextResponse = {
  request_id?: string;
  text?: string;
  latex_styled?: string;
  confidence?: number;
  confidence_rate?: number;
  is_handwritten?: boolean;
  is_printed?: boolean;
  line_data?: MathpixLineData[];
  image_width?: number;
  image_height?: number;
  version?: string;
  error?: string;
  error_info?: { id?: string; message?: string };
};

/** The confidences of one read, each 0..1 or null when Mathpix gave none. */
export type MathpixTextConfidences = {
  /** top-level `confidence`: Mathpix's estimate that the whole result is 100 % right */
  confidence: number | null;
  confidenceRate: number | null;
  /** the lowest over the regions that are in the result */
  line: number | null;
  lineText: number | null;
  lineLayout: number | null;
  lineRate: number | null;
};

/**
 * The exact JSON body for `POST /v3/text` with one image (a `data:image/jpeg;base64,...` URL).
 * Same privacy and rotation settings as the strokes call: `improve_mathpix: false` (Mathpix
 * persists no image data or anything derived from it, its QA team sees none) and auto-rotation
 * off. `include_line_data` brings the per-region confidences.
 */
export function buildTextBody(src: string): Record<string, unknown> {
  return {
    src,
    formats: ["text", "latex_styled"],
    include_line_data: true,
    auto_rotate_confidence_threshold: 1,
    metadata: { improve_mathpix: false },
  };
}

const MATH_SPAN = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;

/**
 * One line of LaTeX from v3/text's Mathpix Markdown: `latex_styled` when Mathpix gave one (the
 * image is a single equation), else `text` with its math spans unwrapped and any words between
 * them as `\text{…}` (`\( 5 \mathrm{~km} \) to \( \mathrm{m} \)` -> `5 \mathrm{~km} \text{ to } \mathrm{m}`).
 * Lines of the result are joined with `\\`. Then `unwrapMathText` (unless `unwrap: false`).
 */
export function latexFromMathpixText(data: Pick<MathpixTextResponse, "latex_styled" | "text">, opts: { unwrap?: boolean } = {}): string {
  const latex = rawLatexFromMathpixText(data);
  return opts.unwrap === false ? latex : unwrapMathText(latex);
}

/**
 * `\text { 12-5 }` -> `12-5`. v3/text's `latex_styled` wraps a handwritten line it took for prose
 * in `\text` (`\text { 3R2 }`, `\text { 4) } \overline{128}`, `b=\text { ? }`; the region's own text
 * is the bare `12-5`), which the engine cannot read. When what is inside is maths — digits,
 * operators, a remainder's `R`, a bracket, a `?` — it is maths; words (`\text { to }`) stay words.
 */
export function unwrapMathText(latex: string): string {
  return latex.replace(/\\text\s*\{\s*([^{}]*?)\s*\}/g, (whole, inner: string) => (/^[\d\s.,+\-=<>()?:/R]*$/.test(inner) && /[\d?]/.test(inner) ? inner : whole));
}

function rawLatexFromMathpixText(data: Pick<MathpixTextResponse, "latex_styled" | "text">): string {
  const styled = typeof data.latex_styled === "string" ? data.latex_styled.trim() : "";
  if (styled) return styled;
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) return "";
  const rows = text.split(/\n+/).map((row) => {
    const parts: string[] = [];
    let at = 0;
    for (const m of row.matchAll(MATH_SPAN)) {
      const words = row.slice(at, m.index).trim();
      if (words) parts.push(/^[\d\s.,+\-=<>()]+$/.test(words) ? words : `\\text{ ${words} }`);
      parts.push((m[1] ?? m[2] ?? m[3] ?? "").trim());
      at = (m.index ?? 0) + m[0].length;
    }
    const tail = row.slice(at).trim();
    if (tail) parts.push(parts.length === 0 || /^[\d\s.,+\-=<>()]+$/.test(tail) ? tail : `\\text{ ${tail} }`);
    return parts.join(" ").trim();
  });
  return rows.filter(Boolean).join(" \\\\ ");
}

const conf01 = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

/** The read's confidences: the top-level ones, and the lowest of each over the regions in the result. */
export function textConfidences(data: Pick<MathpixTextResponse, "confidence" | "confidence_rate" | "line_data">): MathpixTextConfidences {
  const lines = (data.line_data ?? []).filter((l) => (l.conversion_output ?? l.included) !== false);
  const low = (pick: (l: MathpixLineData) => unknown): number | null => {
    const vs = lines.map((l) => conf01(pick(l))).filter((v): v is number => v !== null);
    return vs.length === 0 ? null : Math.min(...vs);
  };
  return {
    confidence: conf01(data.confidence),
    confidenceRate: conf01(data.confidence_rate),
    line: low((l) => l.confidence),
    lineText: low((l) => l.text_confidence),
    lineLayout: low((l) => l.layout_confidence),
    lineRate: low((l) => l.confidence_rate),
  };
}

export type MathpixTextOutcome =
  | { ok: true; latex: string; text: string; confidence: number; confidences: MathpixTextConfidences; raw: MathpixTextResponse }
  | MathpixFailure;

/**
 * Read a JPEG crop of ink with Mathpix `v3/text`. Never throws; fails as `recognizeStrokes` does
 * (`auth`, `http`, `api_error`, `timeout`, `aborted`, `network`, `unconfigured`). `confidence` is
 * the top-level one (else the lowest region's, else `confidence_rate`, else 0).
 */
export async function recognizeImage(
  src: string,
  signal?: AbortSignal,
  opts: { timeoutMs?: number; requestId?: string; log?: WarnLogger } = {},
): Promise<MathpixTextOutcome> {
  if (!isMathpixConfigured()) return { ok: false, reason: "unconfigured" };
  if (!/^data:image\/(?:jpeg|png|webp);base64,/.test(src)) return { ok: false, reason: "invalid_payload" };
  const res = await postMathpix<MathpixTextResponse>(MATHPIX_TEXT_URL, buildTextBody(src), "image", signal, opts, MATHPIX_TEXT_TIMEOUT_MS);
  if (!res.ok) return res;
  const data = res.data;
  const latex = latexFromMathpixText(data);
  const confidences = textConfidences(data);
  const confidence = confidences.confidence ?? confidences.line ?? confidences.confidenceRate ?? 0;
  return { ok: true, latex, text: latex, confidence, confidences, raw: data };
}
