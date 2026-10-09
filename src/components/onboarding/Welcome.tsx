"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { BetaBadge } from "@/components/app/BetaBadge";
import { clientMetric } from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import { describeError } from "@/lib/errorMessage";
import { boardTitleFromLatex, DEFAULT_BOARD_TITLE } from "@/lib/boards/boardTitle";
import { GRADES } from "@/lib/learning/grades";
import { HEARD_FROM, type HeardFrom } from "@/lib/funnel/contracts";
import { choiceKey, choiceSave, gradeTile, HIGH_SCHOOL_COURSES, parseChoiceKey, SOMETHING_ELSE, type WelcomeChoice } from "@/lib/onboarding/choice";
import { starterBoardTitle, starterIndex, startersFor } from "@/lib/onboarding/courses";
import type { CourseId } from "@/lib/onboarding/courseIds";
import { WELCOME_COPY } from "@/lib/onboarding/copy";
import { browserStorage, writeTourMarker } from "@/lib/onboarding/marker";
import type { OnboardingSave } from "@/lib/onboarding/storage";
import { asOnboardingClient, createFirstBoard, saveOnboarding } from "@/lib/onboarding/storage";
import { ProductPictures } from "@/components/app/ProductPictures";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";
import { RadioCards } from "@/registry/components/radio-cards/radio-cards";
import { Stepper } from "@/registry/components/stepper/stepper";
import styles from "./welcome.module.css";

const client = asOnboardingClient(supabase);

const STEPS = [
  { id: "welcome", label: "How it works" },
  { id: "grade", label: WELCOME_COPY.gradeStep },
  { id: "try", label: "Try it" },
];

// Kindergarten to 8th: a big short name and a small word under it, so each card reads "3rd grade".
const GRADE_OPTIONS = GRADES.map((g) => {
  const tile = gradeTile(g.id);
  return {
    value: choiceKey({ kind: "grade", grade: g.id }) as string,
    label: (
      <span className={styles.gradeTile}>
        <span className={styles.gradeBig}>{tile.big}</span>
        <span className={styles.gradeSmall}>{tile.small}</span>
      </span>
    ),
  };
});

// Arc truncates a card's label to one line; a course name wraps instead ("Pre-calculus / Calculus").
const COURSE_OPTIONS = [...HIGH_SCHOOL_COURSES, SOMETHING_ELSE].map((c) => ({
  value: choiceKey({ kind: "course", course: c.id }) as string,
  label: <span className={styles.courseLabel}>{c.label}</span>,
  description: c.blurb,
}));

/**
 * The welcome a new student sees on the boards home (loaded with a dynamic import, only when
 * `useWelcome` says so): what the product does in two lines, then their grade — Kindergarten to
 * 8th first, since most students are young, then the high-school courses and "Something else" —
 * with "How did you hear about Agathon?" for the grown-up underneath (optional), and Start, which
 * creates their first board and opens it in the guided state (`BoardTour`) on a starter from
 * their grade. Skip, at either step, marks onboarding done and leaves them on the home's empty
 * state, keeping whatever they picked.
 */

export interface WelcomeProps {
  userId: string;
  onSkip: (course: CourseId | null, step: number, more?: Pick<OnboardingSave, "grade" | "heardFrom">) => void;
}

