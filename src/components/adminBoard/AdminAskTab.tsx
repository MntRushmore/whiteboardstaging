"use client";

import { useEffect, useMemo, useState } from "react";
import { MessagesSquare, RefreshCw, TriangleAlert } from "lucide-react";
import { ADMIN_API, AdminAskChatSchema, type AdminAskChat } from "@/lib/admin/contracts";
import { apiErrorFromResponse, authedFetch } from "@/lib/api-client";
import { describeError } from "@/lib/errorMessage";
import { Button } from "@/registry/components/button/button";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { ADMIN_BOARD_COPY, askTurnRows } from "./view";
import styles from "./adminBoard.module.css";

type Read = { chat: AdminAskChat | null; loading: boolean; error: string | null };

/**
 * The viewer's Ask tab: the board's Ask chat, oldest first, as the student and the tutor wrote it
 * (the tutor's notes and the kinds of action it wrote on the board under its turns). Read once,
 * when the tab is first opened (GET ADMIN_API.boardAsk, logged as 'board.ask'), and again on Try
 * again. Text only: nothing here draws or runs what the student typed.
 */
export function AdminAskTab({ id, now, fixture }: { id: string; now: number; fixture: boolean }) {
  const [read, setRead] = useState<Read>({ chat: null, loading: !fixture, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (fixture) return;
    let cancelled = false;
    void (async () => {
      setRead((r) => ({ ...r, loading: true, error: null }));
      try {
        const res = await authedFetch(ADMIN_API.boardAsk(id), { cache: "no-store" });
        if (!res.ok) throw await apiErrorFromResponse(res);
        const parsed = AdminAskChatSchema.safeParse(await res.json());
        if (!parsed.success) throw new Error(ADMIN_BOARD_COPY.badShape);
        if (!cancelled) setRead({ chat: parsed.data, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setRead({ chat: null, loading: false, error: describeError(err, ADMIN_BOARD_COPY.askLoadFallback) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, fixture, attempt]);

  const clock = useMemo(() => ({ now }), [now]);
  const rows = useMemo(() => askTurnRows(read.chat?.turns ?? [], clock), [read.chat, clock]);

  if (read.loading) return <div className={styles.bodySkeleton} aria-hidden />;
  if (read.error) {
    return (
      <div role="alert" className={styles.state}>
        <EmptyState
          icon={<TriangleAlert size={22} strokeWidth={1.6} />}
          title={ADMIN_BOARD_COPY.askLoadFailedTitle}
          description={read.error}
          action={
            <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              <RefreshCw size={15} strokeWidth={1.75} aria-hidden />
              {ADMIN_BOARD_COPY.retry}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <section className={`${styles.sideSection} ${styles.askPanel}`} aria-labelledby="board-ask">
      <h2 id="board-ask" className={styles.sideTitle}>
        <MessagesSquare size={16} aria-hidden />
        {ADMIN_BOARD_COPY.askTitle}
        {rows.length > 0 && <span className={styles.askCount}>{ADMIN_BOARD_COPY.askCount(rows.length)}</span>}
      </h2>
      <p className={styles.quiet}>{fixture ? ADMIN_BOARD_COPY.askFixture : ADMIN_BOARD_COPY.askHint}</p>
      {rows.length === 0 ? (
        !fixture && <p className={styles.quiet}>{ADMIN_BOARD_COPY.askEmpty}</p>
      ) : (
        <ol className={styles.askList}>
          {rows.map((t) => (
            <li key={t.id} className={styles.askTurn} data-role={t.role}>
              <div className={styles.rowHead}>
                <span className={styles.askWho}>{t.who}</span>
                <span className={styles.when}>{t.when}</span>
              </div>
              <p className={styles.askText}>{t.text}</p>
              {t.notes.map((note, i) => (
                <p key={i} className={styles.rowDetail}>
                  {note}
                </p>
              ))}
              {t.wrote && <p className={styles.rowDetail}>{t.wrote}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
