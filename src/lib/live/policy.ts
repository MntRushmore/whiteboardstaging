import { endsWithRelation } from "./answer";
import {
  LIVE_LIMITS,
  LIVE_TIMING,
  type HelpMode,
  type LineAnalysis,
  type LineKind,
  type LiveVerdict,
} from "./contracts";

/**
 * Silence rules and the help ladder (spec §6.5). Pure and exhaustively tested.
 * The caller guarantees rule 1 (never called while the pen is down / before the quiet gate)
 * and supplies `settled` — whether the student has stopped writing across the whole canvas.
 *
 * The line this file draws: **marks may be immediate; answers must wait.** A badge, a note
 * and a hint are about work the student has already done, so they land on the per-line
 * cadence. A result is the next thing they were going to write, so it waits for them to put
 * the pen down — and, being the work rather than a comment on it, only Solve shows it at all.
 */

export interface PolicyInput {
  mode: HelpMode;
  voiceActive: boolean;
  analysis: LineAnalysis | null;
  confidence: number;
  /** ms since the line last changed */
  idleMs: number;
  /**
   * Canvas-level: no student ink ANYWHERE for the settle period (`ANSWER_SETTLE_MS`).
   *
   * The per-line quiet gate says "this line is finished"; this says "the student has
   * stopped". They are not the same thing halfway down a derivation, and only the second
   * one licenses an answer — see `showResult` below.
   */
  settled: boolean;
  userAsked: boolean;
  hintsShownForLine: number;
  openHintCount: number;
  rewritesWithWarn: number;
  liveShapeCount: number;
  /** raw recognized LaTeX; lone symbols (`\\Delta`, `\\checkmark`, one letter) are silent */
  latex?: string;
}

export interface PolicyDecision {
  echo: boolean;
  /**
   * Live read this line as mathematics, whether or not it had anything to SAY about it.
   *
   * Distinct from `echo`, and the difference is the whole point: an `incomplete` line — the
   * student mid-working, `3a + 6 =` with nothing after the sign yet — is silent but is NOT
   * spare. The legacy image pipeline runs on an idle timer whenever Live leaves a burst
   * unclaimed, so treating "said nothing" as "has nothing" handed exactly those half-written
   * lines to an image model to guess the rest of. Only ink that is not maths at all (prose, a
   * diagram label) or that could not be read goes on.
   */
  owned: boolean;
  badge: LiveVerdict;
  showResult: boolean;
  runLlmCheck: boolean;
  allowHint: boolean;
  allowSteps: boolean;
  revealChemBalance: boolean;
  offerHintPrompt: boolean;
  /** shape cap reached: echo only, no badges/hints/graphs */
  capped: boolean;
}

const SILENT_KINDS: ReadonlySet<LineKind> = new Set<LineKind>(["label", "incomplete", "text"]);

/** Greek letters and decorations that, alone on a line, are a diagram/label, not math. */
const LONE_SYMBOL_COMMANDS: ReadonlySet<string> = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "varpi", "rho", "varrho", "sigma", "varsigma",
  "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
  "checkmark", "square", "blacksquare", "triangle", "triangledown", "bigtriangleup", "circ", "bullet",
  "cdot", "cdots", "ldots", "dots", "vdots", "star", "bigstar", "dagger", "ast", "times", "div",
  "pm", "mp", "infty", "angle", "measuredangle", "parallel", "perp", "nabla", "partial", "prime",
  "rightarrow", "leftarrow", "leftrightarrow", "Rightarrow", "Leftarrow", "uparrow", "downarrow",
  "to", "hbar", "ell", "wp", "Re", "Im", "aleph", "emptyset", "varnothing", "top", "bot", "neg", "lnot",
  "sim", "approx", "equiv", "propto", "therefore", "because", "S", "P", "copyright", "quad", "qquad",
]);

/**
 * True when the LaTeX is a single symbol: one Greek letter / decoration command, one
 * character, or only decorations (e.g. `\\checkmark`, `\\Delta`, `\\text { I }`, `\\cdots`).
 * Such lines are drawings or labels and never get an echo.
 */
