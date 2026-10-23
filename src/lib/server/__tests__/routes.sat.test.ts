/**
 * The SAT routes (src/app/api/sat/*, docs/SAT-MODE.md) through their real handlers, with a fake
 * database behind `satStoreDeps` (an in-memory PostgREST: select / eq / in / order / range / limit /
 * insert / count, and the two RPCs) and supabase-js faked for token checks:
 *
 *  - every route: 401 signed out; no-store and X-Request-Id;
 *  - GET /api/sat/next: whole live rows with answers and solutions, filters, the 30-day rule,
 *    a 400 for a bad query, a 502 when the bank cannot be read;
 *  - POST /api/sat/attempts: the bank decides `correct`, the row is the caller's, 404 / 400 / 429;
 *  - POST /api/sat/tutor: the day in the student's zone, the cap from SAT_FREE_TUTOR_PER_DAY,
 *    idempotent per question per day, Unlimited lifts the cap, 400 / 404 / 503;
 *  - GET /api/sat/progress: totals, today, the estimate after 15 answers;
 *  - v2 (docs/SAT-V2.md): the mistake deck (a miss is due tomorrow in the student's zone, then 3
 *    days, then cleared; a miss on a review goes back to step 1), due reviews first in
 *    GET /api/sat/next with `review: true`, `reviews_due` / `reviews_waiting` in progress, and the
 *    bank's optional notes passed through unchanged (and left out when the row has none).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ TOKEN: "student.token.sig", USER_ID: "99999999-2222-4333-8444-555555555555" }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.TOKEN ? { data: { user: { id: fake.USER_ID, email: "teen@example.com" } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async () => ({ data: null, error: { message: "unexpected rpc" } }),
  }),
}));
vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));

import { resetServerEnvCache } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { SatQuestion } from "@/lib/sat/contracts";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { resetSatBankCache, satStoreDeps } from "@/lib/server/sat/store";
import { GET as nextGet } from "@/app/api/sat/next/route";
import { POST as attemptsPost } from "@/app/api/sat/attempts/route";
import { POST as tutorPost } from "@/app/api/sat/tutor/route";
import { GET as progressGet } from "@/app/api/sat/progress/route";

const SAMPLE = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "docs", "sat", "sample-20.json"), "utf8")) as SatQuestion[];
const NOW = Date.parse("2026-10-22T03:00:00Z"); // Oct 21, 23:00 in New York

type Row = Record<string, unknown>;
type Db = {
  tables: Record<string, Row[]>;
  failRead: string | null;
  failInsert: { code: string; message: string; hint?: string } | null;
  /** a write to this table fails (the mistake deck's, to show the answer still counts) */
  failWrite: string | null;
  unlimited: boolean;
  rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }>;
};
let db: Db;

