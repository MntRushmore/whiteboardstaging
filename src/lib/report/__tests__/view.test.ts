import { describe, expect, it } from "vitest";
import type { ChildWeek } from "../contracts";
import { REPORT_COPY } from "../copy";
import { childCardId, parseFocusKid, reportFocusPath } from "../focus";
import { afterFailedRead, dayLevel, earlierWeekOptions, earlierWeeks, gradeText, isRecentWeek, joinNames, parseReportAnswer, practisedBars, reportIsQuiet, weekChoice, weekChoices, weekForChoice, weekFromOldest, weekLabel } from "../view";

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

  it("stops at the week the account was made: no empty weeks from before there was anyone", () => {
    // made this week: no picker at all; last week: no "Earlier"; before that: all three
    expect(weekChoices(NOW, TZ, "2026-10-05")).toEqual(["this"]);
    expect(weekChoices(NOW, TZ, "2026-09-28")).toEqual(["this", "last"]);
    expect(weekChoices(NOW, TZ, "2026-09-14")).toEqual(["this", "last", "earlier"]);
    expect(weekChoices(NOW, TZ, null)).toEqual(["this", "last", "earlier"]);
    // the "Earlier" list ends at that week
    expect(earlierWeeks(NOW, TZ, 10, "2026-09-14").map((w) => w.value)).toEqual(["2026-09-21", "2026-09-14"]);
    expect(earlierWeekOptions("2026-09-21", NOW, TZ, 10, "2026-09-21").map((w) => w.value)).toEqual(["2026-09-21"]);
    // a link to a week before the account opens the account's first week
    expect(weekFromOldest("2026-05-18", "2026-09-14")).toBe("2026-09-14");
    expect(weekFromOldest("2026-09-21", "2026-09-14")).toBe("2026-09-21");
    expect(weekFromOldest("2026-05-18", null)).toBe("2026-05-18");
  });

  it("gives next week's tip only for this week and last week", () => {
    expect(isRecentWeek("2026-10-05", NOW, TZ)).toBe(true);
    expect(isRecentWeek("2026-09-28", NOW, TZ)).toBe(true);
    expect(isRecentWeek("2026-09-21", NOW, TZ)).toBe(false);
  });
});

describe("the report's words", () => {
  it("says the streak's practice days in plain English", () => {
    // Today's practice sets, named so they never contradict "days active" (a day with problems but no set)
    expect(REPORT_COPY.streakHint(4)).toBe("4 daily practice days this week");
    expect(REPORT_COPY.streakHint(1)).toBe("1 daily practice day this week");
    expect(REPORT_COPY.streakHint(0)).toBe("No daily practice yet");
    expect(REPORT_COPY.streakHint(3, false)).toBe("3 daily practice days that week");
    expect(REPORT_COPY.streakHint(0, false)).toBe("No daily practice");
    expect(REPORT_COPY.statLabel("problems", 1)).toBe("Problem");
    expect(REPORT_COPY.statLabel("problems", 12)).toBe("Problems");
    expect(REPORT_COPY.statLabel("minutes", 1)).toBe("Minute");
  });

  it("is US English", () => {
    const words = Object.values(REPORT_COPY).flatMap((v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).filter((x) => typeof x === "string") : []));
    expect(words.join(" ")).not.toMatch(/practis/);
    expect(REPORT_COPY.self.practisedTitle).toBe("What you practiced");
  });
});

describe("the Family page's link to one kid's week", () => {
  const KID = "11111111-2222-4333-8444-555555555555";
  it("opens the report at that kid, and reads only a user id back", () => {
    expect(reportFocusPath(KID)).toBe(`/report?kid=${KID}`);
    expect(parseFocusKid(KID)).toBe(KID);
    expect(parseFocusKid("not-an-id")).toBeNull();
    expect(parseFocusKid(null)).toBeNull();
    expect(childCardId(KID)).toBe(`report-kid-${KID}`);
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
