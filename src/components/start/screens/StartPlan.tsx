"use client";

import type { Ref } from "react";
import type { FlowCopy } from "@/lib/start/flow";
import type { StartInkSet } from "@/lib/start/inkSet";
import type { StartPlan as Plan } from "@/lib/start/plan";
import { SkillExample, TutorCheck } from "../parts";
import styles from "../start.module.css";

export interface StartPlanProps {
  copy: FlowCopy["plan"];
  plan: Plan;
  ink: StartInkSet | null;
  tried: { checked: boolean; solved: boolean } | null;
  onSave: () => void;
  titleRef: Ref<HTMLHeadingElement>;
}

/**
 * "Sam's plan is ready": the plan as a card, its first three skills as a path (the first is where the
 * first board starts), each with its example in the tutor's hand, and one button to save it.
 */
export function StartPlan({ copy, plan, ink, tried, onSave, titleRef }: StartPlanProps) {
  const eyebrow = [copy.startHere, copy.next, copy.then];
  return (
    <>
      <div className={styles.head}>
        <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
          {copy.title}
          <TutorCheck className={styles.titleCheck} seed={17} atMs={260} forMs={360} />
        </h1>
        <p className={styles.lede}>{copy.lede}</p>
      </div>
      <section className={styles.planCard} aria-label={copy.whose}>
        <div className={styles.planHead}>
          <h2 className={styles.planWhose}>{copy.whose}</h2>
          <div className={styles.chips}>
            {plan.level && <span className={styles.chip}>{plan.level}</span>}
            {tried?.checked && (
              <span className={styles.chip}>
                <TutorCheck seed={29} draw={false} />
                {copy.tried(tried.solved)}
              </span>
            )}
          </div>
        </div>
        {plan.open ? (
          <p className={styles.planNote}>{copy.open}</p>
        ) : (
          <ol className={styles.path}>
            {plan.skills.map((skill, i) => {
              const example = ink?.skills[skill.id]?.lines;
              return (
                <li key={skill.id} className={styles.pathRow} data-first={i === 0 || undefined}>
                  <span className={styles.node} aria-hidden>
                    {i + 1}
                  </span>
                  <span className={styles.pathText}>
                    <span className={styles.pathEyebrow}>{eyebrow[i]}</span>
                    <span className={styles.pathName}>{skill.name}</span>
                    {skill.blurb && <span className={example ? styles.srOnly : styles.pathHint}>{skill.blurb}</span>}
                  </span>
                  {example && <SkillExample lines={example} height={26} draw atMs={420 + i * 260} />}
                </li>
              );
            })}
          </ol>
        )}
        {!plan.open && plan.skills[0] && <p className={styles.planNote}>{copy.firstBoardNote(plan.skills[0].name)}</p>}
      </section>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onSave}>
          {copy.save}
        </button>
        <p className={styles.footnote}>{copy.free}</p>
      </div>
    </>
  );
}
