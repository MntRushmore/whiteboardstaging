"use client";

import { useMemo, type ReactNode } from "react";
import { ADMIN_API, AdminBoardListSchema, AdminBugListSchema, AdminIssueListSchema } from "@/lib/admin/contracts";
import { BOARDS_COPY, boardsUrl, liveNowView, type LiveNowView } from "@/lib/admin/boardsView";
import { newBugsPreview, type NewBugsPreview } from "@/lib/admin/bugsView";
import { CONSOLE_COPY } from "@/lib/admin/consoleView";
import { issuesUrl, topIssues, type TopIssuesView } from "@/lib/admin/issuesView";
import { ADMIN_COPY, buildAdminView, serviceCards, statusSummary, statusesFromResults, type AdminView } from "@/lib/admin/view";
import { AdminSkeleton, AiTable, BugReports, CheckNow, ErrorGroups, NewBugs, Section, ServiceGrid, StatTiles, StatusSummary, TopIssues, UpcomingCharges } from "./AdminSections";
import { AdminFrame, PageHeader, useAdminAccess } from "./AdminFrame";
import { LiveNow } from "./BoardTiles";
import { LoadFailed } from "./ConsoleBits";
import { ErrorChart } from "./ErrorChart";
import { useAdminOverview, type CheckState } from "./useAdminOverview";
import { useAdminResource } from "./useAdminResource";
import { useNow } from "./useNow";
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
  /** who is on a board now (the boards route, ?live=1); null until read */
  live?: LiveNowView | null;
  liveError?: string | null;
  /** the top open issues (the issues route); null until read or when it can't be (the 24-hour groups stand in) */
  issues?: TopIssuesView | null;
  /** the newest new bug reports (the bugs route); null until read or when it can't be (the latest 20 stand in) */
  bugs?: NewBugsPreview | null;
}

/**
 * The overview under the header: the title and refresh, then Status, Money, Live now, Errors
 * students saw (the chart and the top open issues), AI, Users and learning, Bug reports (the newest
 * new ones). Skeletons on the first read; a failed first read says what failed, with Try again and
 * Check now (the checks still run when the overview cannot be read: a paused database is exactly
 * when). A failed refresh keeps the last overview and says so. Takes finished views, so it renders
 * from fixtures too.
 */
