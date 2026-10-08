/**
 * /admin/boards and the boards on a user's page: who is on a board right now, and every board
 * newest first, each a thumbnail that opens the read-only viewer (ADMIN_PAGES.board). Pure.
 */
import { isDefaultBoardTitle } from "@/lib/boards/boardTitle";
import { ADMIN_API, ADMIN_LIMITS, ADMIN_PAGES, type AdminBoardRow } from "./contracts";
import { CONSOLE_COPY, avatarTone, exactTime, formatKb, initialsOf, isLiveNow, personName } from "./consoleView";
import { formatCount, plural, relativeTime, type ViewClock } from "./view";

export const BOARDS_COPY = {
  title: "Boards",
  hint: "Every board, the most recently saved first. Open one to watch it or replay how it was drawn.",
  loadWhat: "the boards",
  liveTitle: "Live now",
  liveHint: `Boards saved in the last ${ADMIN_LIMITS.liveWindowMin} minutes. Checks every 15 seconds.`,
  liveNobody: "Nobody is on a board right now.",
  liveHeadline: (boards: number, people: number) =>
    boards === 0 ? "Nobody on a board right now" : people === boards ? `${plural(people, "student")} on a board right now` : `${plural(people, "student")} on ${plural(boards, "board")} right now`,
  liveFailed: "Couldn't check who's on a board.",
  liveChecking: "Checking who's on a board…",
  liveListLabel: "On a board now",
  recentTitle: "All boards",
  loadMore: "Load more",
  loadingMore: "Loading…",
  loadMoreFailed: "Couldn't load more boards.",
  end: (n: number) => `That's all ${plural(n, "board")}.`,
  emptyTitle: "No boards yet",
  emptyHint: "Boards show up here as soon as a student saves one.",
  noPreview: "No picture yet",
  open: (title: string) => `Open ${title} in the viewer`,
  errors: (n: number) => plural(n, "error"),
  problems: (n: number) => plural(n, "problem"),
} as const;

/** The boards route with its query: `?live=1`, `?userId=`, `?before=` (the next page). */
export function boardsUrl(q: { live?: boolean; userId?: string; before?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (q.live) params.set("live", "1");
  if (q.userId) params.set("userId", q.userId);
  if (q.before) params.set("before", q.before);
  const s = params.toString();
  return s ? `${ADMIN_API.boards}?${s}` : ADMIN_API.boards;
}

export interface BoardTileView {
  id: string;
  href: string;
  title: string;
  untitled: boolean;
  /** the board's picture (a data URL), or null */
  preview: string | null;
  ownerName: string;
  ownerHref: string;
  ownerInitials: string;
  ownerTone: 1 | 2 | 3 | 4;
  /** "4 min ago" */
  updated: string;
  updatedTitle: string;
  live: boolean;
  /** "3 problems"; null with none */
  attempts: string | null;
  /** "2 errors"; null with none */
  errors: string | null;
  size: string;
  /** "Open Quadratics in the viewer" */
  label: string;
}

/** A preview the page may show: an inline image only (never a URL that would load from elsewhere). */
export function safePreview(preview: string | null): string | null {
  return preview && /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/i.test(preview) ? preview : null;
}

export function boardTileView(b: AdminBoardRow, clock: ViewClock): BoardTileView {
  const title = isDefaultBoardTitle(b.title) ? CONSOLE_COPY.untitled : b.title!.trim();
  return {
    id: b.id,
    href: ADMIN_PAGES.board(b.id),
    title,
    untitled: title === CONSOLE_COPY.untitled,
    preview: safePreview(b.preview),
    ownerName: personName(b.ownerName, b.ownerEmail),
    ownerHref: ADMIN_PAGES.user(b.userId),
    ownerInitials: initialsOf(b.ownerName, b.ownerEmail),
    ownerTone: avatarTone(b.userId),
    updated: relativeTime(b.updatedAt, clock.now) ?? exactTime(b.updatedAt, clock),
    updatedTitle: exactTime(b.updatedAt, clock),
    live: isLiveNow(b.updatedAt, clock.now),
    attempts: b.attempts > 0 ? BOARDS_COPY.problems(b.attempts) : null,
    errors: b.errors7d > 0 ? BOARDS_COPY.errors(b.errors7d) : null,
    size: formatKb(b.sizeKb),
    label: BOARDS_COPY.open(title),
  };
}

export interface LivePersonView {
  id: string;
  href: string;
  name: string;
  initials: string;
  tone: 1 | 2 | 3 | 4;
  /** the board they saved last */
  boardHref: string;
  boardTitle: string;
}

export interface LiveNowView {
  headline: string;
  boards: BoardTileView[];
  people: LivePersonView[];
  count: number;
}

/** Who is on a board right now: each person once (their latest board), and every live board. */
export function liveNowView(boards: readonly AdminBoardRow[], clock: ViewClock): LiveNowView {
  const sorted = [...boards].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const tiles = sorted.map((b) => boardTileView(b, clock));
  const people = new Map<string, LivePersonView>();
  for (const b of sorted) {
    if (people.has(b.userId)) continue;
    const tile = tiles.find((t) => t.id === b.id)!;
    people.set(b.userId, {
      id: b.userId,
      href: ADMIN_PAGES.user(b.userId),
      name: tile.ownerName,
      initials: tile.ownerInitials,
      tone: tile.ownerTone,
      boardHref: tile.href,
      boardTitle: tile.title,
    });
  }
  return { headline: BOARDS_COPY.liveHeadline(tiles.length, people.size), boards: tiles, people: [...people.values()], count: people.size };
}

/** Pages joined in order, each board once (a board saved between two reads can appear in both). */
export function mergeBoardPages(pages: readonly (readonly AdminBoardRow[])[]): AdminBoardRow[] {
  const seen = new Set<string>();
  const out: AdminBoardRow[] = [];
  for (const page of pages) {
    for (const b of page) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      out.push(b);
    }
  }
  return out;
}

/** "48 boards" under the gallery. */
export function boardCountLine(n: number, more: boolean): string {
  return more ? `${formatCount(n)} shown` : BOARDS_COPY.end(n);
}
