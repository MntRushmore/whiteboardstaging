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

// ---------------------------------------------------------------- when a mark counts

/** a tick: a line read half-written can be ticked and then re-marked a moment later */
export const SETTLE_MS = 700;
/**
 * A ring waits longer before it costs the student anything (the kind word, the streak). A student
 * who lifts the pen mid-line — before the last stroke of the 12 in `2x = 12` — has the half line
 * read (`2x = 1`) and ringed once the quiet gate runs out; finishing it re-reads and ticks it about
 * 1.3 s later (the 600 ms gate, recognition, the check). 3 s covers that pause and that re-read.
 */
export const MISS_SETTLE_MS = 3000;

export interface LineBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The line a mark was put on, from its key (`markKey`: kind, then the line's rect in 4 px units). */
export function markLine(mark: string): LineBox | null {
  const nums = mark.slice(mark.indexOf(":") + 1).split(",").map(Number);
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = nums.map((n) => n * 4);
  return { x, y, w, h };
}

/**
 * The student's new ink is that line being written on: it overlaps the line's row and lies on it
 * or just past its right end (two line heights), where the rest of a half-written line goes.
 */
export function inkExtendsLine(ink: LineBox, line: LineBox): boolean {
  const vOverlap = Math.min(ink.y + ink.h, line.y + line.h) - Math.max(ink.y, line.y);
  if (vOverlap < 0.3 * Math.min(Math.max(ink.h, 1), Math.max(line.h, 1))) return false;
  return ink.x + ink.w >= line.x && ink.x <= line.x + line.w + 2 * line.h;
}

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void };

/**
 * Turns the tutor's marks as they land into verdicts worth a cheer (`onVerdict`), one per line: a
 * line's newer mark replaces its waiting one; a tick counts after `SETTLE_MS`, a ring only after
 * `MISS_SETTLE_MS`, and a waiting ring is dropped — no kind word, no streak lost — when the tutor
 * takes it off (the line was read again) or the student writes on that line before it counts.
 */
export class MarkSettler {
  private readonly pending = new Map<string, { timer: unknown; kind: VerdictKind; line: LineBox | null }>();

  constructor(
    private readonly onVerdict: (lineId: string, kind: VerdictKind) => void,
    private readonly timers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) },
  ) {}

  /** A mark of `kind` was put on `lineId`; `mark` is its key (`meta.mark`). */
  mark(lineId: string, kind: VerdictKind, mark: string): void {
    this.drop(lineId);
    const timer = this.timers.set(
      () => {
        this.pending.delete(lineId);
        this.onVerdict(lineId, kind);
      },
      kind === "circle" ? MISS_SETTLE_MS : SETTLE_MS,
    );
    this.pending.set(lineId, { timer, kind, line: kind === "circle" ? markLine(mark) : null });
  }

  /** A mark was taken off its line: a ring still waiting no longer counts. */
  markRemoved(lineId: string, kind: VerdictKind): void {
    if (this.pending.get(lineId)?.kind === kind && kind === "circle") this.drop(lineId);
  }

  /** The student finished a stroke here (page coordinates): a waiting ring on the line it extends goes. */
  ink(box: LineBox): void {
    for (const [lineId, p] of [...this.pending]) {
      if (p.kind === "circle" && p.line && inkExtendsLine(box, p.line)) this.drop(lineId);
    }
  }

  dispose(): void {
    for (const p of this.pending.values()) this.timers.clear(p.timer);
    this.pending.clear();
  }

  private drop(lineId: string): void {
    const p = this.pending.get(lineId);
    if (!p) return;
    this.timers.clear(p.timer);
    this.pending.delete(lineId);
  }
}
