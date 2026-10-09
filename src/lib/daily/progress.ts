/**
 * The count on a Today's practice board (`DailyBoard`): how many of the day's problems are finished
 * and how many earned a star, from the attempts the board's tracker publishes (`learningBus`), on top
 * of what was already counted before this visit (the saved row, and this device's note).
 *
 * WHAT COUNTS. An attempt on THIS board, of a problem the tutor wrote: origin `practice` (written by
 * the set's own run, or "Keep going") or `tutor_problem` — after a reload the tracker knows an
 * untouched set problem only by its cell, and files it as the tutor's (`originOfKey`), so without it
 * the stars would stop after a reload. A problem the student wrote, a worked example (`teach`) and
 * "Now you try" are not the set. It counts once, when its outcome first leaves `in_progress`
 * (anything but `unfinished`): done, and a star when the student solved it alone
 * (INDEPENDENT_OUTCOMES). The tracker never changes an answered outcome, so neither does this.
 *
 * WHY TWO NUMBERS. `base` is what was counted before this visit (the larger of the row's and the
 * note's), `fresh` the attempts counted since, by id. An id the note had already counted is never
 * counted again (the tracker keeps a board's attempt ids on the device between visits), and a row
 * read late never swallows what was counted while it loaded.
 *
 * The reducer is pure (`__tests__/progress.test.ts`); the note is a device marker like the others
 * (`boards/deviceMarker.ts`).
 */
import { clearMarker, deviceStorage, readMarker, writeMarker, type StorageLike } from "@/lib/boards/deviceMarker";
import type { AttemptOrigin, AttemptRecord, Outcome } from "@/lib/learning/contracts";
import { DAILY_MARKER_TTL_MS, readDailyMarker, type DailyMarker } from "./dailyMarker";

/** The origins of the set's problems (see the module's comment for `tutor_problem`). */
export const DAILY_ORIGINS: readonly AttemptOrigin[] = ["practice", "tutor_problem"];
/** INDEPENDENT_OUTCOMES (learning/contracts.ts), here so the board's chunk does not carry the skill table. */
const STAR_OUTCOMES: readonly Outcome[] = ["first_try", "self_corrected"];
const NOT_FINISHED: readonly Outcome[] = ["in_progress", "unfinished"];
/** Attempt ids a note keeps (a day's board never has nearly this many). */
const MAX_COUNTED = 100;

export interface DailyProgress {
  goal: number;
  /** counted before this visit: the row's and the note's, the larger */
  base: number;
  baseStars: number;
  /** attempt ids counted before this visit (the note's) */
  known: readonly string[];
  /** attempts counted on this visit: id → a star */
  fresh: Readonly<Record<string, boolean>>;
  /** the goal was reached on this visit: the celebration's moment (once) */
  reachedNow: boolean;
}

export function initialProgress(goal: number): DailyProgress {
  return { goal: Math.max(1, Math.floor(goal) || 1), base: 0, baseStars: 0, known: [], fresh: {}, reachedNow: false };
}

export function doneOf(p: DailyProgress): number {
  return p.base + Object.keys(p.fresh).length;
}

export function starsOf(p: DailyProgress): number {
  return Math.min(doneOf(p), p.baseStars + Object.values(p.fresh).filter(Boolean).length);
}

/** True when this attempt is one of the set's problems on this board, finished. */
export function countsForDaily(record: Pick<AttemptRecord, "boardId" | "origin" | "outcome">, boardId: string): boolean {
  return record.boardId === boardId && DAILY_ORIGINS.includes(record.origin) && !NOT_FINISHED.includes(record.outcome);
}

export type ProgressAction =
  /** what was counted before this visit: the saved row, this device's note */
  | { type: "restore"; done: number; stars: number; counted?: readonly string[] }
  /** an attempt's latest state, from the bus */
  | { type: "attempt"; record: Pick<AttemptRecord, "id" | "boardId" | "origin" | "outcome">; boardId: string }
  /** the celebration has been shown */
  | { type: "celebrated" };

