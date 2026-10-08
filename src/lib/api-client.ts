"use client";

import { supabase } from "@/lib/supabase";

/**
 * Error thrown by API helpers when the server responds with a non-2xx status.
 * `code` is the machine-readable `error` field returned by our routes
 * (e.g. "unauthorized", "rate_limited", "ink_empty").
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  /** 429 only: how long the server asked us to wait (from the body or the Retry-After header). */
  retryAfterMs?: number;
  /**
   * The parsed JSON error body, verbatim. Routes are allowed to add fields to their own
   * error responses (e.g. `needsCrop` on /api/live/recognize); `details` only carries the
   * one conventional field, so keep the whole body for callers that know their route.
   */
  body?: Record<string, unknown>;
  /**
   * The server's `X-Request-Id`, when it sent one: an error a student saw is reported with it
   * (`reportUserError`), so the admin page can join the report to the route's own event and log
   * lines. Absent when the request never reached our handler (a platform error, a dropped request).
   */
  requestId?: string;
  /**
   * Vercel's `x-vercel-error` (`FUNCTION_INVOCATION_TIMEOUT`, `FUNCTION_INVOCATION_FAILED`, ...):
   * the platform answered, not our route — a function killed at its maxDuration records nothing
   * on the server, so this is the only trace of it.
   */
  vercelError?: string;

  constructor(message: string, status: number, code?: string, details?: unknown, retryAfterMs?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

/** Shape of the error body every /api/* route returns on failure. */
export interface ApiErrorBody {
  error?: string;
  message?: string;
  details?: unknown;
  retryAfterMs?: number;
}

/**
 * Builds an ApiError from a non-2xx response. Keeps the server's `retryAfterMs` (or the
 * Retry-After header, in seconds) so rate-limit countdowns are exact instead of a guess.
 */
export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const errBody = (await res.json().catch(() => ({}))) as ApiErrorBody;
  const err = new ApiError(
    errBody.message || errBody.error || `Request failed (${res.status})`,
    res.status,
    errBody.error,
    errBody.details,
    retryAfterMsFrom(errBody, res.headers),
  );
  if (errBody && typeof errBody === "object") err.body = errBody as Record<string, unknown>;
  Object.assign(err, responseTrace(res.headers));
  return err;
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VERCEL_ERROR = /^[A-Z0-9_]{1,64}$/;

/**
 * What a response says about where it came from, for an error report: our `X-Request-Id` and
 * Vercel's `x-vercel-error`, each only when it has the shape it should (never anything else the
 * headers carry).
 */
export function responseTrace(headers: Headers): { requestId?: string; vercelError?: string } {
  const requestId = headers.get("X-Request-Id") ?? "";
  const vercelError = headers.get("x-vercel-error") ?? "";
  return {
    ...(REQUEST_ID.test(requestId) ? { requestId } : {}),
    ...(VERCEL_ERROR.test(vercelError) ? { vercelError } : {}),
  };
}

/** The request id and platform error an ApiError carries, for `reportUserError` (empty otherwise). */
export function errorTrace(err: unknown): { requestId?: string; vercelError?: string } {
  if (!(err instanceof ApiError)) return {};
  return {
    ...(err.requestId ? { requestId: err.requestId } : {}),
    ...(err.vercelError ? { vercelError: err.vercelError } : {}),
  };
}

function retryAfterMsFrom(body: ApiErrorBody, headers: Headers): number | undefined {
  if (typeof body.retryAfterMs === "number" && Number.isFinite(body.retryAfterMs) && body.retryAfterMs > 0) {
    return body.retryAfterMs;
  }
  const header = headers.get("Retry-After");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) && at > Date.now() ? at - Date.now() : undefined;
}

/**
 * Window event after a paid call (a POST to /api/live/*) came back: the ink surfaces re-read the
 * balance. `detail.remaining` is set for a 402, whose body already carries the balance.
 */
export const INK_SPENT_EVENT = "agathon:ink-spent";

/** Tells the ink meter that a paid call happened (no-op outside the browser and for free calls). */
export function noteInkSpend(input: string, method: string, res: Response): void {
  if (typeof window === "undefined" || method.toUpperCase() !== "POST" || !input.startsWith("/api/live/")) return;
  if (res.status === 402) {
    void res
      .clone()
      .json()
      .then((body: { remaining?: unknown }) => {
        const remaining = typeof body?.remaining === "number" ? body.remaining : undefined;
        window.dispatchEvent(new CustomEvent(INK_SPENT_EVENT, { detail: { remaining } }));
      })
      .catch(() => window.dispatchEvent(new CustomEvent(INK_SPENT_EVENT, { detail: {} })));
  } else if (res.ok) {
    window.dispatchEvent(new CustomEvent(INK_SPENT_EVENT, { detail: {} }));
  }
}

/**
 * fetch() that attaches the current Supabase access token as a Bearer token.
 * All /api/* routes require it. Throws ApiError(401, "unauthorized") when
 * there is no active session so callers can redirect to /login.
 */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new ApiError("You need to be signed in.", 401, "unauthorized");
  }
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  noteInkSpend(input, init.method ?? "GET", res);
  return res;
}

/**
 * POST JSON to an API route and parse the JSON response.
 * Throws ApiError with the server's `error`/`message` fields on failure.
 */
export async function apiJson<T = unknown>(
  path: string,
  body: unknown,
  init: { signal?: AbortSignal; method?: string } = {},
): Promise<T> {
  const res = await authedFetch(path, {
    method: init.method ?? "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: init.signal,
  });

  if (!res.ok) throw await apiErrorFromResponse(res);

  return (await res.json()) as T;
}

/** True when the error is an ApiError with the given code. */
export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}

/**
 * True when the student is out of ink: the API's `402 ink_empty` (src/lib/server/billing.ts).
 * Any 402 counts, because ink is the only thing the API answers 402 for (the provider's own
 * account running dry is a 503); `credits_exhausted` is the same answer from a server deployed
 * before ink, for the minutes a tab outlives a deploy.
 */
export function isOutOfInk(err: { status?: number; code?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.status === 402 || err.code === "ink_empty" || err.code === "credits_exhausted";
}
