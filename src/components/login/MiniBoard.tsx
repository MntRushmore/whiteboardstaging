import type { CSSProperties } from "react";
import { BOARD_LINES } from "@/lib/landing/boardInk";
import { pathBounds, stackLines } from "@/lib/landing/replay";
import { MISS_WORDS } from "@/lib/live/celebrate";
import styles from "./miniBoard.module.css";

/**
 * A small, still board for the sign-in panel: three of the landing page's hero lines (the same ink
 * as BoardReplay, src/components/landing/BoardReplay.tsx), with the marks the board's own tutor put
 * on them (a check mark, a circle round a slip, a check mark) and what the board says beside the
 * circle. Static SVG and one HTML bubble, sized by container units so the whole board scales as one
 * picture. Server-rendered; no script, no animation.
 */

/** 7 + 5 = 12 (check mark), 9 - 3 = 5 (circle), 6 x 4 = 24 (check mark) */
const LINES = BOARD_LINES.slice(0, 3);
/** Board units between one line and the next. */
const GAP = 30;
/** Board units between the circle and the bubble beside it (BoardReplay's CHEER_GAP). */
const CHEER_GAP = 14;
/** The bubble, in board units: its type size and its width (two short lines; measured, with room). */
const BUBBLE_FONT = 11.5;
const BUBBLE_WIDTH = 118;
/** Room round the ink, in board units. */
const PAD_X = 46;
const PAD_Y = 36;

const PLACES = stackLines(LINES, GAP);
const RING = LINES.findIndex((line) => line.mark.kind === "ring");

/** Every stroke's box, placed: the ink's true extent, so the board is centred on it, not on a guess. */
const INK = LINES.reduce(
  (box, line, i) => {
    for (const stroke of [...line.kid, line.mark.stroke]) {
      const b = pathBounds(stroke.d);
      box.minX = Math.min(box.minX, PLACES[i].x + b.minX);
      box.maxX = Math.max(box.maxX, PLACES[i].x + b.maxX);
      box.minY = Math.min(box.minY, PLACES[i].y + b.minY);
      box.maxY = Math.max(box.maxY, PLACES[i].y + b.maxY);
    }
    return box;
  },
  { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
);

const BUBBLE_X = PLACES[RING].x + LINES[RING].width + CHEER_GAP;
const BUBBLE_Y = PLACES[RING].y + LINES[RING].height / 2;
const RIGHT = Math.max(INK.maxX, BUBBLE_X + BUBBLE_WIDTH);

const VIEW = {
  x: INK.minX - PAD_X,
  y: INK.minY - PAD_Y,
  width: RIGHT - INK.minX + 2 * PAD_X,
  height: INK.maxY - INK.minY + 2 * PAD_Y,
};

const pct = (value: number, of: number) => `${((value / of) * 100).toFixed(3)}%`;

/** "So close!" over "Try that step again.": the board's first kind word for a slip, in two lines. */
const MISS_LINES = MISS_WORDS[0].split(/(?<=!) /);

export function MiniBoard({ className }: { className?: string }) {
  const bubble = {
    left: pct(BUBBLE_X - VIEW.x, VIEW.width),
    top: pct(BUBBLE_Y - VIEW.y, VIEW.height),
    // board units to the card's width: the bubble scales with the ink
    fontSize: `${((BUBBLE_FONT / VIEW.width) * 100).toFixed(3)}cqw`,
  } as CSSProperties;
  return (
    <figure
      className={[styles.board, className].filter(Boolean).join(" ")}
      style={{ aspectRatio: `${VIEW.width.toFixed(1)} / ${VIEW.height.toFixed(1)}` }}
      aria-label={`A board with three sums written by hand: 7 + 5 = 12 and 6 × 4 = 24 get a blue check mark; 9 − 3 = 5 gets a blue circle and “${MISS_WORDS[0]}”`}
      role="img"
    >
      <svg className={styles.ink} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`} aria-hidden>
        {LINES.map((line, i) => (
          <g key={line.latex} transform={`translate(${PLACES[i].x} ${PLACES[i].y})`}>
            {line.kid.map((stroke, k) => (
              <path key={k} d={stroke.d} className={styles.student} />
            ))}
            <path d={line.mark.stroke.d} className={styles.tutor} />
          </g>
        ))}
      </svg>
      <span className={styles.miss} style={bubble} aria-hidden>
        {MISS_LINES.map((text) => (
          <span key={text}>{text}</span>
        ))}
      </span>
    </figure>
  );
}
