/**
 * What Solve writes WITHOUT a model: the local answer paths of `LiveLoop.startSolve`
 * (`src/lib/live/liveLoop.ts`), as one pure function over a column's LaTeX. No editor, no
 * store, no tldraw — so the same decision can be scored offline (`src/__eval__/**`) and, later,
 * called by the loop itself.
 *
 * `LiveLoop.startSolve` CALLS THIS: it is the one place the board decides what Solve writes
 * locally, so the scoreboard (`src/__eval__/**`) measures exactly what a student gets. The
 * order, the line each method is handed and the fall-through rules:
 *
 *   0. a word problem — the TARGET line reads as prose (`analyzeLine(...).kind === 'text'`) —
 *      skips every local path (the model sets it up);
 *   1. `engine.solveLatex(target, { column, complexRoots })` (`writeSolutionByHand`) — only with
 *      the hand on, and only when the hand can draw the steps: the loop's `drawStepsByHand`
 *      returns false on ANY `unsupported` construct and the next path gets its turn. The column
 *      down to the target goes with it (a function defined above is not a product), and whether
 *      complex roots may be written (`engine/complexSetting.ts`: by default only when the column
 *      already uses `i`);
 *   2. `engine.solveFromLines(column[0..target])` (`writeContextSolution`) — needs at least two
 *      lines with LaTeX; hand or typeset, a result here always ends the solve;
 *   3. `engine.simplifySteps(target)`         (`writeSimplification`) — written as `= …` lines;
 *   4. `localAnswerFor(engine, target, columnContext)` (`writeLocalAnswer`) — one `= answer` line;
 *   5. nothing local: the loop opens `/api/live/solve` (`source: null` here).
 *
 * Every path caps its steps at `LIVE_LIMITS.maxSolveSteps`, as the loop does. The column is the
 * lines WITH LaTeX (`buildCheckLines` drops empty reads), top to bottom; the target is the
 * asked-for line (the last one by default). Each line's analysis is `analyzeLine` in Solve mode
 * ('answer') with the column context above it, which is how the loop fills `state.analysis`.
 *
 * Not mirrored, because they are about the page rather than the maths: the live-shape cap, a
 * solution already on the page (`hasHandSolution`), `onlyFirstStep`, and placement.
 */
import { LIVE_LIMITS, type HelpMode, type LineAnalysis, type LiveEngine } from "./contracts";
import { allowComplexRoots, DEFAULT_COMPLEX_ROOTS, type ComplexRootsSetting } from "./engine/complexSetting";
import { localAnswerFor, localAnswerStep } from "./solveSteps";

export type LocalSolveSource = "solveLatex" | "solveFromLines" | "simplifySteps" | "localAnswer";

export interface LocalSolveResult {
  /** which local path answered; null means the loop would ask the model */
  source: LocalSolveSource | null;
  /** the lines the tutor writes, in order (empty when `source` is null) */
  steps: string[];
  /** `localAnswer` only: the bare answer (`38`), which the board records on the ink it writes */
  answer?: string;
}

export interface LocalSolveOptions {
  /**
   * The per-device handwriting switch (`deps.handwritingEnabled()`). With it off the loop never
   * tries `solveLatex` (its only caller is `writeSolutionByHand`). Default true.
   */
  handwriting?: boolean;
  /**
   * Can the tutor's hand draw these steps? The loop's `drawStepsByHand` interlock: when it
   * cannot, `solveLatex`'s steps are dropped and the next path is tried. Default: yes — pass
   * `planHandwriting`'s verdict to mirror the board exactly.
   */
  canDraw?: (steps: readonly string[]) => boolean;
  /** The board's help mode when each line was analyzed. Default 'answer' (Solve). */
  mode?: HelpMode;
  /**
   * When a quadratic with no real roots is answered with complex ones (`engine/complexSetting.ts`).
   * Default: only when the column already uses `i` — the per-class switch, when there is one.
   */
  complexRoots?: ComplexRootsSetting;
}

const NONE: LocalSolveResult = { source: null, steps: [] };

function safely<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function capped(steps: readonly string[]): string[] {
  return steps.slice(0, LIVE_LIMITS.maxSolveSteps);
}

