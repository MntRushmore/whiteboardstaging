"use client";

import { useState, type Ref } from "react";
import { ChevronRight } from "lucide-react";
import { GRADE_IDS, type Grade } from "@/lib/learning/grades";
import { choiceKey, gradeTile, HIGH_SCHOOL_COURSES, SOMETHING_ELSE, type WelcomeChoice } from "@/lib/onboarding/choice";
import type { FlowCopy } from "@/lib/start/flow";
import { TutorCheck } from "../parts";
import styles from "../start.module.css";

export interface StartGradeProps {
  copy: FlowCopy["grade"];
  choice: WelcomeChoice | null;
  onPick: (choice: WelcomeChoice) => void;
  titleRef: Ref<HTMLHeadingElement>;
}

/**
 * The grade: nine big tiles (K to 8th) and High school, which opens the courses. A tap answers and
 * moves on.
 */
export function StartGrade({ copy, choice, onPick, titleRef }: StartGradeProps) {
  const [courses, setCourses] = useState(choice?.kind === "course");
  const picked = choiceKey(choice);

  if (courses) {
    const list = [...HIGH_SCHOOL_COURSES, SOMETHING_ELSE];
    return (
      <>
        <div className={styles.head}>
          <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
            {copy.courseTitle}
          </h1>
          <p className={styles.lede}>{copy.courseLede}</p>
        </div>
        <ul className={styles.list}>
          {list.map((course, i) => {
            const on = picked === `course:${course.id}`;
            return (
              <li key={course.id}>
                <button type="button" className={styles.choice} aria-pressed={on} onClick={() => onPick({ kind: "course", course: course.id })}>
                  <span className={styles.choiceText}>
                    <span className={styles.choiceName}>{course.label}</span>
                    <span className={styles.choiceHint}>{course.blurb}</span>
                  </span>
                  <span className={styles.slot}>{on && <TutorCheck seed={i + 21} />}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className={styles.actions}>
          <button type="button" className={styles.quiet} onClick={() => setCourses(false)}>
            {copy.backToGrades}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.head}>
        <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
          {copy.title}
        </h1>
        <p className={styles.lede}>{copy.lede}</p>
      </div>
      <ul className={styles.grades}>
        {GRADE_IDS.map((grade: Grade) => {
          const tile = gradeTile(grade);
          const on = picked === `grade:${grade}`;
          return (
            <li key={grade}>
              <button
                type="button"
                className={styles.tile}
                aria-pressed={on}
                aria-label={grade === 0 ? tile.small : `${tile.big} ${tile.small}`}
                onClick={() => onPick({ kind: "grade", grade })}
              >
                <span className={styles.tileBig} aria-hidden>
                  {tile.big}
                </span>
                <span className={styles.tileSmall} aria-hidden>
                  {tile.small}
                </span>
                {on && <TutorCheck className={styles.cornerCheck} seed={grade + 5} />}
              </button>
            </li>
          );
        })}
        <li className={styles.wideTile}>
          <button type="button" className={styles.choice} aria-pressed={choice?.kind === "course"} onClick={() => setCourses(true)}>
            <span className={styles.choiceText}>
              <span className={styles.choiceName}>{copy.highSchool}</span>
              <span className={styles.choiceHint}>{copy.highSchoolHint}</span>
            </span>
            <ChevronRight className={styles.chevron} size={20} strokeWidth={2} aria-hidden />
          </button>
        </li>
      </ul>
    </>
  );
}
