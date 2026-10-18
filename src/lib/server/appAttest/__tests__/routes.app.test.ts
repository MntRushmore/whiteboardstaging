/**
 * The iPad app's path through the real handlers: POST /api/app/attest/challenge and /register, and
 * the guard on POST /api/try/check, /api/try/help and /api/start/step (src/lib/server/appAttest/
 * guard.ts). The web path is unchanged beside it; a request with the app's headers takes the app
 * path; the debug bypass works off production only; the limits hold per attested key (and per IP).
 *
 * Fakes: the key store (in memory, the same one-time and conditional rules as the SQL), Apple's root
 * (a throwaway CA, attestKit.ts), the service role's RPC client (the day caps, the step's row) and
 * Mathpix (a stubbed fetch). The engine, the verifier and the limits are real.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const svc = vi.hoisted(() => ({ client: null as null | { rpc: Rpc } }));
vi.mock("@/lib/server/billing", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/billing")>();
  return { ...real, serviceClient: () => svc.client };
});

import { POST as challengeRoute } from "@/app/api/app/attest/challenge/route";
import { POST as registerRoute } from "@/app/api/app/attest/register/route";
import { POST as stepRoute } from "@/app/api/start/step/route";
import { POST as checkRoute } from "@/app/api/try/check/route";
import { POST as helpRoute } from "@/app/api/try/help/route";
import { resetServerEnvCache } from "@/lib/env";
import { MATHPIX_STROKES_URL } from "@/lib/server/mathpix";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { START_STEP_LIMITS } from "@/lib/server/start/step";
import { TRY_LIMITS } from "@/lib/try/contracts";
import { APP_ATTEST_LIMITS, CHALLENGE_TTL_MS, DEFAULT_APP_ID } from "../config";
import { appAttestDeps, type AttestStore, type NewKey, type StoredKey } from "../store";
import { makeAssertion, makeAttestation, makeDevice, makeTestCa, type TestCa, type TestDevice } from "./attestKit";

const ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  OPENROUTER_API_KEY: "sk-or-test",
  MATHPIX_APP_ID: "mp-app",
  MATHPIX_APP_KEY: "mp-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

// ------------------------------------------------------------------ a key store in memory

interface FakeStore extends AttestStore {
  challenges: Map<string, number>;
  keys: Map<string, StoredKey & { receipt: string | null }>;
  down: boolean;
}

function fakeStore(): FakeStore {
  const challenges = new Map<string, number>();
  const keys = new Map<string, StoredKey & { receipt: string | null }>();
  const store: FakeStore = {
    challenges,
    keys,
    down: false,
    async saveChallenge(challenge, expiresAt, now) {
      if (store.down) throw new Error("db down");
      for (const [c, at] of challenges) if (at < now.getTime()) challenges.delete(c);
      challenges.set(challenge, expiresAt.getTime());
    },
    async consumeChallenge(challenge, now) {
      if (store.down) throw new Error("db down");
      const at = challenges.get(challenge);
      if (at === undefined || at <= now.getTime()) return false;
      challenges.delete(challenge);
      return true;
    },
    async saveKey(key: NewKey) {
      if (store.down) throw new Error("db down");
      if (keys.has(key.keyId)) return "exists";
      keys.set(key.keyId, { keyId: key.keyId, publicKeyPem: key.publicKeyPem, signCount: 0, environment: key.environment, receipt: key.receipt });
      return "created";
    },
    async getKey(keyId) {
      if (store.down) throw new Error("db down");
      const k = keys.get(keyId);
      return k ? { keyId: k.keyId, publicKeyPem: k.publicKeyPem, signCount: k.signCount, environment: k.environment } : null;
    },
    async advanceCounter(keyId, signCount) {
      if (store.down) throw new Error("db down");
      const k = keys.get(keyId);
      if (!k || !(k.signCount < signCount)) return false;
      k.signCount = signCount;
      return true;
    },
  };
  return store;
}

// ------------------------------------------------------------------ the world

let ca: TestCa;
let store: FakeStore;
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> | undefined }>;
const real = { store: appAttestDeps.store, roots: appAttestDeps.roots, debugAllowed: appAttestDeps.debugAllowed, now: appAttestDeps.now };
let clock = Date.parse("2026-10-17T12:00:00Z");

beforeAll(() => {
  ca = makeTestCa();
}, 30_000);

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  resetServerEnvCache();
  resetRateLimits();
  store = fakeStore();
  // a minute ahead: the test certificates are made during the test, valid from the moment openssl signs them
  clock = Date.now() + 60_000;
  appAttestDeps.store = () => store;
  appAttestDeps.roots = () => [ca.root];
  appAttestDeps.now = () => new Date(clock);
  appAttestDeps.debugAllowed = real.debugAllowed;
  rpcCalls = [];
  svc.client = {
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      if (fn === "global_budget_spend") return { data: { allowed: true, remaining: 100, retry_after_ms: 0, backend: "db" }, error: null };
      return { data: null, error: null };
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      if (String(url) === MATHPIX_STROKES_URL) return Response.json({ latex_styled: "7", confidence: 0.98 });
      return new Response(null, { status: 201 });
    }),
  );
});

afterEach(() => {
  Object.assign(appAttestDeps, real);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetServerEnvCache();
});

const IP = "203.0.113.50";

function req(path: string, body: string, headers: Record<string, string> = {}, ip = IP): Request {
  return new Request(`http://localhost:3611${path}`, { method: "POST", body, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...headers } });
}

/** A device whose key is registered in the store (as the register route would). */
function registered(): TestDevice & { count: number } {
  const device = makeDevice();
  store.keys.set(device.keyId, { keyId: device.keyId, publicKeyPem: device.publicPem, signCount: 0, environment: "development", receipt: null });
  return Object.assign(device, { count: 0 });
}

