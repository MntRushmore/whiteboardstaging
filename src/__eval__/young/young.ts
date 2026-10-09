/**
 * The young kids' scoreboard: every column of `corpus.ts` marked as the board marks it — each line
 * judged in its column (`judgeColumn`, the rules `LiveLoop.analyze` runs), its tick, ring or "?" as
 * the policy draws it in Feedback with Auto on, once the child has stopped (`decide`,
 * `unjudgedReason`), and the problem solved when a line ticked is its answer (`LiveLoop.learnLine`).
 * Free and deterministic: LaTeX in, no ink, no Mathpix.
 *
 * A column passes when every line gets the mark a teacher gives it and it ends solved exactly when
 * it should. The worst miss is a WRONG RING — a ring on a line a teacher would tick or let be: that
 * is the tutor marking a child wrong for right work.
 */
import type { LineAnalysis, LiveEngine } from "@/lib/live/contracts";
import { judgeColumn } from "@/lib/live/engine/columnWork";
import { decide, unjudgedReason } from "@/lib/live/policy";
import { YOUNG_CORPUS, YOUNG_GRADES, YOUNG_TOPICS, type YoungCase, type YoungGrade, type YoungMark, type YoungTopic } from "./corpus";

export type BoardMark = "tick" | "ring" | "none" | "?";

export interface YoungLineVerdict {
  latex: string;
  expected: YoungMark;
  got: BoardMark;
  pass: boolean;
}

export interface YoungVerdict {
  id: string;
  grade: YoungGrade;
  topic: YoungTopic;
  problem: string | null;
  lines: YoungLineVerdict[];
  solved: { expected: boolean; got: boolean };
  pass: boolean;
  note?: string;
}

export interface YoungCounts {
  total: number;
  passed: number;
  lines: number;
  linesRight: number;
  /** rings on lines a teacher ticks or lets be: right work marked wrong */
  wrongRings: number;
  /** wrong lines left without a ring */
  missedRings: number;
  /** "?" on a child's working */
  questions: number;
  /** columns counted solved that are not */
  falseSolved: number;
  /** columns answered right and not counted solved */
  missedSolved: number;
}

export interface YoungSummary extends YoungCounts {
  byGrade: Array<{ grade: YoungGrade } & YoungCounts>;
  byTopic: Array<{ topic: YoungTopic } & YoungCounts>;
}

export interface YoungScoreboard {
  verdicts: YoungVerdict[];
  summary: YoungSummary;
}

/** The mark the board draws for a line (`LiveLoop.render` in Feedback, Auto on, settled). */
export function boardMark(analysis: LineAnalysis | null, latex: string, underProblem: boolean): BoardMark {
  const decision = decide({
    mode: "feedback",
    analysis,
    latex,
    confidence: 1,
    settled: true,
    auto: true,
    userAsked: false,
    hintsShownForLine: 0,
    openHintCount: 0,
    rewritesWithWarn: 0,
    liveShapeCount: 0,
  });
  if (decision.badge === "ok" || decision.badge === "solved") return "tick";
  if (decision.badge === "warn") return "ring";
  // a line under one of the tutor's problems that the tutor cannot judge gets its "?" (`questionFor`)
  if (underProblem && unjudgedReason({ latex, confidence: 1, provider: "mathpix", analysis }) !== null) return "?";
  return "none";
}

function matches(expected: YoungMark, got: BoardMark): boolean {
  return expected === "calm" ? got === "tick" || got === "none" : expected === got;
}

/** One column marked and scored. */
export function judgeYoungCase(engine: LiveEngine, c: YoungCase): YoungVerdict {
  const latex = c.work.map(([l]) => l);
  const analyses = judgeColumn(engine, { problem: c.problem ? [c.problem] : [], lines: latex }, "feedback");
  const lines = c.work.map(([l, expected], i): YoungLineVerdict => {
    const got = boardMark(analyses[i] ?? null, l, Boolean(c.problem));
    return { latex: l, expected, got, pass: matches(expected, got) };
  });
  const solved = analyses.some((a, i) => Boolean(a?.solved) && lines[i].got === "tick");
  const pass = lines.every((l) => l.pass) && solved === c.solved;
  return { id: c.id, grade: c.grade, topic: c.topic, problem: c.problem ?? null, lines, solved: { expected: c.solved, got: solved }, pass, ...(c.note ? { note: c.note } : {}) };
}

function counts(verdicts: readonly YoungVerdict[]): YoungCounts {
  const lines = verdicts.flatMap((v) => v.lines);
  return {
    total: verdicts.length,
    passed: verdicts.filter((v) => v.pass).length,
    lines: lines.length,
    linesRight: lines.filter((l) => l.pass).length,
    wrongRings: lines.filter((l) => l.got === "ring" && l.expected !== "ring").length,
    missedRings: lines.filter((l) => l.expected === "ring" && l.got !== "ring").length,
    questions: lines.filter((l) => l.got === "?" && l.expected !== "?").length,
    falseSolved: verdicts.filter((v) => v.solved.got && !v.solved.expected).length,
    missedSolved: verdicts.filter((v) => !v.solved.got && v.solved.expected).length,
  };
}

export function summarizeYoung(verdicts: readonly YoungVerdict[]): YoungSummary {
  return {
    ...counts(verdicts),
    byGrade: YOUNG_GRADES.map((grade) => ({ grade, ...counts(verdicts.filter((v) => v.grade === grade)) })).filter((g) => g.total > 0),
    byTopic: YOUNG_TOPICS.map((topic) => ({ topic, ...counts(verdicts.filter((v) => v.topic === topic)) })).filter((t) => t.total > 0),
  };
}

export function runYoungEval(engine: LiveEngine, cases: readonly YoungCase[] = YOUNG_CORPUS): YoungScoreboard {
  const verdicts = cases.map((c) => judgeYoungCase(engine, c));
  return { verdicts, summary: summarizeYoung(verdicts) };
}

/** One line for a terminal: `young: 60/120 columns (50.0%) · lines 200/260 · wrong rings 12 · …`. */
export function youngSummaryLine(s: YoungCounts): string {
  const pct = s.total === 0 ? 0 : (100 * s.passed) / s.total;
  return `young: ${s.passed}/${s.total} columns (${pct.toFixed(1)}%) · lines ${s.linesRight}/${s.lines} · wrong rings ${s.wrongRings} · missed rings ${s.missedRings} · ? ${s.questions} · false solved ${s.falseSolved} · missed solved ${s.missedSolved}`;
}
