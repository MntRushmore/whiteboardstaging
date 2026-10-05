"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, BookOpen, Plus, RefreshCw, Sprout } from "lucide-react";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader, APP_CONTENT_CLASS } from "@/components/app/AppHeader";
import { usePlanGate } from "@/components/billing/usePlanGate";
import { PROGRESS_COPY, buildProgressView, progressStateFor, type ProgressState, type ProgressView } from "@/lib/learning/progressView";
import { Button } from "@/registry/components/button/button";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { ActivityChart } from "./ActivityChart";
import { GrownUps, LevelLadder, MistakeList, ProgressSkeleton, Section, SkillMap, WeekTiles } from "./ProgressSections";
import { RecentProblems } from "./RecentProblems";
import { useBoardActions, useProgressData, type BoardActions } from "./useProgress";
import styles from "./progress.module.css";

export interface ProgressContentProps {
  state: ProgressState;
  view: ProgressView | null;
  error: string | null;
  onRetry: () => void;
  actions: BoardActions;
}

/**
 * The page under the header, for each state: skeletons while loading, a retry on failure, a
 * friendly start (and the course's skills) before any problem, and otherwise, top to bottom:
 * this week, the last 4 weeks, the skills, the slips to watch, recent problems and a paragraph
 * for grown-ups. Takes a finished view model (`buildProgressView`), so it renders from fixtures too.
 */
export function ProgressContent({ state, view, error, onRetry, actions }: ProgressContentProps) {
  const newBoardButton = (
    <Button onClick={actions.newBoard} disabled={actions.busy !== null} aria-busy={actions.busy === "new" || undefined}>
      <Plus size={16} strokeWidth={2} aria-hidden />
      {actions.busy === "new" ? PROGRESS_COPY.practiceStarting : PROGRESS_COPY.newBoard}
    </Button>
  );

  return (
    <div className={styles.inner}>
      <header className={styles.hero}>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} strokeWidth={1.9} aria-hidden />
          {PROGRESS_COPY.back}
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{PROGRESS_COPY.title}</h1>
          {view?.course && (
            <span className={styles.course}>
              <BookOpen size={15} strokeWidth={1.9} aria-hidden />
              <span className={styles.srOnly}>Course: </span>
              {view.course}
            </span>
          )}
        </div>
      </header>

      {state === "loading" || (state !== "error" && !view) ? (
        <ProgressSkeleton />
      ) : state === "error" || !view ? (
        <div role="alert" data-state="error" className={styles.state}>
          <EmptyState
            icon={<AlertTriangle size={22} strokeWidth={1.5} />}
            title={PROGRESS_COPY.loadFailedTitle}
            description={error ?? PROGRESS_COPY.loadFallback}
            action={
              <Button variant="secondary" onClick={onRetry}>
                <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
                {PROGRESS_COPY.retry}
              </Button>
            }
          />
        </div>
      ) : state === "empty" ? (
        <>
          <div data-state="empty" className={styles.state}>
            <EmptyState
              icon={<Sprout size={24} strokeWidth={1.6} />}
              title={PROGRESS_COPY.emptyTitle}
              description={PROGRESS_COPY.emptyHint}
              action={newBoardButton}
            />
          </div>
          {view.skills.length > 0 && (
            <Section id="skills-title" title={view.skillsTitle} hint={PROGRESS_COPY.skillsHint} extra={<LevelLadder />}>
              <SkillMap groups={view.skills} busy={actions.busy} canPractice={actions.canPractice} onPractice={actions.practice} />
            </Section>
          )}
          <GrownUps text={view.grownUps} />
        </>
      ) : (
        <>
          <Section id="week-title" title={PROGRESS_COPY.weekTitle} hint={PROGRESS_COPY.weekHint}>
            <WeekTiles tiles={view.tiles} />
          </Section>
          <Section id="activity-title" title={PROGRESS_COPY.activityTitle} hint={PROGRESS_COPY.activityHint}>
            <div className={styles.panel}>
              <ActivityChart chart={view.chart} />
            </div>
          </Section>
          {view.skills.length > 0 && (
            <Section id="skills-title" title={view.skillsTitle} hint={PROGRESS_COPY.skillsHint} extra={<LevelLadder />}>
              <SkillMap groups={view.skills} busy={actions.busy} canPractice={actions.canPractice} onPractice={actions.practice} />
            </Section>
          )}
          {view.mistakes.length > 0 && (
            <Section id="watch-title" title={PROGRESS_COPY.watchTitle} hint={PROGRESS_COPY.watchHint}>
              <MistakeList items={view.mistakes} />
            </Section>
          )}
          {view.recent.length > 0 && (
            <Section id="recent-title" title={PROGRESS_COPY.recentTitle}>
              <RecentProblems items={view.recent} />
            </Section>
          )}
          <GrownUps text={view.grownUps} />
        </>
      )}
    </div>
  );
}

/**
 * /progress: the student's own learning record, for them and the grown-up beside them. Signed-in
 * only, like the boards home and /account (signed out goes to /login; a sign-in service that
 * cannot be reached shows its banner with Retry instead).
 */
export function ProgressScreen() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const { data, reload } = useProgressData(user?.id);
  const actions = useBoardActions(user?.id);

  useEffect(() => {
    if (!authLoading && !user && !authError) router.replace("/login");
  }, [user, authLoading, authError, router]);
  // No free plan: without Agathon Unlimited, the plan screen.
  usePlanGate({ page: "progress" });

  const view = useMemo(
    () =>
      data.status === "ready"
        ? buildProgressView(data.summary, {
            attempts: data.attempts,
            now: data.now,
            tzOffsetMinutes: data.tzOffsetMinutes,
            course: data.profile.course,
            displayName: data.profile.displayName,
          })
        : null,
    [data],
  );

  if (!user && authError) {
    return (
      <div className={`${styles.page} ${styles.authError}`}>
        <div className={styles.authErrorInner}>
          <AuthErrorBanner />
        </div>
      </div>
    );
  }

  const state = progressStateFor({
    loading: authLoading || !user || data.status === "loading",
    error: data.status === "error" ? data.error : null,
    summary: data.status === "ready" ? data.summary : null,
  });

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={`${APP_CONTENT_CLASS} ${styles.main}`}>
        <div className={styles.banners}>
          <AuthErrorBanner />
        </div>
        <ProgressContent state={state} view={view} error={data.status === "error" ? data.error : null} onRetry={reload} actions={actions} />
      </main>
    </div>
  );
}
