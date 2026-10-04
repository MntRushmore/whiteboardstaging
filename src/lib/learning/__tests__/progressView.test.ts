import { describe, expect, it } from "vitest";
import { OUTCOMES, SKILLS, type DayActivity, type SkillProgress } from "../contracts";
import {
  CHART_DAYS,
  LEVEL_LABELS,
  OUTCOME_LABELS,
  activityChart,
  buildProgressView,
  chartScaleMax,
  courseLabel,
  courseSkills,
  dayLabel,
  durationTile,
  firstName,
  formatDuration,
  formatShortDuration,
  grownUpsSummary,
  independentWording,
  localDateKey,
  normalizeDays,
  practiceTitle,
  problemsLabel,
  progressStateFor,
  recentProblems,
  relativeDay,
  scorePercent,
  skillGroups,
  streakWording,
  tickLabel,
  timesLabel,
  topMistakes,
  weekStats,
  type GrownUpsInput,
} from "../progressView";
import { ATTEMPTS, EMPTY_SUMMARY, NOW, TZ, attempt, makeSummary } from "./progressFixtures";

const MIN = 60_000;

describe("durations", () => {
  it("formats sentences", () => {
    expect(formatDuration(0)).toBe("no time");
    expect(formatDuration(-5)).toBe("no time");
    expect(formatDuration(NaN)).toBe("no time");
    expect(formatDuration(20_000)).toBe("1 minute");
    expect(formatDuration(42 * MIN)).toBe("42 minutes");
    expect(formatDuration(60 * MIN)).toBe("1 hour");
    expect(formatDuration(65 * MIN)).toBe("1 hour 5 minutes");
    expect(formatDuration(200 * MIN)).toBe("3 hours 20 minutes");
    expect(formatDuration(121 * MIN)).toBe("2 hours 1 minute");
  });
  it("formats the chart's short form", () => {
    expect(formatShortDuration(0)).toBe("0 min");
    expect(formatShortDuration(29_000)).toBe("1 min");
    expect(formatShortDuration(42 * MIN)).toBe("42 min");
    expect(formatShortDuration(120 * MIN)).toBe("2 h");
    expect(formatShortDuration(65 * MIN)).toBe("1 h 5 min");
  });
  it("keeps the minutes tile a number a child reads", () => {
    expect(durationTile(0)).toEqual({ value: "0", label: "minutes of practice" });
    expect(durationTile(MIN)).toEqual({ value: "1", label: "minute of practice" });
    expect(durationTile(42 * MIN)).toEqual({ value: "42", label: "minutes of practice" });
    expect(durationTile(119 * MIN)).toEqual({ value: "119", label: "minutes of practice" });
    expect(durationTile(120 * MIN)).toEqual({ value: "2", label: "hours of practice" });
    expect(durationTile(150 * MIN)).toEqual({ value: "2½", label: "hours of practice" });
    expect(durationTile(170 * MIN)).toEqual({ value: "3", label: "hours of practice" });
  });
});

describe("counts and words", () => {
  it("problems", () => {
    expect(problemsLabel(0)).toBe("Not tried yet");
    expect(problemsLabel(1)).toBe("1 problem");
    expect(problemsLabel(1200)).toBe("1,200 problems");
  });
  it("times", () => {
    expect(timesLabel(1)).toBe("once");
    expect(timesLabel(2)).toBe("twice");
    expect(timesLabel(7)).toBe("7 times");
  });
  it("score percent clamps", () => {
    expect(scorePercent(0.426)).toBe(43);
    expect(scorePercent(-1)).toBe(0);
    expect(scorePercent(3)).toBe(100);
    expect(scorePercent(NaN)).toBe(0);
  });
  it("on your own, as a share a child gets", () => {
    expect(independentWording(0, 0)).toEqual({ percent: null, phrase: "Solve one on your own!" });
    expect(independentWording(5, 5)).toEqual({ percent: 100, phrase: "All of them!" });
    expect(independentWording(9, 10).phrase).toBe("Most of them!");
    expect(independentWording(6, 10)).toEqual({ percent: 60, phrase: "More than half" });
    expect(independentWording(2, 4)).toEqual({ percent: 50, phrase: "Half of them" });
    expect(independentWording(3, 10).phrase).toBe("Some of them");
    expect(independentWording(1, 10).phrase).toBe("A few of them");
    expect(independentWording(0, 10)).toEqual({ percent: 0, phrase: "Not yet. You'll get there!" });
    // never over 100 %
    expect(independentWording(12, 10).percent).toBe(100);
  });
  it("streak", () => {
    expect(streakWording(0)).toEqual({ label: "days in a row", hint: "Solve one today to start!" });
    expect(streakWording(1)).toEqual({ label: "day in a row", hint: "Come back tomorrow!" });
    expect(streakWording(6)).toEqual({ label: "days in a row", hint: "Keep it going!" });
  });
  it("labels every level and outcome", () => {
    expect(Object.values(LEVEL_LABELS)).toEqual(["New", "Practicing", "Almost there", "Mastered"]);
    for (const o of OUTCOMES) expect(OUTCOME_LABELS[o]).toBeTruthy();
    expect(OUTCOME_LABELS.first_try).toBe("On your own");
    expect(OUTCOME_LABELS.self_corrected).toBe("Fixed it yourself");
    expect(OUTCOME_LABELS.tutor_solved).toBe("Tutor solved it");
  });
  it("names the practice board", () => {
    expect(practiceTitle("Two-step equations")).toBe("Practice: Two-step equations");
  });
});

