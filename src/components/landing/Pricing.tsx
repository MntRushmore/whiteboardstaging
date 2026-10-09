import Link from "next/link";
import { Check } from "lucide-react";
import { SIGN_UP_HREF } from "@/lib/landing/links";
import { LANDING_COPY } from "./copy";
import { Lines } from "./Lines";
import { TrialWords } from "./TrialWords";
import styles from "./landing.module.css";

/**
 * The one plan, said plainly: its name, its price a month and the free trial (all from
 * UNLIMITED_PLAN through `planWords`), what it includes, and what happens before the first charge.
 * A friend's free month in place of the trial for a visitor an invite brought (`TrialWords`).
 */
export function Pricing() {
  const copy = LANDING_COPY.pricing;
  const invited = LANDING_COPY.invited;
  return (
    <section className={`${styles.band} ${styles.soft}`} aria-labelledby="lp-pricing-title">
      <div className={styles.inner}>
        <div className={`${styles.head} ${styles.reveal}`}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h2 id="lp-pricing-title" className={styles.h2}>
            <Lines text={copy.title} />
          </h2>
        </div>
        <div className={`${styles.priceCard} ${styles.reveal}`}>
          <p className={styles.planName}>{copy.plan}</p>
          <p className={styles.price}>
            <span className={styles.priceAmount}>{copy.price}</span>
            <span className={styles.pricePer}>{copy.per}</span>
          </p>
          <p className={styles.priceTrial}>
            <TrialWords usual={copy.trial} invited={invited.trial} />
          </p>
          <ul className={styles.includes}>
            {copy.includes.map((item) => (
              <li key={item}>
                <Check size={20} strokeWidth={2.25} aria-hidden />
                {item}
              </li>
            ))}
          </ul>
          <Link href={SIGN_UP_HREF} className={`${styles.pill} ${styles.priceCta}`}>
            <TrialWords usual={copy.start} invited={invited.start} />
          </Link>
          <p className={styles.priceFine}>
            <TrialWords usual={copy.fine} invited={invited.fine} />
          </p>
        </div>
      </div>
    </section>
  );
}
