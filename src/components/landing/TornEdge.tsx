import type { CSSProperties } from "react";
import { tornEdge } from "@/lib/landing/torn";
import styles from "./paper.module.css";

/**
 * Where one band of the page meets another of a different color (v4): the edge of a sheet of paper
 * torn by hand, small and irregular (`tornEdge`, seeded, so it is the same on every render). It sits
 * between the two bands and takes no room:
 *
 *  - `edge="top"`: the band below, torn along its top, reaching up over the band above;
 *  - `edge="bottom"`: the band above, torn along its bottom, reaching down over the band below.
 *
 * `tone` is that band's paper. The tear is the same size at every width (the SVG shows the middle of
 * a 1920 px edge at 1:1, and grows with a wider screen), and it never widens the page. Flat fills
 * only; with `fiber`, the torn paper's paler core shows along the edge. Decorative.
 */

/** The page's papers (paper.module.css maps each to its token in landing.module.css). */
export type PaperTone = "paper" | "deep" | "white" | "brown" | "blue";

export interface TornEdgeProps {
  tone: PaperTone;
  edge?: "top" | "bottom";
  /** this tear's seed: every tear on the page has its own */
  seed: number;
  /** how deep it bites, in px */
  depth?: number;
  fiber?: boolean;
}

export function TornEdge({ tone, edge = "top", seed, depth = 8, fiber = false }: TornEdgeProps) {
  const shape = tornEdge({ seed, depth, fiber });
  return (
    <div className={`${styles.tear} ${edge === "top" ? styles.up : styles.down} ${styles[tone]}`} aria-hidden>
      <svg
        viewBox={`0 0 ${shape.width} ${shape.height}`}
        preserveAspectRatio="xMidYMax slice"
        focusable="false"
        style={{ "--tear-h": shape.height } as CSSProperties}
      >
        {shape.fiber && <path className={styles.fiber} d={shape.fiber} />}
        <path className={styles.sheet} d={shape.d} />
      </svg>
    </div>
  );
}