export function AdminContent({ view, loading, error, check, onRefresh, onCheckNow, now, live = null, liveError = null, issues = null, bugs = null }: AdminContentProps) {
  // only the services the check covered: one it did not run is not "not checked yet"
  const liveCheck = check.results
    ? serviceCards({ services: statusesFromResults(check.results), openrouter: null }, { now }).filter((c) => check.results?.some((r) => r.service === c.service))
    : null;

  return (
    <div className={styles.inner}>
      <PageHeader
        title={ADMIN_COPY.overviewTitle}
        back={{ href: "/", label: ADMIN_COPY.back }}
        hint={view ? ADMIN_COPY.autoRefresh : undefined}
        updated={view ? view.updated : null}
        refreshing={loading}
        stale={error ? ADMIN_COPY.loadFailedTitle : null}
        onRefresh={onRefresh}
      />

      {!view && loading ? (
        <AdminSkeleton />
      ) : !view ? (
        <>
          <LoadFailed title={ADMIN_COPY.loadFailedTitle} error={error ?? ADMIN_COPY.loadFallback} onRetry={onRefresh} />
          <Section id="status-title" title={ADMIN_COPY.statusTitle} hint={ADMIN_COPY.statusHint} action={<CheckNow check={check} onCheck={onCheckNow} />}>
            {liveCheck && (
              <>
                <StatusSummary summary={statusSummary(liveCheck, statusesFromResults(check.results ?? []), { now })} />
                <h3 className={styles.subTitle}>{ADMIN_COPY.liveCheckTitle}</h3>
                <ServiceGrid cards={liveCheck} />
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

          <Section id="live-title" title={ADMIN_COPY.liveTitle} hint={BOARDS_COPY.liveHint}>
            <LiveNow live={live} error={liveError} compact />
          </Section>

          <Section id="errors-title" title={ADMIN_COPY.errorsTitle} hint={ADMIN_COPY.errorsHint}>
            <div className={styles.panel}>
              <p className={styles.totals} data-some={view.errors.chart.hasData || undefined}>
                {view.errors.totals}
              </p>
              <h3 className={styles.chartTitle}>{ADMIN_COPY.chartTitle}</h3>
              <ErrorChart chart={view.errors.chart} />
            </div>
            {issues ? (
              <>
                <h3 className={styles.subTitle}>{ADMIN_COPY.topIssuesTitle}</h3>
                <TopIssues top={issues} />
              </>
            ) : (
              <>
                <h3 className={styles.subTitle}>{ADMIN_COPY.groupsTitle}</h3>
                <ErrorGroups groups={view.errors.groups} />
              </>
            )}
          </Section>

          <Section id="ai-title" title={ADMIN_COPY.aiTitle} hint={ADMIN_COPY.aiHint}>
            <AiTable table={view.ai} />
          </Section>

          <Section id="users-title" title={ADMIN_COPY.usersTitle} hint={ADMIN_COPY.usersHint}>
            <StatTiles tiles={view.tiles} />
            <p className={styles.funnel}>{view.funnel}</p>
          </Section>

          <Section id="bugs-title" title={ADMIN_COPY.bugsTitle} hint={bugs ? ADMIN_COPY.bugsHint : ADMIN_COPY.bugsFallbackHint}>
            {bugs ? <NewBugs preview={bugs} /> : <BugReports reports={view.bugs} />}
          </Section>
        </div>
      )}
    </div>
  );
}

/**
 * /admin: the owner's view of whether the backend and the AI are up, who is on a board, what
 * broke and what came in. Admins only (AdminFrame: signed out goes to /login, anyone else gets the
 * app's own 404). The issues, bugs and live boards are read once the overview has proved this is
 * an admin; while those routes can't answer, the overview's own errors and bug reports stand in.
 * Nothing here imports tldraw or the board.
 */
export function AdminScreen({ notFound }: { notFound: ReactNode }) {
  const access = useAdminAccess();
  const { data, refresh, check, checkNow } = useAdminOverview(access.canRead ? (access.user?.id ?? "fixtures") : undefined);
  const now = useNow();
  const clock = useMemo(() => ({ now }), [now]);
  const proven = access.canRead && (data.overview !== null || access.hint === true);
  const live = useAdminResource(proven ? boardsUrl({ live: true }) : null, AdminBoardListSchema, { pollMs: 15_000 });
  const issues = useAdminResource(proven ? issuesUrl() : null, AdminIssueListSchema, { pollMs: 60_000 });
  const bugs = useAdminResource(proven ? ADMIN_API.bugs : null, AdminBugListSchema, { pollMs: 60_000 });

  const view = useMemo(() => (data.overview ? buildAdminView(data.overview, clock) : null), [data.overview, clock]);
  const liveView = useMemo(() => (live.data ? liveNowView(live.data.boards, clock) : null), [live.data, clock]);
  const top = useMemo(() => (issues.data ? topIssues(issues.data.issues, clock) : null), [issues.data, clock]);
  const fresh = useMemo(() => (bugs.data ? newBugsPreview(bugs.data.bugs, clock) : null), [bugs.data, clock]);

  return (
    <AdminFrame
      notFound={notFound}
      access={access}
      resource={{ data: data.overview, error: data.error, notFound: data.notFound, signedOut: data.signedOut }}
      page="overview"
      documentTitle={ADMIN_COPY.documentTitle}
    >
      <AdminContent
        view={view}
        loading={data.loading}
        error={data.error}
        check={check}
        onRefresh={() => {
          refresh();
          live.refresh();
          issues.refresh();
          bugs.refresh();
        }}
        onCheckNow={checkNow}
        now={now}
        live={liveView}
        liveError={live.error ?? (live.notFound ? CONSOLE_COPY.loadFallback : null)}
        issues={top}
        bugs={fresh}
      />
    </AdminFrame>
  );
}
