/**
 * GET /api/sat/progress's answer (src/lib/sat/progress.ts) and the student's day (src/lib/sat/day.ts).
 */
import { describe, expect, it } from "vitest";
import { isTimeZone, localDay, previousDay } from "@/lib/sat/day";
import { buildProgress, type ProgressAttempt } from "@/lib/sat/progress";

const NOW = Date.parse("2026-10-22T03:00:00Z"); // 23:00 on Oct 21 in New York

const at = (iso: string, correct: boolean, meta: ProgressAttempt["meta"] = { domain: "algebra", skill: "linear functions", difficulty: 2 }): ProgressAttempt => ({ question_id: "algebra-linear-functions-0001", correct, created_at: iso, meta });

describe("day", () => {
  it("dates by the student's zone", () => {
    expect(localDay("America/New_York", NOW)).toBe("2026-10-21");
    expect(localDay("UTC", NOW)).toBe("2026-10-22");
    expect(localDay("Pacific/Kiritimati", NOW)).toBe("2026-10-22");
    expect(localDay("Not/AZone", NOW)).toBe("2026-10-22");
  });
  it("knows a zone from a typo", () => {
    expect(isTimeZone("Europe/London")).toBe(true);
    expect(isTimeZone("Europe/Lundon")).toBe(false);
  });
  it("steps back across months", () => {
    expect(previousDay("2026-11-01")).toBe("2026-10-31");
  });
});

describe("buildProgress", () => {
  it("counts totals, domains (all four, in order), answered skills and today in the student's zone", () => {
    const p = buildProgress({
      attempts: [
        at("2026-10-22T02:00:00Z", true), // Oct 21 in New York
        at("2026-10-21T15:00:00Z", false, { domain: "psda", skill: "percentages", difficulty: 1 }),
        at("2026-10-20T15:00:00Z", true, null), // retired since
      ],
      tz: "America/New_York",
      now: NOW,
      tutorUsedToday: 2,
      cap: 5,
      unlimited: false,
    });
    expect(p.answered).toBe(3);
    expect(p.correct).toBe(2);
    expect(p.by_domain.map((d) => d.domain)).toEqual(["algebra", "advanced_math", "psda", "geometry_trig"]);
    expect(p.by_domain[0]).toEqual({ domain: "algebra", answered: 1, correct: 1 });
    expect(p.by_domain[2]).toEqual({ domain: "psda", answered: 1, correct: 0 });
    expect(p.by_skill).toEqual([
      { domain: "algebra", skill: "linear functions", answered: 1, correct: 1 },
      { domain: "psda", skill: "percentages", answered: 1, correct: 0 },
    ]);
    expect(p.today).toEqual({ answered: 2, tutor_used: 2, cap: 5, unlimited: false });
    expect(p.streak_days).toBe(2);
    expect(p.estimate).toBeNull();
  });
  it("keeps a streak alive until the day ends, and breaks it on a missed day", () => {
    const base = { tz: "UTC", now: Date.parse("2026-10-22T09:00:00Z"), tutorUsedToday: 0, cap: 5, unlimited: true };
    expect(buildProgress({ ...base, attempts: [at("2026-10-21T10:00:00Z", true), at("2026-10-20T10:00:00Z", true)] }).streak_days).toBe(2);
    expect(buildProgress({ ...base, attempts: [at("2026-10-22T08:00:00Z", true), at("2026-10-20T10:00:00Z", true)] }).streak_days).toBe(1);
    expect(buildProgress({ ...base, attempts: [at("2026-10-19T10:00:00Z", true)] }).streak_days).toBe(0);
  });
  it("gives an estimate from 15 answers", () => {
    const attempts = Array.from({ length: 15 }, (_, i) => at(`2026-10-${String(10 + (i % 10)).padStart(2, "0")}T10:00:00Z`, i % 3 !== 0));
    const p = buildProgress({ attempts, tz: "UTC", now: NOW, tutorUsedToday: 0, cap: 5, unlimited: false });
    expect(p.estimate).not.toBeNull();
    expect(p.estimate!.low).toBeGreaterThanOrEqual(200);
  });
});