/** The fake PostgREST client: only what the SAT store asks for. */
function client(asUser: boolean): SupabaseClient {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let sort: [string, boolean] | null = null;
    let range: [number, number] | null = null;
    let limit: number | null = null;
    let head = false;
    let insertRow: Row | null = null;
    let patch: Row | null = null;
    const run = () => {
      if ((insertRow || patch) && db.failWrite === table) return { data: null, error: { message: "boom", code: "XX000" } };
      if (insertRow) {
        if (db.failInsert && table === "sat_attempts") return { data: null, error: db.failInsert };
        if (table === "sat_reviews") {
          // RLS: own rows only; the primary key (user_id, question_id)
          if (asUser && insertRow.user_id !== fake.USER_ID) return { data: null, error: { code: "42501", message: "row-level security" } };
          if (db.tables.sat_reviews.some((r) => r.user_id === insertRow!.user_id && r.question_id === insertRow!.question_id)) return { data: null, error: { code: "23505", message: "duplicate key" } };
          db.tables.sat_reviews.push({ ...insertRow });
          return { data: null, error: null };
        }
        db.tables[table].push({ ...insertRow, id: crypto.randomUUID(), created_at: new Date(satStoreDeps.now()).toISOString() });
        return { data: null, error: null };
      }
      if (patch) {
        for (const r of db.tables[table]) if (filters.every((f) => f(r)) && (!asUser || r.user_id === fake.USER_ID)) Object.assign(r, patch);
        return { data: null, error: null };
      }
      if (db.failRead === table) return { data: null, error: { message: "boom", code: "XX000" } };
      let rows = db.tables[table].filter((r) => filters.every((f) => f(r)));
      // RLS: live questions only; own rows only
      if (asUser && table === "sat_questions") rows = rows.filter((r) => r.status === "live");
      if (asUser && (table === "sat_attempts" || table === "sat_reviews")) rows = rows.filter((r) => r.user_id === fake.USER_ID);
      if (sort) {
        const [c, asc] = sort;
        rows = [...rows].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (limit !== null) rows = rows.slice(0, limit);
      return head ? { data: null, count: rows.length, error: null } : { data: rows.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select: (_c: string, opts?: { head?: boolean }) => ((head = Boolean(opts?.head)), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
      order: (c: string, o?: { ascending?: boolean }) => ((sort = [c, o?.ascending !== false]), b),
      range: (a: number, z: number) => ((range = [a, z]), b),
      limit: (n: number) => ((limit = n), b),
      insert: (row: Row) => ((insertRow = row), b),
      update: (row: Row) => ((patch = row), b),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  const rpc = async (fn: string, args?: Record<string, unknown>) => {
    db.rpcCalls.push({ fn, args });
    if (fn === "sat_tutor_access") return { data: { unlimited: db.unlimited, remaining: 0 }, error: null };
    if (fn === "sat_take_tutor_pass" && !asUser) {
      const { p_profile_id, p_question_id, p_day, p_cap } = args as { p_profile_id: string; p_question_id: string; p_day: string; p_cap: number };
      if (!db.tables.sat_questions.some((q) => q.id === p_question_id && q.status === "live")) return { data: null, error: { code: "P0002", message: "question not found" } };
      const passes = db.tables.sat_tutor_passes;
      const mine = () => passes.filter((p) => p.profile_id === p_profile_id && p.day === p_day);
      let allowed = mine().some((p) => p.question_id === p_question_id);
      if (!allowed && (db.unlimited || mine().length < p_cap)) {
        passes.push({ profile_id: p_profile_id, question_id: p_question_id, day: p_day });
        allowed = true;
      }
      return { data: { allowed, used_today: mine().length, cap: p_cap, unlimited: db.unlimited }, error: null };
    }
    return { data: null, error: { message: `no fake for ${fn}` } };
  };
  return { from, rpc } as unknown as SupabaseClient;
}

const realDeps = { ...satStoreDeps };
const saved: Record<string, string | undefined> = {};
const ENV_VARS = ["RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "SAT_FREE_TUTOR_PER_DAY"] as const;

beforeEach(() => {
  for (const name of ENV_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.RATE_LIMIT_BACKEND = "memory";
  resetServerEnvCache();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  resetSatBankCache();
  db = {
    tables: { sat_questions: SAMPLE.map((q) => ({ ...q })), sat_attempts: [], sat_tutor_passes: [], sat_reviews: [] },
    failRead: null,
    failInsert: null,
    failWrite: null,
    unlimited: false,
    rpcCalls: [],
  };
  db.tables.sat_questions.push({ ...SAMPLE[0], id: "algebra-linear-one-var-0999", status: "draft" });
  satStoreDeps.user = () => client(true);
  satStoreDeps.service = () => client(false);
  satStoreDeps.now = () => NOW;
  logger.level = "silent";
});

afterEach(() => {
  Object.assign(satStoreDeps, realDeps);
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
  logger.level = process.env.LOG_LEVEL || "info";
});

const auth = (token: string | null = fake.TOKEN): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});
const get = (path: string, token?: string | null) => new Request(`http://localhost${path}`, { headers: auth(token) });
const post = (path: string, body: unknown, token?: string | null) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...auth(token) }, body: JSON.stringify(body) });

describe("every SAT route", () => {
  it("is 401 signed out, and answers no-store with a request id", async () => {
    const calls = [
      () => nextGet(get("/api/sat/next", null)),
      () => attemptsPost(post("/api/sat/attempts", {}, null)),
      () => tutorPost(post("/api/sat/tutor", {}, null)),
      () => progressGet(get("/api/sat/progress", null)),
    ];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(401);
      expect(res.headers.get("X-Request-Id")).toBeTruthy();
    }
    const ok = await nextGet(get("/api/sat/next"));
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect(ok.headers.get("X-Request-Id")).toBeTruthy();
  });
});

