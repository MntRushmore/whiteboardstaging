import { describe, expect, it } from "vitest";
import { SKILLS, type AttemptRecord, type MasteryLevel, type Outcome, type SkillId } from "../contracts";
import { LearnerHintSchema } from "../hint";
import { learnerHint, masteryOf, summarize } from "../summary";

const DAY = 86_400_000;
/** 2026-10-04 15:00 UTC: 10:00 in Chicago (offset 300), 20:30 in India (offset -330). */
const NOW = Date.parse("2026-10-04T15:00:00Z");

let seq = 0;
function att(over: Partial<AttemptRecord> & { at?: number } = {}): AttemptRecord {
  const at = over.at ?? NOW - 3_600_000;
  seq++;
  const { at: _at, ...rest } = over;
  void _at;
  return {
    id: `a${seq}`,
    boardId: "b1",
    problemLatex: "2x + 3 = 11",
    skill: "two_step_equations",
    course: "algebra1",
    origin: "student",
    parentId: null,
    outcome: "first_try",
    mistakes: {},
    activeMs: 60_000,
    startedAt: new Date(at).toISOString(),
    updatedAt: new Date(at + 60_000).toISOString(),
    finishedAt: new Date(at + 60_000).toISOString(),
    linesWritten: 3,
    linesRight: 3,
    linesRinged: 0,
    hints: 0,
    tutorSteps: 0,
    solves: 0,
    asks: 0,
    ...rest,
  };
}

/** Attempts of one skill, newest first, an hour apart. */
const run = (outcomes: readonly Outcome[], over: Partial<AttemptRecord> = {}) => outcomes.map((outcome, i) => att({ outcome, at: NOW - (i + 1) * 3_600_000, ...over }));

describe("mastery", () => {
  it.each<[string, Outcome[], MasteryLevel]>([
    ["nothing yet", [], "new"],
    ["one first try is not mastery", ["first_try"], "practicing"],
    ["two first tries: almost", ["first_try", "first_try"], "almost"],
    ["three solved alone: mastered", ["first_try", "first_try", "first_try"], "mastered"],
    ["self-corrected counts as alone", ["first_try", "self_corrected", "first_try", "with_help"], "mastered"],
    ["help every time: practicing", ["with_help", "with_help", "with_help"], "practicing"],
    ["the tutor solved them: practicing", ["tutor_solved", "tutor_solved", "first_try"], "practicing"],
    ["the newest needed help: not mastered", ["with_help", "first_try", "first_try", "first_try"], "almost"],
    ["three alone over two tutor solves: almost", ["first_try", "first_try", "first_try", "tutor_solved", "tutor_solved"], "almost"],
    ["only the last 8 count", ["first_try", "first_try", "first_try", "first_try", "first_try", "first_try", "first_try", "first_try", "tutor_solved", "tutor_solved"], "mastered"],
  ])("%s", (_, outcomes, level) => {
    expect(masteryOf(run(outcomes), NOW).level).toBe(level);
  });

  it("the score is the recency-weighted value of the outcomes", () => {
    // 1·1 + 0.85·0.8 + 0.7225·1 + 0.614125·0.35, over 1 + 0.85 + 0.7225 + 0.614125
    expect(masteryOf(run(["first_try", "self_corrected", "first_try", "with_help"]), NOW).score).toBeCloseTo(2.6174 / 3.1866, 3);
    expect(masteryOf(run(["tutor_solved"]), NOW)).toEqual({ level: "practicing", score: 0 });
  });

  it("in-progress work does not count; unfinished counts only with a line written", () => {
    expect(masteryOf([...run(["in_progress"]), ...run(["first_try", "first_try", "first_try"])], NOW).level).toBe("mastered");
    expect(masteryOf([att({ outcome: "unfinished", linesWritten: 0 }), ...run(["first_try", "first_try", "first_try"])], NOW).level).toBe("mastered");
    const struggled = masteryOf([att({ outcome: "unfinished", linesWritten: 2 }), ...run(["first_try", "first_try", "first_try"])], NOW);
    expect(struggled.level).toBe("almost");
  });

  it("older attempts weigh less, and more than 30 days old half as much again", () => {
    const fresh = masteryOf([att({ outcome: "first_try", at: NOW - 1000 }), att({ outcome: "tutor_solved", at: NOW - 2 * DAY }), att({ outcome: "tutor_solved", at: NOW - 3 * DAY })], NOW);
    const stale = masteryOf([att({ outcome: "first_try", at: NOW - 1000 }), att({ outcome: "tutor_solved", at: NOW - 40 * DAY }), att({ outcome: "tutor_solved", at: NOW - 41 * DAY })], NOW);
    expect(fresh.score).toBeCloseTo(1 / 2.5725, 3);
    expect(stale.score).toBeCloseTo(1 / (1 + 0.425 + 0.36125), 3);
  });

  it("a Now you try solved alone after a tutor solve is strong evidence", () => {
    const outcomes: Outcome[] = ["first_try", "self_corrected", "self_corrected", "with_help"];
    const plain = masteryOf(run(outcomes), NOW);
    const nowYouTry = masteryOf([att({ outcome: "first_try", origin: "now_you_try", parentId: "p", at: NOW - 1000 }), ...run(outcomes.slice(1))], NOW);
    expect(nowYouTry.score).toBeGreaterThan(plain.score);
    expect(plain.level).toBe("almost");
    expect(nowYouTry.level).toBe("mastered");
    // tried with help, it is ordinary evidence
    const helped = masteryOf([att({ outcome: "with_help", origin: "now_you_try", at: NOW - 1000 }), ...run(outcomes.slice(1))], NOW);
    expect(helped.level).not.toBe("mastered");
  });
});

