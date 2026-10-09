/**
 * /reports, the reporter's page (src/components/reports/ReportsScreen.tsx): what it says, as pure
 * functions over my_bug_reports() rows (src/lib/bugReports/contracts.ts). A student of any age reads
 * it, or their grown-up: plain words, short sentences, the status as a person would say it.
 */
import type { BugMessage, BugMessageAuthor, MyBugReport, ReportStatus } from "./contracts";

export const REPORTS_COPY = {
  title: "Your bug reports",
  subtitle: "What you sent with Report a bug, and what we wrote back. You can answer here.",
  back: "Back to your boards",
  loading: "Loading your reports",
  loadFailedTitle: "Couldn't load your reports",
  loadFailed: "Check your connection and try again.",
  retry: "Try again",
  emptyTitle: "No bug reports yet",
  emptyHint: "If something goes wrong, tap Report a bug at the top of the page. When we answer, you'll find it here.",
  noMessage: "You sent this one without a message.",
  you: "You",
  us: "Agathon",
  newMark: (n: number) => (n === 1 ? "1 new reply" : `${n} new replies`),
  newOne: "New",
  noReplyYet: "No reply yet. We read every report.",
  waitingForUs: "We'll read this and write back here.",
  replyLabel: "Write back",
  replyPlaceholder: "Tell us more, or answer our question.",
  send: "Send",
  sending: "Sending…",
  sendKeys: "Ctrl or ⌘ + Enter sends",
  sendFailed: (why: string) => `That didn't send. ${why}`,
  sent: "Sent. We'll read it soon.",
  notHereTitle: "That report isn't on this profile",
  notHere: "If someone in your family sent it, switch to their profile to read it and write back.",
  switchProfile: "Switch profile",
  /** the Report a bug dialog's link and the account page's */
  link: "Your reports",
  linkUnread: (n: number) => (n === 1 ? "Your reports (1 new reply)" : `Your reports (${n} new replies)`),
  accountTitle: "Your bug reports",
  accountHint: "What you sent with Report a bug, and our replies.",
} as const;

/** A status as the reporter reads it: a word or two, and one sentence. */
export const REPORT_STATUS_WORDS: Record<ReportStatus, { label: string; hint: string; tone: "neutral" | "info" | "success" }> = {
  new: { label: "Got it", hint: "We have your report.", tone: "neutral" },
  seen: { label: "Looking into it", hint: "Someone on our team has read it.", tone: "info" },
  fixed: { label: "Fixed", hint: "We fixed this. Thanks for telling us.", tone: "success" },
  wontfix: { label: "Closed", hint: "We looked into it, and we won't be changing this one.", tone: "neutral" },
};

/** The page's clock: now, and the zone to write times in (the browser's own when unset). */
export interface ReportsClock {
  now: number;
  timeZone?: string;
}

const dayKey = (t: number, timeZone?: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));

/** "today at 3:04 PM", "yesterday at 9:15 AM", "Oct 6 at 3:04 PM", "Dec 30, 2025 at 3:04 PM". */
export function formatReportTime(iso: string, clock: ReportsClock): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const time = new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(t));
  const day = dayKey(t, clock.timeZone);
  if (day === dayKey(clock.now, clock.timeZone)) return `today at ${time}`;
  if (day === dayKey(clock.now - 86_400_000, clock.timeZone)) return `yesterday at ${time}`;
  const sameYear = day.slice(0, 4) === dayKey(clock.now, clock.timeZone).slice(0, 4);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: clock.timeZone, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(new Date(t));
  return `${date} at ${time}`;
}

export interface ReportMessageView {
  id: string;
  author: BugMessageAuthor;
  /** "You" or "Agathon" */
  who: string;
  body: string;
  when: string;
  /** a reply of ours they had not opened before this visit */
  isNew: boolean;
}

export interface ReportView {
  id: string;
  /** "Sent today at 3:04 PM" */
  sent: string;
  status: { label: string; hint: string; tone: "neutral" | "info" | "success" };
  message: string;
  messageMissing: boolean;
  thread: ReportMessageView[];
  /** replies of ours not opened before this visit */
  unread: number;
  /** under the thread: no reply yet, or that we will answer theirs; nothing once we answered last */
  footnote: string | null;
}

/** An admin message they had not opened: after seen_at (or ever, with none). */
function unreadAt(m: BugMessage, seenAt: string | null): boolean {
  if (m.author !== "admin") return false;
  if (!seenAt) return true;
  return Date.parse(m.at) > Date.parse(seenAt);
}

export function reportView(report: MyBugReport, clock: ReportsClock): ReportView {
  const message = report.message.trim();
  const thread = report.thread.map((m) => ({
    id: m.id,
    author: m.author,
    who: m.author === "admin" ? REPORTS_COPY.us : REPORTS_COPY.you,
    body: m.body,
    when: formatReportTime(m.at, clock),
    isNew: unreadAt(m, report.seen_at),
  }));
  const last = report.thread.at(-1);
  return {
    id: report.id,
    sent: `Sent ${formatReportTime(report.created_at, clock)}`,
    status: REPORT_STATUS_WORDS[report.status],
    message: message || REPORTS_COPY.noMessage,
    messageMissing: !message,
    thread,
    unread: thread.filter((m) => m.isNew).length,
    footnote: !last ? REPORTS_COPY.noReplyYet : last.author === "reporter" ? REPORTS_COPY.waitingForUs : null,
  };
}

/** Replies of ours not yet opened, over every report: the header's dot, and whether to mark them read. */
export function totalUnread(reports: readonly MyBugReport[]): number {
  return reports.reduce((n, r) => n + r.unread, 0);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The report the address points at (`#<id>`, from the reply email or the dialog), and whether this profile has it; null for none. */
export function reportTarget(hash: string, reports: readonly MyBugReport[] | null): { id: string; found: boolean } | null {
  const id = decodeURIComponent(hash.replace(/^#/, "")).trim();
  if (!UUID.test(id)) return null;
  return { id, found: Boolean(reports?.some((r) => r.id.toLowerCase() === id.toLowerCase())) };
}

/** Their reply, added to its report: last in the thread, everything before it read (bug_report_reply() marks it so). */
export function withReply(reports: readonly MyBugReport[], reportId: string, message: BugMessage): MyBugReport[] {
  return reports.map((r) => (r.id === reportId ? { ...r, thread: [...r.thread.filter((m) => m.id !== message.id), message], seen_at: message.at, unread: 0 } : r));
}
