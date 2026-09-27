/**
 * Word problems: "the model understands, the engine calculates". A cheap model only SETS UP the
 * maths (`/api/live/setup`: `v = \frac{150}{2.5}`, or `n + d = 25`, `5n + 10d = 185`), the local
 * engine solves the setup with `localSolve` exactly as Solve would, and the tutor writes both by
 * hand. Pure TypeScript — `liveLoop.ts` is the only caller.
 *
 * Nothing the model says reaches the page unchecked: every setup line must be maths the engine
 * reads, carry no words, and use only letters the setup itself introduces or the problem already
 * has (`validateSetupLines`); and then the engine has to be able to solve it. Otherwise the board
 * falls back to the worked solution from `/api/live/solve`.
 */
import type { LineAnalysis, LiveEngine } from "./contracts";
import { engineReads, hasWords } from "./readCheck";
import { definedSymbol, mathSymbols, unwrapBoxed } from "./solveSteps";

/** Words a line of prose must have before it reads as a question rather than a scrap. */
export const WORD_PROBLEM_MIN_WORDS = 4;

/** At most this many setup lines are drawn (the prompt asks for at most 4). */
export const MAX_SETUP_LINES = 4;

/** Words in recognized prose: `\text{...}` unwrapped, other commands and braces dropped. */
export function proseWordCount(latex: string): number {
  const plain = latex
    .replace(/\\(?:text|mathrm|textrm|textbf|mathbf|operatorname)\s*\{([^{}]*)\}/g, " $1 ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}]/g, " ");
  return (plain.match(/[A-Za-z0-9]+/g) ?? []).length;
}

/** A line of prose that reads like a sentence of a problem (not a doodle read as `\text{is}`). */
export function isProblemProse(line: { latex: string; analysis: LineAnalysis | null }): boolean {
  return line.analysis?.kind === "text" && proseWordCount(line.latex) >= WORD_PROBLEM_MIN_WORDS;
}

/** Single letters in prose: `The angles are x, 2x and 3x` names `x`. */
function proseLetters(latex: string): string[] {
  const out: string[] = [];
  for (const m of latex.matchAll(/\\(?:text|textrm|mbox)\s*\{([^{}]*)\}/g)) {
    for (const l of m[1].matchAll(/(?<![A-Za-z])([A-Za-z])(?![A-Za-z])/g)) out.push(l[1]);
  }
  return out;
}

/** `$…$` off and a `\boxed{}` unwrapped: the line as the board would draw it. */
function cleanLine(latex: string): string {
  return unwrapBoxed((latex ?? "").replace(/^\s*\$+|\$+\s*$/g, "").trim());
}

/** Is this setup line an assignment (`v = \frac{150}{2.5}`), and of which name? */
function assignmentOf(latex: string): string | null {
  const name = definedSymbol(latex);
  if (!name) return null;
  // `x = ?` names the unknown; it does not assign it
  return /=\s*\?\s*$/.test(latex) ? null : name;
}

/**
 * The model's setup lines when they may be solved and drawn, else null. Every line must be maths
 * the engine reads (`x = ?` included) with no words in it; every letter must be one the setup
 * introduces — the name an assignment defines, or an unknown of an equation — or one the problem
 * already uses. A letter that only ever appears on the right of an assignment is a quantity
 * nobody defined. A Greek letter must come from the problem itself.
 */
export function validateSetupLines(engine: Pick<LiveEngine, "analyzeLine">, raw: readonly string[], problem: readonly string[]): string[] | null {
  const lines = raw.map(cleanLine).filter(Boolean);
  if (lines.length === 0 || lines.length > MAX_SETUP_LINES) return null;
  for (const line of lines) {
    if (hasWords(line) || !engineReads(engine, line)) return null;
  }
  const problemSymbols = new Set(problem.flatMap((l) => [...mathSymbols(l), ...proseLetters(l)]));
  const introduced = new Set<string>();
  for (const line of lines) {
    const assigned = assignmentOf(line);
    if (assigned) {
      introduced.add(assigned);
      continue;
    }
    // an equation / inequality (or `x = ?`): its letters are its unknowns
    for (const s of mathSymbols(line)) if (s.length === 1) introduced.add(s);
  }
  for (const line of lines) {
    for (const s of mathSymbols(line)) {
      if (problemSymbols.has(s)) continue;
      if (s.length > 1) return null; // a Greek name the problem never used
      if (!introduced.has(s)) return null;
    }
  }
  return lines;
}

/** Comparable form of a step: spacing, braces, sizing and multiplication signs ignored. */
function stepKey(latex: string): string {
  return unwrapBoxed(latex)
    .replace(/\\(?:left|right|,|;|!|quad|qquad)|~|\s/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\cdot|\\times|\*/g, "");
}

/**
 * The block the tutor writes: the setup, then the engine's steps — a step that repeats a line
 * already in the block is not written twice. With `onlyFirst` (a hint in Feedback / Suggest), the
 * first setup line alone.
 */
export function setupBlock(setup: readonly string[], steps: readonly string[], onlyFirst = false): string[] {
  if (onlyFirst) return setup.slice(0, 1);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of [...setup, ...steps]) {
    const key = stepKey(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/** The `meta.solvedLatex` key of a word problem's written solution: the problem itself, so a second Solve costs nothing. */
export function wordProblemKey(problem: readonly string[]): string {
  return `problem: ${problem.join(" ; ")}`;
}
