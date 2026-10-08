import { RELEASE } from "@/lib/release";

/**
 * Client error reporting, with no third-party service: a crash in a student's browser becomes
 * one structured log line on the server (POST /api/client-errors, `module: "client-error"`; where
 * to find it: docs/RUNBOOK-ops.md).
 *
 * Fed by src/instrumentation-client.ts (window `error` and `unhandledrejection`, installed before
 * hydration on every page) and by the error boundaries that catch what never reaches the window:
 * error.tsx, global-error.tsx and LiveErrorBoundary. They all go through `reportAppError`
 * (src/lib/reportAppError.ts), which loads this module lazily. Per page load each distinct error is
 * sent once, at most MAX_REPORTS in all, and noise is dropped (NOISE, extension scripts).
 *
 * What it sends is a ClientErrorReport and nothing else: the page's path without its query string
 * or hash (a query string once carried a login form's credentials), the board id on a board, the
 * error's message and stack with every URL's query string and hash stripped too (a stack frame of
 * an inline script carries the page's full URL). Never board content or anything the student
 * typed. When signed in, the request carries the session's access token so the server can log
 * who it was (the user id, never the token).
 *
 * Errors a student SAW go the same way (`reportUserError`, through `reportUserError` in
 * src/lib/reportAppError.ts): the board's error card and pill (`setLiveError`), the chat's failures,
 * a save that failed, a board that would not load, a practice set that could not be written, a
 * failed ink or account read. Each says what failed (`kind`: `live.solve`, `live.chat`…, the
 * contract's EVENT_KIND conventions in src/lib/admin/contracts.ts), how (`code`), at what level
 * (`level`: out of ink is `info`, a rate limit `warn`, anything else `error`), and the words the
 * student was shown — our own copy, never what they wrote or typed, never a stack. They have a
 * budget of their own (MAX_USER_REPORTS per page load), apart from the crashes' MAX_REPORTS, so a
 * student tapping Help with no ink cannot use up the reports a real crash needs, nor the other way
 * round; and the same kind + code + message is sent again only after USER_REPORT_WINDOW_MS.
 *
 * Not in any page's first load: the board's budget is nearly spent (docs/BUNDLE.md), so this
 * module is a lazy chunk, fetched a few seconds after the page loads (or at the first error, if
 * sooner) — from the same deployment, so a tab left open across a deploy can still report.
 */

export const CLIENT_ERRORS_PATH = "/api/client-errors";
/** Reports per page load, after dedupe. */
export const MAX_REPORTS = 10;
/**
 * Reports of errors a student saw per page load, after dedupe: their own budget, not the crashes'.
 * With the dedupe window, the same failure hit again and again (a tutor service that is down for a
 * whole lesson) is reported about once a minute for twenty minutes: enough to tell a blip from an
 * outage, never a flood.
 */
export const MAX_USER_REPORTS = 20;
/** The same error a student saw (kind + code + message) is reported again only after this long. */
export const USER_REPORT_WINDOW_MS = 60_000;
/** Our own copy is short: anything longer is cut here. */
export const MAX_USER_MESSAGE = 300;
export const MAX_MESSAGE = 1000;
/** ~4 KB of stack: the frames that matter are at the top. */
export const MAX_STACK = 4000;
/** The server refuses a body over this unread (413). A report is ~6 KB at most. */
export const MAX_REPORT_BYTES = 16 * 1024;

/** Where a report came from: a window event or one of the error boundaries. */
export type ClientErrorSource = "error" | "rejection" | "boundary" | "global" | "live";

