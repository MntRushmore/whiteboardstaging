/**
 * The weekly report's server side: read a family's rows with the service role and hand them to the
 * pure core (build.ts). Kids' rows are not readable by their grown-up through RLS (a kid is a user
 * of their own), so these reads are service-role; every one takes ids that `reportScope` / `mayWatch`
 * (access.ts) already allowed from the caller's OWN family, never an id from the request unchecked.
 *
 *   GET /api/report        readReport()   who: reportScope(links, caller) → rows → buildWeeklyReport
 *   GET /api/report/boards readReplay()   whose board: mayWatch(links, caller, board.user_id)
 *   the Sunday email       readFamilyWeek() for a plan holder (src/lib/email/weeklyReportSend.ts)
 *
 * `reportDeps` is the routes' seam (like familyDeps): tests replace `store` with a fake.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FamilyLinks } from "@/lib/family/members";
import { UNNAMED } from "@/lib/family/members";
import { LEARNING_LIMITS } from "@/lib/learning/contracts";
import { serviceClient } from "@/lib/server/billing";
import { mayWatch, reportScope, type Caller } from "./access";
import { buildWeeklyReport, type ChildInput, type ReportAttemptRow, type ReportDailyRow } from "./build";
import type { ReportAnswer, WeeklyReport } from "./contracts";
import { weeklyReportEmailsOn } from "./flag";
import { addDays, weekRange } from "./week";

const DAY_MS = 86_400_000;
/** PostgREST answers at most this many rows per request (supabase/config.toml max_rows): reads page by it. */
const PAGE = 1000;
/** Today's practice rows read per person, newest first: more than a year of days, for the streak. */
const DAILY_READ = 400;

/** One profile as the report reads it. */
export interface ReportProfile {
  displayName: string | null;
  avatar: string | null;
  grade: number | null;
  course: string | null;
  /** profiles.weekly_report_opt_out */
  optedOut: boolean;
}

/** A board for the grown-up's replay. */
export interface ReplayBoard {
  id: string;
  ownerId: string;
  title: string;
  updatedAt: string;
  /** whiteboards.data as stored (the replay reads it with loadBoard) */
  snapshot: unknown;
}

export interface ReportStore {
  /** The family `userId` is in (as grown-up or kid), or null for a solo account. */
  links(userId: string): Promise<FamilyLinks | null>;
  profiles(ids: readonly string[]): Promise<Map<string, ReportProfile>>;
  /** One person's attempts started in [since, until), newest first, at most LEARNING_LIMITS.readLimit. */
  attempts(userId: string, since: string, until: string): Promise<ReportAttemptRow[]>;
  /** One person's Today's practice rows up to `untilDay`, newest first. */
  daily(userId: string, untilDay: string): Promise<ReportDailyRow[]>;
  /** Of `boardIds`, the ones still there (not deleted). */
  liveBoards(boardIds: readonly string[]): Promise<Set<string>>;
  /** Who owns a board that is not deleted, or null (read before the board's data, which can be 8 MB). */
  boardOwner(id: string): Promise<string | null>;
  /** One board that is not deleted, with its data, or null. */
  board(id: string): Promise<ReplayBoard | null>;
  /** Writes profiles.weekly_report_opt_out (the signed unsubscribe link). */
  setOptOut(userId: string, optedOut: boolean): Promise<void>;
}

function fail(what: string, error: { message?: string } | null | undefined): never {
  throw new Error(`${what}: ${error?.message ?? "no answer"}`);
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The store over a service-role client. */
export function reportStoreOver(svc: SupabaseClient): ReportStore {
  return {
    async links(userId) {
      const asKid = await svc.from("family_members").select("parent_id").eq("child_id", userId).maybeSingle();
      if (asKid.error) fail("family_members read failed", asKid.error);
      let parentId = str((asKid.data as { parent_id?: unknown } | null)?.parent_id);
      if (!parentId) {
        const fam = await svc.from("families").select("parent_id").eq("parent_id", userId).maybeSingle();
        if (fam.error) fail("families read failed", fam.error);
        if (!fam.data) return null;
        parentId = userId;
      }
      const kids = await svc.from("family_members").select("child_id").eq("parent_id", parentId).order("created_at", { ascending: true }).order("child_id");
      if (kids.error) fail("family_members read failed", kids.error);
      return { parentId, kids: ((kids.data ?? []) as Array<{ child_id: string }>).map((k) => k.child_id) };
    },

    async profiles(ids) {
      const out = new Map<string, ReportProfile>();
      if (ids.length === 0) return out;
      const { data, error } = await svc.from("profiles").select("user_id, display_name, avatar, grade, course, weekly_report_opt_out").in("user_id", [...ids]);
      if (error) fail("profiles read failed", error);
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        out.set(String(row.user_id), {
          displayName: str(row.display_name),
          avatar: str(row.avatar),
          grade: typeof row.grade === "number" ? row.grade : null,
          course: str(row.course),
          optedOut: row.weekly_report_opt_out === true,
        });
      }
      return out;
    },

    async attempts(userId, since, until) {
      const out: ReportAttemptRow[] = [];
      for (let from = 0; out.length < LEARNING_LIMITS.readLimit; ) {
        const { data, error } = await svc
          .from("learning_attempts")
          .select("id, board_id, problem_latex, skill, course, origin, outcome, lines_written, active_ms, mistakes, started_at, updated_at, finished_at")
          .eq("user_id", userId)
          .gte("started_at", since)
          .lt("started_at", until)
          .order("started_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) fail("learning_attempts read failed", error);
        const page = (data ?? []) as ReportAttemptRow[];
        out.push(...page);
        if (page.length < PAGE) break;
        from += page.length;
      }
      return out.slice(0, LEARNING_LIMITS.readLimit);
    },

    async daily(userId, untilDay) {
      const { data, error } = await svc.from("daily_practice").select("day, completed_at").eq("user_id", userId).lte("day", untilDay).order("day", { ascending: false }).limit(DAILY_READ);
      if (error) fail("daily_practice read failed", error);
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ day: String(r.day), completed_at: str(r.completed_at) }));
    },

    async liveBoards(boardIds) {
      if (boardIds.length === 0) return new Set();
      const { data, error } = await svc.from("whiteboards").select("id").in("id", [...boardIds]).is("deleted_at", null);
      if (error) fail("whiteboards read failed", error);
      return new Set(((data ?? []) as Array<{ id: string }>).map((b) => b.id));
    },

    async boardOwner(id) {
      const { data, error } = await svc.from("whiteboards").select("user_id, deleted_at").eq("id", id).maybeSingle();
      if (error) fail("whiteboards read failed", error);
      const row = data as Record<string, unknown> | null;
      return row && !row.deleted_at ? str(row.user_id) : null;
    },

    async board(id) {
      const { data, error } = await svc.from("whiteboards").select("id, user_id, title, data, updated_at, deleted_at").eq("id", id).maybeSingle();
      if (error) fail("whiteboards read failed", error);
      const row = data as Record<string, unknown> | null;
      if (!row || row.deleted_at) return null;
      return { id: String(row.id), ownerId: String(row.user_id), title: str(row.title) ?? "", updatedAt: String(row.updated_at), snapshot: row.data };
    },

    async setOptOut(userId, optedOut) {
      const { error } = await svc.from("profiles").update({ weekly_report_opt_out: optedOut }).eq("user_id", userId);
      if (error) fail("profiles write failed", error);
    },
  };
}

