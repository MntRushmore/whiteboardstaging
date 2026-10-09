/**
 * Who uses Agathon: every account (`AdminUserList`, most recently active first) and one account's
 * page (`AdminUserDetail`).
 *
 * The list is one round of reads whatever the tables hold: profiles, the auth admin API's accounts
 * (email, sign-up, last sign-in), admin_user_stats() (per account: boards, attempts and AI calls this
 * week, the latest of each, bug reports; 20261008000000_admin_console.sql), errors this week (noise
 * left out), every Unlimited subscription (the newest per account is its plan) and the admins. It is
 * not logged: it shows no student content beyond a name and an email.
 *
 * A user's page adds their boards (with thumbnails), learning record, activity per day, events, bug
 * reports, emails sent and subscription; it is logged as `user.view` before it is answered.
 */
import {
  ADMIN_LIMITS,
  type AdminUserDetail,
  type AdminUserList,
  type AdminUserRow,
  type PlanState,
} from "@/lib/admin/contracts";
import { ATTEMPT_SELECT, solvedAlone, toAdminAttempt, type AttemptRow } from "./attempts";
import { auditLook } from "./audit";
import { boardRowsOf, BOARD_SELECT, USER_BOARDS, type BoardViewRow } from "./boards";
import { bugsWhere } from "./bugs";
import { DAY_MS, errorCounts, latestEvents, toAdminEvent } from "./events";
import { ROW_CAP, restClient, type AuthUser, type ConsoleDeps, type Rest } from "./rest";

/** The user page's events and emails, at most. */
export const USER_EVENTS = 100;
export const USER_EMAILS = 100;
/** The latest attempts listed on a user's page. */
export const RECENT_ATTEMPTS = 50;
/** Days of activity on a user's page (UTC days, today the last). */
export const ACTIVITY_DAYS = 30;

export interface ProfileRow {
  user_id: string;
  display_name: string | null;
  course: string | null;
  created_at: string | null;
  onboarded_at: string | null;
  ink_balance?: number | null;
}

/** One admin_user_stats() row. */
export interface StatsRow {
  user_id: string;
  boards: number | null;
  last_board_at: string | null;
  attempts: number | null;
  solved_alone: number | null;
  last_attempt_at: string | null;
  ai_calls: number | null;
  last_ai_at: string | null;
  bug_reports: number | null;
}

export interface SubscriptionRow {
  user_id: string | null;
  status: string | null;
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  cancel_at: string | null;
  payer_email: string | null;
  created_at: string;
}

const SUB_SELECT = "user_id,status,trial_end,current_period_end,cancel_at_period_end,cancel_at,payer_email,created_at";
const PROFILE_SELECT = "user_id,display_name,course,created_at,onboarded_at";

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** The latest of these times (ISO), or null with none. */
export function latestIso(...isos: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const iso of isos) if (iso && Number.isFinite(time(iso)) && (best === null || time(iso) > time(best))) best = iso;
  return best;
}

/**
 * Where an account stands with Agathon Unlimited, from its newest subscription (Stripe's status):
 * trialing (set to cancel: trial_cancelling), active (set to cancel: cancelling), a charge failing
 * (past_due, unpaid, paused, and incomplete: a first payment not made), over (canceled,
 * incomplete_expired), none without a subscription (or one whose first event is not in yet).
 * "Set to cancel" is cancel_at_period_end or a cancel_at, as the overview's money reads it.
 */
export function planState(sub: SubscriptionRow | null | undefined): { plan: PlanState; trialEndsAt: string | null } {
  if (!sub || !sub.status) return { plan: "none", trialEndsAt: null };
  const cancelling = sub.cancel_at_period_end === true || sub.cancel_at !== null;
  switch (sub.status) {
    case "trialing":
      return { plan: cancelling ? "trial_cancelling" : "trialing", trialEndsAt: sub.trial_end ?? null };
    case "active":
      return { plan: cancelling ? "cancelling" : "active", trialEndsAt: null };
    case "past_due":
    case "unpaid":
    case "paused":
    case "incomplete":
      return { plan: "failing", trialEndsAt: null };
    case "canceled":
    case "incomplete_expired":
      return { plan: "ended", trialEndsAt: null };
    default:
      return { plan: "none", trialEndsAt: null };
  }
}

