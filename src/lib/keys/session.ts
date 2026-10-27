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
import { nudgeFor, workedFor } from "./copy";
import { answerCells, answerFromWork, cellById, lineOfCell, patchAnswer, type MathItem, type Values } from "./item";
import { shrink, type SubStep } from "./shrink";
import { carryBack, pushStep, root, rootStack, setValue, top, type Stack } from "./stack";

export type Phase = "working" | "look_again" | "helping" | "done";

/**
 * Where a nudge points (Help me's first rung): the column of the place that broke, in cobalt, or the
 * line itself when there is no column (a typed step, the answer row).
 */
export interface Pointer {
  line: string;
  place: number | null;
}

/**
 * The tutor's help on the page, one rung of the ladder at a time (docs/KEYS.md, "Help me"):
 * 1 a nudge (a line under the work, pointing at the column), 2 a smaller problem (on the stack),
 * 3 a worked step in the tutor's hand. `text` is the fixed copy; the page may say it in other words
 * (`/api/keys/say`), never other facts.
 */
export type Help =
  | { kind: "nudge"; text: string; under: string; point: Pointer }
  | { kind: "smaller" }
  | { kind: "worked"; text: string; under: string; point: Pointer };

/** A rung of the ladder: 1 nudge, 2 smaller, 3 worked. */
export type HelpLevel = 0 | 1 | 2 | 3;

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
  /** the rung of the ladder given for the slip on the page now (a new slip starts again at 0) */
  helpLevel: HelpLevel;
  /** the slip the ladder is about: its bug and line, so a different slip starts a new ladder */
  helpFor: string | null;
  /** what happened, for the learning record (`record.ts`) */
  history: History;
}

/** Everything the learning record counts that the marks on the page no longer show. */
export interface History {
  /** every line ever ringed */
  ringedLines: string[];
  /** the bug of each check that found a slip (null: none named) */
  slips: (BugId | null)[];
  nudges: number;
  smaller: number;
  worked: number;
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
  | { type: "sub_check" }
  /** the tutor's hint from the check endpoint, for a slip no bug rule names (it replaces the nudge's words) */
  | { type: "hint_text"; text: string };

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
    helpLevel: 0,
    helpFor: null,
    history: { ringedLines: [], slips: [], nudges: 0, smaller: 0, worked: 0 },
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
  const ringedNow = Object.entries(result.marks)
    .filter(([, m]) => m === "ring")
    .map(([l]) => l);
  const history: History = {
    ...s.history,
    ringedLines: [...new Set([...s.history.ringedLines, ...ringedNow])],
    slips: result.firstBadLine ? [...s.history.slips, bug] : s.history.slips,
  };
  // the ladder is about one slip: a different one (another bug or line) starts it again
  const helpFor = result.firstBadLine ? `${bug ?? "none"}@${result.firstBadLine}` : s.helpFor;
  const fresh = helpFor !== s.helpFor && s.help?.kind !== "smaller";
  return {
    ...s,
    history,
    helpFor,
    helpLevel: fresh ? 0 : s.helpLevel,
    answer,
    answerFromWork: mirrored,
    result,
    marks: result.marks,
    ringed: result.wrongCells,
    bug,
    // a nudge (or a worked step) is for the slip it was written for; a smaller problem stays until it is solved
    help: s.help?.kind === "smaller" ? s.help : null,
    phase: s.help?.kind === "smaller" ? "helping" : "look_again",
    notice: null,
    counts: { ...counts, looks: result.firstBadLine ? counts.looks + 1 : counts.looks },
  };
}

/**
 * Where the help points: the column of the lowest place that broke; with nothing ringed yet (Help me
 * before any work), the ones column of the answer; else the first line that broke.
 */
function pointerOf(s: ProblemState): Pointer {
  const columns = s.item.layout.kind === "columns";
  const ringedCells = s.ringed.map((id) => cellById(s.item, id)).filter((c) => c !== undefined);
  const cell = ringedCells.sort((p, q) => p.place - q.place)[0];
  if (columns && cell) return { line: lineOfCell(s.item, cell.id) ?? ANSWER_LINE, place: cell.place };
  const work = answerCells(s.item).sort((p, q) => p.place - q.place)[0];
  const workLine = work ? lineOfCell(s.item, work.id) : null;
  const line = s.result?.firstBadLine ?? workLine ?? ANSWER_LINE;
  return { line, place: columns && work && line === workLine && !s.result?.firstBadLine ? work.place : null };
}

/** The cell the ladder is about: the first answer cell that broke, else the first that broke. */
function brokenCell(s: ProblemState): string | undefined {
  return answerCells(s.item).find((c) => s.ringed.includes(c.id))?.id ?? s.ringed[0];
}

/**
 * One rung up the ladder for the slip on the page: 1 a nudge, 2 the smaller problem (or, when this
 * bug has none, the worked step), 3 the worked step. At the top, Help me does nothing more: the kid
 * has everything the tutor can give short of the answer box itself.
 */
