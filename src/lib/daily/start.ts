/**
 * Opening the day's board from the home (TodayCard), in the order that survives a failure at any
 * step: the board is made first (`createFirstBoard`, as a topic is), then the device notes are left
 * for it — the practice marker with the problems (`PracticeBoard` writes them in the tutor's hand
 * and clears it), the daily marker (`DailyBoard` shows the stars; it stays for the day) and the
 * progress note — then the row is saved with the board's id, so another device can Continue it.
 * Only the board itself is required: without storage the board opens blank, and without the row
 * the home still finds the board through this device's daily marker (`findDailyMarker`). The
 * marker names the student (`userId`): profiles share a device, and only their own is theirs.
 *
 * The row's goal is the planned set's size, and it stays (`save_daily_practice` takes the goal on
 * insert only). A set whose writing is cut short is finished on the board instead: `DailyBoard`
 * writes what is missing once nothing on the board is left to do (`problemsShort`).
 *
 * The steps are injected, so `__tests__/start.test.ts` runs them against fakes.
 */
import type { PracticeMarker } from "@/lib/learning/practiceMarker";
import type { DailyPlan, DailyRow } from "./contracts";
import type { DailyMarker } from "./dailyMarker";
import type { DailyNote } from "./progress";
import type { DailySave } from "./store";

/**
 * The practice marker's skill for a day's set. It is not a skill id on purpose: the set mixes
 * skills, so the board's "Let's practise …!" toast says just "Let's practise!" and the screen keeps
 * its name (`PracticeBoard` names it only for a known skill).
 */
export const DAILY_MARKER_SKILL = "daily";

export interface StartDeps {
  /** the signed-in student, named on the daily marker */
  userId: string;
  createBoard: (title: string) => Promise<{ ok: true; value: string } | { ok: false; error: string }>;
  writePracticeMarker: (marker: PracticeMarker) => boolean;
  writeDailyMarker: (marker: DailyMarker) => boolean;
  writeNote: (note: DailyNote) => boolean;
  save: (save: DailySave) => Promise<DailyRow | null>;
  now: () => number;
}

export type StartResult = { ok: true; boardId: string; saved: boolean; marked: boolean } | { ok: false; error: string };

/** Makes the day's board for `plan`, titled `title`, and leaves everything it needs. */
export async function startDailyBoard(plan: DailyPlan, title: string, deps: StartDeps): Promise<StartResult> {
  if (plan.problems.length === 0) return { ok: false, error: "no_problems" };
  const board = await deps.createBoard(title);
  if (!board.ok) return { ok: false, error: board.error };
  const boardId = board.value;
  const createdAt = deps.now();
  const problems = plan.problems.map((p) => [...p.lines]);
  // the problems first: they are the board; the daily marker and the note are its stars
  const marked = deps.writePracticeMarker({ boardId, skill: DAILY_MARKER_SKILL, problems, createdAt });
  deps.writeDailyMarker({ boardId, userId: deps.userId, day: plan.day, goal: plan.goal, createdAt });
  deps.writeNote({ boardId, day: plan.day, done: 0, stars: 0, counted: [], skills: [...new Set(plan.problems.map((p) => p.skill))], problems, createdAt });
  const row = await deps.save({ day: plan.day, boardId, goal: plan.goal, done: 0, stars: 0 });
  return { ok: true, boardId, saved: row !== null, marked };
}

/**
 * Continue: today's board, with its daily marker put back when this device has none of this
 * student's for today (a second device, cleared storage, a marker from before markers named their
 * student), so the board shows its stars again. Its problems are on the board already, so no
 * practice marker (what is missing, `DailyBoard` writes).
 */
export function continueDailyBoard(
  board: { boardId: string; day: string; goal: number },
  deps: { userId: string; readDailyMarker: (boardId: string) => DailyMarker | null; writeDailyMarker: (marker: DailyMarker) => boolean; now: () => number },
): string {
  const marker = deps.readDailyMarker(board.boardId);
  if (!marker || marker.userId !== deps.userId || marker.day !== board.day) {
    deps.writeDailyMarker({ boardId: board.boardId, userId: deps.userId, day: board.day, goal: board.goal, createdAt: deps.now() });
  }
  return board.boardId;
}

/** The weekday of a local YYYY-MM-DD day in English ("Thursday"), for the board's name. */
export function weekdayName(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getUTCDay()];
}
