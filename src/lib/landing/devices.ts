/**
 * "Pencil, finger or mouse." (`Devices.tsx`): the timing of its three moments, worked out once on
 * the server so the pictures can play them as CSS.
 *
 *  - The tablet and the phone (`inkTimeline`): a real board's ink drawn back over its screenshot
 *    (`devicesInk.ts`), stroke by stroke at a quick child's pace, each line's check mark a beat
 *    after the line, as the board's tutor marks it once the pen rests.
 *  - The laptop (`mouseDemo`): a line written with the mouse, right on the board, at a mouse's
 *    slower pace, the pointer travelling with the pen; the tutor checks it. (Type it, the typing bar,
 *    was removed on 2026-10-13: "remove the typing thing, we can just use the mouse!")
 *
 * Pure: no React, no DOM. Unit-tested in `__tests__/devices.test.ts`.
 */
import type { InkPictureScene } from "./devicesInk";

/** How a picture's ink is paced, in ms (px are the screenshot's own CSS px). */
export const INK_PACE = {
  /** a beat once the picture is in view */
  startMs: 400,
  /** per px of stroke: a quick child's hand */
  msPerPx: 1.7,
  minStrokeMs: 90,
  maxStrokeMs: 300,
  /** the pen lifting between strokes */
  liftMs: 50,
  /** after a line, before the tutor's check */
  beforeCheckMs: 300,
  checkMs: 260,
  /** after the check, before the next line starts */
  afterLineMs: 320,
} as const;

export type InkPace = typeof INK_PACE;

export interface TimedStroke {
  d: string;
  atMs: number;
  forMs: number;
}

export interface TimedLine {
  says: string;
  pen: number;
  kid: TimedStroke[];
  check: TimedStroke;
}

/** Every line of a picture, one after another: its strokes in order, then its check mark. */
export function inkTimeline(scene: Pick<InkPictureScene, "lines">, pace: InkPace = INK_PACE, startMs: number = pace.startMs): { lines: TimedLine[]; endMs: number } {
  let t = startMs;
  const lines = scene.lines.map((line) => {
    const kid = line.kid.map((stroke, i) => {
      if (i > 0) t += pace.liftMs;
      const forMs = Math.round(Math.min(pace.maxStrokeMs, Math.max(pace.minStrokeMs, stroke.len * pace.msPerPx)));
      const timed = { d: stroke.d, atMs: t, forMs };
      t += forMs;
      return timed;
    });
    t += pace.beforeCheckMs;
    const check = { d: line.check.d, atMs: t, forMs: pace.checkMs };
    t += pace.checkMs + pace.afterLineMs;
    return { says: line.says, pen: line.pen, kid, check };
  });
  const last = lines.at(-1);
  return { lines, endMs: last ? last.check.atMs + last.check.forMs : startMs };
}

/** The laptop's pace, in ms after the laptop is in view. */
export const MOUSE_PACE = {
  /** the board is seen first, the pointer resting where the line will go */
  writeAtMs: 900,
  /** a mouse writes slower than a pen on glass */
  writeSpeed: 0.8,
  /** after the line, before the tutor's check (the board marks it once the hand rests) */
  checkAfterMs: 420,
  checkMs: 260,
} as const;

export interface MouseDemo {
  /** the board starts writing the line */
  writeMs: number;
  /** the line is written: the pointer rests */
  doneMs: number;
  /** the tutor's check */
  checkAtMs: number;
  checkMs: number;
}

/** The laptop's moment, from how long the hand takes to write its line (`handMathMs` at writeSpeed). */
export function mouseDemo(lineMs: number, pace = MOUSE_PACE): MouseDemo {
  const writeMs = pace.writeAtMs;
  const doneMs = writeMs + Math.max(0, lineMs);
  return { writeMs, doneMs, checkAtMs: doneMs + pace.checkAfterMs, checkMs: pace.checkMs };
}