function giveHelp(s: ProblemState): ProblemState {
  const open = openStep(s) !== null;
  const shown = s.help?.kind === "worked";
  if (s.helpLevel >= 3 || (shown && !open)) return s;
  const level = (s.helpLevel + 1) as HelpLevel;
  const counts = { ...s.counts, helps: s.counts.helps + 1 };
  const point = pointerOf(s);
  const under = point.line;
  const worked = (): ProblemState => ({
    ...s,
    // a smaller problem stays open under its worked step: the kid still answers it
    help: { kind: "worked", text: workedFor(s.item, s.bug, brokenCell(s)), under: open ? openStep(s)!.step.under : under, point },
    helpLevel: 3,
    phase: "helping",
    counts,
    history: { ...s.history, worked: s.history.worked + 1 },
  });
  if (level === 1) {
    return { ...s, help: { kind: "nudge", text: nudgeFor(s.item, s.bug), under, point }, helpLevel: 1, phase: "helping", counts, history: { ...s.history, nudges: s.history.nudges + 1 } };
  }
  if (level === 2 && !open) {
    const step = s.bug ? shrink(s.item, s.bug, brokenCell(s)) : null;
    if (step) {
      return { ...s, stack: pushStep(s.stack, step), help: { kind: "smaller" }, subMark: null, helpLevel: 2, phase: "helping", counts, history: { ...s.history, smaller: s.history.smaller + 1 } };
    }
  }
  return worked();
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
      // Help me checks first, as on the iPad; a right answer needs no help.
      const checked = openStep(s) ? s : s.phase === "working" || !s.result ? runCheck(s) : s;
      if (checked.phase === "done") return checked;
      return giveHelp({ ...checked, notice: null });
    }
    case "hint_text":
      return s.help?.kind === "nudge" && a.text.trim() ? { ...s, help: { ...s.help, text: a.text.trim() } } : s;
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
      // where the answer row goes: the value itself (an equation's), else it follows the work (an
      // answer filled from it, a fraction's), else the typed answer patched at the place that came back
      const intoAnswer = answerCells(s.item).some((c) => c.id === back.cellId);
      const answer =
        back.cellId === null
          ? back.value
          : !s.answer.trim()
            ? s.answer
            : s.answerFromWork || fromWork
              ? (fromWork ?? "")
              : intoAnswer
                ? patchAnswer(s.item, s.answer, back.place, back.value)
                : s.answer;
      const carried = { cellId: back.cellId ?? ANSWER_LINE, value: back.value };
      const next: ProblemState = {
        ...s,
        stack: back.stack,
        answer,
        help: null,
        subMark: null,
        solvedSteps: [...s.solvedSteps, { ...back.solved, value: back.value }],
        carried,
      };
      const rechecked = runCheck(next);
      return { ...rechecked, carried: next.carried };
    }
  }
}

// ---------------------------------------------------------------- the set

/** A problem of the set: one of its own, or a Now you try put right after the one it follows. */
export interface SetEntry {
  /** for a Now you try: the index (in `items`) of the problem it follows */
  after?: number;
}

export interface SetState {
  items: MathItem[];
  /** one per item: the set's own problems have none */
  entries: SetEntry[];
  index: number;
  problem: ProblemState;
  /** how each problem ended (null: not yet) */
  outcomes: (KeysOutcome | null)[];
  finished: boolean;
}

export type SetAction = ProblemAction | { type: "next" } | { type: "restart"; items: MathItem[] } | { type: "now_you_try"; item: MathItem };

export function startSet(items: MathItem[]): SetState {
  if (!items.length) throw new Error("startSet: no problems");
  return { items, entries: items.map(() => ({})), index: 0, problem: startProblem(items[0]), outcomes: items.map(() => null), finished: false };
}

/** Is this problem a Now you try (not one of the set's own)? */
export function isBonus(s: SetState, index = s.index): boolean {
  return s.entries[index]?.after !== undefined;
}

/** The set's own problems: how many, and this one's number among them (a Now you try shares the one it follows). */
export function setPosition(s: SetState): { n: number; count: number } {
  const own = s.entries.map((e, i) => (e.after === undefined ? i : -1)).filter((i) => i >= 0);
  const base = s.entries[s.index]?.after ?? s.index;
  return { n: own.indexOf(base) + 1, count: own.length };
}

/** The set's own outcomes, in order (a Now you try is not one of them). */
export function ownOutcomes(s: SetState): (KeysOutcome | null)[] {
  return s.outcomes.filter((_, i) => !isBonus(s, i));
}

/** Problems of the set solved so far: the stars pill. */
export function starsOf(s: SetState): number {
  return ownOutcomes(s).filter((o) => o !== null).length;
}

/** Solved without help (a star sticker; with help is a ring). */
export function ownOf(s: SetState): number {
  return ownOutcomes(s).filter((o) => o === "first_try" || o === "self_corrected").length;
}

/** Every one of the set's problems solved on your own: the "perfect" sticker (5 for 5). */
export function perfectOf(s: SetState): boolean {
  const own = ownOutcomes(s);
  return own.length > 0 && own.every((o) => o === "first_try" || o === "self_corrected");
}

/** Now you try is offered after a problem done with help, once (not after a Now you try that went well). */
export function offersNowYouTry(s: SetState): boolean {
  return s.problem.phase === "done" && s.outcomes[s.index] === "with_help" && s.entries[s.index + 1]?.after !== s.index;
}

export function setReducer(s: SetState, a: SetAction): SetState {
  switch (a.type) {
    case "restart":
      return startSet(a.items);
    case "now_you_try": {
      if (!offersNowYouTry(s)) return s;
      const at = s.index + 1;
      const insert = <T,>(list: T[], v: T) => [...list.slice(0, at), v, ...list.slice(at)];
      // entries after the insert point that follow a later problem move down by one
      const entries = insert(s.entries, { after: s.index }).map((e, i) => (i > at && e.after !== undefined && e.after >= at ? { after: e.after + 1 } : e));
      return { ...s, items: insert(s.items, a.item), entries, outcomes: insert(s.outcomes, null), index: at, problem: startProblem(a.item) };
    }
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
