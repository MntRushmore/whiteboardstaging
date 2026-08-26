import { constrainMarks, isUsableLatex, noteTextFitsLatex } from "./normalize";
import type { TutorMark } from "./types";

export type AnswerQuietReason = "no-cluster" | "mathpix-miss" | "flash-miss";

export type AnswerDecision =
  | { action: "quiet"; reason: AnswerQuietReason }
  | { action: "socratic"; marks: TutorMark[] };

/**
 * Live Socratic lock: last cluster → Mathpix → one Socratic mark.
 * Empty LaTeX is a Mathpix miss. Unusable marks are a Flash miss.
 * Never invent a picture. Solve does not use this — see evaluateMathNotes.
 */
export function decideSocraticAnswer(
  seedCount: number,
  latex: string,
  marks: TutorMark[],
): AnswerDecision {
  if (seedCount <= 0) return { action: "quiet", reason: "no-cluster" };
  if (!isUsableLatex(latex)) return { action: "quiet", reason: "mathpix-miss" };
  const one = constrainMarks("socratic", marks).slice(0, 1);
  const text = one[0]?.text?.trim() ?? "";
  if (!text || !noteTextFitsLatex(text, latex)) {
    return { action: "quiet", reason: "flash-miss" };
  }
  return { action: "socratic", marks: one };
}
