/**
 * Pure mappings for the Live error surface: a thrown failure -> LiveError fields, and a
 * LiveError -> what the pill / hint card shows. No React, no store: unit-tested directly.
 */
import { errorTrace, isApiError, isOutOfInk } from "@/lib/api-client";
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
  /** the stream's request id (its `meta` frame), for a failure that carries none of its own (a stalled stream) */
  requestId?: string;
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
 *   ApiError 402 / ink_empty                   -> ink (server message when it has one)
 *   ApiError 5xx, recognizer_failed, upstream  -> upstream
 *   *TimeoutError                              -> timeout
 *   { sse: true, message }  (SSE 'error' frame) -> upstream with the server message
 *   anything else                              -> unknown
 */
export function classifyLiveFailure(err: unknown, ctx: ClassifyContext): LiveErrorFields | null {
  // which request it was, for the report (never shown): the response's X-Request-Id, or the stream's `meta`
  const trace: { requestId?: string; vercelError?: string } = isSseError(err) ? (err.requestId ? { requestId: err.requestId } : {}) : errorTrace(err);
  if (!trace.requestId && ctx.requestId) trace.requestId = ctx.requestId;
  const base = { kind: ctx.kind, lineId: ctx.lineId, userAsked: ctx.userAsked, ...trace };
  const make = (code: LiveErrorCode, message: string, extra: Partial<LiveErrorFields> = {}): LiveErrorFields => ({
    ...base,
    code,
    message: withAttempts(message, ctx.attempts),
    ...extra,
  });

  if (isSseError(err)) {
    // the board's own verdict on a solve that answered (every step refused): its code and why, for the report
    const reportCode = err.error === "unusable_steps" ? `unusable_steps${err.reason ? `:${err.reason}` : ""}` : undefined;
    return make("upstream", err.message?.trim() || LIVE_COPY.errors.upstream, reportCode ? { reportCode } : {});
  }

  if (isApiError(err)) {
    if (err.status === 401 || err.code === "unauthorized") return make("unauthorized", LIVE_COPY.errors.unauthorized);
    if (err.status === 429 || err.code === "rate_limited") {
      const retryAfterMs = readNumber(err, "retryAfterMs") ?? readNumber(err.details, "retryAfterMs") ?? RATE_LIMIT_FALLBACK_MS;
      return make("rate_limited", LIVE_COPY.errors.rateLimited(Math.ceil(retryAfterMs / 1000)), { retryAfterMs });
    }
    if (isOutOfInk(err)) {
      const inkNeeded = readNumber(err.body, "cost");
      return make("ink", humanMessage(err) ?? LIVE_COPY.errors.ink, inkNeeded !== undefined ? { inkNeeded } : {});
    }
    if (err.status >= 500 || err.code === "recognizer_failed" || err.code === "upstream_error") {
      return make("upstream", LIVE_COPY.errors.upstream);
    }
    return make("unknown", LIVE_COPY.errors.unknown);
  }

  if (err instanceof Error && err.name === "TimeoutError") {
    // a recognize call times out reading the line; a check or solve stream that went silent
    const answering = ctx.kind === "check" || ctx.kind === "solve";
    return make("timeout", answering ? LIVE_COPY.errors.answerTimeout : LIVE_COPY.errors.timeout);
  }

  if (err instanceof TypeError) {
    if (!ctx.online) return null;
    return make("network", LIVE_COPY.errors.network);
  }

  return make("unknown", LIVE_COPY.errors.unknown);
}

/**
 * Marker for a server-sent `error` SSE frame so it can flow through the same classifier — or the
 * board's own `unusable_steps` (a solve whose every step the guard refused, `reason` the first
 * refusal's). `requestId` is the stream's (its `meta` frame), for the report.
 */
export interface SseFailure {
  sse: true;
  error: string;
  message: string;
  reason?: string;
  requestId?: string;
}
export function sseFailure(data: { error: string; message: string }, extra: { reason?: string; requestId?: string } = {}): SseFailure {
  return {
    sse: true,
    error: data.error,
    message: data.message,
    ...(extra.reason ? { reason: extra.reason } : {}),
    ...(extra.requestId ? { requestId: extra.requestId } : {}),
  };
}
function isSseError(err: unknown): err is SseFailure {
  return typeof err === "object" && err !== null && (err as { sse?: unknown }).sse === true;
}

export interface LiveErrorView {
  title: string;
  detail?: string;
  /** which button leads out of the error; null when only Dismiss makes sense */
  primary: "retry" | "signin" | "ink" | null;
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
  const view = liveErrorViewBase(err, now);
  // Second line set by the loop (e.g. "Drawn help is paused…" after a failed read).
  return err.detail ? { ...view, detail: err.detail } : view;
}

function liveErrorViewBase(err: LiveError, now: number): LiveErrorView {
  switch (err.code) {
    case "unauthorized":
      return { title: err.message, primary: "signin", retryEnabled: false };
    case "rate_limited": {
      const secondsLeft = secondsLeftFor(err, now);
      const title = secondsLeft > 0 ? LIVE_COPY.errors.rateLimited(secondsLeft) : LIVE_COPY.errors.rateLimitedReady;
      return { title, primary: "retry", secondsLeft, retryEnabled: secondsLeft === 0 };
    }
    case "ink":
      // 402: retrying cannot help; the way out is an ink pack (the board's ink dialog).
      return { title: err.message, primary: "ink", retryEnabled: false };
    default:
      return { title: err.message, primary: "retry", retryEnabled: true };
  }
}

/**
 * The status pill's way out of an error. Out of ink, the bar's ink meter already says "Get ink"
 * (it does whenever ink is low or gone): the pill leaves that to the meter, so the bar shows it
 * once, and keeps its own only when the meter does not (its balance has not loaded).
 */
export function pillPrimary(view: Pick<LiveErrorView, "primary">, meterOffersInk: boolean): LiveErrorView["primary"] {
  return view.primary === "ink" && meterOffersInk ? null : view.primary;
}

/**
 * True when the error is one that can sit beside its line as a card: a check or solve the student
 * asked for, about a line, whose way out is Retry. Signed out and out of ink are about the account,
 * not the line, and their way out (Sign in, Get ink) lives in the bar: those stay in the pill.
 * Whether the card is actually shown also needs the line on the screen (`errorCardAnchor`).
 */
export function showsHintCard(err: LiveError | null): err is LiveError & { lineId: string } {
  return Boolean(
    err && (err.kind === "check" || err.kind === "solve") && err.userAsked && err.lineId && err.code !== "unauthorized" && err.code !== "ink",
  );
}

/**
 * The error the status pill shows: none while the card beside the line shows it. One error, one
 * place, one Retry and one Dismiss; the pill goes back to saying what Live is doing.
 */
export function pillError(err: LiveError | null, onCard: boolean): LiveError | null {
  return onCard ? null : err;
}

/** The error card's heading: what the student asked for that did not come back. */
export function errorCardTitle(err: Pick<LiveError, "kind" | "asked">): string {
  const asked = err.asked ?? (err.kind === "check" ? "check" : "solve");
  if (asked === "hint") return LIVE_COPY.errors.hintCard;
  return asked === "check" ? LIVE_COPY.errors.checkCard : LIVE_COPY.errors.solveCard;
}
