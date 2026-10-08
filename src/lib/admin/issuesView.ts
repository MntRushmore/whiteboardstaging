/**
 * /admin/issues: what broke, as issues (app_events grouped by fingerprint) to mute, mark fixed or
 * reopen. Regressed ones (marked fixed, then seen again) float to the top of Open. Browser noise
 * (other people's scripts) hides behind a toggle. Pure.
 */
import { ADMIN_API, ADMIN_PAGES, type AdminEvent, type AdminIssue, type IssueStatus } from "./contracts";
import { CONSOLE_COPY, boardHref, exactTime, metaFacts, prettyJson, shortId, sparkline, userHref, type SparkView } from "./consoleView";
import { LEVEL_LABELS, SOURCE_LABELS, formatWhen, kindLabel, plural, relativeTime, type ViewClock } from "./view";

export const ISSUE_WINDOWS = [1, 7, 30] as const;
export type IssueWindow = (typeof ISSUE_WINDOWS)[number];
export const DEFAULT_ISSUE_WINDOW: IssueWindow = 7;

/** The tabs: Open holds the regressed ones too. */
export const ISSUE_TABS = ["open", "muted", "fixed"] as const;
export type IssueTab = (typeof ISSUE_TABS)[number];

export const ISSUE_TAB_LABELS: Record<IssueTab, string> = { open: "Open", muted: "Muted", fixed: "Fixed" };

export const ISSUES_COPY = {
  title: "Issues",
  hint: "Errors grouped into issues: the same problem is one issue however often it happens. Mute what you can't fix; mark fixed what you did, and it comes back as Regressed if it happens again.",
  loadWhat: "the issues",
  windowLabel: "Window",
  windows: { 1: "24 hours", 7: "7 days", 30: "30 days" } satisfies Record<IssueWindow, string>,
  tabsLabel: "Show",
  noise: (n: number) => `Show browser noise (${n})`,
  hideNoise: "Hide browser noise",
  noiseHint: "Errors from browsers' own scripts and extensions, not ours.",
  noiseBadge: "Browser noise",
  regressed: "Regressed",
  regressedHint: (when: string) => `Marked fixed ${when}, then seen again`,
  emptyTitle: (tab: IssueTab) => (tab === "open" ? "Nothing open" : tab === "muted" ? "Nothing muted" : "Nothing fixed yet"),
  emptyHint: (tab: IssueTab, days: string) =>
    tab === "open" ? `No errors in the last ${days}, or every one is muted or fixed.` : tab === "muted" ? "Issues you mute land here." : "Issues you mark fixed land here.",
  samplesToggle: (n: number) => (n === 1 ? "See the latest one" : `See the latest ${n}`),
  hideSamples: "Hide",
  firstSeen: (when: string) => `First ${when}`,
  lastSeen: (when: string) => `Last ${when}`,
  users: (n: number) => (n === 0 ? "no signed-in student" : plural(n, "student")),
  boards: (n: number) => plural(n, "board"),
  count: (n: number) => plural(n, "time"),
  perDay: "Each day",
  mute: "Mute",
  fix: "Mark fixed",
  reopen: "Reopen",
  noteLabel: "Note (optional)",
  notePlaceholder: "Why, or what fixed it",
  marked: (status: IssueStatus) => (status === "muted" ? "Muted" : status === "fixed" ? "Marked fixed" : "Reopened"),
  board: "Board",
  listLabel: (tab: string) => `${tab} issues`,
  release: "Release",
  request: "Request",
  route: "Route",
  meta: "Details",
  topTitle: "Top open issues",
  allIssues: (n: number) => (n === 0 ? "All issues" : `All issues (${n} open)`),
  topEmpty: "No open issues. Nothing new has broken.",
} as const;

export function issuesUrl(days: IssueWindow = DEFAULT_ISSUE_WINDOW): string {
  return `${ADMIN_API.issues}?days=${days}`;
}

/** Which tab an issue sits in: muted; open (or regressed: back in Open); else fixed. */
export function issueTab(issue: Pick<AdminIssue, "status" | "regressed">): IssueTab {
  if (issue.status === "muted") return "muted";
  if (issue.status === "open" || issue.regressed) return "open";
  return "fixed";
}

/** Needs a look: open or regressed, and not browser noise. The nav's count. */
export function needsAttention(issue: AdminIssue): boolean {
  return !issue.noise && issueTab(issue) === "open";
}

export function attentionCounts(issues: readonly AdminIssue[]): { open: number; regressed: number } {
  const open = issues.filter(needsAttention);
  return { open: open.length, regressed: open.filter((i) => i.regressed).length };
}

/** A tab's issues: regressed first, then the most recent. */
export function issuesInTab(issues: readonly AdminIssue[], tab: IssueTab, showNoise: boolean): AdminIssue[] {
  return issues
    .filter((i) => issueTab(i) === tab && (showNoise || !i.noise))
    .sort((a, b) => Number(b.regressed) - Number(a.regressed) || Date.parse(b.lastAt) - Date.parse(a.lastAt) || b.count - a.count);
}

export interface IssueTabView {
  tab: IssueTab;
  label: string;
  count: number;
}

export function issueTabs(issues: readonly AdminIssue[], showNoise: boolean): IssueTabView[] {
  return ISSUE_TABS.map((tab) => ({ tab, label: ISSUE_TAB_LABELS[tab], count: issuesInTab(issues, tab, showNoise).length }));
}

