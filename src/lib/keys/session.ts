/**
 * One problem's life on the page, and the set of five (docs/KEYS.md):
 *
 *   working ──Enter in the answer row / Ctrl+Enter──► (check) ──right──► done
 *      ▲                                                 │
 *      │ the kid types in a checked line                 ▼ a line broke
 *      └──────────────────────────────────────────── look_again ──Help me──► helping
 *                                                                              │ nudge: the kid fixes it
 *                                                                              │ smaller: solved, its answer goes
 *                                                                              ▼ back up, the big problem is checked again
 *
 * Checking is instant (no reads to wait for), so it has no phase of its own. Pure reducers: the page
 * holds the state, the tests drive the same actions.
 */
import type { Outcome } from "@/lib/learning/contracts";
import { matchBug, type BugId } from "./bugs";
import { ANSWER_LINE, check, stepLine, type CheckResult, type Mark } from "./check";
import { nudgeFor } from "./copy";
import { answerCells, answerFromWork, lineOfCell, patchAnswer, type MathItem, type Values } from "./item";
import { shrink, type SubStep } from "./shrink";
import { carryBack, pushStep, root, rootStack, setValue, top, type Stack } from "./stack";

export type Phase = "working" | "look_again" | "helping" | "done";

/** The tutor's help on the page: a nudge line under the work, or a smaller problem (on the stack). */
export type Help = { kind: "nudge"; text: string; under: string } | { kind: "smaller" };

/** A smaller problem the kid solved, kept on the page with its tick. */
export interface SolvedStep {
  step: SubStep;
  values: Values;
  value: string;
}

/** How a problem ended, for the stars: the learning record's own outcomes. */
export type KeysOutcome = Extract<Outcome, "first_try" | "self_corrected" | "with_help">;

export interface ProblemState {
  item: MathItem;
  stack: Stack;
  answer: string;
  /** the answer row shows the work's answer (Enter from the column) and follows it until the kid types in the row */
  answerFromWork: boolean;
  /** the typed steps under the work (at least one line) */
  steps: string[];
  phase: Phase;
  /** the latest check of the big problem */
  result: CheckResult | null;
  /** marks on the page now (a line's mark comes off when the kid types in it) */
  marks: Record<string, Mark>;
  /** cells ringed now */
  ringed: string[];
  bug: BugId | null;
  help: Help | null;
  /** the smaller problem's own mark */
  subMark: Mark | null;
  solvedSteps: SolvedStep[];
  /** a value the tutor just carried back up (the page shows it arriving) */
  carried: { cellId: string; value: string } | null;
  notice: "write_first" | null;
  /** looks: checks that found a line that broke; helps: Help me's that gave help */
  counts: { checks: number; looks: number; helps: number };
}

export type ProblemAction =
  | { type: "cell"; id: string; value: string }
  | { type: "answer"; value: string }
  /** Enter in the work: the answer row takes the work's answer, when it has one and the row is empty */
  | { type: "fill_answer" }
  | { type: "step"; index: number; value: string }
  | { type: "add_step"; after: number }
  | { type: "remove_step"; index: number }
  | { type: "check" }
  | { type: "help" }
  | { type: "sub_cell"; id: string; value: string }
  | { type: "sub_check" };

export function startProblem(item: MathItem): ProblemState {
  return {
    item,
    stack: rootStack(item),
    answer: "",
    answerFromWork: false,
    steps: [""],
    phase: "working",
    result: null,
    marks: {},
    ringed: [],
    bug: null,
    help: null,
    subMark: null,
    solvedSteps: [],
    carried: null,
    notice: null,
    counts: { checks: 0, looks: 0, helps: 0 },
  };
}

export function rootValues(s: ProblemState): Values {
  return root(s.stack).values;
}

/** The smaller problem on the page, if one is open. */
export function openStep(s: ProblemState): { step: SubStep; values: Values } | null {
  const t = top(s.stack);
  return s.stack.length > 1 && t.step ? { step: t.step, values: t.values } : null;
}

