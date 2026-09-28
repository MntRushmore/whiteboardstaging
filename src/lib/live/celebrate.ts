/**
 * What the board says when the tutor marks a student's line: a cheer for a tick (with confetti,
 * and a streak count from three right in a row), a kind word for a ring. Pure, so the board's
 * `Celebrations` layer only has to feed it marks and draw what it returns.
 *
 * A line cheers once per verdict: the tutor redraws its mark when the line grows or moves, and a
 * tick that is written again for the same line is not a new right answer. A ring then a tick on
 * the same line (fixed) is.
 */

export type VerdictKind = "check" | "circle";

export interface CelebrateState {
  /** the last verdict each line got, by line id */
  verdicts: Readonly<Record<string, VerdictKind>>;
  /** ticks in a row since the last ring */
  streak: number;
  /** ticks so far on this board (picks the next cheer, so two in a row never match) */
  wins: number;
  /** rings so far on this board */
  misses: number;
}

export type Cheer =
  /** `streak`: shown (as `streakText`) from `STREAK_FROM` up */
  | { tone: "win"; text: string; streak: number; burst: "small" | "big" }
  | { tone: "miss"; text: string };

export const INITIAL_CELEBRATE: CelebrateState = { verdicts: {}, streak: 0, wins: 0, misses: 0 };

export const CHEERS = ["Nice!", "You got it!", "Nailed it!", "Great step!", "Awesome!", "Spot on!", "Yes!", "Brilliant!"] as const;

export const MISS_WORDS = ["So close! Try that step again.", "Almost! Give it another go.", "Oops! Mistakes help you learn."] as const;

/** from this many right in a row, the cheer says how many */
export const STREAK_FROM = 3;
/** streaks that get the big burst */
export const STREAK_MILESTONES: readonly number[] = [5, 10, 15, 20, 25, 50];

export function streakText(streak: number): string {
  return `${streak} in a row!`;
}

/** The tutor put `kind` on `lineId`: the next state, and what to say (null: nothing new). */
export function celebrate(state: CelebrateState, lineId: string, kind: VerdictKind): { state: CelebrateState; cheer: Cheer | null } {
  if (state.verdicts[lineId] === kind) return { state, cheer: null };
  const verdicts = { ...state.verdicts, [lineId]: kind };
  if (kind === "circle") {
    const next = { ...state, verdicts, streak: 0, misses: state.misses + 1 };
    return { state: next, cheer: { tone: "miss", text: MISS_WORDS[state.misses % MISS_WORDS.length] } };
  }
  const streak = state.streak + 1;
  const next = { ...state, verdicts, streak, wins: state.wins + 1 };
  const text = CHEERS[state.wins % CHEERS.length];
  const burst = STREAK_MILESTONES.includes(streak) ? "big" : "small";
  return { state: next, cheer: { tone: "win", text, streak, burst } };
}
