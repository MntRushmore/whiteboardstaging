"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleCheck, CircleX, Info, Mail, TriangleAlert, UserX } from "lucide-react";
import { ADMIN_API, ADMIN_PAGES, AdminUserDetailSchema } from "@/lib/admin/contracts";
import { bugHref } from "@/lib/admin/bugsView";
import { CONSOLE_COPY } from "@/lib/admin/consoleView";
import { USER_COPY, buildUserPageView, type ActivityView, type EventView, type UserPageView } from "@/lib/admin/userView";
import { ADMIN_COPY, formatWhen, relativeTime } from "@/lib/admin/view";
import { Section } from "./AdminSections";
import { AdminFrame, PageHeader, useAdminAccess } from "./AdminFrame";
import { BoardGrid } from "./BoardTiles";
import { AdminMark, Avatar, Copyable, Empty, Facts, LoadFailed, Pill, SkeletonRows } from "./ConsoleBits";
import { useAdminResource } from "./useAdminResource";
import { useNow } from "./useNow";
import styles from "./admin.module.css";
import c from "./console.module.css";

/** 30 days as stacked columns: problems at the base, AI calls above. Each day's numbers on hover and in the label. */
function ActivityBars({ activity }: { activity: ActivityView }) {
  return (
    <div className={c.activity}>
      <ul className={styles.legend} aria-label="Legend">
        <li>
          <span aria-hidden className={c.swatch} data-series="attempts" />
          {USER_COPY.activityLegend.attempts}
        </li>
        <li>
          <span aria-hidden className={c.swatch} data-series="ai" />
          {USER_COPY.activityLegend.aiCalls}
        </li>
      </ul>
      <div className={c.activityPlot} role="img" aria-label={activity.summary}>
        {activity.bars.map((b) => (
          <span key={b.day} className={c.activitySlot} data-today={b.isToday || undefined} title={b.label}>
            <span className={c.activityColumn}>
              {b.aiCalls > 0 && <span className={c.activitySeg} data-series="ai" style={{ height: `${(b.aiRatio * 100).toFixed(2)}%` }} />}
              {b.attempts > 0 && <span className={c.activitySeg} data-series="attempts" style={{ height: `${(b.attemptsRatio * 100).toFixed(2)}%` }} />}
            </span>
          </span>
        ))}
      </div>
      <ul className={c.activityAxis} aria-hidden>
        {activity.bars.map((b, i) =>
          b.axisLabel ? (
            <li key={b.day} data-today={b.isToday || undefined} style={b.isToday ? undefined : { left: `${((i + 0.5) / activity.bars.length) * 100}%` }}>
              {b.axisLabel}
            </li>
          ) : null,
        )}
      </ul>
      <p className={styles.chartSummary}>{activity.summary}</p>
    </div>
  );
}

const LEVEL_ICON: Record<EventView["level"], ReactNode> = {
  error: <CircleX size={14} strokeWidth={2.2} />,
  warn: <TriangleAlert size={14} strokeWidth={2.2} />,
  info: <Info size={14} strokeWidth={2.2} />,
};

/** One event in the timeline: when, what in words, its kind, and where to look. */
function EventItem({ e }: { e: EventView }) {
  return (
    <li className={c.event} data-level={e.level} data-noise={e.noise || undefined}>
      <span className={c.eventIcon} aria-hidden>
        {LEVEL_ICON[e.level]}
      </span>
      <div className={c.eventBody}>
        <p className={c.eventHead}>
          <span className={c.eventLabel}>{e.label}</span>
          <span className={styles.srOnly}>({e.levelLabel})</span>
          <span className={c.eventWhen} title={e.whenTitle}>
            {e.ago}
          </span>
        </p>
        <p className={c.eventMessage}>{e.message}</p>
        <p className={c.eventMeta}>
          <code>{e.kind}</code>
          {e.code && <code>{e.code}</code>}
          {e.route && <code>{e.route}</code>}
          {e.facts.map((f) => (
            <span key={f.label}>
              {f.label} {f.value}
            </span>
          ))}
          {e.boardHref && (
            <Link href={e.boardHref} className={c.inlineLink}>
              {USER_COPY.board} {e.boardShort}
            </Link>
          )}
          {e.requestId && <Copyable value={e.requestId} label="request id" />}
        </p>
      </div>
    </li>
  );
}

/**
 * One account's page under its header: activity, boards, learning and what went wrong in the
 * main column; subscription, bug reports and emails beside it (below, on a phone). From a
 * finished view, so it renders from fixtures too.
 */
