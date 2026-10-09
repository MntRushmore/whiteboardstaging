import { describe, expect, it } from "vitest";
import {
  CONSOLE_PAGES,
  PLAN_LABELS,
  PLAN_TONES,
  agoOrNever,
  avatarTone,
  boardHref,
  browserFromUserAgent,
  clockWithSeconds,
  consoleNav,
  courseName,
  deviceView,
  exactTime,
  formatDay,
  formatKb,
  formatMinutes,
  formatMinutesShort,
  initialsOf,
  isLiveNow,
  metaFacts,
  metaValue,
  percentOf,
  personName,
  prettyJson,
  shortId,
  sparkline,
  trialNote,
  userHref,
} from "../consoleView";
import { PLAN_STATES } from "../contracts";

/** Thursday 2026-10-08, 3:00 PM in New York. */
const NOW = Date.parse("2026-10-08T19:00:00Z");
const CLOCK = { now: NOW, timeZone: "America/New_York" };
const n = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ");
const MIN = 60_000;
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW + ms).toISOString();
const ID = "4f9c2a10-3b7d-4c55-9e21-8a6b0f1d2e33";

describe("the nav", () => {
  it("lists the six sections in order, the current one marked", () => {
    const nav = consoleNav("bugs", { newBugs: 3, openIssues: 7 });
    expect(nav.map((i) => [i.label, i.href])).toEqual([
      ["Overview", "/admin"],
      ["Users", "/admin/users"],
      ["Funnel", "/admin/funnel"],
      ["Boards", "/admin/boards"],
      ["Bugs", "/admin/bugs"],
      ["Issues", "/admin/issues"],
    ]);
    expect(nav.filter((i) => i.current).map((i) => i.page)).toEqual(["bugs"]);
    expect(CONSOLE_PAGES).toHaveLength(6);
  });

  it("counts new bugs and open issues, in words for a screen reader; none shown at zero or unknown", () => {
    const nav = consoleNav(null, { newBugs: 1, openIssues: 140, regressed: 2 });
    const bugs = nav.find((i) => i.page === "bugs")!;
    const issues = nav.find((i) => i.page === "issues")!;
    expect([bugs.count, bugs.countLabel, bugs.urgent]).toEqual(["1", "1 new bug report", false]);
    expect([issues.count, issues.countLabel, issues.urgent]).toEqual(["99+", "140 open issues", true]);
    const quiet = consoleNav("overview", { newBugs: 0, openIssues: null });
    expect(quiet.every((i) => i.count === null && i.countLabel === null)).toBe(true);
    expect(quiet.every((i) => !i.urgent)).toBe(true);
  });
});

describe("plans", () => {
  it("has a word and a tone for every plan state", () => {
    for (const p of PLAN_STATES) {
      expect(PLAN_LABELS[p]).toBeTruthy();
      expect(PLAN_TONES[p]).toBeTruthy();
    }
    expect([PLAN_TONES.active, PLAN_TONES.trialing, PLAN_TONES.failing, PLAN_TONES.none]).toEqual(["success", "info", "danger", "muted"]);
  });

  it("says when a trial ends: today, tomorrow, a weekday and date, or that it ended", () => {
    expect(trialNote("trialing", at(2 * 60 * MIN), CLOCK)).toBe("Trial ends today");
    expect(trialNote("trialing", at(DAY), CLOCK)).toBe("Trial ends tomorrow");
    expect(trialNote("trial_cancelling", at(3 * DAY), CLOCK)).toBe("Trial ends Sun, Oct 11");
    expect(trialNote("trialing", at(-2 * DAY), CLOCK)).toBe("Trial ended Oct 6");
    expect(trialNote("active", at(DAY), CLOCK)).toBeNull();
    expect(trialNote("trialing", null, CLOCK)).toBeNull();
  });
});

