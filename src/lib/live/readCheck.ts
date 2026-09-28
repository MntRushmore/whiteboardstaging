/**
 * The second reader: WHEN to ask a vision model to read a line again, and WHETHER to believe it.
 * Pure TypeScript (no DOM, no tldraw, no store) — `liveLoop.ts` is the only caller, and the model
 * benchmark's misread set is its test table.
 *
 * Mathpix misreads about 3 % of lines, and its own confidence is no guide (`a = 2` read as
 * `0=2` came back at 0.99). A vision model shown the ink, Mathpix's read and the column fixes
 * most of those (docs/eval/models.md, job 3) — but every line it re-reads is a line it could
 * break, so it is only asked on a SIGNAL:
 *
 *  (a) `unreadable`      the engine cannot make sense of a line that looks like maths;
 *  (b) `suspiciousRead`  the read contains something implausible in its column (below);
 *  (c) `low-confidence`  Mathpix was unsure, so the board would otherwise show nothing.
 *
 * And its answer is only taken when it differs from Mathpix's, has no words, and the engine can
 * read it (`acceptReread`); otherwise Mathpix's read stands.
 */
import { LIVE_LIMITS, type LineAnalysis, type LiveEngine } from "./contracts";
import { isSingleSymbolLatex } from "./policy";
import { definedSymbol, engineParsesStep, mathSymbols } from "./solveSteps";

// ---------------------------------------------------------------- vocabulary

/** Greek letters a student writes as quantities; `\pi` is absent on purpose (a constant). */
const GREEK = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "rho", "varrho", "sigma", "varsigma",
  "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
]);

/** Other symbols Mathpix produces for a stray stroke far more often than a student means them. */
const ODD_COMMANDS = new Set(["in", "ni", "notin", "ell", "wp", "aleph", "hbar", "imath", "jmath", "mho", "eth"]);

/** Angles: legitimate wherever the column has trigonometry. */
const ANGLE_LETTERS = new Set(["theta", "vartheta"]);

const TRIG = /\\(?:sin|cos|tan|sec|csc|cot|arcsin|arccos|arctan)(?![a-zA-Z])/;

/**
 * Letters that look the same in both cases, which is where Mathpix's case errors come from
 * (`u = 3` read as `U=3`). `A`/`a`, `T`/`t`, `M`/`m` are different shapes and often both
 * meant (area and acceleration, period and time), so they are not on the list.
 */
const SAME_SHAPE = new Set("ckopsuvwxyz".split(""));

/** Prose connectors the engine itself reads (`15\% \text{ of } 80`, `5 km/h \text{ to } m/s`). */
const TEXT_CONNECTOR = /\\(?:text|textrm|mbox)\s*\{\s*(?:of|to)\s*\}/g;
const TEXT_MACRO = /\\(?:text|textrm|textbf|textit|textsf|mbox)\s*\{([^{}]*)\}/g;

/**
 * Constructs the engine reads and then declines to answer on their own: an integral or limit it
 * cannot do, a matrix, and derivative notation (`\frac{dy}{dx}`, `f'(x)`) that needs the
 * definition above it. A refusal, not a misread.
 */
