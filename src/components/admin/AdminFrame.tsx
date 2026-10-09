"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bug, ChartNoAxesColumn, Funnel, LayoutGrid, OctagonAlert, UsersRound } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader, APP_CONTENT_CLASS } from "@/components/app/AppHeader";
import { ADMIN_API, AdminBugListSchema, AdminIssueListSchema } from "@/lib/admin/contracts";
import { bugCounts } from "@/lib/admin/bugsView";
import { ADMIN_COPY } from "@/lib/admin/view";
import { CONSOLE_COPY, consoleNav, type ConsolePage, type NavItemView } from "@/lib/admin/consoleView";
import { attentionCounts, issuesUrl } from "@/lib/admin/issuesView";
import { RefreshBar } from "./AdminSections";
import { useDocumentTitle } from "./consoleHooks";
import { fixtureMode } from "./devFixtures";
import { useAdminResource } from "./useAdminResource";
import { useIsAdmin } from "./useIsAdmin";
import styles from "./admin.module.css";
import c from "./console.module.css";

export interface AdminAccess {
  user: User | null;
  authLoading: boolean;
  authError: string | null;
  /** the cached is_admin() hint: true, false, or null (not known yet) */
  hint: boolean | null;
  /** dev only: the pages read fixtures (devFixtures.ts), no session needed */
  fixtures: boolean;
  /** the console may ask its routes (signed in and not known to be a non-admin, or fixtures) */
  canRead: boolean;
}

const noSubscribe = () => () => {};

/**
 * Who is looking, for every console page: signed in, and whether the cached hint already says
 * admin or not. The routes decide for real (a non-admin gets 404 from each).
 */
export function useAdminAccess(): AdminAccess {
  const { user, loading, authError } = useAuth();
  const fixtures = useSyncExternalStore(
    noSubscribe,
    () => process.env.NODE_ENV !== "production" && fixtureMode() !== null,
    () => false,
  );
  const hint = useIsAdmin(fixtures ? undefined : user?.id, { lazy: false });
  return {
    user: user ?? null,
    authLoading: loading,
    authError: authError ?? null,
    hint: fixtures ? true : hint,
    fixtures,
    canRead: fixtures || Boolean(user && hint !== false),
  };
}

/** The bits of the page's main read the frame needs to decide what to show. */
export interface FrameResource {
  data: unknown;
  error: string | null;
  notFound: boolean;
  signedOut: boolean;
}

export interface AdminFrameProps {
  /** the app's own 404, rendered by the server page */
  notFound: ReactNode;
  access: AdminAccess;
  resource: FrameResource;
  page: ConsolePage;
  /** the tab's title once the page is shown */
  documentTitle: string;
  /**
   * A detail page's "no such record": shown for a 404 when the hint already says admin. Without it
   * (and for anyone else) a 404 is the app's own Not found.
   */
  missing?: ReactNode;
  children: ReactNode;
}

/**
 * Every console page's frame: the app header, the console's sections, then the page. Signed out
 * goes to /login. Anyone who is not an admin gets the plain "Page not found" (the app's own 404),
 * never a hint the page exists: the is_admin() hint answers at once for a known non-admin, and the
 * page's route answers 404 for everyone else. Until one of them has answered, a blank page.
 */