export function isSingleSymbolLatex(latex: string): boolean {
  const s = latex
    .replace(/\\(?:text|mathrm|mathbf|mathit|textrm|textbf|operatorname)\s*\{([^{}]*)\}/g, " $1 ")
    .replace(/\\(?:left|right|,|;|:|!|quad|qquad)\b/g, " ")
    .replace(/[{}~]/g, " ")
    .trim();
  if (!s) return false;
  // Tokens: commands or single characters.
  const tokens = s.match(/\\[a-zA-Z]+|[^\s]/g) ?? [];
  if (tokens.length === 0) return false;
  if (tokens.length === 1) {
    const t = tokens[0];
    if (t.startsWith("\\")) return LONE_SYMBOL_COMMANDS.has(t.slice(1));
    return /^[a-zA-Z0-9.\-+*/=|:'"`^_,;?!()[\]<>]$/.test(t);
  }
  // Only decorations (no letters, digits or relations) -> silent.
  return tokens.every((t) => {
    if (t.startsWith("\\")) return LONE_SYMBOL_COMMANDS.has(t.slice(1));
    return /^[.\-+*/|:'"`^_,;?!()\[\]<>]$/.test(t);
  });
}

const CHECKABLE_KINDS: ReadonlySet<LineKind> = new Set<LineKind>([
  "equation",
  "expression",
  "inequality",
  "assignment",
]);

export function badgeFor(mode: HelpMode, analysis: LineAnalysis | null): LiveVerdict {
  if (mode === "off" || !analysis) return "none";
  if (analysis.solved) return "solved";
  switch (analysis.verdict) {
    case "ok":
      return "ok";
    case "mismatch":
      return "warn";
    default:
      return "none";
  }
}

export function decide(input: PolicyInput): PolicyDecision {
  const { mode, voiceActive, analysis, confidence, idleMs, userAsked } = input;
  const kind: LineKind = analysis?.kind ?? "unknown";
  const verdict = analysis?.verdict ?? "unknown";
  const capped = input.liveShapeCount >= LIVE_LIMITS.maxLiveShapesPerBoard;

  // 2. echo (labels, incomplete lines, prose and lone symbols are silent)
  const loneSymbol = input.latex !== undefined && isSingleSymbolLatex(input.latex);
  const echo = !SILENT_KINDS.has(kind) && !loneSymbol && confidence >= LIVE_LIMITS.minConfidence;
  // 2b. owned — everything `echo` claims, plus the half-written maths it deliberately skips.
  const owned = echo || kind === "incomplete";

  // 3. badge (never warn from unknown)
  const badge: LiveVerdict = echo && !capped ? badgeFor(mode, analysis) : "none";

  // 4. showResult — marks may be immediate; ANSWERS wait. Two independent gates:
  //
  //  - mode. A bare answer finishes the student's work for them, and that is Solve's job.
  //    Feedback points at mistakes and Suggest nudges: a line the student ended with `=` gets
  //    its mark and its hint in those modes, never its value. (The engine agrees — it only
  //    fills `resultLatex` for a trailing `=` in answer mode — but the rule belongs here with
  //    the rest of the ladder, not only as a side effect of how a line was analysed.)
  //  - settle. Mid-derivation, answering the step the student was about to take themselves is
  //    the one thing a good teacher does not do. So a result waits until they have stopped
  //    writing ANYWHERE on the canvas, not merely on this line. Badges, hints and the solved
  //    chip do not wait: they are marks on work already done.
  //
  // An explicit request (Solve steps, a badge tap, the voice tutor) means "now": `userAsked`
  // bypasses the settle wait entirely. It does not bypass the mode gate — asking in Feedback
  // asks for feedback.
  const hasResult = Boolean(analysis?.resultLatex);
  // `analysis.math` is the TRANSLATED line, and the translator drops the trailing `=` (it is
  // passed to the engine as a flag, not as syntax) — so this test alone read `36 + 2 =` as an
  // ordinary expression and the mode gate below never bit. The recognized LaTeX still has it.
  const trailingEquals =
    kind === "incomplete" || /=\s*$/.test(analysis?.math ?? "") || endsWithRelation(input.latex ?? "");
  const answerAllowedHere = !trailingEquals || mode === "answer";
  const showResult = echo && hasResult && answerAllowedHere && (userAsked || input.settled);

  // 5. runLlmCheck
  let runLlmCheck = false;
  if (mode !== "off" && !voiceActive && echo && !capped) {
    const feedbackRule =
      userAsked ||
      (verdict === "unknown" && idleMs >= LIVE_TIMING.unknownIdleMs && CHECKABLE_KINDS.has(kind));
    if (mode === "feedback") runLlmCheck = feedbackRule;
    else runLlmCheck = feedbackRule || (verdict === "mismatch" && input.hintsShownForLine < 1);
  }

  // 6. allowHint
  const allowHint =
    (mode === "suggest" || mode === "answer") &&
    !capped &&
    input.hintsShownForLine < LIVE_LIMITS.maxHintsPerLine &&
    input.openHintCount === 0;

  // 7. allowSteps (explicit tap only; the caller passes userAsked for the tap)
  const allowSteps = mode === "answer" && userAsked && !capped;

  // 8.
  const revealChemBalance = mode === "answer" && !capped;

  // 9.
  const offerHintPrompt = mode !== "off" && input.rewritesWithWarn >= 2;

  return {
    echo,
    owned,
    badge,
    showResult,
    runLlmCheck,
    allowHint,
    allowSteps,
    revealChemBalance,
    offerHintPrompt,
    capped,
  };
}

/** Text shown behind an amber dot when the CAS flags a unit or chemistry problem locally. */
export function localNoteFor(analysis: LineAnalysis | null, mode: HelpMode): string {
  if (!analysis || mode === "off") return "";
  if (analysis.units && !analysis.units.ok) return analysis.note || "These units don't add together";
  if (analysis.chem && !analysis.chem.balanced) {
    return mode === "answer" ? analysis.note || "Not balanced yet" : "Count the atoms on each side";
  }
  return analysis.verdict === "mismatch" ? analysis.note : "";
}
