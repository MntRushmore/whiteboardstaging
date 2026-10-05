/**
 * GET /api/admin/overview: requireAdmin first (its 401 and 404 pass through untouched, before any
 * read or rate limit), then the operator bucket, then the overview read with the service role
 * (fixtures/fakeSupabase.ts stands in for PostgREST), answered no-store in the contract's shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/server/admin", () => ({ requireAdmin: gate.requireAdmin }));

import { GET } from "@/app/api/admin/overview/route";
import { AdminOverviewSchema } from "@/lib/admin/contracts";
import { resetServerEnvCache } from "@/lib/env";
import { resetOverviewCaches } from "@/lib/server/adminOverview";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { adminTables, EMAILS, NOW } from "./fixtures/adminTables";
import { fakeSupabase } from "./fixtures/fakeSupabase";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co/",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  OPENROUTER_API_KEY: "sk-or-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const saved: Record<string, string | undefined> = {};

const ADMIN = { id: "00000000-0000-4000-8000-00000000a0a0", email: "rushilchopra@gmail.com" };
const request = () => new Request("http://localhost/api/admin/overview", { headers: { Authorization: "Bearer a.b.c" } });

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  resetServerEnvCache();
  resetRateLimits();
  resetOverviewCaches();
  gate.requireAdmin.mockReset();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});

afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetServerEnvCache();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GET /api/admin/overview", () => {
  it("a non-admin gets requireAdmin's 404, and nothing is read", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    gate.requireAdmin.mockResolvedValue({ response: new Response(null, { status: 404 }) });
    const res = await GET(request());
    expect(res.status).toBe(404);
    expect(gate.requireAdmin).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("signed out gets requireAdmin's 401", async () => {
    gate.requireAdmin.mockResolvedValue({ response: Response.json({ error: "unauthorized", message: "You need to be signed in to use this feature." }, { status: 401 }) });
    const res = await GET(new Request("http://localhost/api/admin/overview"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
  });

  it("an admin gets the overview, in the contract's shape, never cached", async () => {
    gate.requireAdmin.mockResolvedValue({ user: ADMIN });
    const db = fakeSupabase(adminTables(), { users: EMAILS });
    vi.stubGlobal("fetch", db.fetch);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const body = await res.json();
    expect(AdminOverviewSchema.safeParse(body).success).toBe(true);
    expect(body.errors.total24h).toBe(19);
    // the trailing slash in the env's URL does not double up
    expect(db.calls.every((c) => !c.path.startsWith("//"))).toBe(true);
  });

  it("503 without the service role key", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetServerEnvCache();
    gate.requireAdmin.mockResolvedValue({ user: ADMIN });
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "feature_unavailable", message: "SUPABASE_SERVICE_ROLE_KEY is not set, so the overview cannot read the tables." });
  });

  it("502 that names what failed", async () => {
    gate.requireAdmin.mockResolvedValue({ user: ADMIN });
    vi.stubGlobal("fetch", fakeSupabase(adminTables(), { users: EMAILS, fail: { app_events: 500 } }).fetch);
    const res = await GET(request());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string; requestId: string };
    expect(body.error).toBe("upstream_error");
    expect(body.message).toMatch(/^Couldn't read app_events: status 500/);
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rate limited after 30 a minute", async () => {
    gate.requireAdmin.mockResolvedValue({ user: ADMIN });
    vi.stubGlobal("fetch", fakeSupabase({}, {}).fetch);
    for (let i = 0; i < 30; i++) expect((await GET(request())).status).toBe(200);
    const limited = await GET(request());
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: string }).error).toBe("rate_limited");
  });
});
