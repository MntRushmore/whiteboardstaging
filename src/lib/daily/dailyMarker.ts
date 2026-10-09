/**
 * A Today's practice board's device-side marker: the home makes the day's board, leaves its problems
 * in a practice marker (`learning/practiceMarker.ts`, cleared once they are written) and this one
 * (`agathon.daily.<boardId>`), which STAYS for the day, so the board shows its stars and celebration
 * again after a reload. The board page reads `hasDailyMarker` synchronously in its first load and
 * then loads `DailyBoard` with a dynamic import.
 *
 * WHOSE, AND WHICH DAY. Profiles share a device (the family switcher swaps the Supabase session in
 * the same browser, so a sibling's and the grown-up's markers sit in the same localStorage). A
 * marker names the student it was made for (`userId`), and the home only ever takes its own
 * (`findDailyMarker`). It is also the set of ONE day: the board counts only on that day
 * (`dailyMarkerFor`), so yesterday's board opened today is an ordinary board, never a way to fill in
 * a missed day. A marker from before `userId` was added has none: the home ignores it, and only its
 * own board (which no one else can open) still reads it, on the day it is for.
 *
 * Tiny and import-free but for the shared helpers (`boards/deviceMarker.ts`).
 */
import { clearMarker, deviceStorage, hasMarker, readMarker, writeMarker, type StorageLike } from "@/lib/boards/deviceMarker";

export interface DailyMarker {
  boardId: string;
  /** the student it was made for (absent on a marker written before 2026-10-09's fix) */
  userId?: string;
  /** the local day the set is for, YYYY-MM-DD */
  day: string;
  goal: number;
  createdAt: number;
}

/** Kept a little over a day, so a set started late in the evening survives the night; it counts on its own day only (`dailyMarkerFor`). */
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
    (v) =>
      v.boardId === boardId &&
      (v.userId === undefined || (typeof v.userId === "string" && v.userId.length > 0)) &&
      typeof v.day === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(v.day) &&
      typeof v.goal === "number" &&
      v.goal > 0,
    now,
    storage,
    DAILY_MARKER_TTL_MS,
  );
}

/**
 * The board's marker when the board is `who.userId`'s set for `who.day` (today), else null: a
 * marker of another day (yesterday's board, opened today) or of another student is no daily board.
 * A marker without a `userId` (written before it was added) is taken on its own board.
 */
export function dailyMarkerFor(boardId: string, who: { day: string; userId: string }, now: number = Date.now(), storage: StorageLike | null = deviceStorage()): DailyMarker | null {
  const marker = readDailyMarker(boardId, now, storage);
  if (!marker || marker.day !== who.day) return null;
  return marker.userId === undefined || marker.userId === who.userId ? marker : null;
}

export function hasDailyMarker(boardId: string, storage: StorageLike | null = deviceStorage()): boolean {
  return hasMarker(dailyMarkerKey(boardId), storage);
}

export function clearDailyMarker(boardId: string, storage: StorageLike | null = deviceStorage()): void {
  clearMarker(dailyMarkerKey(boardId), storage);
}
