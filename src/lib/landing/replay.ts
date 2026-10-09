/**
 * The landing page's hero replay, as a timeline (2026-10-09, Phase 2 "parents recommend it"). A
 * parent who has never seen Agathon learns what it does in ten seconds by watching it: a sum is
 * written, the tutor ticks it and cheers; a slip is written, the tutor rings it and says "So close!".
 * The marks are the ones the board's tutor drew (`boardInk.ts`), and every word the board says comes
 * from the board's own `celebrate()`, so the replay can only show what the product would.
 *
 * Pure: lines and a layout in, each stroke's start and length of time out, for CSS animations to
 * play (`BoardReplay.tsx`). No React, no DOM. Unit-tested in `__tests__/replay.test.ts`.
 */
import type { InkLine, InkStroke } from "@/lib/landing/boardInk";
import { celebrate, INITIAL_CELEBRATE, STREAK_FROM, streakText, type CelebrateState } from "@/lib/live/celebrate";

/**
 * How the replay is paced, in milliseconds. A stroke takes time in proportion to its length, so a
 * long `8` takes longer than a `-`, at about a quick child's writing speed; the tutor's mark comes a
 * beat after the line is done, as it does on the board once the student pauses.
 */
export const REPLAY_TIMING = {
  /** before the first stroke: the page settles first */
  startMs: 600,
  /** per unit of stroke length */
  msPerUnit: 2.4,
  minStrokeMs: 90,
  maxStrokeMs: 320,
  /** the pen lifting between strokes */
  liftMs: 45,
  /** the pause after a line before the tutor marks it */
  beforeMarkMs: 320,
  tickMs: 300,
  ringMs: 650,
  /** how long a cheer for a right answer stays up (a "try again" stays to the end) */
  cheerMs: 1500,
  /** after the mark, before the next line starts */
  afterLineMs: 450,
} as const;

export type ReplayTiming = typeof REPLAY_TIMING;

/** One stroke to draw: who wrote it, when it starts and how long it takes. */
export interface ReplayStroke {
  d: string;
  ink: "student" | "tutor";
  delayMs: number;
  durationMs: number;
}

/** What the board says when the line is marked: a cheer for a tick, a kind word for a ring. */
export interface ReplayCheer {
  tone: "win" | "miss";
  text: string;
  /** "3 in a row!" from STREAK_FROM right answers in a row, else null */
  streak: string | null;
  showMs: number;
  /** when it goes; null keeps it up to the end (a ring's "try again", the still frame's story) */
  hideMs: number | null;
}

/** A line, placed on the board (board units), with its strokes and its cheer. */
export interface ReplayLine {
  latex: string;
  x: number;
  y: number;
  width: number;
  height: number;
  mark: InkLine["mark"]["kind"];
  strokes: ReplayStroke[];
  cheer: ReplayCheer;
}

export interface Replay {
  lines: ReplayLine[];
  /** when the last stroke is drawn */
  endMs: number;
}

/**
 * The box round a stroke's path (`M x y L x y …` as `boardInk.ts` writes them), for drawing one mark
 * on its own at any size: the key under the iPad.
 */
export function pathBounds(d: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    minX = Math.min(minX, nums[i]);
    maxX = Math.max(maxX, nums[i]);
    minY = Math.min(minY, nums[i + 1]);
    maxY = Math.max(maxY, nums[i + 1]);
  }
  return nums.length < 2 ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}

/** How long one stroke takes to draw. */
export function strokeMs(stroke: InkStroke, timing: ReplayTiming = REPLAY_TIMING): number {
  return Math.round(Math.min(timing.maxStrokeMs, Math.max(timing.minStrokeMs, stroke.len * timing.msPerUnit)));
}

/**
 * The lines one under another like a worksheet: each line's top-left, `gap` units below the one
 * before, placed so the student's writing starts at x = 0 on every line (a ring reaches out to the
 * left of the writing it circles, so its line starts further left).
 */
export function stackLines(lines: readonly InkLine[], gap: number): { x: number; y: number }[] {
  let y = 0;
  return lines.map((line) => {
    const at = { x: -line.inkX, y };
    y += line.height + gap;
    return at;
  });
}

/**
 * The replay: every line's strokes in the order written, one after another, the tutor's mark a
 * beat after each line, and what the board says as it marks it (`celebrate`, the board's own words,
 * in the same order the board would say them).
 */
export function replayTimeline(
  lines: readonly InkLine[],
  places: readonly { x: number; y: number }[],
  timing: ReplayTiming = REPLAY_TIMING,
): Replay {
  let t: number = timing.startMs;
  let said: CelebrateState = INITIAL_CELEBRATE;
  const out: ReplayLine[] = lines.map((line, i) => {
    const strokes: ReplayStroke[] = [];
    line.kid.forEach((stroke, k) => {
      if (k > 0) t += timing.liftMs;
      const durationMs = strokeMs(stroke, timing);
      strokes.push({ d: stroke.d, ink: "student", delayMs: t, durationMs });
      t += durationMs;
    });
    t += timing.beforeMarkMs;
    const markMs = line.mark.kind === "ring" ? timing.ringMs : timing.tickMs;
    strokes.push({ d: line.mark.stroke.d, ink: "tutor", delayMs: t, durationMs: markMs });
    t += markMs;

    const { state, cheer } = celebrate(said, `line-${i}`, line.mark.kind === "ring" ? "circle" : "check");
    said = state;
    // Every line here is a new verdict, so celebrate always has something to say.
    const tone = cheer?.tone ?? (line.mark.kind === "ring" ? "miss" : "win");
    const streak = cheer?.tone === "win" && cheer.streak >= STREAK_FROM ? streakText(cheer.streak) : null;
    const replayCheer: ReplayCheer = {
      tone,
      text: cheer?.text ?? "",
      streak,
      showMs: t,
      hideMs: tone === "win" ? t + timing.cheerMs : null,
    };
    const place = places[i] ?? { x: 0, y: 0 };
    const placed: ReplayLine = {
      latex: line.latex,
      x: place.x,
      y: place.y,
      width: line.width,
      height: line.height,
      mark: line.mark.kind,
      strokes,
      cheer: replayCheer,
    };
    t += timing.afterLineMs;
    return placed;
  });
  const last = out.at(-1)?.strokes.at(-1);
  return { lines: out, endMs: last ? last.delayMs + last.durationMs : 0 };
}
