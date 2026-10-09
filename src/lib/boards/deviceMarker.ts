/**
 * A board's device-side start markers, in localStorage: a page that makes a board leaves a note for
 * it (`agathon.<kind>.<boardId>`), then opens it; the board reads the note when it mounts, does what
 * it says once and clears it. The practice and topic boards (`learning/practiceMarker.ts`) and the
 * Ask kickoff (`boards/askKickoff.ts`) are kept this way.
 *
 * Tiny and import-free: the board page reads `hasMarker` synchronously in its first load.
 */

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A marker older than this is ignored (and cleared): the page opened it long ago and never got there. */
export const MARKER_TTL_MS = 24 * 60 * 60_000;

/** Every marker carries when it was written. */
export interface Stamped {
  createdAt: number;
}

export function deviceStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function writeMarker<T extends Stamped>(key: string, value: T, storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearMarker(key: string, storage: StorageLike | null): void {
  try {
    storage?.removeItem(key);
  } catch {
    // nothing to do
  }
}

export function hasMarker(key: string, storage: StorageLike | null): boolean {
  try {
    return Boolean(storage?.getItem(key));
  } catch {
    return false;
  }
}

/**
 * The marker under `key` when `valid` accepts it and it is younger than `ttlMs`; a marker that is
 * not (unreadable, the wrong shape, too old) is cleared, so it is never read again.
 */
export function readMarker<T extends Stamped>(key: string, valid: (value: Record<string, unknown>) => boolean, now: number, storage: StorageLike | null, ttlMs: number = MARKER_TTL_MS): T | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    const ok = typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as Stamped).createdAt === "number" && valid(v as Record<string, unknown>);
    if (!ok || now - (v as Stamped).createdAt > ttlMs) {
      clearMarker(key, storage);
      return null;
    }
    return v as T;
  } catch {
    clearMarker(key, storage);
    return null;
  }
}
