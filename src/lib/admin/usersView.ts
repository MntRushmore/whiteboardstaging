/**
 * /admin/users: every account, searchable and filtered in the browser (the route sends them all,
 * at most ADMIN_LIMITS.users). Pure: the rows, the filters, the sorts and every word.
 */
import { ADMIN_PAGES, PLAN_STATES, type AdminUserRow, type PlanState } from "./contracts";
import { CONSOLE_COPY, PLAN_LABELS, PLAN_TONES, agoOrNever, avatarTone, courseName, exactTime, formatDay, initialsOf, isLiveNow, percentOf, personName, trialNote, type Tone } from "./consoleView";
import { daysBefore, formatCount, plural, type ViewClock } from "./view";

export const USER_FILTERS = ["active_today", "never_onboarded", "has_errors"] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

export const USER_SORTS = ["last_active", "newest", "most_active"] as const;
export type UserSort = (typeof USER_SORTS)[number];

export const USERS_COPY = {
  title: "Users",
  hint: "Every account, most recently active first. Numbers are the last 7 days.",
  loadWhat: "the users",
  searchLabel: "Search users",
  searchPlaceholder: "Name, email, course or id",
  searchKey: "/",
  plansLabel: "Plan",
  allPlans: "All",
  filtersLabel: "Show only",
  filters: { active_today: "Active today", never_onboarded: "Never onboarded", has_errors: "Has errors" } satisfies Record<UserFilter, string>,
  sortLabel: "Sort by",
  sorts: { last_active: "Last active", newest: "Newest", most_active: "Most active" } satisfies Record<UserSort, string>,
  columns: {
    user: "Account",
    plan: "Plan",
    signedUp: "Signed up",
    lastActive: "Last active",
    boards: "Boards",
    attempts: "Problems",
    aiCalls: "AI calls",
    errors: "Errors",
    bugs: "Bugs",
  },
  caption: "Every account: plan, when they signed up and were last active, boards, and the last 7 days' problems, AI calls, errors and bug reports",
  showing: (shown: number, total: number) => (shown === total ? plural(total, "account") : `${formatCount(shown)} of ${plural(total, "account")}`),
  emptyTitle: "No accounts yet",
  emptyHint: "Accounts show up here as soon as someone signs up.",
  noMatchTitle: "Nobody matches",
  noMatchHint: "Try a shorter search or fewer filters.",
  clear: "Clear search and filters",
  notOnboarded: "Hasn't finished the welcome",
  neverActive: "Never active",
  aloneOf: (pct: string) => `${pct} alone`,
} as const;

export interface UserQuery {
  search: string;
  /** empty: every plan */
  plans: readonly PlanState[];
  filters: readonly UserFilter[];
  sort: UserSort;
}

export const DEFAULT_USER_QUERY: UserQuery = { search: "", plans: [], filters: [], sort: "last_active" };

const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

