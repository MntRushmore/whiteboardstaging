/**
 * A line of the student's working, judged in its column: the rules `LiveLoop.analyze` marks a line
 * by, as one pure function (`judgeLine`), so the young kids' scoreboard (`src/__eval__/young`)
 * replays exactly what the board ticks and rings (`judgeColumn`). No editor, no store, no ink.
 *
 * The loop knows things only the page can tell — which strokes are a stacked sum, which line sits on
 * a problem's row — and hands them in (`WorkInput`). What is decided here:
 *
 *  - every line is the engine's `analyzeLine` against the last right line above it (`ctx`);
 *  - in arithmetic (a problem with no letters: `arithmeticLines`) a young student's working is judged
 *    against the PROBLEM, not the line above: a side calculation, a lone number, a remainder, a
 *    long-division bracket (`LiveEngine.judgeWork`, `engine/primaryWork.ts`, in the engine's lazy
 *    chunk). An engine without it (a double in a test) falls back to the older rule: a lone number
 *    is the answer, judged as `= 14`, and a right line ending in a plain number solves the problem;
 *  - a step that does not follow from the last right line but does from the ringed step right above
 *    it was carried on from that slip: no mark of its own (`LineAnalysis.carried`).
 *
 * Small and free of mathjs: the loop imports it on the board's first load.
 */
import type { AnalyzeContext, HelpMode, LineAnalysis, LiveEngine } from "../contracts";
import { parseStacked, stackedAnalysis, workStacked } from "./columnArithmetic";

/** A number, as a young student writes an answer: `14`, `-3`, `2.5`, `\frac{3}{4}`, `3/4` (an `=` before it allowed). */
const BARE_NUMBER = /^\s*=?\s*-?\s*(?:\d+(?:\.\d+)?|\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\}|\d+\s*\/\s*\d+)\s*$/;
/** The same, as the last side of a line (`7 + 5 = 12`'s `12`): the line ends in the answer. */
const PLAIN_NUMBER = /^\s*-?\s*(?:\d+(?:\.\d+)?|\\frac\s*\{\s*\d+\s*\}\s*\{\s*\d+\s*\}|\d+\s*\/\s*\d+)\s*$/;

/**
 * A read that is a stacked sum's last row over its answer, read as a fraction: no one writes a
 * fraction whose numerator starts with `+` or `x` — `\frac{+680}{966}` is `+ 680` over a rule over
 * `966`. Should `stackedSums.ts` ever miss the layout, the line is still never answered as a
 * fraction (`= 0.7039`): it is treated as a stacked sum this cannot work, quiet.
 */