describe("who", () => {
  it("names an account by its name, else the email's first part", () => {
    expect(personName("  Maya Chen ", "maya@example.com")).toBe("Maya Chen");
    expect(personName(null, "j.rivera.family@example.com")).toBe("j.rivera.family");
    expect(personName("", null)).toBe("No name");
  });

  it("makes initials from the name or the email", () => {
    expect(initialsOf("Maya Chen", null)).toBe("MC");
    expect(initialsOf("Chloé de la Cruz", null)).toBe("CC");
    expect(initialsOf(null, "maya.chen@example.com")).toBe("MC");
    expect(initialsOf(null, "sam@example.com")).toBe("S");
    expect(initialsOf("  ", null)).toBe("?");
  });

  it("gives an id the same avatar tone every time", () => {
    expect(avatarTone(ID)).toBe(avatarTone(ID));
    expect([1, 2, 3, 4]).toContain(avatarTone(ID));
    expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(avatarTone)).size).toBeGreaterThan(1);
  });

  it("links a user and a board only for a real id; the board goes to the viewer", () => {
    expect(boardHref(ID)).toBe(`/admin/boards/${ID}`);
    expect(userHref(ID)).toBe(`/admin/users/${ID}`);
    expect(boardHref("not-an-id")).toBeNull();
    expect(userHref(null)).toBeNull();
    expect(shortId(ID)).toBe("4f9c2a10");
  });

  it("names a course", () => {
    expect(courseName("algebra1")).toBe("Algebra 1");
    expect(courseName("precalc_calc")).toBe("Pre-calculus / Calculus");
    expect(courseName("chemistry")).toBe("chemistry");
    expect(courseName(null)).toBeNull();
  });
});

describe("dates and numbers", () => {
  it("days: Today, Yesterday, a date, a date with its year", () => {
    expect(formatDay(at(-2 * 60 * MIN), CLOCK)).toBe("Today");
    expect(formatDay(at(-DAY), CLOCK)).toBe("Yesterday");
    expect(formatDay(at(-5 * DAY), CLOCK)).toBe("Oct 3");
    expect(formatDay("2025-12-24T15:00:00Z", CLOCK)).toBe("Dec 24, 2025");
    expect(formatDay(null, CLOCK)).toBe("—");
  });

  it("the exact moment for a tooltip, and a log line's time with seconds", () => {
    expect(n(exactTime(at(0), CLOCK))).toBe("Thu, Oct 8, 2026, 3:00 PM");
    expect(exactTime(null, CLOCK)).toBe("");
    expect(n(clockWithSeconds("2026-10-08T19:01:07Z", CLOCK.timeZone))).toBe("3:01:07 PM");
  });

  it("ago, or never", () => {
    expect(agoOrNever(at(-4 * MIN), NOW)).toBe("4 min ago");
    expect(agoOrNever(null, NOW)).toBe("never");
  });

  it("live now means saved in the last 5 minutes", () => {
    expect(isLiveNow(at(-4 * MIN), NOW)).toBe(true);
    expect(isLiveNow(at(-6 * MIN), NOW)).toBe(false);
    expect(isLiveNow(null, NOW)).toBe(false);
  });

  it("percents, minutes and sizes", () => {
    expect(percentOf(11, 18)).toBe("61%");
    expect(percentOf(3, 0)).toBeNull();
    expect(percentOf(5, 4)).toBe("100%");
    expect(formatMinutes(0)).toBe("none");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(282)).toBe("4 h 42 min");
    expect(formatMinutesShort(282)).toBe("4h 42m");
    expect(formatMinutesShort(45)).toBe("45m");
    expect(formatMinutesShort(1500)).toBe("25h");
    expect(formatKb(120)).toBe("120 KB");
    expect(formatKb(1434)).toBe("1.4 MB");
    expect(formatKb(20_480)).toBe("20 MB");
  });
});

