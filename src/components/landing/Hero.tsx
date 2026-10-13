import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { BOARD_LINES } from "@/lib/landing/boardInk";
import { HERO_SCENE, HERO_SCENE_PHONE } from "@/lib/landing/heroScene";
import { SIGN_UP_HREF } from "@/lib/landing/links";
import { pathBounds } from "@/lib/landing/replay";
import { BoardReplay } from "./BoardReplay";
import { LANDING_COPY } from "./copy";
import { HOW_ID } from "./bands";
import { HeroScene, type HeroSceneProps } from "./HeroScene";
import { InkCheck, InkCircle } from "./InkMark";
import { TrialWords } from "./TrialWords";
import styles from "./landing.module.css";

/**
 * The first screen (v4): what Agathon is in one line, the tutor's pen on it (it circles "actually"
 * and checks the line, drawing them in as the page opens), what it does in another, the way in (and
 * a link down to How it works), the price in plain words. Under the words, the painting (HeroScene):
 * a boy writing on a tablet at the kitchen table, real ink drawn onto its screen. The product itself
 * follows in its own band (`HeroReplay`). The page's only h1. The trial's words are a friend's free
 * month for a visitor an invite brought (`TrialWords`).
 *
 * (v4 tried the iPad over the painting's tabletop too: two tablets on one screen, the big black
 * bezel over a soft painting. The painting alone is the calmer first screen.)
 */

/**
 * The check's pen, in the tick's own units: a thirteenth of its box, so it draws at the circle's
 * weight (landing.module.css .heroCircle) instead of InkCheck's default, a ninth.
 */
const TICK = pathBounds(BOARD_LINES.find((l) => l.mark.kind === "tick")!.mark.stroke.d);
const CHECK_PEN = Math.max(TICK.maxX - TICK.minX, TICK.maxY - TICK.minY) / 11;

/**
 * The painting (src/lib/landing/heroScene.ts), a little of its quiet tabletop left out (it was
 * painted for the iPad to overlap, and the iPad has its own band now), and a phone's crop of it.
 */
const HERO_ART: HeroSceneProps = { ...HERO_SCENE, cropBottom: 190, phone: HERO_SCENE_PHONE };

export function Hero() {
  const copy = LANDING_COPY.hero;
  const invited = LANDING_COPY.invited;
  const [first, kids, circled, last] = copy.titleParts;
  return (
    <section className={styles.hero} aria-labelledby="lp-hero-title">
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
        <HeroScene {...HERO_ART} className={styles.heroScene} />
      </div>
    </section>
  );
}

/**
 * Right after the hero: the product itself working on an iPad (BoardReplay), on the board's warm
 * table. The painting shows the feeling; this is his screen up close, and its first line is the one
 * the painted tablet shows, 7 + 5 = 12, checked. Its own band, so the two tablets never share a
 * screen. No heading: the replay is one labelled picture, with its key under it.
 */
export function HeroReplay() {
  return (
    <div className={styles.replayBand}>
      <div className={styles.heroDevice}>
        <BoardReplay />
      </div>
    </div>
  );
}
