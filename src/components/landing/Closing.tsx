import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { SIGN_IN_HREF, SIGN_UP_HREF } from "@/lib/landing/links";
import { LANDING_COPY } from "./copy";
import styles from "./landing.module.css";

/** The last thing on the page before the legal footer: the trial, and the way in. */
export function Closing() {
  const copy = LANDING_COPY.closing;
  return (
    <section className={`${styles.band} ${styles.soft} ${styles.closing}`} aria-labelledby="lp-closing-title">
      <div className={`${styles.inner} ${styles.head} ${styles.reveal}`}>
        <h2 id="lp-closing-title" className={styles.h2}>
          {copy.title}
        </h2>
        <p className={styles.lede}>{copy.body}</p>
        <div className={styles.actions}>
          <Link href={SIGN_UP_HREF} className={styles.pill}>
            {copy.start}
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
