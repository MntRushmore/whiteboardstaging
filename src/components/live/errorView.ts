/**
 * Pure mappings for the Live error surface: a thrown failure -> LiveError fields, and a
 * LiveError -> what the pill / hint card shows. No React, no store: unit-tested directly.
 */
import { isApiError } from "@/lib/api-client";
import type { LiveError, LiveErrorCode, LiveErrorKind } from "@/lib/live/liveStore";
import { LIVE_COPY } from "./copy";

/** Used when a 429 arrives without a usable retryAfterMs (no body field and no Retry-After header). */
export const RATE_LIMIT_FALLBACK_MS = 10_000;

export type LiveErrorFields = Omit<LiveError, "id" | "at">;

export interface ClassifyContext {
  kind: LiveErrorKind;
  lineId?: string;
  /** navigator.onLine at failure time; a network failure while offline is the queue's job */
  online: boolean;
  /** how many times this exact call has now failed in a row (1 = first failure) */
  attempts?: number;
  userAsked?: boolean;
}

function readNumber(obj: unknown, key: string): number | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** A human message the server sent, as opposed to the machine code or the generic fallback. */
function humanMessage(err: { message: string; code?: string }): string | null {
  const m = err.message?.trim();
  if (!m || m === err.code || /^Request failed/.test(m)) return null;
  return m;
}

function withAttempts(message: string, attempts: number | undefined): string {
  return attempts && attempts > 1 ? `${message} — ${LIVE_COPY.errors.attempts(attempts)}` : message;
}

/**
 * Maps a failure of a Live call to LiveError fields, or null when the failure is a plain
 * network error while offline (the offline queue replays it; nothing to show here).
 *
 *   fetch TypeError (online)                   -> network
 *   ApiError 401 / unauthorized                -> unauthorized
 *   ApiError 429 / rate_limited                -> rate_limited (+ retryAfterMs)
 *   ApiError 402 / credits_exhausted           -> credits (server message when it has one)
 *   ApiError 5xx, recognizer_failed, upstream  -> upstream
 *   *TimeoutError                              -> timeout
 *   { sse: true, message }  (SSE 'error' frame) -> upstream with the server message
 *   anything else                              -> unknown
 */
export function classifyLiveFailure(err: unknown, ctx: ClassifyContext): LiveErrorFields | null {
  const base = { kind: ctx.kind, lineId: ctx.lineId, userAsked: ctx.userAsked };
  const make = (code: LiveErrorCode, message: string, extra: Partial<LiveErrorFields> = {}): LiveErrorFields => ({
    ...base,
    code,
    message: withAttempts(message, ctx.attempts),
    ...extra,
  });

  if (isSseError(err)) return make("upstream", err.message?.trim() || LIVE_COPY.errors.upstream);

  if (isApiError(err)) {
    if (err.status === 401 || err.code === "unauthorized") return make("unauthorized", LIVE_COPY.errors.unauthorized);
    if (err.status === 429 || err.code === "rate_limited") {
      const retryAfterMs = readNumber(err, "retryAfterMs") ?? readNumber(err.details, "retryAfterMs") ?? RATE_LIMIT_FALLBACK_MS;
      return make("rate_limited", LIVE_COPY.errors.rateLimited(Math.ceil(retryAfterMs / 1000)), { retryAfterMs });
    }
    if (err.status === 402 || err.code === "credits_exhausted") {
      return make("credits", humanMessage(err) ?? LIVE_COPY.errors.credits);
    }
    if (err.status >= 500 || err.code === "recognizer_failed" || err.code === "upstream_error") {
      return make("upstream", LIVE_COPY.errors.upstream);
    }
    return make("unknown", LIVE_COPY.errors.unknown);
  }

  if (err instanceof Error && err.name === "TimeoutError") return make("timeout", LIVE_COPY.errors.timeout);

  if (err instanceof TypeError) {
    if (!ctx.online) return null;
    return make("network", LIVE_COPY.errors.network);
  }

  return make("unknown", LIVE_COPY.errors.unknown);
}

/** Marker for a server-sent `error` SSE frame so it can flow through the same classifier. */
export interface SseFailure {
  sse: true;
  error: string;
  message: string;
}
export function sseFailure(data: { error: string; message: string }): SseFailure {
  return { sse: true, error: data.error, message: data.message };
}
function isSseError(err: unknown): err is SseFailure {
  return typeof err === "object" && err !== null && (err as { sse?: unknown }).sse === true;
}

export interface LiveErrorView {
  title: string;
  detail?: string;
  /** which button leads out of the error; null when only Dismiss makes sense */
  primary: "retry" | "signin" | "account" | null;
  /** rate_limited: whole seconds until Retry becomes available (0 = now) */
  secondsLeft?: number;
  /** false while a rate-limit countdown is still running */
  retryEnabled: boolean;
}

/** Whole seconds left on a rate-limit countdown at `now`. */
export function secondsLeftFor(err: Pick<LiveError, "at" | "retryAfterMs">, now: number): number {
  const ms = (err.retryAfterMs ?? 0) - (now - err.at);
  return Math.max(0, Math.ceil(ms / 1000));
}

/** What the pill (and the inline hint card) shows for an error at time `now`. */
export function liveErrorView(err: LiveError, now: number): LiveErrorView {
  switch (err.code) {
    case "unauthorized":
      return { title: err.message, primary: "signin", retryEnabled: false };
    case "rate_limited": {
      const secondsLeft = secondsLeftFor(err, now);
      const title = secondsLeft > 0 ? LIVE_COPY.errors.rateLimited(secondsLeft) : LIVE_COPY.errors.rateLimitedReady;
      return { title, primary: "retry", secondsLeft, retryEnabled: secondsLeft === 0 };
    }
    case "credits":
      // 402: retrying cannot help; the way out is the account page (plan, reset date).
      return { title: err.message, primary: "account", retryEnabled: false };
    default:
      return { title: err.message, primary: "retry", retryEnabled: true };
  }
}

/** True when the error should also appear as an inline card next to its line. */
export function showsHintCard(err: LiveError | null): err is LiveError & { lineId: string } {
  return Boolean(err && (err.kind === "check" || err.kind === "solve") && err.userAsked && err.lineId);
}
