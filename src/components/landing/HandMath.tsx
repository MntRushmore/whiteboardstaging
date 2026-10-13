import type { CSSProperties } from "react";
import { handInk } from "@/lib/landing/handInk";
import { INK_DRAW_ATTR } from "./inkStart";
import styles from "./ink.module.css";

/**
 * A line of maths written in the board's hand (`handInk`, from the hand engine), as an SVG: in the
 * kid's pen (the board's black), the tutor's blue, or white for a dark band. Server-rendered and
 * static. With `draw`, it writes itself stroke by stroke at a child's pace once it is in view
 * (INK_START_SCRIPT holds it till then); `startMs` delays the first stroke. Decorative unless given
 * a `label`.
 */
export interface HandMathProps {
  latex: string;
  /** cap height in px at the SVG's natural size; CSS may scale the SVG (it keeps its aspect) */
  size?: number;
  ink?: "kid" | "tutor" | "white";
  seed?: number;
  /** a key, unique on the page: write it stroke by stroke once in view */
  draw?: string;
  startMs?: number;
  speed?: number;
  /** the pen's width in px at `size`; default a marker's, about a ninth of the cap height */
  pen?: number;
  /** read out instead of the strokes (e.g. "6 times 7 equals 42"); without it the SVG is hidden */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function HandMath({ latex, size = 40, ink = "kid", seed = 1, draw, startMs = 0, speed = 1, pen, label, className, style }: HandMathProps) {
  const hand = handInk(latex, { size, seed, speed });
  const width = pen ?? size / 9;
  const pad = width;
  return (
    <svg
      className={[styles.hand, styles[ink], draw ? styles.draw : "", className].filter(Boolean).join(" ")}
      viewBox={`${-pad} ${-pad} ${round(hand.width + 2 * pad)} ${round(hand.height + 2 * pad)}`}
      width={round(hand.width + 2 * pad)}
      height={round(hand.height + 2 * pad)}
      style={style}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      {...(draw ? { [INK_DRAW_ATTR]: draw } : {})}
    >
      {hand.strokes.map((stroke, i) => (
        <path
          key={i}
          d={stroke.d}
          pathLength={1}
          strokeWidth={round(width * stroke.weight)}
          style={draw ? ({ "--at": `${startMs + stroke.atMs}ms`, "--for": `${stroke.forMs}ms` } as CSSProperties) : undefined}
        />
      ))}
    </svg>
  );
}

/** How long `HandMath` takes to write `latex` (to time what follows it, such as a check mark). */
export function handMathMs(latex: string, { size = 40, seed = 1, speed = 1 }: { size?: number; seed?: number; speed?: number } = {}): number {
  return handInk(latex, { size, seed, speed }).durationMs;
}

const round = (n: number) => Math.round(n * 10) / 10;
