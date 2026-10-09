import Image from "next/image";
import { Lightbulb } from "lucide-react";
import { LANDING_COPY } from "./copy";
import { Lines } from "./Lines";
import styles from "./landing.module.css";

/**
 * How it works, in three steps, each with a real picture of the product: a 3rd grader's path and
 * Up next on the home, a board the tutor has just marked (two ticks, a ring and its "So close!"),
 * and the step Help me wrote under a slip. The pictures are crops of the app at 2× and 3×
 * (public/landing/), each on its own surface colour so the crop's edge never shows.
 */

const PICTURES = [
  { src: "/landing/path-3rd-grade.webp", width: 2628, height: 1551, surface: "#f8f8f8" },
  { src: "/landing/feedback-marks.webp", width: 880, height: 460, surface: "#fcfcfc" },
  { src: "/landing/help-step.webp", width: 1080, height: 564, surface: "#fcfcfc" },
] as const;

/** The full width on a phone or a tablet; beside the text, seven twelfths of the measure. */
const SIZES = "(max-width: 899px) calc(100vw - 32px), 640px";

export function HowItWorks() {
  const copy = LANDING_COPY.how;
  const [pick, write, help] = copy.steps;
  const bodies = [
    <p key="pick" className={styles.body}>
      {pick.body}
    </p>,
    <p key="write" className={styles.body}>
      {write.body}
    </p>,
    <p key="help" className={styles.body}>
      {help.bodyBefore}{" "}
      <span className={styles.helpChip}>
        <Lightbulb size="1em" strokeWidth={2.25} aria-hidden />
        {help.helpButton}
      </span>{" "}
      {help.bodyAfter}
    </p>,
  ];
  return (
    <section className={`${styles.band} ${styles.soft}`} aria-labelledby="lp-how-title">
      <div className={styles.inner}>
        <div className={`${styles.head} ${styles.reveal}`}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h2 id="lp-how-title" className={styles.h2}>
            <Lines text={copy.title} />
          </h2>
        </div>
        <ol className={styles.steps}>
          {copy.steps.map((step, i) => {
            const picture = PICTURES[i];
            return (
              <li key={step.label} className={`${styles.step} ${styles.reveal}`}>
                <div className={styles.stepText}>
                  <p className={styles.stepLabel}>{step.label}</p>
                  <h3 className={styles.h3}>
                    <Lines text={step.title} />
                  </h3>
                  {bodies[i]}
                </div>
                <figure className={styles.shot} style={{ background: picture.surface }}>
                  <Image src={picture.src} alt={step.alt} width={picture.width} height={picture.height} sizes={SIZES} />
                </figure>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
