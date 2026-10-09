"use client";

import { Check, Flame, Play, Sparkles, Star } from "lucide-react";
import { Button } from "@/registry/components/button/button";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import { ConfettiBurst } from "@/components/onboarding/ConfettiBurst";
import { TODAY_COPY } from "@/lib/daily/copy";
import type { DailyStreak, DayState } from "@/lib/daily/contracts";
import { useToday, type TodayActions, type TodayState } from "./useToday";
import styles from "./today.module.css";

/**
 * Today's practice on the boards home (src/lib/daily/contracts.ts): the first thing a student sees,
 * because a short set every day is what brings them back. One big button — Start, then Continue —
 * the day's stars as they earn them, the streak's flame and this week as dots; once the set is done,
 * "You did it! Come back tomorrow!" and a small Practise more.
 *
 * Loaded with a dynamic import, so the home's first load carries none of it. While the day loads
 * it shows a skeleton of its own shape; a read that fails still offers Start (no streak), so it
 * never blocks or breaks the home. Motion is gentle and off under prefers-reduced-motion.
 */

export interface TodayCardProps {
  userId: string;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/** The day's star slots: gold for solved alone, filled for done with help, empty for still to do. */
export function StarRow({ goal, done, stars, size = 30 }: { goal: number; done: number; stars: number; size?: number }) {
  const slots = Array.from({ length: Math.max(1, goal) }, (_, i) => (i < stars ? "star" : i < done ? "done" : "empty"));
  return (
    <div className={styles.stars} role="img" aria-label={TODAY_COPY.starsLabel(Math.min(stars, goal), Math.min(done, goal), goal)}>
      {slots.map((kind, i) => (
        <span key={i} className={styles.star} data-star={kind} style={{ ["--i" as string]: i }}>
          <Star size={size} strokeWidth={2} aria-hidden />
        </span>
      ))}
    </div>
  );
}

/** This week, Monday first: a dot per day, today ringed. */
export function WeekDots({ week, today }: { week: DailyStreak["week"]; today: string }) {
  return (
    <ol className={styles.week} aria-label={TODAY_COPY.weekLabel}>
      {week.map((d, i) => (
        <li key={d.day} className={styles.weekDay} data-state={d.state} data-today={d.day === today ? "" : undefined} aria-label={TODAY_COPY.dayLabel(WEEKDAYS[i], TODAY_COPY.dayStates[d.state as DayState])}>
          <span className={styles.weekLetter} aria-hidden>
            {WEEKDAY_LETTERS[i]}
          </span>
          <span className={styles.weekDot} aria-hidden>
            {d.state === "done" && <Check size={14} strokeWidth={3} />}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The flame and its count, this week, and the best run when it is longer. */
export function StreakPanel({ streak, today }: { streak: DailyStreak; today: string }) {
  const lit = streak.current > 0;
  return (
    <div className={styles.streak} data-lit={lit ? "" : undefined}>
      <div className={styles.flameRow}>
        <span className={styles.flame} aria-hidden>
          <Flame size={30} strokeWidth={2} />
        </span>
        <p className={styles.streakText}>
          {lit ? (
            <>
              <span className={styles.srOnly}>{TODAY_COPY.streak(streak.current)}</span>
              <strong className={styles.streakCount} aria-hidden>
                {streak.current}
              </strong>
              <span className={styles.streakLabel} aria-hidden>
                {TODAY_COPY.streakUnit(streak.current)}
              </span>
            </>
          ) : (
            <span className={styles.streakLabel}>{TODAY_COPY.streakNone}</span>
          )}
        </p>
        {streak.best > streak.current && <span className={styles.best}>{TODAY_COPY.best(streak.best)}</span>}
      </div>
      <WeekDots week={streak.week} today={today} />
    </div>
  );
}

/** The card for a day that has loaded. Exported for its markup test. */
export function TodayView({ state, actions }: { state: Extract<TodayState, { status: "ready" }>; actions: TodayActions }) {
  const { phase, goal, done, stars } = state;
  const titleId = "today-practice-title";
  return (
    <section className={styles.card} data-phase={phase} aria-labelledby={titleId} data-today-card="">
      <span className={styles.glow} aria-hidden />
      {phase === "done" && state.justFinished && <ConfettiBurst count={48} spread={200} className={styles.confetti} />}
      <div className={styles.main}>
        <p className={styles.eyebrow}>
          <Sparkles size={15} strokeWidth={2.2} aria-hidden />
          {TODAY_COPY.eyebrow}
        </p>
        <h2 id={titleId} className={styles.title}>
          {phase === "done" ? TODAY_COPY.doneTitle : phase === "continue" ? TODAY_COPY.progress(Math.min(done, goal), goal) : TODAY_COPY.title(goal)}
        </h2>
        <p className={styles.sub}>{phase === "done" ? TODAY_COPY.doneLine : TODAY_COPY.minutes(goal)}</p>
        <StarRow goal={goal} done={done} stars={stars} />
        <div className={styles.actions}>
          {phase === "start" && (
            <Button className={styles.go} size="lg" loading={actions.busy === "start"} disabled={actions.busy !== null && actions.busy !== "start"} aria-label={TODAY_COPY.startLabel(goal)} onClick={actions.start}>
              <Play size={20} strokeWidth={2.4} aria-hidden />
              {TODAY_COPY.start}
            </Button>
          )}
          {phase === "continue" && (
            <Button className={styles.go} size="lg" loading={actions.busy === "continue"} disabled={actions.busy !== null && actions.busy !== "continue"} aria-label={TODAY_COPY.continueLabel(Math.min(done, goal), goal)} onClick={actions.continueToday}>
              <Play size={20} strokeWidth={2.4} aria-hidden />
              {TODAY_COPY.continue}
            </Button>
          )}
          {phase === "done" && (
            <Button className={styles.more} variant="ghost" size="md" loading={actions.busy === "more"} disabled={actions.busy !== null && actions.busy !== "more"} onClick={actions.practiseMore}>
              {TODAY_COPY.more}
            </Button>
          )}
        </div>
      </div>
      {state.streak && <StreakPanel streak={state.streak} today={state.today} />}
    </section>
  );
}

export default function TodayCard({ userId }: TodayCardProps) {
  const { state, actions } = useToday(userId);
  if (state.status === "loading") {
    return (
      <div className={`${styles.card} ${styles.loading}`} data-today-card="">
        <Skeleton label={TODAY_COPY.eyebrow} lines={4} className={styles.skeleton} />
      </div>
    );
  }
  return <TodayView state={state} actions={actions} />;
}
