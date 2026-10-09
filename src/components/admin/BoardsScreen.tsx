"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { AdminBoardListSchema, type AdminBoardRow } from "@/lib/admin/contracts";
import { BOARDS_COPY, boardTileView, boardsUrl, liveNowView, mergeBoardPages, type BoardTileView, type LiveNowView } from "@/lib/admin/boardsView";
import { CONSOLE_COPY } from "@/lib/admin/consoleView";
import { ADMIN_COPY, formatWhen, relativeTime } from "@/lib/admin/view";
import { Button } from "@/registry/components/button/button";
import { Section } from "./AdminSections";
import { AdminFrame, PageHeader, useAdminAccess } from "./AdminFrame";
import { BoardGrid, LiveNow } from "./BoardTiles";
import { Empty, LoadFailed, SkeletonTiles } from "./ConsoleBits";
import { readAdmin } from "./adminData";
import { useAdminResource } from "./useAdminResource";
import { useNow } from "./useNow";
import styles from "./admin.module.css";
import c from "./console.module.css";

export interface BoardsContentProps {
  live: LiveNowView | null;
  liveError: string | null;
  tiles: BoardTileView[] | null;
  loading: boolean;
  error: string | null;
  updated: string | null;
  onRefresh: () => void;
  more: { has: boolean; loading: boolean; error: string | null; onMore: () => void };
}

/** The boards page under its header: Live now, then every board, newest first, with Load more. */
export function BoardsContent({ live, liveError, tiles, loading, error, updated, onRefresh, more }: BoardsContentProps) {
  return (
    <div className={styles.inner}>
      <PageHeader title={BOARDS_COPY.title} hint={BOARDS_COPY.hint} updated={tiles ? updated : null} refreshing={loading} stale={error ? CONSOLE_COPY.staleNote : null} onRefresh={onRefresh} />
      <div className={styles.sections}>
        <Section id="live-title" title={BOARDS_COPY.liveTitle} hint={BOARDS_COPY.liveHint}>
          <LiveNow live={live} error={liveError} />
        </Section>
        <Section id="all-boards-title" title={BOARDS_COPY.recentTitle}>
          {!tiles && loading ? (
            <SkeletonTiles />
          ) : !tiles ? (
            <LoadFailed title={CONSOLE_COPY.loadFailed(BOARDS_COPY.loadWhat)} error={error} onRetry={onRefresh} />
          ) : tiles.length === 0 ? (
            <Empty icon={<LayoutGrid size={22} strokeWidth={1.6} />} title={BOARDS_COPY.emptyTitle} hint={BOARDS_COPY.emptyHint} />
          ) : (
            <>
              <BoardGrid tiles={tiles} label={BOARDS_COPY.recentTitle} />
              <div className={c.moreRow}>
                {more.has ? (
                  <Button variant="secondary" onClick={more.onMore} loading={more.loading} aria-busy={more.loading || undefined}>
                    {more.loading ? BOARDS_COPY.loadingMore : BOARDS_COPY.loadMore}
                  </Button>
                ) : (
                  <p className={styles.quiet}>{BOARDS_COPY.end(tiles.length)}</p>
                )}
                {more.error && (
                  <p className={c.moreError} role="alert">
                    {BOARDS_COPY.loadMoreFailed} {more.error}
                  </p>
                )}
              </div>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

/** /admin/boards: who is on a board now (checked every 15 s), then every board. Admins only (see AdminFrame). */
export function BoardsScreen({ notFound }: { notFound: ReactNode }) {
  const access = useAdminAccess();
  const first = useAdminResource(access.canRead ? boardsUrl() : null, AdminBoardListSchema, { pollMs: 60_000 });
  const live = useAdminResource(access.canRead ? boardsUrl({ live: true }) : null, AdminBoardListSchema, { pollMs: 15_000 });
  const now = useNow();
  const clock = useMemo(() => ({ now }), [now]);
  const [extra, setExtra] = useState<{ pages: AdminBoardRow[][]; next: string | null | undefined; loading: boolean; error: string | null }>({ pages: [], next: undefined, loading: false, error: null });

  // the next page starts after the last one loaded (or the first page's own cursor)
  const nextBefore = extra.next === undefined ? (first.data?.nextBefore ?? null) : extra.next;
  const onMore = useCallback(() => {
    if (!nextBefore || extra.loading) return;
    setExtra((x) => ({ ...x, loading: true, error: null }));
    void readAdmin(boardsUrl({ before: nextBefore }), AdminBoardListSchema).then((res) => {
      setExtra((x) =>
        res.kind === "data" ? { pages: [...x.pages, res.data.boards], next: res.data.nextBefore, loading: false, error: null } : { ...x, loading: false, error: res.kind === "error" ? res.error : CONSOLE_COPY.loadFallback },
      );
    });
  }, [nextBefore, extra.loading]);

  const tiles = useMemo(() => (first.data ? mergeBoardPages([first.data.boards, ...extra.pages]).map((b) => boardTileView(b, clock)) : null), [first.data, extra.pages, clock]);
  const liveView = useMemo(() => (live.data ? liveNowView(live.data.boards, clock) : null), [live.data, clock]);
  const updated = first.data ? ADMIN_COPY.updated(relativeTime(first.data.generatedAt, now) ?? formatWhen(first.data.generatedAt, clock)) : null;

  return (
    <AdminFrame notFound={notFound} access={access} resource={first} page="boards" documentTitle={CONSOLE_COPY.documentTitle(BOARDS_COPY.title)}>
      <BoardsContent
        live={liveView}
        liveError={live.error}
        tiles={tiles}
        loading={first.loading}
        error={first.error}
        updated={updated}
        onRefresh={() => {
          first.refresh();
          live.refresh();
        }}
        more={{ has: Boolean(nextBefore), loading: extra.loading, error: extra.error, onMore }}
      />
    </AdminFrame>
  );
}
