import type { CSSProperties } from "react";
import type { InkScene } from "@/lib/landing/stepInk";
import { celebrate, INITIAL_CELEBRATE } from "@/lib/live/celebrate";
import styles from "./inkPicture.module.css";

/**
 * A few lines of a real board, drawn as vector ink on the board's own surface: sharp at any size and
 * on any screen, where a screenshot crop goes soft. How it works uses it for its second and third
 * steps (src/lib/landing/stepInk.ts: an equation the tutor marked, and Help me's written step).
 * With `note`, the board's own words for a ring ("So close! Try that step again.", from the board's
 * `celebrate`) sit beside the ring, as the board shows them.
 */

/** Board units of surface round the ink. */
const PAD = 30;
/** Board units between the ring and its note, and how much room the note takes. */
const NOTE_GAP = 14;
const NOTE_ROOM = 190;

/** What the board says when it rings a line: its first "try again". */
export const RING_NOTE = celebrate(INITIAL_CELEBRATE, "landing-ring", "circle").cheer?.text ?? "";

export function InkPicture({ scene, note = false, label }: { scene: InkScene; note?: boolean; label: string }) {
  const withNote = note && scene.ring !== null;
  const width = scene.width + 2 * PAD + (withNote ? NOTE_ROOM : 0);
  const height = scene.height + 2 * PAD;
  const noteStyle =
    withNote && scene.ring
      ? ({
          left: `${(((PAD + scene.ring.right + NOTE_GAP) / width) * 100).toFixed(3)}%`,
          top: `${(((PAD + scene.ring.midY) / height) * 100).toFixed(3)}%`,
        } as CSSProperties)
      : undefined;
  return (
    <figure className={styles.board} style={{ aspectRatio: `${width} / ${height}` }} role="img" aria-label={label}>
      <svg className={styles.ink} viewBox={`${-PAD} ${-PAD} ${width} ${height}`} aria-hidden>
        {scene.strokes.map((stroke, i) => (
          <path key={i} d={stroke.d} className={stroke.ink === "student" ? styles.student : styles.tutor} />
        ))}
      </svg>
      {noteStyle && (
        <span className={styles.note} style={noteStyle} aria-hidden>
          {RING_NOTE}
        </span>
      )}
    </figure>
  );
}
