"use client";

import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isDefaultBoardTitle } from "@/lib/boards/boardTitle";
import { cn } from "@/lib/utils";
import {
  displayTitle,
  editedLabel,
  exactTimeLabel,
  relativeTime,
  thumbnailStateFor,
  type BoardGroup,
  type BoardListItem,
} from "@/app/dashboardState";

/**
 * The dashboard's board grid and list (src/app/page.tsx owns the data and the dialogs).
 * Each card or row is one link to the board, stretched over it, with the ⋯ menu above it,
 * so Tab lands on the board and then its menu, and the focus ring wraps the whole card.
 */

export type BoardView = "grid" | "list";

export type BoardActions = {
  onRename: (board: BoardListItem) => void;
  onDelete: (board: BoardListItem) => void;
};

const GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-x-5 gap-y-6";

/** A blank screen: the board has no picture (never drawn on, or none saved yet). */
function BlankScreen({ label, compact = false }: { label: string | null; compact?: boolean }) {
  return (
    <div className="flex size-full items-center justify-center bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-white [background-size:14px_14px]">
      {label && !compact && (
        <span className="rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground">{label}</span>
      )}
    </div>
  );
}

function BoardThumbnail({ board, compact = false }: { board: BoardListItem; compact?: boolean }) {
  const state = thumbnailStateFor(board);
  if (state === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a stored data: URL; next/image cannot optimise it
      <img src={board.preview ?? ""} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
    );
  }
  return <BlankScreen compact={compact} label={state === "empty" ? "Empty board" : "No preview yet"} />;
}

function BoardMenu({ board, actions, className }: { board: BoardListItem; actions: BoardActions; className?: string }) {
  return (
    // Not modal: each item opens a dialog, and a modal menu closing under an opening dialog
    // can leave the page unclickable (Radix).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`More actions for ${displayTitle(board.title)}`}
          className={cn("relative z-10 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground", className)}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem className="gap-2" onSelect={() => actions.onRename(board)}>
          <Pencil className="size-4 text-muted-foreground" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
          onSelect={() => actions.onDelete(board)}
        >
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The board's name as a link stretched over its card/row (`after:inset-0`). */
function BoardLink({ board }: { board: BoardListItem }) {
  const untitled = isDefaultBoardTitle(board.title);
  const title = displayTitle(board.title);
  return (
    <Link
      href={`/board/${board.id}`}
      prefetch={false}
      title={title}
      className={cn(
        "block truncate text-sm font-medium outline-none after:absolute after:inset-0 after:content-['']",
        untitled && "text-muted-foreground",
      )}
    >
      {title}
    </Link>
  );
}

const ITEM_FOCUS = "has-[a:focus-visible]:border-ring has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50";

function BoardCard({ board, now, actions }: { board: BoardListItem; now: Date; actions: BoardActions }) {
  return (
    <li
      data-board-id={board.id}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-[box-shadow,border-color] hover:border-foreground/15 hover:shadow-md",
        ITEM_FOCUS,
      )}
    >
      <div className="relative aspect-video overflow-hidden border-b bg-white">
        <BoardThumbnail board={board} />
      </div>
      <div className="flex items-center gap-1 py-2.5 pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <h3 className="min-w-0">
            <BoardLink board={board} />
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={exactTimeLabel(board.updated_at)}>
            {editedLabel(board.updated_at, now)}
          </p>
        </div>
        <BoardMenu board={board} actions={actions} />
      </div>
    </li>
  );
}

function BoardRow({ board, now, actions }: { board: BoardListItem; now: Date; actions: BoardActions }) {
  return (
    <li
      data-board-id={board.id}
      className={cn(
        "group relative flex items-center gap-4 border-transparent py-2.5 pr-2 pl-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent/60",
        "has-[a:focus-visible]:z-10 has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50",
      )}
    >
      <div className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-md border bg-white sm:w-24">
        <BoardThumbnail board={board} compact />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="min-w-0">
          <BoardLink board={board} />
        </h3>
        <p className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">{editedLabel(board.updated_at, now)}</p>
      </div>
      <p className="hidden w-36 shrink-0 text-sm text-muted-foreground sm:block" title={exactTimeLabel(board.updated_at)}>
        {editedLabel(board.updated_at, now)}
      </p>
      <p className="hidden w-32 shrink-0 text-sm text-muted-foreground lg:block" title={exactTimeLabel(board.created_at)}>
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
    <div className="space-y-10">
      {groups.map((group) => {
        const headingId = `boards-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={group.label ? headingId : undefined} aria-label={group.label ? undefined : "Boards"}>
            {group.label && (
              <h2 id={headingId} className="mb-3 flex items-baseline gap-2 text-sm font-medium">
                {group.label}
                <span className="text-xs font-normal tabular-nums text-muted-foreground">{group.boards.length}</span>
              </h2>
            )}
            {view === "grid" ? (
              <ul className={GRID_CLASS}>
                {group.boards.map((board) => (
                  <BoardCard key={board.id} board={board} now={now} actions={actions} />
                ))}
              </ul>
            ) : (
              <ul className="divide-y rounded-xl border bg-card shadow-xs">
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
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your boards</span>
      <div className="mb-3 h-4 w-16 animate-pulse rounded bg-muted" />
      <ul className={GRID_CLASS} aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <div className="aspect-video animate-pulse border-b bg-muted/70" />
            <div className="space-y-2 py-3 pr-2 pl-4">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
