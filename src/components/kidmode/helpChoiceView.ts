/**
 * How much help the simple board's Help me gives: a small choice beside it (`HelpChoice`), in a
 * kid's words, over the classic board's help dial. It IS the dial — the same three of its modes
 * (Feedback, Suggest, Solve), the same default (Feedback) and the same memory (per board, on the
 * device: `useAssistanceMode`) — so Help me does exactly what it did, at the level picked, and More's
 * dial moves with it. Off is not a kid's choice: it stays on the dial, in More.
 *
 * Pure: the words and the mapping, pinned by tests.
 */
import type { AssistanceMode } from "@/hooks/useAssistanceMode";

export type HelpChoiceId = "hint" | "step" | "solve";

export interface HelpChoiceItem {
  id: HelpChoiceId;
  /** the dial's mode it sets */
  mode: Exclude<AssistanceMode, "off">;
  /** its one or two words */
  word: string;
  /** what the tutor does at this level, in a line a kid reads */
  line: string;
}

/** The three levels, least help first. */
export const HELP_CHOICES: readonly HelpChoiceItem[] = [
  { id: "hint", mode: "feedback", word: "Hint", line: "Ticks, and a hint when you ask" },
  { id: "step", mode: "suggest", word: "Next step", line: "The next step when you're stuck" },
  { id: "solve", mode: "answer", word: "Solve it", line: "Works out the rest of the problem" },
];

export const HELP_CHOICE_COPY = {
  /** over the choices */
  title: "How much help?",
  /** the button's hover words */
  hint: "Choose how much help you get",
  /** the button's name for a screen reader: what it is and what is picked */
  label: (word: string | null) => (word ? `How much help: ${word}` : "How much help"),
} as const;

/** The level the dial is at, or null at Off (where there is no Help me, and so no choice beside it). */
export function helpChoiceFor(mode: AssistanceMode): HelpChoiceItem | null {
  return HELP_CHOICES.find((c) => c.mode === mode) ?? null;
}

/** The dial's mode for a level picked (by its id), or null for anything else. */
export function modeForChoice(id: string): HelpChoiceItem["mode"] | null {
  return HELP_CHOICES.find((c) => c.id === id)?.mode ?? null;
}
