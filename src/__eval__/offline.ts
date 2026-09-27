/**
 * OFFLINE scoreboard: every corpus problem's LaTeX straight into `localSolve` (exactly what
 * Solve does on the board, minus the pen and Mathpix), then `judge`. Free, fast, deterministic.
 *
 *   npm run eval:offline          runs it and writes docs/eval/offline.{md,json}
 *   runOfflineEval() / summarize() for a script that wants the numbers
 */
import type { LiveEngine } from "@/lib/live/contracts";
import { getEngine } from "@/lib/live/engine";
import { planHandwriting } from "@/lib/live/handwriting";
import { localSolve } from "@/lib/live/localSolve";
import { CORPUS, TOPICS, type EvalProblem, type Topic } from "./corpus";
import { ANSWER_STATUSES, judge, STAGES, type AnswerStatus, type Stage, type Verdict } from "./judge";

/** The board's hand for a worked block is 18–40 px; the interlock does not depend on size. */
const HAND = { size: 28, seed: 1 } as const;

/** What the tutor's hand cannot draw in these steps ([] = all drawable). */
export function unsupportedFor(steps: readonly string[]): string[] {
  if (steps.length === 0) return [];
  const r = planHandwriting(steps, HAND);
  if (r.unsupported.length > 0) return r.unsupported;
  return r.plan ? [] : ["(no ink)"];
}

/** `drawStepsByHand`'s interlock, for `localSolve`'s `canDraw`. */
export const canDraw = (steps: readonly string[]): boolean => unsupportedFor(steps).length === 0;

/** Solve on these lines (the problem's own by default), judged against the problem. */
export function solveAndJudge(engine: LiveEngine, problem: EvalProblem, lines: readonly string[] = problem.lines): Verdict {
  const result = localSolve(engine, lines, undefined, { canDraw });
  return judge(problem, lines, result, { unsupported: unsupportedFor });
}

export interface StageCounts {
  total: number;
  passed: number;
  /** problems passing each stage (over all problems) */
  stages: Record<Stage, number>;
}

export interface Summary extends StageCounts {
  answers: Record<AnswerStatus, number>;
  byTopic: Array<{ topic: Topic } & StageCounts>;
}

function counts(verdicts: readonly Verdict[]): StageCounts {
  const stages = Object.fromEntries(STAGES.map((s) => [s, verdicts.filter((v) => v.stages[s]).length])) as Record<Stage, number>;
  return { total: verdicts.length, passed: verdicts.filter((v) => v.pass).length, stages };
}

export function summarize(verdicts: readonly Verdict[]): Summary {
  const answers = Object.fromEntries(ANSWER_STATUSES.map((s) => [s, verdicts.filter((v) => v.answer.status === s).length])) as Record<AnswerStatus, number>;
  const byTopic = TOPICS.map((topic) => ({ topic, ...counts(verdicts.filter((v) => v.topic === topic)) })).filter((t) => t.total > 0);
  return { ...counts(verdicts), answers, byTopic };
}

export interface OfflineScoreboard {
  verdicts: Verdict[];
  summary: Summary;
}

export async function runOfflineEval(engine?: LiveEngine, problems: readonly EvalProblem[] = CORPUS): Promise<OfflineScoreboard> {
  const e = engine ?? (await getEngine());
  const verdicts = problems.map((p) => solveAndJudge(e, p));
  return { verdicts, summary: summarize(verdicts) };
}

/** One line for a terminal: `offline: 61/157 pass (38.9%) · local 120 · answer 80 · …`. */
export function summaryLine(label: string, s: StageCounts): string {
  const pct = s.total === 0 ? 0 : (100 * s.passed) / s.total;
  return `${label}: ${s.passed}/${s.total} pass (${pct.toFixed(1)}%) · ${STAGES.map((st) => `${st} ${s.stages[st]}`).join(" · ")}`;
}
