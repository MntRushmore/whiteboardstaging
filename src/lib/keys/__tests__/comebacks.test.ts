import { describe, expect, it } from "vitest";
import type { AttemptRecord, Outcome } from "@/lib/learning/contracts";
import { dueComebacks, localDayOf } from "../comebacks";

let n = 0;
function attempt(skill: string, day: string, outcome: Outcome): AttemptRecord {
  n++;
  const startedAt = `${day}T15:00:00.000Z`;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    boardId: null,
    problemLatex: "47+38",
    skill: skill as AttemptRecord["skill"],
    course: null,
    origin: "keys",
    parentId: null,
    outcome,
    mistakes: {},
    activeMs: 1000,
    linesWritten: 1,
    linesRight: 1,
    linesRinged: 0,
    hints: 0,
    tutorSteps: 0,
    solves: 0,
    asks: 0,
    startedAt,
    updatedAt: startedAt,
    finishedAt: startedAt,
  };
}

const at = (day: string) => Date.parse(`${day}T18:00:00.000Z`);
const opts = (day: string) => ({ now: at(day), tzOffsetMinutes: 0, canWrite: () => true });

describe("spaced comebacks", () => {
  it("a skill fixed with help comes back 2 days later", () => {
    const rows = [attempt("add_within_100", "2026-10-20", "with_help")];
    expect(dueComebacks(rows, opts("2026-10-21"))).toEqual([]);
    expect(dueComebacks(rows, opts("2026-10-22"))).toMatchObject([{ skill: "add_within_100", after: 2, dueDay: "2026-10-22" }]);
  });

  it("once worked on again, it waits for the 7-day comeback", () => {
    const rows = [attempt("add_within_100", "2026-10-20", "with_help"), attempt("add_within_100", "2026-10-22", "first_try")];
    expect(dueComebacks(rows, opts("2026-10-23"))).toEqual([]);
    expect(dueComebacks(rows, opts("2026-10-27"))).toMatchObject([{ after: 7, dueDay: "2026-10-27" }]);
    const done = [...rows, attempt("add_within_100", "2026-10-27", "self_corrected")];
    expect(dueComebacks(done, opts("2026-10-28"))).toEqual([]);
  });

  it("a missed 2-day comeback gives way to the 7-day one: one problem, not two", () => {
    const rows = [attempt("times_tables", "2026-10-10", "with_help")];
    expect(dueComebacks(rows, opts("2026-10-18"))).toMatchObject([{ skill: "times_tables", after: 7 }]);
  });

  it("work on the help day itself is not the comeback, and a newer help resets the clock", () => {
    const rows = [attempt("times_tables", "2026-10-20", "with_help"), attempt("times_tables", "2026-10-20", "first_try")];
    expect(dueComebacks(rows, opts("2026-10-22"))).toHaveLength(1);
    const again = [...rows, attempt("times_tables", "2026-10-21", "tutor_solved")];
    expect(dueComebacks(again, opts("2026-10-22"))).toEqual([]);
    expect(dueComebacks(again, opts("2026-10-23"))).toMatchObject([{ dueDay: "2026-10-23" }]);
  });

  it("skips skills Keys cannot write, orders by due day and caps the list", () => {
    const rows = [
      attempt("add_within_100", "2026-10-19", "with_help"),
      attempt("factoring", "2026-10-18", "with_help"),
      attempt("times_tables", "2026-10-18", "with_help"),
    ];
    const got = dueComebacks(rows, { ...opts("2026-10-21"), canWrite: (s) => s !== "factoring" });
    expect(got.map((c) => c.skill)).toEqual(["times_tables", "add_within_100"]);
    expect(dueComebacks(rows, { ...opts("2026-10-21"), limit: 1 })).toHaveLength(1);
  });

  it("first tries never come back", () => {
    expect(dueComebacks([attempt("add_within_100", "2026-10-10", "first_try")], opts("2026-10-20"))).toEqual([]);
  });

  it("days are local", () => {
    // 01:00 UTC on the 21st is still the 20th in New York (UTC-4: offset +240)
    expect(localDayOf(Date.parse("2026-10-21T01:00:00Z"), 240)).toBe("2026-10-20");
  });
});
