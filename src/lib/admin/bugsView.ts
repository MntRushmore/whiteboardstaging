/**
 * /admin/bugs: the bug report inbox. New, Seen, Fixed and Won't fix; each report's words, who sent
 * it from what device, its board, screenshot and logs; and the keys that triage it. Pure.
 */
import { ADMIN_API, ADMIN_PAGES, BUG_STATUSES, type AdminBug, type BugStatus } from "./contracts";
import { CONSOLE_COPY, boardHref, clockWithSeconds, deviceView, exactTime, personName, userHref, type DeviceView, type Tone } from "./consoleView";
import { formatCount, formatWhen, relativeTime, type ViewClock } from "./view";

export const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  new: "New",
  seen: "Seen",
  fixed: "Fixed",
  wontfix: "Won't fix",
};

export const BUG_STATUS_TONES: Record<BugStatus, Tone> = {
  new: "info",
  seen: "neutral",
  fixed: "success",
  wontfix: "muted",
};

export const BUGS_COPY = {
  title: "Bug reports",
  hint: "What students and parents sent from Report a bug, newest first. Opening one doesn't mark it: you do.",
  loadWhat: "the bug reports",
  tabsLabel: "Show",
  listLabel: (tab: string) => `${tab} bug reports`,
  emptyTitle: (status: BugStatus) =>
    status === "new" ? "Inbox zero" : status === "seen" ? "Nothing waiting" : status === "fixed" ? "Nothing fixed yet" : "Nothing set aside",
  emptyHint: (status: BugStatus) =>
    status === "new"
      ? "No new bug reports. Nice."
      : status === "seen"
        ? "Reports you've looked at but not closed land here."
        : status === "fixed"
          ? "Reports you mark fixed land here."
          : "Reports you decide not to fix land here.",
  noneYetTitle: "No bug reports yet",
  noneYetHint: "When someone uses Report a bug, it lands here.",
  pick: "Pick a report to read it.",
  back: "All reports",
  from: "From",
  sent: "Sent",
  device: "Device",
  page: "Page",
  board: "Board",
  openBoard: "Open board",
  openUser: "Open their page",
  screenshot: "Screenshot",
  screenshotAlt: (who: string) => `The screen ${who} saw when they reported it`,
  screenshotLoading: "Loading the screenshot…",
  screenshotFailed: "Couldn't load the screenshot.",
  screenshotOpen: "Open full size",
  noScreenshot: "No screenshot with this one.",
  logs: (n: number) => (n === 0 ? "Logs" : `Logs (${formatCount(n)})`),
  logsHint: "Their browser's last lines before they sent it, oldest first. Browser noise removed.",
  noLogs: "No logs came with this one.",
  noteLabel: "Note",
  notePlaceholder: "What you found, or what you did (only admins see it)",
  saveNote: "Save note",
  cancelNote: "Cancel",
  actions: "Set status",
  markSeen: "Mark seen",
  markFixed: "Fixed",
  markWontfix: "Won't fix",
  markNew: "Back to new",
  marked: (status: BugStatus) =>
    status === "new" ? "Moved back to new" : status === "seen" ? "Marked seen" : status === "fixed" ? "Marked fixed" : "Marked won't fix",
  resolved: (status: BugStatus, when: string) => (status === "fixed" ? `Fixed ${when}` : status === "wontfix" ? `Set aside ${when}` : null),
  keys: "j / k to move · s seen · f fixed · w won't fix",
  newestNew: "Newest new reports",
  openInbox: (n: number) => (n === 0 ? "Open the inbox" : `Open the inbox (${formatCount(n)} new)`),
  noneNew: "No new bug reports.",
  noMessage: "(no message)",
} as const;

export function bugCounts(bugs: readonly AdminBug[]): Record<BugStatus, number> {
  const counts: Record<BugStatus, number> = { new: 0, seen: 0, fixed: 0, wontfix: 0 };
  for (const b of bugs) counts[b.status] += 1;
  return counts;
}

