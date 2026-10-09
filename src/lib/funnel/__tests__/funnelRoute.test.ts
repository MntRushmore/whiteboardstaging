/**
 * GET /api/admin/funnel through its real handler and src/lib/server/adminConsole/funnel.ts:
 * requireAdmin's answers pass through before anything is read, the zone is checked, admin_funnel()
 * is called once with the service role, and every failure is named. PostgREST is a stubbed fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

const gate = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/server/admin", () => ({ requireAdmin: gate.requireAdmin }));

import { GET } from "@/app/api/admin/funnel/route";
import { resetServerEnvCache } from "@/lib/env";
import { FunnelReportSchema } from "@/lib/funnel/report";
import { buildFunnel } from "@/lib/server/adminConsole/funnel";
import { ConsoleQueryError } from "@/lib/server/adminConsole/rest";
import { resetRateLimits } from "@/lib/server/rate-limit";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co/",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  OPENROUTER_API_KEY: "sk-or-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const saved: Record<string, string | undefined> = {};
const ADMIN = { id: "00000000-0000-4000-8000-000000000099", email: "owner@example.com" };

const ANSWER = {
  time_zone: "America/Chicago",
  generated_at: "2026-10-09T15:00:00Z",
  active_subscriptions: 2,
  kid_profiles: 1,
  accounts: [
    { week: "2026-10-05", source: "tiktok", stages: ["signed_up", "onboarded", "trial_started", "paid"], canceled: false },
    { week: "2026-10-05", source: "unknown", stages: ["signed_up"], canceled: false },
  ],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const req = (query = "") => new Request(`http://localhost/api/admin/funnel${query}`, { headers: { Authorization: "Bearer a.b.c" } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  resetServerEnvCache();
  resetRateLimits();
  gate.requireAdmin.mockReset();
  gate.requireAdmin.mockResolvedValue({ user: ADMIN });
  fetchMock = vi.fn(async () => json(ANSWER));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetServerEnvCache();
  vi.unstubAllGlobals();
});

describe("GET /api/admin/funnel", () => {
  it("passes requireAdmin's 401 and 404 through, before anything is read", async () => {
    for (const status of [401, 404]) {
      gate.requireAdmin.mockResolvedValueOnce({ response: new Response(null, { status }) });
      expect((await GET(req())).status).toBe(status);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers the report, never cached, calling admin_funnel once in the viewer's zone", async () => {
    const res = await GET(req("?tz=America/Chicago"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(FunnelReportSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ mrrUsd: 50, activeSubscriptions: 2, kidProfiles: 1, timeZone: "America/Chicago" });
    expect(body.totals.counts).toMatchObject({ signed_up: 2, paid: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/rest/v1/rpc/admin_funnel");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ p_tz: "America/Chicago" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer service-key");
  });

  it("reads in New York without a zone, and refuses one that is not a zone", async () => {
    await GET(req());
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ p_tz: "America/New_York" });
    const bad = await GET(req("?tz=Mars%2FOlympus"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_request" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("503 without the service role key", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetServerEnvCache();
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("502 naming the migration when the function is missing, and naming the failure otherwise", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "PGRST202", message: "Could not find the function" }, 404));
    const missing = await GET(req());
    expect(missing.status).toBe(502);
    expect((await missing.json()).message).toMatch(/20261009020000_funnel\.sql/);

    fetchMock.mockResolvedValueOnce(json({ code: "57014", message: "canceling statement due to statement timeout" }, 500));
    const slow = await GET(req());
    expect(slow.status).toBe(502);
    expect((await slow.json()).message).toMatch(/admin_funnel.*57014/);

    fetchMock.mockResolvedValueOnce(json({ accounts: "nope" }));
    expect((await (await GET(req())).json()).message).toMatch(/not a funnel/);
  });
});

describe("buildFunnel", () => {
  it("names a network failure and a timeout", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(buildFunnel({ url: "https://p.supabase.co", serviceKey: "k", fetch: down as unknown as typeof fetch }, "UTC")).rejects.toThrow(ConsoleQueryError);
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    });
    await expect(buildFunnel({ url: "https://p.supabase.co", serviceKey: "k", fetch: timeout as unknown as typeof fetch }, "UTC")).rejects.toThrow(/no answer in time/);
  });
});
