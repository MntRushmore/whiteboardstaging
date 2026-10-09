/**
 * The daily store against a fake client: rows read back camelCased (and what is not a row left
 * out), a streak longer than the first read read further back until it breaks, a board's counted
 * problems from the learning record, the RPC called with clean arguments, and nothing ever thrown.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import type { DailyRow } from "../contracts";
import { problemKeyOf } from "../progress";
import { addDays } from "../streak";
import { DAILY_PAGE_DAYS, DAILY_READ_DAYS, loadBoardCounted, loadDailyRows, saveDailyPractice, streakReaches, toDailyRow, type DailyClient } from "../store";

const BOARD = "b1000000-0000-4000-8000-000000000001";

/** One read: the table, columns, filters and limit asked for. */
interface Query {
  table: string;
  columns: string;
  gte?: [string, string];
  lt?: [string, string];
  eq?: [string, string];
  order?: [string, { ascending: boolean }];
  n: number;
}

type Reply = { data: unknown[] | null; error: { message: string } | null };

function fakeClient(reply: { rows?: unknown[] | ((q: Query) => unknown[] | "error"); rowsError?: boolean; rpc?: unknown; rpcError?: boolean; throws?: boolean }) {
  const calls: { select: Query[]; rpc: unknown[] } = { select: [], rpc: [] };
  const answer = (q: Query): Promise<Reply> => {
    calls.select.push(q);
    if (reply.rowsError) return Promise.resolve({ data: null, error: { message: "no" } });
    const rows = typeof reply.rows === "function" ? reply.rows(q) : (reply.rows ?? []);
    return Promise.resolve(rows === "error" ? { data: null, error: { message: "no" } } : { data: rows, error: null });
  };
  const ordered = (q: Omit<Query, "n">) => ({
    order(column: string, opts: { ascending: boolean }) {
      return { limit: (n: number) => answer({ ...q, order: [column, opts], n }) };
    },
  });
  const client: DailyClient = {
    from(table) {
      if (reply.throws) throw new Error("offline");
      return {
        select(columns) {
          return {
            gte(column, value) {
              const q = { table, columns, gte: [column, value] as [string, string] };
              return { ...ordered(q), lt: (c: string, v: string) => ordered({ ...q, lt: [c, v] }) };
            },
            eq(column, value) {
              return { limit: (n: number) => answer({ table, columns, eq: [column, value], n }) };
            },
          };
        },
      };
    },
    rpc(fn, args) {
      if (reply.throws) return Promise.reject(new Error("offline"));
      calls.rpc.push({ fn, args });
      return Promise.resolve(reply.rpcError ? { data: null, error: { message: "day out of range" } } : { data: reply.rpc ?? null, error: null });
    },
  };
  return { client, calls };
}

/** A finished day's row, as the database returns it. */
const doneRow = (day: string) => ({ day, board_id: null, goal: 5, done: 5, stars: 3, completed_at: `${day}T18:00:00Z` });

/** A student who finished every day from `first` to `last`: the fake answers each read's window. */
function everyDay(first: string, last: string) {
  return (q: Query) => {
    const out: unknown[] = [];
    for (let day = last; day >= first; day = addDays(day, -1)) {
      if (q.gte && day < q.gte[1]) continue;
      if (q.lt && day >= q.lt[1]) continue;
      out.push(doneRow(day));
    }
    return out.slice(0, q.n);
  };
}

describe("toDailyRow", () => {
  it("reads a row, and leaves out what is not one", () => {
    expect(toDailyRow({ day: "2026-10-08", board_id: BOARD, goal: 5, done: 3, stars: 2, completed_at: null })).toEqual({ day: "2026-10-08", boardId: BOARD, goal: 5, done: 3, stars: 2, completedAt: null });
    expect(toDailyRow({ day: "2026-10-08", board_id: "nope", goal: 0, done: -1, stars: "2", completed_at: "2026-10-08T10:00:00Z" })).toEqual({ day: "2026-10-08", boardId: null, goal: 5, done: 0, stars: 2, completedAt: "2026-10-08T10:00:00Z" });
    expect(toDailyRow({ day: "yesterday" })).toBeNull();
    expect(toDailyRow(null)).toBeNull();
  });
});

