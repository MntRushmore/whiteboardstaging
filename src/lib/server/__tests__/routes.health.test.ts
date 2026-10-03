/**
 * GET /api/health and its database probe. The probe asks PostgREST one question with the anon key:
 * Postgres's own answer (rows, or the `42501 permission denied` anon always gets) is "up";
 * a 5xx, a PostgREST connection error, a paused project, a timeout or a network error is "down".
 * The handler answers exactly { ok, db, release }, no-store, 200 or 503, rate limited per IP.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { resetServerEnvCache } from "@/lib/env";
import { DB_PROBE_TIMEOUT_MS, probeDatabase } from "@/lib/server/health";
import { resetRateLimits } from "@/lib/server/rate-limit";

const ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of ENV_VARS) savedEnv[name] = process.env[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321/";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  resetServerEnvCache();
  resetRateLimits();
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
});

const reply = (status: number, body?: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), { status }));

describe("probeDatabase", () => {
  it("asks PostgREST with the anon key, a timeout signal and no cache", async () => {
    const fetchImpl = reply(401, { code: "42501", message: "permission denied for table whiteboards" });
    await probeDatabase(fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:54321/rest/v1/whiteboards?select=id&limit=1");
    expect(init?.headers).toEqual({ apikey: "anon-key", Authorization: "Bearer anon-key" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.cache).toBe("no-store");
    expect(DB_PROBE_TIMEOUT_MS).toBe(3000);
  });

  it("up: Postgres refused anon (42501), as the grants say", async () => {
    expect((await probeDatabase(reply(401, { code: "42501", message: "permission denied for table whiteboards" }))).up).toBe(true);
  });

  it("up: a 2xx", async () => {
    expect((await probeDatabase(reply(200, [])))).toMatchObject({ up: true });
  });

  it.each([
    ["PostgREST cannot reach Postgres", 503, { code: "PGRST001", message: "Database client error" }, "status 503 PGRST001"],
    ["connection pool timeout", 504, { code: "PGRST003" }, "status 504 PGRST003"],
    ["a paused project", 540, "Project paused", "status 540"],
    ["a 4xx that is not Postgres", 404, { code: "PGRST205" }, "status 404 PGRST205"],
    ["a gateway error page", 502, "<html>Bad gateway</html>", "status 502"],
  ])("down: %s", async (_label, status, body, reason) => {
    expect(await probeDatabase(reply(status, body))).toMatchObject({ up: false, reason });
  });

  it("down: no answer within the timeout", async () => {
    const hang = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const probe = await probeDatabase(hang, 30);
    expect(probe).toMatchObject({ up: false, reason: "timeout" });
    expect(probe.ms).toBeGreaterThanOrEqual(25);
  });

  it("down: a network error", async () => {
    const refused = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await probeDatabase(refused)).toMatchObject({ up: false, reason: "network: fetch failed" });
  });

  it("down: the server env is invalid, without calling out", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    resetServerEnvCache();
    const fetchImpl = reply(200, []);
    expect(await probeDatabase(fetchImpl)).toMatchObject({ up: false, reason: "server env invalid" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("GET /api/health", () => {
  // The route's probe uses the global fetch: stubbed here as Supabase answering (or not).
  afterEach(() => vi.unstubAllGlobals());
  const request = (ip = "203.0.113.5") => new Request("http://localhost/api/health", { headers: { "x-forwarded-for": ip } });
  const databaseUp = () => vi.stubGlobal("fetch", reply(401, { code: "42501", message: "permission denied for table whiteboards" }));

  it("200 { ok: true, db: 'up', release }, no-store", async () => {
    databaseUp();
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, db: "up", release: "dev" });
  });

  it("503 { ok: false, db: 'down', release }, no-store, and no reason in the body", async () => {
    vi.stubGlobal("fetch", reply(503, { code: "PGRST001", message: "Database client error" }));
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: false, db: "down", release: "dev" });
  });

  it("rate limited per IP: 30 a minute, then 429", async () => {
    databaseUp();
    for (let i = 0; i < 30; i++) expect((await GET(request("198.51.100.7"))).status).toBe(200);
    const limited = await GET(request("198.51.100.7"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await GET(request("198.51.100.8"))).status).toBe(200);
  });
});
