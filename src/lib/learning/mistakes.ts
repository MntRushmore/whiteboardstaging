/**
 * STUB (owner: agent "brain"). What kind of mistake a ringed line is.
 * Exports are frozen by the contract; the bodies are replaced by their owner.
 */
import type { LiveEngine } from "@/lib/live/contracts";
import type { MistakeKind } from "./hint";

/**
 * A ringed line compared with the line above it (both as read, LaTeX): `sign` when flipping one
 * term's sign makes it right, `distribution` when only the first term in brackets was multiplied,
 * and so on (`MISTAKE_KINDS`). Null when it cannot tell. Pure apart from the engine, < 5 ms.
 */
export function classifyMistake(engine: LiveEngine, previousLatex: string, latex: string): MistakeKind | null {
  void engine;
  void previousLatex;
  void latex;
  return null;
}

/** A check annotation's kind as a mistake kind; null for kinds that are not mistakes (praise, notation, incomplete). */
export function mistakeFromAnnotation(kind: string): MistakeKind | null {
  void kind;
  return null;
}
