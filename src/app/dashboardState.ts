/**
 * Pure view-state for the dashboard (src/app/page.tsx). Kept free of React so
 * the loading / error / empty / list decision and the list's search, sort,
 * recency groups and "Edited 2 h ago" labels are unit-tested directly.
 */

import { isDefaultBoardTitle } from "@/lib/boards/boardTitle";

export type DashboardState = "loading" | "error" | "empty" | "list";

export type DashboardStateInput = {
  loading: boolean;
  error: string | null;
  boards: ReadonlyArray<unknown>;
};

/**
 * Precedence: a fetch in flight always shows the skeleton; a failed fetch shows
 * the inline error panel (even if a previous load left boards on screen, the
 * user asked for a refresh and should see why it did not arrive); otherwise
 * empty vs. list.
 */
export function dashboardStateFor({
  loading,
  error,
  boards,
}: DashboardStateInput): DashboardState {
  if (loading) return "loading";
  if (error) return "error";
  if (boards.length === 0) return "empty";
  return "list";
}

export const DASHBOARD_COPY = {
  loadFailedTitle: "Couldn't load your boards",
  loadFallback: "Something interrupted the request. Retry in a moment.",
  createFailedTitle: "Couldn't create a board",
  createFallback: "The board was not created. Retry in a moment.",
  renameFailedTitle: "Couldn't rename this board",
  renameFallback: "The new name was not saved. Retry in a moment.",
  deleteFailedTitle: "Couldn't delete this board",
  deleteFallback: "The board is still here. Retry in a moment.",
  retry: "Retry",
  emptyTitle: "No boards yet",
  emptyHint: "Write a maths problem on a board and the tutor checks each line as you go.",
  noMatchesTitle: "No boards match your search",
  noMatchesHint: "Try another word, or clear the search.",
} as const;

// ---------------------------------------------------------------------------
// The board list: search, sort, recency groups, "Edited 2 h ago", thumbnails
// ---------------------------------------------------------------------------

/** The columns the dashboard reads (`select id, title, created_at, updated_at, preview, version`). */
export type BoardListItem = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  preview?: string | null;
  /** bumped by a trigger on every `data` change; 1 = never saved, so the board is empty */
  version?: number | null;
};

/** What a board without a name is called on its card. */
export const UNTITLED_LABEL = "Untitled board";

/** The card title: the stored one, or "Untitled board" for the column default. */
export function displayTitle(title: string | null | undefined): string {
  return isDefaultBoardTitle(title) ? UNTITLED_LABEL : (title as string).trim();
}

/** Case- and form-insensitive: "x2" finds "x²", "-" finds "−". */
function searchable(text: string): string {
  return text.normalize("NFKC").replace(/[−–—]/g, "-").toLowerCase();
}

/** Boards whose title (or card title, so "untitled" works) contains the query. */
export function filterBoards<T extends BoardListItem>(boards: readonly T[], query: string): T[] {
  const q = searchable(query.trim());
  if (!q) return [...boards];
  return boards.filter((b) => searchable(`${b.title}\n${displayTitle(b.title)}`).includes(q));
}

export type BoardSort = "recent" | "name" | "created";

export const BOARD_SORTS: ReadonlyArray<{ value: BoardSort; label: string }> = [
  { value: "recent", label: "Recently edited" },
  { value: "name", label: "Name" },
  { value: "created", label: "Created" },
];

