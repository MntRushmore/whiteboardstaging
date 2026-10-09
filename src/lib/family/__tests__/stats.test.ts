import { describe, expect, it } from "vitest";
import { dailyStreak, kidStats, localDateOf, masteredCount, weekStartOf, type AttemptStatRow } from "../stats";

// Thursday 2026-10-08, 15:00 UTC
const NOW = Date.parse("2026-10-08T15:00:00Z");

let n = 0;
function attempt(over: Partial<AttemptStatRow> & { started_at: string }): AttemptStatRow {
  n++;
  return { id: `id-${n}`, skill: "times_tables", origin: "practice", outcome: "first_try", lines_written: 2, ...over };
}

describe("weekStartOf / localDateOf", () => {
  it("finds Monday", () => {
    expect(weekStartOf("2026-10-08")).toBe("2026-10-05");
    expect(weekStartOf("2026-10-05")).toBe("2026-10-05");
    expect(weekStartOf("2026-10-11")).toBe("2026-10-05");
    expect(weekStartOf("2026-10-12")).toBe("2026-10-12");
  });

  it("uses the offset behind UTC", () => {
    expect(localDateOf(Date.parse("2026-10-09T02:00:00Z"), 300)).toBe("2026-10-08");
    expect(localDateOf(Date.parse("2026-10-09T02:00:00Z"), 0)).toBe("2026-10-09");
  });
});

describe("dailyStreak", () => {
  const done = (day: string) => ({ day, completed_at: `${day}T18:00:00Z` });
  it("counts completed days in a row ending today", () => {
    expect(dailyStreak([done("2026-10-08"), done("2026-10-07"), done("2026-10-06"), done("2026-10-04")], "2026-10-08")).toBe(3);
  });
  it("still counts yesterday's run before today's set is done", () => {
    expect(dailyStreak([done("2026-10-07"), done("2026-10-06"), { day: "2026-10-08", completed_at: null }], "2026-10-08")).toBe(2);
  });
  it("is 0 after a missed day, and ignores started-but-not-finished days", () => {
    expect(dailyStreak([done("2026-10-05")], "2026-10-08")).toBe(0);
    expect(dailyStreak([{ day: "2026-10-08", completed_at: null }], "2026-10-08")).toBe(0);
    expect(dailyStreak([], "2026-10-08")).toBe(0);
  });
});

describe("masteredCount", () => {
  it("counts a skill solved alone again and again, not one with help", () => {
    const mastered = [0, 1, 2, 3].map((i) => attempt({ skill: "times_tables", started_at: new Date(NOW - i * 3_600_000).toISOString() }));
    const helped = [0, 1, 2].map((i) => attempt({ skill: "long_division", outcome: "with_help", started_at: new Date(NOW - i * 3_600_000).toISOString() }));
    const other = [0, 1, 2, 3].map((i) => attempt({ skill: "other", started_at: new Date(NOW - i * 3_600_000).toISOString() }));
    expect(masteredCount([...helped, ...mastered, ...other], NOW)).toBe(1);
  });

  it("needs the newest attempt solved alone", () => {
    const rows = [
      attempt({ outcome: "with_help", started_at: new Date(NOW).toISOString() }),
      ...[1, 2, 3, 4].map((i) => attempt({ started_at: new Date(NOW - i * 3_600_000).toISOString() })),
    ];
    expect(masteredCount(rows, NOW)).toBe(0);
  });
});

describe("kidStats", () => {
  it("counts problems worked since Monday only, untouched tutor problems not at all", () => {
    const stats = kidStats({
      daily: [{ day: "2026-10-08", completed_at: "2026-10-08T14:00:00Z" }],
      attempts: [
        attempt({ started_at: "2026-10-08T10:00:00Z" }),
        attempt({ started_at: "2026-10-05T08:00:00Z" }),
        attempt({ started_at: "2026-10-04T20:00:00Z" }), // last Sunday
        attempt({ outcome: "unfinished", lines_written: 0, started_at: "2026-10-08T11:00:00Z" }),
        attempt({ outcome: "in_progress", lines_written: 1, started_at: "2026-10-08T12:00:00Z" }),
      ],
      now: NOW,
    });
    // three solved alone (the in-progress one is not evidence yet): times tables is mastered
    expect(stats).toEqual({ streak: 1, problemsThisWeek: 3, mastered: 1 });
  });

  it("is all zeros for a new kid", () => {
    expect(kidStats({ daily: [], attempts: [], now: NOW })).toEqual({ streak: 0, problemsThisWeek: 0, mastered: 0 });
  });
});
