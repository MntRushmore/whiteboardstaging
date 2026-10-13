/**
 * The problem strip under the hero (v3, `ProblemStrip.tsx`): one line from each grade's path, written
 * in the board's hand and checked, drifting slowly sideways. This file is its arithmetic: how a line
 * is read out to a screen reader, where each line's writing line sits so the row reads level, when
 * each line writes itself in on the first pass, and how long one lap of the drift takes.
 *
 * Pure: no React, no DOM, no network. Unit-tested in `__tests__/strip.test.ts`, which also checks
 * that every line is true.
 */
import { handInk } from "./handInk";

export interface StripItem {
  /** "K", "1st" … "8th" */
  grade: string;
  /** what the kid wrote, as LaTeX (the hand engine's input) */
  latex: string;
}

/** "K" → "Kindergarten", "3rd" → "3rd grade". */
export function gradeName(grade: string): string {
  return grade === "K" ? "Kindergarten" : `${grade} grade`;
}

/**
 * A line of the strip's LaTeX as plain, readable maths: "6 × 7 = 42", "3/4 = 6/8", "−3 + 8 = 5",
 * "3² + 4² = 5²". Only what the strip writes (+, −, ×, ÷, =, fractions, decimals, squares).
 */
export function readableMath(latex: string): string {
  const SUPERSCRIPT: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
  return latex
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\^\{?(\d+)\}?/g, (_, n: string) => [...n].map((d) => SUPERSCRIPT[d]).join(""))
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\cdot/g, "·")
    .replace(/\\[,;! ]/g, " ")
    .replace(/\s+/g, "")
    // spaces round an operator after a number (a leading minus stays on its number)
    .replace(/(?<=[\w²³⁰¹⁴-⁹)])([+\-×÷=])/g, " $1 ")
    .replace(/-/g, "−")
    .trim();
}

/** What a screen reader hears for one line of the strip, once: "3rd grade: 6 × 7 = 42". */
export function stripItemLabel(item: StripItem): string {
  return `${gradeName(item.grade)}: ${readableMath(item.latex)}`;
}

/**
 * The strip's LaTeX as an expression a calculator reads (`\frac{a}{b}` → `(a)/(b)`, `\times` → `*`,
 * `\div` → `/`, `^{2}` → `^(2)`), split at its one `=`. For the test that every line is true.
 */
export function equationSides(latex: string): [string, string] {
  const plain = latex
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "(($1)/($2))")
    .replace(/\\times|\\cdot/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\[,;! ]/g, "")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")");
  const sides = plain.split("=");
  if (sides.length !== 2) throw new Error(`equationSides: ${JSON.stringify(latex)} is not one equation`);
  return [sides[0].trim(), sides[1].trim()];
}

/** How the strip's hand is set: its size (the hand engine's `size`), seed and pace. */
export const STRIP_HAND = { size: 40, seed: 3, speed: 1.15 } as const;

/** The first pass: each line starts this long after the one before, and the check follows the line. */
export const STRIP_WRITE = { firstMs: 250, staggerMs: 520, checkAfterMs: 140, checkMs: 260 } as const;

export interface StripLine extends StripItem {
  label: string;
  /** the SVG's box at `STRIP_HAND.size`, the pen's padding included (as `HandMath` draws it) */
  width: number;
  height: number;
  /**
   * px to move the SVG down so the middle of its digits (where an `=` sits) is level with the
   * middle of the row: a fraction's main line sits low in its box, a square's high
   */
  shift: number;
  /** when this line starts writing on the first pass, and when its check mark goes on */
  startMs: number;
  checkAtMs: number;
}

/**
 * Each line of the strip, measured and timed for the first pass. The SVGs are centred in the row;
 * `shift` puts every line's writing on one level, as on ruled paper.
 */
export function stripLines(items: readonly StripItem[], hand = STRIP_HAND, write = STRIP_WRITE): StripLine[] {
  const pad = hand.size / 9;
  // the digits' height: a line of plain digits sits on the writing line, so its baseline is it
  const digits = handInk("8", hand).baseline;
  return items.map((item, i) => {
    const ink = handInk(item.latex, hand);
    const height = ink.height + 2 * pad;
    const axis = pad + ink.baseline - digits / 2;
    const startMs = write.firstMs + i * write.staggerMs;
    return {
      ...item,
      label: stripItemLabel(item),
      width: round(ink.width + 2 * pad),
      height: round(height),
      shift: round(height / 2 - axis),
      startMs,
      checkAtMs: startMs + ink.durationMs + write.checkAfterMs,
    };
  });
}

/**
 * Seconds for one lap of the drift: the row's width (one copy) at `pxPerSecond`. Slow on purpose:
 * a line takes several seconds to cross a phone, so it can be read.
 */
export function driftSeconds(rowWidthPx: number, pxPerSecond = 26): number {
  return Math.round(rowWidthPx / pxPerSecond);
}

const round = (n: number) => Math.round(n * 10) / 10;
