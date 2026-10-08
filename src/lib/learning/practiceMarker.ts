/**
 * A practice board's device-side marker: the Progress page (or "Practice my weak spots", or a topic
 * from the home's topic picker) creates a board, writes `agathon.practice.<boardId>` = PracticeMarker,
 * and opens it; the board reads it on mount, has the tutor write the problems (`runChatActions` with
 * origin `practice`) and clears it. A topic board's marker also carries `examples`: the tutor works
 * one of them first ("Watch me do one"), then writes the problems.
 * Like the onboarding marker (`src/lib/onboarding/marker.ts`), kept tiny and import-free but for the
 * shared helpers (`boards/deviceMarker.ts`): the board page reads `hasPracticeMarker` synchronously
 * in its first load.
 */
import { clearMarker, deviceStorage, hasMarker, MARKER_TTL_MS, readMarker, writeMarker, type StorageLike } from "@/lib/boards/deviceMarker";

export type { StorageLike } from "@/lib/boards/deviceMarker";

export interface PracticeMarker {
  boardId: string;
  /** a skill id (`SKILLS`) */
  skill: string;
  /** the problems to write, each its LaTeX lines */
  problems: string[][];
  /**
   * A topic board: worked-example candidates, easiest first. The board works the first one the
   * engine solves on the device ("Watch me do one"), before the problems. Absent: a practice board.
   */
  examples?: string[][];
  createdAt: number;
}

/** A marker older than this is ignored (and cleared): the page opened it long ago and never got there. */
export const PRACTICE_MARKER_TTL_MS = MARKER_TTL_MS;

export function practiceMarkerKey(boardId: string): string {
  return `agathon.practice.${boardId}`;
}

function isProblemList(v: unknown): v is string[][] {
  return Array.isArray(v) && v.length > 0 && v.every((p) => Array.isArray(p) && p.length > 0 && p.every((l) => typeof l === "string" && l.length > 0));
}

export function writePracticeMarker(marker: PracticeMarker, storage: StorageLike | null = deviceStorage()): boolean {
  return writeMarker(practiceMarkerKey(marker.boardId), marker, storage);
}

export function readPracticeMarker(boardId: string, now: number = Date.now(), storage: StorageLike | null = deviceStorage()): PracticeMarker | null {
  return readMarker<PracticeMarker>(
    practiceMarkerKey(boardId),
    (v) => v.boardId === boardId && typeof v.skill === "string" && isProblemList(v.problems) && (v.examples === undefined || isProblemList(v.examples)),
    now,
    storage,
  );
}

export function hasPracticeMarker(boardId: string, storage: StorageLike | null = deviceStorage()): boolean {
  return hasMarker(practiceMarkerKey(boardId), storage);
}

export function clearPracticeMarker(boardId: string, storage: StorageLike | null = deviceStorage()): void {
  clearMarker(practiceMarkerKey(boardId), storage);
}