/** A tab's reports, newest first. */
export function bugsInTab(bugs: readonly AdminBug[], status: BugStatus): AdminBug[] {
  return bugs.filter((b) => b.status === status).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export interface BugTabView {
  status: BugStatus;
  label: string;
  count: string;
}

export function bugTabs(bugs: readonly AdminBug[]): BugTabView[] {
  const counts = bugCounts(bugs);
  return BUG_STATUSES.map((s) => ({ status: s, label: BUG_STATUS_LABELS[s], count: formatCount(counts[s]) }));
}

export interface LogLineView {
  key: string;
  level: "error" | "warn" | "info" | "debug";
  levelLabel: string;
  time: string;
  text: string;
}

function logLevel(level: string): LogLineView["level"] {
  const l = level.toLowerCase();
  if (l === "error" || l === "fatal") return "error";
  if (l === "warn" || l === "warning") return "warn";
  if (l === "debug" || l === "trace") return "debug";
  return "info";
}

export interface BugView {
  id: string;
  status: BugStatus;
  statusLabel: string;
  statusTone: Tone;
  message: string;
  messageMissing: boolean;
  /** the first line, cut to fit a list row */
  excerpt: string;
  who: string;
  whoMissing: boolean;
  userHref: string | null;
  when: string;
  ago: string;
  whenTitle: string;
  path: string | null;
  boardHref: string | null;
  device: DeviceView;
  hasScreenshot: boolean;
  screenshotUrl: string | null;
  logs: LogLineView[];
  note: string;
  /** "Fixed Oct 3" */
  resolved: string | null;
}

/** The message's first line, at most `max` characters. */
export function excerptOf(message: string, max = 140): string {
  const first = message.trim().split(/\r?\n/).find((l) => l.trim()) ?? "";
  const line = first.trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** The board a report came from: its own board id, or the board in its page's path. */
export function bugBoardId(bug: Pick<AdminBug, "boardId" | "path">): string | null {
  if (bug.boardId) return bug.boardId;
  const m = /\/board\/([0-9a-f-]{36})/i.exec(bug.path ?? "");
  return m ? m[1] : null;
}

export function bugView(bug: AdminBug, clock: ViewClock): BugView {
  const message = bug.message.trim();
  const resolvedWhen = bug.resolvedAt ? formatWhen(bug.resolvedAt, clock) : null;
  const who = bug.email?.trim() || (bug.userId ? CONSOLE_COPY.noEmail : CONSOLE_COPY.signedOut);
  return {
    id: bug.id,
    status: bug.status,
    statusLabel: BUG_STATUS_LABELS[bug.status],
    statusTone: BUG_STATUS_TONES[bug.status],
    message: message || BUGS_COPY.noMessage,
    messageMissing: !message,
    excerpt: excerptOf(message) || BUGS_COPY.noMessage,
    who,
    whoMissing: !bug.email?.trim(),
    userHref: userHref(bug.userId),
    when: formatWhen(bug.at, clock),
    ago: relativeTime(bug.at, clock.now) ?? formatWhen(bug.at, clock),
    whenTitle: exactTime(bug.at, clock),
    path: bug.path,
    boardHref: boardHref(bugBoardId(bug)),
    device: deviceView(bug.diagnostics),
    hasScreenshot: bug.hasScreenshot,
    screenshotUrl: bug.hasScreenshot ? ADMIN_API.bugScreenshot(bug.id) : null,
    logs: bug.logs.map((l, i) => ({ key: `${i}`, level: logLevel(l.level), levelLabel: l.level.toUpperCase().slice(0, 5), time: clockWithSeconds(l.time, clock.timeZone), text: l.text })),
    note: bug.note ?? "",
    resolved: resolvedWhen ? BUGS_COPY.resolved(bug.status, resolvedWhen) : null,
  };
}

/**
 * The report after a PATCH, as the page shows it at once (then the server's answer, or the old one
 * back on failure). Fixed and Won't fix stamp `resolvedAt` (kept if already set); New and Seen
 * clear it.
 */
export function applyBugPatch(bug: AdminBug, patch: { status?: BugStatus; note?: string | null }, nowIso: string): AdminBug {
  const status = patch.status ?? bug.status;
  const closed = status === "fixed" || status === "wontfix";
  return {
    ...bug,
    status,
    note: patch.note !== undefined ? (patch.note?.trim() ? patch.note.trim() : null) : bug.note,
    resolvedAt: closed ? (bug.status === status && bug.resolvedAt ? bug.resolvedAt : nowIso) : null,
  };
}

export type BugKeyAction = { kind: "move"; by: 1 | -1 } | { kind: "status"; status: BugStatus };

/** j / k move, s / f / w set Seen, Fixed, Won't fix. Anything else is not ours. */
export function bugKeyAction(key: string): BugKeyAction | null {
  switch (key) {
    case "j":
      return { kind: "move", by: 1 };
    case "k":
      return { kind: "move", by: -1 };
    case "s":
      return { kind: "status", status: "seen" };
    case "f":
      return { kind: "status", status: "fixed" };
    case "w":
      return { kind: "status", status: "wontfix" };
    default:
      return null;
  }
}

/** The report to select after moving: held at the ends. */
export function moveSelection(ids: readonly string[], current: string | null, by: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const i = current ? ids.indexOf(current) : -1;
  if (i < 0) return ids[by === 1 ? 0 : ids.length - 1];
  return ids[Math.min(ids.length - 1, Math.max(0, i + by))];
}

/**
 * Who to select once a report leaves the tab (its status changed): the next one down, else the one
 * above, else nobody.
 */
export function selectionAfterLeaving(ids: readonly string[], leaving: string): string | null {
  const i = ids.indexOf(leaving);
  if (i < 0) return ids[0] ?? null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}

export interface NewBugsPreview {
  items: BugView[];
  newCount: number;
  link: string;
  linkLabel: string;
}

/** The overview's bug section: the newest `n` new reports and the way to the inbox. */
export function newBugsPreview(bugs: readonly AdminBug[], clock: ViewClock, n = 3): NewBugsPreview {
  const fresh = bugsInTab(bugs, "new");
  return { items: fresh.slice(0, n).map((b) => bugView(b, clock)), newCount: fresh.length, link: ADMIN_PAGES.bugs, linkLabel: BUGS_COPY.openInbox(fresh.length) };
}

/** A report's own address in the inbox. */
export function bugHref(id: string, status?: BugStatus): string {
  const params = new URLSearchParams({ id });
  if (status) params.set("tab", status);
  return `${ADMIN_PAGES.bugs}?${params.toString()}`;
}

/** Who sent it, for a list row: the name part of the email. */
export function bugSender(bug: AdminBug): string {
  return bug.email ? personName(null, bug.email) : bug.userId ? CONSOLE_COPY.noEmail : CONSOLE_COPY.signedOut;
}

