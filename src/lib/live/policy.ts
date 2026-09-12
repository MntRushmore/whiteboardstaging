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
 * The caller guarantees rule 1 (never called while the pen is down / before the quiet gate).
 */

export interface PolicyInput {
  mode: HelpMode;
  voiceActive: boolean;
  analysis: LineAnalysis | null;
  confidence: number;
  /** ms since the line last changed */
  idleMs: number;
  userAsked: boolean;
  hintsShownForLine: number;
  openHintCount: number;
  rewritesWithWarn: number;
  liveShapeCount: number;
}

export interface PolicyDecision {
  echo: boolean;
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

const SILENT_KINDS: ReadonlySet<LineKind> = new Set<LineKind>(["label", "incomplete"]);
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

  // 2. echo
  const echo = !SILENT_KINDS.has(kind) && confidence >= LIVE_LIMITS.minConfidence;

  // 3. badge (never warn from unknown)
  const badge: LiveVerdict = echo && !capped ? badgeFor(mode, analysis) : "none";

  // 4. showResult: calculator rule everywhere; answer mode reveals trailing-= after idle.
  const hasResult = Boolean(analysis?.resultLatex);
  const trailingEquals = kind === "incomplete" || /=\s*$/.test(analysis?.math ?? "");
  let showResult = false;
  if (echo && hasResult) {
    if (!trailingEquals) showResult = true;
    else if (mode === "answer" && idleMs >= LIVE_TIMING.unknownIdleMs) showResult = true;
  }

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
