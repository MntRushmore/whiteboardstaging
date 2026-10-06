"use client";

import type { ReactNode } from "react";
import { CircleCheck, CircleHelp, CircleX, Clock, OctagonAlert, RefreshCw, TriangleAlert } from "lucide-react";
import type { CheckState } from "./useAdminOverview";
import {
  ADMIN_COPY,
  type AiTableView,
  type BugReportView,
  type ErrorGroupView,
  type ServiceCardView,
  type ServiceState,
  type StatTile,
  type StatusSummaryView,
  type SummaryTone,
  type UpcomingDayView,
} from "@/lib/admin/view";
import { Button } from "@/registry/components/button/button";
import styles from "./admin.module.css";

/** A titled block of the page; its heading names the region. */
export function Section({ id, title, hint, action, children }: { id: string; title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitleRow}>
          <h2 id={id} className={styles.sectionTitle}>
            {title}
          </h2>
          {action}
        </div>
        {hint && <p className={styles.sectionHint}>{hint}</p>}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ status

const SUMMARY_ICONS: Record<SummaryTone, ReactNode> = {
  ok: <CircleCheck size={26} strokeWidth={2} />,
  down: <OctagonAlert size={26} strokeWidth={2} />,
  warn: <TriangleAlert size={26} strokeWidth={2} />,
  unknown: <CircleHelp size={26} strokeWidth={2} />,
};

/** The big line: all normal, or what is down and since when. Announced when it changes. */
export function StatusSummary({ summary }: { summary: StatusSummaryView }) {
  return (
    <div className={styles.summary} data-tone={summary.tone} role="status">
      <span className={styles.summaryIcon} aria-hidden>
        {SUMMARY_ICONS[summary.tone]}
      </span>
      <p className={styles.summaryText}>{summary.text}</p>
    </div>
  );
}

const STATE_ICONS: Record<ServiceState, ReactNode> = {
  up: <CircleCheck size={15} strokeWidth={2.2} />,
  down: <CircleX size={15} strokeWidth={2.2} />,
  stale: <Clock size={15} strokeWidth={2.2} />,
  unknown: <CircleHelp size={15} strokeWidth={2.2} />,
};

/** One service: its state in colour, icon and words, then latency, uptime, the last check and its note. */
export function ServiceCard({ card }: { card: ServiceCardView }) {
  const facts = [card.latency, card.uptime, card.lastCheck].filter((f): f is string => Boolean(f));
  return (
    <li className={styles.service} data-state={card.state}>
      <div className={styles.serviceHead}>
        <div className={styles.serviceName}>
          <h3 className={styles.serviceTitle}>{card.name}</h3>
          <p className={styles.serviceRole}>{card.role}</p>
        </div>
        <span className={styles.statePill} data-state={card.state}>
          <span aria-hidden className={styles.statePillIcon}>
            {STATE_ICONS[card.state]}
          </span>
          {card.stateLabel}
        </span>
      </div>
      {card.headline && <p className={styles.serviceHeadline}>{card.headline}</p>}
      {facts.length > 0 && (
        <ul className={styles.facts}>
          {facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {card.detail && (
        <p className={styles.serviceDetail} data-low={card.lowCredit || undefined}>
          {card.lowCredit && <TriangleAlert size={14} strokeWidth={2} aria-hidden className={styles.inlineIcon} />}
          {card.lowCredit && <span className={styles.srOnly}>Low credit: </span>}
          {card.detail}
        </p>
      )}
    </li>
  );
}

export function ServiceGrid({ cards }: { cards: readonly ServiceCardView[] }) {
  return (
    <ul className={styles.services}>
      {cards.map((c) => (
        <ServiceCard key={c.service} card={c} />
      ))}
    </ul>
  );
}

/** "Check now" and what it said. */
export function CheckNow({ check, onCheck }: { check: CheckState; onCheck: () => void }) {
  return (
    <div className={styles.checkRow}>
      <Button variant="secondary" size="sm" onClick={onCheck} loading={check.running} aria-busy={check.running || undefined}>
        {check.running ? ADMIN_COPY.checking : ADMIN_COPY.checkNow}
      </Button>
      <p className={styles.checkNote} role="status">
        {check.running ? "" : check.error ? ADMIN_COPY.checkFailed(check.error) : check.at ? ADMIN_COPY.checkDone : ""}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ errors

const LEVEL_ICONS: Record<string, ReactNode> = {
  error: <CircleX size={14} strokeWidth={2.2} />,
  warn: <TriangleAlert size={14} strokeWidth={2.2} />,
  info: <CircleHelp size={14} strokeWidth={2.2} />,
};

/** One group: what went wrong (in words and as its kind), how often, for whom, and the latest few. */
export function ErrorGroupItem({ group }: { group: ErrorGroupView }) {
  return (
    <li className={styles.group} data-level={group.level}>
      <div className={styles.groupHead}>
        <span className={styles.levelPill} data-level={group.level}>
          <span aria-hidden className={styles.statePillIcon}>
            {LEVEL_ICONS[group.level]}
          </span>
          {group.levelLabel}
        </span>
        <h3 className={styles.groupTitle}>{group.label}</h3>
        <span className={styles.groupCount}>{group.count}</span>
      </div>
      <p className={styles.groupKind}>
        <code>{group.kind}</code>
        {group.code && (
          <>
            {" · "}
            <code>{group.code}</code>
          </>
        )}
        {" · "}
        {group.sourceLabel}
      </p>
      <p className={styles.groupMessage}>{group.message}</p>
      <ul className={styles.groupFacts}>
        <li>{group.users}</li>
        <li>{group.lastSeen}</li>
        <li>{group.firstSeen}</li>
      </ul>
      {group.samples.length > 0 && (
        <details className={styles.samples}>
          <summary>{ADMIN_COPY.samplesToggle(group.samples.length)}</summary>
          <ul className={styles.sampleList}>
            {group.samples.map((s) => (
              <li key={s.key} className={styles.sample}>
                <span className={styles.sampleWhen}>{s.when}</span>
                <span className={styles.sampleWho} data-missing={s.who === ADMIN_COPY.signedOut || undefined}>
                  {s.who}
                </span>
                {/* not a link: a board is readable by its own student only (RLS), an admin included */}
                {s.boardHref && (
                  <span className={styles.mono} title={s.boardHref.slice("/board/".length)}>
                    {ADMIN_COPY.openBoard} {s.boardShort}
                  </span>
                )}
                {s.route && <span className={styles.mono}>{s.route}</span>}
                {s.requestId && (
                  <span className={styles.sampleRequest}>
                    <span className={styles.srOnly}>Request id </span>
                    <code>{s.requestId}</code>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export function ErrorGroups({ groups }: { groups: readonly ErrorGroupView[] }) {
  if (groups.length === 0) {
    return (
      <p className={styles.quiet}>
        <CircleCheck size={16} strokeWidth={2} aria-hidden className={styles.inlineIconOk} />
        {ADMIN_COPY.groupsEmpty}
      </p>
    );
  }
  return (
    <ul className={styles.groups}>
      {groups.map((g) => (
        <ErrorGroupItem key={g.key} group={g} />
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ AI

export function AiTable({ table }: { table: AiTableView }) {
  if (table.empty) {
    return (
      <div className={styles.panel}>
        <p className={styles.quiet}>{ADMIN_COPY.aiEmpty}</p>
      </div>
    );
  }
  const c = ADMIN_COPY.aiColumns;
  return (
    <div className={styles.panel}>
      <div className={styles.tableScroll}>
        <table className={styles.aiTable}>
          <caption className={styles.srOnly}>AI calls, failures and fallbacks per route, the last 24 hours</caption>
          <thead>
            <tr>
              <th scope="col">{c.route}</th>
              <th scope="col">{c.calls}</th>
              <th scope="col">{c.failures}</th>
              <th scope="col">{c.rate}</th>
              <th scope="col">{c.fallbacks}</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.route} data-tone={r.tone}>
                <th scope="row">
                  <span className={styles.routeLabel}>{r.label}</span>
                  <span className={styles.routePath}>{r.route}</span>
                </th>
                <td>{r.calls}</td>
                <td>{r.failures}</td>
                <td>
                  <span className={styles.rate} data-tone={r.tone}>
                    {r.tone !== "ok" && (
                      <span aria-hidden className={styles.rateIcon}>
                        {r.tone === "bad" ? <CircleX size={13} strokeWidth={2.2} /> : <TriangleAlert size={13} strokeWidth={2.2} />}
                      </span>
                    )}
                    {r.rate}
                    {r.toneLabel && <span className={styles.srOnly}> ({r.toneLabel})</span>}
                  </span>
                </td>
                <td>{r.fallbacks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.idle && <p className={styles.tableNote}>{table.idle}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ users and learning

export function StatTiles({ tiles, columns = 4 }: { tiles: readonly StatTile[]; columns?: 3 | 4 }) {
  return (
    <ul className={styles.tiles} data-columns={columns}>
      {tiles.map((t) => (
        <li key={t.key} className={styles.tile}>
          <p className={styles.tileValue}>
            {t.value}
            <span className={styles.srOnly}> {t.label}</span>
          </p>
          <p className={styles.tileLabel} aria-hidden>
            {t.label}
          </p>
          <p className={styles.tileHint}>{t.hint}</p>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ money

/** The next 14 days' charges, a row per day: when, what, how much. */
export function UpcomingCharges({ days }: { days: readonly UpcomingDayView[] }) {
  return (
    <div className={styles.panel}>
      <h3 className={styles.chartTitle}>{ADMIN_COPY.upcomingTitle}</h3>
      {days.length === 0 ? (
        <p className={styles.quiet}>{ADMIN_COPY.upcomingEmpty}</p>
      ) : (
        <ul className={styles.upcoming}>
          {days.map((d) => (
            <li key={d.key}>
              <span className={styles.upcomingDay}>{d.day}</span>
              <span className={styles.upcomingWhat}>{d.what}</span>
              <span className={styles.upcomingAmount}>{d.amount}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ bug reports

export function BugReports({ reports }: { reports: readonly BugReportView[] }) {
  if (reports.length === 0) {
    return (
      <div className={styles.panel}>
        <p className={styles.quiet}>{ADMIN_COPY.bugsEmpty}</p>
      </div>
    );
  }
  return (
    <ul className={styles.bugs}>
      {reports.map((r) => (
        <li key={r.key} className={styles.bug}>
          <div className={styles.bugHead}>
            <span className={styles.bugWho} data-missing={r.email === ADMIN_COPY.noEmail || undefined}>
              {r.email}
            </span>
            <span className={styles.bugWhen}>
              {r.when}
              {r.ago ? ` · ${r.ago}` : ""}
            </span>
          </div>
          <p className={styles.bugMessage} data-missing={r.message === ADMIN_COPY.noMessage || undefined}>
            {r.message}
          </p>
          {r.path && <p className={styles.mono}>{r.path}</p>}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ loading

export function AdminSkeleton() {
  return (
    <div className={styles.stack} aria-hidden>
      <div className={`${styles.pulse} ${styles.skeletonSummary}`} />
      <div className={styles.skeletonGrid}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${styles.pulse} ${styles.skeletonCard}`} />
        ))}
      </div>
      <div className={`${styles.pulse} ${styles.skeletonBlock}`} />
    </div>
  );
}

/** The refresh button and when the overview was read. */
export function RefreshBar({ updated, refreshing, stale, onRefresh }: { updated: string | null; refreshing: boolean; stale: string | null; onRefresh: () => void }) {
  return (
    <div className={styles.refreshBar}>
      <p className={styles.updated} aria-live="polite">
        {refreshing ? ADMIN_COPY.refreshing : updated}
        {stale && !refreshing && <span className={styles.staleNote}> · {stale}</span>}
      </p>
      <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing} aria-label={ADMIN_COPY.refresh}>
        <RefreshCw size={15} strokeWidth={1.9} aria-hidden className={refreshing ? styles.spin : undefined} />
        <span className={styles.refreshWord}>{ADMIN_COPY.refresh}</span>
      </Button>
    </div>
  );
}