export function outcomeOf(s: ProblemState): KeysOutcome | null {
  if (s.phase !== "done") return null;
  if (s.counts.helps > 0) return "with_help";
  return s.counts.looks > 0 ? "self_corrected" : "first_try";
}

/** A line was typed in: its mark comes off, and a "Look again." waits for the next check. */
function touched(s: ProblemState, line: string | null, cellId?: string): ProblemState {
  const marks = { ...s.marks };
  if (line) delete marks[line];
  return {
    ...s,
    marks,
    ringed: cellId ? s.ringed.filter((c) => c !== cellId) : s.ringed,
    phase: s.phase === "look_again" ? "working" : s.phase,
    notice: null,
    carried: null,
  };
}

function dropStepMarks(marks: Record<string, Mark>): Record<string, Mark> {
  return Object.fromEntries(Object.entries(marks).filter(([k]) => !k.startsWith("step:")));
}

/** Checks the big problem and moves to done or look_again. */
function runCheck(s: ProblemState): ProblemState {
  const values = rootValues(s);
  const result = check(s.item, { values, answer: s.answer, steps: s.steps });
  if (!result.ready) return { ...s, notice: "write_first" };
  const counts = { ...s.counts, checks: s.counts.checks + 1 };
  const typed = s.answer.trim() !== "";
  const answer = typed ? s.answer : result.answer;
  const mirrored = typed ? s.answerFromWork : true;
  if (result.ok) {
    // Fixed by hand while a smaller problem was open: it comes off the page.
    const stack = s.stack.length > 1 ? s.stack.slice(0, 1) : s.stack;
    return { ...s, stack, answer, answerFromWork: mirrored, result, marks: result.marks, ringed: [], bug: null, help: null, phase: "done", notice: null, counts };
  }
  const fromWork = answerFromWork(s.item, values);
  const bug = matchBug(s.item, fromWork ?? result.answer);
  return {
    ...s,
    answer,
    answerFromWork: mirrored,
    result,
    marks: result.marks,
    ringed: result.wrongCells,
    bug,
    // a nudge is for the slip it was written for; a smaller problem stays until it is solved
    help: s.help?.kind === "smaller" ? s.help : null,
    phase: s.help?.kind === "smaller" ? "helping" : "look_again",
    notice: null,
    counts: { ...counts, looks: result.firstBadLine ? counts.looks + 1 : counts.looks },
  };
}

function giveHelp(s: ProblemState): ProblemState {
  const counts = { ...s.counts, helps: s.counts.helps + 1 };
  const cell = answerCells(s.item).find((c) => s.ringed.includes(c.id));
  const step = s.bug ? shrink(s.item, s.bug, cell?.id) : null;
  if (step) {
    return { ...s, stack: pushStep(s.stack, step), help: { kind: "smaller" }, subMark: null, phase: "helping", counts };
  }
  const under = s.result?.firstBadLine ?? lineOfCell(s.item, answerCells(s.item)[0]?.id ?? "") ?? ANSWER_LINE;
  return { ...s, help: { kind: "nudge", text: nudgeFor(s.item, s.bug), under }, phase: "helping", counts };
}

