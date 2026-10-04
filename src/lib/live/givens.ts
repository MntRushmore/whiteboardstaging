/**
 * The values a column gives its letters — the `x = 3` a student writes beside a line they ended
 * with `=`:
 *
 *   3x + 24 =          x = 3             x =
 *   x = 3              3x + 24 =         3          ← `x = 3` read as two lines
 *                                        3x + 24 =
 *
 * all ask "what is 3x + 24 at x = 3?" — 33, finished where the student left off. Not a step of the
 * working: `x = 3` does not follow from `3x + 24 =`, it is what the line is evaluated at, so it is
 * never ringed as one, and Solve never asks a model for it (the owner's board wrote `= 3(x+8)`
 * under the `x = 3`, reading `x = 3 = 3(x+8)`).
 *
 * Pure: LaTeX and the lines' analyses in, no editor. The loop (`LiveLoop.columnContext`) and the
 * offline Solve (`localSolve`) both read a column's givens through here, and hand them to the
 * engine as `AnalyzeContext.givens`; the engine works the line out (`LineAnalysis.substituted`).
 *
 * A given is
 *  - an `assignment` line (`x = 3`, `y = -2`, `a = \frac{1}{2}`): one Latin letter alone on the
 *    left, a number on the right — no letter in it, no unit. The engine only calls a line that when
 *    nothing above makes it an answer (`x = 4` under `2x + 3 = 11` is that equation solved, not a
 *    value to work with);
 *  - `x =` with a lone number on the next line of the column: `x = 3` written with a gap, which the
 *    stroke grouping can cut in two. Only that pair — a lone `x =` anywhere else is a question.
 *
 * A letter given two different values is given none: which one the student meant is a guess.
 */
import type { LineAnalysis } from "./contracts";
import { preprocessLatex, splitRelations } from "./engine/latex";

export interface Given {
  /** the letter (`x`) */
  variable: string;
  /** its value, as written (`3`, `-2`, `\frac{1}{2}`) */
  value: string;
  /** the lines it was read from: one (`x = 3`), or two (`x =`, then `3`) */
  lines: number[];
}

/** Letters that are constants to the engine, never a value's name. */
const CONSTANTS: ReadonlySet<string> = new Set(["e", "i"]);

/** `3`, `-2`, `0.5`, `\frac{1}{2}`, `-\frac{3}{4}`: a number alone, as a value is written. */
const LONE_NUMBER = /^-?\s*(?:\d+(?:\.\d+)?|\\[dt]?frac\s*\{\s*\d+(?:\.\d+)?\s*\}\s*\{\s*\d+(?:\.\d+)?\s*\})$/;

/** `x =`: one letter, then `=`, and nothing after it. */
const LETTER_EQUALS = /^([a-zA-Z])\s*=$/;

function letterOf(latex: string): string | null {
  const s = latex.replace(/\s+/g, "");
  return /^[a-zA-Z]$/.test(s) && !CONSTANTS.has(s) ? s : null;
}

/** `x = 3` as a given: its letter and value, or null. */
function assignmentGiven(latex: string, analysis: LineAnalysis | null): { variable: string; value: string } | null {
  if (analysis?.kind !== "assignment" || analysis.units || !analysis.variable) return null;
  const { sides, ops } = splitRelations(latex);
  if (ops.length !== 1 || ops[0] !== "==" || sides.length !== 2) return null;
  const variable = letterOf(sides[0]);
  const value = sides[1].trim();
  if (!variable || variable !== analysis.variable || !value) return null;
  // a number: no letter at all once the commands are set aside (`\frac`, `\sqrt`, `\pi` are fine)
  if (/[a-zA-Z]/.test(value.replace(/\\[a-zA-Z]+/g, ""))) return null;
  return { variable, value };
}

/**
 * Every value the column gives, top to bottom. `lines` are the column's lines as read (an empty
 * string is a line with no read), `analyses` theirs in the same order.
 */
export function givensOf(lines: readonly string[], analyses: readonly (LineAnalysis | null | undefined)[]): Given[] {
  const found = new Map<string, Given | null>();
  const add = (g: Given) => {
    const had = found.get(g.variable);
    if (had === undefined) found.set(g.variable, g);
    // the same value again (`x = 3` copied down) changes nothing; another value makes it a guess
    else if (had && had.value.replace(/\s+/g, "") !== g.value.replace(/\s+/g, "")) found.set(g.variable, null);
  };
  for (let i = 0; i < lines.length; i++) {
    const latex = lines[i];
    if (!latex) continue;
    const one = assignmentGiven(latex, analyses[i] ?? null);
    if (one) {
      add({ ...one, lines: [i] });
      continue;
    }
    // `x =` and `3` read apart: the next line with a read is the value
    const m = LETTER_EQUALS.exec(preprocessLatex(latex));
    const variable = m ? letterOf(m[1]) : null;
    if (!variable) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    const value = j < lines.length ? preprocessLatex(lines[j]) : "";
    if (value && LONE_NUMBER.test(value)) add({ variable, value, lines: [i, j] });
  }
  return [...found.values()].filter((g): g is Given => g !== null);
}

/**
 * The givens a line may use, as `AnalyzeContext.givens`: every one not read from the line itself
 * (`x =` is never evaluated at the `3` written after it). Undefined when there are none.
 */
export function givensFor(givens: readonly Given[], index: number): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const g of givens) if (!g.lines.includes(index)) out[g.variable] = g.value;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The line a given belongs to, when `index` is one of a given's lines and the column has a line
 * evaluated at it (`analysis.substituted`, using that letter): the line the student is asking
 * about when they ask on the `x = 3` under it. -1 otherwise; the line itself when it is that line.
 */
export function evaluatedLineFor(lines: readonly string[], analyses: readonly (LineAnalysis | null | undefined)[], givens: readonly Given[], index: number): number {
  const at = (i: number) => Boolean(analyses[i]?.substituted);
  if (at(index)) return index;
  const mine = givens.filter((g) => g.lines.includes(index));
  if (mine.length === 0) return -1;
  // the nearest line evaluated at one of its letters: above it first (the problem the student wrote
  // the given under), then below (the given written first)
  const uses = (i: number) => at(i) && mine.some((g) => usesLetter(lines[i], g.variable));
  for (let i = index - 1; i >= 0; i--) if (uses(i)) return i;
  for (let i = index + 1; i < lines.length; i++) if (uses(i)) return i;
  return -1;
}

/** `3x + 24 =` uses x; `\sqrt{x}` does; the x of `\max` does not. */
function usesLetter(latex: string, letter: string): boolean {
  return preprocessLatex(latex).replace(/\\[a-zA-Z]+/g, " ").includes(letter);
}
