import type { ReactNode } from "react";
import Image from "next/image";
import { Lightbulb } from "lucide-react";
import { CHECKS_SCENE, HELP_SCENE } from "@/lib/landing/stepInk";
import { HOW_ID } from "./bands";
import { LANDING_COPY } from "./copy";
import { InkPicture } from "./InkPicture";
import { Lines } from "./Lines";
import styles from "./landing.module.css";

/**
 * How it works, in three steps, each with its own real moment of the product: a 3rd grader's path
 * and Up next on the home (a crop of the app at 3×, on its own surface colour so the crop's edge
 * never shows), an older student's equation the tutor marked (a check mark, a circle and its
 * "So close!"), and the next step Help me wrote beside a slip. The last two are the boards' own ink
 * as vector (src/lib/landing/stepInk.ts), so they are sharp on any screen and never repeat the hero.
 */

/** The full width on a phone or a tablet; beside the text, seven twelfths of the measure. */
const SIZES = "(max-width: 899px) calc(100vw - 32px), 640px";

/** The path and Up next; on a phone, a closer crop of the path alone, so its labels stay readable. */
function PathPicture({ alt, phoneAlt }: { alt: string; phoneAlt: string }) {
  return (
    <figure className={styles.shot} style={{ background: "#f8f8f8" }}>
      <Image className={styles.wideOnly} src="/landing/path-3rd-grade.webp" alt={alt} width={2628} height={1551} sizes={SIZES} />
      <Image className={styles.phoneOnly} src="/landing/path-3rd-grade-phone.webp" alt={phoneAlt} width={1146} height={900} sizes="calc(100vw - 32px)" />
    </figure>
  );
}

export function HowItWorks() {
  const copy = LANDING_COPY.how;
  const [pick, write, help] = copy.steps;
  const steps: { body: ReactNode; picture: ReactNode }[] = [
    {
      body: <p className={styles.body}>{pick.body}</p>,
      picture: <PathPicture alt={pick.alt} phoneAlt={pick.phoneAlt} />,
    },
    {
      body: <p className={styles.body}>{write.body}</p>,
      picture: <InkPicture scene={CHECKS_SCENE} note label={write.alt} />,
    },
    {
      body: (
        <p className={styles.body}>
          {help.bodyBefore}{" "}
          <span className={styles.helpChip}>
            <Lightbulb size="1em" strokeWidth={2.25} aria-hidden />
            {help.helpButton}
          </span>{" "}
          {help.bodyAfter}
        </p>
      ),
      picture: <InkPicture scene={HELP_SCENE} label={help.alt} />,
    },
  ];
  return (
    <section id={HOW_ID} className={`${styles.band} ${styles.soft} ${styles.anchored}`} aria-labelledby="lp-how-title">
      <div className={styles.inner}>
        <div className={`${styles.head} ${styles.reveal}`}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h2 id="lp-how-title" className={styles.h2}>
            <Lines text={copy.title} />
          </h2>
        </div>
        <ol className={styles.steps}>
          {copy.steps.map((step, i) => (
            <li key={step.label} className={`${styles.step} ${styles.reveal}`}>
              <div className={styles.stepText}>
                <p className={styles.stepLabel}>{step.label}</p>
                <h3 className={styles.h3}>
                  <Lines text={step.title} />
                </h3>
                {steps[i].body}
              </div>
              {steps[i].picture}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