/** The app's headers over `body`, with the device's next counter. */
function signed(device: TestDevice & { count: number }, body: string): Record<string, string> {
  device.count += 1;
  return { "x-agathon-app-key": device.keyId, "x-agathon-app-assertion": makeAssertion(device, { appId: DEFAULT_APP_ID, body, counter: device.count }).base64 };
}

const CHECK = JSON.stringify({ problemId: "k2-0", work: [], strokes: { x: [[10, 20, 30]], y: [[10, 40, 10]] }, bounds: { w: 120, h: 60 } });
const HELP = JSON.stringify({ problemId: "k2-0", work: [] });
const STEP = JSON.stringify({ journeyId: "3f2b8c1e-5d4a-4b6c-9e8f-7a1b2c3d4e5f", event: "start_handoff_kid", meta: { client: "ipad" } });

/** The three routes, each with a body it accepts and the status it answers when all is well. */
const ROUTES = [
  { name: "try/check", path: "/api/try/check", call: checkRoute, body: CHECK, ok: 200, limit: TRY_LIMITS.read.limit },
  { name: "try/help", path: "/api/try/help", call: helpRoute, body: HELP, ok: 200, limit: TRY_LIMITS.help.limit },
  { name: "start/step", path: "/api/start/step", call: stepRoute, body: STEP, ok: 204, limit: START_STEP_LIMITS.perVisitor.limit },
] as const;

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

// ------------------------------------------------------------------ the attest routes

describe("POST /api/app/attest/challenge", () => {
  it("answers a one-time 32-byte challenge (base64url) that lives 5 minutes, kept server-side, never cached", async () => {
    const res = await challengeRoute(req("/api/app/attest/challenge", ""));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const body = (await res.json()) as { challenge: string; expiresAt: string };
    expect(Object.keys(body).sort()).toEqual(["challenge", "expiresAt"]);
    expect(body.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(body.challenge, "base64url")).toHaveLength(32);
    expect(Date.parse(body.expiresAt)).toBe(clock + CHALLENGE_TTL_MS);
    expect(store.challenges.get(body.challenge)).toBe(clock + CHALLENGE_TTL_MS);
  });

  it(`is limited per IP (${APP_ATTEST_LIMITS.challenge.limit} an hour): 429 rate_limited with retryAfterMs`, async () => {
    for (let i = 0; i < APP_ATTEST_LIMITS.challenge.limit; i++) expect((await challengeRoute(req("/api/app/attest/challenge", ""))).status).toBe(200);
    const res = await challengeRoute(req("/api/app/attest/challenge", ""));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await json(res)).toEqual({ error: "rate_limited", retryAfterMs: expect.any(Number) });
    // another address is not held back
    expect((await challengeRoute(req("/api/app/attest/challenge", "", {}, "203.0.113.51"))).status).toBe(200);
  });

  it("503 unavailable without the service role, or when the challenge cannot be kept", async () => {
    appAttestDeps.store = () => null;
    expect(await json(await challengeRoute(req("/api/app/attest/challenge", "")))).toEqual({ error: "unavailable" });
    appAttestDeps.store = () => store;
    store.down = true;
    expect((await challengeRoute(req("/api/app/attest/challenge", ""))).status).toBe(503);
  });
});

