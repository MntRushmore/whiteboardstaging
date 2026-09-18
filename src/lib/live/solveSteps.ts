/**
 * Deciding what a Solve is allowed to draw (spec §6, "deterministic maths never goes through
 * a model"). Pure TypeScript: no DOM, no tldraw, no store — `liveLoop.ts` is the only caller.
 *
 * Two jobs, both of which exist because the canvas is the student's page of work: anything
 * written there is read as fact.
 *
 *  1. `localAnswerFor` — the answer the local engine already knows. `engine.solveLatex` only
 *     handles relations with an unknown, so `36 + 2 =` used to fall straight through to the
 *     model, which answered `= r + 9\varepsilon`. But `engine.analyzeLine(latex, { mode:
 *     'answer' })` has the result for exactly that line (`38`), and `engine.calculate` has it
 *     for bare arithmetic the echo's calculator rule suppresses. When either does, the tutor
 *     writes the answer itself: no model, no credits, no network, no hallucination.
 *
 *  2. `checkSolveStep` — the interlock on the steps that genuinely do come from the model
 *     (a word problem, an equation the CAS cannot take). A step is drawn only when the local
 *     engine can parse it AND it introduces no free variable the student's own work has not
 *     seen. `r` and `\varepsilon` appeared from nowhere; that is what this rejects.
 */
import type { AnalyzeContext, LineAnalysis, LiveEngine } from "./contracts";

// ---------------------------------------------------------------- LaTeX symbols

/**
 * Greek commands that stand for a *quantity* rather than an operator. `\pi` is deliberately
 * absent (it is the constant, not a variable), as are `\sum` / `\prod` / `\int`, which have
 * their own commands and are skipped with every other structural macro.
 */
const GREEK_SYMBOLS: ReadonlySet<string> = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "rho", "varrho", "sigma", "varsigma",
  "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
]);

/**
 * Letters that are never a free variable: mathjs reads `e` and `i` as constants, and a step
 * is not "introducing" them. Keeping them out of the symbol set only ever makes the guard
 * more permissive, which is the safe direction for a name that carries no information.
 */
const CONSTANT_LETTERS: ReadonlySet<string> = new Set(["e", "i"]);

/** Macros whose braced argument is prose or a unit (`\mathrm{kg}`), never a variable. */
const TEXT_MACROS = ["text", "textrm", "textbf", "textit", "textsf", "mathrm", "mathsf", "operatorname", "mbox"];

/** Relation operators that can separate a step's two sides, longest spelling first. */
const RELATIONS = [
  "\\approx", "\\Rightarrow", "\\rightarrow", "\\implies", "\\neq", "\\ne", "\\leq", "\\le",
  "\\geq", "\\ge", "\\to", "=", "<", ">",
];

/** Drops `\text{…}` / `\mathrm{…}` and their argument, brace-balanced, leaving the maths. */
function stripTextMacros(latex: string): string {
  let out = "";
  for (let i = 0; i < latex.length; i++) {
    if (latex[i] !== "\\") {
      out += latex[i];
      continue;
    }
    const rest = latex.slice(i + 1);
    const macro = TEXT_MACROS.find((m) => rest.startsWith(m) && !/[a-zA-Z]/.test(rest[m.length] ?? ""));
    if (!macro) {
      out += latex[i];
      continue;
    }
    let j = i + 1 + macro.length;
    while (j < latex.length && /\s/.test(latex[j])) j++;
    if (latex[j] !== "{") {
      // `\text` with no argument: drop the macro, keep scanning what follows.
      i = j - 1;
      continue;
    }
    let depth = 0;
    for (; j < latex.length; j++) {
      if (latex[j] === "{") depth++;
      else if (latex[j] === "}" && --depth === 0) break;
    }
    out += " ";
    i = j;
  }
  return out;
}

/**
 * The free symbols of a LaTeX fragment: single Latin letters and Greek commands.
 *
 * Deliberately coarse — `v_1` and `v_2` both read as `v`, and a unit written bare (`31.36 N`
 * rather than `31.36\,\mathrm{N}`) reads as the symbol `N`. Coarse in the direction of MORE
 * names on the student's side (nothing is rejected for a name their own line contains) and,
 * on the model's side, of asking that a bare `N` have been seen before. Structural macros
 * (`\frac`, `\sqrt`, `\cdot`, `\left`) and every function name (`\sin`, `\log`) are skipped.
 */