/** Name, email, course (id or name) or id contain every word of the search, case and accents ignored. */
export function matchesSearch(row: AdminUserRow, search: string): boolean {
  const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const words = fold(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold([row.name, row.email, row.course, courseName(row.course), row.id].filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
}

/** Active today in the viewer's zone. */
export function activeToday(row: AdminUserRow, clock: ViewClock): boolean {
  const t = time(row.lastActiveAt);
  return t > 0 && daysBefore(t, clock) === 0;
}

export function matchesFilter(row: AdminUserRow, filter: UserFilter, clock: ViewClock): boolean {
  if (filter === "active_today") return activeToday(row, clock);
  if (filter === "never_onboarded") return !row.onboardedAt;
  return row.errors7d > 0;
}

/** The week's activity, for "Most active": AI calls plus problems. */
export function activityScore(row: AdminUserRow): number {
  return row.aiCalls7d + row.attempts7d;
}

export function sortUsers(rows: readonly AdminUserRow[], sort: UserSort): AdminUserRow[] {
  const byLastActive = (a: AdminUserRow, b: AdminUserRow) => time(b.lastActiveAt) - time(a.lastActiveAt);
  const byNewest = (a: AdminUserRow, b: AdminUserRow) => time(b.createdAt) - time(a.createdAt);
  const cmp =
    sort === "newest"
      ? (a: AdminUserRow, b: AdminUserRow) => byNewest(a, b) || byLastActive(a, b)
      : sort === "most_active"
        ? (a: AdminUserRow, b: AdminUserRow) => activityScore(b) - activityScore(a) || byLastActive(a, b)
        : (a: AdminUserRow, b: AdminUserRow) => byLastActive(a, b) || byNewest(a, b);
  return [...rows].sort((a, b) => cmp(a, b) || a.id.localeCompare(b.id));
}

/** The rows the query keeps, in its order. Plans are one-of; the other filters all apply. */
export function queryUsers(rows: readonly AdminUserRow[], query: UserQuery, clock: ViewClock): AdminUserRow[] {
  const kept = rows.filter(
    (r) => (query.plans.length === 0 || query.plans.includes(r.plan)) && query.filters.every((f) => matchesFilter(r, f, clock)) && matchesSearch(r, query.search),
  );
  return sortUsers(kept, query.sort);
}

export function isDefaultQuery(q: UserQuery): boolean {
  return !q.search.trim() && q.plans.length === 0 && q.filters.length === 0;
}

export interface ChipView<K extends string> {
  key: K;
  label: string;
  count: string;
  pressed: boolean;
  tone?: Tone;
}

/** One chip per plan anyone is on (in the contract's order), with how many. */
export function planChips(rows: readonly AdminUserRow[], selected: readonly PlanState[]): ChipView<PlanState>[] {
  const counts = new Map<PlanState, number>();
  for (const r of rows) counts.set(r.plan, (counts.get(r.plan) ?? 0) + 1);
  return PLAN_STATES.filter((p) => (counts.get(p) ?? 0) > 0 || selected.includes(p)).map((p) => ({
    key: p,
    label: PLAN_LABELS[p],
    count: formatCount(counts.get(p) ?? 0),
    pressed: selected.includes(p),
    tone: PLAN_TONES[p],
  }));
}

export function filterChips(rows: readonly AdminUserRow[], selected: readonly UserFilter[], clock: ViewClock): ChipView<UserFilter>[] {
  return USER_FILTERS.map((f) => ({
    key: f,
    label: USERS_COPY.filters[f],
    count: formatCount(rows.filter((r) => matchesFilter(r, f, clock)).length),
    pressed: selected.includes(f),
  }));
}

export interface UserRowView {
  id: string;
  href: string;
  name: string;
  email: string;
  /** the name is the email's local part: the email line is still shown */
  hasName: boolean;
  initials: string;
  avatarTone: 1 | 2 | 3 | 4;
  isAdmin: boolean;
  course: string | null;
  onboarded: boolean;
  plan: PlanState;
  planLabel: string;
  planTone: Tone;
  /** "Trial ends tomorrow" */
  planNote: string | null;
  signedUp: string;
  signedUpTitle: string;
  lastActive: string;
  lastActiveTitle: string;
  activeToday: boolean;
  /** active in the last few minutes (ADMIN_LIMITS.liveWindowMin) */
  liveNow: boolean;
  boards: string;
  attempts: string;
  /** "58% alone"; null with no problems */
  alone: string | null;
  aiCalls: string;
  errors: string;
  hasErrors: boolean;
  bugs: string;
  hasBugs: boolean;
  /** the row as one line of facts, for a phone's card: "Active 2 min ago", "7 boards", "18 problems (61% alone)" … */
  facts: { key: string; text: string; bad?: boolean }[];
}

function rowFacts(row: AdminUserRow, lastActive: string, alone: string | null, note: string | null): UserRowView["facts"] {
  const facts: UserRowView["facts"] = [
    { key: "active", text: row.lastActiveAt ? `Active ${lastActive}` : USERS_COPY.neverActive },
    { key: "boards", text: plural(row.boards, "board") },
    { key: "attempts", text: `${plural(row.attempts7d, "problem")}${alone ? ` (${alone})` : ""}` },
    { key: "ai", text: plural(row.aiCalls7d, "AI call") },
  ];
  if (row.errors7d > 0) facts.push({ key: "errors", text: plural(row.errors7d, "error"), bad: true });
  if (row.bugReports > 0) facts.push({ key: "bugs", text: plural(row.bugReports, "bug report"), bad: true });
  if (note) facts.push({ key: "note", text: note });
  if (!row.onboardedAt) facts.push({ key: "welcome", text: USERS_COPY.notOnboarded });
  return facts;
}

export function userRowView(row: AdminUserRow, clock: ViewClock): UserRowView {
  const pct = percentOf(row.solvedAlone7d, row.attempts7d);
  const lastActive = agoOrNever(row.lastActiveAt, clock.now);
  const alone = pct ? USERS_COPY.aloneOf(pct) : null;
  const note = trialNote(row.plan, row.trialEndsAt, clock);
  return {
    id: row.id,
    href: ADMIN_PAGES.user(row.id),
    name: personName(row.name, row.email),
    email: row.email?.trim() || CONSOLE_COPY.noEmail,
    hasName: Boolean(row.name?.trim()),
    initials: initialsOf(row.name, row.email),
    avatarTone: avatarTone(row.id),
    isAdmin: row.isAdmin,
    course: courseName(row.course),
    onboarded: Boolean(row.onboardedAt),
    plan: row.plan,
    planLabel: PLAN_LABELS[row.plan],
    planTone: PLAN_TONES[row.plan],
    planNote: note,
    signedUp: formatDay(row.createdAt, clock),
    signedUpTitle: exactTime(row.createdAt, clock),
    lastActive,
    lastActiveTitle: exactTime(row.lastActiveAt, clock),
    activeToday: activeToday(row, clock),
    liveNow: isLiveNow(row.lastActiveAt, clock.now),
    boards: formatCount(row.boards),
    attempts: formatCount(row.attempts7d),
    alone,
    aiCalls: formatCount(row.aiCalls7d),
    errors: formatCount(row.errors7d),
    hasErrors: row.errors7d > 0,
    bugs: formatCount(row.bugReports),
    hasBugs: row.bugReports > 0,
    facts: rowFacts(row, lastActive, alone, note),
  };
}

export interface UsersView {
  rows: UserRowView[];
  plans: ChipView<PlanState>[];
  filters: ChipView<UserFilter>[];
  /** "12 of 70 accounts" */
  showing: string;
  /** nobody at all */
  empty: boolean;
  /** somebody, but the query keeps nobody */
  noMatch: boolean;
  filtered: boolean;
}

export function buildUsersView(rows: readonly AdminUserRow[], query: UserQuery, clock: ViewClock): UsersView {
  const kept = queryUsers(rows, query, clock);
  return {
    rows: kept.map((r) => userRowView(r, clock)),
    plans: planChips(rows, query.plans),
    filters: filterChips(rows, query.filters, clock),
    showing: USERS_COPY.showing(kept.length, rows.length),
    empty: rows.length === 0,
    noMatch: rows.length > 0 && kept.length === 0,
    filtered: !isDefaultQuery(query),
  };
}

/** Toggles a value in a list (a chip). */
export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
