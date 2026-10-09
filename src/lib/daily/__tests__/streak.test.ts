/**
 * The streak and this week's days from `daily_practice` rows: local calendar days, a missed day
 * breaking the run, today not done yet keeping yesterday's run alive.
 */
import { describe, expect, it } from "vitest";
import type { DailyRow } from "../contracts";
import { addDays, dailyStreak, isDay, isDayDone, mondayOf, withProgress } from "../streak";

const done = (day: string, extra: Partial<DailyRow> = {}): DailyRow => ({ day, boardId: null, goal: 5, done: 5, stars: 3, completedAt: `${day}T18:00:00Z`, ...extra });
const started = (day: string, n = 2): DailyRow => ({ day, boardId: "b0000000-0000-4000-8000-000000000000", goal: 5, done: n, stars: 1, completedAt: null });

// 2026-10-08 is a Thursday
const TODAY = "2026-10-08";

describe("calendar days", () => {
  it("adds days across months, years and daylight-saving changes", () => {
    expect(addDays("2026-10-08", 1)).toBe("2026-10-09");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("finds the Monday of a week, Sunday being its last day", () => {
    expect(mondayOf("2026-10-08")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    expect(mondayOf("2026-10-12")).toBe("2026-10-12");
  });

  it("knows a real day from anything else", () => {
    expect(isDay("2026-10-08")).toBe(true);
    expect(isDay("2026-02-31")).toBe(false);
    expect(isDay("2026-10-8")).toBe(false);
    expect(isDay(20261008)).toBe(false);
  });

  it("a day is done when stamped, or when done reached the goal", () => {
    expect(isDayDone(done(TODAY))).toBe(true);
    expect(isDayDone({ done: 5, goal: 5, completedAt: null })).toBe(true);
    expect(isDayDone({ done: 4, goal: 5, completedAt: null })).toBe(false);
    expect(isDayDone(undefined)).toBe(false);
  });
});

describe("dailyStreak", () => {
  it("no rows: no streak, and this week is days before the first set (not missed), today and days to come", () => {
    const s = dailyStreak([], TODAY);
    expect(s.current).toBe(0);
    expect(s.best).toBe(0);
    expect(s.todayDone).toBe(false);
    expect(s.week.map((d) => d.day)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(s.week.map((d) => d.state)).toEqual(["before", "before", "before", "today", "future", "future", "future"]);
  });

  it("missing starts counting from the first set: a day after it with nothing is missed, a day before it is not", () => {
    const s = dailyStreak([done("2026-10-06")], TODAY);
    expect(s.week.map((d) => d.state)).toEqual(["before", "done", "missed", "today", "future", "future", "future"]);
    // a first set from an earlier week: every day of this one counts
    expect(dailyStreak([done("2026-09-30")], TODAY).week[0].state).toBe("missed");
  });

  it("counts back from today when today is done", () => {
    const s = dailyStreak([done("2026-10-06"), done("2026-10-07"), done(TODAY)], TODAY);
    expect(s.current).toBe(3);
    expect(s.todayDone).toBe(true);
    expect(s.week[3].state).toBe("done");
  });

  it("today not done yet keeps yesterday's streak alive", () => {
    const s = dailyStreak([done("2026-10-05"), done("2026-10-06"), done("2026-10-07")], TODAY);
    expect(s.current).toBe(3);
    expect(s.todayDone).toBe(false);
    expect(s.week[3].state).toBe("today");
  });

  it("a missed day breaks it", () => {
    expect(dailyStreak([done("2026-10-05"), done("2026-10-06")], TODAY).current).toBe(0);
    expect(dailyStreak([done("2026-10-04"), done("2026-10-05"), done("2026-10-07"), done(TODAY)], TODAY).current).toBe(2);
  });

  it("a started day that was not finished does not count, and shows as started", () => {
    const s = dailyStreak([done("2026-10-06"), started("2026-10-07"), started(TODAY, 1)], TODAY);
    expect(s.current).toBe(0);
    expect(s.week[1].state).toBe("done");
    expect(s.week[2].state).toBe("started");
    expect(s.week[3].state).toBe("started");
  });

  it("best is the longest run, never less than the current one", () => {
    const rows = [done("2026-09-01"), done("2026-09-02"), done("2026-09-03"), done("2026-09-04"), done("2026-10-07"), done(TODAY)];
    const s = dailyStreak(rows, TODAY);
    expect(s.current).toBe(2);
    expect(s.best).toBe(4);
  });

  it("runs across a month's end", () => {
    expect(dailyStreak([done("2026-09-29"), done("2026-09-30"), done("2026-10-01")], "2026-10-02").current).toBe(3);
  });

  it("ignores rows after today and rows that are not days, in any order", () => {
    const rows = [done("2026-10-09"), done(TODAY), { ...done("2026-10-07"), day: "nope" }, done("2026-10-06")];
    const s = dailyStreak(rows, TODAY);
    expect(s.current).toBe(1);
    expect(s.week[4].state).toBe("future");
  });

  it("a Sunday's week is the Monday before it", () => {
    const s = dailyStreak([done("2026-10-11")], "2026-10-11");
    expect(s.week[0].day).toBe("2026-10-05");
    expect(s.week[6]).toEqual({ day: "2026-10-11", state: "done" });
  });
});

describe("withProgress", () => {
  it("folds the board's count into today's row, never lowering it", () => {
    const rows = withProgress([started(TODAY, 3), done("2026-10-07")], TODAY, { done: 5, stars: 4, goal: 5 });
    const today = rows.find((r) => r.day === TODAY)!;
    expect(today.done).toBe(5);
    expect(today.stars).toBe(4);
    expect(dailyStreak(rows, TODAY).current).toBe(2);
    expect(withProgress([started(TODAY, 3)], TODAY, { done: 1, stars: 0, goal: 5 })[0].done).toBe(3);
  });

  it("adds today's row when there is none yet", () => {
    const rows = withProgress([], TODAY, { done: 5, stars: 5, goal: 5, boardId: "x" });
    expect(rows).toHaveLength(1);
    expect(dailyStreak(rows, TODAY).todayDone).toBe(true);
  });
});
