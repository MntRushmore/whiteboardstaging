/**
 * Today's practice's reads and writes (`daily_practice`, supabase/migrations/20261009000000_kids_come_back.sql),
 * as the signed-in student: their own rows through the owner-select policy, and every write through
 * the `save_daily_practice` RPC, which keeps one row per local day and only ever raises the counts.
 *
 * The streak is a nice-to-have on top of the practice itself, so nothing here throws: a read that
 * fails says so (`ok: false`) and the home still offers Start; a save that fails returns null and
 * the board keeps counting (the next save carries the higher numbers anyway).
 *
 * The client is structural (only the calls used here), so the tests pass a fake; the app passes
 * nothing and gets the shared Supabase client.
 */
import { supabase } from "@/lib/supabase";
import type { AttemptOrigin, Outcome } from "@/lib/learning/contracts";
import type { DailyRow } from "./contracts";
import { countsForDaily, dailyProblemKey } from "./progress";
import { addDays, dailyStreak, isDay } from "./streak";

interface QueryResult<T> {
  data: T | null;
  error: { message?: string; code?: string } | null;
}

type Limited = { limit(n: number): PromiseLike<QueryResult<unknown[]>> };
type Ordered = { order(column: string, opts: { ascending: boolean }): Limited };

export interface DailyClient {
  from(table: string): {
    select(columns: string): {
      gte(column: string, value: string): Ordered & { lt(column: string, value: string): Ordered };
      eq(column: string, value: string): Limited;
    };
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<QueryResult<unknown>>;
}

/** How far back the home reads first: this week, and a best streak worth showing. */
export const DAILY_READ_DAYS = 60;
/**
 * A current streak that runs back past that is read further back, a page of this many days at a
 * time, until it breaks: the flame shows the true run (one small read more, only for a student on
 * a run of two months or more).
 */
export const DAILY_PAGE_DAYS = 365;
/** At most this many pages back (ten years): a bound on the loop, not a ceiling anyone reaches. */
const DAILY_MAX_PAGES = 10;

const COLUMNS = "day, board_id, goal, done, stars, completed_at";
/** A day's board never has nearly this many attempts. */
const BOARD_ATTEMPTS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultClient(): DailyClient {
  // supabase-js's generics do not relate to a structural slice (TS2589, as `asOnboardingClient`)
  return supabase as unknown as DailyClient;
}

function count(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** One row as the database (or the RPC) returns it, camelCased; null when it is not one. */
export function toDailyRow(raw: unknown): DailyRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const day = typeof r.day === "string" ? r.day.slice(0, 10) : "";
  if (!isDay(day)) return null;
  const goal = count(r.goal);
  return {
    day,
    boardId: typeof r.board_id === "string" && UUID.test(r.board_id) ? r.board_id : null,
    goal: goal > 0 ? goal : 5,
    done: count(r.done),
    stars: count(r.stars),
    completedAt: typeof r.completed_at === "string" && r.completed_at ? r.completed_at : null,
  };
}

export interface DailyRead {
  /** newest day first */
  rows: DailyRow[];
  /** false when the rows could not be read (the home shows Start without a streak) */
  ok: boolean;
}

/** Rows from `from` (inclusive) up to `before` (exclusive; open-ended without), newest first; null when the read failed. Never throws. */
async function readRows(client: DailyClient, from: string, before: string | null, limit: number): Promise<DailyRow[] | null> {
  try {
    const since = client.from("daily_practice").select(COLUMNS).gte("day", from);
    const { data, error } = await (before ? since.lt("day", before) : since).order("day", { ascending: false }).limit(limit);
    if (error) return null;
    return (Array.isArray(data) ? data : []).map(toDailyRow).filter((r): r is DailyRow => r !== null);
  } catch {
    return null;
  }
}

/** True when the current streak (`dailyStreak`) runs back to `oldest`, the first day read: it may go on before it. */
export function streakReaches(rows: readonly DailyRow[], today: string, oldest: string): boolean {
  const { current, todayDone } = dailyStreak(rows, today);
  if (current === 0) return false;
  return addDays(todayDone ? today : addDays(today, -1), -(current - 1)) <= oldest;
}

/**
 * The student's rows up to `today`'s, newest first: the last DAILY_READ_DAYS days, and further back
 * while the current streak runs into the oldest day read (so it is never cut at the window). `best`
 * is the longest run in what was read. Never throws.
 */
export async function loadDailyRows(today: string, client: DailyClient = defaultClient()): Promise<DailyRead> {
  let oldest = addDays(today, -DAILY_READ_DAYS);
  // a few rows after today too (a clock that was wrong): the streak ignores them
  const rows = await readRows(client, oldest, null, DAILY_READ_DAYS + 7);
  if (!rows) return { rows: [], ok: false };
  for (let page = 0; page < DAILY_MAX_PAGES && streakReaches(rows, today, oldest); page++) {
    const from = addDays(oldest, -DAILY_PAGE_DAYS);
    const more = await readRows(client, from, oldest, DAILY_PAGE_DAYS + 1);
    // a page that fails: the streak is what was read so far
    if (!more) break;
    rows.push(...more);
    oldest = from;
    if (more.length === 0) break;
  }
  return { rows, ok: true };
}

export interface BoardCounted {
  /** the set's problems finished on the board (each once) */
  done: number;
  /** their problem keys and attempt ids (`DailyProgress.known`) */
  counted: string[];
}

/**
 * The set's problems already finished on a day's board, from the student's own learning record
 * (`learning_attempts`, owner-only): what another device counted, so answering one of them again
 * here is not counted twice (the tracker there gave it an attempt id this device never saw). Null
 * when it could not be read. Never throws.
 */
export async function loadBoardCounted(boardId: string, client: DailyClient = defaultClient()): Promise<BoardCounted | null> {
  if (!UUID.test(boardId)) return null;
  try {
    const { data, error } = await client.from("learning_attempts").select("id, problem_latex, origin, outcome").eq("board_id", boardId).limit(BOARD_ATTEMPTS);
    if (error) return null;
    const problems = new Set<string>();
    const counted = new Set<string>();
    for (const raw of Array.isArray(data) ? data : []) {
      const r = (raw ?? {}) as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.origin !== "string" || typeof r.outcome !== "string") continue;
      const record = { id: r.id, boardId, origin: r.origin as AttemptOrigin, outcome: r.outcome as Outcome, problemLatex: typeof r.problem_latex === "string" ? r.problem_latex : "" };
      if (!countsForDaily(record, boardId)) continue;
      const key = dailyProblemKey(record);
      problems.add(key);
      counted.add(key).add(record.id);
    }
    return { done: problems.size, counted: [...counted] };
  } catch {
    return null;
  }
}

export interface DailySave {
  day: string;
  boardId: string | null;
  goal: number;
  done: number;
  stars: number;
}

/**
 * Saves the day's progress (`save_daily_practice`): the row as it now is, or null when the save
 * failed (signed out, offline, a day the server will not take). Never throws.
 */
export async function saveDailyPractice(save: DailySave, client: DailyClient = defaultClient()): Promise<DailyRow | null> {
  if (!isDay(save.day)) return null;
  try {
    const { data, error } = await client.rpc("save_daily_practice", {
      p_day: save.day,
      p_board_id: save.boardId && UUID.test(save.boardId) ? save.boardId : null,
      p_goal: Math.max(1, Math.min(20, Math.floor(save.goal) || 1)),
      p_done: Math.min(100, count(save.done)),
      p_stars: Math.min(100, count(save.stars)),
    });
    if (error) return null;
    return toDailyRow(data);
  } catch {
    return null;
  }
}
