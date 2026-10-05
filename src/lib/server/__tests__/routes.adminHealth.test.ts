/**
 * GET /api/admin/health through its real handler, with every outside call faked by one fetch
 * double (Supabase, the site, OpenRouter, Mathpix, Resend: no network, no real email). The
 * contract: 401/404 before any work without the cron secret or an admin's token; the cron run
 * checks, writes, records, alerts and (once a day) prunes; an admin's "check now" checks, writes
 * and records but never emails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

const admin = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/server/admin", () => ({
  // The real guard (agent "data"): 401 signed out, 404 for anyone who is not an admin.
  requireAdmin: async (req: Request) => {
    admin.calls += 1;
    const auth = req.headers.get("authorization");
    if (!auth) return { response: Response.json({ error: "unauthorized", message: "Sign in." }, { status: 401 }) };
    if (auth === "Bearer admin-token") return { user: { id: "11111111-2222-4333-8444-555555555555", email: "owner@example.com" } };
    return { response: new Response(null, { status: 404 }) };
  },
}));

const events = vi.hoisted(() => ({ recorded: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/server/events", () => ({
  recordEvent: (e: Record<string, unknown>) => void events.recorded.push(e),
  recordEventNow: async (e: Record<string, unknown>) => void events.recorded.push(e),
}));

import { GET } from "@/app/api/admin/health/route";
import { SERVICES, type HealthResult } from "@/lib/admin/contracts";
import { resetServerEnvCache } from "@/lib/env";
import { resetRateLimits } from "@/lib/server/rate-limit";

const SECRET = "unit-cron-secret-0123456789";
const ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  OPENROUTER_API_KEY: "sk-or-v1-test",
  SUPABASE_SERVICE_ROLE_KEY: "svc-key",
  CRON_SECRET: SECRET,
  NEXT_PUBLIC_SITE_URL: "https://whiteboard.example.com",
  MATHPIX_APP_ID: "app-id",
  MATHPIX_APP_KEY: "app-key",
  RESEND_API_KEY: "re_test",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  ALERT_EMAIL: "owner@example.com",
  RATE_LIMIT_BACKEND: "memory",
};
const saved: Record<string, string | undefined> = {};

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
/** alert_state rows the fake database holds. */
let alertRows: Array<Record<string, unknown>> = [];

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Every provider and table the run touches; Mathpix rejects its keys, so one check fails. */
async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = String(input);
  const method = init.method ?? "GET";
  let body: unknown = null;
  try {
    body = init.body ? JSON.parse(String(init.body)) : null;
  } catch {
    body = init.body;
  }
  calls.push({ method, url, body });
  if (url === "https://whiteboard.example.com/api/health") return reply(200, { ok: true, db: "up", release: "abc1234" });
  if (url.startsWith("https://proj.supabase.co/rest/v1/profiles")) return reply(200, [{ user_id: "u" }]);
  if (url === "https://openrouter.ai/api/v1/key") return reply(200, { data: { limit_remaining: 20 } });
  if (url === "https://openrouter.ai/api/v1/credits") return reply(403, { error: { message: "Only management keys can perform this operation" } });
  if (url === "https://api.mathpix.com/v3/app-tokens") return reply(401, { error: "Invalid credentials" });
  if (url.startsWith("https://api.resend.com/domains")) return reply(200, { object: "list", data: [{ name: "mail.agathon.app", status: "verified" }] });
  if (url === "https://api.resend.com/emails") return reply(200, { id: "em_123" });
  if (url.startsWith("https://proj.supabase.co/rest/v1/billing_events")) return reply(200, []);
  if (url.startsWith("https://proj.supabase.co/rest/v1/app_events")) return reply(200, []);
  if (url.startsWith("https://proj.supabase.co/rest/v1/health_checks")) return reply(201);
  if (url.startsWith("https://proj.supabase.co/rest/v1/alert_state")) return method === "GET" ? reply(200, alertRows) : reply(201);
  if (url.startsWith("https://proj.supabase.co/rest/v1/rpc/prune_admin_rows")) return reply(200, { app_events: 3, health_checks: 12 });
  throw new TypeError(`fetch failed: no fake for ${method} ${url}`);
}

const fetchSpy = vi.fn(fakeFetch);

let ipCounter = 0;
function request(auth?: string, ip = `198.51.100.${++ipCounter}`): Request {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (auth) headers.Authorization = auth;
  return new Request("https://whiteboard.example.com/api/admin/health", { headers });
}

const posted = (path: string) => calls.filter((c) => c.method === "POST" && c.url.includes(path));
const emails = () => posted("api.resend.com/emails").map((c) => c.body as { to: string[]; subject: string; text: string });

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  resetServerEnvCache();
  resetRateLimits();
  calls = [];
  alertRows = [];
  events.recorded.length = 0;
  admin.calls = 0;
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  // Not the prune slot (08:00-08:05 UTC) unless a test says so.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T14:02:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetServerEnvCache();
});