const REFUSED_CONSTRUCT = /\\(?:int|iint|oint|lim|sum|prod|begin|binom)(?![a-zA-Z])|\\frac\s*\{\s*d\^?\{?\d?\}?\s*[a-zA-Z]?\s*\}\s*\{\s*d|'|\\prime/;

// ---------------------------------------------------------------- helpers

/** Prose: a `\text{…}` that carries words (a word problem), not the engine's own connectors. */
export function isProse(latex: string): boolean {
  const s = (latex ?? "").replace(TEXT_CONNECTOR, " ");
  for (const m of s.matchAll(TEXT_MACRO)) if (/[A-Za-z]{2,}/.test(m[1])) return true;
  return false;
}

/** The line with prose, units and spacing removed: what is left is the maths to inspect. */
function mathOnly(latex: string): string {
  return (latex ?? "")
    .replace(TEXT_MACRO, " ")
    .replace(/\\(?:mathrm|operatorname|mathbf|mathit)\s*\{[^{}]*\}/g, " ")
    .replace(/\\(?:left|right)(?![a-zA-Z])/g, "")
    .replace(/\\[,;:! ]|~/g, " ");
}

/**
 * The same, with every command replaced by a `#`, so `\cos` never reads as the letters c, o, s
 * and `x \geq 5` never reads as `x 5`.
 */
function bareMath(latex: string): string {
  return mathOnly(latex).replace(/\\[a-zA-Z]+/g, " # ");
}

/** Command names used in a line (`\Delta t` → `Delta`). */
function commandsIn(latex: string): Set<string> {
  return new Set([...mathOnly(latex).matchAll(/\\([a-zA-Z]+)/g)].map((m) => m[1]));
}

/** Single Latin letters that are quantities (`e`, `i`, `\frac{d}{dx}`'s `d`, prose and units excluded). */
function letters(latex: string): Set<string> {
  return new Set(mathSymbols(mathOnly(latex)).filter((s) => s.length === 1));
}

const union = (sets: Iterable<Set<string>>): Set<string> => {
  const out = new Set<string>();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
};

function swapCase(ch: string): string {
  return ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
}

/** `a = b` at the top level (no `<`, `\le`, … and exactly one `=`): its two sides, else null. */
function equationSides(latex: string): [string, string] | null {
  const s = mathOnly(latex).trim();
  if (/<|>|\\(?:le|ge|leq|geq|neq|ne|approx)(?![a-zA-Z])/.test(s)) return null;
  const parts = s.split("=");
  return parts.length === 2 ? [parts[0].trim(), parts[1].trim()] : null;
}

const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

/** A line where a letter meets itself again (`3x + 7 = 3x - 2`): the kind whose next line may be `0 = -9`. */
function letterRepeats(latex: string): boolean {
  const counts = new Map<string, number>();
  for (const m of bareMath(latex).matchAll(/(?<![a-zA-Z])[a-zA-Z](?![a-zA-Z])/g)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  return [...counts.values()].some((n) => n >= 2);
}

// ---------------------------------------------------------------- (b) suspicious reads

export type ReadSignal =
  /** a Greek letter, `\in`, `\ell` … that appears nowhere else in the column (θ is fine with trig) */
  | "odd-symbol"
  /** `U` in a column that writes `u` (letters that look the same in both cases) */
  | "letter-case"
  /** a letter from nowhere, in a column whose other lines are one connected problem */
  | "stray-letter"
  /** `o` or a bare `e` glued to digits (`2o`, `1 e`), or a letter written before a number (`x 2`) */
  | "digit-letter"
  /** `6^{x}`: a 6 as the base of a power in a letter, where `e` was almost always written */
  | "lookalike-base"
  /** `0=5`: a lone digit equated to another number, with no cancelling line to explain it */
  | "false-number"
  /** `\frac{9}{0}`: nobody writes a zero denominator on purpose; `8` and `0` look alike */
  | "zero-denominator"
  /** `(0+b)`: nobody adds zero on purpose; `a` and `0` look alike */
  | "zero-term";

/**
 * Is this read implausible in its column? The first reason found, or null.
 *
 * @param latex  Mathpix's LaTeX for the line
 * @param others the column's OTHER lines (above and below, as read; empty strings are skipped)
 *
 * Deliberately narrow: each rule is a confusion Mathpix is known to make (look-alike letters and
 * digits, case, Greek letters for stray strokes). A false alarm costs one cheap re-read that
 * comes back unchanged; a missed misread is what Live did before. Prose is never inspected.
 */
export function suspiciousRead(latex: string, others: readonly string[] = []): ReadSignal | null {
  const line = (latex ?? "").trim();
  if (!line || isProse(line)) return null;
  const column = others.map((l) => l ?? "").filter((l) => l.trim() && !isProse(l));
  const bare = bareMath(line);

  // odd symbols: a Greek letter / \in that nothing else in the column uses
  const otherCommands = union(column.map(commandsIn));
  const trig = TRIG.test(line) || column.some((l) => TRIG.test(l));
  for (const name of commandsIn(line)) {
    if (!GREEK.has(name) && !ODD_COMMANDS.has(name)) continue;
    if (otherCommands.has(name)) continue;
    if (trig && ANGLE_LETTERS.has(name)) continue;
    // the argument of a trig function is an angle, whatever it is called (`\sin \alpha`)
    if (new RegExp(`${TRIG.source}\\s*\\(?\\s*\\\\${name}(?![a-zA-Z])`).test(line)) continue;
    // set membership written as such: `x \in \mathbb{R}`, `x \in (2, 5]`
    if (name === "in" && /\\in\s*(?:\\mathbb|\\left|\\\{|[([])/.test(line)) continue;
    return "odd-symbol";
  }

  // look-alike digits and letters
  if (/\d\s*[oO](?![a-zA-Z])|(?<![a-zA-Z])[oO]\s*\d/.test(bare)) return "digit-letter";
  const otherE = column.some((l) => /(?<![a-zA-Z])e(?![a-zA-Z])/.test(bareMath(l)));
  if (!otherE && /\d\s*e(?![a-zA-Z^{(]|\s*\^)/.test(bare)) return "digit-letter";
  if (/(?<![a-zA-Z_^\\])[a-zA-Z](?![a-zA-Z])\s*\d/.test(bare.replace(/[_^]\s*\{[^{}]*\}|[_^]\s*\S/g, " "))) return "digit-letter";
  if (/(?<![\d.])6\s*\^\s*\{?\s*[-+]?\s*[a-zA-Z]/.test(mathOnly(line)) && !column.some((l) => /(?<![\d.])6\s*\^/.test(l))) {
    return "lookalike-base";
  }
  if (/\\frac\s*\{[^{}]*\}\s*\{\s*0\s*\}/.test(line)) return "zero-denominator";
  if (/(?<![\d.])0\s*\+\s*[a-zA-Z(]|[a-zA-Z)]\s*[+-]\s*0(?![\d.])/.test(bare)) return "zero-term";

  const sides = equationSides(line);
  if (sides && PLAIN_NUMBER.test(sides[0]) && PLAIN_NUMBER.test(sides[1]) && Number(sides[0]) !== Number(sides[1])) {
    const loneDigit = /^\d$/.test(sides[0]) || /^\d$/.test(sides[1]);
    if (loneDigit && !column.some(letterRepeats)) return "false-number";
  }

  // letters: case, and a letter from nowhere
  const own = letters(line);
  const columnLetters = column.map(letters);
  const seen = union(columnLetters);
  for (const l of own) {
    if (SAME_SHAPE.has(l.toLowerCase()) && !seen.has(l) && seen.has(swapCase(l))) return "letter-case";
  }
  const lettered = columnLetters.filter((s) => s.size > 0);
  const connected =
    lettered.length >= 2 && lettered.every((s, i) => lettered.some((t, j) => j !== i && [...s].some((v) => t.has(v))));
  if (connected) {
    const defined = definedSymbol(line);
    const allowed = new Set<string>([...(defined ? [defined] : [])]);
    if (/\\int/.test(line) || column.some((l) => /\\int/.test(l))) allowed.add("C");
    if (trig) ["k", "n"].forEach((v) => allowed.add(v));
    if ([...own].some((l) => !seen.has(l) && !seen.has(swapCase(l)) && !allowed.has(l))) return "stray-letter";
  }
  return null;
}

// ---------------------------------------------------------------- the trigger

export type RereadTrigger = ReadSignal | "unreadable" | "low-confidence";

export interface RereadInput {
  latex: string;
  confidence: number;
  /** the engine's analysis of the read (null when the engine threw) */
  analysis: LineAnalysis | null;
  /** strokes in the line: one stroke is a mark, not a line of maths */
  strokeCount: number;
  /** the column's other lines, as read */
  others: readonly string[];
}

/** Enough ink and enough symbols to be a line of maths rather than a mark or a label. */
function looksLikeMaths(latex: string, strokeCount: number): boolean {
  if (strokeCount < 2) return false;
  if (isSingleSymbolLatex(latex)) return false;
  return (bareMath(latex).match(/[A-Za-z0-9=+\-<>^/]/g) ?? []).length >= 2;
}

/**
 * Should this read go to the second reader? The reason, or null. Called once per ink version
 * (the loop remembers the hash), after Mathpix's read has already been rendered.
 */
export function rereadTrigger(input: RereadInput): RereadTrigger | null {
  const latex = (input.latex ?? "").trim();
  if (!latex) return null;
  if (input.analysis?.kind === "text" || input.analysis?.kind === "label" || isProse(latex)) return null;
  if (!looksLikeMaths(latex, input.strokeCount)) return null;
  // (c) Mathpix is unsure: the board would show nothing at all
  if (input.confidence < LIVE_LIMITS.minConfidence) return "low-confidence";
  // (a) the engine cannot read it — but not a construct it reads and declines (an integral it
  //     cannot do), and not the board's own `x = ?`
  const unknown = !input.analysis || input.analysis.kind === "unknown";
  if (unknown && !REFUSED_CONSTRUCT.test(latex) && !/\?/.test(latex)) return "unreadable";
  // (b) the read is implausible in its column
  return suspiciousRead(latex, input.others);
}

// ---------------------------------------------------------------- believing the answer

/** Words on the board: prose in a text macro (bar the engine's `of` / `to`), or a run of letters that is no command. */
export function hasWords(latex: string): boolean {
  const s = (latex ?? "").replace(TEXT_CONNECTOR, " ");
  if (/\\(?:text|textrm|textbf|textit|textsf|mbox)\s*\{[^{}]*[A-Za-z]/.test(s)) return true;
  return /[A-Za-z]{4,}/.test(bareMath(s));
}

const safely = <T>(fn: () => T): T | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/** An error that means the engine could not read the line, as opposed to declining to answer it. */
const UNREADABLE_ERROR = /unsupported|unbalanced|without|empty|ambiguous|unknown function|one-sided|prime|leibniz|unexpected|parse|syntax|\\/i;

/**
 * Can the local engine read this line as maths? `engineParsesStep` (the solve interlock), after
 * two board idioms are set aside: a trailing `=` (a question, `(a + b)^2 =`) and `x = ?` (the
 * unknown named). A calculus line the engine parses but declines to answer (`\int x e^{x^2} dx`)
 * still counts as read; any other refusal does not.
 */
export function engineReads(engine: Pick<LiveEngine, "analyzeLine">, latex: string): boolean {
  const body = (latex ?? "").trim().replace(/=\s*\?\s*$/, "= 0").replace(/=\s*$/, "").trim();
  if (!body) return false;
  if (engineParsesStep(engine, body)) return true;
  if (!/\\(?:int|lim|sum|prod)(?![a-zA-Z])/.test(body)) return false;
  const a = safely(() => engine.analyzeLine(body, { mode: "answer" }));
  return Boolean(a && a.kind === "unknown" && a.error && !UNREADABLE_ERROR.test(a.error));
}

/** Comparable form of a read: spacing, sizing and braces ignored (`e^{x}` is `e^x`). */
export function sameRead(a: string, b: string): boolean {
  const norm = (s: string) => (s ?? "").replace(/\\(?:left|right)(?![a-zA-Z])|\\[,;:! ]|~|\s|[{}]/g, "");
  return norm(a) === norm(b);
}

/**
 * The second reader's LaTeX when it should replace Mathpix's, else null: it must differ, carry no
 * words, be a transcription of the same line (not a paragraph, not a worked answer: within half to
 * double Mathpix's length), be readable by the engine, and not itself look misread in its column
 * (`suspiciousRead` — on the benchmark the model's only wrong "fix" was `0=5` → `\sigma = 5`).
 *
 * @param others the column's other lines, as `suspiciousRead` takes them
 */
export function acceptReread(
  engine: Pick<LiveEngine, "analyzeLine">,
  mathpixLatex: string,
  candidate: string,
  others: readonly string[] = [],
): string | null {
  const next = (candidate ?? "").replace(/^\s*\$+|\$+\s*$/g, "").trim();
  if (!next || sameRead(next, mathpixLatex)) return null;
  if (hasWords(next)) return null;
  const len = (s: string) => s.replace(/\s/g, "").length;
  const was = len(mathpixLatex);
  if (len(next) > was * 2 + 4 || len(next) * 2 + 4 < was) return null;
  if (suspiciousRead(next, others)) return null;
  return engineReads(engine, next) ? next : null;
}
