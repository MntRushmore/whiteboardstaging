import Link from "next/link";
import { Check } from "lucide-react";
import { SIGN_UP_HREF } from "@/lib/landing/links";
import { PRICING_ID } from "./bands";
import { LANDING_COPY } from "./copy";
import { InkUnderline } from "./InkMark";
import { Lines } from "./Lines";
import { TrialWords } from "./TrialWords";
import styles from "./landing.module.css";

/**
 * The one plan, said plainly: its name, its price a month and the free trial (all from
 * UNLIMITED_PLAN through `planWords`), what it includes, and what happens before the first charge.
 * The tutor underlines the free trial. A friend's free month in place of the trial for a visitor an
 * invite brought (`TrialWords`). One card: the price and the way in on one side, what it includes
 * on the other (stacked on a phone).
 */
export function Pricing() {
  const copy = LANDING_COPY.pricing;
  const invited = LANDING_COPY.invited;
  return (
    <section id={PRICING_ID} className={`${styles.band} ${styles.soft}`} aria-labelledby="lp-pricing-title">
      <div className={styles.inner}>
        <div className={`${styles.head} ${styles.reveal}`}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h2 id="lp-pricing-title" className={styles.h2}>
            <Lines text={copy.title} />
          </h2>
        </div>
        <div className={`${styles.priceCard} ${styles.reveal}`}>
          <div className={styles.priceMain}>
            <p className={styles.planName}>{copy.plan}</p>
            <p className={styles.price}>
              <span className={styles.priceAmount}>{copy.price}</span>
              <span className={styles.pricePer}>{copy.per}</span>
            </p>
            <p className={styles.priceTrial}>
              <InkUnderline className={styles.priceMark} draw="pricing-trial" atMs={200} forMs={520}>
                <TrialWords usual={copy.trial} invited={invited.trial} />
              </InkUnderline>
            </p>
            <Link href={SIGN_UP_HREF} className={`${styles.pill} ${styles.pillLarge} ${styles.priceCta}`}>
              <TrialWords usual={copy.start} invited={invited.start} />
            </Link>
            <p className={styles.priceFine}>
              <TrialWords usual={copy.fine} invited={invited.fine} />
            </p>
          </div>
          <div className={styles.priceSide}>
            <h3 id="lp-pricing-includes" className={styles.includesLabel}>
              {copy.includesLabel}
            </h3>
            <ul className={styles.includes} aria-labelledby="lp-pricing-includes">
              {copy.includes.map((item) => (
                <li key={item}>
                  <span className={styles.includeIcon} aria-hidden>
                    <Check size={16} strokeWidth={2.5} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