describe("GET /api/sat/next", () => {
  it("answers whole live questions (answer and solution included), 10 by default, never a draft", async () => {
    const res = await nextGet(get("/api/sat/next"));
    expect(res.status).toBe(200);
    const { questions } = (await res.json()) as { questions: SatQuestion[] };
    expect(questions).toHaveLength(10);
    expect(new Set(questions.map((q) => q.id)).size).toBe(10);
    for (const q of questions) {
      expect(q.status).toBe("live");
      expect(q.answer).toBeTruthy();
      expect(q.solution.steps.length).toBeGreaterThanOrEqual(2);
    }
    const all = (await (await nextGet(get("/api/sat/next?count=20"))).json()) as { questions: SatQuestion[] };
    expect(all.questions).toHaveLength(20);
    expect(all.questions.map((q) => q.id)).not.toContain("algebra-linear-one-var-0999");
  });

  it("follows domain, skill and difficulty", async () => {
    const byDomain = (await (await nextGet(get("/api/sat/next?domain=psda&count=20"))).json()) as { questions: SatQuestion[] };
    expect(byDomain.questions.length).toBe(SAMPLE.filter((q) => q.domain === "psda").length);
    expect(byDomain.questions.every((q) => q.domain === "psda")).toBe(true);
    const skill = encodeURIComponent("linear equations in one variable");
    const bySkill = (await (await nextGet(get(`/api/sat/next?skill=${skill}&difficulty=2`))).json()) as { questions: SatQuestion[] };
    expect(bySkill.questions.map((q) => q.id)).toEqual(["algebra-linear-one-var-0002"]);
  });

  it("does not repeat what was answered in the last 30 days while others are left", async () => {
    const psda = SAMPLE.filter((q) => q.domain === "psda");
    db.tables.sat_attempts.push({ user_id: fake.USER_ID, question_id: psda[0].id, correct: true, created_at: new Date(NOW - 86_400_000).toISOString() });
    const got = (await (await nextGet(get(`/api/sat/next?domain=psda&count=${psda.length - 1}`))).json()) as { questions: SatQuestion[] };
    expect(got.questions.map((q) => q.id)).not.toContain(psda[0].id);
  });

  it("400 for a bad query; 502 when the bank cannot be read", async () => {
    for (const q of ["count=0", "count=99", "domain=reading", "skill=calculus", "difficulty=4", "domain=psda&skill=circles"]) {
      expect((await nextGet(get(`/api/sat/next?${q}`))).status, q).toBe(400);
    }
    db.failRead = "sat_questions";
    const res = await nextGet(get("/api/sat/next"));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "upstream_error" });
  });
});

