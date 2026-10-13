"use client";

import type { Ref } from "react";
import type { PathSkillId } from "@/lib/learning/grades";
import { MAX_FOCUS } from "@/lib/start/contracts";
import type { FlowCopy } from "@/lib/start/flow";
import type { StartInkSet } from "@/lib/start/inkSet";
import { skillWords } from "@/lib/start/plan";
import { KeepWords, SkillExample, TutorCheck } from "../parts";
import styles from "../start.module.css";

export interface StartFocusProps {
  copy: FlowCopy["focus"];
  /** the grade's path or the course's topics */
  options: readonly PathSkillId[];
  focus: readonly PathSkillId[];
  ink: StartInkSet | null;
  onToggle: (skill: PathSkillId) => void;
  onNotSure: () => void;
  onNext: () => void;
  titleRef: Ref<HTMLHeadingElement>;
}

/**
 * What's tricky: the grade's skills, each with its example in the tutor's hand. Pick up to three
 * (the tutor checks each box), or "Not sure yet", which starts at the beginning and moves on.
 */
export function StartFocus({ copy, options, focus, ink, onToggle, onNotSure, onNext, titleRef }: StartFocusProps) {
  const full = focus.length >= MAX_FOCUS;
  return (
    <>
      <div className={styles.head}>
        <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
          {copy.title}
        </h1>
        <p className={styles.lede}>{copy.lede}</p>
      </div>
      <ul className={styles.list} aria-label={copy.title}>
        {options.map((id, i) => {
          const on = focus.includes(id);
          const words = skillWords(id);
          const example = ink?.skills[id]?.lines;
          return (
            <li key={id}>
              <button type="button" className={styles.choice} aria-pressed={on} aria-disabled={!on && full ? true : undefined} onClick={() => onToggle(id)}>
                <span className={styles.box}>{on && <TutorCheck seed={i * 5 + 2} />}</span>
                <span className={styles.choiceText}>
                  <span className={styles.choiceName}>
                    <KeepWords text={words.name} />
                  </span>
                  {words.blurb && <span className={example ? styles.srOnly : styles.choiceHint}>{words.blurb}</span>}
                </span>
                {example && <SkillExample lines={example} height={24} />}
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" className={styles.choice} onClick={onNotSure}>
            <span className={styles.choiceText}>
              <span className={styles.choiceName}>{copy.notSure}</span>
              <span className={styles.choiceHint}>{copy.notSureHint}</span>
            </span>
          </button>
        </li>
      </ul>
      <div className={`${styles.actions} ${styles.dock}`}>
        <p className={styles.status} role="status" data-full={full || undefined}>
          {full ? copy.full : copy.picked(focus.length)}
        </p>
        <button type="button" className={styles.primary} disabled={focus.length === 0} onClick={onNext}>
          {copy.next}
        </button>
      </div>
    </>
  );
}
