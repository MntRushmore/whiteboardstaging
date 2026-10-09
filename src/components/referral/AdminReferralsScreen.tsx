"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Gift, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { AdminFrame, PageHeader, useAdminAccess } from "@/components/admin/AdminFrame";
import { Section } from "@/components/admin/AdminSections";
import { ChoiceRow, Copyable, Empty, LoadFailed, Pill, SkeletonRows } from "@/components/admin/ConsoleBits";
import { patchAdmin } from "@/components/admin/adminData";
import { useWide } from "@/components/admin/consoleHooks";
import { mutateResources, useAdminResource } from "@/components/admin/useAdminResource";
import { useNow } from "@/components/admin/useNow";
import { CONSOLE_COPY } from "@/lib/admin/consoleView";
import { ADMIN_COPY, formatWhen, relativeTime } from "@/lib/admin/view";
import {
  AdminReferralListSchema,
  AdminReferralSchema,
  REFERRAL_PATHS,
  applyReferralMark,
  buildReferralsView,
  defaultReferralFilter,
  referrerName,
  type AdminReferral,
  type AdminReferralList,
  type ReferralFilter,
  type ReferralMark,
  type ReferralRowView,
  type ReferralsView,
} from "@/lib/referral/admin";
import { REFERRAL_ADMIN_COPY } from "@/lib/referral/copy";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import styles from "@/components/admin/admin.module.css";
import c from "@/components/admin/console.module.css";
import r from "./adminReferrals.module.css";

const COPY = REFERRAL_ADMIN_COPY;

