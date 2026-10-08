/**
 * /admin/users/[id]: everything about one account. Who they are and their plan, 30 days of
 * activity, their boards, how their learning goes, what went wrong for them, what they reported,
 * the emails they were sent and their subscription. Pure.
 */
import { latexToPlainText } from "@/lib/boards/boardTitle";
import { skillDef } from "@/lib/learning/contracts";
import type { AdminAttempt, AdminEvent, AdminUserDetail } from "./contracts";
import { boardTileView, type BoardTileView } from "./boardsView";
import { bugView, type BugView } from "./bugsView";
import {
  CONSOLE_COPY,
  PLAN_LABELS,
  PLAN_TONES,
  agoOrNever,
  avatarTone,
  boardHref,
  courseName,
  exactTime,
  formatDay,
  formatMinutes,
  formatMinutesShort,
  initialsOf,
  metaFacts,
  percentOf,
  personName,
  prettyJson,
  shortId,
  trialNote,
  type Tone,
} from "./consoleView";
import { LEVEL_LABELS, formatCount, formatWhen, kindLabel, niceMax, plural, relativeTime, type ViewClock } from "./view";

export const USER_COPY = {
  back: "All users",
  loadWhat: "this account",
  loadingTitle: "Account",
  notFoundTitle: "No such account",
  notFoundHint: "It may have been deleted, or the link is wrong.",
  facts: { signedUp: "Signed up", lastActive: "Last active", onboarded: "Welcome", ink: "Ink", course: "Course", id: "Account id" },
  onboardedYes: (when: string) => `Finished ${when}`,
  onboardedNo: "Not finished",
  activityTitle: "Last 30 days",
  activityHint: "Problems worked and AI calls each day (UTC days).",
  activityLegend: { attempts: "Problems", aiCalls: "AI calls" },
  activityNone: "Nothing in the last 30 days.",
  boardsTitle: "Boards",
  boardsHint: "Newest first. Open one to see it or replay it.",
  boardsEmpty: "No boards yet.",
  board: "Board",
  openBoardFor: (problem: string) => `Open the board for ${problem}`,
  learningTitle: "Learning",
  learningHint: "Every problem the record filed for them.",
  learningEmpty: "No problems worked yet.",
  tiles: { alone: "Solved alone", help: "With help", tutor: "Tutor solved", time: "Time on problems", timeHint: "Active time, all problems" },
  skillsTitle: "By skill",
  skillsColumns: { skill: "Skill", attempts: "Problems", alone: "Alone" },
  recentTitle: "Recent problems",
  hints: (n: number) => plural(n, "hint"),
  eventsTitle: "What went wrong",
  eventsHint: "Their latest errors and warnings, newest first.",
  eventsEmpty: "Nothing went wrong for them.",
  noiseToggle: (n: number) => `Show browser noise (${n})`,
  noiseHide: "Hide browser noise",
  noiseBadge: "Noise",
  bugsTitle: "Bug reports",
  bugsEmpty: "They haven't reported anything.",
  emailsTitle: "Emails",
  emailsEmpty: "No emails sent.",
  notSent: "Claimed, not sent",
  subscriptionTitle: "Subscription",
  subscriptionEmpty: "They've never started a subscription.",
  sub: {
    status: "Stripe status",
    trialEnd: "Trial ends",
    periodEnd: "Period ends",
    cancelAtPeriodEnd: "Cancel at period end",
    cancelAt: "Cancels on",
    payer: "Payer email",
    created: "Started",
  },
  yes: "Yes",
  no: "No",
} as const;

// ------------------------------------------------------------------ the header

export interface FactView {
  key: string;
  label: string;
  value: string;
  title?: string;
  /** shown in mono with a copy button */
  copy?: string;
}

export interface UserHeaderView {
  id: string;
  title: string;
  email: string;
  name: string | null;
  initials: string;
  tone: 1 | 2 | 3 | 4;
  isAdmin: boolean;
  course: string | null;
  planLabel: string;
  planTone: Tone;
  planNote: string | null;
  facts: FactView[];
}

