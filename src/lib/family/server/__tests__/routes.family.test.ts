/**
 * The /api/family routes through their real handlers, above all POST /api/family/switch: whose
 * session the server will mint. supabase-js is faked for what the routes do themselves (verifying
 * the bearer token, the per-user rate limit); the family tables are the in-memory store in
 * fakeStore.ts, swapped in through `familyDeps`. The contract: 401 before anything, a session only
 * for a member of the caller's own family, the grown-up's only with their PIN, and PIN guesses
 * capped per family.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

const fake = vi.hoisted(() => ({
  // bearer token -> the user Auth says it is
  users: new Map<string, { id: string; email: string }>(),
  rateLimit: { allowed: true, remaining: 19, retry_after_ms: 0, backend: "db" } as Record<string, unknown>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const user = fake.users.get(token);
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid token", status: 401 } };
      },
    },
    rpc: async (fn: string) => (fn === "rate_limit_hit" ? { data: fake.rateLimit, error: null } : { data: null, error: { message: `no fake for ${fn}` } }),
  }),
}));

// the app events the routes record (recordRouteEvent), kept instead of written
const events = vi.hoisted(() => [] as Array<{ level: string; code: string; message: string; meta?: Record<string, unknown> }>);
vi.mock("@/lib/server/request", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/request")>();
  return { ...real, recordRouteEvent: (_log: unknown, event: (typeof events)[number]) => void events.push(event) };
});

const deps = vi.hoisted(() => ({ store: null as import("../store").FamilyStore | null, missing: false }));
vi.mock("@/lib/family/server/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("../store")>();
  return { ...real, familyDeps: { store: () => (deps.missing ? null : deps.store), now: () => Date.parse("2026-10-08T15:00:00Z") } };
});

import { DELETE as familyDelete, GET as familyGet } from "@/app/api/family/route";
import { DELETE as kidDelete, PATCH as kidPatch } from "@/app/api/family/kids/[id]/route";
import { POST as kidsPost } from "@/app/api/family/kids/route";
import { POST as pinPost } from "@/app/api/family/pin/route";
import { POST as switchPost } from "@/app/api/family/switch/route";
import { resetServerEnvCache } from "@/lib/env";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { PIN_ATTEMPTS, PIN_DAILY_LIMIT } from "../pin";
import { KID_ADDS } from "../store";
import { IDS, OTHER_PIN, PIN, makeFakeStore, type FakeStore } from "./fakeStore";

const TOKENS = {
  parent: "parent.token.aaaa",
  kidA: "kida.token.aaaa",
  kidB: "kidb.token.aaaa",
  otherParent: "otherparent.token.aaaa",
  otherKid: "otherkid.token.aaaa",
  solo: "solo.token.aaaa",
} as const;

const ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "RATE_LIMIT_BACKEND"];
const saved: Record<string, string | undefined> = {};
let store: FakeStore;

beforeEach(async () => {
  for (const v of ENV_VARS) saved[v] = process.env[v];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  delete process.env.RATE_LIMIT_BACKEND;
  resetServerEnvCache();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.rateLimit = { allowed: true, remaining: 19, retry_after_ms: 0, backend: "db" };
  events.length = 0;
  store = await makeFakeStore();
  deps.store = store;
  deps.missing = false;
  fake.users = new Map([
    [TOKENS.parent, { id: IDS.parent, email: "parent@example.com" }],
    [TOKENS.kidA, { id: IDS.kidA, email: `kid-${IDS.kidA}@kids.agathon.app` }],
    [TOKENS.kidB, { id: IDS.kidB, email: `kid-${IDS.kidB}@kids.agathon.app` }],
    [TOKENS.otherParent, { id: IDS.otherParent, email: "other@example.com" }],
    [TOKENS.otherKid, { id: IDS.otherKid, email: `kid-${IDS.otherKid}@kids.agathon.app` }],
    [TOKENS.solo, { id: IDS.solo, email: "solo@example.com" }],
  ]);
});

afterEach(() => {
  for (const v of ENV_VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  resetServerEnvCache();
});

function post(path: string, token: string | null, body: unknown, method = "POST"): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const sw = (token: string | null, body: unknown) => switchPost(post("/api/family/switch", token, body));
async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("POST /api/family/switch: who may become whom", () => {
  it("401 without a token, and with a token Auth refuses", async () => {
    expect((await sw(null, { to: IDS.kidA })).status).toBe(401);
    expect((await sw("forged.token.zzzz", { to: IDS.kidA })).status).toBe(401);
    expect(store.minted).toEqual([]);
  });

  it("400 for a body that is not { to: uuid, pin?: 4 digits }", async () => {
    for (const body of [{}, { to: "kid-a" }, { to: IDS.kidA, pin: "123" }, { to: IDS.kidA, pin: 1234 }, { to: IDS.kidA, as: IDS.parent }]) {
      const res = await sw(TOKENS.parent, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(store.minted).toEqual([]);
  });

  it("the grown-up becomes a kid without a PIN; their own session is ended", async () => {
    const res = await sw(TOKENS.parent, { to: IDS.kidA });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body).toEqual({ access_token: `access-for-kid-${IDS.kidA}@kids.agathon.app`, refresh_token: `refresh-for-kid-${IDS.kidA}@kids.agathon.app` });
    expect(store.revoked).toEqual([TOKENS.parent]);
  });

  it("a kid becomes a sibling without a PIN", async () => {
    const res = await sw(TOKENS.kidA, { to: IDS.kidB });
    expect(res.status).toBe(200);
    expect(store.minted).toEqual([`kid-${IDS.kidB}@kids.agathon.app`]);
    expect(store.pinHits.size).toBe(0);
  });

  it("a solo account is refused (404), and nothing is minted", async () => {
    const res = await sw(TOKENS.solo, { to: IDS.kidA });
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe("not_found");
    expect(store.minted).toEqual([]);
  });

  it("another family's grown-up or kid cannot reach this family (404), PIN or not", async () => {
    for (const [token, to, pin] of [
      [TOKENS.otherParent, IDS.kidA, undefined],
      [TOKENS.otherKid, IDS.kidB, undefined],
      [TOKENS.otherKid, IDS.parent, PIN],
      [TOKENS.otherParent, IDS.parent, PIN],
    ] as const) {
      const res = await sw(token, { to, ...(pin ? { pin } : {}) });
      expect(res.status, `${token} -> ${to}`).toBe(404);
    }
    expect(store.minted).toEqual([]);
    // the other family's PIN budget was never touched, and nor was this one's
    expect(store.pinHits.size).toBe(0);
  });

  it("a forged `to` (a made-up id, a solo stranger) answers exactly like another family's kid", async () => {
    const forged = await json(await sw(TOKENS.kidA, { to: IDS.nobody }));
    const stranger = await json(await sw(TOKENS.kidA, { to: IDS.solo }));
    const otherKid = await json(await sw(TOKENS.kidA, { to: IDS.otherKid }));
    const strip = (b: Record<string, unknown>) => ({ ...b, requestId: undefined });
    expect(strip(forged)).toEqual(strip(otherKid));
    expect(strip(stranger)).toEqual(strip(otherKid));
    expect(store.minted).toEqual([]);
  });

  it("switching to yourself is a 400, not a fresh session", async () => {
    expect((await sw(TOKENS.kidA, { to: IDS.kidA })).status).toBe(400);
    expect(store.minted).toEqual([]);
  });
});

describe("POST /api/family/switch: the grown-up's PIN", () => {
  it("is required to become the grown-up (400 pin_required, not counted)", async () => {
    const res = await sw(TOKENS.kidA, { to: IDS.parent });
    expect(res.status).toBe(400);
    expect((await json(res)).reason).toBe("pin_required");
    expect(store.pinHits.get(IDS.parent) ?? 0).toBe(0);
  });

  it("a wrong PIN is 403 wrong_pin with the tries left; nothing is minted", async () => {
    const res = await sw(TOKENS.kidA, { to: IDS.parent, pin: "0000" });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: "invalid_request", reason: "wrong_pin", triesLeft: 4 });
    expect(store.minted).toEqual([]);
    expect(store.revoked).toEqual([]);
  });

  it("another family's PIN does not open this family", async () => {
    expect((await sw(TOKENS.kidA, { to: IDS.parent, pin: OTHER_PIN })).status).toBe(403);
  });

  it("the right PIN gives the grown-up's session back, and that try is not counted", async () => {
    await sw(TOKENS.kidA, { to: IDS.parent, pin: "0000" });
    const res = await sw(TOKENS.kidB, { to: IDS.parent, pin: PIN });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ access_token: "access-for-parent@example.com", refresh_token: "refresh-for-parent@example.com" });
    expect(store.revoked).toEqual([TOKENS.kidB]);
    expect(store.pinHits.get(IDS.parent)).toBe(1);
  });

  it("5 wrong tries per family, then 429 for everyone in it (even with the right PIN); other families unaffected", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await sw(i % 2 ? TOKENS.kidB : TOKENS.kidA, { to: IDS.parent, pin: `000${i}` });
      expect(res.status).toBe(403);
      expect((await json(res)).triesLeft).toBe(4 - i);
    }
    for (const token of [TOKENS.kidA, TOKENS.kidB]) {
      const res = await sw(token, { to: IDS.parent, pin: PIN });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
      expect((await json(res)).error).toBe("rate_limited");
    }
    expect(store.minted).toEqual([]);
    // the other family still gets in with its own PIN
    expect((await sw(TOKENS.otherKid, { to: IDS.otherParent, pin: OTHER_PIN })).status).toBe(200);
    // and switching between kids needs no PIN, so it still works
    expect((await sw(TOKENS.kidA, { to: IDS.kidB })).status).toBe(200);
  });

  it(`the day's ${PIN_DAILY_LIMIT}th wrong PIN locks the family: 403 locked:true and one app event, then 429 pin_locked even for the right PIN`, async () => {
    for (let i = 0; i < PIN_DAILY_LIMIT; i++) {
      if (i % PIN_ATTEMPTS.limit === 0) store.pinHits.clear(); // a new 15-minute window
      const res = await sw(i % 2 ? TOKENS.kidB : TOKENS.kidA, { to: IDS.parent, pin: `00${String(i).padStart(2, "0")}` });
      expect(res.status).toBe(403);
      const body = await json(res);
      expect(body.reason).toBe("wrong_pin");
      expect(body.locked).toBe(i === PIN_DAILY_LIMIT - 1 ? true : undefined);
    }
    expect(events).toEqual([expect.objectContaining({ level: "warn", code: "pin_locked", meta: expect.objectContaining({ parentId: IDS.parent }) })]);

    store.pinHits.clear();
    const res = await sw(TOKENS.kidA, { to: IDS.parent, pin: PIN });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body).toMatchObject({ error: "rate_limited", reason: "pin_locked" });
    expect(body.retryAfterMs).toBeGreaterThan(60 * 60_000);
    expect(store.minted).toEqual([]);
    // the lockout is recorded once, not on every refused try
    expect(events).toHaveLength(1);
  }, 30_000); // eleven scrypt checks

  it("refuses the PIN (503 pin_unavailable) when the database's counter cannot be asked: never an uncounted try", async () => {
    store.pinUnavailable = true;
    const res = await sw(TOKENS.kidA, { to: IDS.parent, pin: PIN });
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: "feature_unavailable", reason: "pin_unavailable" });
    expect(store.minted).toEqual([]);
  });

  it("the per-caller budget answers 429 before anything is read", async () => {
    fake.rateLimit = { allowed: false, remaining: 0, retry_after_ms: 30_000, backend: "db" };
    const res = await sw(TOKENS.kidA, { to: IDS.parent, pin: PIN });
    expect(res.status).toBe(429);
    expect(store.pinHits.size).toBe(0);
    expect(store.minted).toEqual([]);
  });

  it("503 without the service role", async () => {
    deps.missing = true;
    expect((await sw(TOKENS.parent, { to: IDS.kidA })).status).toBe(503);
  });

  it("502 (nothing changed) when Auth cannot mint the session", async () => {
    store.mintSession = async () => {
      throw new Error("sign-in link not made: boom");
    };
    const res = await sw(TOKENS.parent, { to: IDS.kidA });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await json(res))).not.toContain("boom");
    expect(store.revoked).toEqual([]);
  });
});

describe("the other /api/family routes", () => {
  it("GET answers the caller's own family; 401 without a token", async () => {
    expect((await familyGet(new Request("http://localhost/api/family"))).status).toBe(401);
    const res = await familyGet(new Request("http://localhost/api/family?tz=300", { headers: { Authorization: `Bearer ${TOKENS.parent}` } }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.role).toBe("parent");
    expect((body.members as unknown[]).length).toBe(3);
  });

  it("a kid cannot set the PIN, add, edit or remove anyone", async () => {
    expect((await pinPost(post("/api/family/pin", TOKENS.kidA, { pin: "0000" }))).status).toBe(403);
    expect((await kidsPost(post("/api/family/kids", TOKENS.kidA, { displayName: "X", grade: 1, avatar: "fox" }))).status).toBe(403);
    const ctx = { params: Promise.resolve({ id: IDS.kidB }) };
    expect((await kidPatch(post(`/api/family/kids/${IDS.kidB}`, TOKENS.kidA, { grade: 2 }, "PATCH"), ctx)).status).toBe(403);
    expect((await kidDelete(post(`/api/family/kids/${IDS.kidB}`, TOKENS.kidA, undefined, "DELETE"), { params: Promise.resolve({ id: IDS.kidB }) })).status).toBe(403);
    expect((await familyDelete(post("/api/family", TOKENS.kidA, undefined, "DELETE"))).status).toBe(403);
    expect(store.deleted).toEqual([]);
  });

  it("a grown-up cannot edit or remove another family's kid (404)", async () => {
    expect((await kidPatch(post(`/api/family/kids/${IDS.otherKid}`, TOKENS.parent, { grade: 2 }, "PATCH"), { params: Promise.resolve({ id: IDS.otherKid }) })).status).toBe(404);
    expect((await kidDelete(post(`/api/family/kids/${IDS.otherKid}`, TOKENS.parent, undefined, "DELETE"), { params: Promise.resolve({ id: IDS.otherKid }) })).status).toBe(404);
    expect(store.deleted).toEqual([]);
  });

  it("adding a kid without the grown-up's Unlimited is 409 plan_required, with the words the Family page shows", async () => {
    store.noPlan.add(IDS.parent);
    const res = await kidsPost(post("/api/family/kids", TOKENS.parent, { displayName: "Cleo", grade: 2, avatar: "panda" }));
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: "invalid_request", reason: "plan_required", message: "Start your free trial to add kids." });
    expect(store.created).toEqual([]);
  });

  it("past the day's kid adds, 429 kid_add_limit with its own words", async () => {
    store.kidAdds.set(IDS.parent, KID_ADDS.limit);
    const res = await kidsPost(post("/api/family/kids", TOKENS.parent, { displayName: "Cleo", grade: 2, avatar: "panda" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await json(res)).toMatchObject({ error: "rate_limited", reason: "kid_add_limit", message: expect.stringMatching(/tomorrow/) });
    expect(store.created).toEqual([]);
  });

  it("DELETE /api/family removes the kids' images, never their accounts", async () => {
    const res = await familyDelete(post("/api/family", TOKENS.parent, undefined, "DELETE"));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ removed: 2 });
    expect(store.imagesCleared).toEqual([IDS.kidA, IDS.kidB]);
    expect(store.deleted).toEqual([]);
  });

  it("validates the add-kid body", async () => {
    for (const body of [{ displayName: "", grade: 1, avatar: "fox" }, { displayName: "A", grade: 9, avatar: "fox" }, { displayName: "A", grade: 1, avatar: "dragon" }, { displayName: "x".repeat(31), grade: 1, avatar: "fox" }]) {
      expect((await kidsPost(post("/api/family/kids", TOKENS.parent, body))).status, JSON.stringify(body)).toBe(400);
    }
    const ok = await kidsPost(post("/api/family/kids", TOKENS.parent, { displayName: " Cleo ", grade: null, avatar: "panda" }));
    expect(ok.status).toBe(201);
    expect((await json(ok)).displayName).toBe("Cleo");
  });
});
