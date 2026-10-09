/**
 * The count on a day's board: what an attempt adds (once per problem, finished, on this board, a set
 * problem), the stars by each attempt's latest outcome, the celebration's moment, a reload, a late
 * row or a second device never counting anything twice, and a set cut short still finishable.
 */
import { describe, expect, it, vi } from "vitest";
import type { AttemptOrigin, Outcome } from "@/lib/learning/contracts";
import { CHAT_PROBLEM_META } from "@/lib/live/chat/cells";
import { writeDailyMarker } from "../dailyMarker";
import {
  boardProblems,
  countedKeys,
  countsForDaily,
  dailyProblemKey,
  doneOf,
  findDailyMarker,
  initialProgress,
  problemKeyOf,
  problemsShort,
  progressReducer,
  readDailyNote,
  starsOf,
  topUpProblems,
  unwrittenProblems,
  writeDailyNote,
  type DailyProgress,
  type ProgressAction,
} from "../progress";

const BOARD = "b1000000-0000-4000-8000-000000000001";
const KID = "u-kid";
const attempt = (id: string, outcome: Outcome, origin: AttemptOrigin = "practice", boardId: string = BOARD): ProgressAction => ({ type: "attempt", boardId: BOARD, record: { id, outcome, origin, boardId } });
/** an attempt at a problem, as the tracker publishes it (with its LaTeX) */
const at = (id: string, problemLatex: string, outcome: Outcome, origin: AttemptOrigin = "practice"): ProgressAction => ({ type: "attempt", boardId: BOARD, record: { id, outcome, origin, boardId: BOARD, problemLatex } });
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
    expect(countedKeys(q)).toEqual(["a"]);
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

describe("once per problem (a second device, a tracker that forgot the board)", () => {
  it("a problem is its LaTeX, spaces aside; one with none is its attempt", () => {
    expect(problemKeyOf("13 \\times 4")).toBe(problemKeyOf("13\\times 4"));
    expect(problemKeyOf("x + y = 5; x - y = 1")).toBe(problemKeyOf(["x+y=5", "x-y=1"].join("; ")));
    expect(problemKeyOf("  ")).toBe("");
    expect(dailyProblemKey({ id: "a", problemLatex: "" })).toBe("a");
    expect(dailyProblemKey({ id: "a" })).toBe("a");
  });

  it("answering a problem again under a new attempt id counts nothing more", () => {
    const p = run([at("a", "3 + 4", "first_try"), at("a2", "3+4", "with_help"), at("b", "5 + 6", "with_help")]);
    expect(doneOf(p)).toBe(2);
    expect(starsOf(p)).toBe(1);
  });

  it("a problem counted on another device (the record's keys) is not counted again here", () => {
    // the row says 3; the learning record says which: problems 1-3, under the other device's ids
    const counted = [problemKeyOf("1 + 1"), "x1", problemKeyOf("2 + 2"), "x2", problemKeyOf("3 + 3"), "x3"];
    const p = run([
      { type: "restore", done: 3, stars: 2 },
      { type: "restore", done: 3, stars: 0, counted },
      at("new-id", "1 + 1", "first_try", "tutor_problem"),
      at("d", "4 + 4", "first_try"),
    ]);
    expect(doneOf(p)).toBe(4);
    expect(starsOf(p)).toBe(3);
    expect(p.reachedNow).toBe(false);
  });

  it("the record read late takes back a problem counted again while it loaded", () => {
    const p = run([{ type: "restore", done: 3, stars: 1 }, at("new-id", "1 + 1", "first_try"), { type: "restore", done: 3, stars: 0, counted: [problemKeyOf("1 + 1"), "x1"] }]);
    expect(doneOf(p)).toBe(3);
  });

  it("a note from before problem keys (attempt ids only) still keeps its attempts from counting twice", () => {
    const p = run([{ type: "restore", done: 1, stars: 1, counted: ["a"] }, at("a", "1 + 1", "first_try")]);
    expect(doneOf(p)).toBe(1);
  });

  it("an attempt whose problem the tracker renames is still one problem", () => {
    const p = run([at("a", "3 + 4", "first_try"), at("a", "3 + 4 = 7", "first_try")]);
    expect(doneOf(p)).toBe(1);
  });

  it("the note keeps both the problems and their attempts", () => {
    const p = run([at("a", "3 + 4", "first_try"), attempt("b", "with_help")]);
    expect(countedKeys(p)).toEqual([problemKeyOf("3 + 4"), "a", "b"]);
  });
});

