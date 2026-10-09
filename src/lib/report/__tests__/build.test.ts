import { describe, expect, it } from "vitest";
import { MISTAKES } from "@/lib/learning/contracts";
import { buildChildWeek, buildWeeklyReport, hasActivity, readSince, toRecord, type ChildInput, type ReportAttemptRow, type ReportDailyRow, type WeekContext } from "../build";
import { SKILL_TIPS } from "../tips";

const TZ = "America/New_York";
const WEEK = "2026-10-05"; // Monday; the week ends Sunday Oct 11 (local)
/** After the week: a past week's report. */
const LATER = Date.parse("2026-10-14T15:00:00Z");

let seq = 0;
function attempt(over: Partial<ReportAttemptRow> & { at: string }): ReportAttemptRow {
  seq++;
  const { at, ...rest } = over;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    board_id: "b1",
    problem_latex: "6 \\times 7",
    skill: "times_tables",
    course: null,
    origin: "practice",
    outcome: "first_try",
    lines_written: 2,
    active_ms: 60_000,
    mistakes: {},
    started_at: at,
    updated_at: at,
    finished_at: at,
    ...rest,
  };
}

function child(attempts: ReportAttemptRow[], over: Partial<ChildInput> = {}): ChildInput {
  return { userId: "kid-1", displayName: "Maya", avatar: "fox", grade: 3, course: null, attempts, daily: [], ...over };
}

const ctx = (over: Partial<WeekContext> = {}): WeekContext => ({ weekStart: WEEK, timeZone: TZ, now: LATER, ...over });

describe("the week's numbers", () => {
  it("counts finished problems, solved alone, minutes and active days in the family's zone", () => {
    const rows = [
      attempt({ at: "2026-10-05T20:00:00Z" }), // Mon
      attempt({ at: "2026-10-05T20:05:00Z", outcome: "self_corrected" }),
      attempt({ at: "2026-10-06T20:00:00Z", outcome: "with_help", board_id: "b2" }), // Tue
      attempt({ at: "2026-10-06T20:10:00Z", outcome: "tutor_solved", board_id: "b2", skill: "division_facts", problem_latex: "42 \\div 6" }),
      attempt({ at: "2026-10-07T20:00:00Z", outcome: "unfinished", skill: "division_facts", problem_latex: "36 \\div 4" }), // Wed: worked, not finished
      attempt({ at: "2026-10-08T20:00:00Z", outcome: "in_progress", lines_written: 0, active_ms: 30_000 }), // Thu: not worked
      attempt({ at: "2026-10-12T02:30:00Z" }), // Sunday 22:30 in New York: this week
      attempt({ at: "2026-10-05T03:00:00Z" }), // Sunday Oct 4, 23:00 in New York: last week
    ];
    const week = buildChildWeek(child(rows), ctx());
    expect(week.problems).toBe(5);
    expect(week.independent).toBe(3);
    // 7 attempts started this week, a minute each but the half-minute one
    expect(week.minutes).toBe(Math.round(6.5));
    expect(week.days).toEqual([2, 2, 1, 0, 0, 0, 1]);
    expect(week.activeDays).toBe(4);
    expect(hasActivity(week)).toBe(true);
  });

  it("keeps each attempt's latest state once, and skips rows it cannot read", () => {
    const first = attempt({ at: "2026-10-06T20:00:00Z", outcome: "in_progress", updated_at: "2026-10-06T20:00:00Z" });
    const later = { ...first, outcome: "first_try", updated_at: "2026-10-06T20:04:00Z" };
    const broken = attempt({ at: "not a time" });
    const unknown = attempt({ at: "2026-10-06T20:00:00Z", outcome: "nailed_it" });
    const week = buildChildWeek(child([later, first, broken, unknown]), ctx());
    expect(week.problems).toBe(1);
    expect(toRecord(broken)).toBeNull();
    expect(toRecord(unknown)).toBeNull();
    expect(toRecord(attempt({ at: "2026-10-06T20:00:00Z", skill: "made_up" }))?.skill).toBe("other");
  });

  it("lists the four skills with the most problems, Other maths after the named ones", () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => attempt({ at: `2026-10-06T20:0${i}:00Z`, skill: "other", problem_latex: "x" })),
      ...Array.from({ length: 3 }, (_, i) => attempt({ at: `2026-10-06T21:0${i}:00Z`, outcome: i === 0 ? "with_help" : "first_try" })),
      attempt({ at: "2026-10-06T22:00:00Z", skill: "division_facts", problem_latex: "42 \\div 6" }),
      attempt({ at: "2026-10-06T22:10:00Z", skill: "add_within_20", problem_latex: "8 + 7" }),
      attempt({ at: "2026-10-06T22:20:00Z", skill: "long_division", problem_latex: "864 \\div 4" }),
    ];
    const week = buildChildWeek(child(rows), ctx());
    expect(week.practised.map((p) => p.skill)).toEqual(["times_tables", "add_within_20", "division_facts", "long_division"]);
    expect(week.practised[0]).toEqual({ skill: "times_tables", name: "Times tables", problems: 3, independent: 2 });
  });

  it("files an old coarse row under the skill its problem shows, as the Progress page does", () => {
    const week = buildChildWeek(child([attempt({ at: "2026-10-06T20:00:00Z", skill: "multiply_divide", problem_latex: "7 \\times 8" })]), ctx());
    expect(week.practised.map((p) => p.name)).toEqual(["Times tables"]);
  });
});

