/**
 * SAT mode without an account (docs/SAT-MODE.md, owner 2026-10-22), through the real handlers:
 *
 *  - POST /api/sat/anon: App Attest only (no headers, a web request, the debug id in production:
 *    403); an attested key's assertion over the body gives a session; an unknown key 403; a bad body
 *    400; 5 a day per device and 20 an hour per IP (429); Auth with anonymous sign-ins off: 503;
 *  - an anonymous session on the rest of the API: the SAT routes work with the anonymous cap (5;
 *    20 for a signed-in free account), the Live routes only with sat_question_id and only the tutor's,
 *    and every other route that needs a user refuses it with 403 `account_required`.
 *
 * Fakes: supabase-js (token checks: one anonymous user, one real), the App Attest key store (in
 * memory), the SAT store's clients, the anonymous sign-in. The guard, the verifier and the limits are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  ANON_TOKEN: "anon.token.sig",
  REAL_TOKEN: "real.token.sig",
  ANON_ID: "aaaaaaaa-2222-4333-8444-555555555555",
  REAL_ID: "bbbbbbbb-2222-4333-8444-555555555555",
  rpcCalls: [] as string[],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.ANON_TOKEN
          ? { data: { user: { id: fake.ANON_ID, email: null, is_anonymous: true } }, error: null }
          : token === fake.REAL_TOKEN
            ? { data: { user: { id: fake.REAL_ID, email: "teen@example.com", is_anonymous: false } }, error: null }
            : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async (fn: string) => {
      fake.rpcCalls.push(fn);
      if (fn === "sat_tutor_spend") return { data: { unlimited: false, allowed: true, reason: null, remaining: 0 }, error: null };
      return { data: { ok: true, remaining: 10, reason: null }, error: null };
    },
  }),
}));
vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/mathpix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mathpix")>();
  return { ...actual, isMathpixConfigured: () => true, recognizeStrokes: vi.fn(async () => ({ ok: true, latex: "x=4", text: "x=4", confidence: 0.97, raw: {} })), recognizeImage: vi.fn() };
});

import type { SupabaseClient } from "@supabase/supabase-js";
import { resetServerEnvCache } from "@/lib/env";
import { logger } from "@/lib/logger";
import { SAT_ANON_LIMITS } from "@/lib/sat/contracts";
import { DEFAULT_APP_ID } from "@/lib/server/appAttest/config";
import { appAttestDeps, type AttestStore, type StoredKey } from "@/lib/server/appAttest/store";
import { makeAssertion, makeDevice, type TestDevice } from "@/lib/server/appAttest/__tests__/attestKit";
import { resetBillingWarnings } from "@/lib/server/billing";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { satAnonDeps } from "@/lib/server/sat/anon";
import { resetSatBankCache, satStoreDeps } from "@/lib/server/sat/store";
import { POST as anonRoute } from "@/app/api/sat/anon/route";
import { POST as tutorRoute } from "@/app/api/sat/tutor/route";
import { POST as recognizeRoute } from "@/app/api/live/recognize/route";
import { POST as speakRoute } from "@/app/api/live/speak/route";
import { GET as creditsRoute } from "@/app/api/credits/route";
import { POST as appleRoute } from "@/app/api/billing/apple/transaction/route";
import { POST as welcomeRoute } from "@/app/api/email/welcome/route";
import { POST as kidsRoute } from "@/app/api/family/kids/route";
import { GET as askHistoryRoute } from "@/app/api/live/ask/history/route";

const ENV_VARS = ["BILLING_ENFORCE", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "SAT_FREE_TUTOR_PER_DAY", "SAT_ANON_TUTOR_PER_DAY"] as const;
const saved: Record<string, string | undefined> = {};
const realAttest = { store: appAttestDeps.store, debugAllowed: appAttestDeps.debugAllowed };
const realSat = { ...satStoreDeps };
const realSignIn = satAnonDeps.signIn;

let keys: Map<string, StoredKey>;
const SESSION = { access_token: "a.b.c", refresh_token: "r-1", expires_at: 1_792_800_000, user_id: fake.ANON_ID };
let signIn: { ok: true; session: typeof SESSION } | { ok: false; disabled: boolean; message: string };
let passes: Array<{ profile: string; question: string; cap: number }>;

function memoryStore(): AttestStore {
  return {
    async saveChallenge() {},
    async consumeChallenge() { return false; },
    async saveKey() { return "created"; },
    async getKey(id) { return keys.get(id) ?? null; },
    async advanceCounter(id, count) {
      const k = keys.get(id);
      if (!k || !(k.signCount < count)) return false;
      k.signCount = count;
      return true;
    },
  };
}

beforeEach(() => {
  for (const name of ENV_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.BILLING_ENFORCE = "1";
  process.env.RATE_LIMIT_BACKEND = "memory";
  resetServerEnvCache();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  resetBillingWarnings();
  resetSatBankCache();
  keys = new Map();
  appAttestDeps.store = memoryStore;
  appAttestDeps.debugAllowed = () => true;
  signIn = { ok: true, session: SESSION };
  satAnonDeps.signIn = async () => signIn;
  passes = [];
  fake.rpcCalls.length = 0;
  satStoreDeps.service = () =>
    ({
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        passes.push({ profile: String(args.p_profile_id), question: String(args.p_question_id), cap: Number(args.p_cap) });
        return { data: { allowed: true, used_today: 1, cap: args.p_cap, unlimited: false }, error: null };
      },
    }) as unknown as SupabaseClient;
  logger.level = "silent";
});

afterEach(() => {
  Object.assign(appAttestDeps, realAttest);
  Object.assign(satStoreDeps, realSat);
  satAnonDeps.signIn = realSignIn;
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
  logger.level = process.env.LOG_LEVEL || "info";
});

const anonReq = (body = "{}", headers: Record<string, string> = {}, ip = "203.0.113.7") =>
  new Request("http://localhost/api/sat/anon", { method: "POST", body, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...headers } });
const DEBUG = { "x-agathon-app-debug": "3f2b8c1e-5d4a-4b6c-9e8f-7a1b2c3d4e5f" };

describe("POST /api/sat/anon", () => {
  it("refuses a request without the app's headers (there is no web path), and the debug id in production", async () => {
    const plain = await anonRoute(anonReq());
    expect(plain.status).toBe(403);
    expect(await plain.json()).toEqual({ error: "invalid_request", reason: "attest_required" });
    const web = await anonRoute(new Request("http://localhost/api/sat/anon", { method: "POST", body: "{}", headers: { "content-type": "application/json", origin: "http://localhost", "sec-fetch-site": "same-origin" } }));
    expect(web.status).toBe(403);
    appAttestDeps.debugAllowed = () => false;
    const prod = await anonRoute(anonReq("{}", DEBUG));
    expect(await prod.json()).toEqual({ error: "invalid_request", reason: "attest_required" });
  });

  it("an attested key's assertion over the body gets an anonymous session; an unknown key or a replay does not", async () => {
    const device: TestDevice = makeDevice();
    keys.set(device.keyId, { keyId: device.keyId, publicKeyPem: device.publicPem, signCount: 0, environment: "development" });
    const headers = (counter: number, d: TestDevice = device) => ({ "x-agathon-app-key": d.keyId, "x-agathon-app-assertion": makeAssertion(d, { appId: DEFAULT_APP_ID, body: "{}", counter }).base64 });
    const ok = await anonRoute(anonReq("{}", headers(1)));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect(await ok.json()).toEqual(SESSION);
    const replay = await anonRoute(anonReq("{}", headers(1)));
    expect(await replay.json()).toEqual({ error: "invalid_request", reason: "attest_invalid" });
    const stranger = makeDevice();
    expect(await (await anonRoute(anonReq("{}", headers(1, stranger)))).json()).toEqual({ error: "invalid_request", reason: "attest_unknown_key" });
  });

  it("400 for a body that is not a JSON object, 413 over 1 KB", async () => {
    expect((await anonRoute(anonReq("[1]", DEBUG))).status).toBe(400);
    expect((await anonRoute(anonReq("nope", DEBUG))).status).toBe(400);
    expect((await anonRoute(anonReq(JSON.stringify({ pad: "x".repeat(SAT_ANON_LIMITS.maxBytes) }), DEBUG))).status).toBe(413);
  });

  it("5 a day per device, 20 an hour per IP", async () => {
    for (let i = 0; i < SAT_ANON_LIMITS.perDevice.limit; i++) expect((await anonRoute(anonReq("{}", DEBUG))).status).toBe(200);
    const sixth = await anonRoute(anonReq("{}", DEBUG));
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBeTruthy();
    resetRateLimits();
    let last = 0;
    for (let i = 0; i <= SAT_ANON_LIMITS.perIp.limit; i++) last = (await anonRoute(anonReq("{}", { "x-agathon-app-debug": crypto.randomUUID() }, "198.51.100.9"))).status;
    expect(last).toBe(429);
  });

  it("503 when anonymous sign-ins are off (or Auth fails)", async () => {
    signIn = { ok: false, disabled: true, message: "Anonymous sign-ins are disabled" };
    const res = await anonRoute(anonReq("{}", DEBUG));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });
});

const authed = (path: string, token: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  new Request(`http://localhost${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("an anonymous session on the rest of the API", () => {
  const Q = "algebra-linear-functions-0001";
  const RECOGNIZE = { boardId: "board-1", lineId: "ln_1", strokes: { x: [[1, 2, 3]], y: [[1, 2, 3]] }, bounds: { w: 100, h: 40 } };

  it("SAT tutor: the anonymous cap is 5, a signed-in free account's 20; the env vars move them", async () => {
    await tutorRoute(authed("/api/sat/tutor", fake.ANON_TOKEN, { question_id: Q, tz: "UTC" }));
    await tutorRoute(authed("/api/sat/tutor", fake.REAL_TOKEN, { question_id: Q, tz: "UTC" }));
    expect(passes).toEqual([
      { profile: fake.ANON_ID, question: Q, cap: 5 },
      { profile: fake.REAL_ID, question: Q, cap: 20 },
    ]);
    process.env.SAT_ANON_TUTOR_PER_DAY = "2";
    process.env.SAT_FREE_TUTOR_PER_DAY = "9";
    resetServerEnvCache();
    await tutorRoute(authed("/api/sat/tutor", fake.ANON_TOKEN, { question_id: Q, tz: "UTC" }));
    await tutorRoute(authed("/api/sat/tutor", fake.REAL_TOKEN, { question_id: Q, tz: "UTC" }));
    expect(passes.slice(2).map((p) => p.cap)).toEqual([2, 9]);
  });

  it("Live: the tutor's routes with sat_question_id only", async () => {
    const sat = await recognizeRoute(authed("/api/live/recognize", fake.ANON_TOKEN, { ...RECOGNIZE, sat_question_id: Q }));
    expect(sat.status).toBe(200);
    const plain = await recognizeRoute(authed("/api/live/recognize", fake.ANON_TOKEN, RECOGNIZE));
    expect(plain.status).toBe(403);
    expect(await plain.json()).toMatchObject({ error: "forbidden", reason: "account_required" });
    // read aloud is not the tutor: refused even on an SAT page
    const speak = await speakRoute(authed("/api/live/speak", fake.ANON_TOKEN, { text: "hello", sat_question_id: Q }));
    expect(speak.status).toBe(403);
    // a real account is not touched
    expect((await recognizeRoute(authed("/api/live/recognize", fake.REAL_TOKEN, RECOGNIZE))).status).toBe(200);
  });

  it("every other route that needs a user refuses it: credits, billing, emails, family, Ask history", async () => {
    const calls: Array<[string, () => Promise<Response>]> = [
      ["credits", () => creditsRoute(authed("/api/credits", fake.ANON_TOKEN))],
      ["apple transaction", () => appleRoute(authed("/api/billing/apple/transaction", fake.ANON_TOKEN, { signedTransaction: "x" }))],
      ["welcome email", () => welcomeRoute(authed("/api/email/welcome", fake.ANON_TOKEN, undefined, "POST"))],
      ["family kids", () => kidsRoute(authed("/api/family/kids", fake.ANON_TOKEN, { name: "Sam" }))],
      ["ask history", () => askHistoryRoute(authed("/api/live/ask/history?boardId=b", fake.ANON_TOKEN))],
    ];
    for (const [name, call] of calls) {
      const res = await call();
      expect(res.status, name).toBe(403);
      expect(await res.json(), name).toMatchObject({ error: "forbidden", reason: "account_required" });
    }
    expect(fake.rpcCalls.filter((f) => f === "consume_credits" || f === "ink_summary")).toEqual([]);
  });
});