describe("summarize: totals and days", () => {
  it("nothing: zeros, 28 empty days, no streak", () => {
    const s = summarize([], NOW);
    expect(s.totals).toEqual({ problems: 0, independent: 0, withHelp: 0, tutorSolved: 0, activeMs: 0, lines: 0, linesRight: 0 });
    expect(s.days).toHaveLength(28);
    expect(s.days.every((d) => d.problems === 0 && d.activeMs === 0)).toBe(true);
    expect(s.days[0].date).toBe("2026-09-07");
    expect(s.days[27].date).toBe("2026-10-04");
    expect(s.streakDays).toBe(0);
    expect(s).toMatchObject({ skills: [], weakSkills: [], strongSkills: [], mistakes: [], recent: [] });
  });

  it("totals count work; a problem never touched counts nowhere", () => {
    const s = summarize(
      [
        att({ outcome: "first_try", linesWritten: 3, linesRight: 3, activeMs: 10_000 }),
        att({ outcome: "self_corrected", linesWritten: 4, linesRight: 3, linesRinged: 1, activeMs: 20_000 }),
        att({ outcome: "with_help", linesWritten: 2, linesRight: 2, hints: 1, activeMs: 30_000 }),
        att({ outcome: "tutor_solved", linesWritten: 0, linesRight: 0, solves: 1, activeMs: 5_000 }),
        att({ outcome: "in_progress", linesWritten: 1, linesRight: 1, activeMs: 1_000 }),
        att({ outcome: "unfinished", linesWritten: 0, linesRight: 0, activeMs: 0 }),
      ],
      NOW,
    );
    expect(s.totals).toEqual({ problems: 5, independent: 2, withHelp: 1, tutorSolved: 1, activeMs: 66_000, lines: 10, linesRight: 9 });
    expect(s.recent).toHaveLength(5);
  });

  it.each<[string, number, string, string]>([
    ["Chicago: 03:00 UTC is the evening before", 300, "2026-10-04T03:00:00Z", "2026-10-03"],
    ["Chicago: 05:00 UTC is just past midnight", 300, "2026-10-04T05:00:00Z", "2026-10-04"],
    ["India: 20:00 UTC is the next morning", -330, "2026-10-03T20:00:00Z", "2026-10-04"],
    ["UTC by default", 0, "2026-10-03T23:59:00Z", "2026-10-03"],
  ])("local days: %s", (_, tz, startedAt, date) => {
    const s = summarize([att({ at: Date.parse(startedAt), activeMs: 42_000 })], NOW, { tzOffsetMinutes: tz });
    const day = s.days.find((d) => d.date === date);
    expect(day).toEqual({ date, problems: 1, activeMs: 42_000 });
    expect(s.days.filter((d) => d.problems > 0)).toHaveLength(1);
  });

  it("today is the student's today: late evening in Chicago is still the 3rd", () => {
    const now = Date.parse("2026-10-04T02:00:00Z");
    const s = summarize([], now, { tzOffsetMinutes: 300 });
    expect(s.days[27].date).toBe("2026-10-03");
    expect(new Set(s.days.map((d) => d.date)).size).toBe(28);
  });

  const daysAgo = (...ds: number[]) => ds.map((d) => att({ at: NOW - d * DAY }));
  it.each<[string, AttemptRecord[], number]>([
    ["today, yesterday and the day before", daysAgo(0, 1, 2), 3],
    ["yesterday and the day before, none yet today", daysAgo(1, 2), 2],
    ["only two days ago: broken", daysAgo(2), 0],
    ["today with a gap before it", daysAgo(0, 2, 3), 1],
    ["several problems a day count once", daysAgo(0, 0, 0, 1, 1), 2],
    ["40 days running, past the 28 shown", daysAgo(...Array.from({ length: 40 }, (_, i) => i)), 40],
    ["a problem never touched keeps no streak", [att({ at: NOW, outcome: "unfinished", linesWritten: 0 })], 0],
  ])("streak: %s", (_, attempts, streak) => {
    expect(summarize(attempts, NOW).streakDays).toBe(streak);
  });

  it("streak days are local days", () => {
    // 02:00 UTC on the 3rd and on the 2nd: in UTC yesterday and the day before (a streak of 2); in
    // Chicago the evenings of the 2nd and the 1st, nothing yesterday (no streak)
    const attempts = [att({ at: Date.parse("2026-10-03T02:00:00Z") }), att({ at: Date.parse("2026-10-02T02:00:00Z") })];
    expect(summarize(attempts, NOW, { tzOffsetMinutes: 300 }).streakDays).toBe(0);
    expect(summarize(attempts, NOW, { tzOffsetMinutes: 0 }).streakDays).toBe(2);
  });
});