export default function Welcome({ userId, onSkip }: WelcomeProps) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [choice, setChoice] = useState<WelcomeChoice | null>(null);
  const [heardFrom, setHeardFrom] = useState<HeardFrom | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const key = choiceKey(choice);

  // moving between the two steps takes focus to the new heading (not on first paint)
  useEffect(() => {
    if (!moved.current) return;
    headingRef.current?.focus();
  }, [step]);

  function go(next: 1 | 2) {
    moved.current = true;
    setStep(next);
    if (next === 2) clientMetric("onboarding.welcome.step", { step: 2 });
  }

  function pick(value: string) {
    const next = parseChoiceKey(value);
    if (!next) return;
    setChoice(next);
    setError(null);
    clientMetric("onboarding.welcome.course", next.kind === "grade" ? { course: "other", grade: next.grade } : { course: next.course, grade: null });
  }

  function hear(id: HeardFrom) {
    const next = heardFrom === id ? null : id;
    setHeardFrom(next);
    clientMetric("onboarding.welcome.heardFrom", { heardFrom: next });
  }

  function skip() {
    const { course, grade } = choiceSave(choice);
    onSkip(course, 2, { grade, heardFrom });
  }

  async function start() {
    if (!choice || starting) return;
    setStarting(true);
    setError(null);
    const { course, grade } = choiceSave(choice);
    const own = course ?? "other";
    const index = starterIndex(own, userId, grade);
    const [first] = startersFor(own, index, grade);
    const title = starterBoardTitle(first) || (first && boardTitleFromLatex(first.lines[0])) || DEFAULT_BOARD_TITLE;
    clientMetric("onboarding.welcome.start", { course, grade, heardFrom });
    const [, board] = await Promise.all([saveOnboarding(client, { course, grade, heardFrom }), createFirstBoard(client, userId, title)]);
    if (!board.ok) {
      clientMetric("onboarding.welcome.createFailed", { course, grade });
      setError(describeError(new Error(board.error), "The board was not created. Retry in a moment."));
      setStarting(false);
      return;
    }
    writeTourMarker(browserStorage(), userId, { boardId: board.value, course: own, ...(grade === null ? {} : { grade }), starter: index, step: "problem" });
    router.push(`/board/${board.value}`);
  }

  return (
    <section aria-labelledby="welcome-title" data-onboarding="welcome" data-step={step} className={styles.welcome}>
      <div className={styles.main}>
        <Stepper steps={STEPS} current={step - 1} label="Getting started" />
        {step === 1 ? (
          <div className={styles.step}>
            <p className={styles.kicker}>{WELCOME_COPY.kicker}</p>
            <h1 id="welcome-title" ref={headingRef} tabIndex={-1} className={styles.title}>
              {WELCOME_COPY.title}
            </h1>
            <p className={styles.lede}>
              {WELCOME_COPY.lines[0]}
              <br />
              {WELCOME_COPY.lines[1]}
            </p>
            <ProductPictures
              className={styles.phonePictures}
              compact
              sizes={{ solved: "(min-width: 768px) 1px, 90vw", checked: "(min-width: 768px) 1px, 40vw" }}
            />
            <div className={styles.actions}>
              <Button size="lg" onClick={() => go(2)}>
                {WELCOME_COPY.getStarted}
                <ArrowRight size={16} strokeWidth={1.9} aria-hidden />
              </Button>
              <Button size="lg" variant="ghost" onClick={() => onSkip(null, 1)}>
                {WELCOME_COPY.skip}
              </Button>
            </div>
            <p className={styles.betaNote}>
              <BetaBadge className={styles.betaBadge} />
              <span>{WELCOME_COPY.beta}</span>
            </p>
          </div>
        ) : (
          <div className={styles.step}>
            <h1 id="welcome-title" ref={headingRef} tabIndex={-1} className={styles.gradeTitle}>
              {WELCOME_COPY.gradeTitle}
            </h1>
            <p className={styles.gradeLede}>{WELCOME_COPY.gradeLede}</p>
            <RadioCards
              className={styles.grades}
              aria-label={WELCOME_COPY.gradesLabel}
              options={GRADE_OPTIONS}
              value={key}
              disabled={starting}
              onValueChange={pick}
            />
            <p id="welcome-high-school" className={styles.groupLabel}>
              {WELCOME_COPY.highSchool}
            </p>
            <RadioCards
              className={styles.courses}
              aria-labelledby="welcome-high-school"
              options={COURSE_OPTIONS}
              value={key}
              disabled={starting}
              onValueChange={pick}
            />
            <div className={styles.heard} role="group" aria-labelledby="welcome-heard" aria-describedby="welcome-heard-hint">
              <p id="welcome-heard" className={styles.groupLabel}>
                {WELCOME_COPY.heardTitle}
              </p>
              <p id="welcome-heard-hint" className={styles.groupHint}>
                {WELCOME_COPY.heardHint}
              </p>
              <div className={styles.chips}>
                {HEARD_FROM.map((h) => (
                  <Button
                    key={h.id}
                    size="sm"
                    variant={heardFrom === h.id ? "primary" : "secondary"}
                    className={styles.chip}
                    aria-pressed={heardFrom === h.id}
                    disabled={starting}
                    onClick={() => hear(h.id)}
                  >
                    {h.label}
                  </Button>
                ))}
              </div>
            </div>
            {error && (
              <Alert tone="danger" title={WELCOME_COPY.createFailed} className={styles.error}>
                {error}
              </Alert>
            )}
            <div className={`${styles.actions} ${styles.gradeActions}`}>
              {/* While starting, the label itself says what is happening (Arc's loading state would hide it). */}
              <Button size="lg" onClick={() => void start()} disabled={!choice} aria-busy={starting || undefined}>
                {starting ? WELCOME_COPY.starting : error ? "Try again" : WELCOME_COPY.start}
                {!starting && <ArrowRight size={16} strokeWidth={1.9} aria-hidden />}
              </Button>
              <Button size="lg" variant="secondary" onClick={() => go(1)} disabled={starting}>
                {WELCOME_COPY.back}
              </Button>
              <Button size="lg" variant="ghost" className={styles.skipEnd} onClick={skip} disabled={starting}>
                {WELCOME_COPY.skip}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className={styles.aside}>
        <ProductPictures
          className={styles.asidePictures}
          entrance
          sizes={{ solved: "(min-width: 1024px) 26rem, (min-width: 768px) 40vw, 1px", checked: "(min-width: 1024px) 12rem, (min-width: 768px) 18vw, 1px" }}
        />
      </div>
    </section>
  );
}
