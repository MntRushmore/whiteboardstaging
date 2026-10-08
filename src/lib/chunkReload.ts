import { useEffect } from "react";
import type { UserErrorInput } from "@/lib/clientErrors";
import { reportUserErrorBeforeLeaving } from "@/lib/reportAppError";

/**
 * A chunk of the release the page was loaded with could not be fetched: a deploy since (the new
 * release no longer has the old one's files; Vercel Skew Protection would keep them), or the
 * connection dropped as it was fetched. Webpack's and Turbopack's words (`ChunkLoadError`, "Loading
 * chunk 12 failed", "Failed to load chunk /_next/static/chunks/….js"), and each browser's for a
 * failed `import()`: Chrome "Failed to fetch dynamically imported module", Safari "Importing a
 * module script failed", Firefox "error loading dynamically imported module".
 *
 * Not a bug in the app, and a reload fixes it: the error boundaries (src/app/error.tsx,
 * src/app/global-error.tsx, the board's BoardCrashed) reload the page once instead of showing
 * their error screen (`useChunkReload`), and tell the admin page at `info` (`live.app`,
 * `chunk_reload`) instead of reporting a crash. Once per page per CHUNK_RELOAD_WINDOW_MS,
 * remembered in sessionStorage: when the reload did not fix it (the chunk is missing from the
 * live release, or the connection is down), the boundary shows its error screen and reports the
 * crash as before, rather than reloading in a loop.
 */
export const CHUNK_LOAD_ERROR =
  /ChunkLoadError|Loading chunk|Failed to load chunk|dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

/** One reload per page (path) in this long; a stale chunk again within it is a real failure. */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;
/** How long the reload waits for the report to be on its way. */
export const CHUNK_RELOAD_REPORT_WAIT_MS = 1_000;
/** What a boundary shows while the page reloads for a stale chunk; also the report's words. */
export const CHUNK_RELOAD_COPY = "Loading the latest version of Agathon…";

const KEY_PREFIX = "agathon:chunk-reload:";

export const CHUNK_RELOAD_REPORT: UserErrorInput = { kind: "live.app", code: "chunk_reload", message: CHUNK_RELOAD_COPY, level: "info" };

export function isChunkLoadError(error: unknown): boolean {
  try {
    const e = error as { name?: unknown; message?: unknown } | null | undefined;
    const name = typeof e?.name === "string" ? e.name : "";
    const message = typeof e?.message === "string" ? e.message : typeof error === "string" ? error : "";
    return CHUNK_LOAD_ERROR.test(`${name}: ${message}`);
  } catch {
    return false;
  }
}

export type ReloadMemory = Pick<Storage, "getItem" | "setItem">;

/**
 * Remember a reload of `path` at `now` and say whether it may happen: not when one did within
 * CHUNK_RELOAD_WINDOW_MS, and not without storage that remembers it (it could loop).
 */
export function claimChunkReload(path: string, storage: ReloadMemory | null | undefined, now: number): boolean {
  if (!storage) return false;
  try {
    const key = KEY_PREFIX + path;
    const last = Number(storage.getItem(key));
    if (last > 0 && Math.abs(now - last) < CHUNK_RELOAD_WINDOW_MS) return false;
    storage.setItem(key, String(now));
    return storage.getItem(key) === String(now);
  } catch {
    return false;
  }
}

function sessionStore(): ReloadMemory | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Per error: a boundary renders more than once (and twice in Strict Mode), and must decide once. */
const decided = new WeakMap<object, boolean>();

/**
 * During an error boundary's render: whether the page will reload for `error` (a stale chunk, and
 * no reload of this page within the window). Claims the reload, so the same error gets the same
 * answer on every render and a second one does not reload again.
 */
export function chunkReloadDue(error: unknown): boolean {
  if (typeof window === "undefined" || !isChunkLoadError(error)) return false;
  const key = typeof error === "object" && error !== null ? error : null;
  const known = key ? decided.get(key) : undefined;
  if (known !== undefined) return known;
  const due = claimChunkReload(location.pathname, sessionStore(), Date.now());
  if (key) decided.set(key, due);
  return due;
}

/** Report the reload at `info`, then reload: once the report is on its way, or after a second at most. */
export function reloadForNewRelease(): void {
  let done = false;
  const reload = () => {
    if (done) return;
    done = true;
    location.reload();
  };
  setTimeout(reload, CHUNK_RELOAD_REPORT_WAIT_MS);
  void reportUserErrorBeforeLeaving(CHUNK_RELOAD_REPORT).then(reload);
}

/**
 * For an error boundary: true while the page reloads for a stale chunk (show CHUNK_RELOAD_COPY, not
 * the error, and report nothing more); false for any other error, or a stale chunk again within a
 * minute of the last reload (show the error screen and report the crash).
 */
export function useChunkReload(error: unknown): boolean {
  const reloading = chunkReloadDue(error);
  useEffect(() => {
    if (reloading) reloadForNewRelease();
  }, [reloading]);
  return reloading;
}