describe("POST /api/app/attest/register", () => {
  async function challenge(): Promise<string> {
    return ((await (await challengeRoute(req("/api/app/attest/challenge", ""))).json()) as { challenge: string }).challenge;
  }
  const register = (body: unknown, ip = IP) => registerRoute(req("/api/app/attest/register", JSON.stringify(body), {}, ip));

  it("verifies the attestation, uses up the challenge and keeps the key (201); the same again is 201 and changes nothing", async () => {
    const device = makeDevice();
    const c = await challenge();
    const att = makeAttestation(ca, device, { appId: DEFAULT_APP_ID, challenge: c, environment: "development" });
    const res = await register({ keyId: device.keyId, attestation: att.base64, challenge: c });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    expect(store.keys.get(device.keyId)).toMatchObject({ publicKeyPem: device.publicPem, signCount: 0, environment: "development", receipt: Buffer.from("test receipt").toString("base64") });
    expect(store.challenges.has(c)).toBe(false);
    store.keys.get(device.keyId)!.signCount = 4;
    expect((await register({ keyId: device.keyId, attestation: att.base64, challenge: c })).status).toBe(201);
    expect(store.keys.get(device.keyId)?.signCount).toBe(4);
  });

  it("a production attestation is kept as production; a key id without padding is the same key", async () => {
    const device = makeDevice();
    const c = await challenge();
    const att = makeAttestation(ca, device, { appId: DEFAULT_APP_ID, challenge: c });
    expect((await register({ keyId: device.keyId.replace(/=$/, ""), attestation: att.base64, challenge: c })).status).toBe(201);
    expect(store.keys.get(device.keyId)?.environment).toBe("production");
  });

  it("refuses a used, expired or made-up challenge for a new key (403 attest_invalid)", async () => {
    const first = makeDevice();
    const c = await challenge();
    expect((await register({ keyId: first.keyId, attestation: makeAttestation(ca, first, { appId: DEFAULT_APP_ID, challenge: c }).base64, challenge: c })).status).toBe(201);
    const second = makeDevice();
    const reused = await register({ keyId: second.keyId, attestation: makeAttestation(ca, second, { appId: DEFAULT_APP_ID, challenge: c }).base64, challenge: c });
    expect(reused.status).toBe(403);
    expect(await json(reused)).toEqual({ error: "invalid_request", reason: "attest_invalid" });

    const later = await challenge();
    clock += CHALLENGE_TTL_MS + 1;
    const third = makeDevice();
    expect(await json(await register({ keyId: third.keyId, attestation: makeAttestation(ca, third, { appId: DEFAULT_APP_ID, challenge: later }).base64, challenge: later }))).toEqual({ error: "invalid_request", reason: "attest_invalid" });

    const madeUp = "A".repeat(43);
    expect((await register({ keyId: third.keyId, attestation: makeAttestation(ca, third, { appId: DEFAULT_APP_ID, challenge: madeUp }).base64, challenge: madeUp })).status).toBe(403);
    expect(store.keys.size).toBe(1);
  }, 30_000);

  it("refuses an attestation that fails a step (another challenge, another app, a bad key id) with 403 attest_invalid, keeping the challenge", async () => {
    const device = makeDevice();
    const c = await challenge();
    for (const att of [
      makeAttestation(ca, device, { appId: DEFAULT_APP_ID, challenge: "B".repeat(43) }),
      makeAttestation(ca, device, { appId: "SG4YJW2K5Z.app.agathon.Other", challenge: c }),
      makeAttestation(ca, device, { appId: DEFAULT_APP_ID, challenge: c, counter: 3 }),
    ]) {
      const res = await register({ keyId: device.keyId, attestation: att.base64, challenge: c });
      expect(res.status).toBe(403);
      expect(await json(res)).toEqual({ error: "invalid_request", reason: "attest_invalid" });
    }
    expect((await register({ keyId: makeDevice().keyId, attestation: makeAttestation(ca, device, { appId: DEFAULT_APP_ID, challenge: c }).base64, challenge: c })).status).toBe(403);
    expect((await register({ keyId: "not base64!", attestation: makeAttestation(ca, device, { appId: DEFAULT_APP_ID, challenge: c }).base64, challenge: c })).status).toBe(403);
    expect(store.keys.size).toBe(0);
    expect(store.challenges.has(c)).toBe(true);
  }, 30_000);

  it("400 for a body that is not the schema, 413 past 64 KB, 503 without the store", async () => {
    for (const body of ["", "{}", "not json", JSON.stringify({ keyId: "a", attestation: "b" }), JSON.stringify({ keyId: "a", attestation: "b", challenge: "c", extra: 1 })]) {
      const res = await registerRoute(req("/api/app/attest/register", body));
      expect(res.status, body).toBe(400);
      expect(await json(res)).toEqual({ error: "invalid_request" });
    }
    expect((await registerRoute(req("/api/app/attest/register", "x".repeat(70_000)))).status).toBe(413);
    const device = makeDevice();
    const c = await challenge();
    appAttestDeps.store = () => null;
    expect((await register({ keyId: device.keyId, attestation: makeAttestation(ca, device, { appId: DEFAULT_APP_ID, challenge: c }).base64, challenge: c })).status).toBe(503);
  });

  it(`is limited per IP (${APP_ATTEST_LIMITS.register.limit} an hour)`, async () => {
    for (let i = 0; i < APP_ATTEST_LIMITS.register.limit; i++) await registerRoute(req("/api/app/attest/register", "{}"));
    expect((await registerRoute(req("/api/app/attest/register", "{}"))).status).toBe(429);
  });
});

