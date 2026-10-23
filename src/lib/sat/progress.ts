import { SAT_DOMAINS, SAT_LIMITS, SAT_SKILLS, type SatDomain, type SatProgressResponse } from "@/lib/sat/contracts";
import { localDay, previousDay } from "@/lib/sat/day";
import { estimateBand } from "@/lib/sat/estimate";
import { countReviews, isDue, type ReviewRow } from "@/lib/sat/reviews";

/**
 * GET /api/sat/progress's answer from the student's answers (pure; the route reads the rows).
 *
 *  - answered / correct: every answer read (the newest SAT_LIMITS.progressWindow).
 *  - by_domain / by_skill: the answers whose question is still live (a retired question's answers
 *    still count in the totals). Every domain is listed, in the spec's order; skills only once
 *    answered, in the spec's order.
 *  - streak_days: days in a row, in the student's time zone, with at least one answer, ending
 *    today, or yesterday when nothing is answered yet today (a streak is not lost before the day ends).
 *  - today: answers and free tutor passes on the student's date.
 *  - estimate: estimateBand (src/lib/sat/estimate.ts) over the answers with a known difficulty.
 *  - reviews_due / reviews_waiting (v2): the mistake deck's open reviews of live questions, due on
 *    the student's date (or overdue) / scheduled for a later day (src/lib/sat/reviews.ts).
 *  - today.correct (v2): right answers on the student's date.
 *  - reviews_due_skills (v2): the distinct skills of the reviews due today, at most 3, most-missed
 *    first: most due reviews in the skill, then most wrong answers in it (every answer read), then
 *    the spec's skill order.
 */

export type ProgressAttempt = {
  question_id: string;
  correct: boolean;
  created_at: string;
  /** null when the question is no longer live */
  meta: { domain: SatDomain; skill: string; difficulty: number } | null;
};

export type ProgressInput = {
  /** newest first */
  attempts: readonly ProgressAttempt[];
  tz: string;
  now?: number;
  tutorUsedToday: number;
  cap: number;
  unlimited: boolean;
  /** the student's open reviews of live questions (none when absent), with each question's skill */
  reviews?: ReadonlyArray<Pick<ReviewRow, "due_on" | "cleared_at"> & { skill?: string }>;
};

export function buildProgress(input: ProgressInput): SatProgressResponse {
  const now = input.now ?? Date.now();
  const today = localDay(input.tz, now);
  const domains = new Map(SAT_DOMAINS.map((d) => [d, { answered: 0, correct: 0 }]));
  const skills = new Map<string, { domain: SatDomain; answered: number; correct: number }>();
  const days = new Set<string>();
  let correct = 0;
  let todayAnswered = 0;
  let todayCorrect = 0;

  for (const a of input.attempts) {
    if (a.correct) correct++;
    const day = localDay(input.tz, Date.parse(a.created_at));
    days.add(day);
    if (day === today) {
      todayAnswered++;
      if (a.correct) todayCorrect++;
    }
    if (!a.meta) continue;
    const d = domains.get(a.meta.domain)!;
    d.answered++;
    if (a.correct) d.correct++;
    const s = skills.get(a.meta.skill) ?? { domain: a.meta.domain, answered: 0, correct: 0 };
    s.answered++;
    if (a.correct) s.correct++;
    skills.set(a.meta.skill, s);
  }

  let streak = 0;
  let day = days.has(today) ? today : previousDay(today);
  while (days.has(day)) {
    streak++;
    day = previousDay(day);
  }

  const order = SAT_DOMAINS.flatMap((d) => SAT_SKILLS[d].map((s) => s.name as string));

  // the skills of today's due reviews, most-missed first
  const dueBySkill = new Map<string, number>();
  for (const r of input.reviews ?? []) if (r.skill && isDue(r, today)) dueBySkill.set(r.skill, (dueBySkill.get(r.skill) ?? 0) + 1);
  const missed = (skill: string) => {
    const s = skills.get(skill);
    return s ? s.answered - s.correct : 0;
  };
  const rank = (skill: string) => (order.indexOf(skill) < 0 ? order.length : order.indexOf(skill));
  const dueSkills = [...dueBySkill.keys()]
    .sort((a, b) => dueBySkill.get(b)! - dueBySkill.get(a)! || missed(b) - missed(a) || rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, SAT_LIMITS.reviewsDueSkills);
  return {
    answered: input.attempts.length,
    correct,
    by_domain: SAT_DOMAINS.map((d) => ({ domain: d, ...domains.get(d)! })),
    by_skill: order.filter((s) => skills.has(s)).map((s) => ({ domain: skills.get(s)!.domain, skill: s, answered: skills.get(s)!.answered, correct: skills.get(s)!.correct })),
    streak_days: streak,
    today: { answered: todayAnswered, correct: todayCorrect, tutor_used: input.tutorUsedToday, cap: input.cap, unlimited: input.unlimited },
    estimate: estimateBand(input.attempts.filter((a) => a.meta).map((a) => ({ difficulty: a.meta!.difficulty, correct: a.correct }))),
    ...countReviews(input.reviews ?? [], today),
    reviews_due_skills: dueSkills,
  };
}
