"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader, APP_CONTENT_CLASS } from "@/components/app/AppHeader";
import { ADMIN_COPY, buildAdminView, serviceCards, statusSummary, statusesFromResults, type AdminView } from "@/lib/admin/view";
import { Button } from "@/registry/components/button/button";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { AdminSkeleton, AiTable, BugReports, CheckNow, ErrorGroups, RefreshBar, Section, ServiceGrid, StatTiles, StatusSummary, UpcomingCharges } from "./AdminSections";
import { ErrorChart } from "./ErrorChart";
import { useAdminOverview, type CheckState } from "./useAdminOverview";
import { useIsAdmin } from "./useIsAdmin";
import styles from "./admin.module.css";

export interface AdminContentProps {
  view: AdminView | null;
  /** a read is in flight */
  loading: boolean;
  /** the last read failed */
  error: string | null;
  check: CheckState;
  onRefresh: () => void;
  onCheckNow: () => void;
  /** ms since the epoch, for the live check's cards */
  now: number;
}

/**
 * The page under the header: the title and refresh, then Status, Errors students saw, AI, Users and
 * learning, Bug reports. Skeletons on the first read; a failed first read says what failed, with
 * Try again and Check now (the checks still run when the overview cannot be read: a paused database
 * is exactly when). A failed refresh keeps the last overview and says so. Takes a finished view
 * (`buildAdminView`), so it renders from fixtures too.
 */
export function AdminContent({ view, loading, error, check, onRefresh, onCheckNow, now }: AdminContentProps) {
  // only the services the check covered: one it did not run is not "not checked yet"
  const live = check.results
    ? serviceCards({ services: statusesFromResults(check.results), openrouter: null }, { now }).filter((c) => check.results?.some((r) => r.service === c.service))
    : null;

  return (
    <div className={styles.inner}>
      <header className={styles.hero}>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} strokeWidth={1.9} aria-hidden />
          {ADMIN_COPY.back}
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{ADMIN_COPY.title}</h1>
          {view && <RefreshBar updated={view.updated} refreshing={loading} stale={error ? ADMIN_COPY.loadFailedTitle : null} onRefresh={onRefresh} />}
        </div>
        {view && <p className={styles.heroHint}>{ADMIN_COPY.autoRefresh}</p>}
      </header>

      {!view && loading ? (
        <AdminSkeleton />
      ) : !view ? (
        <>
          <div role="alert" className={styles.state}>
            <EmptyState
              icon={<TriangleAlert size={22} strokeWidth={1.6} />}
              title={ADMIN_COPY.loadFailedTitle}
              description={error ?? ADMIN_COPY.loadFallback}
              action={
                <Button variant="secondary" onClick={onRefresh}>
                  <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
                  {ADMIN_COPY.retry}
                </Button>
              }
            />
          </div>
          <Section id="status-title" title={ADMIN_COPY.statusTitle} hint={ADMIN_COPY.statusHint} action={<CheckNow check={check} onCheck={onCheckNow} />}>
            {live && (
              <>
                <StatusSummary summary={statusSummary(live, statusesFromResults(check.results ?? []), { now })} />
                <h3 className={styles.subTitle}>{ADMIN_COPY.liveCheckTitle}</h3>
                <ServiceGrid cards={live} />
              </>
            )}
          </Section>
        </>
      ) : (
        <div className={styles.sections} data-refreshing={loading || undefined}>
          <Section id="status-title" title={ADMIN_COPY.statusTitle} hint={ADMIN_COPY.statusHint} action={<CheckNow check={check} onCheck={onCheckNow} />}>
            <StatusSummary summary={view.summary} />
            <ServiceGrid cards={view.services} />
          </Section>

          <Section id="money-title" title={ADMIN_COPY.moneyTitle} hint={ADMIN_COPY.moneyHint}>
            <StatTiles tiles={view.money.tiles} columns={3} />
            <UpcomingCharges days={view.money.upcoming} />
          </Section>

          <Section id="errors-title" title={ADMIN_COPY.errorsTitle} hint={ADMIN_COPY.errorsHint}>
            <div className={styles.panel}>
              <p className={styles.totals} data-some={view.errors.chart.hasData || undefined}>
                {view.errors.totals}
              </p>
              <h3 className={styles.chartTitle}>{ADMIN_COPY.chartTitle}</h3>
              <ErrorChart chart={view.errors.chart} />
            </div>
            <ErrorGroups groups={view.errors.groups} />
          </Section>

          <Section id="ai-title" title={ADMIN_COPY.aiTitle} hint={ADMIN_COPY.aiHint}>
            <AiTable table={view.ai} />
          </Section>

          <Section id="users-title" title={ADMIN_COPY.usersTitle} hint={ADMIN_COPY.usersHint}>
            <StatTiles tiles={view.tiles} />
            <p className={styles.funnel}>{view.funnel}</p>
          </Section>

          <Section id="bugs-title" title={ADMIN_COPY.bugsTitle} hint={ADMIN_COPY.bugsHint}>
            <BugReports reports={view.bugs} />
          </Section>
        </div>
      )}
    </div>
  );
}

/** "Now", ticking every 15 s, so "Updated 2 min ago" stays true between reads. */
function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

/**
 * /admin: the owner's view of whether the backend and the AI are up and what errors students see.
 * Signed out goes to /login. Anyone who is not an admin gets the plain "Page not found" (`notFound`,
 * the app's own 404, rendered by the server page), never a hint that the page exists: the
 * is_admin() hint (cached) answers at once for a known non-admin, and the overview route's 404
 * answers for everyone else. Nothing here imports tldraw or the board.
 */
export function AdminScreen({ notFound }: { notFound: ReactNode }) {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const hint = useIsAdmin(user?.id, { lazy: false });
  const { data, refresh, check, checkNow } = useAdminOverview(user && hint !== false ? user.id : undefined);
  const now = useNow();

  const hidden = hint === false || data.notFound;
  const signedOut = (!authLoading && !user && !authError) || data.signedOut;

  useEffect(() => {
    if (signedOut) router.replace("/login");
  }, [signedOut, router]);

  useEffect(() => {
    if (hidden) document.title = ADMIN_COPY.notFoundTitle;
    else if (data.overview) document.title = ADMIN_COPY.documentTitle;
  }, [hidden, data.overview]);

  const view = useMemo(() => (data.overview ? buildAdminView(data.overview, { now }) : null), [data.overview, now]);

  if (!user && authError) {
    return (
      <div className={`${styles.page} ${styles.authError}`}>
        <div className={styles.authErrorInner}>
          <AuthErrorBanner />
        </div>
      </div>
    );
  }
  if (hidden) return <>{notFound}</>;
  // Until the server has answered, a non-admin must not see an admin page's frame: a blank page,
  // unless the cached hint already says this is an admin.
  if (!user || (!data.overview && !data.error && hint !== true)) return <div className={styles.page} />;

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={`${APP_CONTENT_CLASS} ${styles.main}`}>
        <AdminContent view={view} loading={data.loading} error={data.error} check={check} onRefresh={refresh} onCheckNow={checkNow} now={now} />
      </main>
    </div>
  );
}
