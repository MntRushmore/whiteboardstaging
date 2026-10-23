import { SAT_LIMITS } from "@/lib/sat/contracts";

/**
 * The rough math-section band GET /api/sat/progress shows (docs/SAT-MODE.md, "estimate"). It is a
 * guess from practice, said as one: a 200–800 band, never a single number and never called a score.
 *
 * The model, kept simple on purpose (our difficulty labels are the bank's own 1/2/3, not
 * calibrated against real test takers, so anything finer would claim more than we know):
 *
 *  1. Each answer is a Rasch (one-parameter logistic) item: P(right) = 1 / (1 + e^−(θ − b)), with
 *     b = −1, 0, +1 for difficulty 1, 2, 3. Harder questions answered right count for more.
 *  2. θ, the student's ability on that logit scale, is the maximum a posteriori estimate under a
 *     standard normal prior (Newton's method), from the newest SAT_LIMITS.estimateWindow answers,
 *     so the band follows what the student can do now.
 *  3. Its standard error is 1 / √(information + 1), information = Σ p(1 − p) at θ.
 *  4. Centre = 500 + 120·θ. Half-width = 120·SE + 20 (the 20 because practice here is not the test:
 *     no timing, no adaptive modules, our own questions). Near either end the centre moves in so the
 *     whole band fits 200..800. Low is rounded down and high up to a multiple of 10.
 *  5. Fewer than SAT_LIMITS.estimateMinAnswered (15) answers: null, no band at all.
 *
 * With 15 answers the band is about 150 points wide, and about 90 at 120 answers (the window), its
 * narrowest: it narrows as the student answers more.
 */

export const ESTIMATE_NOTE = "A rough estimate from practice questions, not an SAT score.";

const B = { 1: -1, 2: 0, 3: 1 } as const;
const SCALE = 120;
const PRACTICE_SLACK = 20;

export type EstimateAnswer = { difficulty: number; correct: boolean };

/** MAP ability and its standard error, from answers (any order). */
export function abilityOf(answers: readonly EstimateAnswer[]): { theta: number; se: number } {
  const items = answers.map((a) => ({ b: B[Math.min(3, Math.max(1, Math.round(a.difficulty))) as 1 | 2 | 3], y: a.correct ? 1 : 0 }));
  let theta = 0;
  for (let i = 0; i < 50; i++) {
    let grad = -theta; // the N(0, 1) prior
    let info = 1;
    for (const it of items) {
      const p = 1 / (1 + Math.exp(-(theta - it.b)));
      grad += it.y - p;
      info += p * (1 - p);
    }
    const step = grad / info;
    theta += Math.max(-1, Math.min(1, step));
    if (Math.abs(step) < 1e-6) break;
  }
  let info = 1;
  for (const it of items) {
    const p = 1 / (1 + Math.exp(-(theta - it.b)));
    info += p * (1 - p);
  }
  return { theta, se: 1 / Math.sqrt(info) };
}

/**
 * The band from a student's answers, NEWEST FIRST (only the newest estimateWindow are read), or
 * null below estimateMinAnswered.
 */
export function estimateBand(newestFirst: readonly EstimateAnswer[]): { low: number; high: number; note: string } | null {
  if (newestFirst.length < SAT_LIMITS.estimateMinAnswered) return null;
  const { theta, se } = abilityOf(newestFirst.slice(0, SAT_LIMITS.estimateWindow));
  const half = SCALE * se + PRACTICE_SLACK;
  // near either end the band keeps its width inside the scale (an all-right student is "about
  // 690-800", never the single point 800)
  const centre = Math.min(800 - half, Math.max(200 + half, 500 + SCALE * theta));
  const clamp = (n: number) => Math.min(800, Math.max(200, n));
  return { low: clamp(Math.floor((centre - half) / 10) * 10), high: clamp(Math.ceil((centre + half) / 10) * 10), note: ESTIMATE_NOTE };
}