export function UserContent({ view, loading, error, updated, onRefresh }: { view: UserPageView | null; loading: boolean; error: string | null; updated: string | null; onRefresh: () => void }) {
  const back = { href: ADMIN_PAGES.users, label: USER_COPY.back };
  if (!view) {
    return (
      <div className={styles.inner}>
        <PageHeader title={loading ? USER_COPY.loadingTitle : CONSOLE_COPY.loadFailed(USER_COPY.loadWhat)} back={back} />
        {loading ? <SkeletonRows rows={5} height="7rem" /> : <LoadFailed title={CONSOLE_COPY.loadFailed(USER_COPY.loadWhat)} error={error} onRetry={onRefresh} />}
      </div>
    );
  }
  const h = view.header;
  return (
    <div className={styles.inner}>
      <PageHeader title={h.title} back={back} updated={updated} refreshing={loading} stale={error ? CONSOLE_COPY.staleNote : null} onRefresh={onRefresh}>
        <div className={c.profile}>
          <Avatar initials={h.initials} tone={h.tone} size="lg" />
          <div className={c.profileText}>
            <p className={c.profileLine}>
              <Copyable value={h.email} label="email" />
            </p>
            <p className={c.profileLine}>
              <Pill tone={h.planTone}>{h.planLabel}</Pill>
              {h.planNote && <span className={c.profileNote}>{h.planNote}</span>}
              {h.course && <span className={c.profileNote}>{h.course}</span>}
              {h.isAdmin && <AdminMark />}
            </p>
          </div>
        </div>
        <Facts facts={h.facts} />
      </PageHeader>

      <div className={c.userLayout} data-refreshing={loading || undefined}>
        <div className={c.userMain}>
          <Section id="activity-title" title={USER_COPY.activityTitle} hint={USER_COPY.activityHint}>
            <div className={styles.panel}>
              <ActivityBars activity={view.activity} />
            </div>
          </Section>

          <Section id="boards-title" title={`${USER_COPY.boardsTitle} (${view.boards.length})`} hint={USER_COPY.boardsHint}>
            {view.boards.length === 0 ? (
              <div className={styles.panel}>
                <p className={styles.quiet}>{USER_COPY.boardsEmpty}</p>
              </div>
            ) : (
              <BoardGrid tiles={view.boards} showOwner={false} label={USER_COPY.boardsTitle} />
            )}
          </Section>

          <Section id="learning-title" title={USER_COPY.learningTitle} hint={USER_COPY.learningHint}>
            {view.learning.empty ? (
              <div className={styles.panel}>
                <p className={styles.quiet}>{USER_COPY.learningEmpty}</p>
              </div>
            ) : (
              <>
                <ul className={styles.tiles}>
                  {view.learning.tiles.map((t) => (
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
                {view.learning.skills.length > 0 && (
                  <div className={styles.panel}>
                    <h3 className={styles.chartTitle}>{USER_COPY.skillsTitle}</h3>
                    <table className={c.skills}>
                      <caption className={styles.srOnly}>{USER_COPY.skillsTitle}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{USER_COPY.skillsColumns.skill}</th>
                          <th scope="col" data-num>
                            {USER_COPY.skillsColumns.attempts}
                          </th>
                          <th scope="col" data-num>
                            {USER_COPY.skillsColumns.alone}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.learning.skills.map((s) => (
                          <tr key={s.skill}>
                            <th scope="row">{s.skill}</th>
                            <td data-num>{s.attempts}</td>
                            <td data-num>
                              <span className={c.meter}>
                                <span className={c.meterBar} aria-hidden>
                                  <span style={{ width: `${(s.alonePct * 100).toFixed(0)}%` }} />
                                </span>
                                {s.alone}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {view.learning.recent.length > 0 && (
                  <div className={styles.panel}>
                    <h3 className={styles.chartTitle}>{USER_COPY.recentTitle}</h3>
                    <ol className={c.attempts}>
                      {view.learning.recent.map((a) => (
                        <li key={a.id} className={c.attempt}>
                          <div className={c.attemptMain}>
                            <code className={c.problem} title={a.latex}>
                              {a.problem}
                            </code>
                            <p className={c.attemptMeta}>
                              <span>{a.skill}</span>
                              <span title={a.whenTitle}>{a.when}</span>
                              {a.detail && <span>{a.detail}</span>}
                            </p>
                          </div>
                          <div className={c.attemptEnd}>
                            <Pill tone={a.outcomeTone}>{a.outcomeLabel}</Pill>
                            {a.boardHref && (
                              <Link href={a.boardHref} className={c.inlineLink} aria-label={USER_COPY.openBoardFor(a.problem)}>
                                {USER_COPY.board}
                                <ArrowUpRight size={14} strokeWidth={1.9} aria-hidden />
                              </Link>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </>
            )}
          </Section>

          <Section id="events-title" title={USER_COPY.eventsTitle} hint={USER_COPY.eventsHint}>
            <div className={styles.panel}>
              {view.events.items.length === 0 ? (
                <p className={styles.quiet}>
                  <CircleCheck size={16} strokeWidth={2} aria-hidden className={styles.inlineIconOk} />
                  {USER_COPY.eventsEmpty}
                </p>
              ) : (
                <ol className={c.timeline}>
                  {view.events.items.map((e) => (
                    <EventItem key={e.id} e={e} />
                  ))}
                </ol>
              )}
              {view.events.noise.length > 0 && (
                <details className={c.noise}>
                  <summary>{USER_COPY.noiseToggle(view.events.noise.length)}</summary>
                  <ol className={c.timeline}>
                    {view.events.noise.map((e) => (
                      <EventItem key={e.id} e={e} />
                    ))}
                  </ol>
                </details>
              )}
            </div>
          </Section>
        </div>

        <aside className={c.userSide} aria-label="Account">
          <Section id="subscription-title" title={USER_COPY.subscriptionTitle}>
            <div className={styles.panel}>{view.subscription ? <Facts facts={view.subscription} /> : <p className={styles.quiet}>{USER_COPY.subscriptionEmpty}</p>}</div>
          </Section>

          <Section id="user-bugs-title" title={`${USER_COPY.bugsTitle} (${view.bugs.length})`}>
            {view.bugs.length === 0 ? (
              <div className={styles.panel}>
                <p className={styles.quiet}>{USER_COPY.bugsEmpty}</p>
              </div>
            ) : (
              <ul className={c.miniList}>
                {view.bugs.map((b) => (
                  <li key={b.id}>
                    <Link href={bugHref(b.id, b.status)} className={c.miniItem}>
                      <span className={c.miniHead}>
                        <Pill tone={b.statusTone}>{b.statusLabel}</Pill>
                        <span className={c.miniWhen} title={b.whenTitle}>
                          {b.ago}
                        </span>
                      </span>
                      <span className={c.miniText} data-missing={b.messageMissing || undefined}>
                        {b.excerpt}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="emails-title" title={USER_COPY.emailsTitle}>
            <div className={styles.panel}>
              {view.emails.length === 0 ? (
                <p className={styles.quiet}>{USER_COPY.emailsEmpty}</p>
              ) : (
                <ul className={c.emails}>
                  {view.emails.map((e) => (
                    <li key={e.key}>
                      <Mail size={15} strokeWidth={1.9} aria-hidden />
                      <span className={c.emailKind}>{e.label}</span>
                      <span className={c.emailWhen} data-missing={!e.sent || undefined} title={e.title || undefined}>
                        {e.when}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}

/** /admin/users/[id]: one account. Admins only (see AdminFrame). */
export function UserScreen({ id, notFound }: { id: string; notFound: ReactNode }) {
  const access = useAdminAccess();
  const detail = useAdminResource(access.canRead ? ADMIN_API.user(id) : null, AdminUserDetailSchema, { pollMs: 60_000 });
  const now = useNow();
  const clock = useMemo(() => ({ now }), [now]);
  const view = useMemo(() => (detail.data ? buildUserPageView(detail.data, clock) : null), [detail.data, clock]);
  const updated = detail.data ? ADMIN_COPY.updated(relativeTime(detail.data.generatedAt, now) ?? formatWhen(detail.data.generatedAt, clock)) : null;
  const missing = (
    <div className={styles.inner}>
      <PageHeader title={USER_COPY.notFoundTitle} back={{ href: ADMIN_PAGES.users, label: USER_COPY.back }} />
      <Empty icon={<UserX size={22} strokeWidth={1.6} />} title={USER_COPY.notFoundTitle} hint={USER_COPY.notFoundHint} />
    </div>
  );
  return (
    <AdminFrame
      notFound={notFound}
      access={access}
      resource={detail}
      page="users"
      documentTitle={CONSOLE_COPY.documentTitle(view ? view.header.title : USER_COPY.notFoundTitle)}
      missing={missing}
    >
      <UserContent view={view} loading={detail.loading} error={detail.error} updated={updated} onRefresh={detail.refresh} />
    </AdminFrame>
  );
}
