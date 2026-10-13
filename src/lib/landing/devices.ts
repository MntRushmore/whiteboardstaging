/**
 * "Pencil, finger or keyboard." (v3, `Devices.tsx`): the timing of its three moments, worked out
 * once on the server so the pictures can play them as CSS.
 *
 *  - The tablet and the phone (`inkTimeline`): a real board's ink drawn back over its screenshot
 *    (`devicesInk.ts`), stroke by stroke at a quick child's pace, each line's check mark a beat
 *    after the line, as the board's tutor marks it once the pen rests.
 *  - The laptop (`typingDemo`): Type it, as the bar does it. A line is typed key by key, the bar's
 *    preview showing what the real parser makes of it after each key (`plainToLatex`, the bar's
 *    own); Enter; the box empties and the board writes the line; the tutor checks it.
 *
 * Pure: no React, no DOM. Unit-tested in `__tests__/devices.test.ts`.
 */
import { plainToLatex } from "@/lib/typeMath/parse";
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
export const TYPING_PACE = {
  /** the board and the bar are seen first, the box focused and waiting */
  typeAtMs: 1100,
  /** between keys, by what is typed: a reach for = is slower than the next digit */
  keyMs: { digit: 150, letter: 190, symbol: 260 },
  /** after the last key, before Enter */
  enterAfterMs: 700,
  /** Enter's press */
  pressMs: 160,
  /** the board writes the line: quickly (on the board it is there at once), in the board's hand */
  writeSpeed: 2.6,
  /** after the line, before the tutor's check */
  checkAfterMs: 520,
  checkMs: 260,
  /** the caret shows where the next line goes */
  caretAfterMs: 380,
} as const;

export interface Keystroke {
  char: string;
  atMs: number;
}

/** What the preview shows from one key to the next: the parser's reading of the box so far. */
export interface PreviewStep {
  text: string;
  latex: string;
  fromMs: number;
  /** when the next key (or Enter) replaces it */
  toMs: number;
}

export interface TypingDemo {
  /** the line as the board writes it (the parser's LaTeX) */
  latex: string;
  keys: Keystroke[];
  previews: PreviewStep[];
  /** the first key: the box has text, the preview opens, Enter wakes up */
  firstMs: number;
  /** Enter pressed */
  enterMs: number;
  /** the box empty again */
  clearMs: number;
  /** the board starts writing the line */
  writeMs: number;
}

function keyGap(char: string): number {
  if (/\d/.test(char)) return TYPING_PACE.keyMs.digit;
  if (/[a-z]/i.test(char)) return TYPING_PACE.keyMs.letter;
  return TYPING_PACE.keyMs.symbol;
}

/**
 * The laptop's Type it, key by key. Throws if the parser cannot read the whole line: the page never
 * types a line the bar would refuse.
 */
export function typingDemo(text: string, pace = TYPING_PACE): TypingDemo {
  const whole = plainToLatex(text);
  if (!whole.ok) throw new Error(`typingDemo: the bar cannot read ${JSON.stringify(text)} (${whole.hint})`);
  let t = pace.typeAtMs;
  const keys = [...text].map((char, i) => {
    if (i > 0) t += keyGap(char);
    return { char, atMs: t };
  });
  const enterMs = t + pace.enterAfterMs;
  const clearMs = enterMs + pace.pressMs;
  const previews = keys.map((key, i) => {
    const typed = text.slice(0, i + 1);
    const parse = plainToLatex(typed);
    return { text: typed, latex: parse.ok ? parse.latex : parse.partial, fromMs: key.atMs, toMs: keys[i + 1]?.atMs ?? clearMs };
  });
  return { latex: whole.latex, keys, previews, firstMs: keys[0]?.atMs ?? enterMs, enterMs, clearMs, writeMs: clearMs + 60 };
}
