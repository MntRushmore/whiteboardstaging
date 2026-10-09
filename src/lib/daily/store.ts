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
import type { DailyRow } from "./contracts";
import { addDays, isDay } from "./streak";

interface QueryResult<T> {
  data: T | null;
  error: { message?: string; code?: string } | null;
}

export interface DailyClient {
  from(table: string): {
    select(columns: string): {
      gte(column: string, value: string): {
        order(column: string, opts: { ascending: boolean }): { limit(n: number): PromiseLike<QueryResult<unknown[]>> };
      };
    };
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<QueryResult<unknown>>;
}

/** How far back the home reads: enough for a best streak worth showing, and this week. */
export const DAILY_READ_DAYS = 60;

const COLUMNS = "day, board_id, goal, done, stars, completed_at";
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

/** The student's rows of the last DAILY_READ_DAYS days up to `today`'s, newest first. Never throws. */
export async function loadDailyRows(today: string, client: DailyClient = defaultClient()): Promise<DailyRead> {
  try {
    const since = addDays(today, -DAILY_READ_DAYS);
    const { data, error } = await client.from("daily_practice").select(COLUMNS).gte("day", since).order("day", { ascending: false }).limit(DAILY_READ_DAYS + 7);
    if (error) return { rows: [], ok: false };
    const rows = (Array.isArray(data) ? data : []).map(toDailyRow).filter((r): r is DailyRow => r !== null);
    return { rows, ok: true };
  } catch {
    return { rows: [], ok: false };
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
