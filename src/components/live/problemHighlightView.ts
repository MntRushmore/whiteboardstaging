/**
 * Pure view logic for the outline around the problem Help me / Solve it act on (`ProblemHighlight`).
 *
 * The outline answers "which one will it do?" only when that is a question: with two or more
 * problems on the screen, and only at the moments a student is about to ask or has just asked —
 * never as a permanent frame around their work.
 *
 *  - while the button is hovered or has keyboard focus (a desktop student about to ask);
 *  - while their ask is being answered (the check or solve it started is still open);
 *  - for a moment when the target moves to another problem — the pen started on a new one, or they
 *    picked one with the select tool — so a touch student, who never hovers, sees "now this one".
 */
import type { Rect } from "@/lib/live/contracts";
import type { HelpTarget } from "@/lib/live/helpTarget";

export const HIGHLIGHT = {
  /** how long the outline shows after the target moves to another problem */
  changeMs: 1500,
  /** how long it shows after an ask, however fast the answer */
  askMs: 1500,
  /** a check or solve that opens this soon after an ask is that ask's */
  askSlackMs: 2000,
  /** space between the ink and the outline (screen px) */
  padPx: 10,
} as const;

export interface HighlightInput {
  target: HelpTarget | null;
  /** the ask button is hovered or keyboard-focused (`liveStore.askHover`) */
  hovered: boolean;
  /** when Help or Solve was last asked for (ms; 0: never) */
  askedAt: number;
  /** a check or solve is open (the pill says Checking / Solving) */
  busy: boolean;
  /** when Live last went from idle to busy (ms) */
  busySince: number;
  now: number;
}

/** Whether the outline shows now (it is never drawn with fewer than two problems on the screen). */
export function highlightVisible(s: HighlightInput): boolean {
  const t = s.target;
  if (!t || t.problems < 2) return false;
  if (s.hovered) return true;
  if (t.changedAt > 0 && s.now - t.changedAt < HIGHLIGHT.changeMs) return true;
  if (s.askedAt <= 0) return false;
  if (s.now - s.askedAt < HIGHLIGHT.askMs) return true;
  // still being answered: busy since (about) the ask — a check that opened long after it is not its answer
  return s.busy && s.busySince <= s.askedAt + HIGHLIGHT.askSlackMs;
}

/** How long until the clock alone changes `highlightVisible` (ms), or null when nothing is timed. */
export function highlightWakeIn(s: HighlightInput): number | null {
  if (!s.target) return null;
  const left = [s.target.changedAt + HIGHLIGHT.changeMs, s.askedAt + HIGHLIGHT.askMs].map((t) => t - s.now).filter((d) => d > 0);
  return left.length > 0 ? Math.min(...left) : null;
}

/**
 * Where the outline goes inside the board's container: the problem's page box through the camera
 * (`toScreen`, the editor's `pageToScreen`), relative to the container's origin, padded.
 */
export function highlightBox(
  bounds: Rect,
  toScreen: (p: { x: number; y: number }) => { x: number; y: number },
  origin: { x: number; y: number },
  pad: number = HIGHLIGHT.padPx,
): { left: number; top: number; width: number; height: number } {
  const a = toScreen({ x: bounds.x, y: bounds.y });
  const b = toScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h });
  return { left: a.x - origin.x - pad, top: a.y - origin.y - pad, width: b.x - a.x + 2 * pad, height: b.y - a.y + 2 * pad };
}
