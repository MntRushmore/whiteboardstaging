/** learning_attempts rows as the console shows them (`AdminAttempt`). */
import { ATTEMPT_OUTCOMES, type AdminAttempt } from "@/lib/admin/contracts";
import { INDEPENDENT_OUTCOMES } from "@/lib/learning/contracts";

export const ATTEMPT_SELECT = "id,board_id,problem_latex,skill,outcome,hints,solves,lines_ringed,active_ms,started_at,finished_at";

export interface AttemptRow {
  id: string;
  board_id: string | null;
  problem_latex: string | null;
  skill: string | null;
  outcome: string;
  hints: number | null;
  solves: number | null;
  lines_ringed: number | null;
  active_ms: number | null;
  started_at: string;
  finished_at: string | null;
}

type Outcome = (typeof ATTEMPT_OUTCOMES)[number];

/** Solved alone: first try or self-corrected (INDEPENDENT_OUTCOMES). */
export function solvedAlone(outcome: string): boolean {
  return (INDEPENDENT_OUTCOMES as readonly string[]).includes(outcome);
}

const whole = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0);

export function toAdminAttempt(row: AttemptRow): AdminAttempt {
  return {
    id: row.id,
    boardId: row.board_id ?? null,
    problemLatex: row.problem_latex ?? "",
    skill: row.skill ?? "",
    // the table's check holds the outcome to the list; an unknown one would be a newer database
    outcome: ((ATTEMPT_OUTCOMES as readonly string[]).includes(row.outcome) ? row.outcome : "unfinished") as Outcome,
    hints: whole(row.hints),
    solves: whole(row.solves),
    linesRinged: whole(row.lines_ringed),
    activeMs: whole(row.active_ms),
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? null,
  };
}
