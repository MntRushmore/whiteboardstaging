/**
 * "Show me a step"'s line in the tutor's hand (`TryInkSchema`): the hand engine's strokes as SVG
 * paths and a writing schedule (`handInk`, the landing page's hand), at the size the try page
 * writes its problem in (`HandMath`'s default, 40 px cap height), with a seed fixed by the problem
 * and the line so the same step is always written the same way.
 */
import { handInk } from "@/lib/landing/handInk";
import type { TryInk, TryProblem } from "@/lib/try/contracts";

/** The hand's cap height in px: `HandMath`'s default, the problem's own size on the page. */
export const TRY_HAND_SIZE = 40;

/** FNV-1a of the key (as `handSeedFor` in src/lib/live/handwriting.ts, which this does not import: it brings tldraw). */
export function trySeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The line in the tutor's hand, or null when the hand cannot write it (`handInk` throws: never half a line). */
export function tryInk(problem: Pick<TryProblem, "id">, latex: string): TryInk | null {
  try {
    return handInk(latex, { size: TRY_HAND_SIZE, seed: trySeed(`${problem.id}|${latex}`) });
  } catch {
    return null;
  }
}
