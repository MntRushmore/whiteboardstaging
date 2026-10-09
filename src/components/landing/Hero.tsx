import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SIGN_IN_HREF, SIGN_UP_HREF } from "@/lib/landing/links";
import { BoardReplay } from "./BoardReplay";
import { LANDING_COPY } from "./copy";
import { TrialWords } from "./TrialWords";
import styles from "./landing.module.css";

/**
 * The first screen: what Agathon is in one line, what it does in two, the way in, the price in
 * plain words, and then the product itself working on an iPad. The page's only h1. The trial's words
 * are a friend's free month for a visitor an invite brought (`TrialWords`).
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
          <Link href={SIGN_IN_HREF} className={styles.textLink}>
            {copy.signIn}
            <ChevronRight size={18} strokeWidth={2} aria-hidden />
          </Link>
        </div>
        <p className={styles.terms}>
          <TrialWords usual={copy.terms} invited={invited.terms} />
        </p>
        <BoardReplay className={styles.heroDevice} />
      </div>
    </section>
  );
}
