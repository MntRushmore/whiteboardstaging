import { describe, expect, it } from "vitest";
import { ROUTE_COSTS } from "@/lib/server/billing";
import {
  USAGE_KINDS,
  countLabel,
  creditPriceSentence,
  creditsLabel,
  dayLabel,
  localDayKey,
  parseUsageDayRows,
  usageKindFor,
  usageSummaryFor,
  type UsageDayRow,
} from "../usage";
import { canonicalRouteKey } from "../viewModel";

describe("usage kinds", () => {
  it("names every billed route, at the price the server charges", () => {
    const billed = Object.entries(ROUTE_COSTS).filter(([, cost]) => cost > 0);
    for (const [route, cost] of billed) {
      const kind = USAGE_KINDS[canonicalRouteKey(route)];
      expect(kind, route).toBeDefined();
      expect(kind.cost, route).toBe(cost);
    }
    // and nothing carries a price the server no longer charges
    const priced = Object.values(USAGE_KINDS).filter((k) => k.cost !== undefined);
    expect(priced.map((k) => k.key).sort()).toEqual(billed.map(([route]) => canonicalRouteKey(route)).sort());
  });

  it("uses plain words, not route names", () => {
    for (const kind of Object.values(USAGE_KINDS)) {
      expect(kind.key).toBe(canonicalRouteKey(kind.key));
      expect(kind.label).not.toMatch(/\/|live|api|recognize|analyze/i);
      expect(kind.unit[0]).not.toBe(kind.unit[1]);
    }
    expect(usageKindFor("live/recognize").label).toBe("Handwriting reading");
    expect(usageKindFor("live/check").label).toBe("Checking your work");
    expect(usageKindFor("live/solve").label).toBe("Worked solutions");
    expect(usageKindFor("live/setup").label).toBe("Word-problem setup");
    expect(usageKindFor("live/reread").label).toBe("Second read of messy writing");
    expect(usageKindFor("live/proof").label).toBe("Figures & proofs");
    expect(usageKindFor("voice/analyze-workspace").label).toBe("Voice tutor (retired)");
    expect(usageKindFor("generate-solution").label).toBe("Drawn help (retired)");
  });

  it("matches any spelling of a route and keeps an unknown one visible", () => {
    expect(usageKindFor("/api/live/recognize").key).toBe("live-recognize");
    expect(usageKindFor("live_recognize").key).toBe("live-recognize");
    expect(usageKindFor("/api/something/new")).toEqual({ key: "something-new", label: "something-new", unit: ["time", "times"] });
    expect(usageKindFor("").label).toBe("Other");
  });

  it("counts in the kind's own noun, singular and plural, with thousands separators", () => {
    expect(countLabel(usageKindFor("live/recognize"), 1)).toBe("1 read");
    expect(countLabel(usageKindFor("live/recognize"), 342)).toBe("342 reads");
    expect(countLabel(usageKindFor("live/recognize"), 1345)).toBe("1,345 reads");
    expect(countLabel(usageKindFor("live/reread"), 23)).toBe("23 lines");
    expect(countLabel(usageKindFor("live/solve"), 1)).toBe("1 solution");
    expect(countLabel(usageKindFor("live/proof"), 11)).toBe("11 times");
    expect(creditsLabel(1)).toBe("1 credit");
    expect(creditsLabel(1645)).toBe("1,645 credits");
    expect(creditsLabel(0)).toBe("0 credits");
  });

  it("says honestly what a credit buys", () => {
    expect(creditPriceSentence()).toBe(
      "Most of the tutor's work is reading your handwriting, at 1 credit a read. " +
        "Setting up a word problem costs 2, checking your work 3, and a worked solution 10.",
    );
  });
});

describe("parseUsageDayRows", () => {
  it("keeps well-formed rows, coerces numeric strings, drops junk", () => {
    expect(
      parseUsageDayRows([
        { day: "2026-09-27", route: "live/recognize", events: "3", credits: 3 },
        { day: "2026-09-27T00:00:00Z", route: "live/check", events: 1, credits: 3 },
        { day: "2026-09-26", route: "live/check", events: "many", credits: 3 },
        null,
        "row",
      ]),
    ).toEqual([{ day: "2026-09-27", route: "live/recognize", events: 3, credits: 3 }]);
    expect(parseUsageDayRows(undefined)).toEqual([]);
    expect(parseUsageDayRows({ day: "2026-09-27" })).toEqual([]);
  });
});

