"use client";

import { supabase } from "@/lib/supabase";

/**
 * Error thrown by API helpers when the server responds with a non-2xx status.
 * `code` is the machine-readable `error` field returned by our routes
 * (e.g. "unauthorized", "rate_limited", "credits_exhausted").
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  /** 429 only: how long the server asked us to wait (from the body or the Retry-After header). */
  retryAfterMs?: number;

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
  return new ApiError(
    errBody.message || errBody.error || `Request failed (${res.status})`,
    res.status,
    errBody.error,
    errBody.details,
    retryAfterMsFrom(errBody, res.headers),
  );
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
  return fetch(input, { ...init, headers });
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
