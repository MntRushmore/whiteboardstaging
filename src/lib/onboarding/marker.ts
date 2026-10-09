/**
 * The device-side half of onboarding, in localStorage (the profile holds the rest):
 *
 * - the guided board: `agathon.onboarding.tour.<userId>` = `{ boardId, course, grade, starter, step }`,
 *   written by the welcome's Start and advanced by the tour. The board page reads only
 *   `isGuidedBoard` synchronously, so the tour's code loads (a dynamic import) on that one
 *   board and nowhere else.
 * - done: `agathon.onboarding.done.<userId>` = "1" once the welcome or the tour was finished or
 *   skipped, so the home does not ask the profile again, and a save that failed (offline) does
 *   not bring the welcome back on this device.
 *
 * Kept tiny and import-free: this file is part of the board's first load (the plan screen's marker,
 * which the board never reads, is in `planMarker.ts`). Types only from elsewhere: they are erased.
 */
import type { Grade } from "@/lib/learning/grades";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Where the tour is: resumable steps only (a result on screen resumes at the next coach mark). */
export type TourMarkerStep = "problem" | "write" | "help" | "ask";
const MARKER_STEPS: readonly string[] = ["problem", "write", "help", "ask"];
/** a marker written before Help me replaced the help-modes coach mark (2026-10-03) resumes there */
const LEGACY_STEPS: Readonly<Record<string, TourMarkerStep>> = { modes: "help" };

function stepOf(v: unknown): TourMarkerStep {
  if (typeof v !== "string") return "problem";
  if (MARKER_STEPS.includes(v)) return v as TourMarkerStep;
  return LEGACY_STEPS[v] ?? "problem";
}

/** 0..8, as `isGrade` (grades.ts) — spelled out so the board's first load does not carry that module. */
function gradeOf(v: unknown): Grade | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 8 ? (v as Grade) : null;
}

export interface TourMarker {
  boardId: string;
  /** a course id (`courses.ts`), or null when none was chosen */
  course: string | null;
  /** the student's grade (0 is Kindergarten), when they chose one: their starters are the grade's (`startersFor`) */
  grade?: Grade;
  /** index of the student's starter within the grade's or course's list */
  starter: number;
  step: TourMarkerStep;
  /** the student's Auto setting before the tour turned it on, given back at its end (`tourAutoAtEnd`) */
  autoBefore?: boolean;
  /**
   * coach mark 1's answer got a tick: a reload on coach mark 2 still puts the next problem on the
   * board for Help me (`helpProblemFor` needs the tick, and `step` alone cannot say it)
   */
  ticked?: true;
}

export const tourKey = (userId: string) => `agathon.onboarding.tour.${userId}`;
export const doneKey = (userId: string) => `agathon.onboarding.done.${userId}`;

export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readTourMarker(storage: StorageLike | null | undefined, userId: string | null | undefined): TourMarker | null {
  if (!storage || !userId) return null;
  try {
    const raw = storage.getItem(tourKey(userId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<TourMarker>;
    if (!v || typeof v.boardId !== "string" || !v.boardId) return null;
    const grade = gradeOf(v.grade);
    return {
      boardId: v.boardId,
      course: typeof v.course === "string" ? v.course : null,
      ...(grade === null ? {} : { grade }),
      starter: typeof v.starter === "number" && Number.isFinite(v.starter) ? v.starter : 0,
      step: stepOf(v.step),
      ...(typeof v.autoBefore === "boolean" ? { autoBefore: v.autoBefore } : {}),
      ...(v.ticked === true ? { ticked: true as const } : {}),
    };
  } catch {
    return null;
  }
}

/** This board is the student's guided first board and the tour is not finished. */
export function isGuidedBoard(storage: StorageLike | null | undefined, userId: string | null | undefined, boardId: string): boolean {
  return readTourMarker(storage, userId)?.boardId === boardId;
}

export function writeTourMarker(storage: StorageLike | null | undefined, userId: string, marker: TourMarker): void {
  try {
    storage?.setItem(tourKey(userId), JSON.stringify(marker));
  } catch {
    /* quota / private mode: the tour then lasts this visit only */
  }
}

export function clearTourMarker(storage: StorageLike | null | undefined, userId: string): void {
  try {
    storage?.removeItem(tourKey(userId));
  } catch {
    /* nothing to do */
  }
}

export function readLocalDone(storage: StorageLike | null | undefined, userId: string | null | undefined): boolean {
  if (!storage || !userId) return false;
  try {
    return storage.getItem(doneKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function writeLocalDone(storage: StorageLike | null | undefined, userId: string): void {
  try {
    storage?.setItem(doneKey(userId), "1");
  } catch {
    /* the profile still says so */
  }
}
