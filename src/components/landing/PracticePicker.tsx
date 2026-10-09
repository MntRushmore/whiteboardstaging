import type { CSSProperties, ReactNode } from "react";
import {
  Calculator,
  ChartPie,
  ChartSpline,
  DecimalsArrowRight,
  Diff,
  Divide,
  FlaskConical,
  Minus,
  Percent,
  Plus,
  Scale,
  Shapes,
  Sigma,
  TriangleRight,
  Variable,
  X,
} from "lucide-react";
import { DEFAULT_PRACTICE_TAB, PRACTICE_COPY, practiceTabs, type PracticeTab } from "@/lib/landing/practice";
import type { PathIcon } from "@/lib/path/pathView";
import { LANDING_COPY } from "./copy";
import landing from "./landing.module.css";
import styles from "./practice.module.css";

/**
 * What they'll practise: a grade picker (Kindergarten to 8th, and High school) over each grade's
 * real skill path. It needs no script: the chips are a native radio group (arrow keys move between
 * grades) and CSS shows the chosen grade's path (`practice.module.css`). Without `:has()` every
 * path is simply listed.
 */

/** A stop's sign: the same pictures the app's skill path draws (src/components/path/PathTrail.tsx). */
const GLYPHS: Readonly<Record<PathIcon, (size: number) => ReactNode>> = {
  add: (s) => <Plus size={s} strokeWidth={2.2} />,
  subtract: (s) => <Minus size={s} strokeWidth={2.2} />,
  addSubtract: (s) => <Diff size={s} strokeWidth={2} />,
  multiply: (s) => <X size={s} strokeWidth={2.2} />,
  divide: (s) => <Divide size={s} strokeWidth={2} />,
  fraction: (s) => <ChartPie size={s} strokeWidth={1.8} />,
  decimal: (s) => <DecimalsArrowRight size={s} strokeWidth={1.8} />,
  percent: (s) => <Percent size={s} strokeWidth={2} />,
  ratio: (s) => <Scale size={s} strokeWidth={1.8} />,
  arithmetic: (s) => <Calculator size={s} strokeWidth={1.8} />,
  algebra: (s) => <Variable size={s} strokeWidth={1.8} />,
  functions: (s) => <ChartSpline size={s} strokeWidth={1.8} />,
  geometry: (s) => <Shapes size={s} strokeWidth={1.8} />,
  trig: (s) => <TriangleRight size={s} strokeWidth={1.8} />,
  calculus: (s) => <Sigma size={s} strokeWidth={1.8} />,
  science: (s) => <FlaskConical size={s} strokeWidth={1.8} />,
};

const NAME = "lp-grade";

function Panel({ tab }: { tab: PracticeTab }) {
  if (tab.kind === "courses") {
    return (
      <div className={styles.panel} data-tab={tab.id} role="group" aria-labelledby={`lp-panel-${tab.id}`}>
        <div className={styles.panelHead}>
          <h3 id={`lp-panel-${tab.id}`} className={styles.panelTitle}>
            {tab.title}
          </h3>
          <p className={styles.panelNote}>{PRACTICE_COPY.courseCount(tab.courses.length)}</p>
        </div>
        <ul className={styles.courses}>
          {tab.courses.map((course) => (
            <li key={course.id} className={styles.course}>
              <p className={styles.courseName}>{course.label}</p>
              <p className={styles.courseBlurb}>{course.blurb}</p>
              <p className={styles.courseTopics}>{course.topics.join(" · ")}</p>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className={styles.panel} data-tab={tab.id} role="group" aria-labelledby={`lp-panel-${tab.id}`}>
      <div className={styles.panelHead}>
        <h3 id={`lp-panel-${tab.id}`} className={styles.panelTitle}>
          {tab.title}
        </h3>
        <p className={styles.panelNote}>{PRACTICE_COPY.skillCount(tab.skills.length)}</p>
      </div>
      <ol className={styles.trail} style={{ "--n": tab.skills.length } as CSSProperties}>
        {tab.skills.map((skill) => (
          <li key={skill.id} className={styles.stop}>
            <span className={styles.stopIcon} aria-hidden>
              {GLYPHS[skill.icon]?.(24) ?? GLYPHS.arithmetic(24)}
            </span>
            <span className={styles.stopText}>
              <span className={styles.stopName}>{skill.name}</span>
              {skill.blurb && <span className={styles.stopBlurb}>{skill.blurb}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PracticePicker() {
  const copy = LANDING_COPY.practice;
  const tabs = practiceTabs();
  return (
    <section className={landing.band} aria-labelledby="lp-practice-title">
      <div className={landing.inner}>
        <div className={`${landing.head} ${landing.reveal}`}>
          <p className={landing.eyebrow}>{copy.eyebrow}</p>
          <h2 id="lp-practice-title" className={landing.h2}>
            {copy.title}
          </h2>
          <p className={landing.lede}>{copy.lede}</p>
        </div>
        <div className={`${styles.picker} ${landing.reveal}`}>
          <fieldset className={styles.chips}>
            <legend className={landing.srOnly}>{copy.legend}</legend>
            {tabs.map((tab) => (
              <label key={tab.id} className={`${styles.chip} ${tab.kind === "courses" ? styles.chipWide : ""}`}>
                <input
                  type="radio"
                  name={NAME}
                  value={tab.id}
                  defaultChecked={tab.id === DEFAULT_PRACTICE_TAB}
                  data-tab-input={tab.id}
                  aria-label={tab.title}
                  className={styles.chipInput}
                />
                <span className={styles.chipFace}>{tab.chip}</span>
              </label>
            ))}
          </fieldset>
          <div className={styles.panels}>
            {tabs.map((tab) => (
              <Panel key={tab.id} tab={tab} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
