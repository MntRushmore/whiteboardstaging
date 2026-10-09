/**
 * Opening the day's board from the home: the board first, then its notes (the problems for the
 * tutor's hand, the daily marker, the progress note), then the row; and Continue putting the daily
 * marker back on a device that has none.
 */
import { describe, expect, it, vi } from "vitest";
import type { DailyPlan } from "../contracts";
import { continueDailyBoard, DAILY_MARKER_SKILL, startDailyBoard, weekdayName, type StartDeps } from "../start";

const BOARD = "b1000000-0000-4000-8000-000000000001";
const PLAN: DailyPlan = {
  day: "2026-10-08",
  goal: 3,
  problems: [
    { skill: "add_subtract", lines: ["3 + 4"], why: "review" },
    { skill: "fractions", lines: ["\\frac{1}{2} + \\frac{1}{4}"], why: "next" },
    { skill: "fractions", lines: ["\\frac{2}{3} + \\frac{1}{6}"], why: "next" },
  ],
};

function deps(over: Partial<StartDeps> = {}) {
  const order: string[] = [];
  const d: StartDeps = {
    createBoard: vi.fn(async () => {
      order.push("board");
      return { ok: true as const, value: BOARD };
    }),
    writePracticeMarker: vi.fn(() => (order.push("practice"), true)),
    writeDailyMarker: vi.fn(() => (order.push("daily"), true)),
    writeNote: vi.fn(() => (order.push("note"), true)),
    save: vi.fn(async (s) => (order.push("save"), { ...s, completedAt: null })),
    now: () => 1_000,
    ...over,
  };
  return { d, order };
}

describe("startDailyBoard", () => {
  it("makes the board, leaves its problems, its daily marker and its note, then saves the row", async () => {
    const { d, order } = deps();
    const result = await startDailyBoard(PLAN, "Today's practice · Thursday", d);
    expect(result).toEqual({ ok: true, boardId: BOARD, saved: true, marked: true });
    expect(order).toEqual(["board", "practice", "daily", "note", "save"]);
    expect(d.createBoard).toHaveBeenCalledWith("Today's practice · Thursday");
    expect(d.writePracticeMarker).toHaveBeenCalledWith({ boardId: BOARD, skill: DAILY_MARKER_SKILL, problems: PLAN.problems.map((p) => p.lines), createdAt: 1_000 });
    expect(d.writeDailyMarker).toHaveBeenCalledWith({ boardId: BOARD, day: "2026-10-08", goal: 3, createdAt: 1_000 });
    expect(d.writeNote).toHaveBeenCalledWith(expect.objectContaining({ boardId: BOARD, day: "2026-10-08", done: 0, stars: 0, counted: [], skills: ["add_subtract", "fractions"] }));
    expect(d.save).toHaveBeenCalledWith({ day: "2026-10-08", boardId: BOARD, goal: 3, done: 0, stars: 0 });
  });

  it("a board that was not made stops there, with nothing left behind", async () => {
    const { d, order } = deps({ createBoard: async () => ({ ok: false as const, error: "insert refused" }) });
    expect(await startDailyBoard(PLAN, "t", d)).toEqual({ ok: false, error: "insert refused" });
    expect(order).toEqual([]);
  });

  it("an empty plan makes no board", async () => {
    const { d } = deps();
    expect(await startDailyBoard({ ...PLAN, problems: [] }, "t", d)).toEqual({ ok: false, error: "no_problems" });
    expect(d.createBoard).not.toHaveBeenCalled();
  });

  it("opens the board even when the row or the device storage fail", async () => {
    const { d } = deps({ save: async () => null, writePracticeMarker: () => false });
    expect(await startDailyBoard(PLAN, "t", d)).toEqual({ ok: true, boardId: BOARD, saved: false, marked: false });
  });
});

describe("continueDailyBoard", () => {
  it("puts the daily marker back only when this device has none", () => {
    const write = vi.fn(() => true);
    expect(continueDailyBoard({ boardId: BOARD, day: "2026-10-08", goal: 5 }, { hasDailyMarker: () => true, writeDailyMarker: write, now: () => 5 })).toBe(BOARD);
    expect(write).not.toHaveBeenCalled();
    continueDailyBoard({ boardId: BOARD, day: "2026-10-08", goal: 5 }, { hasDailyMarker: () => false, writeDailyMarker: write, now: () => 5 });
    expect(write).toHaveBeenCalledWith({ boardId: BOARD, day: "2026-10-08", goal: 5, createdAt: 5 });
  });
});

describe("weekdayName", () => {
  it("names a local day's weekday", () => {
    expect(weekdayName("2026-10-08")).toBe("Thursday");
    expect(weekdayName("2026-10-11")).toBe("Sunday");
    expect(weekdayName("nope")).toBe("");
  });
});