describe("dates", () => {
  it("local date keys follow the offset", () => {
    // 2026-10-05 02:00 UTC is still Oct 4 in Chicago, and already Oct 5 in Berlin (-120)
    const t = Date.parse("2026-10-05T02:00:00Z");
    expect(localDateKey(t, 300)).toBe("2026-10-04");
    expect(localDateKey(t, -120)).toBe("2026-10-05");
    expect(localDateKey(t)).toBe("2026-10-05");
  });
  it("day labels", () => {
    expect(dayLabel("2026-09-30")).toBe("Sep 30");
    expect(dayLabel("2026-09-30", "long")).toBe("Wed, Sep 30");
    expect(dayLabel("nope")).toBe("");
  });
  it("relative days are calendar days in local time", () => {
    expect(relativeDay("2026-10-04T14:00:00Z", NOW, TZ)).toBe("Today");
    // 03:00 UTC on Oct 4 is the evening of Oct 3 in Chicago
    expect(relativeDay("2026-10-04T03:00:00Z", NOW, TZ)).toBe("Yesterday");
    expect(relativeDay("2026-10-04T03:00:00Z", NOW, 0)).toBe("Today");
    expect(relativeDay("2026-10-01T15:00:00Z", NOW, TZ)).toBe("3 days ago");
    expect(relativeDay("2026-09-27T15:00:00Z", NOW, TZ)).toBe("Sep 27");
    expect(relativeDay("2025-12-30T15:00:00Z", NOW, TZ)).toBe("Dec 30, 2025");
    expect(relativeDay("2026-10-09T15:00:00Z", NOW, TZ)).toBe("Today");
    expect(relativeDay("garbage", NOW, TZ)).toBe("");
  });
  it("normalizes the days to 28 ending today, zeros filled", () => {
    const days = normalizeDays([{ date: "2026-10-02", problems: 3, activeMs: 9 * MIN }, { date: "2026-08-01", problems: 9, activeMs: MIN }], NOW, TZ);
    expect(days).toHaveLength(CHART_DAYS);
    expect(days[0].date).toBe("2026-09-07");
    expect(days[27].date).toBe("2026-10-04");
    expect(days.find((d) => d.date === "2026-10-02")).toEqual({ date: "2026-10-02", problems: 3, activeMs: 9 * MIN });
    expect(days.reduce((n, d) => n + d.problems, 0)).toBe(3);
    expect(normalizeDays([], NOW, TZ).every((d) => d.problems === 0 && d.activeMs === 0)).toBe(true);
  });
});

describe("this week", () => {
  it("adds up the last 7 local days, independence from the attempts", () => {
    const s = makeSummary();
    expect(weekStats(s.days, ATTEMPTS, NOW, TZ)).toEqual({ activeMs: 45 * MIN, problems: 10, independent: 6, activeDays: 4 });
  });
  it("never counts more solved alone than problems", () => {
    const days: DayActivity[] = [{ date: "2026-10-04", problems: 1, activeMs: MIN }];
    const many = [attempt({ startedAt: "2026-10-04T15:00:00Z" }), attempt({ startedAt: "2026-10-04T16:00:00Z" })];
    expect(weekStats(days, many, NOW, TZ).independent).toBe(1);
  });
  it("leaves out attempts from before the week", () => {
    const old = attempt({ startedAt: "2026-09-27T15:00:00Z" });
    expect(weekStats([{ date: "2026-09-27", problems: 1, activeMs: MIN }], [old], NOW, TZ)).toEqual({ activeMs: 0, problems: 0, independent: 0, activeDays: 0 });
  });
});

