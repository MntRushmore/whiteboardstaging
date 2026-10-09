/**
 * The daily store against a fake client: rows read back camelCased (and what is not a row left
 * out), the RPC called with clean arguments, and nothing ever thrown.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { DAILY_READ_DAYS, loadDailyRows, saveDailyPractice, toDailyRow, type DailyClient } from "../store";

const BOARD = "b1000000-0000-4000-8000-000000000001";

function fakeClient(reply: { rows?: unknown[]; rowsError?: boolean; rpc?: unknown; rpcError?: boolean; throws?: boolean }) {
  const calls: { select: unknown[]; rpc: unknown[] } = { select: [], rpc: [] };
  const client: DailyClient = {
    from(table) {
      if (reply.throws) throw new Error("offline");
      return {
        select(columns) {
          return {
            gte(column, value) {
              return {
                order(orderBy, opts) {
                  return {
                    limit(n) {
                      calls.select.push({ table, columns, column, value, orderBy, opts, n });
                      return Promise.resolve(reply.rowsError ? { data: null, error: { message: "no" } } : { data: reply.rows ?? [], error: null });
                    },
                  };
                },
              };
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
    expect(calls.select[0]).toMatchObject({ table: "daily_practice", column: "day", value: "2026-08-09", orderBy: "day", opts: { ascending: false } });
    expect((calls.select[0] as { n: number }).n).toBeGreaterThanOrEqual(DAILY_READ_DAYS);
  });

  it("a failed or thrown read says so and never throws", async () => {
    await expect(loadDailyRows("2026-10-08", fakeClient({ rowsError: true }).client)).resolves.toEqual({ rows: [], ok: false });
    await expect(loadDailyRows("2026-10-08", fakeClient({ throws: true }).client)).resolves.toEqual({ rows: [], ok: false });
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
