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
 *  - under a line asking for its value at the column's givens (`2x + 5 =` with `x = 3`), a lone
 *    number is that value, judged as `= 11`, and a right line ending in a plain number solves it;
 *  - a step that does not follow from the last right line but does from the ringed step right above
 *    it was carried on from that slip: no mark of its own (`LineAnalysis.carried`).
 *
 * Small and free of mathjs: the loop imports it on the board's first load.
 */
import type { AnalyzeContext, HelpMode, LineAnalysis, LiveEngine } from "../contracts";
import { withoutOperationNotes } from "./annotations";
import { readVariants } from "../youngHand";
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

/**
 * A wrong digit in a stacked sum is ringed only on a read this sure of it: a child's sum ringed for
 * a digit Mathpix misread is worse than one left unmarked (the second reader, which re-reads a line
 * before its ring, reads one line, not a block). Mathpix read every stacked block at ~1. The board
 * (`LiveLoop.stackAnalysis`) and the iPad's brain (`stackedLine`) both judge by it.
 */
export const STACK_RING_CONFIDENCE = 0.85;

/** What follows a line's last `=` (the whole line when it has none). */
function lastSide(latex: string): string {
  const at = latex.lastIndexOf("=");
  return at === -1 ? latex : latex.slice(at + 1);
}

/** `= 3(x + 8)` → `3(x + 8)`: a step's leading relation, which the line it continues already ends with. */
function withoutRelation(step: string): string {
  return step.replace(/^\s*=\s*/, "").trim() || step;
}