// ------------------------------------------------------------------ the guard on the three routes

describe.each(ROUTES)("the guard on POST /api/$name", (route) => {
  it("the web path is unchanged: our page gets in; anything else is a plain 403 invalid_request (no reason)", async () => {
    expect((await route.call(req(route.path, route.body, { "sec-fetch-site": "same-origin" }))).status).toBe(route.ok);
    const res = await route.call(req(route.path, route.body, { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "invalid_request" });
    expect((await route.call(req(route.path, route.body))).status).toBe(403);
  }, 30_000);

  it("the app path: a registered key's assertion over the exact body gets in, with no Sec-Fetch-Site at all", async () => {
    const device = registered();
    const res = await route.call(req(route.path, route.body, signed(device, route.body)));
    expect(res.status).toBe(route.ok);
    expect(store.keys.get(device.keyId)?.signCount).toBe(1);
    // the app's headers win over a browser's: a page claiming same-origin with a bad assertion is still refused
    const bad = await route.call(req(route.path, route.body, { "sec-fetch-site": "same-origin", "x-agathon-app-key": device.keyId, "x-agathon-app-assertion": "AAAA" }));
    expect(bad.status).toBe(403);
  }, 30_000);

  it("refuses: an unknown key (attest_unknown_key), a replay, another body, another key's signature (attest_invalid)", async () => {
    const device = registered();
    const stranger = makeDevice();
    const unknown = await route.call(req(route.path, route.body, { "x-agathon-app-key": stranger.keyId, "x-agathon-app-assertion": makeAssertion(stranger, { appId: DEFAULT_APP_ID, body: route.body, counter: 1 }).base64 }));
    expect(unknown.status).toBe(403);
    expect(await json(unknown)).toEqual({ error: "invalid_request", reason: "attest_unknown_key" });

    const headers = signed(device, route.body);
    expect((await route.call(req(route.path, route.body, headers))).status).toBe(route.ok);
    const replay = await route.call(req(route.path, route.body, headers));
    expect(replay.status).toBe(403);
    expect(await json(replay)).toEqual({ error: "invalid_request", reason: "attest_invalid" });

    const other = await route.call(req(route.path, `${route.body} `, signed(device, route.body)));
    expect(await json(other)).toEqual({ error: "invalid_request", reason: "attest_invalid" });

    device.count += 1;
    const forged = { "x-agathon-app-key": device.keyId, "x-agathon-app-assertion": makeAssertion(device, { appId: DEFAULT_APP_ID, body: route.body, counter: device.count, key: stranger.privateKey }).base64 };
    expect(await json(await route.call(req(route.path, route.body, forged)))).toEqual({ error: "invalid_request", reason: "attest_invalid" });
  }, 30_000);

  it("refuses incomplete headers before the body: a key alone or an assertion alone (attest_required), ones that do not decode (attest_invalid)", async () => {
    const device = registered();
    const halves: Array<Record<string, string>> = [{ "x-agathon-app-key": device.keyId }, { "x-agathon-app-assertion": "AAAA" }];
    for (const headers of halves) {
      const res = await route.call(req(route.path, route.body, headers));
      expect(res.status).toBe(403);
      expect(await json(res)).toEqual({ error: "invalid_request", reason: "attest_required" });
    }
    for (const headers of [{ "x-agathon-app-key": "short", "x-agathon-app-assertion": "AAAA" }, { "x-agathon-app-key": device.keyId, "x-agathon-app-assertion": "%%%" }]) {
      expect(await json(await route.call(req(route.path, route.body, headers)))).toEqual({ error: "invalid_request", reason: "attest_invalid" });
    }
    expect(device.count).toBe(0);
  });

  it("the debug bypass: a device uuid alone is let in off production, and refused (attest_required) when NODE_ENV or VERCEL_ENV says production", async () => {
    const debug = { "x-agathon-app-debug": "8a1d6c0e-1f2b-4c3d-9e8f-0a1b2c3d4e5f" };
    expect((await route.call(req(route.path, route.body, debug))).status).toBe(route.ok);
    expect(await json(await route.call(req(route.path, route.body, { "x-agathon-app-debug": "not-a-uuid" })))).toEqual({ error: "invalid_request", reason: "attest_invalid" });

    vi.stubEnv("NODE_ENV", "production");
    const prod = await route.call(req(route.path, route.body, debug));
    expect(prod.status).toBe(403);
    expect(await json(prod)).toEqual({ error: "invalid_request", reason: "attest_required" });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await json(await route.call(req(route.path, route.body, debug)))).toEqual({ error: "invalid_request", reason: "attest_required" });
    // a Vercel preview is a production build: refused too
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await route.call(req(route.path, route.body, debug))).status).toBe(403);
  }, 30_000);

  it(`limits per attested key (the web's ${route.limit} an hour), whatever the address, and per address, whatever the key`, async () => {
    const device = registered();
    for (let i = 0; i < route.limit; i++) {
      const res = await route.call(req(route.path, route.body, signed(device, route.body), `198.51.100.${i % 250}`));
      expect(res.status, `call ${i}`).toBe(route.ok);
    }
    const over = await route.call(req(route.path, route.body, signed(device, route.body), "192.0.2.200"));
    expect(over.status).toBe(429);
    expect(await json(over)).toEqual({ error: "rate_limited", retryAfterMs: expect.any(Number) });
    // the debug bypass is held the same way, per device uuid
    const debugId = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    for (let i = 0; i < route.limit; i++) await route.call(req(route.path, route.body, { "x-agathon-app-debug": debugId }, `10.0.${Math.floor(i / 250)}.${i % 250}`));
    expect((await route.call(req(route.path, route.body, { "x-agathon-app-debug": debugId }, "192.0.2.201"))).status).toBe(429);
    // and one address with many keys is held by the address
    resetRateLimits();
    for (let i = 0; i < route.limit; i++) await route.call(req(route.path, route.body, signed(registered(), route.body)));
    expect((await route.call(req(route.path, route.body, signed(registered(), route.body)))).status).toBe(429);
  }, 120_000);

  it("503 unavailable when the key store cannot be read (fail closed)", async () => {
    const device = registered();
    store.down = true;
    const res = await route.call(req(route.path, route.body, signed(device, route.body)));
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: "unavailable" });
    appAttestDeps.store = () => null;
    expect((await route.call(req(route.path, route.body, signed(device, route.body)))).status).toBe(503);
  });
});