describe("stars follow each attempt's latest outcome", () => {
  it("a first try that later gets help is no star (not saved yet)", () => {
    const p = run([at("a", "13 \\times 4", "first_try"), at("a", "13 \\times 4", "with_help")]);
    expect(doneOf(p)).toBe(1);
    expect(starsOf(p)).toBe(0);
  });

  it("a star already saved stays on screen, and the next one earned fills its slot rather than adding one", () => {
    let p = run([at("a", "1 + 1", "first_try"), { type: "saved", stars: 1 }, at("a", "1 + 1", "with_help")]);
    expect(starsOf(p)).toBe(1);
    p = progressReducer(p, at("b", "2 + 2", "first_try"));
    expect(doneOf(p)).toBe(2);
    expect(starsOf(p)).toBe(1);
    p = progressReducer(p, at("c", "3 + 3", "self_corrected"));
    expect(starsOf(p)).toBe(2);
  });

  it("another attempt at a counted problem never moves its star", () => {
    const p = run([at("a", "1 + 1", "with_help"), at("a2", "1 + 1", "first_try")]);
    expect(starsOf(p)).toBe(0);
    const q = run([at("a", "1 + 1", "first_try"), at("a2", "1 + 1", "with_help")]);
    expect(starsOf(q)).toBe(1);
  });

  it("a saved count lower than the screen's changes nothing on screen, and the same one twice is no change", () => {
    const p = run([at("a", "1 + 1", "first_try"), at("b", "2 + 2", "first_try"), { type: "saved", stars: 1 }]);
    expect(starsOf(p)).toBe(2);
    expect(progressReducer(p, { type: "saved", stars: 1 })).toBe(p);
  });
});