/** `\gcd(`, `\operatorname{lcm}(`, `\text{GCF}(`: a greatest common factor or least common multiple of numbers. */
const GCF_LCM = /\\(?:gcd(?![a-zA-Z])|(?:operatorname|text|mathrm)\s*\{\s*(?:gcd|lcm|GCD|GCF|LCM|HCF|hcf)\s*\})(?=\s*\()/g;

/**
 * Maths with digits and no letters: arithmetic (`18 + 15 - 19`, `6 \times 4 = 24`, `\frac{1}{2} +
 * \frac{1}{4}`, `8 x 7`) — and a young student's ways of writing it: a long-division bracket
 * (`9 \longdiv{144}`), a remainder (`3 R 2`), a block of rows. The K–8 problems the chat writes
 * (`chat/problemForms.ts`) are arithmetic too: money (`\$3.25 + \$1.50`), a percent (`25\% \times
 * 80`), a square root that comes out whole (`3^{2} + \sqrt{16}`), a GCF or LCM (`\gcd(12, 18)`) —
 * their answer is a number the student writes alone.
 */
export function isArithmetic(latex: string): boolean {
  const bare = latex
    .replace(/\\begin\{(?:array|aligned|gathered)\}(?:\{[^{}]*\})?|\\end\{(?:array|aligned|gathered)\}|\\\\|\\enclose\s*\{\s*longdiv\s*\}/g, " ")
    .replace(/\\sqrt\s*\{\s*(\d+)\s*\}/g, (m: string, n: string) => (Number.isInteger(Math.sqrt(Number(n))) ? ` ${n} ` : m))
    .replace(GCF_LCM, " ")
    .replace(/\\[$%]/g, " ")
    .replace(/\\(?:frac|dfrac|tfrac|times|div|cdot|left|right|quad|qquad|longdiv|overline|underline|hline|,|;|:|!)/g, " ")
    // a worksheet's blank is a place for a number, not a letter (`4 + \square = 9`, `engine/blanks.ts`)
    .replace(/\\(?:square|Box|bigcirc|boxed|phantom|_)(?![a-zA-Z])|[?□○]/g, " ")
    .replace(/(?<=\d)\s*(?:\\(?:text|mathrm)\s*\{\s*[Rr]\s*\}|[Rr]|[xX])\s*(?=\d)/g, " ");
  return /\d/.test(bare) && !/[a-zA-Z\\]/.test(bare);
}

/** `4 \overline{ \, 222 \, }`: the divisor, then the dividend under the bar. */
const OVERLINE_DIVISION = /^\s*(\d+)\s*\\overline\s*\{((?:\s|\\[,;:!]|\d)+)\}\s*$/;
/** `55 r 2`, `55 R 2`: a remainder as children write it, for the young judge's `55 \text{ R } 2`. */
const REMAINDER = /(\d)\s*(?:\\(?:text|mathrm)\s*\{\s*)?[rR](?:\s*\})?\s*(\d)/;

/** `h(x) = 4x + 1` (a function of one letter) … */
const FUNCTION_DEF = /^\s*([a-zA-Z])\s*\(\s*([a-zA-Z])\s*\)\s*=\s*(.+)$/;
/** … and `h(1)`: its value at a number. */
const FUNCTION_CALL = /^\s*([a-zA-Z])\s*\(\s*(-?\s*\d+(?:\.\d+)?)\s*\)\s*$/;
/** A line that starts by naming that value (`h(1) = 5`): the rest is the working. */
const LEADING_CALL = /^\s*[a-zA-Z]\s*\(\s*-?\s*\d+(?:\.\d+)?\s*\)\s*(?==)/;

/**
 * The problem as arithmetic, when it is: its own lines when every one is (`isArithmetic`), and a
 * function's value at a number — `h(x) = 4x + 1` with `h(1)` — as the sum it comes to, `4(1) + 1`
 * (the real-ink bench: children work it in one chained line, `= 4(1) + 1 = 5`, and got a "?").
 * Null for any other problem.
 */
export function arithmeticOf(problem: readonly string[] | null | undefined): string[] | null {
  if (!problem || problem.length === 0) return null;
  // the tutor's long division `4 \overline{ \, 222 \, }` is 222 ÷ 4
  const divided = problem.map((l) => l.replace(OVERLINE_DIVISION, (_m, d: string, n: string) => `${n.replace(/\\[,;:!]|\s/g, "")} \\div ${d}`));
  if (divided.every(isArithmetic)) return divided;
  if (problem.every(isArithmetic)) return [...problem];
  const lines = problem.flatMap((l) => l.split(/\s*;\s*/)).filter((l) => l.trim().length > 0);
  if (lines.length !== 2) return null;
  const def = FUNCTION_DEF.exec(lines[0]);
  const call = FUNCTION_CALL.exec(lines[1]);
  if (!def || !call || def[1] !== call[1]) return null;
  const at = call[2].replace(/\s+/g, "");
  const sum = def[3].replace(new RegExp(`(?<![\\\\a-zA-Z])${def[2]}(?![a-zA-Z])`, "g"), `(${at})`).trim();
  return isArithmetic(sum) ? [sum] : null;
}

/** `h(1) = 4(1) + 1 = 5` → `= 4(1) + 1 = 5`: in a function's value worked as arithmetic, its name is no sum. */
export function withoutLeadingCall(latex: string): string {
  return latex.replace(LEADING_CALL, "");
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
  /** the line is (part of) a value the column gives a letter (`givens.ts`: the `3` of `x =` read apart): never an answer */
  given?: boolean;
}

/** The line judged in its column (see the file comment). Never throws past the engine's own guard. */
export function judgeLine(engine: LiveEngine, latex: string, input: WorkInput): LineAnalysis {
  const { ctx } = input;
  let a = engine.analyzeLine(latex, ctx);
  // the child's notes of what they do to both sides, read into the line (`annotations.ts`): the
  // equation is judged without them — only to find it right; a slip is never hidden by them
  if (a.verdict !== "ok" && !input.arithmetic) {
    const bare = withoutOperationNotes(latex);
    if (bare !== latex) {
      const judged = engine.analyzeLine(bare, ctx);
      if (judged.verdict === "ok") {
        a = judged;
        latex = bare;
      }
    }
  }
  // what a messy read may have been (`readVariants`: a plus written high, her `x` read as `\times`, a
  // side note behind a left arrow) — only to find the step right, never dropping a number the problem
  // or the lines above have (MISREADS; the minus her ink starts with is the loop's to offer: it needs the ink)
  if (a.verdict !== "ok" && !input.arithmetic) {
    const keep = [...input.above, ctx.previous?.math ?? "", ctx.original?.math ?? ""];
    for (const v of readVariants(latex, false, keep)) {
      const judged = engine.analyzeLine(v, ctx);
      if (judged.verdict === "ok") {
        a = judged;
        latex = v;
        break;
      }
    }
  }
  if (input.arithmetic) {
    if (REMAINDER.test(latex)) {
      // `= 55 r 2`: the answer with its remainder, as the young judge reads one (`55 \text{ R } 2`)
      latex = withoutRelation(latex).replace(REMAINDER, "$1 \\text{ R } $2").replace(/\\text\s*\{\s*R\s*\}\s*\\text\s*\{\s*R\s*\}/, "\\text{ R }");
      a = engine.analyzeLine(latex, ctx);
    }
    const named = withoutLeadingCall(latex);
    if (named !== latex) {
      latex = named;
      a = engine.analyzeLine(latex, ctx);
    }
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
    if (a.verdict === "mismatch" && looksMisread(engine, latex, input.arithmetic)) a = { ...a, misreadLikely: true };
  } else if (ctx.previous?.substituted && !input.given) {
    // the line above asks for its value with the column's givens put in (`2x + 5 =` under `x = 3`,
    // `LineAnalysis.substituted`): a lone number is that value (`11`, judged as `= 11`), and a right
    // line ending in a plain number answers it
    if (BARE_NUMBER.test(latex)) {
      const answer = engine.analyzeLine(`= ${withoutRelation(latex)}`, ctx);
      if (answer.verdict === "ok" || answer.verdict === "mismatch") a = { ...answer, bareAnswer: true };
    }
    if (a.verdict === "ok" && !a.solved && PLAIN_NUMBER.test(lastSide(latex))) a = { ...a, solved: true };
  } else if (a.verdict === "none" && !input.given && BARE_NUMBER.test(latex)) {
    // a lone number under an equation in one letter, when it is that letter's value, is the answer
    // (`12` under `x/2 - 5 = 1`, `2` after `y = -6 + 8`: children write it without `x =`). Only a
    // right one: a lone wrong number may be a side sum, and a ring there would be on right work.
    const letter = ctx.previous?.variable ?? ctx.original?.variable;
    if (letter && /^[a-zA-Z]$/.test(letter)) {
      const answer = engine.analyzeLine(`${letter} = ${withoutRelation(latex)}`, ctx);
      if (answer.verdict === "ok") a = { ...answer, bareAnswer: true };
    }
  }
  if (a.verdict === "ok" && !a.solved && !input.arithmetic && answersBySimplestForm(a, ctx)) a = { ...a, solved: true };
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
function stackedLine(engine: LiveEngine, latex: string, problem: readonly string[] | null, sure: boolean, mode: HelpMode): LineAnalysis {
  const read = parseStacked(latex);
  return read ? stackedAnalysis(workStacked(read), sure) : bracketLine(engine, latex, problem, sure, mode);
}

/** A long-division bracket in a read: `\longdiv`, `\enclose{longdiv}`, `\overline{)144}`, `9)\overline{144}`, `\right)`. */
export const LONG_DIVISION = /\\longdiv(?![a-zA-Z])|\\enclose\s*\{\s*longdiv\s*\}|\\overline\s*\{\s*\\?\)|\)\s*\\overline|\\right\s*\)/;