describe("activity chart", () => {
  it("scales to a clean top with a clean middle tick", () => {
    expect(chartScaleMax(0)).toBe(10);
    expect(chartScaleMax(10)).toBe(10);
    expect(chartScaleMax(13)).toBe(20);
    expect(chartScaleMax(41)).toBe(60);
    expect(chartScaleMax(61)).toBe(90);
    expect(chartScaleMax(500)).toBe(720);
    expect(chartScaleMax(NaN)).toBe(10);
    expect(tickLabel(5)).toBe("5 min");
    expect(tickLabel(45)).toBe("45 min");
    expect(tickLabel(60)).toBe("1 h");
    expect(tickLabel(90)).toBe("1½ h");
    expect(tickLabel(120)).toBe("2 h");
  });
  it("makes 28 bars, today last, with axis labels and a summary", () => {
    const chart = activityChart(makeSummary().days, NOW, TZ);
    expect(chart.bars).toHaveLength(28);
    expect(chart.maxMinutes).toBe(20);
    expect(chart.ticks.map((t) => t.label)).toEqual(["10 min", "20 min"]);
    const today = chart.bars[27];
    expect(today.isToday).toBe(true);
    expect(today.axisLabel).toBe("Today");
    expect(today.minutes).toBe(12);
    expect(today.ratio).toBeCloseTo(12 / 20);
    expect(today.label).toBe("Sun, Oct 4: 12 min, 3 problems");
    expect(today.day).toBe("Sun, Oct 4");
    expect(today.value).toBe("12 min, 3 problems");
    expect(chart.bars.filter((b) => b.isToday)).toHaveLength(1);
    expect(chart.bars.map((b) => b.axisLabel).filter(Boolean)).toEqual(["Sep 7", "Sep 14", "Sep 21", "Sep 28", "Today"]);
    expect(chart.bars[1].label).toBe("Tue, Sep 8: no practice");
    expect(Math.max(...chart.bars.map((b) => b.ratio))).toBeLessThanOrEqual(1);
    expect(chart.summary).toBe(
      "You practiced on 8 of the last 28 days, 1 hour 2 minutes in all. Your busiest day was Sat, Oct 3, with 13 minutes.",
    );
  });
  it("says so when there was nothing", () => {
    const chart = activityChart([], NOW, TZ);
    expect(chart.summary).toBe("No practice in the last 4 weeks yet.");
    expect(chart.bars.every((b) => b.ratio === 0)).toBe(true);
    expect(chart.maxMinutes).toBe(10);
  });
});

describe("skills", () => {
  it("groups by area in SKILLS order, the fallback skill last", () => {
    const s = makeSummary();
    const other: SkillProgress = { skill: "other", name: "Other maths", area: "algebra", level: "practicing", score: 0.2, attempts: 2, independent: 1, lastAt: null };
    // shuffled input
    const groups = skillGroups([other, ...[...s.skills].reverse()], "algebra1");
    expect(groups.map((g) => g.label)).toEqual(["Numbers", "Algebra", "Functions and graphs", "Everything else"]);
    expect(groups[0].skills.map((x) => x.skill)).toEqual(["negative_numbers", "order_of_operations", "fractions", "powers_roots"]);
    expect(groups[1].skills.map((x) => x.skill)).toEqual(["simplify_expressions", "one_step_equations", "two_step_equations", "multi_step_equations", "systems", "factoring"]);
    expect(groups[3].skills.map((x) => x.skill)).toEqual(["other"]);
  });
  it("labels each skill", () => {
    const [numbers] = skillGroups(makeSummary().skills, "algebra1");
    const neg = numbers.skills[0];
    expect(neg).toMatchObject({ levelLabel: "Practicing", percent: 42, problemsText: "2 problems" });
    const fractions = numbers.skills[2];
    expect(fractions).toMatchObject({ level: "mastered", levelLabel: "Mastered", percent: 100 });
    const powers = numbers.skills[3];
    expect(powers).toMatchObject({ levelLabel: "New", percent: 0, problemsText: "Not tried yet" });
  });
  it("lists the course's skills as New before any practice", () => {
    const list = courseSkills("geometry");
    expect(list.map((s) => s.skill)).toEqual(SKILLS.filter((s) => (s.courses as readonly string[]).includes("geometry")).map((s) => s.id));
    expect(list.every((s) => s.level === "new" && s.attempts === 0 && s.lastAt === null)).toBe(true);
    expect(skillGroups([], "geometry").map((g) => g.label)).toEqual(["Geometry"]);
    expect(skillGroups([], "algebra2").map((g) => g.label)).toEqual(["Algebra", "Functions and graphs"]);
    expect(skillGroups([], "other")).toEqual([]);
    expect(skillGroups([], null)).toEqual([]);
  });
});

