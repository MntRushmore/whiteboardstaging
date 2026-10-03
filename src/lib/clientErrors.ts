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
 * Not in any page's first load: the board's budget is nearly spent (docs/BUNDLE.md), so this
 * module is a lazy chunk, fetched a few seconds after the page loads (or at the first error, if
 * sooner) — from the same deployment, so a tab left open across a deploy can still report.
 */

export const CLIENT_ERRORS_PATH = "/api/client-errors";
/** Reports per page load, after dedupe. */
export const MAX_REPORTS = 10;
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
};

/**
 * Not worth a report: the ResizeObserver loop warning, a cross-origin "Script error." with nothing
 * in it, aborted fetches (navigating away, a cancelled request), and a pen lifted before tldraw's
 * setPointerCapture ran ("No active pointer with the given id").
 */
const NOISE = /ResizeObserver loop|^Script error\.?$|\babort(ed|error)\b|No active pointer with the given id/i;
/** Thrown from a browser extension's script, not ours (Safari masks extension URLs). */
const EXTENSION = /-extension:\/\/|webkit-masked-url:/;

export function isNoise(message: string, stack = ""): boolean {
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
