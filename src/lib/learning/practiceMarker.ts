/**
 * A practice board's device-side marker: the Progress page (or "Practice my weak spots") creates a
 * board, writes `agathon.practice.<boardId>` = PracticeMarker, and opens it; the board reads it on
 * mount, has the tutor write the problems (`runChatActions` with origin `practice`) and clears it.
 * Like the onboarding marker (`src/lib/onboarding/marker.ts`), kept tiny and import-free: the board
 * page reads `hasPracticeMarker` synchronously in its first load.
 */

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface PracticeMarker {
  boardId: string;
  /** a skill id (`SKILLS`) */
  skill: string;
  /** the problems to write, each its LaTeX lines */
  problems: string[][];
  createdAt: number;
}

/** A marker older than this is ignored (and cleared): the page opened it long ago and never got there. */
export const PRACTICE_MARKER_TTL_MS = 24 * 60 * 60_000;

export function practiceMarkerKey(boardId: string): string {
  return `agathon.practice.${boardId}`;
}

function store(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function writePracticeMarker(marker: PracticeMarker, storage: StorageLike | null = store()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(practiceMarkerKey(marker.boardId), JSON.stringify(marker));
    return true;
  } catch {
    return false;
  }
}

export function readPracticeMarker(boardId: string, now: number = Date.now(), storage: StorageLike | null = store()): PracticeMarker | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(practiceMarkerKey(boardId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PracticeMarker>;
    const ok =
      v.boardId === boardId &&
      typeof v.skill === "string" &&
      typeof v.createdAt === "number" &&
      Array.isArray(v.problems) &&
      v.problems.length > 0 &&
      v.problems.every((p) => Array.isArray(p) && p.length > 0 && p.every((l) => typeof l === "string" && l.length > 0));
    if (!ok || now - (v.createdAt as number) > PRACTICE_MARKER_TTL_MS) {
      clearPracticeMarker(boardId, storage);
      return null;
    }
    return v as PracticeMarker;
  } catch {
    clearPracticeMarker(boardId, storage);
    return null;
  }
}

export function hasPracticeMarker(boardId: string, storage: StorageLike | null = store()): boolean {
  try {
    return Boolean(storage?.getItem(practiceMarkerKey(boardId)));
  } catch {
    return false;
  }
}

export function clearPracticeMarker(boardId: string, storage: StorageLike | null = store()): void {
  try {
    storage?.removeItem(practiceMarkerKey(boardId));
  } catch {
    // nothing to do
  }
}