/** `LiveLoop.columnContext`: the last usable line above, and the first relation above. */
function contextAbove(analyses: readonly (LineAnalysis | null)[], latex: readonly string[], index: number): { previous?: LineAnalysis; original?: LineAnalysis } {
  let previous: LineAnalysis | undefined;
  let original: LineAnalysis | undefined;
  for (let i = 0; i < index; i++) {
    const a = analyses[i];
    if (!a || !latex[i]) continue;
    if (a.kind === "label" || a.kind === "incomplete" || a.kind === "unknown") continue;
    previous = a;
    if (!original && (a.kind === "equation" || a.kind === "inequality")) original = a;
  }
  return { previous, original };
}

/**
 * Each line's analysis as the loop holds it: `analyzeLine(latex, { ...columnContext, mode })`,
 * top to bottom, so a line sees the analyses of the lines above it.
 */
export function analyzeColumn(engine: LiveEngine, lines: readonly string[], mode: HelpMode = "answer"): (LineAnalysis | null)[] {
  const out: (LineAnalysis | null)[] = [];
  for (let i = 0; i < lines.length; i++) {
    const latex = lines[i];
    out.push(latex ? safely(() => engine.analyzeLine(latex, { ...contextAbove(out, lines, i), mode })) : null);
  }
  return out;
}

/**
 * The local answer Solve would write for the target line of a column, or `source: null` when the
 * loop would open the model stream. See the file comment for the exact order.
 *
 * @param lines the column's lines, top to bottom (empty strings are lines Mathpix could not read)
 * @param targetIndex index into `lines` of the asked-for line; default the last line
 */
export function localSolve(engine: LiveEngine, lines: readonly string[], targetIndex?: number, opts: LocalSolveOptions = {}): LocalSolveResult {
  if (lines.length === 0) return NONE;
  const handwriting = opts.handwriting ?? true;
  const canDraw = opts.canDraw ?? (() => true);
  const mode = opts.mode ?? "answer";

  const analyses = analyzeColumn(engine, lines, mode);
  // `buildCheckLines`: only lines with LaTeX take part.
  const column = lines.map((latex, i) => ({ latex, i })).filter((l) => Boolean(l.latex));
  if (column.length === 0) return NONE;
  const index = targetIndex === undefined ? lines.length - 1 : Math.max(0, Math.min(lines.length - 1, targetIndex));
  // `liveStore.lines[opts.lineId] ?? built.states[last]`: the asked-for line even when unread.
  const target = lines[index] ?? "";
  const targetAnalysis = analyses[index] ?? null;

  if (targetAnalysis?.kind === "text") return NONE;

  // 1. writeSolutionByHand — with the column down to the target, so a function defined above is
  //    not read as a product (`f(4)` is not `4f`) and `i` above allows complex roots
  const upTo = lines.slice(0, index + 1).filter(Boolean);
  const solveOptions = { column: upTo, complexRoots: allowComplexRoots(opts.complexRoots ?? DEFAULT_COMPLEX_ROOTS, upTo) };
  if (handwriting && target) {
    const solved = safely(() => engine.solveLatex(target, solveOptions));
    if (solved && solved.steps.length > 0) {
      const steps = capped(solved.steps);
      if (canDraw(steps)) return { source: "solveLatex", steps };
    }
  }

  // 2. writeContextSolution: the column down to the asked-for line (all of it when that line has
  //    no LaTeX, as the loop's `findIndex` misses and falls back to every state).
  if (engine.solveFromLines) {
    const at = column.findIndex((l) => l.i === index);
    const upto = at === -1 ? column : column.slice(0, at + 1);
    const last = upto[upto.length - 1];
    if (last?.latex && upto.length >= 2) {
      const solved = safely(() => engine.solveFromLines!(upto.map((l) => l.latex)));
      if (solved && solved.steps.length > 0) return { source: "solveFromLines", steps: capped(solved.steps) };
    }
  }

  if (!target) return NONE;

  // 3. writeSimplification
  if (engine.simplifySteps) {
    const simplified = safely(() => engine.simplifySteps!(target));
    if (simplified && simplified.length > 0) return { source: "simplifySteps", steps: capped(simplified.map(localAnswerStep)) };
  }

  // 4. writeLocalAnswer
  const answer = localAnswerFor(engine, target, contextAbove(analyses, lines, index));
  if (answer) return { source: "localAnswer", steps: [localAnswerStep(answer)], answer };

  return NONE;
}
