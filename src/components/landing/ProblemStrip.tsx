import type { CSSProperties } from "react";
import { driftSeconds, STRIP_HAND, stripLines, type StripLine } from "@/lib/landing/strip";
import { LANDING_COPY } from "./copy";
import { HandMath } from "./HandMath";
import { InkCheck } from "./InkMark";
import { INK_DRAW_ATTR } from "./inkStart";
import styles from "./strip.module.css";

/**
 * Under the hero (v3): one line from each grade's path, kindergarten to 8th grade, each written in
 * the board's hand (the kid's black pen) with the tutor's blue check mark after it, drifting slowly
 * sideways. The row is there three times, end to end, so the drift loops without a seam; the copies
 * are hidden from screen readers, which hear each line once ("3rd grade: 6 × 7 = 42").
 *
 * Server-rendered and static, CSS only. On the first pass each line writes itself in and is checked,
 * a beat after the one before, once the strip is in view (INK_START_SCRIPT holds the writing and the
 * drift until then). It stops while a pointer is over it or it has the focus. With reduced motion it
 * is a still row the visitor scrolls sideways, line by line.
 */

/** The strip's key for INK_START_SCRIPT: the drift and every line's first writing start together. */
const KEY = "strip";

const LINES = stripLines(LANDING_COPY.strip.items);

/** the tutor's pen for the check marks, in the tick's own units: about two thirds of the kid's marker, as on the board */
const CHECK_PEN = 3.4;

/** The row's width at full size, for the drift's pace: each line, its grade and check, and the gaps. */
const ROW_WIDTH = LINES.reduce((sum, line) => sum + line.width + 170, 0);
const LAP = { "--lap": `${driftSeconds(ROW_WIDTH, 22)}s` } as CSSProperties;

function Row({ first }: { first: boolean }) {
  return (
    <ul className={first ? styles.row : `${styles.row} ${styles.again}`} aria-hidden={first ? undefined : true}>
      {LINES.map((line) => (
        <Item key={line.grade} line={line} draw={first} />
      ))}
    </ul>
  );
}

function Item({ line, draw }: { line: StripLine; draw: boolean }) {
  const place = { "--w": line.width, "--shift": line.shift } as CSSProperties;
  return (
    <li className={styles.item}>
      <span className={styles.grade} aria-hidden>
        {line.grade}
      </span>
      <HandMath
        latex={line.latex}
        ink="kid"
        size={STRIP_HAND.size}
        seed={STRIP_HAND.seed}
        speed={STRIP_HAND.speed}
        draw={draw ? KEY : undefined}
        startMs={line.startMs}
        className={styles.math}
        style={place}
      />
      <span className={styles.check}>
        <InkCheck draw={draw ? KEY : undefined} atMs={line.checkAtMs} pen={CHECK_PEN} />
      </span>
      {draw && <span className={styles.sr}>{line.label}</span>}
    </li>
  );
}

export function ProblemStrip() {
  const copy = LANDING_COPY.strip;
  return (
    <div className={styles.band}>
      {/* focusable: a keyboard stops the drift, and scrolls the still row (reduced motion) */}
      <section className={styles.viewport} aria-label={copy.label} tabIndex={0} {...{ [INK_DRAW_ATTR]: KEY }}>
        {/* the row three times: a copy, the row (read out, and written in on the first pass), a copy.
            It drifts one row's width, from the row's first line at the left fade to the second
            copy's, and starts again; the copy before it fills the fade at the left. */}
        <div className={styles.track} style={LAP} data-lp-ink="">
          <Row first={false} />
          <Row first />
          <Row first={false} />
        </div>
      </section>
    </div>
  );
}
