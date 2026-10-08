"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader, APP_CONTENT_CLASS } from "@/components/app/AppHeader";
import { useDocumentTitle } from "@/components/admin/consoleHooks";
import { useIsAdmin } from "@/components/admin/useIsAdmin";
import { ADMIN_PAGES } from "@/lib/admin/contracts";
import { ADMIN_COPY } from "@/lib/admin/view";
import { Button } from "@/registry/components/button/button";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { useAdminBoard } from "./useAdminBoard";
import { ADMIN_BOARD_COPY, boardMetaParts, liveAgo } from "./view";
import styles from "./adminBoard.module.css";

// The viewer itself (tldraw, the board's shapes, the replay) is its own chunk, fetched once the
// board has been read: nothing of it is in the admin pages' bundle, and the header shows at once.
const AdminBoardBody = dynamic(() => import("./AdminBoardBody"), {
  ssr: false,
  loading: () => <div className={styles.bodySkeleton} aria-hidden />,
});

/** "Now", ticking every second while following (for "updated 3 s ago"), else every 15 s. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

const noSubscribe = () => () => {};
const readFixtureParam = () => (process.env.NODE_ENV === "production" ? null : new URLSearchParams(window.location.search).get("fixture"));

/** `?fixture=` (development only): the viewer runs on made-up data, with no sign-in (src/lib/replay/devFixture.ts). */
function useDevFixture(): string | null {
  return useSyncExternalStore(noSubscribe, readFixtureParam, () => null);
}

/**
 * /admin/boards/[id]: one board, as it is now and as it was drawn (src/components/replay), with
 * the problems worked on it, its errors and its saved versions. Admins only, exactly as /admin is:
 * signed out goes to /login; anyone else gets the app's own "Page not found" (`notFound`), from the
 * cached is_admin() hint or the API's 404, never a frame of this page first.
 */
export function AdminBoardScreen({ id, notFound }: { id: string; notFound: ReactNode }) {
  const router = useRouter();
  const fixture = useDevFixture();
  const { user, loading: authLoading, authError } = useAuth();
  const hint = useIsAdmin(user?.id, { lazy: false });
  const { data, follow, setFollow, retry } = useAdminBoard(id, user && hint !== false ? user.id : undefined, fixture);
  const now = useNow(follow ? 1_000 : 15_000);

  const hidden = !fixture && (hint === false || data.notFound);
  const signedOut = !fixture && ((!authLoading && !user && !authError) || data.signedOut);

  useEffect(() => {
    if (signedOut) router.replace("/login");
  }, [signedOut, router]);

  const title = data.doc?.board.title?.trim() || ADMIN_BOARD_COPY.untitled;
  useDocumentTitle(hidden ? ADMIN_COPY.notFoundTitle : data.doc ? ADMIN_BOARD_COPY.documentTitle(title) : null);

  if (!fixture && !user && authError) {
    return (
      <div className={`${styles.page} ${styles.center}`}>
        <AuthErrorBanner />
      </div>
    );
  }
  if (hidden) return <>{notFound}</>;
  // until the server has answered, a non-admin must not see this page's frame
  if (!fixture && (!user || (!data.doc && !data.error && hint !== true))) return <div className={styles.page} />;

  const board = data.doc?.board ?? null;
  const clock = { now };

  return (
    <div className={styles.page}>
      {!fixture && <AppHeader />}
      <main className={`${APP_CONTENT_CLASS} ${styles.main}`}>
        <header className={styles.hero}>
          <Link href={ADMIN_PAGES.boards} className={styles.back}>
            <ArrowLeft size={16} strokeWidth={1.9} aria-hidden />
            {ADMIN_BOARD_COPY.back}
          </Link>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{board ? title : " "}</h1>
            {board && (
              <div className={styles.followBox}>
                {follow && (
                  <span className={styles.livePill} role="status">
                    <span className={styles.liveDot} aria-hidden />
                    {ADMIN_BOARD_COPY.live}
                    <span className={styles.liveAgo}>{liveAgo(board.updatedAt, now)}</span>
                  </span>
                )}
                <button type="button" role="switch" aria-checked={follow} className={styles.followSwitch} onClick={() => setFollow(!follow)} title={ADMIN_BOARD_COPY.followHint}>
                  <span className={styles.switchTrack} aria-hidden>
                    <span className={styles.switchThumb} />
                  </span>
                  {ADMIN_BOARD_COPY.follow}
                </button>
              </div>
            )}
          </div>
          {board && (
            <p className={styles.meta}>
              <Link href={ADMIN_PAGES.user(board.userId)} className={styles.owner}>
                {board.ownerEmail ?? board.ownerName ?? ADMIN_BOARD_COPY.noEmail}
              </Link>
              {boardMetaParts(board, clock).map((part) => (
                <span key={part}>{part}</span>
              ))}
            </p>
          )}
          {fixture && <p className={styles.fixtureNote}>{ADMIN_BOARD_COPY.fixture}</p>}
          {data.followError && <p className={styles.followError}>{data.followError}</p>}
        </header>

        {data.doc ? (
          <AdminBoardBody doc={data.doc} now={now} />
        ) : data.loading ? (
          <div className={styles.bodySkeleton} aria-hidden />
        ) : (
          <div role="alert" className={styles.state}>
            <EmptyState
              icon={<TriangleAlert size={22} strokeWidth={1.6} />}
              title={ADMIN_BOARD_COPY.loadFailedTitle}
              description={data.error ?? ADMIN_BOARD_COPY.loadFallback}
              action={
                <Button variant="secondary" onClick={retry}>
                  <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
                  {ADMIN_BOARD_COPY.retry}
                </Button>
              }
            />
          </div>
        )}
      </main>
    </div>
  );
}
