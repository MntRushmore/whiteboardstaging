"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchX, UsersRound } from "lucide-react";
import { ADMIN_API, AdminUserListSchema, type PlanState } from "@/lib/admin/contracts";
import { CONSOLE_COPY } from "@/lib/admin/consoleView";
import { DEFAULT_USER_QUERY, USERS_COPY, USER_SORTS, buildUsersView, toggle, type UserQuery, type UserRowView, type UsersView } from "@/lib/admin/usersView";
import { ADMIN_COPY, formatWhen, relativeTime } from "@/lib/admin/view";
import { Button } from "@/registry/components/button/button";
import { SearchField } from "@/registry/components/search-field/search-field";
import { AdminFrame, PageHeader, useAdminAccess } from "./AdminFrame";
import { AdminMark, Avatar, ChoiceRow, Chip, Empty, LoadFailed, Pill, SkeletonRows } from "./ConsoleBits";
import { useSlashFocus, useWide } from "./consoleHooks";
import { useAdminResource } from "./useAdminResource";
import { useNow } from "./useNow";
import styles from "./admin.module.css";
import c from "./console.module.css";

export type UsersLayout = "table" | "list";

export interface UsersContentProps {
  view: UsersView | null;
  query: UserQuery;
  onQuery: (q: UserQuery) => void;
  loading: boolean;
  error: string | null;
  updated: string | null;
  onRefresh: () => void;
  /** a table from 760 px, a list of cards below */
  layout: UsersLayout;
  searchRef?: RefObject<HTMLInputElement | null>;
}

function PlanPill({ row }: { row: UserRowView }) {
  return (
    <Pill tone={row.planTone} title={row.planNote ?? undefined}>
      {row.planLabel}
    </Pill>
  );
}

function Who({ row }: { row: UserRowView }) {
  return (
    <span className={c.who}>
      <Avatar initials={row.initials} tone={row.avatarTone} live={row.liveNow} />
      <span className={c.whoText}>
        <span className={c.whoName}>
          {row.name}
          {row.isAdmin && <AdminMark />}
        </span>
        <span className={c.whoEmail}>{row.email}</span>
      </span>
    </span>
  );
}

