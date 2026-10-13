import Link from "next/link";
import { SIGN_IN_HREF, SIGN_UP_HREF } from "@/lib/landing/links";
import { JOIN_ID } from "./bands";
import { LANDING_COPY } from "./copy";
import { Lines } from "./Lines";
import { TrialWords } from "./TrialWords";
import styles from "./landing.module.css";

/**
 * CONTRACT STUB (v3, owner: feat/lp3-page). The last band before the legal footer: the way in, big.
 * A full-bleed band in the flat accent blue, the title huge in white, the terms, a white "Join
 * Agathon" button with the tutor's arrow drawn to it (InkArrow, white), and Sign in.
 */
export function Join() {
  const copy = LANDING_COPY.join;
  const invited = LANDING_COPY.invited;
  return (
    <section id={JOIN_ID} className={styles.band} aria-labelledby="lp-join-title">
      <div className={`${styles.inner} ${styles.head}`}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h2 id="lp-join-title" className={styles.h2}>
          <Lines text={copy.title} />
        </h2>
        <p className={styles.lede}>{copy.body}</p>
        <div className={styles.actions}>
          <Link href={SIGN_UP_HREF} className={styles.pill}>
            <TrialWords usual={copy.start} invited={invited.start} />
          </Link>
          <Link href={SIGN_IN_HREF} className={styles.textLink}>
            {copy.signIn}
          </Link>
        </div>
        <p className={styles.terms}>
          <TrialWords usual={copy.terms} invited={invited.terms} />
        </p>
      </div>
    </section>
  );
}
