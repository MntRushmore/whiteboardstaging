import { ASK_ID } from "./bands";
import { LANDING_COPY } from "./copy";
import { Lines } from "./Lines";
import styles from "./landing.module.css";

/**
 * CONTRACT STUB (v3, owner: feat/lp3-ask). "Stuck on why? Just ask.": the Ask panel beside a board,
 * playing one real exchange (copy.ask: the kid's question, held-mic style; the tutor's answer
 * streaming word by word with its maths typeset; then fraction bars drawn on the board in the
 * tutor's ink), and the five things Ask does (copy.ask.features).
 */
export function AskDemo() {
  const copy = LANDING_COPY.ask;
  return (
    <section id={ASK_ID} className={styles.band} aria-labelledby="lp-ask-title">
      <div className={`${styles.inner} ${styles.head}`}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h2 id="lp-ask-title" className={styles.h2}>
          <Lines text={copy.title} />
        </h2>
        <p className={styles.lede}>{copy.lede}</p>
      </div>
    </section>
  );
}
