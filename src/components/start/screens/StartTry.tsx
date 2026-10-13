"use client";

import { useMemo, type Ref } from "react";
import { TryBoard, type TryBoardProblemView } from "@/components/try/TryBoard";
import { latexWords } from "@/components/try/words";
import type { WelcomeChoice } from "@/lib/onboarding/choice";
import type { FlowCopy } from "@/lib/start/flow";
import type { StartInkSet } from "@/lib/start/inkSet";
import { TRY_API, TRY_BANDS, TRY_MAX_LINES, type TryBandId } from "@/lib/try/contracts";
import { TRY_PROBLEMS } from "@/lib/try/problems";
import { HandLine, TutorCheck } from "../parts";
import tryStyles from "@/components/try/try.module.css";
import styles from "../start.module.css";

/** The try board's pen on the problem, as on /try. */
const PROBLEM_PEN = 4.2;

/** The try board's band for a grade or course. */
export function tryBand(choice: WelcomeChoice | null): TryBandId {
  if (choice?.kind === "course") return "hs";
  if (choice?.kind === "grade") return TRY_BANDS.find((b) => (b.grades as readonly number[]).includes(choice.grade))?.id ?? "g35";
  return "g35";
}

/**
 * The problem to start on: the band's starter for the plan's first skill at the kid's grade, else
 * the grade's first starter, else the band's first problem.
 */
export function tryProblemFor(choice: WelcomeChoice | null, firstSkill: string | null): string | null {
  const band = tryBand(choice);
  const list = TRY_PROBLEMS.filter((p) => p.band === band);
  const grade = choice?.kind === "grade" ? choice.grade : null;
  const pick =
    (firstSkill && list.find((p) => p.skill === firstSkill && (grade === null || p.grade === grade))) ||
    (grade !== null && list.find((p) => p.grade === grade)) ||
    list[0];
  return pick?.id ?? null;
}

export interface StartTryProps {
  copy: FlowCopy["try"];
  choice: WelcomeChoice | null;
  firstSkill: string | null;
  ink: StartInkSet | null;
  /** what happened on the board so far (the tutor checked a line right / finished a problem) */
  tried: { checked: boolean; solved: boolean } | null;
  onProgress: (progress: { checked: boolean; solved: boolean }) => void;
  onNext: () => void;
  titleRef: Ref<HTMLHeadingElement>;
}

/**
 * The one real moment before the account: the try board (src/components/try) with a problem from the
 * kid's grade, worded for whoever is there. Its problems are in the tutor's hand from the ink set;
 * the board's Join card is off, and the flow hears each check. Continue stays quiet until the tutor
 * has checked a line.
 */
export default function StartTry({ copy, choice, firstSkill, ink, tried, onProgress, onNext, titleRef }: StartTryProps) {
  const band = tryBand(choice);
  const problemId = tryProblemFor(choice, firstSkill);
  const problems = useMemo<TryBoardProblemView[]>(() => {
    if (!ink) return [];
    return TRY_PROBLEMS.filter((p) => p.band === band).map((p) => ({
      id: p.id,
      band: p.band,
      hint: p.hint,
      oneStep: p.oneStep,
      words: p.lines.map(latexWords).join(", "),
      ink: (
        <>
          {(ink.problems[p.id] ?? []).map((line, i) => (
            <HandLine key={i} line={line} pen={PROBLEM_PEN} draw />
          ))}
        </>
      ),
    }));
  }, [ink, band]);
  const first = TRY_PROBLEMS.find((p) => p.id === problemId);
  const done = !!tried?.checked || !!tried?.solved;

  return (
    <>
      <div className={styles.head}>
        <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
          {copy.title}
        </h1>
        <p className={styles.lede}>{copy.lede(first?.oneStep ?? true)}</p>
      </div>
      {/* the try board's own tokens (its pens, dots and lines) live on its page class */}
      <div className={`${tryStyles.page} ${styles.tryWrap}`}>
        {problems.length > 0 && problemId ? (
          <TryBoard
            problems={problems}
            bands={[]}
            defaultBand={band}
            api={{ check: TRY_API.check, help: TRY_API.help }}
            maxLines={TRY_MAX_LINES}
            terms={{ usual: "", invited: "" }}
            finishMark={<TutorCheck className={styles.titleCheck} atMs={150} />}
            join={false}
            onProgress={onProgress}
            initial={{ band, problemId }}
          />
        ) : (
          <div className={styles.tryLoading} aria-busy="true" />
        )}
      </div>
      <div className={styles.actions}>
        {done ? (
          <button type="button" className={styles.primary} onClick={onNext}>
            {copy.next}
          </button>
        ) : (
          <button type="button" className={styles.quiet} onClick={onNext}>
            {copy.later}
          </button>
        )}
      </div>
    </>
  );
}
