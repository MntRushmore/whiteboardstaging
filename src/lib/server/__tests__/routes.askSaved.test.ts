/**
 * GET /api/live/ask/history and GET/DELETE /api/live/ask/memory through their real handlers.
 * supabase-js is faked for what the routes do themselves (the bearer token, the rate limit); the
 * Ask tables are the store's fake (`askStoreDeps`), and the family tables a fake `familyDeps`
 * store. The contract: 401 before anything, each route's own bucket, the board must be the
 * caller's (404 otherwise), the hello only for a board with no chat, a kid's memory only for their
 * own grown-up, and no-store with X-Request-Id on every answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

const fake = vi.hoisted(() => ({
  users: new Map<string, { id: string; email: string }>(),
  rateLimit: { allowed: true, remaining: 19, retry_after_ms: 0, backend: "db" } as Record<string, unknown>,
  buckets: [] as string[],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const user = fake.users.get(token);
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid token", status: 401 } };
      },
    },
    rpc: async (fn: string, args?: { p_bucket?: string }) => {
      if (fn !== "rate_limit_hit") return { data: null, error: { message: `no fake for ${fn}` } };
      fake.buckets.push(String(args?.p_bucket));
      return { data: fake.rateLimit, error: null };
    },
  }),
}));

const family = vi.hoisted(() => ({ links: new Map<string, { parentId: string; kids: string[] } | null>(), missing: false }));
vi.mock("@/lib/family/server/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/family/server/store")>();
  return {
    ...real,
    familyDeps: {
      store: () => (family.missing ? null : ({ links: async (id: string) => family.links.get(id) ?? null } as unknown as import("@/lib/family/server/store").FamilyStore)),
      now: () => Date.now(),
    },
  };
});

import { POST as move } from "@/app/api/live/ask/history/move/route";
import { GET as history } from "@/app/api/live/ask/history/route";
import { DELETE as memoryDelete, GET as memoryGet } from "@/app/api/live/ask/memory/route";
import { resetServerEnvCache } from "@/lib/env";
import { AskHistoryResponseSchema, AskMemoryResponseSchema, AskMoveResponseSchema } from "@/lib/live/ask/contracts";
import { askStoreDeps } from "@/lib/server/ask/store";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { eqOf, fakeDb, orOf, type FakeDb, type FakeQuery } from "@/lib/server/ask/__tests__/fakeDb";

const BOARD = "b1000000-0000-4000-8000-000000000001";
const hoursAgoIso = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const PARENT = { id: "00000000-0000-4000-8000-000000000001", email: "parent@example.com" };
const KID = { id: "00000000-0000-4000-8000-000000000002", email: "maya@kids.agathon.app" };
const OTHER_KID = "00000000-0000-4000-8000-000000000003";
const TOKENS = { parent: "parent.token.aaaa", kid: "kid.token.aaaa" };

const ENV_VARS = ["SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"];
const savedEnv: Record<string, string | undefined> = {};
const realDeps = { ...askStoreDeps };

let userDb: FakeDb;
let serviceDb: FakeDb;
let userAnswer: (q: FakeQuery) => { data?: unknown; error?: { code?: string; message?: string } | null };
let serviceAnswer: (q: FakeQuery) => { data?: unknown; error?: { code?: string; message?: string } | null };

function req(path: string, method = "GET", token: string | null = TOKENS.parent): Request {
  return new Request(`http://localhost${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

beforeEach(() => {
  for (const name of ENV_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  resetServerEnvCache();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.users.clear();
  fake.users.set(TOKENS.parent, PARENT);
  fake.users.set(TOKENS.kid, KID);
  fake.rateLimit = { allowed: true, remaining: 19, retry_after_ms: 0, backend: "db" };
  fake.buckets.length = 0;
  family.links.clear();
  family.links.set(PARENT.id, { parentId: PARENT.id, kids: [KID.id] });
  family.links.set(KID.id, { parentId: PARENT.id, kids: [KID.id] });
  family.missing = false;
  userAnswer = () => ({ data: [] });
  serviceAnswer = () => ({ data: null });
  userDb = fakeDb((q) => userAnswer(q));
  serviceDb = fakeDb((q) => serviceAnswer(q));
  askStoreDeps.user = () => userDb.client;
  askStoreDeps.service = () => serviceDb.client;
});

afterEach(() => {
  Object.assign(askStoreDeps, realDeps);
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
});

function expectPrivate(res: Response) {
  expect(res.headers.get("X-Request-Id")).toBeTruthy();
  if (res.status !== 401 && res.status !== 429) expect(res.headers.get("Cache-Control")).toBe("no-store");
}

describe("GET /api/live/ask/history", () => {
  const path = `/api/live/ask/history?boardId=${BOARD}`;

  it("401 without a token, before the rate limit or any read", async () => {
    const res = await history(req(path, "GET", null));
    expect(res.status).toBe(401);
    expectPrivate(res);
    expect(fake.buckets).toEqual([]);
    expect(userDb.calls).toEqual([]);
  });

  it("429 from its own bucket", async () => {
    fake.rateLimit = { allowed: false, remaining: 0, retry_after_ms: 900, backend: "db" };
    const res = await history(req(path));
    expect(res.status).toBe(429);
    expect(fake.buckets).toEqual(["liveAskHistory"]);
    expect(userDb.calls).toEqual([]);
  });

  it("400 without a board id", async () => {
    const res = await history(req("/api/live/ask/history"));
    expect(res.status).toBe(400);
    expectPrivate(res);
  });

  it("404 when the board is not the caller's (RLS shows no board), and for an id that is no board id", async () => {
    userAnswer = (q) => (q.table === "whiteboards" ? { data: null } : { data: [] });
    const res = await history(req(path));
    expect(res.status).toBe(404);
    expectPrivate(res);
    expect((await history(req("/api/live/ask/history?boardId=demo"))).status).toBe(404);
  });

  it("a board with a chat: its turns, oldest first, and no hello", async () => {
    userAnswer = (q) =>
      q.table === "whiteboards"
        ? { data: { id: BOARD } }
        : {
            data: [
              { id: "t2", role: "tutor", body: "What is 7 x 4?", notes: [], wrote: ["write_problems"], created_at: "2026-10-11T10:00:01Z" },
              { id: "t1", role: "user", body: "what is 7 x 8", notes: [], wrote: [], created_at: "2026-10-11T10:00:00Z" },
            ],
          };
    const res = await history(req(path));
    expect(res.status).toBe(200);
    expectPrivate(res);
    const body = AskHistoryResponseSchema.parse(await res.json());
    expect(body.turns.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(body.hello).toBeNull();
    // the hello's reads are not made for a board with a chat
    expect(userDb.calls.map((c) => c.table).sort()).toEqual(["ask_messages", "whiteboards"]);
  });

  it("a board with no chat: a hello built from what the tutor knows", async () => {
    userAnswer = (q) => {
      if (q.table === "whiteboards") return { data: { id: BOARD } };
      if (q.table === "ask_messages") return { data: [] };
      if (q.table === "profiles") return { data: { display_name: "Maya", grade: 6, course: null } };
      if (q.table === "learner_memory") return { data: null };
      return { data: [{ skill: "divide_fractions", outcome: "with_help", lines_written: 2, board_id: "other-board", started_at: hoursAgoIso(26) }] };
    };
    const body = AskHistoryResponseSchema.parse(await (await history(req(path))).json());
    expect(body.turns).toEqual([]);
    expect(body.hello).toEqual({
      greeting: "Welcome back, Maya! Last time you worked on dividing fractions.",
      chips: ["3 more like last time", "Explain dividing fractions to me", "Quiz me on percents", "Help me with my homework"],
    });
    for (const c of userDb.calls.filter((c) => c.table !== "whiteboards" && c.table !== "ask_messages")) expect(eqOf(c, "user_id")).toBe(PARENT.id);
  });

  it("'last time' is an earlier session: an attempt on this board, or from the last half hour, is not it", async () => {
    // e2e QA: "Last time you worked on adding to 10." for a row made 9 s earlier on the same board
    let attempts: Array<Record<string, unknown>> = [];
    userAnswer = (q) => {
      if (q.table === "whiteboards") return { data: { id: BOARD } };
      if (q.table === "ask_messages") return { data: [] };
      if (q.table === "profiles") return { data: { display_name: "Maya", grade: 0, course: null } };
      if (q.table === "learner_memory") return { data: null };
      return { data: attempts };
    };
    // only this session's work (this board 9 s ago; another board 10 minutes ago): the first-time hello
    attempts = [
      { skill: "add_within_10", outcome: "first_try", lines_written: 2, board_id: BOARD, started_at: new Date(Date.now() - 9_000).toISOString() },
      { skill: "add_within_20", outcome: "first_try", lines_written: 2, board_id: "other-board", started_at: new Date(Date.now() - 10 * 60_000).toISOString() },
    ];
    const fresh = AskHistoryResponseSchema.parse(await (await history(req(path))).json());
    expect(fresh.hello?.greeting).toBe("Hi Maya! I'm your tutor. Ask me anything, or write a problem on the board.");
    expect(fresh.hello?.chips).not.toContain("3 more like last time");

    // an earlier session's skill behind this session's: that one is "last time"
    attempts = [...attempts, { skill: "times_tables", outcome: "with_help", lines_written: 3, board_id: "older-board", started_at: hoursAgoIso(20) }];
    const back = AskHistoryResponseSchema.parse(await (await history(req(path))).json());
    expect(back.hello?.greeting).toBe("Welcome back, Maya! Last time you worked on times tables.");
    // the same board an hour ago is still this board: never "last time" when it is opened again
    attempts = [{ skill: "times_tables", outcome: "with_help", lines_written: 3, board_id: BOARD, started_at: hoursAgoIso(1) }];
    const same = AskHistoryResponseSchema.parse(await (await history(req(path))).json());
    expect(same.hello?.greeting).toMatch(/^Hi Maya!/);
  });

  it("502 when the chat could not be read", async () => {
    userAnswer = (q) => (q.table === "whiteboards" ? { data: { id: BOARD } } : { error: { code: "57014", message: "statement timeout" } });
    const res = await history(req(path));
    expect(res.status).toBe(502);
    expectPrivate(res);
  });
});

describe("GET /api/live/ask/history: a chat per screen", () => {
  const S1 = "page:page";
  const S2 = "page:k2Hq_9-x";
  const at = (s: string) => `/api/live/ask/history?boardId=${BOARD}&screenId=${encodeURIComponent(s)}`;
  const row = (id: string, screen: string | null) => ({ id, role: "user", body: `turn ${id}`, notes: [], wrote: [], created_at: "2026-10-12T10:00:00Z", screen_id: screen });

  it("a screen's own turns: the filter names that screen only", async () => {
    userAnswer = (q) => (q.table === "whiteboards" ? { data: { id: BOARD } } : { data: [row("t2", S2)] });
    const res = await history(req(`${at(S2)}&first=0`));
    expect(res.status).toBe(200);
    expectPrivate(res);
    const body = AskHistoryResponseSchema.parse(await res.json());
    expect(body.turns).toEqual([expect.objectContaining({ id: "t2", screenId: S2 })]);
    expect(orOf(userDb.calls.find((c) => c.table === "ask_messages")!)).toBe(`screen_id.eq."${S2}"`);
  });

  it("the first screen (first=1): its own turns and the ones saved without a screen", async () => {
    userAnswer = (q) => (q.table === "whiteboards" ? { data: { id: BOARD } } : { data: [row("t1", S1), row("t0", null)] });
    const body = AskHistoryResponseSchema.parse(await (await history(req(`${at(S1)}&first=1`))).json());
    expect(body.turns.map((t) => [t.id, t.screenId])).toEqual([
      ["t0", null],
      ["t1", S1],
    ]);
    expect(orOf(userDb.calls.find((c) => c.table === "ask_messages")!)).toBe(`screen_id.eq."${S1}",screen_id.is.null`);
  });

  it("an empty first screen gets today's hello; an empty later screen the new screen's, following this board's work", async () => {
    userAnswer = (q) => {
      if (q.table === "whiteboards") return { data: { id: BOARD } };
      if (q.table === "ask_messages") return { data: [] };
      if (q.table === "profiles") return { data: { display_name: "Maya", grade: 5, course: null } };
      if (q.table === "learner_memory") return { data: null };
      return {
        data: [
          // this board, a minute ago (the screen before): what a new screen follows from
          { skill: "divide_fractions", outcome: "with_help", lines_written: 2, board_id: BOARD, started_at: new Date(Date.now() - 60_000).toISOString() },
          // another board, yesterday: "last time" for the first screen
          { skill: "times_tables", outcome: "first_try", lines_written: 2, board_id: "other-board", started_at: hoursAgoIso(26) },
        ],
      };
    };
    const firstHello = AskHistoryResponseSchema.parse(await (await history(req(`${at(S1)}&first=1`))).json()).hello;
    expect(firstHello?.greeting).toBe("Welcome back, Maya! Last time you worked on times tables.");
    const nextHello = AskHistoryResponseSchema.parse(await (await history(req(`${at(S2)}&first=0`))).json()).hello;
    expect(nextHello).toEqual({
      greeting: "New screen! What should we work on?",
      chips: ["3 more on dividing fractions", "Explain dividing fractions to me", "Quiz me on fractions", "Help me with my homework"],
    });
    // never the kid's name on a new screen's quick line
    expect(JSON.stringify(nextHello)).not.toContain("Maya");
  });

  it("400 for a screen id that is not a page id; 404 for another's board, whatever the screen", async () => {
    expect((await history(req(at("screen-2")))).status).toBe(400);
    expect((await history(req(at("page:a b")))).status).toBe(400);
    userAnswer = (q) => (q.table === "whiteboards" ? { data: null } : { data: [row("t9", S2)] });
    expect((await history(req(`${at(S2)}&first=0`))).status).toBe(404);
  });
});

describe("POST /api/live/ask/history/move", () => {
  const S2 = "page:k2Hq_9-x";
  const T1 = "c1000000-0000-4000-8000-000000000001";
  const T2 = "c1000000-0000-4000-8000-000000000002";
  const post = (body: unknown, token: string | null = TOKENS.kid) =>
    move(new Request("http://localhost/api/live/ask/history/move", { method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) }));

  it("401 without a token, before the rate limit or any write", async () => {
    const res = await post({ boardId: BOARD, turnIds: [T1], screenId: S2 }, null);
    expect(res.status).toBe(401);
    expect(fake.buckets).toEqual([]);
    expect(userDb.calls).toEqual([]);
  });

  it("429 from its own bucket", async () => {
    fake.rateLimit = { allowed: false, remaining: 0, retry_after_ms: 900, backend: "db" };
    const res = await post({ boardId: BOARD, turnIds: [T1], screenId: S2 });
    expect(res.status).toBe(429);
    expect(fake.buckets).toEqual(["liveAskMove"]);
    expect(userDb.calls).toEqual([]);
  });

  it("moves the caller's own turns with their token, and says how many", async () => {
    userAnswer = () => ({ data: 2 });
    const res = await post({ boardId: BOARD, turnIds: [T1, T2], screenId: S2 });
    expect(res.status).toBe(200);
    expectPrivate(res);
    expect(AskMoveResponseSchema.parse(await res.json())).toEqual({ moved: 2 });
    expect(userDb.calls).toEqual([expect.objectContaining({ table: "rpc:ask_move_turns", rows: { p_board_id: BOARD, p_turn_ids: [T1, T2], p_screen_id: S2 } })]);
    expect(serviceDb.calls).toEqual([]);
  });

  it("someone else's turns move nothing (0); someone else's board is 404 (the function refuses it)", async () => {
    userAnswer = () => ({ data: 0 });
    expect(await (await post({ boardId: BOARD, turnIds: [T1], screenId: S2 })).json()).toEqual({ moved: 0 });
    userAnswer = () => ({ error: { code: "42501", message: "not a board of yours" } });
    const res = await post({ boardId: BOARD, turnIds: [T1], screenId: S2 });
    expect(res.status).toBe(404);
    expectPrivate(res);
    // a board id that is not one at all: the same 404, nothing asked
    userDb.calls.length = 0;
    expect((await post({ boardId: "demo", turnIds: [T1], screenId: S2 })).status).toBe(404);
    expect(userDb.calls).toEqual([]);
  });

  it("400 for a body the contract refuses: no ids, more than 4, an id that is no saved turn's, a screen that is not a page id", async () => {
    for (const body of [
      { boardId: BOARD, turnIds: [], screenId: S2 },
      { boardId: BOARD, turnIds: [T1, T2, T1, T2, T1], screenId: S2 },
      { boardId: BOARD, turnIds: ["saved_t1"], screenId: S2 },
      { boardId: BOARD, turnIds: [T1], screenId: "screen-2" },
      { turnIds: [T1], screenId: S2 },
    ]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(userDb.calls).toEqual([]);
  });

  it("503 before the migration (no function: the turns stay where they were asked); 502 when it fails", async () => {
    userAnswer = () => ({ error: { code: "PGRST202", message: "Could not find the function public.ask_move_turns" } });
    expect((await post({ boardId: BOARD, turnIds: [T1], screenId: S2 })).status).toBe(503);
    userAnswer = () => ({ error: { code: "57014", message: "timeout" } });
    const res = await post({ boardId: BOARD, turnIds: [T1], screenId: S2 });
    expect(res.status).toBe(502);
    expectPrivate(res);
  });
});

describe("GET and DELETE /api/live/ask/memory", () => {
  it("401 without a token; 429 from its own bucket", async () => {
    expect((await memoryGet(req("/api/live/ask/memory", "GET", null))).status).toBe(401);
    fake.rateLimit = { allowed: false, remaining: 0, retry_after_ms: 500, backend: "db" };
    expect((await memoryDelete(req("/api/live/ask/memory", "DELETE"))).status).toBe(429);
    expect(fake.buckets).toEqual(["liveAskMemory"]);
  });

  it("the caller's own notes, read with their token", async () => {
    userAnswer = () => ({ data: { notes: ["Likes shorter hints"], updated_at: "2026-10-10T09:00:00Z" } });
    const res = await memoryGet(req("/api/live/ask/memory", "GET", TOKENS.kid));
    expect(res.status).toBe(200);
    expectPrivate(res);
    expect(AskMemoryResponseSchema.parse(await res.json())).toEqual({ notes: ["Likes shorter hints"], updatedAt: "2026-10-10T09:00:00Z" });
    expect(eqOf(userDb.calls[0], "user_id")).toBe(KID.id);
    expect(serviceDb.calls).toEqual([]);
  });

  it("DELETE clears the caller's own notes (their token) and answers none", async () => {
    const res = await memoryDelete(req("/api/live/ask/memory", "DELETE"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notes: [], updatedAt: null });
    expect(userDb.calls[0]).toMatchObject({ table: "learner_memory", op: "delete" });
    expect(eqOf(userDb.calls[0], "user_id")).toBe(PARENT.id);
  });

  it("502 when the notes could not be read or cleared", async () => {
    userAnswer = () => ({ error: { code: "57014", message: "timeout" } });
    expect((await memoryGet(req("/api/live/ask/memory"))).status).toBe(502);
    expect((await memoryDelete(req("/api/live/ask/memory", "DELETE"))).status).toBe(502);
  });

  it("a grown-up reads and clears their own kid's notes (service role)", async () => {
    serviceAnswer = (q) => (q.op === "delete" ? { data: null } : { data: { notes: ["Likes dinosaurs"], updated_at: null } });
    const read = await memoryGet(req(`/api/live/ask/memory?kidId=${KID.id}`));
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ notes: ["Likes dinosaurs"], updatedAt: null });
    const cleared = await memoryDelete(req(`/api/live/ask/memory?kidId=${KID.id}`, "DELETE"));
    expect(cleared.status).toBe(200);
    expect(serviceDb.calls.map((c) => [c.op, eqOf(c, "user_id")])).toEqual([
      ["select", KID.id],
      ["delete", KID.id],
    ]);
    expect(userDb.calls).toEqual([]);
  });

  it("never another family's kid (404), never for a kid profile (403), a bad id is 400, no service role is 503", async () => {
    expect((await memoryGet(req(`/api/live/ask/memory?kidId=${OTHER_KID}`))).status).toBe(404);
    // a kid asking about a sibling, or about their grown-up
    expect((await memoryDelete(req(`/api/live/ask/memory?kidId=${PARENT.id}`, "DELETE", TOKENS.kid))).status).toBe(403);
    expect((await memoryGet(req("/api/live/ask/memory?kidId=nope"))).status).toBe(400);
    family.missing = true;
    expect((await memoryGet(req(`/api/live/ask/memory?kidId=${KID.id}`))).status).toBe(503);
    expect(serviceDb.calls).toEqual([]);
  });

  it("a kid id that is the caller's own is the caller's own notes", async () => {
    userAnswer = () => ({ data: null });
    const res = await memoryGet(req(`/api/live/ask/memory?kidId=${KID.id}`, "GET", TOKENS.kid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notes: [], updatedAt: null });
    expect(serviceDb.calls).toEqual([]);
  });
});
