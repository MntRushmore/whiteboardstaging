import Image from "next/image";
import { CalendarCheck, ChartColumn, Mail, UsersRound } from "lucide-react";
import { LANDING_COPY } from "./copy";
import { DARK_BAND_ATTR, GROWN_UPS_ID } from "./bands";
import { Lines } from "./Lines";
import styles from "./landing.module.css";

/**
 * For grown-ups: what a parent gets to see, on the page's one dark band. The picture is the real
 * Progress page of a 3rd grader (the path and the week), framed like a screen on the board's table;
 * the four things beside it are the parent's side of the app: Today's practice, the path and
 * Progress, kid profiles, and the weekly report, set as one row of hairline columns.
 */
const ICONS = [CalendarCheck, ChartColumn, UsersRound, Mail] as const;

export function GrownUps() {
  const copy = LANDING_COPY.grownUps;
  return (
    <section id={GROWN_UPS_ID} className={`${styles.band} ${styles.dark} ${styles.grownUps}`} aria-labelledby="lp-grown-ups-title" {...{ [DARK_BAND_ATTR]: "" }}>
      <div className={styles.inner}>
        <div className={`${styles.grownHead} ${styles.reveal}`}>
          <div>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h2 id="lp-grown-ups-title" className={styles.h2}>
              <Lines text={copy.title} />
            </h2>
          </div>
          <p className={`${styles.lede} ${styles.grownLede}`}>{copy.lede}</p>
        </div>
        <figure className={`${styles.progressShot} ${styles.reveal}`}>
          <Image
            src="/landing/progress-week.webp"
            alt={copy.alt}
            width={1958}
            height={1224}
            sizes="(max-width: 1023px) calc(100vw - 64px), 1000px"
          />
        </figure>
        <ul className={styles.features}>
          {copy.features.map((feature, i) => {
            const Icon = ICONS[i];
            return (
              <li key={feature.title} className={`${styles.feature} ${styles.reveal}`}>
                <span className={styles.featureIcon} aria-hidden>
                  <Icon size={20} strokeWidth={1.75} />
                </span>
                <h3 className={styles.featureTitle}>{feature.title}</h3>
                <p className={styles.featureBody}>{feature.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
