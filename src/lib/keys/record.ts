/**
 * Keys in the learning record (docs/KEYS.md, Phase 2): one `AttemptRecord` per problem, origin `keys`,
 * built from the problem's state on the page, so Progress, the parents' view, mastery, Today's
 * practice and the tutor's learner hint all see Keys work like board work.
 *
 * The record's rules are the learning system's own (`contracts.ts`): the outcome is `outcomeOf` over
 * the counts (a nudge is a hint, a smaller problem or a worked step a tutor step, so either makes it
 * `with_help`; a ring fixed alone is `self_corrected`), counts are per distinct line, mistakes are by
 * kind. Each bug names its kind (`BugRule.mistake`); a slip no rule names counts as `arithmetic` (a
 * number slip), once per problem.
 *
 * Pure: time comes in (`KeysClock`), ids come in. The page saves with `store.saveAttempts`.
 */
import { LEARNING_LIMITS, outcomeOf as recordOutcome, type AttemptCounts, type AttemptRecord, type Outcome } from "@/lib/learning/contracts";
import type { CourseId } from "@/lib/onboarding/courseIds";
import type { MistakeKind } from "@/lib/learning/hint";
import { bugRule } from "./bugs";
import { ANSWER_LINE } from "./check";
import { kidCells, lineOfCell, type MathItem } from "./item";
import { rootValues, type ProblemState } from "./session";

/** The time a problem was worked: the gaps between the kid's actions, each capped as the board caps them. */
export interface KeysClock {
  startedAt: number;
  lastAt: number;
  activeMs: number;
}

export function startClock(now: number): KeysClock {
  return { startedAt: now, lastAt: now, activeMs: 0 };
}

/** One more action at `now`: its gap counts, at most `maxGapMs` (a break is not work). */
export function tickClock(clock: KeysClock, now: number): KeysClock {
  const gap = Math.max(0, now - clock.lastAt);
  return { ...clock, lastAt: Math.max(clock.lastAt, now), activeMs: Math.min(LEARNING_LIMITS.maxActiveMs, clock.activeMs + Math.min(gap, LEARNING_LIMITS.maxGapMs)) };
}

/** The problem as LaTeX for the record (`26 + \square 6 = 92`): what Progress and the summary read. */
export function latexOf(item: MathItem): string {
  return item.text
    .replace(/\?/g, "\\square ")
    .replace(/×/g, "\\times ")
    .replace(/÷/g, "\\div ")
    .replace(/−/g, "-")
    .replace(/(\d+)\/(\d+)/g, "\\frac{$1}{$2}")
    .replace(/\s+/g, " ")
    .trim();
}

/** The lines the kid wrote in: column lines with a filled cell, typed steps, the answer row. */
function linesWritten(p: ProblemState): string[] {
  const values = rootValues(p);
  const lines = new Set<string>();
  for (const c of kidCells(p.item)) {
    if ((values[c.id] ?? "").trim()) {
      const l = lineOfCell(p.item, c.id);
      if (l) lines.add(l);
    }
  }
  p.steps.forEach((t, i) => {
    if (t.trim()) lines.add(`step:${i}`);
  });
  if (p.answer.trim()) lines.add(ANSWER_LINE);
  // a smaller problem the kid answered is a line of their work too
  p.solvedSteps.forEach((_, i) => lines.add(`sub:${i}`));
  return [...lines];
}

/** The learning record's counts for this problem. */
export function countsOf(p: ProblemState): AttemptCounts {
  const written = linesWritten(p);
  const ringed = new Set(p.history.ringedLines);
  const right = Object.entries(p.marks).filter(([, m]) => m === "tick").length + p.solvedSteps.length;
  return {
    linesWritten: Math.max(written.length, ringed.size),
    linesRight: right,
    linesRinged: ringed.size,
    hints: p.history.nudges,
    tutorSteps: p.history.smaller + p.history.worked,
    solves: 0,
    asks: p.counts.helps,
  };
}

/** Mistakes by kind: each named bug's kind once, and a slip no rule names as a number slip. */
export function mistakesOf(p: ProblemState): Partial<Record<MistakeKind, number>> {
  const out: Partial<Record<MistakeKind, number>> = {};
  const seen = new Set<string>();
  for (const bug of p.history.slips) {
    const key = bug ?? "none";
    if (seen.has(key)) continue;
    seen.add(key);
    const kind: MistakeKind = bug ? bugRule(bug).mistake : "arithmetic";
    out[kind] = (out[kind] ?? 0) + 1;
  }
  return out;
}

/** Did the kid do anything worth recording: a check, or a Help me. Untouched problems are never recorded. */
export function recordable(p: ProblemState): boolean {
  return p.counts.checks > 0 || p.counts.helps > 0;
}

export interface RecordMeta {
  id: string;
  course: CourseId | null;
  /** for a Now you try: the attempt it follows */
  parentId: string | null;
  clock: KeysClock;
  /** the page left the problem (another problem, the page closed): an unanswered one is unfinished */
  closed: boolean;
}

export function keysRecord(p: ProblemState, meta: RecordMeta): AttemptRecord {
  const counts = countsOf(p);
  const solved = p.phase === "done";
  const outcome: Outcome = recordOutcome(counts, solved, false, meta.closed);
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    id: meta.id,
    boardId: null,
    problemLatex: latexOf(p.item).slice(0, LEARNING_LIMITS.problemLatex),
    skill: p.item.skill,
    course: meta.course,
    origin: "keys",
    parentId: meta.parentId,
    outcome,
    mistakes: mistakesOf(p),
    activeMs: Math.round(meta.clock.activeMs),
    startedAt: iso(meta.clock.startedAt),
    updatedAt: iso(meta.clock.lastAt),
    finishedAt: outcome === "in_progress" ? null : iso(meta.clock.lastAt),
    ...counts,
  };
}