describe("mastery", () => {
  it("names the skills that became mastered during the week, not before", () => {
    const rows = [
      // times tables: two alone before the week (not yet mastered), three more alone in it
      attempt({ at: "2026-10-01T20:00:00Z" }),
      attempt({ at: "2026-10-02T20:00:00Z" }),
      attempt({ at: "2026-10-06T20:00:00Z" }),
      attempt({ at: "2026-10-07T20:00:00Z" }),
      attempt({ at: "2026-10-08T20:00:00Z" }),
      // adding to 20: already mastered before the week, practised again in it
      ...["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"].map((d) => attempt({ at: `${d}T20:00:00Z`, skill: "add_within_20", problem_latex: "8 + 7" })),
      attempt({ at: "2026-10-06T21:00:00Z", skill: "add_within_20", problem_latex: "9 + 6" }),
    ];
    expect(buildChildWeek(child(rows), ctx()).newlyMastered).toEqual(["Times tables"]);
  });

  it("reads mastery at now for the week under way", () => {
    const rows = [
      attempt({ at: "2026-10-05T20:00:00Z" }),
      attempt({ at: "2026-10-06T20:00:00Z" }),
      attempt({ at: "2026-10-07T20:00:00Z" }),
      attempt({ at: "2026-10-09T20:00:00Z" }), // after "now": not read
    ];
    // Thursday morning: three alone so far
    const now = Date.parse("2026-10-08T14:00:00Z");
    expect(buildChildWeek(child(rows), ctx({ now })).newlyMastered).toEqual(["Times tables"]);
  });
});

describe("next week's focus", () => {
  it("is the weakest skill worked on, with its skill's own tip", () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => attempt({ at: `2026-10-06T20:0${i}:00Z` })),
      attempt({ at: "2026-10-07T20:00:00Z", skill: "division_facts", problem_latex: "42 \\div 6", outcome: "tutor_solved" }),
      attempt({ at: "2026-10-07T20:05:00Z", skill: "division_facts", problem_latex: "36 \\div 4", outcome: "with_help" }),
      attempt({ at: "2026-10-07T20:10:00Z", skill: "add_within_100", problem_latex: "47 + 38", outcome: "self_corrected" }),
    ];
    const week = buildChildWeek(child(rows), ctx());
    expect(week.focus).toEqual({ skill: "division_facts", name: "Division facts", tip: SKILL_TIPS.division_facts });
  });

  it("names the mistake made again and again in that skill instead", () => {
    const rows = [
      attempt({ at: "2026-10-07T20:00:00Z", skill: "division_facts", problem_latex: "42 \\div 6", outcome: "with_help", mistakes: { arithmetic: 1 } }),
      attempt({ at: "2026-10-07T20:05:00Z", skill: "division_facts", problem_latex: "36 \\div 4", outcome: "with_help", mistakes: { arithmetic: 1, sign: 1 } }),
    ];
    expect(buildChildWeek(child(rows), ctx()).focus?.tip).toBe(MISTAKES.arithmetic.tip);
  });

  it("is the grade path's next skill when everything worked on is mastered, and null without a grade", () => {
    const rows = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((d) => attempt({ at: `${d}T20:00:00Z` }));
    const graded = buildChildWeek(child(rows, { grade: 3 }), ctx());
    expect(graded.newlyMastered).toEqual(["Times tables"]);
    expect(graded.focus).toEqual({ skill: "add_subtract_within_1000", name: "3-digit adding and subtracting", tip: SKILL_TIPS.add_subtract_within_1000 });
    expect(buildChildWeek(child(rows, { grade: null }), ctx()).focus).toBeNull();
  });
});