/** Each account's newest subscription, from rows newest first. */
export function newestSubscriptions(rowsNewestFirst: readonly SubscriptionRow[]): Map<string, SubscriptionRow> {
  const out = new Map<string, SubscriptionRow>();
  for (const s of rowsNewestFirst) if (s.user_id && !out.has(s.user_id)) out.set(s.user_id, s);
  return out;
}

export interface UserParts {
  id: string;
  profile?: ProfileRow | null;
  auth?: AuthUser | null;
  stats?: StatsRow | null;
  sub?: SubscriptionRow | null;
  errors7d: number;
  isAdmin: boolean;
}

/** One account's row, pure. */
export function userRow(p: UserParts): AdminUserRow {
  const s = p.stats;
  const { plan, trialEndsAt } = planState(p.sub);
  return {
    id: p.id,
    email: p.auth?.email ?? null,
    name: p.profile?.display_name ?? null,
    course: p.profile?.course ?? null,
    createdAt: p.auth?.createdAt ?? p.profile?.created_at ?? new Date(0).toISOString(),
    onboardedAt: p.profile?.onboarded_at ?? null,
    lastActiveAt: latestIso(s?.last_board_at, s?.last_ai_at, s?.last_attempt_at, p.auth?.lastSignInAt),
    plan,
    trialEndsAt,
    boards: Number(s?.boards) || 0,
    attempts7d: Number(s?.attempts) || 0,
    solvedAlone7d: Number(s?.solved_alone) || 0,
    aiCalls7d: Number(s?.ai_calls) || 0,
    errors7d: p.errors7d,
    bugReports: Number(s?.bug_reports) || 0,
    isAdmin: p.isAdmin,
  };
}

/** Most recently active first (never active last), then newest account first. */
export function byActivity(a: AdminUserRow, b: AdminUserRow): number {
  const ta = time(a.lastActiveAt);
  const tb = time(b.lastActiveAt);
  if (Number.isFinite(ta) !== Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : 1;
  if (Number.isFinite(ta) && ta !== tb) return tb - ta;
  return time(b.createdAt) - time(a.createdAt) || a.id.localeCompare(b.id);
}

/** admin_user_stats() since `sinceIso`: every account (page by page), or one. */
async function stats(rest: Rest, sinceIso: string, userId?: string): Promise<StatsRow[]> {
  const params: Record<string, string> = { p_since: sinceIso, order: "user_id.asc", ...(userId ? { p_user: userId } : {}) };
  if (userId) return rest.rows<StatsRow>({ table: "rpc/admin_user_stats", params });
  return (await rest.paged<StatsRow>({ table: "rpc/admin_user_stats", params }, ADMIN_LIMITS.users)).rows;
}

export async function buildUserList(deps: ConsoleDeps): Promise<AdminUserList> {
  const rest = restClient(deps);
  const since7d = new Date(rest.now - 7 * DAY_MS).toISOString();
  const [profiles, profileCount, auth, statRows, errors, subs, admins] = await Promise.all([
    rest.paged<ProfileRow>({ table: "profiles", params: { select: PROFILE_SELECT, order: "created_at.desc" } }, ADMIN_LIMITS.users),
    rest.count({ table: "profiles", params: { select: "user_id" } }),
    rest.authUsers(),
    stats(rest, since7d),
    errorCounts(rest, "user_id", since7d),
    rest.paged<SubscriptionRow>({ table: "unlimited_subscriptions", params: { select: SUB_SELECT, user_id: "not.is.null", order: "created_at.desc" } }, ROW_CAP),
    rest.rows<{ user_id: string }>({ table: "admins", params: { select: "user_id" } }),
  ]);
  const profileBy = new Map(profiles.rows.map((p) => [p.user_id, p]));
  const statsBy = new Map(statRows.map((s) => [s.user_id, s]));
  const subBy = newestSubscriptions(subs.rows);
  const adminIds = new Set(admins.map((a) => a.user_id));
  const ids = new Set<string>([...profileBy.keys(), ...auth.keys()]);
  const users = [...ids]
    .map((id) => userRow({ id, profile: profileBy.get(id), auth: auth.get(id), stats: statsBy.get(id), sub: subBy.get(id), errors7d: errors.counts.get(id) ?? 0, isAdmin: adminIds.has(id) }))
    .sort(byActivity)
    .slice(0, ADMIN_LIMITS.users);
  return { generatedAt: new Date(rest.now).toISOString(), total: Math.max(profileCount, auth.size, ids.size), users };
}

/** The first moment of the UTC day `t` falls in. */
export function utcDay(t: number): number {
  return Math.floor(t / DAY_MS) * DAY_MS;
}

/** ACTIVITY_DAYS UTC days, oldest first, today the last, every day present. */
export function activityDays(rows: ReadonlyArray<{ day: string; attempts: number | null; ai_calls: number | null; boards: number | null }>, now: number): AdminUserDetail["activity"] {
  const first = utcDay(now) - (ACTIVITY_DAYS - 1) * DAY_MS;
  const by = new Map(rows.map((r) => [String(r.day).slice(0, 10), r]));
  return Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
    const day = new Date(first + i * DAY_MS).toISOString().slice(0, 10);
    const r = by.get(day);
    return { day, attempts: Number(r?.attempts) || 0, aiCalls: Number(r?.ai_calls) || 0, boards: Number(r?.boards) || 0 };
  });
}

