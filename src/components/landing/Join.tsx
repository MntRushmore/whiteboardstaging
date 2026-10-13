import Link from "next/link";
import { SIGN_IN_HREF, SIGN_UP_HREF } from "@/lib/landing/links";
import { JOIN_ID } from "./bands";
import { LANDING_COPY } from "./copy";
import { InkArrow } from "./InkMark";
import { Lines } from "./Lines";
import { TrialWords } from "./TrialWords";
import styles from "./landing.module.css";

/**
 * The last band before the legal footer: the way in, big. Full-bleed in the flat accent blue, the
 * title huge in white, a white "Join Agathon" button with the tutor's arrow drawn to it in white
 * ("Takes a minute" beside it), Sign in, and the terms. White on the accent is 5.3:1, so every word
 * here is plain white: the hierarchy is in the sizes, never in a fainter white.
 */
export function Join() {
  const copy = LANDING_COPY.join;
  const invited = LANDING_COPY.invited;
  return (
    <section id={JOIN_ID} className={`${styles.band} ${styles.join}`} aria-labelledby="lp-join-title">
      <div className={`${styles.inner} ${styles.joinInner}`}>
        <h2 id="lp-join-title" className={`${styles.display} ${styles.joinTitle} ${styles.reveal}`}>
          <Lines text={copy.title} />
        </h2>
        <p className={styles.joinBody}>{copy.body}</p>
        <div className={styles.joinActions}>
          <div className={styles.joinCta}>
            <p className={styles.joinAside}>
              {copy.aside}
              {/* the arrow's own box, turned toward the button (landing.module.css) */}
              <span className={styles.joinArrowBox} aria-hidden>
                <InkArrow className={styles.joinArrow} ink="white" draw="join-arrow" atMs={250} forMs={560} length={64} pen={2.5} seed={5} />
              </span>
            </p>
            <Link href={SIGN_UP_HREF} className={`${styles.pill} ${styles.pillLarge} ${styles.joinPill}`}>
              <TrialWords usual={copy.start} invited={invited.start} />
            </Link>
          </div>
          <Link href={SIGN_IN_HREF} className={`${styles.textLink} ${styles.joinSignIn}`}>
            {copy.signIn}
          </Link>
        </div>
        <p className={styles.joinTerms}>
          <TrialWords usual={copy.terms} invited={invited.terms} />
        </p>
      </div>
    </section>
  );
}
