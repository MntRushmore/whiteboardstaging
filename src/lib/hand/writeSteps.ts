/**
 * Several LaTeX lines stacked down a page, the way someone works a problem.
 *
 * Feed it `engine.solveLatex().steps` (or any list of LaTeX lines): every line is laid
 * out by `layoutMath`, then placed on a baseline grid with one shared left margin and
 * a guaranteed ink gap, so a step never collides with the one above it.
 */

import { NOTE_HAND_SIZE } from "./compose";
import { layoutMath, placeStrokes, type MathLayoutOptions, type Stroke } from "./mathLayout";

/** One written line inside the block. `strokes` are already in block coordinates. */
export type StepLine = {
  /** The LaTeX this line was written from. */
  latex: string;
  strokes: Stroke[];
  /** Baseline of this line, measured from the top of the block. */
  y: number;
  /** Ink width of this line. */
  width: number;
  /** Constructs this line could not draw; non-empty means fall back for this line. */
  unsupported: string[];
};

export type StepsLayout = {
  lines: StepLine[];
  width: number;
  height: number;
  /** Union of every line's `unsupported`, so a caller can fall back wholesale. */
  unsupported: string[];
};

export type StepsOptions = MathLayoutOptions & {
  /** x every line starts at. Default 0. */
  left?: number;
  /** Baseline-to-baseline distance in px. Default 1.7 x size. */
  lineHeight?: number;
  /** Minimum ink gap between one line's descenders and the next line's ascenders. */
  lineGap?: number;
};

/** Distinct seed per line so consecutive lines are not written identically. */
const LINE_SEED_STRIDE = 1009;

export function layoutSteps(steps: readonly string[], opts: StepsOptions = {}): StepsLayout {
  const size = opts.size ?? NOTE_HAND_SIZE;
  const seed = opts.seed ?? 1;
  const left = opts.left ?? 0;
  const lineHeight = opts.lineHeight ?? size * 1.7;
  const lineGap = opts.lineGap ?? size * 0.32;

  const lines: StepLine[] = [];
  const unsupported: string[] = [];
  let width = 0;
  let baseline = 0;
  let prevDescent = 0;

  for (let i = 0; i < steps.length; i++) {
    const latex = steps[i];
    const laid = layoutMath(latex, { size, seed: seed + i * LINE_SEED_STRIDE });
    const ascent = laid.baseline;
    const descent = laid.height - laid.baseline;

    if (i === 0) baseline = ascent;
    else baseline = baseline + Math.max(lineHeight, prevDescent + ascent + lineGap);

    lines.push({
      latex,
      strokes: placeStrokes(laid.strokes, { x: left, y: baseline - laid.baseline }),
      y: baseline,
      width: laid.width,
      unsupported: laid.unsupported,
    });
    for (const u of laid.unsupported) {
      if (!unsupported.includes(u)) unsupported.push(u);
    }

    width = Math.max(width, left + laid.width);
    prevDescent = descent;
  }

  return { lines, width, height: lines.length === 0 ? 0 : baseline + prevDescent, unsupported };
}