/** The learning section from the user's attempts (newest first); `exact` replaces the counts when the rows stopped at the cap. */
export function learningOf(rows: readonly AttemptRow[], exact?: { attempts: number; solvedAlone: number; withHelp: number; tutorSolved: number }): AdminUserDetail["learning"] {
  const skills = new Map<string, { skill: string; attempts: number; solvedAlone: number }>();
  let activeMs = 0;
  for (const r of rows) {
    activeMs += Number(r.active_ms) || 0;
    const key = r.skill ?? "";
    const s = skills.get(key) ?? { skill: key, attempts: 0, solvedAlone: 0 };
    s.attempts += 1;
    if (solvedAlone(r.outcome)) s.solvedAlone += 1;
    skills.set(key, s);
  }
  return {
    attempts: exact?.attempts ?? rows.length,
    solvedAlone: exact?.solvedAlone ?? rows.filter((r) => solvedAlone(r.outcome)).length,
    withHelp: exact?.withHelp ?? rows.filter((r) => r.outcome === "with_help").length,
    tutorSolved: exact?.tutorSolved ?? rows.filter((r) => r.outcome === "tutor_solved").length,
    activeMinutes: Math.round(activeMs / 60_000),
    skills: [...skills.values()].sort((a, b) => b.attempts - a.attempts || a.skill.localeCompare(b.skill)),
    recent: rows.slice(0, RECENT_ATTEMPTS).map(toAdminAttempt),
  };
}

