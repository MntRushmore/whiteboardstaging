import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SIGN_UP_HREF } from "@/lib/landing/links";
import { BoardReplay } from "./BoardReplay";
import { LANDING_COPY } from "./copy";
import { HOW_ID } from "./bands";
import { TrialWords } from "./TrialWords";
import styles from "./landing.module.css";

/**
 * The first screen: what Agathon is in one line, what it does in another, the way in (and a link
 * down to How it works), the price in plain words, and then the product itself working on an iPad,
 * its writing within the first screen. The page's only h1. The trial's words are a friend's free
 * month for a visitor an invite brought (`TrialWords`).
 */
export function Hero() {
  const copy = LANDING_COPY.hero;
  const invited = LANDING_COPY.invited;
  return (
    <section className={styles.hero} aria-labelledby="lp-hero-title">
      <div className={styles.inner}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1 id="lp-hero-title" className={styles.display}>
          {copy.title}
        </h1>
        <p className={styles.lede}>{copy.lede}</p>
        <div className={styles.actions}>
          <Link href={SIGN_UP_HREF} className={styles.pill}>
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
        <BoardReplay className={styles.heroDevice} />
      </div>
    </section>
  );
}