describe("summarize: skills", () => {
  it("the course's skills are listed as new before they are practised, in SKILLS order", () => {
    const s = summarize([], NOW, { course: "algebra1" });
    const expected = SKILLS.filter((d) => (d.courses as readonly string[]).includes("algebra1")).map((d) => d.id);
    expect(s.skills.map((k) => k.skill)).toEqual(expected);
    expect(s.skills.every((k) => k.level === "new" && k.attempts === 0 && k.lastAt === null && k.score === 0)).toBe(true);
    expect(summarize([], NOW, { course: "other" }).skills).toEqual([]);
  });

  it("a practised skill outside the course is listed too, with its counts", () => {
    const attempts = [...run(["first_try", "with_help"], { skill: "fractions" }), att({ skill: "chemistry", outcome: "first_try", at: NOW - 10 * 3_600_000 })];
    const s = summarize(attempts, NOW, { course: "geometry" });
    const fractions = s.skills.find((k) => k.skill === "fractions")!;
    expect(fractions).toMatchObject({ name: "Fractions", area: "arithmetic", attempts: 2, independent: 1, level: "almost", lastAt: attempts[0].startedAt });
    expect(s.skills.some((k) => k.skill === "chemistry")).toBe(true);
    // SKILLS order: arithmetic, then geometry, then science
    const ids = s.skills.map((k) => k.skill);
    expect(ids.indexOf("fractions")).toBeLessThan(ids.indexOf("angles"));
    expect(ids.indexOf("angles")).toBeLessThan(ids.indexOf("chemistry"));
  });

  it("weak skills: worked on and not mastered, weakest first, at most 5; strong: mastered, most recent first", () => {
    const skillRun = (skill: SkillId, outcomes: Outcome[], hoursAgo: number) => outcomes.map((outcome, i) => att({ skill, outcome, at: NOW - (hoursAgo + i) * 3_600_000 }));
    const attempts = [
      ...skillRun("fractions", ["tutor_solved", "with_help"], 1),
      ...skillRun("two_step_equations", ["with_help", "with_help", "first_try"], 5),
      ...skillRun("inequalities", ["first_try", "with_help"], 10),
      ...skillRun("factoring", ["tutor_solved", "tutor_solved", "tutor_solved"], 20),
      ...skillRun("systems", ["first_try"], 30),
      ...skillRun("radicals", ["with_help"], 40),
      ...skillRun("angles", ["first_try", "first_try", "first_try"], 50),
      ...skillRun("circles", ["first_try", "first_try", "first_try"], 2),
      ...skillRun("other", ["tutor_solved", "tutor_solved"], 3),
    ];
    const s = summarize(attempts, NOW);
    expect(s.weakSkills).toEqual(["factoring", "fractions", "radicals", "two_step_equations", "inequalities"]);
    expect(s.strongSkills).toEqual(["circles", "angles"]);
    expect(s.weakSkills).not.toContain("other");
  });
});

