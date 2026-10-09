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
 * (anything but `unfinished`): done.
 *
 * ONCE PER PROBLEM, NOT PER ATTEMPT. A problem is counted by its LaTeX (`dailyProblemKey`), so a new
 * attempt at a problem already counted adds nothing: on a second device, or after the tracker
 * forgot the board's attempts (it keeps a few boards per device), answering problem 1 again starts a
 * new attempt id, and is still problem 1. What was counted before this visit (`known`) holds both
 * the problems and their attempt ids (a note from before this rule holds ids only, and still works).
 *
 * STARS FOLLOW THE LATEST OUTCOME. A star is a problem solved alone (INDEPENDENT_OUTCOMES), and the
 * tracker recomputes an outcome on every signal: a `first_try` that later gets counted help (a
 * hint, the tutor's step) becomes `with_help`. So each problem's star is its counting attempt's
 * LATEST outcome, by attempt id. The saved row only goes up (`save_daily_practice` keeps the larger
 * `stars`), so the screen never shows fewer than the row was saved with (`savedStars`): a star taken
 * back after it was saved stays on screen, and the next star the student earns fills that slot
 * rather than adding one the row would not have.
 *
 * WHY TWO NUMBERS. `base` is what was counted before this visit (the largest of the row's, the
 * note's and the record's), `fresh` the problems counted since. A problem already in `known` is
 * never counted again, and a row read late never swallows what was counted while it loaded.
 *
 * The reducer is pure (`__tests__/progress.test.ts`); the note is a device marker like the others
 * (`boards/deviceMarker.ts`).
 */
import { clearMarker, deviceStorage, readMarker, writeMarker, type StorageLike } from "@/lib/boards/deviceMarker";
import type { AttemptOrigin, AttemptRecord, Outcome } from "@/lib/learning/contracts";
import { problemMetaOf } from "@/lib/live/chat/cells";
import { DAILY_MARKER_TTL_MS, readDailyMarker, type DailyMarker } from "./dailyMarker";

/** The origins of the set's problems (see the module's comment for `tutor_problem`). */
export const DAILY_ORIGINS: readonly AttemptOrigin[] = ["practice", "tutor_problem"];
/** INDEPENDENT_OUTCOMES (learning/contracts.ts), here so the board's chunk does not carry the skill table. */
const STAR_OUTCOMES: readonly Outcome[] = ["first_try", "self_corrected"];
const NOT_FINISHED: readonly Outcome[] = ["in_progress", "unfinished"];
/** Problem keys and attempt ids a note keeps (a day's board never has nearly this many). */
const MAX_COUNTED = 100;

/** What the count reads of an attempt (`AttemptRecord`); `problemLatex` absent counts it by its id alone. */
export type DailyAttempt = Pick<AttemptRecord, "id" | "boardId" | "origin" | "outcome"> & { problemLatex?: string };

/**
 * A problem as the count knows it: its LaTeX with no spaces (the tracker joins a system's lines
 * with "; ", the board's cells keep the lines; both come to the same key). Empty for no LaTeX.
 */
export function problemKeyOf(latex: string): string {
  const flat = latex.replace(/\s+/g, "");
  return flat ? `p:${flat}` : "";
}

/** An attempt's problem key, or its id when it has no LaTeX. */
export function dailyProblemKey(record: Pick<DailyAttempt, "id" | "problemLatex">): string {
  return problemKeyOf(record.problemLatex ?? "") || record.id;
}

export interface DailyProgress {
  goal: number;
  /** counted before this visit: the row's, the note's and the record's, the largest */
  base: number;
  baseStars: number;
  /** problem keys and attempt ids counted before this visit (the note's, the record's) */
  known: readonly string[];
  /** problems counted on this visit: problem key → the attempt that counted it, and a star by its latest outcome */
  fresh: Readonly<Record<string, { id: string; star: boolean }>>;
  /** the stars the saved row holds (it never goes down): the screen never shows fewer */
  savedStars: number;
  /** the goal was reached on this visit: the celebration's moment (once) */
  reachedNow: boolean;
}

export function initialProgress(goal: number): DailyProgress {
  return { goal: Math.max(1, Math.floor(goal) || 1), base: 0, baseStars: 0, known: [], fresh: {}, savedStars: 0, reachedNow: false };
}

export function doneOf(p: DailyProgress): number {
  return p.base + Object.keys(p.fresh).length;
}

export function starsOf(p: DailyProgress): number {
  const earned = p.baseStars + Object.values(p.fresh).filter((f) => f.star).length;
  return Math.min(doneOf(p), Math.max(p.savedStars, earned));
}

/** True when this attempt is one of the set's problems on this board, finished. */
export function countsForDaily(record: Pick<AttemptRecord, "boardId" | "origin" | "outcome">, boardId: string): boolean {
  return record.boardId === boardId && DAILY_ORIGINS.includes(record.origin) && !NOT_FINISHED.includes(record.outcome);
}

export type ProgressAction =
  /** what was counted before this visit: the saved row, this device's note, the board's learning record */
  | { type: "restore"; done: number; stars: number; counted?: readonly string[] }
  /** an attempt's latest state, from the bus */
  | { type: "attempt"; record: DailyAttempt; boardId: string }
  /** the row was saved with these stars: the screen never shows fewer */
  | { type: "saved"; stars: number }
  /** the celebration has been shown */
  | { type: "celebrated" };

/** The fresh entry an attempt id counted, by its problem key. */
function freshKeyOf(fresh: DailyProgress["fresh"], id: string): string | undefined {
  return Object.keys(fresh).find((key) => fresh[key].id === id);
}

export function progressReducer(state: DailyProgress, action: ProgressAction): DailyProgress {
  switch (action.type) {
    case "restore": {
      const known = [...new Set([...state.known, ...(action.counted ?? [])])].slice(-MAX_COUNTED);
      // a problem already counted elsewhere is in that number: not again
      const fresh = Object.fromEntries(Object.entries(state.fresh).filter(([key, f]) => !known.includes(key) && !known.includes(f.id)));
      const base = Math.max(state.base, Math.floor(action.done) || 0);
      const baseStars = Math.max(state.baseStars, Math.floor(action.stars) || 0);
      const next = { ...state, known, fresh, base, baseStars };
      return doneOf(next) === doneOf(state) && starsOf(next) === starsOf(state) && known.length === state.known.length ? state : next;
    }
    case "attempt": {
      const { record } = action;
      if (!countsForDaily(record, action.boardId)) return state;
      const key = dailyProblemKey(record);
      if (state.known.includes(key) || state.known.includes(record.id)) return state;
      const star = STAR_OUTCOMES.includes(record.outcome);
      // already counted: only its own attempt's latest outcome moves its star (another attempt at
      // the same problem changes nothing; the tracker may also rename an attempt's problem)
      const counted = Object.prototype.hasOwnProperty.call(state.fresh, key) ? key : freshKeyOf(state.fresh, record.id);
      if (counted !== undefined) {
        const f = state.fresh[counted];
        return f.id !== record.id || f.star === star ? state : { ...state, fresh: { ...state.fresh, [counted]: { id: f.id, star } } };
      }
      const before = doneOf(state);
      const next = { ...state, fresh: { ...state.fresh, [key]: { id: record.id, star } } };
      const reached = before < state.goal && doneOf(next) >= state.goal;
      return reached ? { ...next, reachedNow: true } : next;
    }
    case "saved": {
      const savedStars = Math.max(state.savedStars, Math.floor(action.stars) || 0);
      return savedStars === state.savedStars ? state : { ...state, savedStars };
    }
    case "celebrated":
      return state.reachedNow ? { ...state, reachedNow: false } : state;
  }
}

/** Every problem key and attempt id counted so far: what the note keeps for the next visit. */
export function countedKeys(p: DailyProgress): string[] {
  const fresh = Object.entries(p.fresh).flatMap(([key, f]) => (key === f.id ? [key] : [key, f.id]));
  return [...new Set([...p.known, ...fresh])].slice(-MAX_COUNTED);
}

// ------------------------------------------------------------------ a set the board can finish

/** The problems on a board, once each (by `problemKeyOf`), from its shapes' meta (`CHAT_PROBLEM_META`). */
export function boardProblems(metas: Iterable<unknown>): { key: string; lines: string[] }[] {
  const out = new Map<string, string[]>();
  for (const meta of metas) {
    const p = problemMetaOf(meta);
    if (!p) continue;
    const key = problemKeyOf(p.lines.join("; "));
    if (key && !out.has(key)) out.set(key, [...p.lines]);
  }
  return [...out].map(([key, lines]) => ({ key, lines }));
}

/**
 * How many problems the board must add for the day's goal to be reachable: none once it is reached,
 * or while a problem on the board is still to do; else as many as the goal is short. A set whose
 * writing was cut short (a reload while the tutor's hand was writing, a problem the engine left out,
 * the board not ready) would otherwise leave a goal no one can reach.
 */
export function problemsShort(p: DailyProgress, onBoard: readonly string[]): number {
  const done = doneOf(p);
  if (done >= p.goal) return 0;
  const counted = new Set(countedKeys(p));
  return onBoard.some((key) => !counted.has(key)) ? 0 : p.goal - done;
}

/** The first `n` of the set's `planned` problems whose key is not in `skip` (on the board, counted, or tried already on this visit). */
export function unwrittenProblems(planned: readonly (readonly string[])[], n: number, skip: Iterable<string>): string[][] {
  const out: string[][] = [];
  const seen = new Set(skip);
  for (const lines of planned) {
    if (out.length >= n) break;
    const key = problemKeyOf(lines.join("; "));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push([...lines]);
  }
  return out;
}

/**
 * What the board writes for a set `need` short: the set's own problems that never went on (a write
 * cut short), then `bonus` more of its skills ("Keep going"'s `bonusProblems`) for the rest — none
 * on the board, counted, or tried on this visit already (one the engine left out is not tried
 * again). `fromSet` is how many are the set's own: the rest are new, for the note to remember.
 */
export function topUpProblems(
  need: number,
  set: { planned: readonly (readonly string[])[]; onBoard: readonly { key: string; lines: readonly string[] }[]; counted: readonly string[]; tried: readonly (readonly string[])[] },
  bonus: (n: number, exclude: string[][]) => string[][],
): { problems: string[][]; fromSet: number } {
  if (need <= 0) return { problems: [], fromSet: 0 };
  const tried = set.tried.map((p) => problemKeyOf(p.join("; ")));
  const planned = unwrittenProblems(set.planned, need, [...set.onBoard.map((p) => p.key), ...set.counted, ...tried]);
  if (planned.length >= need) return { problems: planned, fromSet: planned.length };
  const exclude = [...set.planned, ...set.onBoard.map((p) => p.lines), ...set.tried, ...planned].map((p) => [...p]);
  const more = bonus(need - planned.length, exclude).slice(0, need - planned.length);
  return { problems: [...planned, ...more], fromSet: planned.length };
}

// ------------------------------------------------------------------ the device note

/**
 * This device's note for a day's board (`agathon.dailyProgress.<boardId>`): the count so far, the
 * problems and attempt ids in it, and the skills of the set ("Keep going" draws more of them).
 * Written by the home when it makes the board, and by the board as problems finish; kept as long as
 * the daily marker.
 */
export interface DailyNote {
  boardId: string;
  day: string;
  done: number;
  stars: number;
  /** problem keys and attempt ids (`countedKeys`); ids alone in a note from before problem keys */
  counted: string[];
  /** the set's skills, in order */
  skills: string[];
  /** the set's problems, so "Keep going" never repeats one and a set cut short can be finished */
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
 * The board this device made for `userId` on `day`, from its daily markers (newest first), or null.
 * The home reads it when the row has no board yet (its save failed, or has not landed), so a second
 * tap on Start continues that board rather than making another. Profiles share a device, so only
 * this student's markers count: a sibling's or the grown-up's board is never theirs, and a marker
 * from before markers named their student is ignored.
 */
export function findDailyMarker(day: string, userId: string, now: number = Date.now(), storage: StorageLike | null = deviceStorage()): DailyMarker | null {
  if (!userId) return null;
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
      if (marker && marker.day === day && marker.userId === userId && (!best || marker.createdAt > best.createdAt)) best = marker;
    }
  } catch {
    return best;
  }
  return best;
}
