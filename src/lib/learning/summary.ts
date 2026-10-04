/**
 * STUB (owner: agent "brain"). Mastery and the Progress page's numbers from the learning record.
 * Exports are frozen by the contract; the bodies are replaced by their owner.
 */
import type { CourseId } from "@/lib/onboarding/courseIds";
import type { AttemptRecord, LearningSummary } from "./contracts";
import type { LearnerHint } from "./hint";

export interface SummarizeOptions {
  /** the student's course: its skills are listed (level `new`) before they are practised */
  course?: CourseId | null;
  /** the student's time zone offset in minutes (Date#getTimezoneOffset), for local days; default 0 */
  tzOffsetMinutes?: number;
}

/** Everything the Progress page shows, from the student's attempts. Pure. */
export function summarize(attempts: readonly AttemptRecord[], now: number, opts: SummarizeOptions = {}): LearningSummary {
  void attempts;
  void now;
  void opts;
  return {
    totals: { problems: 0, independent: 0, withHelp: 0, tutorSolved: 0, activeMs: 0, lines: 0, linesRight: 0 },
    days: [],
    streakDays: 0,
    skills: [],
    weakSkills: [],
    strongSkills: [],
    mistakes: [],
    recent: [],
  };
}

/** What the tutor is told about the student (`LearnerHint`), from a summary. Undefined when there is nothing to say. */
export function learnerHint(summary: LearningSummary): LearnerHint | undefined {
  void summary;
  return undefined;
}
