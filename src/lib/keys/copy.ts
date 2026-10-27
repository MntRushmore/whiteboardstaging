/**
 * Every word the kid reads on the Keys page (docs/KEYS.md). Phase 1 is fixed copy, no LLM; Phase 2's
 * tutor wording falls back to these. Short and sure, like a coach: full stops, US English, never the
 * word "wrong".
 */
import type { BugId } from "./bugs";
import { carryInto, cellById, digitAt, placeName, type MathItem } from "./item";

export const KEYS_COPY = {
  title: "Today's practice",
  problemOf: (n: number, count: number) => `Problem ${n} of ${count}`,
  allDone: "All done",
  workHere: "Work it out here",
  stepsHead: "Steps, if you like. Enter adds a line.",
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
  nowYouTry: "Now you try",
  nowYouTryGo: "Now you try one",
  nowYouTryLabel: "Now you try one: a new problem like this one",
  readAloud: "Read the tutor's words aloud",
  readAloudNote: "The words stay on the page too.",
  thinking: "…",
  perfect: (n: number) => `${n} for ${n}`,
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

/**
 * The worked step (Help me's third rung): the column that broke, worked out in the tutor's hand,
 * with what goes where. The kid still types it.
 */
export function workedFor(item: MathItem, bug: BugId | null, cellId?: string): string {
  const cell = cellId ? cellById(item, cellId) : undefined;
  if (item.kind === "missing_addend" && item.hidden) {
    const p = item.hidden.place;
    const carry = carryInto(item.addends, p);
    const others = item.addends.filter((_, i) => i !== item.hidden!.addend).map((n) => digitAt(n, p));
    const missing = digitAt(item.addends[item.hidden.addend], p);
    const total = digitAt(item.total, p);
    const parts = [...(carry ? ["1"] : []), ...others.map(String), String(missing)];
    return `In the ${placeName(p)}: ${parts.join(" + ")} = ${total}. The missing digit is ${missing}.`;
  }
  // a sum: the place that broke; else, for a slip with the carry, the first place that carries; else the ones
  let place = cell && cell.role !== "given" && !cell.spare ? cell.place : -1;
  const aboutCarry = bug === "add_forgot_carry" || bug === "add_carry_twice";
  if (place < 0) place = aboutCarry ? ([1, 2, 3].find((p) => carryInto(item.addends, p)) ?? 0) : 0;
  const carry = carryInto(item.addends, place);
  const digits = item.addends.map((n) => digitAt(n, place));
  const sum = digits.reduce((a, b) => a + b, 0) + carry;
  const parts = [...(carry ? ["1"] : []), ...digits.map(String)].join(" + ");
  const write = `Write the ${sum % 10} in the ${placeName(place)}.`;
  return sum >= 10 ? `${parts} = ${sum}. ${write} Carry the 1 to the ${placeName(place + 1)}.` : `${parts} = ${sum}. ${write}`;
}

// ---------------------------------------------------------------- the tutor's words, said another way

/**
 * The moments the tutor speaks on the Keys page. The words for each come from this file; the
 * server (`/api/keys/say`) may say them another way, never with other facts.
 */
export const SAY_MOMENTS = ["look_again", "nudge", "smaller", "worked", "praise"] as const;
export type SayMoment = (typeof SAY_MOMENTS)[number];

/** How long the page waits for the tutor's own words before it says the fixed line (docs/KEYS.md). */
export const SAY_WAIT_MS = 1500;

/** The longest line the tutor says on the page. */
export const SAY_MAX_CHARS = 140;

/** Words the tutor never says to a kid (DESIGN-SYSTEM.md: "The word 'wrong' never appears."). */
const NEVER = /\b(wrong|incorrect|mistakes?|fail(ed|s|ure)?|bad|oops|uh-oh|stupid|easy|obviously|simply|just)\b/i;

/** The numbers in a line, in order (`1 + 2 + 6 = 9` → 1, 2, 6, 9; `3/4` → 3, 4). */
export function numbersIn(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * Is `line` a fair way to say `copy`? The tutor's judgement is the copy's; another wording may only
 * change the words. So: the same numbers (as a multiset: no number added, none lost), short, plain
 * (no LaTeX, no emoji, at most one exclamation mark), US English, and never a word from NEVER.
 */
export function sayable(line: string, copy: string): boolean {
  const t = line.trim();
  if (!t || t.length > SAY_MAX_CHARS) return false;
  if (NEVER.test(t) && !NEVER.test(copy)) return false;
  if (/[\\$`{}<>_^#*]|\p{Extended_Pictographic}/u.test(t)) return false;
  if ((t.match(/!/g) ?? []).length > 1) return false;
  const a = numbersIn(t).sort();
  const b = numbersIn(copy).sort();
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** A line as the page shows it: one space between words, a full stop at the end. */
export function tidyLine(line: string): string {
  const t = line.replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
  return /[.?!]$/.test(t) ? t : `${t}.`;
}