/** One account's page, or null when there is no such account. Logged as `user.view`. */
export async function buildUserDetail(deps: ConsoleDeps, userId: string, adminId: string): Promise<AdminUserDetail | null> {
  const rest = restClient(deps);
  const now = rest.now;
  const since7d = new Date(now - 7 * DAY_MS).toISOString();
  const eqUser = `eq.${userId}`;
  const [profile, auth] = await Promise.all([
    rest.one<ProfileRow>({ table: "profiles", params: { select: `${PROFILE_SELECT},ink_balance`, user_id: eqUser } }),
    rest.authUser(userId),
  ]);
  if (!profile && !auth) return null;

  const [statRows, errors, sub, admin, boardRows, attempts, days, events, bugs, emails] = await Promise.all([
    stats(rest, since7d, userId),
    errorCounts(rest, "user_id", since7d, { user_id: eqUser }),
    rest.one<SubscriptionRow>({ table: "unlimited_subscriptions", params: { select: SUB_SELECT, user_id: eqUser, order: "created_at.desc" } }),
    rest.one<{ user_id: string }>({ table: "admins", params: { select: "user_id", user_id: eqUser } }),
    rest.rows<BoardViewRow>({ table: "admin_board_rows", params: { select: BOARD_SELECT, user_id: eqUser, deleted_at: "is.null", order: "updated_at.desc", limit: String(USER_BOARDS) } }),
    rest.paged<AttemptRow & { skill: string; outcome: string }>({ table: "learning_attempts", params: { select: ATTEMPT_SELECT, user_id: eqUser, order: "started_at.desc" } }),
    rest.rows<{ day: string; attempts: number; ai_calls: number; boards: number }>({
      table: "rpc/admin_user_days",
      params: { p_user: userId, p_since: new Date(utcDay(now) - (ACTIVITY_DAYS - 1) * DAY_MS).toISOString() },
    }),
    latestEvents(rest, { user_id: eqUser }, USER_EVENTS),
    bugsWhere(rest, { user_id: eqUser }),
    rest.rows<{ kind: string; sent_at: string | null }>({ table: "email_log", params: { select: "kind,sent_at", user_id: eqUser, order: "claimed_at.desc", limit: String(USER_EMAILS) } }),
  ]);

  // Past the cap the counts come from the database (the skills and minutes stay those of the newest ROW_CAP).
  const exact = attempts.truncated
    ? await Promise.all([
        rest.count({ table: "learning_attempts", params: { select: "id", user_id: eqUser } }),
        rest.count({ table: "learning_attempts", params: { select: "id", user_id: eqUser, outcome: "in.(first_try,self_corrected)" } }),
        rest.count({ table: "learning_attempts", params: { select: "id", user_id: eqUser, outcome: "eq.with_help" } }),
        rest.count({ table: "learning_attempts", params: { select: "id", user_id: eqUser, outcome: "eq.tutor_solved" } }),
      ]).then(([a, s, w, t]) => ({ attempts: a, solvedAlone: s, withHelp: w, tutorSolved: t }))
    : undefined;

  const user = userRow({ id: userId, profile, auth, stats: statRows[0] ?? null, sub, errors7d: errors.counts.get(userId) ?? 0, isAdmin: admin !== null });
  const owner = new Map([[userId, { email: user.email, name: user.name }]]);
  // The errors on the user's boards are the user's own (a board is only ever its owner's).
  const boards = await boardRowsOf(rest, boardRows, owner, { user_id: eqUser });
  const eventEmails = new Map<string, string | null>([[userId, user.email]]);
  for (const [id, email] of await rest.emails(events.map((e) => e.user_id).filter((id) => id !== userId))) eventEmails.set(id, email);

  await auditLook(rest, { adminId, action: "user.view", targetKind: "user", targetId: userId, meta: { boards: boards.length } });

  return {
    generatedAt: new Date(now).toISOString(),
    user,
    subscription: sub
      ? {
          status: sub.status ?? "pending",
          trialEnd: sub.trial_end ?? null,
          currentPeriodEnd: sub.current_period_end ?? null,
          cancelAtPeriodEnd: sub.cancel_at_period_end === true,
          cancelAt: sub.cancel_at ?? null,
          payerEmail: sub.payer_email ?? null,
          createdAt: sub.created_at,
        }
      : null,
    inkBalance: typeof profile?.ink_balance === "number" ? Math.round(profile.ink_balance) : null,
    boards,
    learning: learningOf(attempts.rows, exact),
    activity: activityDays(days, now),
    events: events.map((e) => toAdminEvent(e, eventEmails)),
    bugs,
    emails: emails.map((e) => ({ kind: e.kind, sentAt: e.sent_at ?? null })),
  };
}