function time(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

const nameCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * `recent`: last edited first. `created`: newest first. `name`: A to Z with numbers in
 * numeric order ("Board 2" before "Board 10"), unnamed boards last. Ties: last edited first.
 */
export function sortBoards<T extends BoardListItem>(boards: readonly T[], sort: BoardSort): T[] {
  const byEdited = (a: T, b: T) => time(b.updated_at) - time(a.updated_at);
  const list = [...boards];
  switch (sort) {
    case "recent":
      return list.sort((a, b) => byEdited(a, b) || time(b.created_at) - time(a.created_at));
    case "created":
      return list.sort((a, b) => time(b.created_at) - time(a.created_at) || byEdited(a, b));
    case "name":
      return list.sort((a, b) => {
        const au = isDefaultBoardTitle(a.title);
        const bu = isDefaultBoardTitle(b.title);
        if (au !== bu) return au ? 1 : -1;
        return nameCollator.compare(displayTitle(a.title), displayTitle(b.title)) || byEdited(a, b);
      });
  }
}

export type RecencyBucket = "today" | "week" | "earlier";

export const RECENCY_LABELS: Record<RecencyBucket, string> = {
  today: "Today",
  week: "This week",
  earlier: "Earlier",
};

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Today = the student's calendar day (local time); This week = the six days before it;
 * Earlier = anything older. A timestamp in the future (clock skew) counts as today.
 */
export function recencyBucket(iso: string, now: Date): RecencyBucket {
  const t = time(iso);
  if (t >= startOfDay(now)) return "today";
  if (t >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime()) return "week";
  return "earlier";
}

export type BoardGroup<T> = { key: RecencyBucket | "all"; label: string; boards: T[] };

/**
 * Sorted by last edit, the list is split into Today / This week / Earlier (empty groups are
 * left out); any other sort is one unlabelled group. Order within a group is kept.
 */
export function groupBoards<T extends BoardListItem>(sorted: readonly T[], sort: BoardSort, now: Date): BoardGroup<T>[] {
  if (sort !== "recent") return sorted.length ? [{ key: "all", label: "", boards: [...sorted] }] : [];
  const groups: Record<RecencyBucket, T[]> = { today: [], week: [], earlier: [] };
  for (const board of sorted) groups[recencyBucket(board.updated_at, now)].push(board);
  return (["today", "week", "earlier"] as const)
    .filter((key) => groups[key].length > 0)
    .map((key) => ({ key, label: RECENCY_LABELS[key], boards: groups[key] }));
}

const MONTH_DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
const MONTH_DAY_YEAR: Intl.DateTimeFormatOptions = { ...MONTH_DAY, year: "numeric" };

/**
 * "just now", "5 min ago", "2 h ago" (earlier today), "yesterday", "3 days ago" (this
 * week), then "Sep 12" / "Sep 12, 2025". Calendar days in local time, matching the groups.
 * "" for an unparsable timestamp.
 */
export function relativeTime(iso: string, now: Date): string {
  const date = new Date(iso);
  const t = date.getTime();
  if (Number.isNaN(t)) return "";
  const diff = now.getTime() - t;
  if (diff < 60_000) return "just now";
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) {
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 60) return `${minutes} min ago`;
    return `${Math.floor(minutes / 60)} h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString("en-US", date.getFullYear() === now.getFullYear() ? MONTH_DAY : MONTH_DAY_YEAR);
}

/** "Edited 2 h ago" for the card. */
export function editedLabel(iso: string, now: Date): string {
  const rel = relativeTime(iso, now);
  return rel ? `Edited ${rel}` : "";
}

/** "Sep 27, 2026, 11:44 PM": the exact time, for a tooltip. */
export function exactTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", { ...MONTH_DAY_YEAR, hour: "numeric", minute: "2-digit" });
}

/**
 * What the card's thumbnail area shows: the saved image; "empty" for a board that has never
 * been saved (version 1: nothing was ever drawn); "pending" for a board with no image yet
 * (saved before thumbnails always fit, or erased since). The last two show a blank screen.
 */
export function thumbnailStateFor(board: Pick<BoardListItem, "preview" | "version">): "image" | "empty" | "pending" {
  if (board.preview) return "image";
  return (board.version ?? 1) <= 1 ? "empty" : "pending";
}

export function boardCountLabel(n: number): string {
  return `${n} board${n === 1 ? "" : "s"}`;
}