export function userHeaderView(d: AdminUserDetail, clock: ViewClock): UserHeaderView {
  const u = d.user;
  const facts: FactView[] = [
    { key: "signedUp", label: USER_COPY.facts.signedUp, value: formatDay(u.createdAt, clock), title: exactTime(u.createdAt, clock) },
    { key: "lastActive", label: USER_COPY.facts.lastActive, value: agoOrNever(u.lastActiveAt, clock.now), title: exactTime(u.lastActiveAt, clock) },
    {
      key: "onboarded",
      label: USER_COPY.facts.onboarded,
      value: u.onboardedAt ? USER_COPY.onboardedYes(formatDay(u.onboardedAt, clock)) : USER_COPY.onboardedNo,
      title: exactTime(u.onboardedAt, clock),
    },
  ];
  if (d.inkBalance !== null) facts.push({ key: "ink", label: USER_COPY.facts.ink, value: formatCount(d.inkBalance) });
  facts.push({ key: "id", label: USER_COPY.facts.id, value: shortId(u.id), copy: u.id, title: u.id });
  return {
    id: u.id,
    title: personName(u.name, u.email),
    email: u.email?.trim() || CONSOLE_COPY.noEmail,
    name: u.name?.trim() || null,
    initials: initialsOf(u.name, u.email),
    tone: avatarTone(u.id),
    isAdmin: u.isAdmin,
    course: courseName(u.course),
    planLabel: PLAN_LABELS[u.plan],
    planTone: PLAN_TONES[u.plan],
    planNote: trialNote(u.plan, u.trialEndsAt, clock),
    facts,
  };
}

// ------------------------------------------------------------------ 30 days

export interface ActivityBar {
  day: string;
  attempts: number;
  aiCalls: number;
  boards: number;
  attemptsRatio: number;
  aiRatio: number;
  /** a label under the axis, or null */
  axisLabel: string | null;
  isToday: boolean;
  /** "Oct 3: 4 problems, 21 AI calls, 2 boards saved" */
  label: string;
}

export interface ActivityView {
  bars: ActivityBar[];
  top: number;
  summary: string;
  hasData: boolean;
}

/** "Oct 3" for a UTC day key (2026-10-03). */
function utcDayLabel(day: string): string {
  const t = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(t) ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(t)) : day;
}

/**
 * The days as stacked columns: problems on the baseline, AI calls above. The scale is the busiest
 * day's total. Axis labels: the first day, every Monday-ish week mark (each 7th from the end), and
 * "Today" under the last.
 */
export function activityView(activity: AdminUserDetail["activity"]): ActivityView {
  const top = niceMax(activity.reduce((m, d) => Math.max(m, d.attempts + d.aiCalls), 0));
  const last = activity.length - 1;
  const bars = activity.map((d, i): ActivityBar => {
    const label = utcDayLabel(d.day);
    const isToday = i === last;
    const fromEnd = last - i;
    return {
      day: d.day,
      attempts: d.attempts,
      aiCalls: d.aiCalls,
      boards: d.boards,
      attemptsRatio: d.attempts / top,
      aiRatio: d.aiCalls / top,
      axisLabel: isToday ? "Today" : fromEnd % 7 === 0 && fromEnd >= 7 && i >= 2 ? label : null,
      isToday,
      label: `${label}${isToday ? " (today)" : ""}: ${[plural(d.attempts, "problem"), plural(d.aiCalls, "AI call"), plural(d.boards, "board") + " saved"].join(", ")}`,
    };
  });
  const activeDays = activity.filter((d) => d.attempts + d.aiCalls + d.boards > 0).length;
  const attempts = activity.reduce((n, d) => n + d.attempts, 0);
  const ai = activity.reduce((n, d) => n + d.aiCalls, 0);
  const summary =
    activeDays === 0
      ? USER_COPY.activityNone
      : `Active ${formatCount(activeDays)} of the last ${formatCount(activity.length)} days: ${plural(attempts, "problem")}, ${plural(ai, "AI call")}.`;
  return { bars, top, summary, hasData: activeDays > 0 };
}

// ------------------------------------------------------------------ learning

export const OUTCOME_LABELS: Record<AdminAttempt["outcome"], string> = {
  first_try: "Alone, first try",
  self_corrected: "Alone, fixed own slip",
  with_help: "With help",
  tutor_solved: "Tutor solved",
  unfinished: "Unfinished",
  in_progress: "In progress",
};

export const OUTCOME_TONES: Record<AdminAttempt["outcome"], Tone> = {
  first_try: "success",
  self_corrected: "success",
  with_help: "info",
  tutor_solved: "warn",
  unfinished: "muted",
  in_progress: "neutral",
};

