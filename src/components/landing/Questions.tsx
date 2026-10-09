import Link from "next/link";
import { LANDING_COPY } from "./copy";
import { TrialWords } from "./TrialWords";
import styles from "./landing.module.css";

/**
 * The questions a parent asks before signing up, each a native disclosure (no script): ages,
 * devices, whether it just gives the answer, their child's data (only what the Privacy Policy
 * promises, with a link to it), the card for the trial (a friend's free month for a visitor an
 * invite brought: `TrialWords`), cancelling, and siblings.
 */
export function Questions() {
  const copy = LANDING_COPY.faq;
  return (
    <section className={styles.band} aria-labelledby="lp-faq-title">
      <div className={styles.inner}>
        <div className={`${styles.head} ${styles.reveal}`}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h2 id="lp-faq-title" className={styles.h2}>
            {copy.title}
          </h2>
        </div>
        <div className={styles.faq}>
          {copy.items.map((item) => (
            <details key={item.q} className={styles.qa}>
              <summary className={styles.question}>
                <span>{"invited" in item ? <TrialWords usual={item.q} invited={item.invited.q} /> : item.q}</span>
                <span className={styles.toggle} aria-hidden />
              </summary>
              <p className={styles.answer}>
                {"invited" in item ? <TrialWords usual={item.a} invited={item.invited.a} /> : item.a}
                {"link" in item && (
                  <>
                    <br />
                    <Link href={item.link.href} className={styles.answerLink}>
                      {item.link.label}
                    </Link>
                  </>
                )}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
