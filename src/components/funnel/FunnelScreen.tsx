"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { UsersRound } from "lucide-react";
import { AdminFrame, PageHeader, useAdminAccess } from "@/components/admin/AdminFrame";
import { Section } from "@/components/admin/AdminSections";
import { Empty, LoadFailed, SkeletonRows } from "@/components/admin/ConsoleBits";
import { useAdminResource } from "@/components/admin/useAdminResource";
import { useNow } from "@/components/admin/useNow";
import { CONSOLE_COPY } from "@/lib/admin/consoleView";
import { ADMIN_COPY, formatWhen, relativeTime } from "@/lib/admin/view";
import { DEFAULT_FUNNEL_COHORT, FUNNEL_STAGES, isFunnelCohort, type FunnelCohort } from "@/lib/funnel/contracts";
import {
  FUNNEL_COPY,
  STAGE_LABELS,
  STAGE_SHORT,
  buildFunnelView,
  cohortOptions,
  type FunnelBarView,
  type FunnelPathCellView,
  type FunnelPathRowView,
  type FunnelTableRowView,
  type FunnelTile,
  type FunnelView,
  type StartView,
} from "@/lib/funnel/funnelView";
import { FunnelReportSchema, funnelUrl } from "@/lib/funnel/report";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import styles from "@/components/admin/admin.module.css";
import c from "@/components/admin/console.module.css";
import f from "./funnel.module.css";