describe("loadDailyRows", () => {
  it("reads the last 60 days up to today, newest first", async () => {
    const { client, calls } = fakeClient({ rows: [{ day: "2026-10-08", board_id: BOARD, goal: 5, done: 1, stars: 1, completed_at: null }, { day: "bad" }] });
    const read = await loadDailyRows("2026-10-08", client);
    expect(read.ok).toBe(true);
    expect(read.rows).toHaveLength(1);
    expect(calls.select).toHaveLength(1);
    expect(calls.select[0]).toMatchObject({ table: "daily_practice", gte: ["day", "2026-08-09"], order: ["day", { ascending: false }] });
    expect(calls.select[0].lt).toBeUndefined();
    expect(calls.select[0].n).toBeGreaterThanOrEqual(DAILY_READ_DAYS);
  });

  it("a failed or thrown read says so and never throws", async () => {
    await expect(loadDailyRows("2026-10-08", fakeClient({ rowsError: true }).client)).resolves.toEqual({ rows: [], ok: false });
    await expect(loadDailyRows("2026-10-08", fakeClient({ throws: true }).client)).resolves.toEqual({ rows: [], ok: false });
  });

  it("a 75-day streak is 75, not cut at the first read's 61: it reads back until the run breaks", async () => {
    const today = "2026-10-08";
    const { client, calls } = fakeClient({ rows: everyDay(addDays(today, -74), today) });
    const read = await loadDailyRows(today, client);
    expect(read.ok).toBe(true);
    expect(read.rows).toHaveLength(75);
    const since = addDays(today, -DAILY_READ_DAYS);
    expect(calls.select).toHaveLength(2);
    expect(calls.select[1]).toMatchObject({ gte: ["day", addDays(since, -DAILY_PAGE_DAYS)], lt: ["day", since] });
    const { dailyStreak } = await import("../streak");
    expect(dailyStreak(read.rows, today)).toMatchObject({ current: 75, best: 75 });
  });

  it("a run kept up from yesterday (today not done yet) reads back too, and a very long one page by page", async () => {
    const today = "2026-10-08";
    const yesterday = addDays(today, -1);
    const { dailyStreak } = await import("../streak");
    const short = await loadDailyRows(today, fakeClient({ rows: everyDay(addDays(today, -80), yesterday) }).client);
    expect(dailyStreak(short.rows, today).current).toBe(80);
    const { client, calls } = fakeClient({ rows: everyDay(addDays(today, -999), today) });
    const long = await loadDailyRows(today, client);
    expect(dailyStreak(long.rows, today).current).toBe(1000);
    expect(calls.select.length).toBe(4);
  });

  it("a streak that breaks inside the first read reads nothing more", async () => {
    const today = "2026-10-08";
    const { client, calls } = fakeClient({ rows: everyDay(addDays(today, -10), today) });
    await loadDailyRows(today, client);
    expect(calls.select).toHaveLength(1);
  });

  it("a page further back that fails keeps what was read: the home still has its streak", async () => {
    const today = "2026-10-08";
    const all = everyDay(addDays(today, -99), today);
    const { client } = fakeClient({ rows: (q) => (q.lt ? "error" : all(q)) });
    const read = await loadDailyRows(today, client);
    expect(read.ok).toBe(true);
    expect(read.rows).toHaveLength(DAILY_READ_DAYS + 1);
  });

  it("streakReaches: the run's first day is the oldest one read", () => {
    const today = "2026-10-08";
    const rows = (first: string, last: string) => everyDay(first, last)({ table: "", columns: "", n: 1000 }).map(toDailyRow).filter((r): r is DailyRow => r !== null);
    expect(streakReaches(rows("2026-10-01", today), today, "2026-10-01")).toBe(true);
    expect(streakReaches(rows("2026-10-02", today), today, "2026-10-01")).toBe(false);
    expect(streakReaches(rows("2026-10-01", "2026-10-07"), today, "2026-10-01")).toBe(true);
    expect(streakReaches([], today, "2026-10-01")).toBe(false);
  });
});

