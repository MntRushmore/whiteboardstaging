"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader, APP_CONTENT_CLASS } from "@/components/app/AppHeader";
import { FamilyAvatar } from "@/components/family/FamilyAvatar";
import { ApiError } from "@/lib/api-client";
import { signInPath } from "@/lib/loginForm";
import { loadReplay, type ReplayAnswer } from "@/lib/report/client";
import { REPORT_PATH } from "@/lib/report/contracts";
import { REPORT_COPY } from "@/lib/report/copy";
import { afterFailedRead } from "@/lib/report/view";
import { Alert } from "@/registry/components/alert/alert";
import { Button } from "@/registry/components/button/button";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import styles from "./report.module.css";

// tldraw and the player are their own chunk, fetched once the board has been read.
const ReplayBody = dynamic(() => import("./ReplayBody"), {
  ssr: false,
  loading: () => <div className={styles.replaySkeleton} aria-hidden />,
});

/**
 * /report/replay/<board id>: "Watch them solve it". The board is read through GET
 * /api/report/boards/<id>, which opens it only for its owner or the owner's grown-up (a kid's board
 * stays private to the family; RLS itself is unchanged), then replayed stroke by stroke.
 */
export function ReplayScreen({ boardId }: { boardId: string }) {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const [version, setVersion] = useState(0);
  // the last read, keyed by what it was for: anything else is still loading
  const key = `${user?.id ?? ""}|${boardId}|${version}`;
  const [read, setRead] = useState<{ key: string; board: ReplayAnswer | null; state: "missing" | "failed" | "ready" } | null>(null);
  const state = read && read.key === key ? read.state : "loading";
  const board = state === "ready" ? read!.board : null;

  // signed out: sign in, then back to this replay
  useEffect(() => {
    if (!authLoading && !user && !authError) router.replace(signInPath(`${REPORT_PATH}/replay/${boardId}`));
  }, [user, authLoading, authError, router, boardId]);

  // Keyed on the account's id, not the user object: auth-js hands over a new object on every
  // SIGNED_IN / TOKEN_REFRESHED (each return to the tab, and hourly), and a board can be megabytes.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    const abort = new AbortController();
    loadReplay(boardId, abort.signal)
      .then((b) => setRead({ key, board: b, state: "ready" }))
      .catch((err) => {
        if (abort.signal.aborted) return;
        const state = err instanceof ApiError && (err.status === 404 || err.status === 400) ? "missing" : "failed";
        // a re-read that fails keeps the replay being watched; only a first read shows the error
        setRead((prev) => afterFailedRead(prev, { key, board: null, state }, (r) => r.state === "ready"));
      });
    return () => abort.abort();
  }, [userId, boardId, key]);

  const own = board?.ownerId === user?.id;
  const title = board ? (own ? REPORT_COPY.replayTitleSelf : REPORT_COPY.replayTitle(board.ownerName)) : REPORT_COPY.replayLoading;

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={`${APP_CONTENT_CLASS} ${styles.main}`}>
        <div className={styles.replayInner}>
          <AuthErrorBanner />
          <div className={styles.titleBlock}>
            <Link href={REPORT_PATH} className={styles.back}>
              <ArrowLeft size={16} aria-hidden />
              {REPORT_COPY.replayBack}
            </Link>
            <div className={styles.replayHead}>
              {board && !own && <FamilyAvatar name={board.ownerName} avatar={board.ownerAvatar} size="md" />}
              <div>
                <h1 className={styles.title}>{title}</h1>
                {board?.title && <p className={styles.subtitle}>{board.title}</p>}
              </div>
            </div>
          </div>

          {state === "missing" ? (
            <EmptyState title={REPORT_COPY.replayMissingTitle} description={REPORT_COPY.replayMissing} action={<Button onClick={() => router.push(REPORT_PATH)}>{REPORT_COPY.replayBack}</Button>} />
          ) : state === "failed" ? (
            <Alert tone="danger" title={REPORT_COPY.loadFailedTitle}>
              <p>{REPORT_COPY.loadFailed}</p>
              <Button variant="secondary" size="sm" onClick={() => setVersion((v) => v + 1)} className={styles.retry}>
                <RefreshCw size={14} aria-hidden />
                {REPORT_COPY.retry}
              </Button>
            </Alert>
          ) : (
            <section className={styles.replayCard} aria-label={title}>
              <p className={styles.replayHint}>{REPORT_COPY.replayHint}</p>
              {state === "ready" && board ? <ReplayBody snapshot={board.snapshot} /> : <div className={styles.replaySkeleton} aria-hidden />}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