export function skillLabel(id: string): string {
  return skillDef(id)?.name ?? id.replace(/_/g, " ");
}

export interface AttemptView {
  id: string;
  /** the problem as readable text (x² − 5x + 6 = 0) */
  problem: string;
  latex: string;
  skill: string;
  outcomeLabel: string;
  outcomeTone: Tone;
  when: string;
  whenTitle: string;
  /** "2 hints · 1 solve · 3 min" */
  detail: string;
  boardHref: string | null;
}

export function attemptView(a: AdminAttempt, clock: ViewClock): AttemptView {
  const plain = latexToPlainText(a.problemLatex);
  const bits = [a.hints > 0 ? USER_COPY.hints(a.hints) : null, a.solves > 0 ? plural(a.solves, "solve") : null, a.linesRinged > 0 ? plural(a.linesRinged, "line ringed", "lines ringed") : null, a.activeMs > 0 ? formatMinutes(a.activeMs / 60_000) : null];
  return {
    id: a.id,
    problem: plain || a.problemLatex.trim() || "(no problem text)",
    latex: a.problemLatex,
    skill: skillLabel(a.skill),
    outcomeLabel: OUTCOME_LABELS[a.outcome],
    outcomeTone: OUTCOME_TONES[a.outcome],
    when: formatWhen(a.startedAt, clock),
    whenTitle: exactTime(a.startedAt, clock),
    detail: bits.filter(Boolean).join(" · "),
    boardHref: boardHref(a.boardId),
  };
}

export interface LearningTile {
  key: string;
  value: string;
  label: string;
  hint: string;
}

export interface LearningView {
  empty: boolean;
  tiles: LearningTile[];
  skills: { skill: string; attempts: string; alone: string; alonePct: number }[];
  recent: AttemptView[];
}

export function learningView(l: AdminUserDetail["learning"], clock: ViewClock): LearningView {
  const pct = (n: number) => percentOf(n, l.attempts) ?? "—";
  return {
    empty: l.attempts === 0 && l.recent.length === 0,
    tiles: [
      { key: "alone", value: formatCount(l.solvedAlone), label: USER_COPY.tiles.alone, hint: `${pct(l.solvedAlone)} of ${plural(l.attempts, "problem")}` },
      { key: "help", value: formatCount(l.withHelp), label: USER_COPY.tiles.help, hint: pct(l.withHelp) },
      { key: "tutor", value: formatCount(l.tutorSolved), label: USER_COPY.tiles.tutor, hint: pct(l.tutorSolved) },
      { key: "time", value: formatMinutesShort(l.activeMinutes), label: USER_COPY.tiles.time, hint: USER_COPY.tiles.timeHint },
    ],
    skills: l.skills.map((s) => ({
      skill: skillLabel(s.skill),
      attempts: formatCount(s.attempts),
      alone: percentOf(s.solvedAlone, s.attempts) ?? "—",
      alonePct: s.attempts > 0 ? Math.min(1, s.solvedAlone / s.attempts) : 0,
    })),
    recent: l.recent.map((a) => attemptView(a, clock)),
  };
}

// ------------------------------------------------------------------ events

export interface EventView {
  id: number;
  when: string;
  ago: string;
  whenTitle: string;
  level: AdminEvent["level"];
  levelLabel: string;
  label: string;
  kind: string;
  code: string | null;
  message: string;
  route: string | null;
  boardHref: string | null;
  boardShort: string | null;
  requestId: string | null;
  release: string | null;
  facts: { label: string; value: string }[];
  meta: string | null;
  noise: boolean;
}

export function eventView(e: AdminEvent, clock: ViewClock): EventView {
  const board = boardHref(e.boardId);
  return {
    id: e.id,
    when: formatWhen(e.at, clock),
    ago: relativeTime(e.at, clock.now) ?? formatWhen(e.at, clock),
    whenTitle: exactTime(e.at, clock),
    level: e.level,
    levelLabel: LEVEL_LABELS[e.level],
    label: kindLabel(e.kind, e.code),
    kind: e.kind,
    code: e.code,
    message: e.message.trim() || "(no message)",
    route: e.route,
    boardHref: board,
    boardShort: board && e.boardId ? shortId(e.boardId) : null,
    requestId: e.requestId,
    release: e.release,
    facts: metaFacts(e.meta),
    meta: prettyJson(e.meta),
    noise: e.noise,
  };
}

