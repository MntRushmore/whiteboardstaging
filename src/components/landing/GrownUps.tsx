import Image from "next/image";
import { CalendarCheck, ChartColumn, Mail, UsersRound } from "lucide-react";
import { LANDING_COPY } from "./copy";
import { DARK_BAND_ATTR } from "./bands";
import { Lines } from "./Lines";
import styles from "./landing.module.css";

/**
 * For grown-ups: what a parent gets to see, on the page's one dark band. The picture is the real
 * Progress page of a 3rd grader (the path and the week); the four things under it are the parent's
 * side of the app: Today's practice, the path and Progress, kid profiles, and the weekly report.
 */
const ICONS = [CalendarCheck, ChartColumn, UsersRound, Mail] as const;

export function GrownUps() {
  const copy = LANDING_COPY.grownUps;
  return (
    <section className={`${styles.band} ${styles.dark}`} aria-labelledby="lp-grown-ups-title" {...{ [DARK_BAND_ATTR]: "" }}>
      <div className={styles.inner}>
        <div className={`${styles.head} ${styles.reveal}`}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h2 id="lp-grown-ups-title" className={styles.h2}>
            <Lines text={copy.title} />
          </h2>
          <p className={styles.lede}>{copy.lede}</p>
        </div>
        <figure className={`${styles.progressShot} ${styles.reveal}`}>
          <Image
            src="/landing/progress-week.webp"
            alt={copy.alt}
            width={1958}
            height={1224}
            sizes="(max-width: 959px) calc(100vw - 32px), 928px"
          />
        </figure>
        <ul className={styles.features}>
          {copy.features.map((feature, i) => {
            const Icon = ICONS[i];
            return (
              <li key={feature.title} className={`${styles.feature} ${styles.reveal}`}>
                <Icon className={styles.featureIcon} size={28} strokeWidth={1.6} aria-hidden />
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
