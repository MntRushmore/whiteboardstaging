/**
 * Board history (whiteboard_snapshots) against a LIVE Supabase stack (normally the local one from
 * `npx supabase start`). Opt-in: runs only when RUN_DB_TESTS=1.
 *
 *   RUN_DB_TESTS=1 npx vitest run src/__tests__/db-history.integration.test.ts
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (the local stack provides it): time is moved by back-dating
 * history rows, and the retention cases plant rows, which only the service role can.
 *
 * Covered (20261003000000_snapshot_retention.sql):
 *   - recording: a new board's empty start is never kept; a change keeps the version it REPLACED
 *     when the board has no history row younger than 10 minutes; within 10 minutes nothing; a write
 *     that drops more than half of a board (16 KB or more) keeps the state before it regardless
 *   - retention: the newest 8 plus the newest of each UTC day for the last 7 days; older days go
 *   - the 4 MB budget: in order of value (newest, then each earlier day's newest, then the rest),
 *     never fewer than 2 -- a heavy board keeps its latest state and the day before's
 *   - deleting a board deletes its history
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rows, rpc } from "../../scripts/lib/rlsChecks.mjs";
import type { CheckContext, RlsClient } from "../../scripts/lib/rlsChecks.mjs";
import { createSupabaseHttp, resolveSupabaseEnv, waitForHealth } from "../../scripts/lib/supabaseHttp.mjs";
import { bootstrapVerifyContext } from "../../scripts/lib/verifyContext.mjs";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const title = enabled
  ? "Board history retention (live Supabase)"
  : "Board history retention — skipped: set RUN_DB_TESTS=1 with the local stack running (`npx supabase start`) to enable";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** A random string: base64 of random bytes, so TOAST cannot compress it (stored size ~ length). */
function noise(chars: number): string {
  const bytes = new Uint8Array(Math.ceil((chars * 3) / 4));
  for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(bytes.length, i + 65536)));
  return Buffer.from(bytes).toString("base64").slice(0, chars);
}

