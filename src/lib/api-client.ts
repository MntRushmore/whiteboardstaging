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

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
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

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      details?: unknown;
    };
    throw new ApiError(
      errBody.message || errBody.error || `Request failed (${res.status})`,
      res.status,
      errBody.error,
      errBody.details,
    );
  }

  return (await res.json()) as T;
}

/** True when the error is an ApiError with the given code. */
export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}
