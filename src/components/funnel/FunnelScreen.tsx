"use client";

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { UsersRound } from "lucide-react";
import { AdminFrame, PageHeader, useAdminAccess } from "@/components/admin/AdminFrame";
import { Section } from "@/components/admin/AdminSections";
import { Empty, LoadFailed, SkeletonRows } from "@/components/admin/ConsoleBits";
import { useAdminResource } from "@/components/admin/useAdminResource";
import { useNow } from "@/components/admin/useNow";
import { CONSOLE_COPY } from "@/lib/admin/consoleView";
import { ADMIN_COPY, formatWhen, relativeTime } from "@/lib/admin/view";
import { FUNNEL_STAGES } from "@/lib/funnel/contracts";
import { FUNNEL_COPY, STAGE_LABELS, STAGE_SHORT, buildFunnelView, type FunnelBarView, type FunnelTableRowView, type FunnelTile, type FunnelView } from "@/lib/funnel/funnelView";
import { FunnelReportSchema, funnelUrl } from "@/lib/funnel/report";
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

function Bars({ bars }: { bars: readonly FunnelBarView[] }) {
  return (
    <div className={styles.panel}>
      <ol className={f.bars}>
        {bars.map((b) => (
          <li key={b.stage} className={f.bar} aria-label={b.summary}>
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
              {b.ofBefore ? FUNNEL_COPY.ofBefore(b.ofBefore) : " "}
            </p>
          </li>
        ))}
      </ol>
      <p className={f.note}>{FUNNEL_COPY.week2Note}</p>
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
}

/**
 * The Funnel under its header: the money, the stage bars, then the same stages by sign-up week and
 * by source. Renders from a finished view (skeletons on the first read, what failed and Try again
 * when it could not be read, a calm empty state before anyone signs up).
 */
export function FunnelContent({ view, loading, error, updated, onRefresh }: FunnelContentProps) {
  let body: ReactNode;
  if (!view && loading) body = <SkeletonRows rows={8} />;
  else if (!view) body = <LoadFailed title={CONSOLE_COPY.loadFailed(FUNNEL_COPY.loadWhat)} error={error} onRetry={onRefresh} />;
  else if (view.empty)
    body = (
      <>
        <Section id="funnel-money" title={FUNNEL_COPY.moneyTitle}>
          <Tiles tiles={view.tiles} />
        </Section>
        <Empty icon={<UsersRound size={22} strokeWidth={1.6} />} title={FUNNEL_COPY.emptyTitle} hint={FUNNEL_COPY.emptyHint} />
      </>
    );
  else
    body = (
      <div className={styles.sections}>
        <Section id="funnel-money" title={FUNNEL_COPY.moneyTitle}>
          <Tiles tiles={view.tiles} />
        </Section>
        <Section id="funnel-stages" title={FUNNEL_COPY.stagesTitle} hint={FUNNEL_COPY.stagesHint}>
          <Bars bars={view.bars} />
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
      <PageHeader title={FUNNEL_COPY.title} hint={FUNNEL_COPY.hint} updated={view ? updated : null} refreshing={loading} stale={error ? CONSOLE_COPY.staleNote : null} onRefresh={onRefresh} />
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
  const funnel = useAdminResource(access.canRead ? funnelUrl(timeZone) : null, FunnelReportSchema, { pollMs: 300_000 });
  const now = useNow();
  const clock = useMemo(() => ({ now }), [now]);
  const view = useMemo(() => (funnel.data ? buildFunnelView(funnel.data, now) : null), [funnel.data, now]);
  const updated = funnel.data ? ADMIN_COPY.updated(relativeTime(funnel.data.generatedAt, now) ?? formatWhen(funnel.data.generatedAt, clock)) : null;

  return (
    <AdminFrame notFound={notFound} access={access} resource={funnel} page="funnel" documentTitle={CONSOLE_COPY.documentTitle(FUNNEL_COPY.title)}>
      <FunnelContent view={view} loading={funnel.loading} error={funnel.error} updated={updated} onRefresh={funnel.refresh} />
    </AdminFrame>
  );
}