suite(title, () => {
  let ctx: CheckContext;
  let service: RlsClient;
  let cleanup: (() => Promise<string[]>) | undefined;

  beforeAll(async () => {
    const env = resolveSupabaseEnv(process.env);
    if (!env.url || !env.anonKey) throw new Error("RUN_DB_TESTS=1 but no Supabase target (start the local stack with `npx supabase start`).");
    if (!env.serviceKey) throw new Error("db-history tests need SUPABASE_SERVICE_ROLE_KEY (the local stack provides it via `npx supabase status -o env`).");
    if (!(await waitForHealth(env.url, { timeoutMs: 180_000 }))) throw new Error(`Supabase at ${env.url} did not answer /auth/v1/health within 3 minutes`);
    const url = env.url.replace(/\/$/, "");
    service = createSupabaseHttp({ url, anonKey: env.anonKey, accessToken: env.serviceKey, userId: null });
    const boot = await bootstrapVerifyContext({ url, anonKey: env.anonKey, serviceKey: env.serviceKey, emailDomain: process.env.VERIFY_EMAIL_DOMAIN });
    ctx = boot.ctx;
    cleanup = boot.cleanup;
  }, 240_000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  }, 60_000);

  async function newBoard(): Promise<string> {
    const res = await ctx.a.rest("POST", "whiteboards", { body: { title: "db-history", data: {}, user_id: ctx.a.userId }, prefer: "return=representation" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return String(rows(res)[0].id);
  }

  async function save(board: string, data: unknown): Promise<number> {
    const res = await ctx.a.rest("PATCH", "whiteboards", { query: { id: `eq.${board}` }, body: { data }, prefer: "return=representation" });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    return Number(rows(res)[0].version);
  }

  /** The board's history as the owner sees it: versions, oldest first. */
  async function history(board: string): Promise<number[]> {
    const res = await ctx.a.rest("GET", "whiteboard_snapshots", { query: { whiteboard_id: `eq.${board}`, select: "version", order: "version.asc" } });
    expect(res.status).toBe(200);
    return rows(res).map((r) => Number(r.version));
  }

  /** Move the board's history `ms` into the past (what 10 minutes or a few days of waiting would do). */
  async function age(board: string, ms: number) {
    const res = await service.rest("PATCH", "whiteboard_snapshots", {
      query: { whiteboard_id: `eq.${board}` },
      body: { created_at: new Date(Date.now() - ms).toISOString() },
      prefer: "return=minimal",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(204);
  }

  async function plant(board: string, version: number, agoMs: number, data: unknown = { v: version }) {
    const res = await service.rest("POST", "whiteboard_snapshots", {
      body: { whiteboard_id: board, user_id: ctx.a.userId, version, data, created_at: new Date(Date.now() - agoMs).toISOString() },
      prefer: "return=minimal",
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  }

  async function prune(board: string): Promise<number> {
    const res = await rpc(service, "prune_whiteboard_snapshots", { p_whiteboard_id: board });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return Number(res.body);
  }

  it("keeps the state a write replaced: not the empty start, then at most one per 10 minutes", async () => {
    const board = await newBoard();
    expect(await save(board, { v: 1 })).toBe(2); // replaces the empty start: nothing kept
    expect(await history(board)).toEqual([]);
    expect(await save(board, { v: 2 })).toBe(3); // no history yet: keeps v2
    expect(await history(board)).toEqual([2]);
    for (const v of [3, 4, 5]) await save(board, { v }); // a session of saves every few seconds
    expect(await history(board)).toEqual([2]);

    await age(board, 11 * MIN); // ten minutes later (or the next session)
    expect(await save(board, { v: 6 })).toBe(7);
    expect(await history(board)).toEqual([2, 6]); // the state the student left it in
    await save(board, { v: 7 });
    expect(await history(board)).toEqual([2, 6]);
  }, 60_000);

  it("a write that drops more than half of the board keeps the state before it, even within 10 minutes", async () => {
    const board = await newBoard();
    await save(board, { v: 1 });
    await save(board, { v: 2 }); // history: [2]
    const full = { strokes: noise(40_000) };
    expect(await save(board, full)).toBe(4); // grows: within 10 minutes, nothing
    expect(await history(board)).toEqual([2]);
    expect(await save(board, { strokes: noise(30_000) })).toBe(5); // three quarters left: not a wipe
    expect(await history(board)).toEqual([2]);
    expect(await save(board, { strokes: "" })).toBe(6); // cleared
    expect(await history(board)).toEqual([2, 5]);
    const kept = await service.rest("GET", "whiteboard_snapshots", { query: { whiteboard_id: `eq.${board}`, version: "eq.5", select: "data" } });
    expect(String((rows(kept)[0]?.data as { strokes?: string })?.strokes).length).toBe(30_000);
  }, 60_000);

  it("retention keeps the newest 8 and the newest of each of the last 7 days", async () => {
    const board = await newBoard();
    const now = Date.now();
    const planted: Array<{ version: number; at: number }> = [];
    // a session a day for the last 10 days: two versions each (the second is that day's newest)...
    for (let d = 10; d >= 1; d--) {
      for (const [k, offset] of [[0, 20 * MIN], [1, 10 * MIN]] as const) planted.push({ version: 100 + (10 - d) * 2 + k, at: now - d * DAY + offset });
    }
    // ...then today: 12 versions, a minute apart
    for (let i = 0; i < 12; i++) planted.push({ version: 200 + i, at: now - (12 - i) * MIN });
    for (const p of planted) await plant(board, p.version, now - p.at);

    // The rule, from the planted rows (UTC days, as the migration partitions them):
    const byVersion = [...planted].sort((x, y) => y.version - x.version);
    const keep = new Set(byVersion.slice(0, 8).map((p) => p.version));
    const days = new Map<string, number>();
    for (const p of byVersion) {
      const day = new Date(p.at).toISOString().slice(0, 10);
      if (p.at >= now - 7 * DAY && !days.has(day)) days.set(day, p.version);
    }
    for (const v of days.values()) keep.add(v);

    expect(await prune(board)).toBe(planted.length - keep.size);
    expect(await history(board)).toEqual([...keep].sort((x, y) => x - y));
    // i.e. today's newest 8, and one per earlier day for 7 days (older days are gone)
    expect(keep.size).toBeGreaterThanOrEqual(8 + 6);
    expect([...keep].some((v) => v < 106)).toBe(false);
  }, 120_000);

  it("a heavy board keeps its newest state and the day before's, within 4 MB of history", async () => {
    const board = await newBoard();
    const heavy = () => ({ strokes: noise(1_600_000) }); // ~1.6 MB stored each
    await plant(board, 11, 2 * DAY, heavy()); // two days ago
    await plant(board, 12, 1 * DAY, heavy()); // yesterday
    await plant(board, 13, 30 * MIN, heavy()); // today
    await plant(board, 14, 10 * MIN, heavy()); // today, newest
    await prune(board);
    // By value: 14 (newest), 12 (yesterday), 11 (two days ago), 13. Two fit in 4 MB; a third does not.
    expect(await history(board)).toEqual([12, 14]);
  }, 180_000);

  it("deleting a board deletes its history", async () => {
    const board = await newBoard();
    await save(board, { v: 1 });
    await save(board, { v: 2 });
    expect(await history(board)).toEqual([2]);
    const del = await ctx.a.rest("DELETE", "whiteboards", { query: { id: `eq.${board}` }, prefer: "return=minimal" });
    expect(del.status).toBe(204);
    const left = await service.rest("GET", "whiteboard_snapshots", { query: { whiteboard_id: `eq.${board}`, select: "id" } });
    expect(rows(left)).toEqual([]);
  }, 60_000);
});