describe("devices", () => {
  const ua = {
    ipad: "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
    iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1",
    chromebook: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
    firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0",
    samsung: "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36",
    inApp: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  };

  it("reads the browser and the system from a user agent", () => {
    expect(browserFromUserAgent(ua.ipad)).toEqual({ browser: "Safari", os: "iPad" });
    expect(browserFromUserAgent(ua.iphoneChrome)).toEqual({ browser: "Chrome", os: "iPhone" });
    expect(browserFromUserAgent(ua.chromebook)).toEqual({ browser: "Chrome", os: "ChromeOS" });
    expect(browserFromUserAgent(ua.edge)).toEqual({ browser: "Edge", os: "Windows" });
    expect(browserFromUserAgent(ua.firefoxMac)).toEqual({ browser: "Firefox", os: "Mac" });
    expect(browserFromUserAgent(ua.samsung)).toEqual({ browser: "Samsung Internet", os: "Android" });
    expect(browserFromUserAgent(ua.inApp)).toEqual({ browser: "Safari (in an app)", os: "iPhone" });
    expect(browserFromUserAgent("")).toEqual({ browser: null, os: null });
  });

  it("turns a bug report's diagnostics into a line and the rest", () => {
    const d = deviceView({
      userAgent: ua.ipad,
      viewport: { width: 1024, height: 768 },
      screen: { width: 1024, height: 768, pixelRatio: 2 },
      language: "en-US",
      platform: "MacIntel",
      online: false,
    });
    expect(d.summary).toBe("Safari on iPad · 1024 × 768");
    expect(d.more).toBe("MacIntel · screen 1024 × 768 @2x · en-US · offline");
    expect(d.facts.map((f) => f.label)).toEqual(["Browser", "Platform", "Window", "Screen", "Language", "Network"]);
  });

  it("copes with missing or odd diagnostics", () => {
    expect(deviceView(null)).toEqual({ summary: null, more: null, facts: [] });
    expect(deviceView({ userAgent: 7, viewport: "big" })).toEqual({ summary: null, more: null, facts: [] });
    expect(deviceView({ viewport: { width: 390, height: 664 } }).summary).toBe("390 × 664");
  });
});

describe("sparklines", () => {
  it("scales each day to the busiest and says it in words", () => {
    const s = sparkline([0, 2, 0, 4, 1, 0, 3], CLOCK);
    expect(s.bars.map((b) => b.ratio)).toEqual([0, 0.5, 0, 1, 0.25, 0, 0.75]);
    expect(s.total).toBe(10);
    expect(s.bars[6].label).toBe("Oct 8: 3");
    expect(s.bars[0].label).toBe("Oct 2: 0");
    expect(s.summary).toBe("10 events in 7 days, most on Oct 5 (4)");
  });

  it("an empty week, and a single day", () => {
    expect(sparkline([0, 0, 0], CLOCK).summary).toBe("None in 3 days");
    expect(sparkline([1], CLOCK, ["error", "errors"]).summary).toBe("1 error today");
    expect(sparkline([0], CLOCK).summary).toBe("None today");
  });
});

describe("meta", () => {
  it("picks the facts worth a glance: model, fallback, time taken, status, error", () => {
    expect(metaFacts({ model: "openai/gpt-5.4", fallback: "deepseek", ms: 20412, status: 502, error: "upstream 502", other: 1 })).toEqual([
      { label: "Model", value: "openai/gpt-5.4" },
      { label: "Fallback", value: "deepseek" },
      { label: "Took", value: "20.4 s" },
      { label: "Status", value: "502" },
      { label: "Error", value: "upstream 502" },
    ]);
    expect(metaFacts({ primary: "a", latencyMs: 640 })).toEqual([
      { label: "Model", value: "a" },
      { label: "Took", value: "640 ms" },
    ]);
    expect(metaFacts(null)).toEqual([]);
  });

  it("values and pretty JSON", () => {
    expect(metaValue(true)).toBe("yes");
    expect(metaValue(12_000)).toBe("12,000");
    expect(metaValue({ a: 1 })).toBe('{"a":1}');
    expect(metaValue(null)).toBe("—");
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(prettyJson({})).toBeNull();
    expect(prettyJson(null)).toBeNull();
  });
});