export type ClientErrorReport = {
  source: ClientErrorSource;
  message: string;
  stack?: string;
  /** location.pathname: never a query string or hash */
  path: string;
  boardId?: string;
  userAgent: string;
  release: string;
  /** the server's error digest, when a boundary caught a server-rendered error */
  digest?: string;
  /** what failed, for the admin page (`EVENT_KIND` in src/lib/admin/contracts.ts): `live.solve`, `live.chat`… */
  kind?: string;
  /** a short machine code: network, timeout, rate_limited, ink, upstream… */
  code?: string;
  /** an error a student saw (`reportUserError`): how bad (`userErrorLevel`); a crash has none (an error) */
  level?: UserErrorLevel;
  /** the failed request's `X-Request-Id`, to join the report to the server's own event and logs */
  requestId?: string;
  /** Vercel's `x-vercel-error` on the failed response: the platform answered, not our route */
  vercelError?: string;
};

/**
 * What failed, as a student saw it (`live.<what>`, the contract's EVENT_KIND conventions):
 *  - `live.recognize` `live.check` `live.solve` `live.capabilities`  the board's error card and pill (`setLiveError`)
 *  - `live.chat`      the Ask panel's failed request (and its weak-spots chip); what it could not write (warn)
 *  - `live.lecture`   lecture mode's error, or its notice that a drawing failed or the tutor is unreachable
 *  - `live.save`      the save pill's "Couldn't save", a board too large to save, images kept on the device
 *  - `live.load`      the board's "Couldn't load / restore this board" screen, a board not there (warn)
 *  - `live.practice`  a practice set or a "Now you try" problem that could not be written or made
 *  - `live.progress`  the Progress page's record that would not load
 *  - `live.ink`       the ink balance, packs or purchases that would not load; ink that never arrived after checkout
 *  - `live.account`   another /account section that failed (profile, usage, deleting the account)
 *  - `live.boards`    the home page's board list, or a board that could not be made, renamed or deleted
 *  - `live.image` `live.pdf`  a picture, a sticker or a PDF page that could not be added to the board
 *  - `live.report`    a bug report that could not be sent
 *  - `live.auth`      a sign-in, sign-up, reset that failed on our side (never a wrong password), the
 *                     sign-in service unreachable, a sign out that failed
 *  - `live.settings`  a Labs setting that could not be saved
 */
export type UserErrorKind =
  | "live.recognize"
  | "live.check"
  | "live.solve"
  | "live.capabilities"
  | "live.chat"
  | "live.lecture"
  | "live.save"
  | "live.load"
  | "live.practice"
  | "live.progress"
  | "live.ink"
  | "live.account"
  | "live.boards"
  | "live.image"
  | "live.pdf"
  | "live.report"
  | "live.auth"
  | "live.settings";

/** The contract's EVENT_LEVELS (src/lib/admin/contracts.ts; not imported: it brings zod). */
export type UserErrorLevel = "error" | "warn" | "info";

/** An error a student saw, as its surface reports it. */
export interface UserErrorInput {
  kind: UserErrorKind;
  /** a short machine code: network, timeout, upstream, rate_limited, ink, unauthorized, unknown, save_failed… */
  code: string;
  /** the words the student was shown: OUR copy, never anything they wrote or typed, never a server's raw error */
  message: string;
  /** the board it happened on, when the page's path does not say (a uuid; anything else is dropped) */
  boardId?: string;
  /** only to override `userErrorLevel(code)` (a warning about images kept on the device, a missing board) */
  level?: UserErrorLevel;
  /** the failed request's `X-Request-Id` (`errorTrace` in src/lib/api-client.ts); anything else is dropped */
  requestId?: string;
  /** the failed response's `x-vercel-error` (`errorTrace`); anything else is dropped */
  vercelError?: string;
}

/**
 * How bad an error a student saw is, from its code: out of ink (`ink`) and a rate limit
 * (`rate_limited`) are expected states, not outages — `info` and `warn`, so they never count
 * towards the admin page's errors or the error-spike alert. Everything else is an `error`.
 */
export function userErrorLevel(code: string | undefined): UserErrorLevel {
  if (code === "ink") return "info";
  if (code === "rate_limited") return "warn";
  return "error";
}

