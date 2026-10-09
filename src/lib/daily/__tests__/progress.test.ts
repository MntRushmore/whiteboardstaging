/**
 * The count on a day's board: what an attempt adds (once, finished, on this board, a set problem),
 * the stars, the celebration's moment, and a reload or a late row never counting anything twice.
 */
import { describe, expect, it } from "vitest";
import type { AttemptOrigin, Outcome } from "@/lib/learning/contracts";
import { writeDailyMarker } from "../dailyMarker";
import { countedIds, countsForDaily, doneOf, findDailyMarker, initialProgress, progressReducer, readDailyNote, starsOf, writeDailyNote, type DailyProgress, type ProgressAction } from "../progress";

const BOARD = "b1000000-0000-4000-8000-000000000001";
const attempt = (id: string, outcome: Outcome, origin: AttemptOrigin = "practice", boardId: string = BOARD): ProgressAction => ({ type: "attempt", boardId: BOARD, record: { id, outcome, origin, boardId } });
const run = (actions: ProgressAction[], start: DailyProgress = initialProgress(5)) => actions.reduce(progressReducer, start);

/** An in-memory localStorage (with `key` and `length`, as the browser's has). */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

describe("what counts", () => {
  it("a finished set problem on this board: practice, or the tutor's after a reload", () => {
    expect(countsForDaily({ boardId: BOARD, origin: "practice", outcome: "first_try" }, BOARD)).toBe(true);
    expect(countsForDaily({ boardId: BOARD, origin: "tutor_problem", outcome: "with_help" }, BOARD)).toBe(true);
    expect(countsForDaily({ boardId: BOARD, origin: "practice", outcome: "tutor_solved" }, BOARD)).toBe(true);
  });

  it("not one still going or left unfinished, not another board's, not the student's own or a worked example", () => {
    expect(countsForDaily({ boardId: BOARD, origin: "practice", outcome: "in_progress" }, BOARD)).toBe(false);
    expect(countsForDaily({ boardId: BOARD, origin: "practice", outcome: "unfinished" }, BOARD)).toBe(false);
    expect(countsForDaily({ boardId: "other", origin: "practice", outcome: "first_try" }, BOARD)).toBe(false);
    for (const origin of ["student", "teach", "now_you_try", "starter"] as const) expect(countsForDaily({ boardId: BOARD, origin, outcome: "first_try" }, BOARD)).toBe(false);
  });
});

describe("progressReducer", () => {
  it("counts each attempt once, with a star when solved alone", () => {
    const p = run([attempt("a", "in_progress"), attempt("a", "first_try"), attempt("a", "first_try"), attempt("b", "with_help"), attempt("c", "self_corrected")]);
    expect(doneOf(p)).toBe(3);
    expect(starsOf(p)).toBe(2);
    expect(p.reachedNow).toBe(false);
  });

  it("the goal reached on this visit is the celebration's moment, once", () => {
    let p = run(["a", "b", "c", "d"].map((id) => attempt(id, "first_try")));
    expect(p.reachedNow).toBe(false);
    p = progressReducer(p, attempt("e", "tutor_solved"));
    expect(doneOf(p)).toBe(5);
    expect(starsOf(p)).toBe(4);
    expect(p.reachedNow).toBe(true);
    p = progressReducer(p, { type: "celebrated" });
    expect(p.reachedNow).toBe(false);
    // "Keep going": more count, no second celebration
    p = progressReducer(p, attempt("f", "first_try"));
    expect(doneOf(p)).toBe(6);
    expect(p.reachedNow).toBe(false);
  });

  it("a board restored at its goal never celebrates again", () => {
    const p = run([{ type: "restore", done: 5, stars: 3 }, attempt("x", "first_try")]);
    expect(doneOf(p)).toBe(6);
    expect(p.reachedNow).toBe(false);
  });

  it("goes on from the saved row and the note, the larger of each", () => {
    const p = run([{ type: "restore", done: 2, stars: 1, counted: ["a", "b"] }, { type: "restore", done: 3, stars: 1 }, attempt("c", "first_try")]);
    expect(doneOf(p)).toBe(4);
    expect(starsOf(p)).toBe(2);
    expect(run([{ type: "restore", done: 3, stars: 2 }, { type: "restore", done: 1, stars: 0 }]).base).toBe(3);
  });

  it("an attempt the note already counted is never counted again (the tracker keeps its id across visits)", () => {
    const p = run([{ type: "restore", done: 2, stars: 2, counted: ["a", "b"] }, attempt("a", "first_try"), attempt("b", "first_try")]);
    expect(doneOf(p)).toBe(2);
    expect(starsOf(p)).toBe(2);
  });

  it("a row read late does not swallow what was counted while it loaded", () => {
    const p = run([attempt("a", "first_try"), { type: "restore", done: 3, stars: 2 }]);
    expect(doneOf(p)).toBe(4);
    expect(starsOf(p)).toBe(3);
    // and a note that had already counted it takes it back into its own number
    const q = run([attempt("a", "first_try"), { type: "restore", done: 3, stars: 2, counted: ["a"] }]);
    expect(doneOf(q)).toBe(3);
    expect(countedIds(q)).toEqual(["a"]);
  });

  it("ignores attempts that do not count", () => {
    const start = initialProgress(5);
    expect(progressReducer(start, attempt("a", "first_try", "student"))).toBe(start);
    expect(progressReducer(start, attempt("a", "first_try", "practice", "elsewhere"))).toBe(start);
  });

  it("stars never outnumber the problems done", () => {
    expect(starsOf(run([{ type: "restore", done: 2, stars: 9 }]))).toBe(2);
  });
});

describe("the device note and today's board", () => {
  it("writes and reads a board's note, and refuses another board's", () => {
    const storage = memoryStorage();
    const note = { boardId: BOARD, day: "2026-10-08", done: 2, stars: 1, counted: ["a", "b"], skills: ["fractions"], problems: [["1 + 1"]], createdAt: 1_000 };
    expect(writeDailyNote(note, storage)).toBe(true);
    expect(readDailyNote(BOARD, 2_000, storage)).toEqual(note);
    expect(readDailyNote("someone-else", 2_000, storage)).toBeNull();
    // past its time (a little over a day): gone
    expect(readDailyNote(BOARD, 1_000 + 37 * 3_600_000, storage)).toBeNull();
  });

  it("finds the board this device made for a day, the newest one", () => {
    const storage = memoryStorage();
    writeDailyMarker({ boardId: "old", day: "2026-10-07", goal: 5, createdAt: 1 }, storage);
    writeDailyMarker({ boardId: "first", day: "2026-10-08", goal: 5, createdAt: 2 }, storage);
    writeDailyMarker({ boardId: "second", day: "2026-10-08", goal: 5, createdAt: 3 }, storage);
    storage.setItem("agathon.daily.broken", "{nope");
    expect(findDailyMarker("2026-10-08", 10, storage)?.boardId).toBe("second");
    expect(findDailyMarker("2026-10-09", 10, storage)).toBeNull();
    expect(findDailyMarker("2026-10-08", 10, null)).toBeNull();
    // a storage that cannot list its keys: none found, nothing thrown
    expect(findDailyMarker("2026-10-08", 10, { getItem: () => null, setItem: () => {}, removeItem: () => {} })).toBeNull();
  });
});