export function AdminFrame({ notFound, access, resource, page, documentTitle, missing, children }: AdminFrameProps) {
  const router = useRouter();
  const known = access.hint === true;
  const hidden = !access.fixtures && (access.hint === false || (resource.notFound && !(missing && known)));
  const signedOut = !access.fixtures && ((!access.authLoading && !access.user && !access.authError) || resource.signedOut);

  useEffect(() => {
    if (signedOut) router.replace("/login");
  }, [signedOut, router]);

  useDocumentTitle(hidden ? ADMIN_COPY.notFoundTitle : resource.data || resource.notFound ? documentTitle : null);

  if (!access.fixtures && !access.user && access.authError) {
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
  if (!access.fixtures && (!access.user || (resource.data === null && !resource.error && !resource.notFound && !known))) return <div className={styles.page} />;

  return (
    <div className={styles.page}>
      <AppHeader />
      <ConsoleNavLive current={page} canRead={access.canRead} />
      <main className={`${APP_CONTENT_CLASS} ${styles.main}`}>{resource.notFound && missing ? missing : children}</main>
    </div>
  );
}

const NAV_ICONS: Record<ConsolePage, ReactNode> = {
  overview: <ChartNoAxesColumn size={16} strokeWidth={1.9} aria-hidden />,
  users: <UsersRound size={16} strokeWidth={1.9} aria-hidden />,
  funnel: <Funnel size={16} strokeWidth={1.9} aria-hidden />,
  boards: <LayoutGrid size={16} strokeWidth={1.9} aria-hidden />,
  bugs: <Bug size={16} strokeWidth={1.9} aria-hidden />,
  issues: <OctagonAlert size={16} strokeWidth={1.9} aria-hidden />,
};

/** The sections as links, the current one marked, each count beside its name. Scrolls sideways on a phone. */
export function ConsoleNav({ items }: { items: readonly NavItemView[] }) {
  const list = useRef<HTMLUListElement>(null);
  const current = items.find((i) => i.current)?.page;
  // the counts arrive after the first paint and widen their links
  const counts = items.map((i) => i.count ?? "").join("|");
  // on a phone the list scrolls: bring the current section into view
  useEffect(() => {
    const ul = list.current;
    const link = ul?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!ul || !link || ul.scrollWidth <= ul.clientWidth) return;
    // the list is positioned, so it is the link's offset parent
    const left = link.offsetLeft;
    const right = left + link.offsetWidth;
    // clear of the fade at the right edge (24 px)
    if (right > ul.scrollLeft + ul.clientWidth - 32) ul.scrollLeft = right - ul.clientWidth + 32;
    else if (left < ul.scrollLeft) ul.scrollLeft = Math.max(0, left - 8);
  }, [current, counts]);
  return (
    <nav aria-label={CONSOLE_COPY.navLabel} className={c.navBar}>
      <div className={`${APP_CONTENT_CLASS} ${c.navInner}`}>
        <span className={c.navName} aria-hidden>
          {CONSOLE_COPY.name}
        </span>
        <ul ref={list} className={c.navList}>
          {items.map((item) => (
            <li key={item.page}>
              <Link href={item.href} className={c.navLink} aria-current={item.current ? "page" : undefined}>
                {NAV_ICONS[item.page]}
                <span>{item.label}</span>
                {item.count && (
                  <span className={c.navCount} data-urgent={item.urgent || undefined}>
                    <span aria-hidden>{item.count}</span>
                    <span className={styles.srOnly}>, {item.countLabel}</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/** The nav with live counts: new bug reports and issues needing a look, read every 2 minutes. */
function ConsoleNavLive({ current, canRead }: { current: ConsolePage; canRead: boolean }) {
  const bugs = useAdminResource(canRead ? ADMIN_API.bugs : null, AdminBugListSchema, { pollMs: 120_000 });
  const issues = useAdminResource(canRead ? issuesUrl() : null, AdminIssueListSchema, { pollMs: 120_000 });
  const attention = issues.data ? attentionCounts(issues.data.issues) : null;
  const items = consoleNav(current, {
    newBugs: bugs.data ? bugCounts(bugs.data.bugs).new : null,
    openIssues: attention?.open ?? null,
    regressed: attention?.regressed ?? 0,
  });
  return <ConsoleNav items={items} />;
}

export interface PageHeaderProps {
  title: string;
  hint?: ReactNode;
  /** a parent page: "All users" */
  back?: { href: string; label: string };
  /** "Updated 2 min ago"; null hides the refresh bar */
  updated?: string | null;
  refreshing?: boolean;
  /** the last refresh failed */
  stale?: string | null;
  onRefresh?: () => void;
  /** more under the title (a plan pill, the facts) */
  children?: ReactNode;
}

/** A console page's title row: an optional way back, the title, when it was read and Refresh. */
export function PageHeader({ title, hint, back, updated, refreshing = false, stale = null, onRefresh, children }: PageHeaderProps) {
  return (
    <header className={styles.hero}>
      {back && (
        <Link href={back.href} className={styles.back}>
          <ArrowLeft size={16} strokeWidth={1.9} aria-hidden />
          {back.label}
        </Link>
      )}
      <div className={styles.titleRow}>
        <h1 className={styles.title}>{title}</h1>
        {updated !== undefined && updated !== null && onRefresh && <RefreshBar updated={updated} refreshing={refreshing} stale={stale} onRefresh={onRefresh} />}
      </div>
      {hint && <p className={styles.heroHint}>{hint}</p>}
      {children}
    </header>
  );
}
