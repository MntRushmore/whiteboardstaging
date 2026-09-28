"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { BetaBadge } from "@/components/app/BetaBadge";
import { clientMetric } from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import { describeError } from "@/lib/errorMessage";
import { boardTitleFromLatex, DEFAULT_BOARD_TITLE } from "@/lib/boards/boardTitle";
import { COURSES, starterIndex, startersFor } from "@/lib/onboarding/courses";
import type { CourseId } from "@/lib/onboarding/courseIds";
import { WELCOME_COPY } from "@/lib/onboarding/copy";
import { browserStorage, writeTourMarker } from "@/lib/onboarding/marker";
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
  { id: "course", label: "Your course" },
];

// Arc truncates a card's label to one line; a course name wraps instead ("Pre-calculus / Calculus").
const COURSE_OPTIONS = COURSES.map((c) => ({
  value: c.id,
  label: <span className={styles.courseLabel}>{c.label}</span>,
  description: c.blurb,
}));

/**
 * The welcome a new student sees on the boards home (loaded with a dynamic import, only when
 * `useWelcome` says so): what the product does in two lines, their course, and Start — which
 * creates their first board and opens it in the guided state (`BoardTour`). Skip, at either step,
 * marks onboarding done and leaves them on the home's empty state.
 */

export interface WelcomeProps {
  userId: string;
  onSkip: (course: CourseId | null, step: number) => void;
}

export default function Welcome({ userId, onSkip }: WelcomeProps) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [course, setCourse] = useState<CourseId | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

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

  async function start() {
    if (!course || starting) return;
    setStarting(true);
    setError(null);
    const index = starterIndex(course, userId);
    const [first] = startersFor(course, index);
    const title = (first && boardTitleFromLatex(first.lines[0])) || DEFAULT_BOARD_TITLE;
    clientMetric("onboarding.welcome.start", { course });
    const [, board] = await Promise.all([saveOnboarding(client, { course }), createFirstBoard(client, userId, title)]);
    if (!board.ok) {
      clientMetric("onboarding.welcome.createFailed", { course });
      setError(describeError(new Error(board.error), "The board was not created. Retry in a moment."));
      setStarting(false);
      return;
    }
    writeTourMarker(browserStorage(), userId, { boardId: board.value, course, starter: index, step: "problem" });
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
            <h1 id="welcome-title" ref={headingRef} tabIndex={-1} className={styles.courseTitle}>
              {WELCOME_COPY.courseTitle}
            </h1>
            <p className={styles.courseLede}>{WELCOME_COPY.courseLede}</p>
            <RadioCards
              className={styles.courses}
              aria-labelledby="welcome-title"
              options={COURSE_OPTIONS}
              value={course}
              minColumnWidth={200}
              disabled={starting}
              onValueChange={(value) => {
                const id = value as CourseId;
                setCourse(id);
                setError(null);
                clientMetric("onboarding.welcome.course", { course: id });
              }}
            />
            {error && (
              <Alert tone="danger" title={WELCOME_COPY.createFailed} className={styles.error}>
                {error}
              </Alert>
            )}
            <div className={styles.actions}>
              {/* While starting, the label itself says what is happening (Arc's loading state would hide it). */}
              <Button size="lg" onClick={() => void start()} disabled={!course} aria-busy={starting || undefined}>
                {starting ? WELCOME_COPY.starting : error ? "Try again" : WELCOME_COPY.start}
                {!starting && <ArrowRight size={16} strokeWidth={1.9} aria-hidden />}
              </Button>
              <Button size="lg" variant="secondary" onClick={() => go(1)} disabled={starting}>
                {WELCOME_COPY.back}
              </Button>
              <Button size="lg" variant="ghost" className={styles.skipEnd} onClick={() => onSkip(course, 2)} disabled={starting}>
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
