"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clientMetric } from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import { describeError } from "@/lib/errorMessage";
import { boardTitleFromLatex, DEFAULT_BOARD_TITLE } from "@/lib/boards/boardTitle";
import { COURSES, starterIndex, startersFor, type CourseId } from "@/lib/onboarding/courses";
import { PRODUCT_PICTURES, WELCOME_COPY } from "@/lib/onboarding/copy";
import { browserStorage, writeTourMarker } from "@/lib/onboarding/marker";
import { asOnboardingClient, createFirstBoard, saveOnboarding } from "@/lib/onboarding/storage";

const client = asOnboardingClient(supabase);

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
    <section
      aria-labelledby="welcome-title"
      data-onboarding="welcome"
      data-step={step}
      className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-xl border bg-card shadow-xs md:min-h-128 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col p-6 sm:p-8 lg:p-10">
        <Progress step={step} />
        {step === 1 ? (
          <div className="mt-6 flex flex-1 flex-col">
            <p className="text-sm font-medium text-muted-foreground">{WELCOME_COPY.kicker}</p>
            <h1 id="welcome-title" ref={headingRef} tabIndex={-1} className="mt-2 text-3xl font-bold tracking-tight text-balance outline-none sm:text-4xl">
              {WELCOME_COPY.title}
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
              {WELCOME_COPY.lines[0]}
              <br />
              {WELCOME_COPY.lines[1]}
            </p>
            {/* the picture sits beside the words on a desktop; on a phone it goes between them and the buttons */}
            <Pictures className="mt-8 md:hidden" compact />
            <div className="mt-8 flex flex-wrap items-center gap-2 md:mt-auto md:pt-10">
              <Button size="lg" onClick={() => go(2)}>
                {WELCOME_COPY.getStarted}
                <ArrowRight />
              </Button>
              <Button size="lg" variant="ghost" className="text-muted-foreground" onClick={() => onSkip(null, 1)}>
                {WELCOME_COPY.skip}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-1 flex-col">
            <h1 id="welcome-title" ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-balance outline-none">
              {WELCOME_COPY.courseTitle}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{WELCOME_COPY.courseLede}</p>
            <fieldset className="mt-5" disabled={starting}>
              <legend className="sr-only">{WELCOME_COPY.courseTitle}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {COURSES.map((c) => {
                  const checked = course === c.id;
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "relative flex cursor-pointer items-start gap-3 rounded-lg border bg-background px-3.5 py-3 transition-colors hover:bg-accent/60",
                        "has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
                        checked && "border-foreground/80 bg-accent/60",
                        c.id === "other" && "sm:col-span-2",
                      )}
                    >
                      <input
                        type="radio"
                        name="course"
                        value={c.id}
                        checked={checked}
                        onChange={() => {
                          setCourse(c.id);
                          setError(null);
                          clientMetric("onboarding.welcome.course", { course: c.id });
                        }}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-input bg-background",
                          checked && "border-foreground bg-foreground text-background",
                        )}
                      >
                        {checked && <Check className="size-3" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{c.label}</span>
                        <span className="block text-xs text-muted-foreground">{c.blurb}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {error && (
              <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>
                  <span className="font-medium">{WELCOME_COPY.createFailed}.</span> {error}
                </p>
              </div>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-2 md:mt-auto md:pt-8">
              <Button size="lg" onClick={() => void start()} disabled={!course || starting}>
                {starting ? <Loader2 className="animate-spin" /> : null}
                {starting ? WELCOME_COPY.starting : error ? "Try again" : WELCOME_COPY.start}
                {!starting && <ArrowRight />}
              </Button>
              <Button size="lg" variant="outline" onClick={() => go(1)} disabled={starting}>
                {WELCOME_COPY.back}
              </Button>
              <Button size="lg" variant="ghost" className="text-muted-foreground sm:ml-auto" onClick={() => onSkip(course, 2)} disabled={starting}>
                {WELCOME_COPY.skip}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="hidden min-w-0 border-l bg-muted/50 p-8 md:flex md:items-center lg:p-10">
        <Pictures />
      </div>
    </section>
  );
}

function Progress({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1.5" aria-hidden>
        {[1, 2].map((n) => (
          <span key={n} className={cn("h-1.5 w-8 rounded-full bg-border transition-colors", n <= step && "bg-foreground")} />
        ))}
      </div>
      <p className="text-xs font-medium text-muted-foreground">Step {step} of 2</p>
    </div>
  );
}

/** The sign-in page's product pictures: the tutor solving and graphing, and ticks on a student's steps. */
function Pictures({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { solved, checked } = PRODUCT_PICTURES;
  return (
    <figure className={cn("relative w-full", compact ? "mr-4 mb-4 max-w-sm" : "mr-6 mb-6", className)}>
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Image src={solved.src} alt={solved.alt} width={solved.width} height={solved.height} sizes="(min-width: 768px) 40vw, 90vw" className="h-auto w-full" />
      </div>
      <div className={cn("absolute overflow-hidden rounded-lg border bg-card shadow-md", compact ? "-right-4 -bottom-4 w-[42%]" : "-right-6 -bottom-6 w-[44%]")}>
        <Image src={checked.src} alt={checked.alt} width={checked.width} height={checked.height} sizes="(min-width: 768px) 18vw, 40vw" className="h-auto w-full" />
      </div>
    </figure>
  );
}