/** How many noise issues the toggle would show in this tab. */
export function noiseCount(issues: readonly AdminIssue[], tab: IssueTab): number {
  return issues.filter((i) => i.noise && issueTab(i) === tab).length;
}

export interface SampleView {
  key: string;
  when: string;
  whenTitle: string;
  who: string;
  whoMissing: boolean;
  userHref: string | null;
  boardHref: string | null;
  boardShort: string | null;
  route: string | null;
  release: string | null;
  requestId: string | null;
  message: string | null;
  facts: { label: string; value: string }[];
  meta: string | null;
}

export function sampleView(e: AdminEvent, clock: ViewClock, issueMessage = ""): SampleView {
  const board = boardHref(e.boardId);
  const message = e.message.trim();
  return {
    key: `${e.id}`,
    when: formatWhen(e.at, clock),
    whenTitle: exactTime(e.at, clock),
    who: e.userEmail ?? (e.userId ? CONSOLE_COPY.noEmail : CONSOLE_COPY.signedOut),
    whoMissing: !e.userEmail,
    userHref: userHref(e.userId),
    boardHref: board,
    boardShort: board && e.boardId ? shortId(e.boardId) : null,
    route: e.route,
    release: e.release,
    requestId: e.requestId,
    // the sample's own words only when they say more than the issue's (digits differ, say)
    message: message && message !== issueMessage.trim() ? message : null,
    facts: metaFacts(e.meta),
    meta: prettyJson(e.meta),
  };
}

export interface IssueView {
  fingerprint: string;
  label: string;
  message: string;
  kind: string;
  code: string | null;
  sourceLabel: string;
  level: AdminIssue["level"];
  levelLabel: string;
  status: IssueStatus;
  tab: IssueTab;
  regressed: boolean;
  /** "Marked fixed Oct 3, then seen again" */
  regressedNote: string | null;
  noise: boolean;
  count: string;
  users: string;
  boards: string;
  firstSeen: string;
  lastSeen: string;
  lastTitle: string;
  spark: SparkView;
  note: string | null;
  samples: SampleView[];
}

export function issueView(issue: AdminIssue, clock: ViewClock): IssueView {
  const fixedWhen = issue.fixedAt ? formatWhen(issue.fixedAt, clock) : null;
  return {
    fingerprint: issue.fingerprint,
    label: kindLabel(issue.kind, issue.code),
    message: issue.message.trim() || "(no message)",
    kind: issue.kind,
    code: issue.code,
    sourceLabel: SOURCE_LABELS[issue.source],
    level: issue.level,
    levelLabel: LEVEL_LABELS[issue.level],
    status: issue.status,
    tab: issueTab(issue),
    regressed: issue.regressed,
    regressedNote: issue.regressed ? ISSUES_COPY.regressedHint(fixedWhen ?? "earlier") : null,
    noise: issue.noise,
    count: ISSUES_COPY.count(issue.count),
    users: ISSUES_COPY.users(issue.users),
    boards: ISSUES_COPY.boards(issue.boards),
    firstSeen: ISSUES_COPY.firstSeen(formatWhen(issue.firstAt, clock)),
    lastSeen: ISSUES_COPY.lastSeen(relativeTime(issue.lastAt, clock.now) ?? formatWhen(issue.lastAt, clock)),
    lastTitle: exactTime(issue.lastAt, clock),
    spark: sparkline(issue.perDay, clock, ["event", "events"]),
    note: issue.note?.trim() || null,
    samples: issue.samples.map((s) => sampleView(s, clock, issue.message)),
  };
}

/**
 * The issue after a PATCH, as the page shows it at once. Fixing stamps `fixedAt` and clears
 * `regressed`; reopening clears `fixedAt`; muting keeps both as they were.
 */
export function applyIssuePatch(issue: AdminIssue, patch: { status: IssueStatus; note?: string | null }, nowIso: string): AdminIssue {
  return {
    ...issue,
    status: patch.status,
    note: patch.note !== undefined ? (patch.note?.trim() ? patch.note.trim() : null) : issue.note,
    fixedAt: patch.status === "fixed" ? nowIso : patch.status === "open" ? null : issue.fixedAt,
    regressed: patch.status === "fixed" || patch.status === "open" ? false : issue.regressed,
  };
}

/** The actions an issue offers in its tab. */
export function issueActions(tab: IssueTab, regressed: boolean): IssueStatus[] {
  if (tab === "open") return regressed ? ["fixed", "muted", "open"] : ["fixed", "muted"];
  return ["open"];
}

export const ISSUE_ACTION_LABELS: Record<IssueStatus, string> = { open: ISSUES_COPY.reopen, muted: ISSUES_COPY.mute, fixed: ISSUES_COPY.fix };

export interface TopIssuesView {
  items: IssueView[];
  open: number;
  link: string;
  linkLabel: string;
}

/** The overview's error section: the top `n` open issues (regressed first, then most frequent). */
export function topIssues(issues: readonly AdminIssue[], clock: ViewClock, n = 5): TopIssuesView {
  const open = issues.filter(needsAttention).sort((a, b) => Number(b.regressed) - Number(a.regressed) || b.count - a.count || Date.parse(b.lastAt) - Date.parse(a.lastAt));
  return { items: open.slice(0, n).map((i) => issueView(i, clock)), open: open.length, link: ADMIN_PAGES.issues, linkLabel: ISSUES_COPY.allIssues(open.length) };
}