describe("POST /api/sat/attempts", () => {
  const mcq = SAMPLE.find((q) => q.format === "mcq")!;
  const spr = SAMPLE.find((q) => q.format === "spr")!;

  it("saves the caller's answer with the bank's verdict, whatever the app said", async () => {
    const wrongKey = ["A", "B", "C", "D"].find((k) => "key" in mcq.answer && k !== mcq.answer.key)!;
    const res = await attemptsPost(post("/api/sat/attempts", { question_id: mcq.id, chosen: wrongKey, correct: true, seconds: 41, used_tutor: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, correct: false });
    const right = await attemptsPost(post("/api/sat/attempts", { question_id: spr.id, chosen: "accepted" in spr.answer ? spr.answer.accepted[0] : "", correct: false, seconds: 12, used_tutor: false }));
    expect(await right.json()).toEqual({ ok: true, correct: true });
    expect(db.tables.sat_attempts).toEqual([
      expect.objectContaining({ user_id: fake.USER_ID, profile_id: fake.USER_ID, question_id: mcq.id, chosen: wrongKey, correct: false, seconds: 41, used_tutor: true }),
      expect.objectContaining({ question_id: spr.id, correct: true, used_tutor: false }),
    ]);
  });

  it("404 for a question that is not live; 400 for a bad body; 429 past the daily cap; 502 on a failed save", async () => {
    expect((await attemptsPost(post("/api/sat/attempts", { question_id: "algebra-linear-one-var-0999", chosen: "A", correct: true }))).status).toBe(404);
    expect((await attemptsPost(post("/api/sat/attempts", { question_id: "nope", chosen: "A", correct: true }))).status).toBe(400);
    expect((await attemptsPost(post("/api/sat/attempts", { question_id: mcq.id, chosen: "", correct: true }))).status).toBe(400);
    db.failInsert = { code: "23514", message: "too many SAT answers today", hint: "sat_attempts_cap" };
    expect((await attemptsPost(post("/api/sat/attempts", { question_id: mcq.id, chosen: "A", correct: true }))).status).toBe(429);
    db.failInsert = { code: "XX000", message: "boom" };
    expect((await attemptsPost(post("/api/sat/attempts", { question_id: mcq.id, chosen: "A", correct: true }))).status).toBe(502);
  });
});

describe("POST /api/sat/tutor", () => {
  const ids = SAMPLE.map((q) => q.id);
  const ask = async (question_id: string, tz = "America/New_York") => {
    const res = await tutorPost(post("/api/sat/tutor", { question_id, tz }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("a capped day on the student's date (SAT_FREE_TUTOR_PER_DAY=5 here): the same question again is free; the sixth is refused", async () => {
    process.env.SAT_FREE_TUTOR_PER_DAY = "5";
    resetServerEnvCache();
    for (let i = 0; i < 5; i++) expect((await ask(ids[i])).body).toEqual({ allowed: true, used_today: i + 1, cap: 5, unlimited: false });
    expect((await ask(ids[2])).body).toEqual({ allowed: true, used_today: 5, cap: 5, unlimited: false });
    expect((await ask(ids[5])).body).toEqual({ allowed: false, used_today: 5, cap: 5, unlimited: false });
    // 23:00 in New York is Oct 21 there
    expect(db.tables.sat_tutor_passes.every((p) => p.day === "2026-10-21" && p.profile_id === fake.USER_ID)).toBe(true);
    // in Tokyo it is already the next day: a fresh allowance
    expect((await ask(ids[5], "Asia/Tokyo")).body).toEqual({ allowed: true, used_today: 1, cap: 5, unlimited: false });
  });

  it("a signed-in account's cap is 20 by default; SAT_FREE_TUTOR_PER_DAY sets it; Unlimited lifts it", async () => {
    expect((await ask(ids[0])).body).toMatchObject({ allowed: true, cap: 20 });
    process.env.SAT_FREE_TUTOR_PER_DAY = "1";
    resetServerEnvCache();
    expect((await ask(ids[0])).body).toMatchObject({ allowed: true, cap: 1 });
    expect((await ask(ids[1])).body).toMatchObject({ allowed: false, cap: 1 });
    db.unlimited = true;
    expect((await ask(ids[1])).body).toEqual({ allowed: true, used_today: 2, cap: 1, unlimited: true });
  });

  it("400 for a bad zone or body; 404 for a question not live; 503 without the service role", async () => {
    expect((await ask(ids[0], "Mars/Olympus")).status).toBe(400);
    expect((await tutorPost(post("/api/sat/tutor", { question_id: ids[0] }))).status).toBe(400);
    expect((await ask("algebra-linear-one-var-0999")).status).toBe(404);
    satStoreDeps.service = () => null;
    expect((await ask(ids[0])).status).toBe(503);
  });
});

describe("GET /api/sat/progress", () => {
  it("adds up the student's answers, today in their zone, and the free tutor used", async () => {
    await tutorPost(post("/api/sat/tutor", { question_id: SAMPLE[0].id, tz: "America/New_York" }));
    db.tables.sat_attempts.push(
      { user_id: fake.USER_ID, question_id: SAMPLE[0].id, correct: true, created_at: "2026-10-22T01:00:00Z" },
      { user_id: fake.USER_ID, question_id: SAMPLE[12].id, correct: false, created_at: "2026-10-20T15:00:00Z" },
      { user_id: "someone-else", question_id: SAMPLE[1].id, correct: true, created_at: "2026-10-22T01:00:00Z" },
    );
    const res = await progressGet(get("/api/sat/progress?tz=America/New_York"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ answered: 2, correct: 1, streak_days: 2, today: { answered: 1, correct: 1, tutor_used: 1, cap: 20, unlimited: false }, estimate: null, reviews_due_skills: [] });
    expect(body.by_domain).toHaveLength(4);
  });

  it("gives an estimate band once 15 questions are answered", async () => {
    for (let i = 0; i < 15; i++) db.tables.sat_attempts.push({ user_id: fake.USER_ID, question_id: SAMPLE[i].id, correct: i % 2 === 0, created_at: new Date(NOW - i * 3_600_000).toISOString() });
    const body = await (await progressGet(get("/api/sat/progress"))).json();
    expect(body.estimate).toMatchObject({ low: expect.any(Number), high: expect.any(Number), note: expect.stringMatching(/not an SAT score/) });
    expect(body.estimate.low).toBeGreaterThanOrEqual(200);
    expect(body.estimate.high).toBeLessThanOrEqual(800);
  });

  it("400 for a bad zone; 502 when a read fails", async () => {
    expect((await progressGet(get("/api/sat/progress?tz=Nowhere/Land"))).status).toBe(400);
    db.failRead = "sat_attempts";
    expect((await progressGet(get("/api/sat/progress"))).status).toBe(502);
  });
});

describe("v2: the mistake deck", () => {
  const mcq = SAMPLE[0]; // algebra, key B
  const spr = SAMPLE[1]; // algebra, 14
  const DAY = 86_400_000;
  const answer = async (question_id: string, chosen: string, tz?: string) => {
    const res = await attemptsPost(post("/api/sat/attempts", { question_id, chosen, correct: false, ...(tz ? { tz } : {}) }));
    expect(res.status).toBe(200);
    return (await res.json()) as { ok: boolean; correct: boolean };
  };
  const review = (id: string) => db.tables.sat_reviews.find((r) => r.question_id === id && r.user_id === fake.USER_ID);
  const next = async (query = "") => {
    const res = await nextGet(get(`/api/sat/next${query}`));
    expect(res.status).toBe(200);
    return ((await res.json()) as { questions: Array<SatQuestion & { review: boolean }> }).questions;
  };

  it("a miss is due tomorrow in the student's zone (step 1); a retry got right that day, or a second miss, changes nothing", async () => {
    await answer(mcq.id, "A", "America/New_York"); // 23:00 on Oct 21 there
    expect(review(mcq.id)).toMatchObject({ user_id: fake.USER_ID, due_on: "2026-10-22", step: 1, cleared_at: null });
    await answer(mcq.id, "B", "America/New_York");
    await answer(mcq.id, "C", "America/New_York");
    expect(review(mcq.id)).toMatchObject({ due_on: "2026-10-22", step: 1, cleared_at: null });
    // no zone: UTC, where it is already Oct 22
    await answer(spr.id, "15");
    expect(review(spr.id)).toMatchObject({ due_on: "2026-10-23", step: 1 });
    // a right answer with no review makes none
    await answer(SAMPLE[2].id, "B");
    expect(review(SAMPLE[2].id)).toBeUndefined();
    expect(db.tables.sat_reviews).toHaveLength(2);
  });

  it("right on a due review: step 1 -> step 2 three days later -> cleared; early right answers change nothing", async () => {
    await answer(mcq.id, "A", "UTC"); // Oct 22 UTC: due Oct 23
    satStoreDeps.now = () => NOW + DAY; // Oct 23
    await answer(mcq.id, "B", "UTC");
    expect(review(mcq.id)).toMatchObject({ due_on: "2026-10-26", step: 2, cleared_at: null });
    satStoreDeps.now = () => NOW + 2 * DAY; // Oct 24: not due yet
    await answer(mcq.id, "B", "UTC");
    expect(review(mcq.id)).toMatchObject({ due_on: "2026-10-26", step: 2, cleared_at: null });
    satStoreDeps.now = () => NOW + 6 * DAY; // Oct 28: overdue counts as due
    await answer(mcq.id, "B", "UTC");
    expect(review(mcq.id)).toMatchObject({ step: 2, cleared_at: new Date(NOW + 6 * DAY).toISOString() });
    // cleared: a right answer leaves it so; a miss schedules it again from step 1
    await answer(mcq.id, "B", "UTC");
    expect(review(mcq.id)!.cleared_at).not.toBeNull();
    await answer(mcq.id, "D", "UTC");
    expect(review(mcq.id)).toMatchObject({ due_on: "2026-10-29", step: 1, cleared_at: null });
  });

  it("a miss on a review goes back to step 1, due tomorrow", async () => {
    db.tables.sat_reviews.push({ user_id: fake.USER_ID, question_id: spr.id, due_on: "2026-10-22", step: 2, cleared_at: null });
    await answer(spr.id, "41", "UTC");
    expect(review(spr.id)).toMatchObject({ due_on: "2026-10-23", step: 1, cleared_at: null });
  });

  it("the answer still counts when the deck cannot be written", async () => {
    db.failWrite = "sat_reviews";
    expect(await answer(mcq.id, "A", "UTC")).toEqual({ ok: true, correct: false });
    expect(db.tables.sat_attempts).toHaveLength(1);
    expect(db.tables.sat_reviews).toHaveLength(0);
  });

  it("GET /api/sat/next starts with the reviews due today (oldest first, in the student's zone), each with review: true", async () => {
    db.tables.sat_reviews.push(
      { user_id: fake.USER_ID, question_id: SAMPLE[12].id, due_on: "2026-10-22", step: 1, cleared_at: null },
      { user_id: fake.USER_ID, question_id: SAMPLE[6].id, due_on: "2026-10-20", step: 2, cleared_at: null },
      { user_id: fake.USER_ID, question_id: SAMPLE[3].id, due_on: "2026-10-25", step: 2, cleared_at: null }, // later
      { user_id: fake.USER_ID, question_id: SAMPLE[4].id, due_on: "2026-10-19", step: 2, cleared_at: "2026-10-19T10:00:00Z" }, // cleared
      { user_id: "someone-else", question_id: SAMPLE[5].id, due_on: "2026-10-19", step: 1, cleared_at: null },
    );
    // Oct 21 in New York: only the Oct 20 one is due
    const ny = await next("?tz=America/New_York");
    expect(ny).toHaveLength(10);
    expect(ny.map((q) => q.review)).toEqual([true, ...Array(9).fill(false)]);
    expect(ny[0].id).toBe(SAMPLE[6].id);
    // Oct 22 in Tokyo (and in UTC, the default): both, oldest first, and never twice
    for (const query of ["?tz=Asia/Tokyo", ""]) {
      const qs = await next(query);
      expect(qs.slice(0, 2).map((q) => [q.id, q.review])).toEqual([
        [SAMPLE[6].id, true],
        [SAMPLE[12].id, true],
      ]);
      expect(qs.slice(2).every((q) => !q.review)).toBe(true);
      expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
    }
  });

  it("due reviews follow the set's filter, and fill a set they outnumber", async () => {
    db.tables.sat_reviews.push(
      { user_id: fake.USER_ID, question_id: SAMPLE[12].id, due_on: "2026-10-21", step: 1, cleared_at: null },
      { user_id: fake.USER_ID, question_id: SAMPLE[0].id, due_on: "2026-10-21", step: 1, cleared_at: null },
    );
    const psda = await next("?domain=psda&count=3");
    expect(psda.map((q) => [q.domain, q.review])).toEqual([
      ["psda", true],
      ["psda", false],
      ["psda", false],
    ]);
    const one = await next("?count=1");
    expect(one).toHaveLength(1);
    expect(one[0].review).toBe(true);
    // a review of a question no longer live is skipped
    db.tables.sat_questions.find((q) => q.id === SAMPLE[0].id)!.status = "retired";
    resetSatBankCache();
    expect((await next("?domain=algebra")).every((q) => !q.review)).toBe(true);
  });

  it("GET /api/sat/progress counts reviews_due (today or overdue) and reviews_waiting, live questions only", async () => {
    db.tables.sat_reviews.push(
      { user_id: fake.USER_ID, question_id: SAMPLE[1].id, due_on: "2026-10-21", step: 1, cleared_at: null },
      { user_id: fake.USER_ID, question_id: SAMPLE[2].id, due_on: "2026-10-18", step: 2, cleared_at: null },
      { user_id: fake.USER_ID, question_id: SAMPLE[3].id, due_on: "2026-10-22", step: 1, cleared_at: null },
      { user_id: fake.USER_ID, question_id: SAMPLE[4].id, due_on: "2026-10-30", step: 2, cleared_at: null },
      { user_id: fake.USER_ID, question_id: SAMPLE[5].id, due_on: "2026-10-18", step: 2, cleared_at: "2026-10-18T09:00:00Z" },
      { user_id: "someone-else", question_id: SAMPLE[6].id, due_on: "2026-10-18", step: 1, cleared_at: null },
    );
    // Oct 21 in New York: two due, two waiting; their skills, SAMPLE[1]'s missed before
    db.tables.sat_attempts.push({ user_id: fake.USER_ID, question_id: SAMPLE[1].id, correct: false, created_at: "2026-10-20T15:00:00Z" });
    expect(await (await progressGet(get("/api/sat/progress?tz=America/New_York"))).json()).toMatchObject({
      reviews_due: 2,
      reviews_waiting: 2,
      reviews_due_skills: [SAMPLE[1].skill, SAMPLE[2].skill],
    });
    expect(await (await progressGet(get("/api/sat/progress?tz=UTC"))).json()).toMatchObject({ reviews_due: 3, reviews_waiting: 1 });
    db.tables.sat_questions.find((q) => q.id === SAMPLE[4].id)!.status = "retired";
    resetSatBankCache();
    expect(await (await progressGet(get("/api/sat/progress?tz=UTC"))).json()).toMatchObject({ reviews_due: 3, reviews_waiting: 0 });
    // nothing scheduled: zeros
    db.tables.sat_reviews = [];
    expect(await (await progressGet(get("/api/sat/progress"))).json()).toMatchObject({ reviews_due: 0, reviews_waiting: 0 });
  });

  it("400 for a zone this runtime does not know, on next and on attempts", async () => {
    expect((await nextGet(get("/api/sat/next?tz=Mars/Olympus"))).status).toBe(400);
    expect((await nextGet(get("/api/sat/next?tz=not%20a%20zone"))).status).toBe(400);
    expect((await attemptsPost(post("/api/sat/attempts", { question_id: mcq.id, chosen: "A", correct: false, tz: "Mars/Olympus" }))).status).toBe(400);
    expect(db.tables.sat_attempts).toHaveLength(0);
  });
});

describe("v2: the bank's notes", () => {
  it("are passed through unchanged, and a row with none has no note keys (never null)", async () => {
    const withNotes = {
      ...SAMPLE[0],
      nudge: "What do you get when you subtract 4 from both sides?",
      choices: SAMPLE[0].choices!.map((c) => (c.key === "B" ? c : { ...c, why: `A slip that gives ${c.key}.` })),
      solution: { ...SAMPLE[0].solution, desmos_steps: [{ text: "Type the left side as y1 and the right side as y2.", math: "y=3x+4" }] },
      common_wrong: null,
    };
    const spr = { ...SAMPLE[1], nudge: null, common_wrong: [{ answer: "-14", why: "Moved the 6 without changing its sign." }] };
    db.tables.sat_questions = db.tables.sat_questions.map((r) => (r.id === withNotes.id ? withNotes : r.id === spr.id ? spr : { ...r, nudge: null, common_wrong: null }));
    const qs = (await (await nextGet(get("/api/sat/next?skill=" + encodeURIComponent("linear equations in one variable") + "&count=20"))).json()) as { questions: Array<Record<string, unknown>> };
    const a = qs.questions.find((q) => q.id === withNotes.id)!;
    expect(a.nudge).toBe(withNotes.nudge);
    expect(a.choices).toEqual(withNotes.choices);
    expect(a.solution).toEqual(withNotes.solution);
    expect("common_wrong" in a).toBe(false);
    const b = qs.questions.find((q) => q.id === spr.id)!;
    expect("nudge" in b).toBe(false);
    expect(b.common_wrong).toEqual(spr.common_wrong);
    expect(b.review).toBe(false);
  });
});