export function problemReducer(s: ProblemState, a: ProblemAction): ProblemState {
  if (s.phase === "done" && a.type !== "check") return s;
  switch (a.type) {
    case "cell": {
      const stack = setValue(s.stack, a.id, a.value, 0);
      const next = { ...touched(s, lineOfCell(s.item, a.id), a.id), stack };
      if (!s.answerFromWork) return next;
      // the answer row follows the work it was filled from
      const marks = { ...next.marks };
      delete marks[ANSWER_LINE];
      return { ...next, marks, answer: answerFromWork(s.item, root(stack).values) ?? "" };
    }
    case "answer":
      return { ...touched(s, ANSWER_LINE), answer: a.value, answerFromWork: false };
    case "fill_answer": {
      const fromWork = answerFromWork(s.item, rootValues(s));
      if (!fromWork || (s.answer.trim() && !s.answerFromWork)) return s;
      return { ...touched(s, ANSWER_LINE), answer: fromWork, answerFromWork: true };
    }
    case "step": {
      const steps = s.steps.map((t, i) => (i === a.index ? a.value : t));
      return { ...touched(s, stepLine(a.index)), steps };
    }
    case "add_step": {
      const steps = [...s.steps.slice(0, a.after + 1), "", ...s.steps.slice(a.after + 1)];
      return { ...s, steps, marks: dropStepMarks(s.marks) };
    }
    case "remove_step": {
      if (s.steps.length <= 1) return s;
      return { ...s, steps: s.steps.filter((_, i) => i !== a.index), marks: dropStepMarks(s.marks) };
    }
    case "check":
      return s.phase === "done" ? s : runCheck(s);
    case "help": {
      if (openStep(s)) return s;
      // Help me checks first, as on the iPad; a right answer needs no help.
      const checked = s.phase === "working" || !s.result ? runCheck(s) : s;
      if (checked.phase === "done") return checked;
      return giveHelp({ ...checked, notice: null });
    }
    case "sub_cell":
      return openStep(s) ? { ...s, stack: setValue(s.stack, a.id, a.value), subMark: null, notice: null } : s;
    case "sub_check": {
      const open = openStep(s);
      if (!open) return s;
      const sub = check(open.step.item, { values: open.values, answer: "" });
      if (!sub.ready) return { ...s, notice: "write_first" };
      const back = carryBack(s.stack);
      if (!back) return { ...s, subMark: "ring", notice: null };
      const values = root(back.stack).values;
      const fromWork = answerFromWork(s.item, values);
      const answer = !s.answer.trim() ? s.answer : s.answerFromWork ? (fromWork ?? "") : patchAnswer(s.item, s.answer, back.place, back.value);
      const next: ProblemState = {
        ...s,
        stack: back.stack,
        answer,
        help: null,
        subMark: null,
        solvedSteps: [...s.solvedSteps, { ...back.solved, value: back.value }],
        carried: { cellId: back.cellId, value: back.value },
      };
      const rechecked = runCheck(next);
      return { ...rechecked, carried: next.carried };
    }
  }
}

// ---------------------------------------------------------------- the set

export interface SetState {
  items: MathItem[];
  index: number;
  problem: ProblemState;
  /** how each problem ended (null: not yet) */
  outcomes: (KeysOutcome | null)[];
  finished: boolean;
}

export type SetAction = ProblemAction | { type: "next" } | { type: "restart"; items: MathItem[] };

export function startSet(items: MathItem[]): SetState {
  if (!items.length) throw new Error("startSet: no problems");
  return { items, index: 0, problem: startProblem(items[0]), outcomes: items.map(() => null), finished: false };
}

/** Problems solved so far: the stars pill. */
export function starsOf(s: SetState): number {
  return s.outcomes.filter((o) => o !== null).length;
}

/** Solved without help (a star sticker; with help is a ring). */
export function ownOf(s: SetState): number {
  return s.outcomes.filter((o) => o === "first_try" || o === "self_corrected").length;
}

export function setReducer(s: SetState, a: SetAction): SetState {
  switch (a.type) {
    case "restart":
      return startSet(a.items);
    case "next": {
      if (s.problem.phase !== "done") return s;
      const index = s.index + 1;
      if (index >= s.items.length) return { ...s, finished: true };
      return { ...s, index, problem: startProblem(s.items[index]) };
    }
    default: {
      if (s.finished) return s;
      const problem = problemReducer(s.problem, a);
      if (problem === s.problem) return s;
      const outcome = outcomeOf(problem);
      const outcomes = outcome && !s.outcomes[s.index] ? s.outcomes.map((o, i) => (i === s.index ? outcome : o)) : s.outcomes;
      return { ...s, problem, outcomes };
    }
  }
}