function Tiles({ view }: { view: ReferralsView }) {
  return (
    <ul className={styles.tiles}>
      {view.tiles.map((t) => (
        <li key={t.key} className={styles.tile} data-urgent={t.urgent || undefined}>
          <p className={`${styles.tileValue} ${t.urgent ? r.urgentValue : ""}`}>
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

function Party({ email, payer, children }: { email: string; payer: string | null; children?: ReactNode }) {
  return (
    <span className={r.party}>
      <span className={r.email} title={email}>
        {email}
      </span>
      {payer && <span className={c.cellNote}>{payer}</span>}
      {children}
    </span>
  );
}

function Customer({ id }: { id: string | null }) {
  return id ? <Copyable value={id} label={COPY.customer} /> : <span className={c.cellNote}>{COPY.noCustomer}</span>;
}

function SamePerson() {
  return (
    <span title={COPY.samePersonHint} className={r.flag}>
      <Pill tone="danger" icon={<TriangleAlert size={12} strokeWidth={2.2} />}>
        {COPY.samePerson}
      </Pill>
    </span>
  );
}

function Status({ row }: { row: ReferralRowView }) {
  return (
    <span className={c.planCell}>
      <Pill tone={row.statusTone}>{row.statusLabel}</Pill>
      {row.rewarded && <span className={c.cellNote}>{row.rewarded}</span>}
    </span>
  );
}

function Actions({ row, onMark }: { row: ReferralRowView; onMark: (row: ReferralRowView, mark: ReferralMark) => void }) {
  if (!row.canReward && !row.canVoid) return null;
  return (
    <span className={r.actions}>
      {row.canReward && (
        <Button size="sm" onClick={() => onMark(row, "rewarded")} data-testid={`referral-reward-${row.id}`}>
          {COPY.markRewarded}
        </Button>
      )}
      {row.canVoid && (
        <Button size="sm" variant="ghost" onClick={() => onMark(row, "void")} data-testid={`referral-void-${row.id}`}>
          {COPY.void}
        </Button>
      )}
    </span>
  );
}

function ReferralsTable({ rows, onMark }: { rows: readonly ReferralRowView[]; onMark: (row: ReferralRowView, mark: ReferralMark) => void }) {
  const col = COPY.columns;
  return (
    <div className={c.tableWrap}>
      <table className={c.table}>
        <caption className={styles.srOnly}>{COPY.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{col.referrer}</th>
            <th scope="col">{col.friend}</th>
            <th scope="col">{col.status}</th>
            <th scope="col" data-num>
              {col.joined}
            </th>
            <th scope="col" data-num>
              {col.paid}
            </th>
            <th scope="col">
              <span className={styles.srOnly}>{COPY.markRewarded}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-testid={`referral-row-${row.id}`} data-status={row.status}>
              <th scope="row">
                <Party email={row.referrer.email} payer={row.referrer.payer}>
                  <Customer id={row.referrer.customerId} />
                </Party>
              </th>
              <td>
                <Party email={row.friend.email} payer={row.friend.payer}>
                  {row.samePerson && <SamePerson />}
                </Party>
              </td>
              <td>
                <Status row={row} />
              </td>
              <td data-num title={row.joinedTitle}>
                {row.joined}
              </td>
              <td data-num title={row.paidTitle || undefined}>
                {row.paid}
              </td>
              <td className={r.actionsCell}>
                <Actions row={row} onMark={onMark} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReferralsList({ rows, onMark }: { rows: readonly ReferralRowView[]; onMark: (row: ReferralRowView, mark: ReferralMark) => void }) {
  const col = COPY.columns;
  return (
    <ul className={c.cardList}>
      {rows.map((row) => (
        <li key={row.id} className={r.card} data-testid={`referral-row-${row.id}`} data-status={row.status}>
          <div className={r.cardTop}>
            <Status row={row} />
            <span className={c.cellNote} title={row.joinedTitle}>
              {col.joined} {row.joined}
            </span>
          </div>
          <dl className={r.cardFacts}>
            <div>
              <dt>{col.referrer}</dt>
              <dd>
                <Party email={row.referrer.email} payer={row.referrer.payer}>
                  <Customer id={row.referrer.customerId} />
                </Party>
              </dd>
            </div>
            <div>
              <dt>{col.friend}</dt>
              <dd>
                <Party email={row.friend.email} payer={row.friend.payer}>
                  {row.samePerson && <SamePerson />}
                </Party>
              </dd>
            </div>
            <div>
              <dt>{col.paid}</dt>
              <dd title={row.paidTitle || undefined}>{row.paid}</dd>
            </div>
          </dl>
          <Actions row={row} onMark={onMark} />
        </li>
      ))}
    </ul>
  );
}

export interface ReferralsContentProps {
  view: ReferralsView | null;
  filter: ReferralFilter;
  onFilter: (f: ReferralFilter) => void;
  loading: boolean;
  error: string | null;
  updated: string | null;
  onRefresh: () => void;
  onMark: (row: ReferralRowView, mark: ReferralMark) => void;
  layout: "table" | "list";
}

/**
 * The Referrals page under its header: the counts, the note that the Stripe credit comes first,
 * the filter, then each referral with who invited whom, its status and the buttons it allows.
 * Renders from a finished view (skeletons on the first read, what failed and Try again when it
 * could not be read, a calm empty state before anyone has been invited).
 */
export function ReferralsContent({ view, filter, onFilter, loading, error, updated, onRefresh, onMark, layout }: ReferralsContentProps) {
  let body: ReactNode;
  if (!view && loading) body = <SkeletonRows rows={6} />;
  else if (!view) body = <LoadFailed title={CONSOLE_COPY.loadFailed(COPY.loadWhat)} error={error} onRetry={onRefresh} />;
  else if (view.empty) body = <Empty icon={<Gift size={22} strokeWidth={1.6} />} title={COPY.emptyTitle} hint={COPY.emptyHint} />;
  else
    body = (
      <div className={styles.sections}>
        <Tiles view={view} />
        <Alert tone="warning" title={COPY.rewardNoteTitle}>
          <p>{COPY.rewardNote}</p>
        </Alert>
        <Section id="referrals-list" title={COPY.title} action={view.truncatedNote ? <span className={c.cellNote}>{view.truncatedNote}</span> : undefined}>
          <div className={r.filters}>
            <ChoiceRow label={COPY.filterLabel} options={view.filters} value={filter} onChange={onFilter} />
          </div>
          {view.rows.length === 0 ? (
            <Empty icon={<Gift size={22} strokeWidth={1.6} />} title={COPY.emptyFilterTitle} hint={COPY.emptyFilterHint} />
          ) : layout === "table" ? (
            <ReferralsTable rows={view.rows} onMark={onMark} />
          ) : (
            <ReferralsList rows={view.rows} onMark={onMark} />
          )}
        </Section>
      </div>
    );

  return (
    <div className={styles.inner}>
      <PageHeader title={COPY.title} hint={COPY.hint} updated={view ? updated : null} refreshing={loading} stale={error ? CONSOLE_COPY.staleNote : null} onRefresh={onRefresh} />
      <div className={c.pageBody} data-refreshing={(loading && Boolean(view)) || undefined}>
        {body}
      </div>
    </div>
  );
}

/** The confirm dialog: the credit comes first for a reward; a void is for abuse and final. */
function MarkDialog({
  pending,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  pending: { referral: AdminReferral; mark: ReferralMark } | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const reward = pending?.mark === "rewarded";
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent
        title={reward ? COPY.rewardTitle : COPY.voidTitle}
        description={pending ? (reward ? COPY.rewardBody(referrerName(pending.referral)) : COPY.voidBody) : undefined}
        data-testid="referral-mark-dialog"
      >
        {reward && pending?.referral.referrer.customerId && (
          <p className={r.dialogCustomer}>
            {COPY.customer}: <Copyable value={pending.referral.referrer.customerId} label={COPY.customer} />
          </p>
        )}
        {error && (
          <p className={r.dialogError} role="alert">
            {error}
          </p>
        )}
        <div className={r.dialogActions}>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {COPY.cancel}
          </Button>
          <Button variant={reward ? "primary" : "danger"} onClick={onConfirm} loading={busy} data-testid="referral-mark-confirm">
            {reward ? COPY.rewardConfirm : COPY.voidConfirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Puts one referral, as given, into every loaded copy of the list. */
function showReferral(referral: AdminReferral) {
  mutateResources<AdminReferralList>(
    (url) => url === REFERRAL_PATHS.api,
    (d) => ({ ...d, referrals: d.referrals.map((x) => (x.id === referral.id ? referral : x)) }),
  );
}

/** /admin/referrals: who invited whom, and the free months due. Admins only (see AdminFrame). */
export function AdminReferralsScreen({ notFound }: { notFound: ReactNode }) {
  const access = useAdminAccess();
  const list = useAdminResource(access.canRead ? REFERRAL_PATHS.api : null, AdminReferralListSchema, { pollMs: 120_000 });
  const now = useNow();
  const clock = useMemo(() => ({ now }), [now]);
  const wide = useWide(760);
  const [chosen, setChosen] = useState<ReferralFilter | null>(null);
  const [pending, setPending] = useState<{ referral: AdminReferral; mark: ReferralMark } | null>(null);
  const [busy, setBusy] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  const filter = chosen ?? (list.data ? defaultReferralFilter(list.data.counts) : "all");
  const view = useMemo(() => (list.data ? buildReferralsView(list.data, filter, clock) : null), [list.data, filter, clock]);
  const updated = list.data ? ADMIN_COPY.updated(relativeTime(list.data.generatedAt, now) ?? formatWhen(list.data.generatedAt, clock)) : null;

  function ask(row: ReferralRowView, mark: ReferralMark) {
    const referral = list.data?.referrals.find((x) => x.id === row.id);
    if (!referral) return;
    setMarkError(null);
    setPending({ referral, mark });
  }

  async function confirm() {
    if (!pending || busy) return;
    const { referral, mark } = pending;
    setBusy(true);
    setMarkError(null);
    // at once on the page; the server's own copy (or the old one) follows
    showReferral(applyReferralMark(referral, mark, new Date().toISOString(), access.user?.email ?? null));
    const res = await patchAdmin(REFERRAL_PATHS.one(referral.id), { status: mark });
    setBusy(false);
    if (!res.ok) {
      showReferral(referral);
      setMarkError(COPY.actionFailed(res.error));
      return;
    }
    const parsed = AdminReferralSchema.safeParse(res.body);
    if (parsed.success) showReferral(parsed.data);
    setPending(null);
    toast.success(mark === "rewarded" ? COPY.rewarded : COPY.voided);
  }

  return (
    <AdminFrame notFound={notFound} access={access} resource={list} page="referrals" documentTitle={CONSOLE_COPY.documentTitle(COPY.title)}>
      <ReferralsContent
        view={view}
        filter={filter}
        onFilter={setChosen}
        loading={list.loading}
        error={list.error}
        updated={updated}
        onRefresh={list.refresh}
        onMark={ask}
        layout={wide ? "table" : "list"}
      />
      <MarkDialog pending={pending} busy={busy} error={markError} onCancel={() => setPending(null)} onConfirm={() => void confirm()} />
    </AdminFrame>
  );
}