/**
 * A block that is no sum — a long-division bracket with its working, read as one — judged by the
 * engine's young-work judge (`LiveEngine.judgeWork`); quiet when it is not a bracket, or when its
 * ring would rest on a read the caller is not `sure` of (a block is a read of a whole layout).
 */
export function bracketLine(engine: LiveEngine, latex: string, problem: readonly string[] | null, sure: boolean, mode: HelpMode): LineAnalysis {
  const judged = LONG_DIVISION.test(latex) ? engine.judgeWork?.({ problem: problem ?? [], above: [], latex, ctx: { mode } }) : null;
  return judged && (sure || judged.verdict !== "mismatch") ? judged : stackedAnalysis(null, sure);
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
      out.push(stackedLine(engine, latex, problem, true, mode));
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
        arithmetic: arithmeticOf(head),
        above: lines.slice(0, i).filter((l) => l && !isStackRead(l)),
        slip: last && isSlip(last) ? last : undefined,
      }),
    );
  }
  return out;
}

/**
 * A right line that is the problem's answer by its form, where the engine only solves equations (the
 * real-ink bench: simplify problems, an inequality, `C = 10\pi`, `y = -4x + 7` were ticked but the page
 * never counted solved): in a column with no equation, an expression in simplest form; a letter alone
 * against a number (`x \ge 9`); a letter given its value in simplest form (`C = 10\pi`, `y = -4x + 7`).
 */