describe("mistakes and recent problems", () => {
  it("takes the top three with their tips", () => {
    const top = topMistakes([{ kind: "sign", count: 4 }, { kind: "distribution", count: 2 }, { kind: "arithmetic", count: 1 }, { kind: "units", count: 1 }]);
    expect(top).toHaveLength(3);
    expect(top[0]).toEqual({
      kind: "sign",
      label: "Plus and minus signs",
      count: 4,
      countText: "4 times",
      tip: "When a term moves across the = or you multiply by a negative, check its sign.",
    });
    expect(top[1].countText).toBe("twice");
    expect(topMistakes([{ kind: "sign", count: 0 }])).toEqual([]);
  });
  it("describes the latest problems", () => {
    const s = makeSummary();
    const recent = recentProblems(s.recent, NOW, TZ, s.skills);
    expect(recent).toHaveLength(12);
    expect(recent[0]).toMatchObject({ outcomeLabel: "In progress", tone: "neutral", when: "Today", skillName: "Two-step equations", boardHref: "/board/b1" });
    expect(recent[1]).toMatchObject({ outcomeLabel: "On your own", tone: "success" });
    expect(recent[2]).toMatchObject({ outcomeLabel: "Fixed it yourself", tone: "success" });
    expect(recent[3]).toMatchObject({ outcomeLabel: "With help", tone: "info", when: "Yesterday", plain: "x² − 5x + 6 = 0" });
    // a system: its lines side by side; a deleted board: no link
    expect(recent[5]).toMatchObject({ latex: "x + y = 10,\\quad x - y = 2", plain: "x + y = 10, x − y = 2", outcomeLabel: "Tutor solved it", boardHref: null, when: "2 days ago" });
    // fractions at full size, and read aloud as text
    expect(recent[6]).toMatchObject({ latex: "\\dfrac{3}{4} + \\dfrac{1}{6}", plain: "¾ + ⅙" });
    expect(recentProblems([attempt({ problemLatex: "\\dfrac{1}{2} + \\tfrac{1}{3}" })], NOW, TZ)[0].latex).toBe("\\dfrac{1}{2} + \\tfrac{1}{3}");
    expect(recent[8]).toMatchObject({ outcomeLabel: "Unfinished" });
    expect(recent[10]).toMatchObject({ when: "Sep 25" });
  });
  it("caps the list at 12", () => {
    const many = Array.from({ length: 20 }, () => attempt());
    expect(recentProblems(many, NOW, TZ)).toHaveLength(12);
  });
});

describe("course and name", () => {
  it("course labels", () => {
    expect(courseLabel("algebra1")).toBe("Algebra 1");
    expect(courseLabel("precalc_calc")).toBe("Pre-calculus / Calculus");
    expect(courseLabel("other")).toBeNull();
    expect(courseLabel(null)).toBeNull();
  });
  it("first names", () => {
    expect(firstName("Maya Patel")).toBe("Maya");
    expect(firstName("  sam ")).toBe("sam");
    expect(firstName("kid@example.com")).toBeNull();
    expect(firstName("")).toBeNull();
    expect(firstName(null)).toBeNull();
    expect(firstName("1234")).toBeNull();
  });
});

