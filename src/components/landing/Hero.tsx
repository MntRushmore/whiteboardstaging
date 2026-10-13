import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BOARD_LINES } from "@/lib/landing/boardInk";
import { SIGN_UP_HREF } from "@/lib/landing/links";
import { pathBounds } from "@/lib/landing/replay";
import { BoardReplay } from "./BoardReplay";
import { LANDING_COPY } from "./copy";
import { HOW_ID } from "./bands";
import { InkCheck, InkCircle } from "./InkMark";
import { TrialWords } from "./TrialWords";
import styles from "./landing.module.css";

/**
 * The first screen: what Agathon is in one line, the tutor's pen on it (it circles "actually" and
 * checks the line, drawing them in as the page opens), what it does in another, the way in (and a
 * link down to How it works), the price in plain words, and then the product itself working on an
 * iPad, on the board's own grey table. The page's only h1. The trial's words are a friend's free
 * month for a visitor an invite brought (`TrialWords`).
 *
 * Behind the words, a faint dot grid: the board's surface, as an SVG pattern (flat, no wash).
 */

/**
 * The check's pen, in the tick's own units: a thirteenth of its box, so it draws at the circle's
 * weight (0.06em, landing.module.css .heroCircle) instead of InkCheck's default, a ninth.
 */
const TICK = pathBounds(BOARD_LINES.find((l) => l.mark.kind === "tick")!.mark.stroke.d);
const CHECK_PEN = Math.max(TICK.maxX - TICK.minX, TICK.maxY - TICK.minY) / 11;

/** The board's dot grid, 24 px apart. Decorative. */
function BoardDots() {
  return (
    <svg className={styles.dots} aria-hidden focusable="false">
      <defs>
        <pattern id="lp-board-dots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="1.15" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#lp-board-dots)" />
    </svg>
  );
}

export function Hero() {
  const copy = LANDING_COPY.hero;
  const invited = LANDING_COPY.invited;
  const [first, kids, circled, last] = copy.titleParts;
  return (
    <section className={styles.hero} aria-labelledby="lp-hero-title">
      <BoardDots />
      <div className={`${styles.inner} ${styles.heroText}`}>
        <p className={`${styles.eyebrow} ${styles.heroEyebrow}`}>{copy.eyebrow}</p>
        <h1 id="lp-hero-title" className={`${styles.display} ${styles.heroTitle}`}>
          {first}
          {/* a space that always ends the first line ("Math practice"), so the circled word sits under it the same way at every width */}
          <span className={styles.titleBreak}> </span>
          {kids}{" "}
          <InkCircle className={styles.heroCircle} draw="hero-circle" atMs={450} forMs={680}>
            {circled}
          </InkCircle>{" "}
          {/* the last word and its check mark never part at a line's end */}
          <span className={styles.nowrap}>
            {last}
            <InkCheck className={styles.heroCheck} draw="hero-check" atMs={1250} forMs={300} pen={CHECK_PEN} />
          </span>
        </h1>
        <p className={`${styles.lede} ${styles.heroLede}`}>{copy.lede}</p>
        <div className={styles.actions}>
          <Link href={SIGN_UP_HREF} className={`${styles.pill} ${styles.pillLarge}`}>
            <TrialWords usual={copy.start} invited={invited.start} />
          </Link>
          <a href={`#${HOW_ID}`} className={styles.textLink}>
            {copy.more}
            <ChevronRight size={18} strokeWidth={2} aria-hidden />
          </a>
        </div>
        <p className={styles.terms}>
          <TrialWords usual={copy.terms} invited={invited.terms} />
        </p>
      </div>
      <div className={styles.heroStage}>
        <BoardReplay />
      </div>
    </section>
  );
}