export function mathSymbols(latex: string): string[] {
  const src = stripTextMacros(latex ?? "");
  const out: string[] = [];
  const add = (name: string) => {
    if (!out.includes(name)) out.push(name);
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      const m = /^[a-zA-Z]+/.exec(src.slice(i + 1));
      if (!m) {
        i++; // `\,` `\;` `\!` and friends
        continue;
      }
      if (GREEK_SYMBOLS.has(m[0])) add(m[0]);
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z]/.test(ch) && !CONSTANT_LETTERS.has(ch)) add(ch);
  }
  return out;
}

/** `\boxed{…}` wrapping the whole step (the model's `final` step always arrives wrapped). */
export function unwrapBoxed(latex: string): string {
  const s = (latex ?? "").trim();
  const m = /^\\boxed\s*\{/.exec(s);
  if (!m) return s;
  let depth = 0;
  for (let i = m[0].length - 1; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i === s.length - 1 ? unwrapBoxed(s.slice(m[0].length, i)) : s;
  }
  return s;
}

/** `\le` must not match inside `\left`: a macro relation ends at a non-letter. */
function relationAt(latex: string, i: number): string | null {
  for (const op of RELATIONS) {
    if (!latex.startsWith(op, i)) continue;
    if (op.startsWith("\\") && /[a-zA-Z]/.test(latex[i + op.length] ?? "")) continue;
    return op;
  }
  return null;
}

/** The first relation operator at brace depth 0, or null. */
function topLevelRelation(latex: string): { at: number; length: number } | null {
  let depth = 0;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth !== 0) continue;
    const op = relationAt(latex, i);
    if (op) return { at: i, length: op.length };
  }
  return null;
}

/**
 * The name a step *defines*, when the step is an assignment: the whole left-hand side is one
 * symbol (`v = \frac{60}{2}`). Such a name is bound by the step, not free in it, so a solution
 * to a word problem may name its own quantity. `= r + 9\varepsilon` has no left-hand side at
 * all and `r + 9\varepsilon = 38` has more than one symbol on the left, so neither defines
 * anything — which is the whole point.
 */
export function definedSymbol(latex: string): string | null {
  const rel = topLevelRelation(latex);
  if (!rel || rel.at === 0) return null;
  // The whole left-hand side is one name, optionally subscripted: `v`, `v_1`, `\varepsilon_0`.
  const m = /^(?:\\([a-zA-Z]+)|([a-zA-Z]))(?:_\s*(?:\{[A-Za-z0-9,\s]*\}|[A-Za-z0-9]))?$/.exec(latex.slice(0, rel.at).trim());
  if (!m) return null;
  if (m[1]) return GREEK_SYMBOLS.has(m[1]) ? m[1] : null;
  return CONSTANT_LETTERS.has(m[2]) ? null : m[2];
}

/** Leading `= …` / `\approx …`: a step that continues the line above rather than restating it. */
function stripLeadingRelation(latex: string): string {
  const s = latex.trimStart();
  const op = relationAt(s, 0);
  return op ? s.slice(op.length).trimStart() : s;
}

// ---------------------------------------------------------------- the model-step interlock

export const SOLVE_STEP_REJECTIONS = ["empty", "unparseable", "unknown-symbol"] as const;
export type SolveStepRejection = (typeof SOLVE_STEP_REJECTIONS)[number];

export interface SolveStepVerdict {
  /** false means DO NOT draw this step */
  ok: boolean;
  reason?: SolveStepRejection;
  /** names this step makes available to the steps after it ([] when rejected) */
  symbols: string[];
  /** the names that appeared from nowhere (reason 'unknown-symbol') */
  introduced: string[];
}

export interface SolveStepContext {
  /** every symbol the student's own lines, and the steps already accepted, contain */
  known: Iterable<string>;
  /** true when the local engine can read this step as maths */
  parses: (latex: string) => boolean;
}

/**
 * Is this one streamed step safe to draw on the student's page?
 *
 * Two rules, both cheap and both aimed at the same failure: the model answering with symbols
 * the problem never had.
 *
 *  - it must PARSE with the local engine (so `\text{Sorry, I can't}` and a dropped `\frac`
 *    never land), and
 *  - it must introduce no free variable that neither the student's work nor an earlier step
 *    contains, unless the step is the assignment that defines it.
 */
export function checkSolveStep(latex: string, ctx: SolveStepContext): SolveStepVerdict {
  const body = unwrapBoxed(latex ?? "");
  if (!body) return { ok: false, reason: "empty", symbols: [], introduced: [] };
  if (!ctx.parses(latex ?? "")) return { ok: false, reason: "unparseable", symbols: [], introduced: [] };

  const known = new Set(ctx.known);
  const defined = definedSymbol(body);
  const symbols = mathSymbols(body);
  const introduced = symbols.filter((s) => !known.has(s) && s !== defined);
  if (introduced.length > 0) return { ok: false, reason: "unknown-symbol", symbols: [], introduced };
  return { ok: true, symbols, introduced: [] };
}

