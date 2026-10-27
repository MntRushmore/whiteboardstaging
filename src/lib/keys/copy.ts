/**
 * Every word the kid reads on the Keys page (docs/KEYS.md). Phase 1 is fixed copy, no LLM; Phase 2's
 * tutor wording falls back to these. Short and sure, like a coach: full stops, US English, never the
 * word "wrong".
 */
import type { BugId } from "./bugs";
import { carryInto, digitAt, type MathItem } from "./item";

export const KEYS_COPY = {
  title: "Today's practice",
  problemOf: (n: number, count: number) => `Problem ${n} of ${count}`,
  allDone: "All done",
  workHere: "Work it out here",
  /** the line over the column: what to do */
  prompt: {
    sum: "Add. Ones first.",
    missing_addend: "Find the missing digit.",
    fact: "Fill in the box.",
  },
  showSteps: "Show my steps",
  stepsHead: "Your steps. Enter adds a line.",
  lookHint: "Press ? for a hint.",
  onYourOwn: "On your own.",
  withHelp: "With a little help.",
  sounds: "Sounds",
  stepPlaceholder: "Type a step, like 2 + 3 = 5",
  answer: "Answer:",
  check: "Check",
  next: "Next problem",
  finish: "All done",
  helpMe: "Help me",
  ask: "Ask",
  askSoon: "Ask is coming soon.",
  more: "More",
  back: "Back",
  starsOf: (n: number, count: number) => `${n} of ${count}`,
  lookAgain: "Look again.",
  gotIt: "You got it.",
  nailedIt: "Nailed it.",
  writeFirst: "Write your answer first. Then press Enter.",
  /** the smaller problem's lead line, by copy key */
  lead: {
    carry_is_ten: "The 1 you carried is a ten.",
  },
  carriedBack: (value: string) => `${value} goes back up.`,
  blocksHint: "Space adds a ten. Backspace takes one away. Enter checks it.",
  doneTitle: "All done.",
  doneLine: (count: number, own: number) => `${count} problems. ${own} on your own.`,
  backToBoards: "Back to my boards",
  moreLikeThese: "More like these",
  keysTitle: "Keys",
  gate: {
    title: "Keyboard practice",
    body: "Today's practice with just a keyboard. It is a Feature Labs trial for now.",
    turnOn: "Turn it on",
    loading: "Getting your practice ready…",
  },
} as const;

export type LeadKey = keyof typeof KEYS_COPY.lead;

/** The tutor's one-line nudge under the work: for a named bug, else a general first step. */
export function nudgeFor(item: MathItem, bug: BugId | null): string {
  const ones = item.addends.map((n) => digitAt(n, 0));
  const onesSum = ones.reduce((s, n) => s + n, 0);
  switch (bug) {
    case "add_forgot_carry":
      return "Did you add the 1 you carried?";
    case "add_carry_twice":
      return "Add the 1 you carried just once.";
    case "add_whole_column_sum":
      return onesSum >= 10
        ? `${onesSum} ones is 1 ten and ${onesSum - 10} ones. Write the ${onesSum - 10}. Carry the 1.`
        : "Each column gets one digit. Carry the 1.";
    case "add_swapped_places":
      return "Which digit is the tens? Which is the ones?";
    default:
      if (item.kind === "missing_addend" && carryInto(item.addends, 1)) {
        return `Start with the ones. ${ones.join(" + ")} is ${onesSum}. Where does the 1 go?`;
      }
      return `Start with the ones. What is ${ones.join(" + ")}?`;
  }
}
