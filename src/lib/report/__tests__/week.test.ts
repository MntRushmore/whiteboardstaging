import { describe, expect, it } from "vitest";
import { addDays, DEFAULT_REPORT_TZ, isDay, isReportableWeek, isTimeZone, localDayIn, mondayOf, parseWeek, recentWeeks, reportTimeZone, weekDays, weekRange, weekStartAt, zonedMidnight } from "../week";

describe("time zones", () => {
  it("knows real IANA zones and nothing else", () => {
    expect(isTimeZone("America/Chicago")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone(42)).toBe(false);
    expect(reportTimeZone("nope")).toBe(DEFAULT_REPORT_TZ);
    expect(reportTimeZone("Europe/London")).toBe("Europe/London");
  });

  it("reads the local date of an instant", () => {
    // 2026-10-05 02:00 UTC is still Sunday evening in New York
    expect(localDayIn(Date.parse("2026-10-05T02:00:00Z"), "America/New_York")).toBe("2026-10-04");
    expect(localDayIn(Date.parse("2026-10-05T02:00:00Z"), "Europe/Berlin")).toBe("2026-10-05");
  });
});

describe("dates", () => {
  it("validates calendar dates", () => {
    expect(isDay("2026-10-05")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-10-5")).toBe(false);
    expect(isDay(null)).toBe(false);
  });

  it("finds Mondays and moves by days", () => {
    expect(mondayOf("2026-10-05")).toBe("2026-10-05"); // a Monday
    expect(mondayOf("2026-10-11")).toBe("2026-10-05"); // Sunday
    expect(mondayOf("2026-10-12")).toBe("2026-10-12");
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(weekDays("2026-10-05")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
  });

  it("parses ?week= to its Monday", () => {
    expect(parseWeek("2026-10-08")).toBe("2026-10-05");
    expect(parseWeek("2026-10-05")).toBe("2026-10-05");
    expect(parseWeek("last week")).toBeNull();
    expect(parseWeek(undefined)).toBeNull();
  });
});

describe("weeks in a zone", () => {
  it("starts at local midnight", () => {
    expect(new Date(zonedMidnight("2026-10-05", "America/New_York")).toISOString()).toBe("2026-10-05T04:00:00.000Z");
    expect(new Date(zonedMidnight("2026-12-07", "America/New_York")).toISOString()).toBe("2026-12-07T05:00:00.000Z");
    expect(new Date(zonedMidnight("2026-10-05", "UTC")).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(new Date(zonedMidnight("2026-10-05", "Asia/Kolkata")).toISOString()).toBe("2026-10-04T18:30:00.000Z");
  });

  it("is 7 local days long, one hour more across the end of daylight saving", () => {
    const normal = weekRange("2026-10-05", "America/New_York");
    expect(normal.endMs - normal.startMs).toBe(7 * 86_400_000);
    const fallBack = weekRange("2026-10-26", "America/New_York"); // clocks go back on Sunday Nov 1
    expect(new Date(fallBack.startMs).toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(new Date(fallBack.endMs).toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("puts a Sunday-night moment in the week that is ending, in the family's zone", () => {
    const sundayNight = Date.parse("2026-10-12T02:30:00Z"); // 22:30 Sunday in New York
    expect(weekStartAt(sundayNight, "America/New_York")).toBe("2026-10-05");
    expect(weekStartAt(sundayNight, "UTC")).toBe("2026-10-12");
  });

  it("lists recent weeks, this one first, and refuses the future and over a year back", () => {
    const now = Date.parse("2026-10-08T15:00:00Z");
    expect(recentWeeks(now, "America/New_York", 3)).toEqual(["2026-10-05", "2026-09-28", "2026-09-21"]);
    expect(isReportableWeek("2026-10-05", now, "America/New_York")).toBe(true);
    expect(isReportableWeek("2026-10-12", now, "America/New_York")).toBe(false);
    expect(isReportableWeek("2025-09-29", now, "America/New_York")).toBe(false);
    expect(isReportableWeek("2025-10-06", now, "America/New_York")).toBe(true);
  });
});