export function progressReducer(state: DailyProgress, action: ProgressAction): DailyProgress {
  switch (action.type) {
    case "restore": {
      const known = [...new Set([...state.known, ...(action.counted ?? [])])].slice(-MAX_COUNTED);
      // an attempt the note already counted is in the note's number: not again
      const fresh = Object.fromEntries(Object.entries(state.fresh).filter(([id]) => !known.includes(id)));
      const base = Math.max(state.base, Math.floor(action.done) || 0);
      const baseStars = Math.max(state.baseStars, Math.floor(action.stars) || 0);
      const next = { ...state, known, fresh, base, baseStars };
      return doneOf(next) === doneOf(state) && starsOf(next) === starsOf(state) && known.length === state.known.length ? state : next;
    }
    case "attempt": {
      const { record } = action;
      if (!countsForDaily(record, action.boardId)) return state;
      if (state.known.includes(record.id) || Object.prototype.hasOwnProperty.call(state.fresh, record.id)) return state;
      const before = doneOf(state);
      const next = { ...state, fresh: { ...state.fresh, [record.id]: STAR_OUTCOMES.includes(record.outcome) } };
      const reached = before < state.goal && doneOf(next) >= state.goal;
      return reached ? { ...next, reachedNow: true } : next;
    }
    case "celebrated":
      return state.reachedNow ? { ...state, reachedNow: false } : state;
  }
}

/** Every attempt id counted so far: what the note keeps for the next visit. */
export function countedIds(p: DailyProgress): string[] {
  return [...new Set([...p.known, ...Object.keys(p.fresh)])].slice(-MAX_COUNTED);
}

// ------------------------------------------------------------------ the device note

/**
 * This device's note for a day's board (`agathon.dailyProgress.<boardId>`): the count so far, the
 * attempt ids in it, and the skills of the set ("Keep going" draws more of them). Written by the
 * home when it makes the board, and by the board as problems finish; kept as long as the daily
 * marker.
 */
export interface DailyNote {
  boardId: string;
  day: string;
  done: number;
  stars: number;
  counted: string[];
  /** the set's skills, in order */
  skills: string[];
  /** the set's problems, so "Keep going" never repeats one */
  problems?: string[][];
  createdAt: number;
}

export function dailyNoteKey(boardId: string): string {
  return `agathon.dailyProgress.${boardId}`;
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

export function readDailyNote(boardId: string, now: number = Date.now(), storage: StorageLike | null = deviceStorage()): DailyNote | null {
  return readMarker<DailyNote>(
    dailyNoteKey(boardId),
    (v) =>
      v.boardId === boardId &&
      typeof v.day === "string" &&
      typeof v.done === "number" &&
      typeof v.stars === "number" &&
      isStrings(v.counted) &&
      isStrings(v.skills) &&
      (v.problems === undefined || (Array.isArray(v.problems) && v.problems.every(isStrings))),
    now,
    storage,
    DAILY_MARKER_TTL_MS,
  );
}

export function writeDailyNote(note: DailyNote, storage: StorageLike | null = deviceStorage()): boolean {
  return writeMarker(dailyNoteKey(note.boardId), note, storage);
}

export function clearDailyNote(boardId: string, storage: StorageLike | null = deviceStorage()): void {
  clearMarker(dailyNoteKey(boardId), storage);
}

/** A storage that can list its keys (localStorage can; the markers' StorageLike need not). */
type ListableStorage = StorageLike & Pick<Storage, "key" | "length">;

function listable(storage: StorageLike | null): ListableStorage | null {
  const s = storage as Partial<ListableStorage> | null;
  return s && typeof s.key === "function" && typeof s.length === "number" ? (s as ListableStorage) : null;
}

/**
 * The board this device made for `day`, from its daily markers (newest first), or null. The home
 * reads it when the row has no board yet (its save failed, or has not landed), so a second tap on
 * Start continues that board rather than making another.
 */
export function findDailyMarker(day: string, now: number = Date.now(), storage: StorageLike | null = deviceStorage()): DailyMarker | null {
  const s = listable(storage);
  if (!s) return null;
  let best: DailyMarker | null = null;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key && key.startsWith("agathon.daily.")) keys.push(key);
    }
    for (const key of keys) {
      const marker = readDailyMarker(key.slice("agathon.daily.".length), now, s);
      if (marker && marker.day === day && (!best || marker.createdAt > best.createdAt)) best = marker;
    }
  } catch {
    return best;
  }
  return best;
}
