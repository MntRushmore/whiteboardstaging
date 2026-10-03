/**
 * A burst of confetti, as data: where each piece flies, how it spins, its colour. Drawn with the
 * global `.celebrate-confetti` animation (globals.css; hidden under prefers-reduced-motion) by the
 * board's cheers (`Celebrations`) and onboarding's (`ConfettiBurst`). Pure and import-free, so the
 * platform pages can use it without pulling in the board's Live code; `random` is injectable for
 * the tests.
 */

export const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#facc15"] as const;

export interface ConfettiPiece {
  /** where it flies to from the burst's origin, px */
  dx: number;
  dy: number;
  /** degrees it turns on the way */
  rot: number;
  color: string;
  /** ms before it sets off */
  delay: number;
  /** a dot rather than a strip */
  round: boolean;
}

/** `count` pieces spread round a circle of about `spread` px, flung a little upwards. */
export function confettiPieces(count: number, spread: number, random: () => number = Math.random): ConfettiPiece[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + random() * 0.6;
    const dist = spread * (0.5 + random() * 0.6);
    return {
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - spread * 0.35,
      rot: (random() - 0.5) * 720,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: random() * 80,
      round: i % 3 === 0,
    };
  });
}