/**
 * Not worth a report: the ResizeObserver loop warning, a cross-origin "Script error." with nothing
 * in it, aborted fetches (navigating away, a cancelled request), and a pen lifted before tldraw's
 * setPointerCapture ran ("No active pointer with the given id").
 */
const NOISE = /ResizeObserver loop|^Script error\.?$|\babort(ed|error)\b|No active pointer with the given id/i;
/** Thrown from a browser extension's script, not ours (Safari masks extension URLs). */
const EXTENSION = /-extension:\/\/|webkit-masked-url:/;
/**
 * The same lifted pen in Safari, which words it "NotFoundError: The object can not be found here."
 * (its message for every NotFoundError, so only when the stack's top frame is setPointerCapture).
 */
const SAFARI_POINTER_CAPTURE = { message: /^NotFoundError\b/, stack: /^setPointerCapture@\[native code\]/ };

export function isNoise(message: string, stack = ""): boolean {
  if (SAFARI_POINTER_CAPTURE.message.test(message) && SAFARI_POINTER_CAPTURE.stack.test(stack)) return true;
  return !message || NOISE.test(message) || EXTENSION.test(stack);
}

/** Drop the query string and hash of every URL (absolute or /path) in `text`, keeping a stack frame's :line:col. */
export function stripUrlQueries(text: string): string {
  return text.replace(/((?:\w+:\/\/|\/)[^\s?#)]*)[?#][^\s)]*?(:\d+:\d+)?(?=[\s)]|$)/g, "$1$2");
}

/** The board id in a /board/<uuid> path. */
export function boardIdFromPath(path: string): string | undefined {
  return /^\/board\/([0-9a-f-]{36})(?:\/|$)/i.exec(path)?.[1];
}

type Page = { path: string; userAgent: string };

const currentPage = (): Page => ({ path: location.pathname, userAgent: navigator.userAgent });

/**
 * One page load's reporter: normalizes what was thrown into a ClientErrorReport, drops noise and
 * repeats, stops after `max`, and hands the rest to `send`. Never throws. Exported for tests.
 */
export function createReporter(send: (report: ClientErrorReport) => void, page: () => Page = currentPage, max = MAX_REPORTS) {
  const seen = new Set<string>();
  return (source: ClientErrorSource, error: unknown, digest?: string): void => {
    try {
      if (seen.size >= max) return;
      const e = (error ?? {}) as { name?: unknown; message?: unknown; stack?: unknown };
      let message = typeof e.message === "string" ? e.message : String(error);
      if (typeof e.name === "string" && e.name !== "Error") message = `${e.name}: ${message}`;
      message = stripUrlQueries(message).slice(0, MAX_MESSAGE);
      const stack = typeof e.stack === "string" ? stripUrlQueries(e.stack).slice(0, MAX_STACK) : "";
      if (isNoise(message, stack)) return;
      const key = `${message}\n${stack}`;
      if (seen.has(key)) return;
      seen.add(key);
      const { path, userAgent } = page();
      send({
        source,
        message,
        ...(stack ? { stack } : {}),
        path: path.replace(/[?#][\s\S]*/, ""),
        ...(boardIdFromPath(path) ? { boardId: boardIdFromPath(path) } : {}),
        userAgent: userAgent.slice(0, 512),
        release: RELEASE,
        ...(digest ? { digest: digest.slice(0, 64) } : {}),
      });
    } catch {
      // Reporting must never become the next error.
    }
  };
}

/** supabase-js keeps the session in localStorage as `sb-<project ref>-auth-token`. */
function sessionToken(): string | undefined {
  try {
    for (const key of Object.keys(localStorage)) {
      if (/^sb-.+-auth-token$/.test(key)) return JSON.parse(localStorage.getItem(key) ?? "{}").access_token;
    }
  } catch {
    // No storage (private mode) or not JSON: report without a user.
  }
  return undefined;
}

/**
 * A beacon when signed out; signed in, fetch with `keepalive` (a beacon cannot carry the
 * Authorization header). fetch is also the fallback when sendBeacon is missing or refuses.
 */
function deliver(report: ClientErrorReport): void {
  const body = JSON.stringify(report);
  const token = sessionToken();
  if (!token && navigator.sendBeacon?.(CLIENT_ERRORS_PATH, body)) return;
  fetch(CLIENT_ERRORS_PATH, {
    method: "POST",
    body,
    keepalive: true,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).catch(() => {});
}

/** Report an error from a boundary or a listener: `reportClientError("boundary", error, error.digest)`. */
export const reportClientError = createReporter(deliver);

/** `live.` and a name: EVENT_KIND (src/lib/admin/contracts.ts; pinned equal in the tests) for a `live.` kind. */
const USER_KIND = /^live\.[a-z0-9_.:-]{1,59}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The shapes the route accepts for a request id and a Vercel error (the same as api-client's). */
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VERCEL_ERROR = /^[A-Z0-9_]{1,64}$/;

/** A code the route accepts: lower case, `[a-z0-9_.:-]`, at most 40 chars; "unknown" when empty. */
export function userErrorCode(code: unknown): string {
  const clean = String(code ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return clean || "unknown";
}

/**
 * The words reported for an error a student saw: one line, no URL query strings, and every number
 * as `#` — a countdown ("try again in 12 seconds") or an attempt count ("tried 3 times") would
 * otherwise split one failure into a group per number on the admin page, and slip past the dedupe.
 */
export function userErrorMessage(message: unknown): string {
  return stripUrlQueries(String(message ?? ""))
    .replace(/\d+(?:[.,:]\d+)*/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_USER_MESSAGE);
}

/**
 * One page load's reporter of errors a student saw: builds the report from scratch (only the kind,
 * code, level, our words, the path, the board id, the browser, the release, and the failed
 * request's id and Vercel error when they have their shape — nothing else the caller passed), sends the same kind + code + message at most once per `windowMs`, and stops after
 * `max`. Never throws. Exported for tests.
 */
export function createUserReporter(
  send: (report: ClientErrorReport) => void,
  page: () => Page = currentPage,
  { max = MAX_USER_REPORTS, windowMs = USER_REPORT_WINDOW_MS, now = Date.now }: { max?: number; windowMs?: number; now?: () => number } = {},
) {
  const lastSent = new Map<string, number>();
  let sent = 0;
  return (input: UserErrorInput): void => {
    try {
      if (sent >= max || !input) return;
      const kind = String(input.kind);
      if (!USER_KIND.test(kind)) return;
      const code = userErrorCode(input.code);
      const message = userErrorMessage(input.message) || kind;
      const key = `${kind}\n${code}\n${message}`;
      const at = now();
      const last = lastSent.get(key);
      if (last !== undefined && at - last < windowMs) return;
      const { path: rawPath, userAgent } = page();
      const path = rawPath.replace(/[?#][\s\S]*/, "");
      const boardId = typeof input.boardId === "string" && UUID.test(input.boardId) ? input.boardId : boardIdFromPath(path);
      const level = input.level === "error" || input.level === "warn" || input.level === "info" ? input.level : userErrorLevel(code);
      lastSent.set(key, at);
      sent++;
      send({
        source: "live",
        kind,
        code,
        level,
        message,
        path,
        ...(boardId ? { boardId } : {}),
        userAgent: userAgent.slice(0, 512),
        release: RELEASE,
        ...(typeof input.requestId === "string" && REQUEST_ID.test(input.requestId) ? { requestId: input.requestId } : {}),
        ...(typeof input.vercelError === "string" && VERCEL_ERROR.test(input.vercelError) ? { vercelError: input.vercelError } : {}),
      });
    } catch {
      // Reporting must never become the next error.
    }
  };
}

/**
 * Report an error a student saw: `reportUserError({ kind: "live.chat", code: "timeout", message })`.
 * Through `reportUserError` in src/lib/reportAppError.ts, which loads this module lazily.
 */
export const reportUserError = createUserReporter(deliver);