describe("the app path's extras", () => {
  it("try/check still spends the day's read cap for the app, and the step still records the row", async () => {
    const device = registered();
    expect((await checkRoute(req("/api/try/check", CHECK, signed(device, CHECK)))).status).toBe(200);
    expect(rpcCalls.filter((c) => c.fn === "global_budget_spend").map((c) => c.args?.p_bucket)).toEqual(["tryReads"]);
    expect((await stepRoute(req("/api/start/step", STEP, signed(device, STEP)))).status).toBe(204);
    expect(rpcCalls.find((c) => c.fn === "record_start_step")?.args).toEqual({ p_journey: "3f2b8c1e-5d4a-4b6c-9e8f-7a1b2c3d4e5f", p_event: "start_handoff_kid", p_meta: { client: "ipad" } });
  }, 30_000);

  it(`caps the verifications one address may ask for (${APP_ATTEST_LIMITS.verify.limit} an hour), before the store is read`, async () => {
    const stranger = makeDevice();
    const headers = { "x-agathon-app-key": stranger.keyId, "x-agathon-app-assertion": makeAssertion(stranger, { appId: DEFAULT_APP_ID, body: HELP, counter: 1 }).base64 };
    let reads = 0;
    const getKey = store.getKey.bind(store);
    store.getKey = async (id) => {
      reads += 1;
      return getKey(id);
    };
    for (let i = 0; i < APP_ATTEST_LIMITS.verify.limit; i++) await helpRoute(req("/api/try/help", HELP, headers));
    const res = await helpRoute(req("/api/try/help", HELP, headers));
    expect(res.status).toBe(429);
    expect(reads).toBe(APP_ATTEST_LIMITS.verify.limit);
  }, 60_000);
});