describe("loadBoardCounted", () => {
  it("the set's problems finished on the board, each once, with their attempt ids, from the learning record", async () => {
    const { client, calls } = fakeClient({
      rows: [
        { id: "a1", problem_latex: "3 + 4", origin: "practice", outcome: "first_try" },
        { id: "a2", problem_latex: "3+4", origin: "tutor_problem", outcome: "with_help" },
        { id: "b1", problem_latex: "5 + 6", origin: "tutor_problem", outcome: "self_corrected" },
        { id: "c1", problem_latex: "7 + 8", origin: "practice", outcome: "in_progress" },
        { id: "d1", problem_latex: "x = 2", origin: "student", outcome: "first_try" },
        { id: 5, problem_latex: "9 + 9", origin: "practice", outcome: "first_try" },
      ],
    });
    const got = await loadBoardCounted(BOARD, client);
    expect(calls.select[0]).toMatchObject({ table: "learning_attempts", eq: ["board_id", BOARD] });
    expect(got?.done).toBe(2);
    expect(new Set(got?.counted)).toEqual(new Set([problemKeyOf("3 + 4"), "a1", "a2", problemKeyOf("5 + 6"), "b1"]));
  });

  it("not a board's id, a refused or thrown read: null, never an error", async () => {
    const { client, calls } = fakeClient({});
    await expect(loadBoardCounted("local-board", client)).resolves.toBeNull();
    expect(calls.select).toHaveLength(0);
    await expect(loadBoardCounted(BOARD, fakeClient({ rowsError: true }).client)).resolves.toBeNull();
    await expect(loadBoardCounted(BOARD, fakeClient({ throws: true }).client)).resolves.toBeNull();
  });
});

describe("saveDailyPractice", () => {
  it("calls the RPC with the day's counts and returns the row as it now is", async () => {
    const { client, calls } = fakeClient({ rpc: { day: "2026-10-08", board_id: BOARD, goal: 5, done: 5, stars: 4, completed_at: "2026-10-08T19:00:00Z" } });
    const row = await saveDailyPractice({ day: "2026-10-08", boardId: BOARD, goal: 5, done: 5, stars: 4 }, client);
    expect(calls.rpc[0]).toEqual({ fn: "save_daily_practice", args: { p_day: "2026-10-08", p_board_id: BOARD, p_goal: 5, p_done: 5, p_stars: 4 } });
    expect(row?.completedAt).toBe("2026-10-08T19:00:00Z");
  });

  it("cleans what it sends: no board that is not a uuid, counts in range", async () => {
    const { client, calls } = fakeClient({ rpc: { day: "2026-10-08" } });
    await saveDailyPractice({ day: "2026-10-08", boardId: "local-board", goal: 99, done: 500, stars: -3 }, client);
    expect(calls.rpc[0]).toEqual({ fn: "save_daily_practice", args: { p_day: "2026-10-08", p_board_id: null, p_goal: 20, p_done: 100, p_stars: 0 } });
  });

  it("a refused, thrown or nonsense save is null, never an error", async () => {
    await expect(saveDailyPractice({ day: "2026-10-08", boardId: null, goal: 5, done: 1, stars: 0 }, fakeClient({ rpcError: true }).client)).resolves.toBeNull();
    await expect(saveDailyPractice({ day: "2026-10-08", boardId: null, goal: 5, done: 1, stars: 0 }, fakeClient({ throws: true }).client)).resolves.toBeNull();
    const { client, calls } = fakeClient({});
    await expect(saveDailyPractice({ day: "not a day", boardId: null, goal: 5, done: 1, stars: 0 }, client)).resolves.toBeNull();
    expect(calls.rpc).toHaveLength(0);
  });
});