describe("dayLabel", () => {
  it("says Today and Yesterday with the date beside them", () => {
    expect(dayLabel("2026-09-27", "2026-09-27")).toEqual({ label: "Today", date: "Sep 27" });
    expect(dayLabel("2026-09-26", "2026-09-27")).toEqual({ label: "Yesterday", date: "Sep 26" });
    // across a month boundary
    expect(dayLabel("2026-09-30", "2026-10-01")).toEqual({ label: "Yesterday", date: "Sep 30" });
  });
  it("names older days by weekday and date, with the year only when it differs", () => {
    expect(dayLabel("2026-09-23", "2026-09-27")).toEqual({ label: "Wed, Sep 23", date: "" });
    expect(dayLabel("2026-09-01", "2026-09-27")).toEqual({ label: "Tue, Sep 1", date: "" });
    expect(dayLabel("2025-12-31", "2026-01-02")).toEqual({ label: "Wed, Dec 31, 2025", date: "" });
    expect(dayLabel("someday", "2026-09-27")).toEqual({ label: "someday", date: "" });
  });
});

describe("usageSummaryFor", () => {
  // The shape of the QA account's month (usage_by_day in America/New_York), plus one
  // route stored under another spelling to prove kinds merge.
  const rows: UsageDayRow[] = [
    { day: "2026-09-27", route: "live/recognize", events: 342, credits: 342 },
    { day: "2026-09-27", route: "live/setup", events: 30, credits: 60 },
    { day: "2026-09-27", route: "live/solve", events: 1, credits: 10 },
    { day: "2026-09-27", route: "/api/live/recognize", events: 3, credits: 3 },
    { day: "2026-09-26", route: "live/recognize", events: 33, credits: 33 },
    { day: "2026-09-26", route: "live/check", events: 5, credits: 15 },
    { day: "2026-09-18", route: "generate-solution", events: 4, credits: 100 },
  ];

  it("sums each day, newest first, with its kinds by credits", () => {
    const { days } = usageSummaryFor([...rows].reverse(), "2026-09-27");
    expect(days.map((d) => [d.day, d.label, d.date, d.credits, d.count])).toEqual([
      ["2026-09-27", "Today", "Sep 27", 415, 376],
      ["2026-09-26", "Yesterday", "Sep 26", 48, 38],
      ["2026-09-18", "Fri, Sep 18", "", 100, 4],
    ]);
    expect(days[0].kinds).toEqual([
      { key: "live-recognize", label: "Handwriting reading", count: 345, countLabel: "345 reads", credits: 345 },
      { key: "live-setup", label: "Word-problem setup", count: 30, countLabel: "30 setups", credits: 60 },
      { key: "live-solve", label: "Worked solutions", count: 1, countLabel: "1 solution", credits: 10 },
    ]);
  });

  it("sums the whole period by kind and in total", () => {
    const summary = usageSummaryFor(rows, "2026-09-27");
    expect(summary.kinds.map((k) => `${k.label} · ${k.countLabel} · ${creditsLabel(k.credits)}`)).toEqual([
      "Handwriting reading · 378 reads · 378 credits",
      "Drawn help (retired) · 4 times · 100 credits",
      "Word-problem setup · 30 setups · 60 credits",
      "Checking your work · 5 checks · 15 credits",
      "Worked solutions · 1 solution · 10 credits",
    ]);
    expect(summary.credits).toBe(563);
    expect(summary.count).toBe(418);
    expect(summary.credits).toBe(summary.days.reduce((n, d) => n + d.credits, 0));
  });

  it("breaks ties by count, then by name", () => {
    const { kinds } = usageSummaryFor(
      [
        { day: "2026-09-27", route: "live/check", events: 1, credits: 3 },
        { day: "2026-09-27", route: "voice/analyze-workspace", events: 1, credits: 3 },
        { day: "2026-09-27", route: "live/recognize", events: 3, credits: 3 },
      ],
      "2026-09-27",
    );
    expect(kinds.map((k) => k.label)).toEqual(["Handwriting reading", "Checking your work", "Voice tutor (retired)"]);
  });

  it("is empty for a month with no usage", () => {
    expect(usageSummaryFor([], "2026-09-27")).toEqual({ days: [], kinds: [], credits: 0, count: 0 });
  });
});

describe("localDayKey", () => {
  it("is the calendar date in the given zone", () => {
    const lateEvening = new Date("2026-09-28T00:46:00Z"); // 8:46 PM on the 27th in New York
    expect(localDayKey(lateEvening, "America/New_York")).toBe("2026-09-27");
    expect(localDayKey(lateEvening, "UTC")).toBe("2026-09-28");
    expect(localDayKey(new Date("2026-09-27T18:45:00Z"), "Asia/Kolkata")).toBe("2026-09-28");
    expect(localDayKey(new Date("2026-01-05T12:00:00Z"), "UTC")).toBe("2026-01-05");
  });
});