describe("a set cut short can still be finished", () => {
  const cell = { x: 0, y: 0, w: 100, h: 100 };
  const problem = (lines: string[]) => ({ [CHAT_PROBLEM_META]: { n: 1, lines, cell } });

  it("lists the board's problems once each, from its shapes' meta", () => {
    const metas = [problem(["3 + 4"]), problem(["3 + 4"]), { live: true }, null, problem(["x + y = 5", "x - y = 1"]), problem(["3+4"])];
    expect(boardProblems(metas)).toEqual([
      { key: problemKeyOf("3 + 4"), lines: ["3 + 4"] },
      { key: problemKeyOf("x + y = 5; x - y = 1"), lines: ["x + y = 5", "x - y = 1"] },
    ]);
  });

  it("short only once nothing on the board is left to do", () => {
    const one = problemKeyOf("1 + 1");
    const two = problemKeyOf("2 + 2");
    // three of five written, one done: the other two are still to do
    let p = run([at("a", "1 + 1", "first_try")]);
    expect(problemsShort(p, [one, two, problemKeyOf("3 + 3")])).toBe(0);
    // every problem on the board done, the goal still 3 short: those 3
    p = progressReducer(p, at("b", "2 + 2", "with_help"));
    expect(problemsShort(p, [one, two])).toBe(3);
    // nothing was written at all
    expect(problemsShort(initialProgress(5), [])).toBe(5);
    // the goal reached: never
    expect(problemsShort(run(["a", "b", "c", "d", "e"].map((id) => attempt(id, "first_try"))), [])).toBe(0);
  });

  it("a problem counted on another visit (in the note) is done, not still to do", () => {
    const p = run([{ type: "restore", done: 1, stars: 1, counted: [problemKeyOf("1 + 1"), "a"] }]);
    expect(problemsShort(p, [problemKeyOf("1 + 1")])).toBe(4);
  });

  it("the set's own problems not on the board, then nothing it has tried", () => {
    const planned = [["1 + 1"], ["2 + 2"], ["3 + 3"], ["4 + 4"]];
    expect(unwrittenProblems(planned, 2, [problemKeyOf("1 + 1")])).toEqual([["2 + 2"], ["3 + 3"]]);
    expect(unwrittenProblems(planned, 5, planned.map((p) => problemKeyOf(p.join("; "))))).toEqual([]);
    expect(unwrittenProblems([["1 + 1"], ["1+1"]], 5, [])).toEqual([["1 + 1"]]);
  });

  it("what it writes: the set's own problems that never went on, then more of its skills, never one tried already", () => {
    const planned = [["1 + 1"], ["2 + 2"], ["3 + 3"], ["4 + 4"], ["5 + 5"]];
    const key = (s: string) => problemKeyOf(s);
    const bonus = vi.fn((n: number, exclude: string[][]) => [["6 + 6"], ["7 + 7"], ["8 + 8"]].filter((p) => !exclude.some((e) => e.join() === p.join())).slice(0, n));
    // a reload cut the write after 3: problems 4 and 5 go on, nothing new
    const resumed = topUpProblems(2, { planned, onBoard: planned.slice(0, 3).map((p) => ({ key: key(p[0]), lines: p })), counted: [], tried: [] }, bonus);
    expect(resumed).toEqual({ problems: [["4 + 4"], ["5 + 5"]], fromSet: 2 });
    expect(bonus).not.toHaveBeenCalled();
    // the engine left 4 + 4 out last time: 5 + 5 from the set, then one new one (never 4 + 4 again)
    const retried = topUpProblems(2, { planned, onBoard: planned.slice(0, 3).map((p) => ({ key: key(p[0]), lines: p })), counted: [], tried: [["4 + 4"]] }, bonus);
    expect(retried).toEqual({ problems: [["5 + 5"], ["6 + 6"]], fromSet: 1 });
    expect(bonus.mock.calls[0][1]).toEqual(expect.arrayContaining([["4 + 4"], ["5 + 5"], ["1 + 1"]]));
    // another device, no note: all new
    expect(topUpProblems(2, { planned: [], onBoard: [], counted: [], tried: [] }, bonus)).toEqual({ problems: [["6 + 6"], ["7 + 7"]], fromSet: 0 });
    // a problem counted (rubbed out since) is not written again
    expect(topUpProblems(1, { planned: [["1 + 1"], ["2 + 2"]], onBoard: [], counted: [key("1 + 1")], tried: [] }, bonus).problems).toEqual([["2 + 2"]]);
    expect(topUpProblems(0, { planned, onBoard: [], counted: [], tried: [] }, bonus).problems).toEqual([]);
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
    writeDailyMarker({ boardId: "old", userId: KID, day: "2026-10-07", goal: 5, createdAt: 1 }, storage);
    writeDailyMarker({ boardId: "first", userId: KID, day: "2026-10-08", goal: 5, createdAt: 2 }, storage);
    writeDailyMarker({ boardId: "second", userId: KID, day: "2026-10-08", goal: 5, createdAt: 3 }, storage);
    storage.setItem("agathon.daily.broken", "{nope");
    expect(findDailyMarker("2026-10-08", KID, 10, storage)?.boardId).toBe("second");
    expect(findDailyMarker("2026-10-09", KID, 10, storage)).toBeNull();
    expect(findDailyMarker("2026-10-08", KID, 10, null)).toBeNull();
    // a storage that cannot list its keys: none found, nothing thrown
    expect(findDailyMarker("2026-10-08", KID, 10, { getItem: () => null, setItem: () => {}, removeItem: () => {} })).toBeNull();
  });

  it("a shared device: only this student's board, never a sibling's or the grown-up's", () => {
    const storage = memoryStorage();
    // the older sibling did today's set on this iPad, and so did the grown-up
    writeDailyMarker({ boardId: "sibling", userId: "u-sibling", day: "2026-10-08", goal: 5, createdAt: 5 }, storage);
    writeDailyMarker({ boardId: "parent", userId: "u-parent", day: "2026-10-08", goal: 5, createdAt: 6 }, storage);
    expect(findDailyMarker("2026-10-08", KID, 10, storage)).toBeNull();
    expect(findDailyMarker("2026-10-08", "u-sibling", 10, storage)?.boardId).toBe("sibling");
    writeDailyMarker({ boardId: "mine", userId: KID, day: "2026-10-08", goal: 5, createdAt: 1 }, storage);
    expect(findDailyMarker("2026-10-08", KID, 10, storage)?.boardId).toBe("mine");
    expect(findDailyMarker("2026-10-08", "", 10, storage)).toBeNull();
  });

  it("a marker from before markers named their student is nobody's on the home", () => {
    const storage = memoryStorage();
    writeDailyMarker({ boardId: "legacy", day: "2026-10-08", goal: 5, createdAt: 1 }, storage);
    expect(findDailyMarker("2026-10-08", KID, 10, storage)).toBeNull();
  });
});