describe("GET /api/admin/health: who may call it", () => {
  it("no token: requireAdmin's 401, and nothing is checked", async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a wrong bearer that is not an admin's token: 404, nothing checked", async () => {
    const res = await GET(request("Bearer not-the-secret"));
    expect(res.status).toBe(404);
    expect(admin.calls).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("without CRON_SECRET configured, even its old value is just a token requireAdmin refuses", async () => {
    delete process.env.CRON_SECRET;
    resetServerEnvCache();
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the cron secret never reaches requireAdmin", async () => {
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(200);
    expect(admin.calls).toBe(0);
  });

  it("authenticated but no service role: 503 feature_unavailable", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetServerEnvCache();
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("feature_unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is rate limited per IP before anything else", async () => {
    for (let i = 0; i < 20; i++) await GET(request(undefined, "203.0.113.9"));
    const limited = await GET(request(`Bearer ${SECRET}`, "203.0.113.9"));
    expect(limited.status).toBe(429);
  });
});

describe("GET /api/admin/health: a pg_cron run", () => {
  it("answers HealthResult[] for every service, writes the rows, records the failure", async () => {
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const results = (await res.json()) as HealthResult[];
    expect(results.map((r) => r.service)).toEqual([...SERVICES]);
    const byService = Object.fromEntries(results.map((r) => [r.service, r]));
    expect(byService.app).toMatchObject({ ok: true, detail: "release abc1234" });
    expect(byService.openrouter).toMatchObject({ ok: true, detail: "$20.00 credit left" });
    expect(byService.mathpix).toMatchObject({ ok: false, detail: "keys rejected (401)" });
    expect(byService.email).toMatchObject({ ok: true, detail: "mail.agathon.app verified" });
    expect(byService.stripe).toMatchObject({ ok: true, detail: "no webhook events yet" });
    for (const r of results) expect(Object.keys(r).sort()).toEqual(["at", "detail", "latencyMs", "ok", "service"]);

    const rows = posted("/rest/v1/health_checks").flatMap((c) => c.body as Array<Record<string, unknown>>);
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.service === "mathpix")).toMatchObject({ ok: false, detail: "keys rejected (401)" });

    expect(events.recorded).toEqual([expect.objectContaining({ source: "health", level: "error", kind: "health.mathpix", code: "unauthorized", message: "keys rejected (401)", route: "/api/admin/health" })]);
    // One failure is not "down" yet: the state is saved, no email.
    expect(emails()).toEqual([]);
    expect(posted("/rest/v1/alert_state").flatMap((c) => c.body as unknown[])).toEqual([expect.objectContaining({ key: "down:mathpix", status: "ok", failures: 1 })]);
    // Not the prune slot.
    expect(posted("prune_admin_rows")).toEqual([]);
  });

  it("the second failure in a row emails ALERT_EMAIL, through Resend, with an idempotency key", async () => {
    alertRows = [{ key: "down:mathpix", status: "ok", since: "2026-10-05T13:57:00.000Z", last_sent_at: null, failures: 1 }];
    await GET(request(`Bearer ${SECRET}`));
    const sent = emails();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["owner@example.com"]);
    expect(sent[0].subject).toBe("Mathpix is down: keys rejected (401)");
    expect(sent[0].text).toContain("https://whiteboard.example.com/admin");
    const resendCall = fetchSpy.mock.calls.find(([u]) => String(u) === "https://api.resend.com/emails")!;
    expect((resendCall[1]?.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^alert\/down:mathpix\/down\/\d+$/);
  });

  it("without ALERT_EMAIL nothing is sent (logged), the rest still runs", async () => {
    delete process.env.ALERT_EMAIL;
    alertRows = [{ key: "down:mathpix", status: "ok", since: "2026-10-05T13:57:00.000Z", last_sent_at: null, failures: 1 }];
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(200);
    expect(emails()).toEqual([]);
    expect(posted("/rest/v1/alert_state").flatMap((c) => c.body as unknown[])).toEqual([expect.objectContaining({ key: "down:mathpix", status: "firing", last_sent_at: null })]);
  });

  it("prunes old rows in the daily slot (08:00-08:05 UTC) only", async () => {
    vi.setSystemTime(new Date("2026-10-05T08:02:00.000Z"));
    await GET(request(`Bearer ${SECRET}`));
    expect(posted("rpc/prune_admin_rows")).toHaveLength(1);
  });

  it("a failed write is logged, the answer still comes", async () => {
    fetchSpy.mockImplementation(async (input, init) => (String(input).includes("/rest/v1/health_checks") ? reply(500, { message: "relation does not exist" }) : fakeFetch(input, init)));
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(((await res.json()) as unknown[]).length).toBe(6);
    fetchSpy.mockImplementation(fakeFetch);
  });
});

describe("GET /api/admin/health: an admin's check now", () => {
  it("checks, writes and records, but judges no alert and sends nothing", async () => {
    alertRows = [{ key: "down:mathpix", status: "ok", since: "2026-10-05T13:57:00.000Z", last_sent_at: null, failures: 1 }];
    const res = await GET(request("Bearer admin-token"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as HealthResult[]).length).toBe(6);
    expect(posted("/rest/v1/health_checks")).toHaveLength(1);
    expect(events.recorded.map((e) => e.kind)).toEqual(["health.mathpix"]);
    expect(calls.some((c) => c.url.includes("alert_state"))).toBe(false);
    expect(emails()).toEqual([]);
  });

  it("never prunes, even in the slot", async () => {
    vi.setSystemTime(new Date("2026-10-05T08:01:00.000Z"));
    await GET(request("Bearer admin-token"));
    expect(posted("prune_admin_rows")).toEqual([]);
  });
});

describe("the route file", () => {
  it("authenticates (CRON_SECRET via bearerMatches, else requireAdmin) before any check runs", () => {
    // The real invariant behind its PUBLIC_ROUTES entry, like the GC cron's.
    const src = readFileSync(join(__dirname, "..", "..", "..", "app", "api", "admin", "health", "route.ts"), "utf8");
    expect(src).toMatch(/CRON_SECRET/);
    const bearerAt = src.indexOf("bearerMatches(");
    const adminAt = src.indexOf("requireAdmin(");
    const runAt = src.indexOf("runHealth(");
    expect(bearerAt).toBeGreaterThan(-1);
    expect(adminAt).toBeGreaterThan(bearerAt);
    expect(runAt).toBeGreaterThan(adminAt);
    expect(src).not.toMatch(/process\.env/);
  });
});
