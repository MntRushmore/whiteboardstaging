/**
 * A Today's practice board's device-side marker: the home makes the day's board, leaves its problems
 * in a practice marker (`learning/practiceMarker.ts`, cleared once they are written) and this one
 * (`agathon.daily.<boardId>`), which STAYS for the day, so the board shows its stars and celebration
 * again after a reload. The board page reads `hasDailyMarker` synchronously in its first load and
 * then loads `DailyBoard` with a dynamic import.
 *
 * Tiny and import-free but for the shared helpers (`boards/deviceMarker.ts`).
 */
import { clearMarker, deviceStorage, hasMarker, readMarker, writeMarker, type StorageLike } from "@/lib/boards/deviceMarker";

export interface DailyMarker {
  boardId: string;
  /** the local day the set is for, YYYY-MM-DD */
  day: string;
  goal: number;
  createdAt: number;
}

/** Kept a little over a day: the set is the day's, and a board opened tomorrow is an ordinary board. */
export const DAILY_MARKER_TTL_MS = 36 * 60 * 60_000;

export function dailyMarkerKey(boardId: string): string {
  return `agathon.daily.${boardId}`;
}

export function writeDailyMarker(marker: DailyMarker, storage: StorageLike | null = deviceStorage()): boolean {
  return writeMarker(dailyMarkerKey(marker.boardId), marker, storage);
}

export function readDailyMarker(boardId: string, now: number = Date.now(), storage: StorageLike | null = deviceStorage()): DailyMarker | null {
  return readMarker<DailyMarker>(
    dailyMarkerKey(boardId),
    (v) => v.boardId === boardId && typeof v.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.day) && typeof v.goal === "number" && v.goal > 0,
    now,
    storage,
    DAILY_MARKER_TTL_MS,
  );
}

export function hasDailyMarker(boardId: string, storage: StorageLike | null = deviceStorage()): boolean {
  return hasMarker(dailyMarkerKey(boardId), storage);
}

export function clearDailyMarker(boardId: string, storage: StorageLike | null = deviceStorage()): void {
  clearMarker(dailyMarkerKey(boardId), storage);
}