describe("Today's practice", () => {
  const done = (day: string): ReportDailyRow => ({ day, completed_at: `${day}T22:00:00Z` });

  it("counts the week's sets and the streak at the week's end", () => {
    const daily = [done("2026-10-03"), done("2026-10-09"), done("2026-10-10"), done("2026-10-11"), { day: "2026-10-08", completed_at: null }, done("2026-10-13")];
    const week = buildChildWeek(child([], { daily }), ctx());
    expect(week.dailySets).toBe(3);
    expect(week.streak).toBe(3);
    expect(hasActivity(week)).toBe(true);
  });

  it("counts the streak to today for the week under way (yesterday still counts)", () => {
    const daily = [done("2026-10-06"), done("2026-10-07")];
    const now = Date.parse("2026-10-08T15:00:00Z");
    expect(buildChildWeek(child([], { daily }), ctx({ now })).streak).toBe(2);
  });
});

describe("the board to watch", () => {
  it("is the board with the most finished problems, among the boards still there", () => {
    const rows = [
      attempt({ at: "2026-10-06T20:00:00Z", board_id: "b1" }),
      attempt({ at: "2026-10-06T20:01:00Z", board_id: "b1" }),
      attempt({ at: "2026-10-07T20:00:00Z", board_id: "b2" }),
      attempt({ at: "2026-10-07T20:01:00Z", board_id: "b3", outcome: "unfinished" }),
      attempt({ at: "2026-10-07T20:02:00Z", board_id: null }),
    ];
    expect(buildChildWeek(child(rows), ctx()).highlightBoardId).toBe("b1");
    expect(buildChildWeek(child(rows), ctx({ liveBoards: new Set(["b2", "b3"]) })).highlightBoardId).toBe("b2");
    expect(buildChildWeek(child(rows), ctx({ liveBoards: new Set() })).highlightBoardId).toBeNull();
  });

  it("breaks a tie with the most recent board", () => {
    const rows = [attempt({ at: "2026-10-06T20:00:00Z", board_id: "b1" }), attempt({ at: "2026-10-08T20:00:00Z", board_id: "b2" })];
    expect(buildChildWeek(child(rows), ctx()).highlightBoardId).toBe("b2");
  });
});

describe("the report", () => {
  it("keeps every kid, and the grown-up's own section only when they did something", () => {
    const kid = child([attempt({ at: "2026-10-06T20:00:00Z" })]);
    const quietKid = child([], { userId: "kid-2", displayName: "Leo" });
    const parent = child([], { userId: "parent", displayName: "Sam", optional: true, grade: null });
    const report = buildWeeklyReport({ ownerId: "parent", children: [kid, quietKid, parent], ...ctx() });
    expect(report.children.map((c) => c.userId)).toEqual(["kid-1", "kid-2"]);
    expect(report).toMatchObject({ weekStart: WEEK, timeZone: TZ, ownerId: "parent", generatedAt: new Date(LATER).toISOString() });
    expect(hasActivity(report.children[1])).toBe(false);

    const busyParent = { ...parent, attempts: [attempt({ at: "2026-10-06T20:00:00Z", skill: "factoring", problem_latex: "x^2+5x+6" })] };
    expect(buildWeeklyReport({ ownerId: "parent", children: [kid, busyParent], ...ctx() }).children.map((c) => c.userId)).toEqual(["kid-1", "parent"]);
  });

  it("reads back the record's window before the week's end", () => {
    expect(readSince(WEEK, 120)).toBe("2026-06-14");
  });
});
