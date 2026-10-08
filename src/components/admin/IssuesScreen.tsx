"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BellOff, CircleCheck, CircleX, Info, NotebookPen, RotateCcw, TriangleAlert } from "lucide-react";
import { AdminIssueListSchema, type AdminIssue, type IssueStatus } from "@/lib/admin/contracts";
import { CONSOLE_COPY } from "@/lib/admin/consoleView";
import {
  DEFAULT_ISSUE_WINDOW,
  ISSUES_COPY,
  ISSUE_ACTION_LABELS,
  ISSUE_TAB_LABELS,
  ISSUE_WINDOWS,
  issueActions,
  issueTabs,
  issueView,
  issuesInTab,
  issuesUrl,
  noiseCount,
  type IssueTab,
  type IssueView,
  type IssueWindow,
  type SampleView,
} from "@/lib/admin/issuesView";
import { ADMIN_COPY, formatWhen, relativeTime, type ViewClock } from "@/lib/admin/view";
import { Button } from "@/registry/components/button/button";
import { AdminFrame, PageHeader, useAdminAccess } from "./AdminFrame";
import { ChoiceRow, Copyable, Empty, LoadFailed, Pill, SkeletonRows, Sparkline } from "./ConsoleBits";
import { updateIssue } from "./adminActions";
import { useAdminResource } from "./useAdminResource";
import { useNow } from "./useNow";
import styles from "./admin.module.css";
import c from "./console.module.css";

const LEVEL_ICONS: Record<IssueView["level"], ReactNode> = {
  error: <CircleX size={14} strokeWidth={2.2} />,
  warn: <TriangleAlert size={14} strokeWidth={2.2} />,
  info: <Info size={14} strokeWidth={2.2} />,
};

const ACTION_ICONS: Record<IssueStatus, ReactNode> = {
  fixed: <CircleCheck size={15} strokeWidth={1.9} aria-hidden />,
  muted: <BellOff size={15} strokeWidth={1.9} aria-hidden />,
  open: <RotateCcw size={15} strokeWidth={1.9} aria-hidden />,
};

/** One sample event: when, who (their page), the board (the viewer), the release, the request id to copy, and the details. */
function Sample({ s }: { s: SampleView }) {
  return (
    <li className={c.sample}>
      <div className={c.sampleHead}>
        <span className={c.sampleWhen} title={s.whenTitle}>
          {s.when}
        </span>
        {s.userHref ? (
          <Link href={s.userHref} className={c.inlineLink}>
            {s.who}
          </Link>
        ) : (
          <span data-missing className={c.sampleWho}>
            {s.who}
          </span>
        )}
        {s.boardHref && (
          <Link href={s.boardHref} className={c.inlineLink} title={s.boardShort ?? undefined}>
            {ISSUES_COPY.board} {s.boardShort}
          </Link>
        )}
        {s.route && <code className={c.code}>{s.route}</code>}
        {s.release && (
          <span className={c.sampleFact}>
            {ISSUES_COPY.release} <code>{s.release}</code>
          </span>
        )}
        {s.requestId && (
          <span className={c.sampleFact}>
            {ISSUES_COPY.request} <Copyable value={s.requestId} label="request id" />
          </span>
        )}
      </div>
      {s.message && <p className={c.sampleMessage}>{s.message}</p>}
      {s.facts.length > 0 && (
        <ul className={c.metaFacts}>
          {s.facts.map((f) => (
            <li key={f.label}>
              <span>{f.label}</span> {f.value}
            </li>
          ))}
        </ul>
      )}
      {s.meta && (
        <details className={c.metaDetails}>
          <summary>{ISSUES_COPY.meta}</summary>
          <pre className={c.pre}>{s.meta}</pre>
        </details>
      )}
    </li>
  );
}