function answersBySimplestForm(a: LineAnalysis, ctx: AnalyzeContext): boolean {
  const math = a.math.trim();
  if (!math) return false;
  if (a.kind === "inequality") {
    return ctx.original?.kind === "inequality" && /^(?:[a-zA-Z]\s*(?:>=|<=|>|<)\s*-?\s*[\d.]+|-?\s*[\d.]+\s*(?:>=|<=|>|<)\s*[a-zA-Z])$/.test(math);
  }
  if (ctx.original) return false;
  if (a.kind === "expression") return Boolean(ctx.previous) && simplestForm(math);
  if (a.kind === "assignment" || a.kind === "function") {
    const m = /^[a-zA-Z]\s*=\s*(.+)$/.exec(math);
    return Boolean(m) && Boolean(ctx.previous) && simplestForm(m![1]);
  }
  return false;
}

/**
 * The engine's math of an expression is as simple as it goes: no brackets, no term with a second
 * number factor, no two terms alike (`9 * x - 5`, `x ^ 8`, `10 * pi`; not `5 * x + 25 - 2 * x`,
 * `x ^ (2 + 6)`, `2 * pi * 5`, `9 * x - 5 + 0`).
 */
export function simplestForm(math: string): boolean {
  if (/[()]/.test(math) || /\//.test(math)) return false;
  const terms = math.replace(/^\s*-\s*/, "").split(/\s+[+-]\s+/);
  const seen = new Set<string>();
  for (const t of terms) {
    const factors = t.split(/\s*\*\s*/).filter((f) => f.length > 0);
    const numbers = factors.filter((f) => /^[\d.]+$/.test(f));
    if (numbers.length > 1 || numbers.some((n) => Number(n) === 0) || (numbers.length === 1 && Number(numbers[0]) === 1 && factors.length > 1)) return false;
    const key = factors.filter((f) => !/^[\d.]+$/.test(f)).sort().join("*");
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * An arithmetic answer that is "wrong" the way a misread is, not the way a slip is (the real-ink bench:
 * a 14 read as 4, a 65 read as b5, both ringed on right work): a letter where only a number can be, or
 * the right value with one digit dropped or added. Only for a one-line problem with a whole-number answer.
 */
function looksMisread(engine: LiveEngine, latex: string, problem: readonly string[]): boolean {
  if (problem.length !== 1) return false;
  const end = lastSide(latex).replace(/\\(?:text|mathrm|mathbb|mathbf)\s*\{([^{}]*)\}/g, "$1").replace(/\\[a-zA-Z]+/g, " ");
  if (/[a-zA-Z]/.test(end) && /\d/.test(end)) return true;
  const read = (end.match(/\d+/g) ?? []).join("");
  if (!read) return false;
  const right = engine.analyzeLine(`x = ${problem[0]}`, { mode: "feedback" }).solutions?.[0]?.replace(/\s/g, "");
  if (!right || !/^-?\d+$/.test(right)) return false;
  const digits = right.replace("-", "");
  const [short, long] = read.length < digits.length ? [read, digits] : [digits, read];
  if (long.length - short.length !== 1) return false;
  let i = 0;
  for (const ch of long) if (i < short.length && ch === short[i]) i++;
  return i === short.length;
}