describe("for grown-ups", () => {
  const s = makeSummary();
  const base: GrownUpsInput = {
    name: null,
    week: weekStats(s.days, ATTEMPTS, NOW, TZ),
    totalProblems: s.totals.problems,
    skills: s.skills,
    strongSkills: s.strongSkills,
    weakSkills: s.weakSkills,
    mistakes: s.mistakes,
    lastAt: s.recent[0].startedAt,
    now: NOW,
    tzOffsetMinutes: TZ,
  };

  it("says the week, a strength, what to practice next and the slip to watch", () => {
    expect(grownUpsSummary(base)).toBe(
      "This week: 45 minutes over 4 days, 10 problems, 6 solved without help. Has mastered Fractions. " +
        "Getting stronger at Two-step equations. A good one to practice next: Systems of equations. " +
        "Keeps tripping on plus and minus signs; a tip: When a term moves across the = or you multiply by a negative, check its sign.",
    );
  });
  it("uses the student's name when there is one", () => {
    expect(grownUpsSummary({ ...base, name: "Maya" })).toMatch(/^This week Maya practiced 45 minutes over 4 days: 10 problems, 6 solved without help\. /);
  });
  it("a quiet week names the last time", () => {
    const week = { activeMs: 0, problems: 0, independent: 0, activeDays: 0 };
    expect(grownUpsSummary({ ...base, week, lastAt: "2026-09-25T15:00:00Z", mistakes: [], strongSkills: [], weakSkills: [], skills: [] })).toBe(
      "No practice yet this week; the last time was on Sep 25.",
    );
    expect(grownUpsSummary({ ...base, week, lastAt: null, mistakes: [], strongSkills: [], weakSkills: [], skills: [] })).toBe("No practice yet this week.");
  });
  it("a first problem gets an encouraging line", () => {
    const week = { activeMs: 3 * MIN, problems: 1, independent: 1, activeDays: 1 };
    expect(grownUpsSummary({ ...base, week, totalProblems: 1, mistakes: [], strongSkills: [], weakSkills: [], skills: [] })).toBe(
      "This week: 3 minutes over 1 day, 1 problem, 1 solved without help. Your child is off to a good start.",
    );
  });
  it("explains what will appear before there is anything", () => {
    expect(grownUpsSummary({ ...base, name: "Maya", totalProblems: 0 })).toMatch(/^Nothing to report yet\. Once Maya solves a few problems on a board/);
    expect(grownUpsSummary({ ...base, totalProblems: 0 })).toMatch(/Once your child solves/);
  });
  it("does not name the same skill twice", () => {
    const text = grownUpsSummary({ ...base, weakSkills: ["two_step_equations", "factoring"] });
    expect(text).toContain("Getting stronger at Two-step equations.");
    expect(text).toContain("A good one to practice next: Factoring.");
    expect(text.match(/Two-step equations/g)).toHaveLength(1);
  });
  it("stays short", () => {
    const text = grownUpsSummary(base);
    expect(text.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(5);
    expect(text.length).toBeLessThan(420);
  });
});

describe("page state and view", () => {
  it("picks the state", () => {
    expect(progressStateFor({ loading: true, error: null, summary: null })).toBe("loading");
    expect(progressStateFor({ loading: false, error: "boom", summary: null })).toBe("error");
    expect(progressStateFor({ loading: false, error: null, summary: EMPTY_SUMMARY })).toBe("empty");
    expect(progressStateFor({ loading: false, error: null, summary: makeSummary() })).toBe("ready");
  });
  it("builds the whole page from a summary", () => {
    const view = buildProgressView(makeSummary(), { attempts: ATTEMPTS, now: NOW, tzOffsetMinutes: TZ, course: "algebra1", displayName: "Maya Patel" });
    expect(view.title).toBe("Your progress");
    expect(view.course).toBe("Algebra 1");
    expect(view.tiles).toEqual([
      { key: "minutes", value: "45", label: "minutes of practice", hint: "on 4 days" },
      { key: "problems", value: "10", label: "problems worked on", hint: null },
      { key: "independent", value: "6", label: "solved on your own", hint: "60% · More than half" },
      { key: "streak", value: "4", label: "days in a row", hint: "Keep it going!" },
    ]);
    expect(view.skillsTitle).toBe("Your skills");
    expect(view.mistakes.map((m) => m.kind)).toEqual(["sign", "distribution", "arithmetic"]);
    expect(view.recent).toHaveLength(12);
    expect(view.grownUps).toMatch(/^This week Maya practiced/);
  });
  it("an empty record still shows the course's skills", () => {
    const view = buildProgressView(EMPTY_SUMMARY, { attempts: [], now: NOW, tzOffsetMinutes: TZ, course: "algebra1", displayName: null });
    expect(view.skillsTitle).toBe("Skills in Algebra 1");
    expect(view.skills.flatMap((g) => g.skills).every((s) => s.levelLabel === "New")).toBe(true);
    expect(view.skills.flatMap((g) => g.skills).length).toBeGreaterThan(10);
    expect(view.tiles.map((t) => t.value)).toEqual(["0", "0", "0", "0"]);
    expect(view.tiles[2].hint).toBe("Solve one on your own!");
    expect(view.chart.bars).toHaveLength(28);
    expect(view.grownUps).toMatch(/^Nothing to report yet/);
  });
});