/** One issue: what broke in words, its kind, how often and for whom, each day, and what to do with it. */
export function IssueCard({ issue, onAction }: { issue: IssueView; onAction: (status: IssueStatus, note?: string) => void }) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const act = (status: IssueStatus) => onAction(status, noting && note.trim() ? note.trim() : undefined);
  return (
    <li className={c.issue} data-level={issue.level} data-regressed={issue.regressed || undefined} data-noise={issue.noise || undefined}>
      <div className={c.issueMain}>
        <div className={c.issueHead}>
          <span className={styles.levelPill} data-level={issue.level}>
            <span aria-hidden className={styles.statePillIcon}>
              {LEVEL_ICONS[issue.level]}
            </span>
            {issue.levelLabel}
          </span>
          <h3 className={c.issueTitle}>{issue.label}</h3>
          {issue.regressed && (
            <Pill tone="danger" title={issue.regressedNote ?? undefined}>
              {ISSUES_COPY.regressed}
            </Pill>
          )}
          {issue.noise && <Pill tone="muted">{ISSUES_COPY.noiseBadge}</Pill>}
        </div>
        <p className={c.issueKind}>
          <code>{issue.kind}</code>
          {issue.code && <code>{issue.code}</code>}
          <span>{issue.sourceLabel}</span>
        </p>
        <p className={c.issueMessage}>{issue.message}</p>
        {issue.regressedNote && <p className={c.issueNote}>{issue.regressedNote}</p>}
        {issue.note && <p className={c.issueNote}>“{issue.note}”</p>}
        <ul className={styles.groupFacts}>
          <li>{issue.users}</li>
          <li>{issue.boards}</li>
          <li title={issue.lastTitle}>{issue.lastSeen}</li>
          <li>{issue.firstSeen}</li>
        </ul>
      </div>
      <div className={c.issueSide}>
        <span className={c.issueCount}>{issue.count}</span>
        <Sparkline spark={issue.spark} label={ISSUES_COPY.perDay} />
      </div>
      <div className={c.issueFoot}>
        <div className={c.issueActions}>
          {issueActions(issue.tab, issue.regressed).map((status) => (
            <Button key={status} variant={issue.regressed && status === "fixed" ? "primary" : "secondary"} size="sm" onClick={() => act(status)}>
              {ACTION_ICONS[status]}
              {ISSUE_ACTION_LABELS[status]}
            </Button>
          ))}
          <Button variant="ghost" size="sm" aria-expanded={noting} onClick={() => setNoting((n) => !n)}>
            <NotebookPen size={15} strokeWidth={1.9} aria-hidden />
            {ISSUES_COPY.noteLabel}
          </Button>
        </div>
        {noting && (
          <input
            className={c.noteInput}
            aria-label={ISSUES_COPY.noteLabel}
            placeholder={ISSUES_COPY.notePlaceholder}
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
        )}
        {issue.samples.length > 0 && (
          <details className={styles.samples}>
            <summary>{ISSUES_COPY.samplesToggle(issue.samples.length)}</summary>
            <ul className={c.samples}>
              {issue.samples.map((s) => (
                <Sample key={s.key} s={s} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

export interface IssuesContentProps {
  issues: AdminIssue[] | null;
  clock: ViewClock;
  days: IssueWindow;
  onDays: (d: IssueWindow) => void;
  tab: IssueTab;
  onTab: (t: IssueTab) => void;
  showNoise: boolean;
  onShowNoise: (on: boolean) => void;
  onAction: (issue: AdminIssue, status: IssueStatus, note?: string) => void;
  loading: boolean;
  error: string | null;
  updated: string | null;
  onRefresh: () => void;
}

/** The issues page under its header: the window, the tabs, the noise toggle, then each issue. */
export function IssuesContent({ issues, clock, days, onDays, tab, onTab, showNoise, onShowNoise, onAction, loading, error, updated, onRefresh }: IssuesContentProps) {
  const list = useMemo(() => (issues ? issuesInTab(issues, tab, showNoise) : []), [issues, tab, showNoise]);
  const views = useMemo(() => list.map((i) => issueView(i, clock)), [list, clock]);
  const tabs = issues ? issueTabs(issues, showNoise) : [];
  const noise = issues ? noiseCount(issues, tab) : 0;

  let body: ReactNode;
  if (!issues && loading) body = <SkeletonRows rows={5} height="8rem" />;
  else if (!issues) body = <LoadFailed title={CONSOLE_COPY.loadFailed(ISSUES_COPY.loadWhat)} error={error} onRetry={onRefresh} />;
  else
    body = (
      <>
        {views.length === 0 ? (
          <Empty icon={<CircleCheck size={22} strokeWidth={1.6} />} title={ISSUES_COPY.emptyTitle(tab)} hint={ISSUES_COPY.emptyHint(tab, ISSUES_COPY.windows[days])} />
        ) : (
          <ul className={c.issues} aria-label={ISSUES_COPY.listLabel(ISSUE_TAB_LABELS[tab])}>
            {views.map((v, i) => (
              <IssueCard key={v.fingerprint} issue={v} onAction={(status, note) => onAction(list[i], status, note)} />
            ))}
          </ul>
        )}
        {noise > 0 && (
          <div className={c.noiseRow}>
            <Button variant="ghost" size="sm" aria-pressed={showNoise} onClick={() => onShowNoise(!showNoise)}>
              {showNoise ? ISSUES_COPY.hideNoise : ISSUES_COPY.noise(noise)}
            </Button>
            <p className={c.blockHint}>{ISSUES_COPY.noiseHint}</p>
          </div>
        )}
      </>
    );

  return (
    <div className={styles.inner}>
      <PageHeader title={ISSUES_COPY.title} hint={ISSUES_COPY.hint} updated={issues ? updated : null} refreshing={loading} stale={error ? CONSOLE_COPY.staleNote : null} onRefresh={onRefresh} />
      <div className={c.inboxBar}>
        <ChoiceRow
          label={ISSUES_COPY.tabsLabel}
          options={tabs.map((t) => ({ key: t.tab, label: t.label, count: String(t.count), urgent: t.tab === "open" && issues ? issues.some((i) => i.regressed && !i.noise && i.status !== "muted") : false }))}
          value={tab}
          onChange={onTab}
        />
        <ChoiceRow label={ISSUES_COPY.windowLabel} options={ISSUE_WINDOWS.map((d) => ({ key: String(d) as `${IssueWindow}`, label: ISSUES_COPY.windows[d] }))} value={String(days) as `${IssueWindow}`} onChange={(d) => onDays(Number(d) as IssueWindow)} />
      </div>
      <div className={c.pageBody} data-refreshing={(loading && Boolean(issues)) || undefined}>
        {body}
      </div>
    </div>
  );
}

/** /admin/issues: what broke, to triage. Admins only (see AdminFrame). */
export function IssuesScreen({ notFound }: { notFound: ReactNode }) {
  const access = useAdminAccess();
  const [days, setDays] = useState<IssueWindow>(DEFAULT_ISSUE_WINDOW);
  const [tab, setTab] = useState<IssueTab>("open");
  const [showNoise, setShowNoise] = useState(false);
  const res = useAdminResource(access.canRead ? issuesUrl(days) : null, AdminIssueListSchema, { pollMs: 60_000 });
  const now = useNow();
  const clock = useMemo(() => ({ now }), [now]);
  const updated = res.data ? ADMIN_COPY.updated(relativeTime(res.data.generatedAt, now) ?? formatWhen(res.data.generatedAt, clock)) : null;

  const onAction = useCallback(
    (issue: AdminIssue, status: IssueStatus, note?: string) => {
      void updateIssue(issue, status, note).then((r) => {
        if (!r.ok) toast.error(CONSOLE_COPY.saveFailed(r.error));
        else
          toast(ISSUES_COPY.marked(status), {
            description: issueView(issue, clock).label,
            action: { label: CONSOLE_COPY.undo, onClick: () => void updateIssue({ ...issue, status }, issue.status) },
          });
      });
    },
    [clock],
  );

  return (
    <AdminFrame notFound={notFound} access={access} resource={res} page="issues" documentTitle={CONSOLE_COPY.documentTitle(ISSUES_COPY.title)}>
      <IssuesContent
        issues={res.data?.issues ?? null}
        clock={clock}
        days={days}
        onDays={setDays}
        tab={tab}
        onTab={setTab}
        showNoise={showNoise}
        onShowNoise={setShowNoise}
        onAction={onAction}
        loading={res.loading}
        error={res.error}
        updated={updated}
        onRefresh={res.refresh}
      />
    </AdminFrame>
  );
}