describe("summarize: mistakes and recent", () => {
  it("mistakes from the last 30 days, most frequent first", () => {
    const s = summarize(
      [
        att({ mistakes: { sign: 2, arithmetic: 1 } }),
        att({ mistakes: { sign: 1, distribution: 3 } }),
        att({ mistakes: { arithmetic: 1 }, at: NOW - 5 * DAY }),
        att({ mistakes: { exponents: 9 }, at: NOW - 31 * DAY }),
      ],
      NOW,
    );
    expect(s.mistakes).toEqual([
      { kind: "sign", count: 3 },
      { kind: "distribution", count: 3 },
      { kind: "arithmetic", count: 2 },
    ]);
  });

  it("recent: the latest 12 worked attempts, newest first; one per id (its latest state)", () => {
    const attempts = Array.from({ length: 15 }, (_, i) => att({ at: NOW - i * 60_000 }));
    const later = { ...attempts[3], outcome: "with_help" as const, updatedAt: new Date(NOW).toISOString() };
    const s = summarize([...attempts.reverse(), later], NOW);
    expect(s.recent).toHaveLength(12);
    expect(s.recent.map((a) => a.startedAt)).toEqual([...s.recent.map((a) => a.startedAt)].sort().reverse());
    expect(s.recent.find((a) => a.id === later.id)?.outcome).toBe("with_help");
    expect(s.totals.problems).toBe(15);
  });

  it("is pure and does not trip on odd rows", () => {
    const attempts = [att(), att({ startedAt: "not a date" }), att({ activeMs: Number.NaN, linesWritten: -3 })];
    const copy = structuredClone(attempts);
    const s = summarize(attempts, NOW, { tzOffsetMinutes: Number.NaN });
    expect(s.totals.problems).toBe(2);
    expect(attempts).toEqual(copy);
  });
});

describe("learnerHint", () => {
  it("nothing to say: undefined", () => {
    expect(learnerHint(summarize([], NOW, { course: "algebra1" }))).toBeUndefined();
    // a mistake made once is not a habit
    expect(learnerHint(summarize([att({ outcome: "unfinished", linesWritten: 0, mistakes: { sign: 1 } })], NOW))).toBeUndefined();
  });

  it("the top three weak and strong skills, and mistakes made at least twice", () => {
    const skillRun = (skill: SkillId, outcomes: Outcome[], hoursAgo: number) => outcomes.map((outcome, i) => att({ skill, outcome, at: NOW - (hoursAgo + i) * 3_600_000 }));
    const s = summarize(
      [
        ...skillRun("fractions", ["tutor_solved", "tutor_solved"], 1),
        ...skillRun("two_step_equations", ["with_help", "with_help"], 5),
        ...skillRun("inequalities", ["with_help", "first_try"], 10),
        ...skillRun("factoring", ["first_try", "with_help"], 20),
        ...skillRun("angles", ["first_try", "first_try", "first_try"], 30),
        att({ skill: "systems", outcome: "first_try", mistakes: { sign: 4, both_sides: 2, arithmetic: 1, fractions: 3, exponents: 2 } }),
      ],
      NOW,
    );
    const hint = learnerHint(s)!;
    expect(hint.weakSkills).toEqual([
      { id: "fractions", name: "Fractions" },
      { id: "two_step_equations", name: "Two-step equations" },
      { id: "inequalities", name: "Inequalities" },
    ]);
    expect(hint.strongSkills).toEqual([{ id: "angles", name: "Angles" }]);
    expect(hint.recurringMistakes).toEqual([
      { kind: "sign", count: 4 },
      { kind: "fractions", count: 3 },
      { kind: "both_sides", count: 2 },
    ]);
    expect(LearnerHintSchema.parse(hint)).toEqual(hint);
  });
});
