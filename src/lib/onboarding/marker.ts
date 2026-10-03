/**
 * The device-side half of onboarding, in localStorage (the profile holds the rest):
 *
 * - the guided board: `agathon.onboarding.tour.<userId>` = `{ boardId, course, starter, step }`,
 *   written by the welcome's Start and advanced by the tour. The board page reads only
 *   `isGuidedBoard` synchronously, so the tour's code loads (a dynamic import) on that one
 *   board and nowhere else.
 * - done: `agathon.onboarding.done.<userId>` = "1" once the welcome or the tour was finished or
 *   skipped, so the home does not ask the profile again, and a save that failed (offline) does
 *   not bring the welcome back on this device.
 * - the plan: `agathon.onboarding.plan.<userId>` = "pending" once the guided board was finished
 *   (not skipped), "seen" once the plan screen has shown. The tour's last button opens the plan
 *   screen itself; "pending" covers the student who never got there (a reload on the finish
 *   card), so the home sends them to it once. The profile has no column for it and needs none:
 *   the plan screen follows the tour, which runs once per account, on one device.
 *
 * Kept tiny and import-free: this file is part of the board's first load.
 */

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

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

export interface TourMarker {
  boardId: string;
  /** a course id (`courses.ts`), or null when none was chosen */
  course: string | null;
  /** index of the student's starter within the course's list */
  starter: number;
  step: TourMarkerStep;
}

export const tourKey = (userId: string) => `agathon.onboarding.tour.${userId}`;
export const doneKey = (userId: string) => `agathon.onboarding.done.${userId}`;
export const planKey = (userId: string) => `agathon.onboarding.plan.${userId}`;

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
    return {
      boardId: v.boardId,
      course: typeof v.course === "string" ? v.course : null,
      starter: typeof v.starter === "number" && Number.isFinite(v.starter) ? v.starter : 0,
      step: stepOf(v.step),
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

/** The plan screen after the guided board: still to show, already shown, or never due (null). */
export type PlanMarker = "pending" | "seen";

export function readPlanMarker(storage: StorageLike | null | undefined, userId: string | null | undefined): PlanMarker | null {
  if (!storage || !userId) return null;
  try {
    const v = storage.getItem(planKey(userId));
    return v === "pending" || v === "seen" ? v : null;
  } catch {
    return null;
  }
}

export function writePlanMarker(storage: StorageLike | null | undefined, userId: string, value: PlanMarker): void {
  try {
    storage?.setItem(planKey(userId), value);
  } catch {
    /* private mode: the tour's own button still opens the plan screen, once */
  }
}
