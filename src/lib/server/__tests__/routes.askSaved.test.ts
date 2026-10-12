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

import { GET as history } from "@/app/api/live/ask/history/route";
import { DELETE as memoryDelete, GET as memoryGet } from "@/app/api/live/ask/memory/route";
import { resetServerEnvCache } from "@/lib/env";
import { AskHistoryResponseSchema, AskMemoryResponseSchema } from "@/lib/live/ask/contracts";
import { askStoreDeps } from "@/lib/server/ask/store";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { eqOf, fakeDb, type FakeDb, type FakeQuery } from "@/lib/server/ask/__tests__/fakeDb";

const BOARD = "b1000000-0000-4000-8000-000000000001";
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
      return { data: [{ skill: "divide_fractions", outcome: "with_help", lines_written: 2 }] };
    };
    const body = AskHistoryResponseSchema.parse(await (await history(req(path))).json());
    expect(body.turns).toEqual([]);
    expect(body.hello).toEqual({
      greeting: "Welcome back, Maya! Last time you worked on dividing fractions.",
      chips: ["3 more like last time", "Explain dividing fractions to me", "Quiz me on percents", "Help me with my homework"],
    });
    for (const c of userDb.calls.filter((c) => c.table !== "whiteboards" && c.table !== "ask_messages")) expect(eqOf(c, "user_id")).toBe(PARENT.id);
  });

  it("502 when the chat could not be read", async () => {
    userAnswer = (q) => (q.table === "whiteboards" ? { data: { id: BOARD } } : { error: { code: "57014", message: "statement timeout" } });
    const res = await history(req(path));
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