export interface SolveStepGuard {
  /** Judges the next streamed step; an accepted step's names are known to the steps after it. */
  check(latex: string): SolveStepVerdict;
  /** Everything currently in scope — the student's lines plus every accepted step. */
  known(): string[];
}

/**
 * The streaming form of `checkSolveStep`: steps arrive one at a time and each one may hand
 * its names to the next, so the known-symbol set grows as the solution is accepted.
 */
export function createSolveStepGuard(opts: { sourceLatex: readonly string[]; parses: (latex: string) => boolean }): SolveStepGuard {
  const known = new Set<string>();
  for (const latex of opts.sourceLatex) for (const s of mathSymbols(latex)) known.add(s);
  return {
    check(latex: string): SolveStepVerdict {
      const verdict = checkSolveStep(latex, { known, parses: opts.parses });
      // An accepted step's names — the one it defined included — are in scope from here on.
      for (const s of verdict.symbols) known.add(s);
      return verdict;
    },
    known: () => [...known],
  };
}

/**
 * The `parses` half of the interlock, against the real engine.
 *
 * Three normalisations first, none of which can make wrong maths look right:
 *  - `\boxed{…}` off (every `final` step arrives wrapped);
 *  - a leading `= …`, because a step usually continues the line above and the engine reads a
 *    line that opens with a relation as `incomplete`;
 *  - `\left` / `\right`, sizing macros the engine does not read everywhere.
 *
 * What must not survive is a step with no maths in it at all: prose ("Sorry, I can't…"), an
 * empty fragment, a broken `\frac`.
 */
export function engineParsesStep(engine: Pick<LiveEngine, "analyzeLine">, latex: string): boolean {
  const body = stripLeadingRelation(unwrapBoxed(latex)).replace(/\\(?:left|right)(?![a-zA-Z])\s*/g, "").trim();
  if (!body) return false;
  // A bare number is a 'label' to the engine (a problem number written on the page). As the
  // body of a solve step it is the answer, so it is read here rather than thrown away.
  if (/^[-+]?\d+(?:\.\d+)?$/.test(body.replace(/\\,|[\s,]/g, ""))) return true;
  let analysis: LineAnalysis;
  try {
    analysis = engine.analyzeLine(body, { mode: "answer" });
  } catch {
    return false;
  }
  if (!analysis || analysis.kind === "unknown" || analysis.kind === "incomplete" || analysis.kind === "text") return false;
  return Boolean(analysis.math?.trim());
}

// ---------------------------------------------------------------- the local answer

/** Comparable form of a result, so an "answer" identical to the question is not written out. */
function normalizeMath(latex: string): string {
  return latex
    .replace(/\\,|\\;|\\!|\\ |~/g, "")
    .replace(/\\left|\\right|\\mathrm|\\text|\\cdot|\\times/g, "")
    .replace(/[{}\s]/g, "")
    .replace(/=+$/, "");
}

function safely<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * The answer the local engine already has for this line, as LaTeX, or null.
 *
 * `analyzeLine(..., { mode: 'answer' })` is the primary source: it carries `resultLatex` for a
 * trailing `=`, for units, for a conversion and for a derivative. Where it is empty the echo's
 * calculator rule suppressed it — `36 + 2` is "not interesting enough" to annotate unasked —
 * but Solve *was* asked, so a line with no free symbols is put through `engine.calculate`
 * instead. Lines that do have symbols never take that path: `calculate` would hand back a
 * simplification, which is not an answer.
 *
 * Only `expression` lines qualify. A relation is `solveLatex`'s job, and a `chem` / `text` /
 * `label` line has no computed answer to write.
 */
export function localAnswerFor(engine: LiveEngine, latex: string, ctx: Omit<AnalyzeContext, "mode"> = {}): string | null {
  const line = (latex ?? "").trim();
  if (!line) return null;
  const analysis = safely(() => engine.analyzeLine(line, { ...ctx, mode: "answer" }));
  if (!analysis || analysis.error || analysis.kind !== "expression") return null;

  const usable = (result: string | undefined): string | null => {
    const tex = result?.trim();
    if (!tex) return null;
    return normalizeMath(tex) === normalizeMath(line) ? null : tex;
  };

  const direct = usable(analysis.resultLatex);
  if (direct) return direct;
  if (!analysis.math.trim()) return null;
  if (mathSymbols(line).length > 0) return null;
  return usable(safely(() => engine.calculate(line))?.latex);
}

/** How a person finishes the line they just wrote: `36 + 2 =` becomes `= 38`. */
export function localAnswerStep(answer: string): string {
  return `= ${answer.trim()}`;
}