function Tiles({ tiles }: { tiles: readonly FunnelTile[] }) {
  return (
    <ul className={styles.tiles}>
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

/** A bar of either chain: the account's stages (FunnelBarView) or the steps before the account (StartBarView). */
type BarView = Pick<FunnelBarView, "label" | "count" | "ratio" | "ofText" | "summary"> & { stage: string; branch?: boolean };

function Bars({ bars, notes }: { bars: readonly BarView[]; notes: readonly string[] }) {
  return (
    <div className={styles.panel}>
      <ol className={f.bars}>
        {bars.map((b) => (
          <li key={b.stage} className={f.bar} data-branch={b.branch || undefined} aria-label={b.summary}>
            <span className={f.barLabel} aria-hidden>
              {b.label}
            </span>
            <span className={f.track} aria-hidden>
              <span className={f.fill} data-stage={b.stage} data-zero={b.ratio === 0 || undefined} style={{ display: "block", width: `${(b.ratio * 100).toFixed(1)}%` }} />
            </span>
            <span className={f.barCount} aria-hidden>
              {b.count}
            </span>
            <p className={f.barShare} aria-hidden>
              {b.ofText ?? " "}
            </p>
          </li>
        ))}
      </ol>
      {notes.map((note) => (
        <p key={note} className={f.note}>
          {note}
        </p>
      ))}
    </div>
  );
}

/** The visits to /start before the account: the bars, or why there are none. */
function StartBars({ start }: { start: StartView }) {
  if (start.missing) return <p className={f.empty}>{FUNNEL_COPY.startMissing}</p>;
  if (start.empty) return <p className={f.empty}>{FUNNEL_COPY.startEmpty}</p>;
  return <Bars bars={start.bars} notes={start.notes} />;
}

function PathCell({ cell }: { cell: FunnelPathCellView }) {
  return (
    <td data-num>
      <span className={f.cell} data-zero={cell.zero || undefined}>
        <span className={f.cellCount}>{cell.count}</span>
        {cell.pct && <span className={c.cellNote}>{cell.pct}</span>}
      </span>
    </td>
  );
}

/** How the cohort's tracked accounts left the welcome and the guided board, and how many went on. */
function PathTable({ rows }: { rows: readonly FunnelPathRowView[] }) {
  if (rows.length === 0) return <p className={f.empty}>{FUNNEL_COPY.pathsEmpty}</p>;
  const cols = FUNNEL_COPY.pathColumns;
  return (
    <div className={c.tableWrap}>
      <table className={`${c.table} ${f.stickyFirst}`}>
        <caption className={styles.srOnly}>{FUNNEL_COPY.pathsCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{FUNNEL_COPY.pathColumn}</th>
            <th scope="col" data-num>
              {cols.accounts}
            </th>
            <th scope="col" data-num>
              {cols.planShown}
            </th>
            <th scope="col" data-num>
              {cols.checkoutOpened}
            </th>
            <th scope="col" data-num>
              {cols.trialStarted}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.path}>
              <th scope="row">
                <span className={f.rowName}>{r.label}</span>
              </th>
              <td data-num>
                <span className={f.cellCount}>{r.accounts}</span>
              </td>
              <PathCell cell={r.planShown} />
              <PathCell cell={r.checkoutOpened} />
              <PathCell cell={r.trialStarted} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FunnelTable({ rows, caption, firstColumn }: { rows: readonly FunnelTableRowView[]; caption: string; firstColumn: string }) {
  return (
    <div className={c.tableWrap}>
      <table className={`${c.table} ${f.stickyFirst}`}>
        <caption className={styles.srOnly}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{firstColumn}</th>
            {FUNNEL_STAGES.map((s) => (
              <th key={s} scope="col" data-num title={STAGE_LABELS[s]}>
                {STAGE_SHORT[s]}
              </th>
            ))}
            <th scope="col" data-num>
              {FUNNEL_COPY.canceledColumn}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                <span className={f.rowName}>{r.label}</span>
                {r.note && <span className={c.cellNote}>{r.note}</span>}
              </th>
              {r.cells.map((cell) => (
                <td key={cell.stage} data-num>
                  <span className={`${f.cell} ${cell.stage === "paid" ? f.paidCell : ""}`} data-zero={cell.zero || undefined}>
                    <span className={f.cellCount}>{cell.count}</span>
                    {cell.pct && <span className={c.cellNote}>{cell.pct}</span>}
                  </span>
                </td>
              ))}
              <td data-num>{r.canceled}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface FunnelContentProps {
  view: FunnelView | null;
  loading: boolean;
  error: string | null;
  /** "Updated 2 min ago"; null before the first answer */
  updated: string | null;
  onRefresh: () => void;
  /** the sign-ups counted, and its switch */
  cohort: FunnelCohort;
  onCohort: (cohort: FunnelCohort) => void;
}

const COHORT_OPTIONS = cohortOptions();

/**
 * The Funnel under its header: which sign-ups it counts, the money, the steps at /start before the
 * account, the stage bars, how sign-ups left the welcome and the guided board, then the same stages
 * by sign-up week and by source. Renders from a finished view (skeletons on the first read, what
 * failed and Try again when it could not be read, a calm empty state before anyone signs up or in a
 * range nobody signed up in, with the steps before the account above it when there are some).
 */
export function FunnelContent({ view, loading, error, updated, onRefresh, cohort, onCohort }: FunnelContentProps) {
  let body: ReactNode;
  if (!view && loading) body = <SkeletonRows rows={8} />;
  else if (!view) body = <LoadFailed title={CONSOLE_COPY.loadFailed(FUNNEL_COPY.loadWhat)} error={error} onRetry={onRefresh} />;
  else if (view.empty || view.emptyCohort)
    body = (
      <>
        <Section id="funnel-money" title={FUNNEL_COPY.moneyTitle} hint={FUNNEL_COPY.moneyHint}>
          <Tiles tiles={view.tiles} />
        </Section>
        {!view.start.empty && (
          <Section id="funnel-start" title={FUNNEL_COPY.startTitle} hint={view.start.hint}>
            <StartBars start={view.start} />
          </Section>
        )}
        <Empty
          icon={<UsersRound size={22} strokeWidth={1.6} />}
          title={view.empty ? FUNNEL_COPY.emptyTitle : FUNNEL_COPY.emptyCohortTitle}
          hint={view.empty ? FUNNEL_COPY.emptyHint : FUNNEL_COPY.emptyCohortHint}
        />
      </>
    );
  else
    body = (
      <div className={styles.sections}>
        <Section id="funnel-money" title={FUNNEL_COPY.moneyTitle} hint={FUNNEL_COPY.moneyHint}>
          <Tiles tiles={view.tiles} />
        </Section>
        <Section id="funnel-start" title={FUNNEL_COPY.startTitle} hint={view.start.hint}>
          <StartBars start={view.start} />
        </Section>
        <Section id="funnel-stages" title={FUNNEL_COPY.stagesTitle} hint={FUNNEL_COPY.stagesHint}>
          <Bars bars={view.bars} notes={view.notes} />
        </Section>
        <Section id="funnel-paths" title={FUNNEL_COPY.pathsTitle} hint={view.pathsHint}>
          <PathTable rows={view.paths} />
        </Section>
        <Section id="funnel-weeks" title={FUNNEL_COPY.weeksTitle} hint={view.weeksHint}>
          <FunnelTable rows={view.weeks} caption={FUNNEL_COPY.weeksCaption} firstColumn={FUNNEL_COPY.weekColumn} />
        </Section>
        <Section id="funnel-sources" title={FUNNEL_COPY.sourcesTitle} hint={FUNNEL_COPY.sourcesHint}>
          <FunnelTable rows={view.sources} caption={FUNNEL_COPY.sourcesCaption} firstColumn={FUNNEL_COPY.sourceColumn} />
        </Section>
      </div>
    );

  return (
    <div className={styles.inner}>
      <PageHeader title={FUNNEL_COPY.title} hint={FUNNEL_COPY.hint} updated={view ? updated : null} refreshing={loading} stale={error ? CONSOLE_COPY.staleNote : null} onRefresh={onRefresh}>
        <div className={f.cohort}>
          <SegmentedControl options={COHORT_OPTIONS} value={cohort} onValueChange={(v) => isFunnelCohort(v) && onCohort(v)} label={FUNNEL_COPY.cohortLabel} />
          {view && <p className={f.cohortHint}>{view.cohortHint}</p>}
        </div>
      </PageHeader>
      <div className={c.pageBody} data-refreshing={(loading && Boolean(view)) || undefined}>
        {body}
      </div>
    </div>
  );
}

const noSubscribe = () => () => {};

/** The viewer's own zone (the weeks and "another day" are read in it); null on the server. */
function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** /admin/funnel: where sign-ups come from and how far they get. Admins only (see AdminFrame). */
export function FunnelScreen({ notFound }: { notFound: ReactNode }) {
  const access = useAdminAccess();
  const timeZone = useSyncExternalStore(noSubscribe, browserTimeZone, () => null);
  const [cohort, setCohort] = useState<FunnelCohort>(DEFAULT_FUNNEL_COHORT);
  const funnel = useAdminResource(access.canRead ? funnelUrl(timeZone, cohort) : null, FunnelReportSchema, { pollMs: 300_000 });
  const now = useNow();
  const clock = useMemo(() => ({ now }), [now]);
  const view = useMemo(() => (funnel.data ? buildFunnelView(funnel.data, now) : null), [funnel.data, now]);
  const updated = funnel.data ? ADMIN_COPY.updated(relativeTime(funnel.data.generatedAt, now) ?? formatWhen(funnel.data.generatedAt, clock)) : null;

  return (
    <AdminFrame notFound={notFound} access={access} resource={funnel} page="funnel" documentTitle={CONSOLE_COPY.documentTitle(FUNNEL_COPY.title)}>
      <FunnelContent view={view} loading={funnel.loading} error={funnel.error} updated={updated} onRefresh={funnel.refresh} cohort={cohort} onCohort={setCohort} />
    </AdminFrame>
  );
}