export const MISREAD_STACK = /^\s*\\frac\s*\{\s*(?:\+|\\times(?![a-zA-Z])|\\cdot(?![a-zA-Z]))/;

/** What follows a line's last `=` (the whole line when it has none). */
function lastSide(latex: string): string {
  const at = latex.lastIndexOf("=");
  return at === -1 ? latex : latex.slice(at + 1);
}

/** `= 3(x + 8)` → `3(x + 8)`: a step's leading relation, which the line it continues already ends with. */
function withoutRelation(step: string): string {
  return step.replace(/^\s*=\s*/, "").trim() || step;
}

/** Maths with digits and no letters: arithmetic (`18 + 15 - 19`, `6 \times 4 = 24`, `\frac{1}{2} + \frac{1}{4}`). */
export function isArithmetic(latex: string): boolean {
  const bare = latex.replace(/\\(?:frac|dfrac|tfrac|times|div|cdot|left|right|quad|qquad|,|;|:|!)/g, " ");
  return /\d/.test(bare) && !/[a-zA-Z\\]/.test(bare);
}

/** A step the engine rings (it does not follow), or one carried on from such a step (`LineAnalysis.carried`). */
export function isSlip(a: LineAnalysis): boolean {
  return a.verdict === "mismatch" || Boolean(a.carried);
}

/** Kinds that are no line to judge the next one against (`LiveLoop.columnContext`). */
const NOT_A_STEP: ReadonlySet<LineAnalysis["kind"]> = new Set(["label", "incomplete", "unknown", "operation"]);

/** What the loop knows about a line besides its read (see the file comment). */
export interface WorkInput {
  /** `LiveLoop.columnContext`: the last right line above, the column's first relation, its givens; and the mode */
  ctx: AnalyzeContext;
  /**
   * The problem the line is part of when it has no letters (`LiveLoop.arithmeticLines`): the chat's
   * problem at the top of its column, or the column's first line. Null in algebra and the rest.
   */
  arithmetic: readonly string[] | null;
  /** the student's lines above it in its column, top to bottom, as read: the working so far */
  above: readonly string[];
  /**
   * A line on a problem's row that writes the end of the problem again and then its answer (`3 = 7`
   * after the tutor's `4 +`): that answer as a line of its own (`= 7`, `LiveLoop.answerBeside`).
   */
  beside?: string | null;
  /** the step right above it when that step is a slip, ringed or carried (`LiveLoop.slipAbove`) */
  slip?: LineAnalysis;
}

/** The line judged in its column (see the file comment). Never throws past the engine's own guard. */
export function judgeLine(engine: LiveEngine, latex: string, input: WorkInput): LineAnalysis {
  const { ctx } = input;
  let a = engine.analyzeLine(latex, ctx);
  if (input.arithmetic) {
    const young = engine.judgeWork?.({ problem: input.arithmetic, above: input.above, latex: input.beside ?? latex, ctx });
    if (young) a = young;
    else {
      // a lone number is the answer (`= 9` too), and so is the one after the end of the problem
      // written again beside it (`3 = 7` after `4 +`); a right plain number — or a true fact,
      // `7 + 5 = 12` — is the problem solved
      const bare = input.beside ?? (BARE_NUMBER.test(latex) ? `= ${withoutRelation(latex)}` : null);
      if (ctx.previous && bare) {
        const answer = engine.analyzeLine(bare, ctx);
        if (answer.verdict === "ok" || answer.verdict === "mismatch") a = { ...answer, bareAnswer: true };
      }
      if (a.verdict === "ok" && !a.solved && PLAIN_NUMBER.test(lastSide(latex))) a = { ...a, solved: true };
    }
  }
  if (a.verdict !== "mismatch" || a.solved) return a;
  // not right from the last right line: carried on from the slip right above it? Then the
  // mistake is that slip's (ringed already), and this step gets no mark of its own
  if (!input.slip) return a;
  const fromSlip = engine.analyzeLine(latex, { ...ctx, previous: input.slip });
  return fromSlip.verdict === "ok" ? { ...a, verdict: "none", carried: true } : a;
}

/**
 * A stacked block judged from its read alone (`judgeColumn`; the loop has the ink's columns too):
 * a sum `columnArithmetic.ts` works, else — a long-division bracket read as a block — the engine's
 * young-work judge, else quiet.
 */
function stackedLine(engine: LiveEngine, latex: string, sure: boolean, mode: HelpMode): LineAnalysis {
  const read = parseStacked(latex);
  const work = read ? workStacked(read) : null;
  if (work) return stackedAnalysis(work, sure);
  return engine.judgeWork?.({ problem: [], above: [], latex, ctx: { mode } }) ?? stackedAnalysis(null, sure);
}

/** A read that is a stacked (column) sum: an array with a rule in it — what `stackedSums.ts` sends as one line. */
export function isStackRead(latex: string): boolean {
  return /^\s*\\begin\{(?:array|aligned|gathered|matrix|tabular)\}/.test(latex) && /\\hline|\\underline/.test(latex);
}

/** A column of work as the scoreboard writes it: the chat's problem over it (if any), then the student's lines. */
export interface WorkColumn {
  /** the problem the tutor wrote at the top of the column, its lines ([] or absent: the student's own) */
  problem?: readonly string[];
  /** the student's lines, top to bottom, as read ('' for a line that could not be read) */
  lines: readonly string[];
}

/**
 * Every line of a column judged as the loop judges it, top to bottom: the problem's lines analysed
 * as its head (`LiveLoop.headAnalyses`), each line in the context of the lines above
 * (`columnContext`: a slip, a stacked sum, a label is never what the next line is judged against),
 * a stacked sum on its own (as if from the ink, every read sure). Not mirrored, being about the page:
 * the givens a column's letters get (no letters in arithmetic), a line beside a problem's row,
 * proofs.
 */
export function judgeColumn(engine: LiveEngine, column: WorkColumn, mode: HelpMode = "feedback"): (LineAnalysis | null)[] {
  const problem = column.problem && column.problem.length > 0 ? column.problem : null;
  const heads: (LineAnalysis | null)[] = [];
  for (const latex of problem ?? []) {
    let previous: LineAnalysis | undefined;
    let original: LineAnalysis | undefined;
    for (const a of heads) {
      if (!a || NOT_A_STEP.has(a.kind)) continue;
      previous = a;
      if (!original && (a.kind === "equation" || a.kind === "inequality")) original = a;
    }
    heads.push(engine.analyzeLine(latex, { previous, original, mode }));
  }
  const { lines } = column;
  const out: (LineAnalysis | null)[] = [];
  for (let i = 0; i < lines.length; i++) {
    const latex = lines[i];
    if (!latex) {
      out.push(null);
      continue;
    }
    if (isStackRead(latex) || MISREAD_STACK.test(latex)) {
      out.push(stackedLine(engine, latex, true, mode));
      continue;
    }
    let previous: LineAnalysis | undefined;
    let original: LineAnalysis | undefined;
    let last: LineAnalysis | undefined;
    const take = (a: LineAnalysis | null | undefined) => {
      if (!a || NOT_A_STEP.has(a.kind)) return;
      previous = a;
      if (!original && (a.kind === "equation" || a.kind === "inequality")) original = a;
    };
    heads.forEach(take);
    for (let j = 0; j < i; j++) {
      const a = out[j];
      if (!lines[j] || isStackRead(lines[j]) || !a) continue;
      if (!NOT_A_STEP.has(a.kind)) last = a;
      if (isSlip(a)) continue;
      take(a);
    }
    const head = problem ?? [lines.find((l, j) => j <= i && l) ?? latex];
    out.push(
      judgeLine(engine, latex, {
        ctx: { previous, original, mode },
        arithmetic: head.length > 0 && head.every(isArithmetic) ? head : null,
        above: lines.slice(0, i).filter((l) => l && !isStackRead(l)),
        slip: last && isSlip(last) ? last : undefined,
      }),
    );
  }
  return out;
}