export interface EventsView {
  items: EventView[];
  noise: EventView[];
}

/** Newest first; browser noise apart, behind its own toggle. */
export function eventsView(events: readonly AdminEvent[], clock: ViewClock): EventsView {
  const sorted = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id - a.id).map((e) => eventView(e, clock));
  return { items: sorted.filter((e) => !e.noise), noise: sorted.filter((e) => e.noise) };
}

// ------------------------------------------------------------------ emails and subscription

const EMAIL_KIND_LABELS: Record<string, string> = {
  welcome: "Welcome",
  trial_reminder: "Trial ending reminder",
};

export function emailKindLabel(kind: string): string {
  return EMAIL_KIND_LABELS[kind] ?? kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function emailsView(emails: AdminUserDetail["emails"], clock: ViewClock): { key: string; label: string; when: string; title: string; sent: boolean }[] {
  return [...emails]
    .sort((a, b) => (Date.parse(b.sentAt ?? "") || 0) - (Date.parse(a.sentAt ?? "") || 0))
    .map((e, i) => ({
      key: `${e.kind}|${i}`,
      label: emailKindLabel(e.kind),
      when: e.sentAt ? formatWhen(e.sentAt, clock) : USER_COPY.notSent,
      title: exactTime(e.sentAt, clock),
      sent: Boolean(e.sentAt),
    }));
}

/** What Stripe's statuses mean, beside the raw word. */
const STRIPE_STATUS_WORDS: Record<string, string> = {
  trialing: "in the free trial",
  active: "paying",
  past_due: "a charge is failing",
  unpaid: "a charge failed",
  canceled: "cancelled",
  incomplete: "first payment pending",
  incomplete_expired: "never started",
  paused: "paused",
};

export function subscriptionFacts(d: AdminUserDetail, clock: ViewClock): FactView[] | null {
  const s = d.subscription;
  if (!s) return null;
  const when = (iso: string | null) => (iso ? formatWhen(iso, clock) : "—");
  const facts: FactView[] = [
    { key: "status", label: USER_COPY.sub.status, value: STRIPE_STATUS_WORDS[s.status] ? `${s.status} (${STRIPE_STATUS_WORDS[s.status]})` : s.status, copy: s.status },
    { key: "created", label: USER_COPY.sub.created, value: when(s.createdAt), title: exactTime(s.createdAt, clock) },
  ];
  if (s.trialEnd) facts.push({ key: "trialEnd", label: USER_COPY.sub.trialEnd, value: when(s.trialEnd), title: exactTime(s.trialEnd, clock) });
  if (s.currentPeriodEnd) facts.push({ key: "periodEnd", label: USER_COPY.sub.periodEnd, value: when(s.currentPeriodEnd), title: exactTime(s.currentPeriodEnd, clock) });
  facts.push({ key: "cancelAtPeriodEnd", label: USER_COPY.sub.cancelAtPeriodEnd, value: s.cancelAtPeriodEnd ? USER_COPY.yes : USER_COPY.no });
  if (s.cancelAt) facts.push({ key: "cancelAt", label: USER_COPY.sub.cancelAt, value: when(s.cancelAt), title: exactTime(s.cancelAt, clock) });
  if (s.payerEmail) facts.push({ key: "payer", label: USER_COPY.sub.payer, value: s.payerEmail, copy: s.payerEmail });
  return facts;
}

// ------------------------------------------------------------------ the page

export interface UserPageView {
  header: UserHeaderView;
  activity: ActivityView;
  boards: BoardTileView[];
  learning: LearningView;
  events: EventsView;
  bugs: BugView[];
  emails: ReturnType<typeof emailsView>;
  subscription: FactView[] | null;
}

export function buildUserPageView(d: AdminUserDetail, clock: ViewClock): UserPageView {
  return {
    header: userHeaderView(d, clock),
    activity: activityView(d.activity),
    boards: d.boards.map((b) => boardTileView(b, clock)),
    learning: learningView(d.learning, clock),
    events: eventsView(d.events, clock),
    bugs: [...d.bugs].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map((b) => bugView(b, clock)),
    emails: emailsView(d.emails, clock),
    subscription: subscriptionFacts(d, clock),
  };
}
