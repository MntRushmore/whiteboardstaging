/**
 * The free board's words (`freeBoard.ts`): the home's banner and the board's sheet at the moment of
 * the win. Calm and short (docs/LANDING-V3.md's house rules: no emoji, no sparkle, no hype). The
 * trial's length and price only from the plan (`planWords`, from UNLIMITED_PLAN); the plan screen
 * itself (`/welcome/plan`) says the rest. Not in the board's first load: the banner is the home's,
 * and the sheet is a lazy chunk.
 */
import { planWords } from "@/lib/landing/plan";

const plan = planWords();

/** A first name for "Nice work, Sam!": the display name's first word, when it looks like a name. */
export function sheetName(displayName: string | null | undefined): string | null {
  const first = typeof displayName === "string" ? displayName.trim().split(/\s+/)[0] : "";
  if (!first || first.length > 24 || /[@\d]/.test(first)) return null;
  return first;
}

export const FREE_BOARD_COPY = {
  /** the home's banner, while the free board has problems left */
  progress: (done: number, goal: number) => `${Math.min(done, goal)} of ${goal} problems on your free board`,
  /** …when the problems could not be read */
  progressUnknown: "You're on your free board",
  /** the banner's quiet second line */
  bannerHint: `Then keep going with ${plan.name}, free for ${plan.days}.`,
  openBoard: "Open it",
  start: "Start your free trial",
  /** the sheet: the problems are done */
  problemsTitle: (name: string | null) => (name ? `Nice work, ${name}!` : "Nice work!"),
  problemsBody: (name: string | null, goal: number) => `${name ?? "You"} finished ${goal} problems.`,
  /** the sheet: the starter ink is gone */
  inkTitle: "That's your free board done.",
  inkBody: "Your board is saved.",
  keepGoing: "Start your free trial to keep going.",
  /** the plan's terms, small, under the button */
  terms: plan.terms,
  notNow: "Not now",
} as const;
