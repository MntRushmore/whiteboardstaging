"use client";

import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/registry/components/badge/badge";
import { Button } from "@/registry/components/button/button";
import { DropdownMenu } from "@/registry/components/dropdown-menu/dropdown-menu";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import { isDefaultBoardTitle } from "@/lib/boards/boardTitle";
import {
  displayTitle,
  editedLabel,
  exactTimeLabel,
  relativeTime,
  thumbnailStateFor,
  type BoardGroup,
  type BoardListItem,
} from "@/app/dashboardState";
import styles from "./boards.module.css";

/**
 * The dashboard's board grid and list (src/app/(platform)/page.tsx owns the data and the dialogs).
 * Each card or row is one link to the board, stretched over it, with the ⋯ menu above it,
 * so Tab lands on the board and then its menu, and the focus ring wraps the whole card.
 */

export type BoardView = "grid" | "list";

export type BoardActions = {
  onRename: (board: BoardListItem) => void;
  onDelete: (board: BoardListItem) => void;
};

function BoardThumbnail({ board, compact = false }: { board: BoardListItem; compact?: boolean }) {
  const state = thumbnailStateFor(board);
  if (state === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a stored data: URL; next/image cannot optimise it
      <img src={board.preview ?? ""} alt="" loading="lazy" decoding="async" draggable={false} className={styles.thumbImage} />
    );
  }
  // A blank screen: the board has no picture (never drawn on, or none saved yet).
  return (
    <div className={styles.blank}>
      {!compact && (
        <Badge size="sm">{state === "empty" ? "Empty board" : "No preview yet"}</Badge>
      )}
    </div>
  );
}

function BoardMenu({ board, actions }: { board: BoardListItem; actions: BoardActions }) {
  return (
    // Not modal: each item opens a dialog, and a modal menu closing under an opening dialog
    // can leave the page unclickable (Radix).
    <DropdownMenu
      label="More actions"
      modal={false}
      trigger={
        <Button variant="ghost" size="sm" aria-label={`More actions for ${displayTitle(board.title)}`} className={styles.menuButton}>
          <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden />
        </Button>
      }
      items={[
        { label: "Rename", icon: <Pencil size={15} strokeWidth={1.75} />, onSelect: () => actions.onRename(board) },
        {
          label: "Delete",
          icon: <Trash2 size={15} strokeWidth={1.75} />,
          destructive: true,
          separatorBefore: true,
          onSelect: () => actions.onDelete(board),
        },
      ]}
    />
  );
}

/** The board's name as a link stretched over its card or row. */
function BoardLink({ board }: { board: BoardListItem }) {
  const untitled = isDefaultBoardTitle(board.title);
  const title = displayTitle(board.title);
  return (
    <Link
      href={`/board/${board.id}`}
      prefetch={false}
      title={title}
      className={[styles.link, untitled && styles.untitled].filter(Boolean).join(" ")}
    >
      {title}
    </Link>
  );
}

function BoardCard({ board, now, actions }: { board: BoardListItem; now: Date; actions: BoardActions }) {
  return (
    <li data-board-id={board.id} className={styles.card}>
      <div className={styles.thumb}>
        <BoardThumbnail board={board} />
      </div>
      <div className={styles.cardFooter}>
        <div className={styles.cardText}>
          <h3 className={styles.cardTitle}>
            <BoardLink board={board} />
          </h3>
          <p className={styles.meta} title={exactTimeLabel(board.updated_at)}>
            {editedLabel(board.updated_at, now)}
          </p>
        </div>
        <BoardMenu board={board} actions={actions} />
      </div>
    </li>
  );
}

function BoardRow({ board, now, actions }: { board: BoardListItem; now: Date; actions: BoardActions }) {
  const edited = editedLabel(board.updated_at, now);
  return (
    <li data-board-id={board.id} className={styles.row}>
      <div className={styles.rowThumb}>
        <BoardThumbnail board={board} compact />
      </div>
      <div className={styles.cardText}>
        <h3 className={styles.cardTitle}>
          <BoardLink board={board} />
        </h3>
        <p className={`${styles.meta} ${styles.rowMetaInline}`}>{edited}</p>
      </div>
      <p className={`${styles.rowColumn} ${styles.rowEdited}`} title={exactTimeLabel(board.updated_at)}>
        {edited}
      </p>
      <p className={`${styles.rowColumn} ${styles.rowCreated}`} title={exactTimeLabel(board.created_at)}>
        Created {relativeTime(board.created_at, now)}
      </p>
      <BoardMenu board={board} actions={actions} />
    </li>
  );
}

/** Boards in groups ("Today", "This week", "Earlier"; or one unlabelled group), as a grid or a list. */
export function BoardGroups({
  groups,
  view,
  now,
  actions,
}: {
  groups: BoardGroup<BoardListItem>[];
  view: BoardView;
  now: Date;
  actions: BoardActions;
}) {
  return (
    <div className={styles.groups}>
      {groups.map((group) => {
        const headingId = `boards-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={group.label ? headingId : undefined} aria-label={group.label ? undefined : "Boards"}>
            {group.label && (
              <h2 id={headingId} className={styles.groupHeading}>
                {group.label}
                <span className={styles.groupCount}>{group.boards.length}</span>
              </h2>
            )}
            {view === "grid" ? (
              <ul className={styles.grid}>
                {group.boards.map((board) => (
                  <BoardCard key={board.id} board={board} now={now} actions={actions} />
                ))}
              </ul>
            ) : (
              <ul className={styles.list}>
                {group.boards.map((board) => (
                  <BoardRow key={board.id} board={board} now={now} actions={actions} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Placeholder cards in the grid's own shape while the list loads. */
export function BoardSkeletons({ count = 8 }: { count?: number }) {
  return (
    <div role="status" aria-busy="true">
      <span className={styles.srOnly}>Loading your boards</span>
      <div aria-hidden>
        <div className={`${styles.skeletonHeading} ${styles.pulse}`} />
        <ul className={styles.grid}>
          {Array.from({ length: count }, (_, i) => (
            <li key={i} className={styles.skeletonCard}>
              <div className={`${styles.skeletonThumb} ${styles.pulse}`} />
              <div className={styles.skeletonLines}>
                <Skeleton lines={2} label="" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
