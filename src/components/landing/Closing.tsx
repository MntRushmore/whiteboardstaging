import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SIGN_IN_HREF, SIGN_UP_HREF } from "@/lib/landing/links";
import { LANDING_COPY } from "./copy";
import { TrialWords } from "./TrialWords";
import styles from "./landing.module.css";

/** The last thing on the page before the legal footer: the trial (a friend's free month: `TrialWords`), and the way in. */
export function Closing() {
  const copy = LANDING_COPY.closing;
  const invited = LANDING_COPY.invited;
  return (
    <section className={`${styles.band} ${styles.soft} ${styles.closing}`} aria-labelledby="lp-closing-title">
      <div className={`${styles.inner} ${styles.head} ${styles.reveal}`}>
        <h2 id="lp-closing-title" className={styles.h2}>
          <TrialWords usual={copy.title} invited={invited.closing} />
        </h2>
        <p className={styles.lede}>{copy.body}</p>
        <div className={styles.actions}>
          <Link href={SIGN_UP_HREF} className={styles.pill}>
            <TrialWords usual={copy.start} invited={invited.start} />
          </Link>
          <Link href={SIGN_IN_HREF} className={styles.textLink}>
            {copy.signIn}
            <ChevronRight size={18} strokeWidth={2} aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