/** The service-role store, or null without SUPABASE_SERVICE_ROLE_KEY (the routes answer 503). */
export function createReportStore(): ReportStore | null {
  const svc = serviceClient();
  return svc ? reportStoreOver(svc) : null;
}

/** The routes' seam: tests replace `store` (and the clock). */
export const reportDeps = {
  store: (): ReportStore | null => createReportStore(),
  now: (): number => Date.now(),
};

/** What a person is called in the report when their profile has no name. */
function nameOf(profile: ReportProfile | undefined, isCaller: boolean): string {
  const name = profile?.displayName?.trim();
  return name || (isCaller ? "You" : UNNAMED.kid);
}

/**
 * The weekly report for these members (ids already allowed), read and built. The attempts go back
 * the learning record's read window before the week's end, so mastery at the week's start is the
 * Progress page's; the board to watch is chosen among boards that are still there.
 */
export async function readFamilyWeek(
  store: ReportStore,
  input: { ownerId: string; callerId: string; members: readonly { id: string; optional: boolean }[]; weekStart: string; timeZone: string; now: number; profiles?: Map<string, ReportProfile> },
): Promise<WeeklyReport> {
  const ids = input.members.map((m) => m.id);
  const profiles = input.profiles ?? (await store.profiles(ids));
  const { startMs, endMs } = weekRange(input.weekStart, input.timeZone);
  const since = new Date(endMs - LEARNING_LIMITS.readDays * DAY_MS).toISOString();
  const until = new Date(endMs).toISOString();
  const lastDay = addDays(input.weekStart, 6);
  const rows = await Promise.all(input.members.map(async (m) => ({ m, attempts: await store.attempts(m.id, since, until), daily: await store.daily(m.id, lastDay) })));

  const candidates = new Set<string>();
  for (const { attempts } of rows) {
    for (const a of attempts) if (a.board_id && Date.parse(a.started_at) >= startMs) candidates.add(a.board_id);
  }
  const liveBoards = await store.liveBoards([...candidates]);

  const children: ChildInput[] = rows.map(({ m, attempts, daily }) => {
    const p = profiles.get(m.id);
    return { userId: m.id, displayName: nameOf(p, m.id === input.callerId), avatar: p?.avatar ?? null, grade: p?.grade ?? null, course: p?.course ?? null, attempts, daily, optional: m.optional };
  });
  return buildWeeklyReport({ ownerId: input.ownerId, children, weekStart: input.weekStart, timeZone: input.timeZone, now: input.now, liveBoards });
}

/** GET /api/report: the caller's report (their own family only), their role, and their email setting. */
export async function readReport(store: ReportStore, caller: Caller, opts: { weekStart: string; timeZone: string; now: number }): Promise<ReportAnswer> {
  const links = await store.links(caller.id);
  const scope = reportScope(links, caller);
  const profiles = await store.profiles(scope.members.map((m) => m.id));
  const report = await readFamilyWeek(store, { ownerId: scope.ownerId, callerId: caller.id, members: scope.members, profiles, ...opts });
  return {
    report,
    role: scope.role,
    email: scope.role === "kid" ? null : { optedOut: profiles.get(caller.id)?.optedOut ?? false, sending: weeklyReportEmailsOn() },
  };
}

/** A board's replay for the caller, or null when it is not theirs to watch (the same answer as no board). */
export async function readReplay(store: ReportStore, caller: Caller, boardId: string): Promise<(ReplayBoard & { ownerName: string }) | null> {
  const ownerId = await store.boardOwner(boardId);
  if (!ownerId) return null;
  const links = await store.links(caller.id);
  if (!mayWatch(links, caller, ownerId)) return null;
  const board = await store.board(boardId);
  // deleted between the two reads: gone (a board never changes owner; checked again all the same)
  if (!board || board.ownerId !== ownerId) return null;
  const profile = (await store.profiles([board.ownerId])).get(board.ownerId);
  return { ...board, ownerName: nameOf(profile, board.ownerId === caller.id) };
}
