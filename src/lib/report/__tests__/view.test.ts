import { describe, expect, it } from "vitest";
import type { ChildWeek } from "../contracts";
import { afterFailedRead, dayLevel, earlierWeekOptions, earlierWeeks, gradeText, joinNames, parseReportAnswer, practisedBars, reportIsQuiet, weekChoice, weekForChoice, weekLabel } from "../view";

const NOW = Date.parse("2026-10-08T15:00:00Z");
const TZ = "America/New_York";
const KID = "10000000-0000-4000-8000-000000000002";

function week(over: Partial<ChildWeek> = {}): ChildWeek {
  return {
    userId: KID,
    displayName: "Maya",
    avatar: "fox",
    grade: 3,
    problems: 12,
    independent: 9,
    minutes: 34,
    activeDays: 4,
    dailySets: 3,
    streak: 3,
    newlyMastered: ["Times tables"],
    practised: [{ skill: "times_tables", name: "Times tables", problems: 8, independent: 7 }],
    focus: { skill: "division_facts", name: "Division facts", tip: "Turn each division into a times question." },
    highlightBoardId: "b0000000-0000-4000-8000-00000000000a",
    days: [3, 2, 0, 4, 3, 0, 0],
    ...over,
  };
}

describe("labels", () => {
  it("writes a week as its dates", () => {
    expect(weekLabel("2026-10-05")).toBe("Oct 5 – 11");
    expect(weekLabel("2026-09-28")).toBe("Sep 28 – Oct 4");
    expect(weekLabel("2026-12-28")).toBe("Dec 28, 2026 – Jan 3, 2027");
  });

  it("joins names and writes grades", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Times tables"])).toBe("Times tables");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
    expect(gradeText(3)).toBe("3rd grade");
    expect(gradeText(0)).toBe("Kindergarten");
    expect(gradeText(null)).toBe("No grade set");
  });
});

describe("the week picker", () => {
  it("knows this week, last week and earlier ones", () => {
    expect(weekChoice("2026-10-05", NOW, TZ)).toBe("this");
    expect(weekChoice("2026-09-28", NOW, TZ)).toBe("last");
    expect(weekChoice("2026-09-14", NOW, TZ)).toBe("earlier");
    expect(weekForChoice("earlier", NOW, TZ)).toBe("2026-09-21");
    expect(earlierWeeks(NOW, TZ, 3)).toEqual([
      { value: "2026-09-21", label: "Sep 21 – 27" },
      { value: "2026-09-14", label: "Sep 14 – 20" },
      { value: "2026-09-07", label: "Sep 7 – 13" },
    ]);
  });

  it("names an older week a link opened, after the listed ones, so the list is never blank", () => {
    const listed = earlierWeeks(NOW, TZ);
    expect(listed).toHaveLength(10);
    // 20 weeks back: still a week the page shows, past the list
    expect(earlierWeekOptions("2026-05-18", NOW, TZ)).toEqual([...listed, { value: "2026-05-18", label: "May 18 – 24" }]);
    // in the list already, or not an earlier week at all: the list as it is
    expect(earlierWeekOptions("2026-09-14", NOW, TZ)).toEqual(listed);
    expect(earlierWeekOptions("2026-10-05", NOW, TZ)).toEqual(listed);
    expect(earlierWeekOptions("2026-09-28", NOW, TZ)).toEqual(listed);
  });
});

describe("afterFailedRead", () => {
  type Read = { key: string; answer: string | null };
  const good = (r: Read) => r.answer !== null;

  it("keeps a good read on screen when a re-read of the same thing fails", () => {
    const shown: Read = { key: "u|2026-10-05|0", answer: "the report" };
    expect(afterFailedRead(shown, { key: "u|2026-10-05|0", answer: null }, good)).toBe(shown);
  });

  it("shows the failure for a first read, a read of something else, or after a failure", () => {
    const failed: Read = { key: "u|2026-10-05|1", answer: null };
    expect(afterFailedRead(null, failed, good)).toBe(failed);
    expect(afterFailedRead({ key: "u|2026-10-05|0", answer: "the report" }, failed, good)).toBe(failed);
    expect(afterFailedRead({ key: "u|2026-10-05|1", answer: null }, failed, good)).toBe(failed);
  });
});

describe("bars and dots", () => {
  it("sizes each skill against the busiest, with the solved-alone share inside", () => {
    expect(
      practisedBars([
        { skill: "a", name: "A", problems: 10, independent: 5 },
        { skill: "b", name: "B", problems: 4, independent: 4 },
        { skill: "c", name: "C", problems: 0, independent: 0 },
      ]),
    ).toEqual([
      { skill: "a", width: 100, alone: 50 },
      { skill: "b", width: 40, alone: 100 },
      { skill: "c", width: 8, alone: 0 },
    ]);
    expect([0, 1, 3, 6].map(dayLevel)).toEqual([0, 1, 2, 3]);
  });
});

describe("parseReportAnswer", () => {
  const answer = { report: { weekStart: "2026-10-05", timeZone: TZ, ownerId: "p", children: [week()], generatedAt: "2026-10-08T15:00:00.000Z" }, role: "parent", email: { optedOut: false, sending: true } };

  it("reads a good answer as it is", () => {
    expect(parseReportAnswer(JSON.parse(JSON.stringify(answer)))).toEqual(answer);
    expect(reportIsQuiet(answer.report)).toBe(false);
    expect(reportIsQuiet({ ...answer.report, children: [week({ problems: 0, activeDays: 0, dailySets: 0 })] })).toBe(true);
  });

  it("refuses a malformed one, and drops odd parts of a child", () => {
    expect(parseReportAnswer(null)).toBeNull();
    expect(parseReportAnswer({ ...answer, role: "admin" })).toBeNull();
    expect(parseReportAnswer({ ...answer, report: { ...answer.report, weekStart: "soon" } })).toBeNull();
    expect(parseReportAnswer({ ...answer, report: { ...answer.report, children: [{ ...week(), problems: -1 }] } })).toBeNull();
    const odd = parseReportAnswer({ ...answer, email: "yes", report: { ...answer.report, children: [{ ...week(), avatar: "dragon", focus: { name: 3 }, days: [1, 2], highlightBoardId: "javascript:x" }] } });
    expect(odd?.email).toBeNull();
    expect(odd?.report.children[0]).toMatchObject({ avatar: null, focus: null, highlightBoardId: null });
    expect(odd?.report.children[0].days).toBeUndefined();
  });
});