function UsersTable({ rows }: { rows: readonly UserRowView[] }) {
  const col = USERS_COPY.columns;
  return (
    <div className={c.tableWrap}>
      <table className={c.table}>
        <caption className={styles.srOnly}>{USERS_COPY.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{col.user}</th>
            <th scope="col">{col.plan}</th>
            <th scope="col" data-num>
              {col.signedUp}
            </th>
            <th scope="col" data-num>
              {col.lastActive}
            </th>
            <th scope="col" data-num>
              {col.boards}
            </th>
            <th scope="col" data-num>
              {col.attempts}
            </th>
            <th scope="col" data-num>
              {col.aiCalls}
            </th>
            <th scope="col" data-num>
              {col.errors}
            </th>
            <th scope="col" data-num>
              {col.bugs}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={c.rowLink}>
              <th scope="row">
                <Link href={r.href} className={c.stretch} aria-label={`${r.name}, ${r.email}`}>
                  <Who row={r} />
                </Link>
              </th>
              <td>
                <span className={c.planCell}>
                  <PlanPill row={r} />
                  {r.planNote && <span className={c.cellNote}>{r.planNote}</span>}
                  {!r.onboarded && <span className={c.cellNote}>{USERS_COPY.notOnboarded}</span>}
                </span>
              </td>
              <td data-num title={r.signedUpTitle}>
                {r.signedUp}
              </td>
              <td data-num title={r.lastActiveTitle || undefined} data-today={r.activeToday || undefined}>
                {r.lastActive}
              </td>
              <td data-num>{r.boards}</td>
              <td data-num>
                {r.attempts}
                {r.alone && <span className={c.cellNote}>{r.alone}</span>}
              </td>
              <td data-num>{r.aiCalls}</td>
              <td data-num data-bad={r.hasErrors || undefined}>
                {r.errors}
              </td>
              <td data-num data-bad={r.hasBugs || undefined}>
                {r.bugs}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsersList({ rows }: { rows: readonly UserRowView[] }) {
  return (
    <ul className={c.cardList}>
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={r.href} className={c.userCard}>
            <span className={c.userCardTop}>
              <Who row={r} />
              <PlanPill row={r} />
            </span>
            <span className={c.userCardFacts}>
              {r.facts.map((f) => (
                <span key={f.key} data-bad={f.bad || undefined}>
                  {f.text}
                </span>
              ))}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The users page under its header: search, plan chips, the "show only" filters and the sort, then
 * every account that matches as a table (a list of cards on a phone). Renders from a finished view,
 * so it renders from fixtures too.
 */
export function UsersContent({ view, query, onQuery, loading, error, updated, onRefresh, layout, searchRef }: UsersContentProps) {
  let body: ReactNode;
  if (!view && loading) body = <SkeletonRows rows={8} />;
  else if (!view) body = <LoadFailed title={CONSOLE_COPY.loadFailed(USERS_COPY.loadWhat)} error={error} onRetry={onRefresh} />;
  else if (view.empty) body = <Empty icon={<UsersRound size={22} strokeWidth={1.6} />} title={USERS_COPY.emptyTitle} hint={USERS_COPY.emptyHint} />;
  else
    body = (
      <>
        <div className={c.toolbar}>
          <div className={c.toolbarRow}>
            <div className={c.search}>
              <SearchField
                ref={searchRef}
                label={USERS_COPY.searchLabel}
                placeholder={USERS_COPY.searchPlaceholder}
                value={query.search}
                onValueChange={(search) => onQuery({ ...query, search })}
                aria-keyshortcuts="/"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className={c.kbd} aria-hidden>
                /
              </kbd>
            </div>
            <ChoiceRow label={USERS_COPY.sortLabel} options={USER_SORTS.map((s) => ({ key: s, label: USERS_COPY.sorts[s] }))} value={query.sort} onChange={(sort) => onQuery({ ...query, sort })} />
          </div>
          <div className={c.chipRow} role="group" aria-label={USERS_COPY.plansLabel}>
            <span className={c.chipLabel} aria-hidden>
              {USERS_COPY.plansLabel}
            </span>
            {view.plans.map((p) => (
              <Chip key={p.key} pressed={p.pressed} count={p.count} tone={p.tone} onToggle={() => onQuery({ ...query, plans: toggle<PlanState>(query.plans, p.key) })}>
                {p.label}
              </Chip>
            ))}
          </div>
          <div className={c.chipRow} role="group" aria-label={USERS_COPY.filtersLabel}>
            <span className={c.chipLabel} aria-hidden>
              {USERS_COPY.filtersLabel}
            </span>
            {view.filters.map((f) => (
              <Chip key={f.key} pressed={f.pressed} count={f.count} onToggle={() => onQuery({ ...query, filters: toggle(query.filters, f.key) })}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className={c.resultLine}>
          <p role="status">{view.showing}</p>
          {view.filtered && (
            <Button variant="ghost" size="sm" onClick={() => onQuery({ ...DEFAULT_USER_QUERY, sort: query.sort })}>
              {USERS_COPY.clear}
            </Button>
          )}
        </div>
        {view.noMatch ? (
          <Empty icon={<SearchX size={22} strokeWidth={1.6} />} title={USERS_COPY.noMatchTitle} hint={USERS_COPY.noMatchHint} />
        ) : layout === "table" ? (
          <UsersTable rows={view.rows} />
        ) : (
          <UsersList rows={view.rows} />
        )}
      </>
    );

  return (
    <div className={styles.inner}>
      <PageHeader title={USERS_COPY.title} hint={USERS_COPY.hint} updated={view ? updated : null} refreshing={loading} stale={error ? CONSOLE_COPY.staleNote : null} onRefresh={onRefresh} />
      <div className={c.pageBody} data-refreshing={(loading && Boolean(view)) || undefined}>
        {body}
      </div>
    </div>
  );
}

/** The query survives going to a user's page and back (this tab only). */
let rememberedQuery: UserQuery = DEFAULT_USER_QUERY;

/** /admin/users: every account. Admins only (see AdminFrame). */
export function UsersScreen({ notFound }: { notFound: ReactNode }) {
  const access = useAdminAccess();
  const users = useAdminResource(access.canRead ? ADMIN_API.users : null, AdminUserListSchema, { pollMs: 120_000 });
  const now = useNow();
  const [query, setQuery] = useState<UserQuery>(rememberedQuery);
  const wide = useWide(760);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  useSlashFocus(searchRef);

  const onQuery = (q: UserQuery) => {
    rememberedQuery = q;
    setQuery(q);
  };
  const clock = useMemo(() => ({ now }), [now]);
  const view = useMemo(() => (users.data ? buildUsersView(users.data.users, query, clock) : null), [users.data, query, clock]);
  const updated = users.data ? ADMIN_COPY.updated(relativeTime(users.data.generatedAt, now) ?? formatWhen(users.data.generatedAt, clock)) : null;

  // Enter in the search with exactly one match opens it
  useEffect(() => {
    const input = searchRef.current;
    if (!input || !view || view.rows.length !== 1) return;
    const only = view.rows[0].href;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") router.push(only);
    };
    input.addEventListener("keydown", onKey);
    return () => input.removeEventListener("keydown", onKey);
  }, [view, router]);

  return (
    <AdminFrame notFound={notFound} access={access} resource={users} page="users" documentTitle={CONSOLE_COPY.documentTitle(USERS_COPY.title)}>
      <UsersContent view={view} query={query} onQuery={onQuery} loading={users.loading} error={users.error} updated={updated} onRefresh={users.refresh} layout={wide ? "table" : "list"} searchRef={searchRef} />
    </AdminFrame>
  );
}
