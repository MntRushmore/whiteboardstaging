/**
 * GET /api/admin/referrals and PATCH /api/admin/referrals/<id> through their real handlers and
 * src/lib/referral/server/admin.ts: requireAdmin's answers pass through before anything is read,
 * each calls its function once with the service role, a refused move is 404 or 409, and every
 * failure is named. PostgREST is a stubbed fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

const gate = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/server/admin", () => ({ requireAdmin: gate.requireAdmin }));

import { GET } from "@/app/api/admin/referrals/route";
import { PATCH } from "@/app/api/admin/referrals/[id]/route";
import { resetServerEnvCache } from "@/lib/env";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { AdminReferralListSchema, AdminReferralSchema } from "../admin";
import { REFERRAL_LIST_LIMIT } from "../server/admin";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co/",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  OPENROUTER_API_KEY: "sk-or-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const saved: Record<string, string | undefined> = {};
const ADMIN = { id: "00000000-0000-4000-8000-000000000099", email: "owner@example.com" };

const ENTRY = {
  id: 7,
  code: "BCDF2345",
  status: "rewarded",
  created_at: "2026-10-09T15:00:00Z",
  paid_at: "2026-10-09T16:00:00Z",
  rewarded_at: "2026-10-09T17:00:00Z",
  updated_at: "2026-10-09T17:00:00Z",
  rewarded_by_email: "owner@example.com",
  referrer: { id: "11111111-1111-4111-8111-111111111111", email: "parent@example.com", created_at: "2026-09-01T00:00:00Z", customer_id: "cus_A", payer_email: null },
  referred: { id: "22222222-2222-4222-8222-222222222222", email: "friend@example.com", created_at: "2026-10-09T15:00:00Z", payer_email: "friend@example.com", plan_status: "active", trial_end: "2026-10-02T15:00:00Z" },
};
const LIST = { generated_at: "2026-10-09T18:00:00Z", counts: { signed_up: 0, trialing: 0, paid: 0, rewarded: 1, void: 0 }, truncated: false, referrals: [ENTRY] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const getReq = () => new Request("http://localhost/api/admin/referrals", { headers: { Authorization: "Bearer a.b.c" } });
const patchReq = (body: unknown) =>
  new Request("http://localhost/api/admin/referrals/7", { method: "PATCH", headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

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
  fetchMock = vi.fn(async () => json(LIST));
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

describe("GET /api/admin/referrals", () => {
  it("passes requireAdmin's 401 and 404 through, before anything is read", async () => {
    for (const status of [401, 404]) {
      gate.requireAdmin.mockResolvedValueOnce({ response: new Response(null, { status }) });
      expect((await GET(getReq())).status).toBe(status);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers the list, never cached, from one admin_referrals call with the service role", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = AdminReferralListSchema.parse(await res.json());
    expect(body.referrals[0]).toMatchObject({ id: 7, status: "rewarded", referrer: { email: "parent@example.com", customerId: "cus_A" }, referred: { email: "friend@example.com", planStatus: "active", trialEnd: "2026-10-02T15:00:00Z" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/rest/v1/rpc/admin_referrals");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer service-key");
    expect(JSON.parse(String(init.body))).toEqual({ p_limit: REFERRAL_LIST_LIMIT });
  });

  it("names the missing migration, and a bad answer, as 502", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "PGRST202", message: "Could not find the function" }, 404));
    const missing = await GET(getReq());
    expect(missing.status).toBe(502);
    expect((await missing.json()).message).toContain("20261009110000_referrals.sql");
    fetchMock.mockResolvedValueOnce(json({ referrals: "no" }));
    expect((await GET(getReq())).status).toBe(502);
  });

  it("is 503 without the service role key", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetServerEnvCache();
    expect((await GET(getReq())).status).toBe(503);
  });
});

describe("PATCH /api/admin/referrals/<id>", () => {
  it("passes requireAdmin's answers through, before anything is written", async () => {
    gate.requireAdmin.mockResolvedValueOnce({ response: new Response(null, { status: 404 }) });
    expect((await PATCH(patchReq({ status: "rewarded" }), params("7"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a bad id or body with 400", async () => {
    for (const id of ["0", "-1", "abc", "7.5", "99999999999999999999"]) {
      expect((await PATCH(patchReq({ status: "rewarded" }), params(id))).status).toBe(400);
    }
    for (const body of [{}, { status: "paid" }, { status: "rewarded", extra: 1 }]) {
      expect((await PATCH(patchReq(body), params("7"))).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks it with the admin's id and answers the referral as it now stands", async () => {
    fetchMock.mockResolvedValueOnce(json(ENTRY));
    const res = await PATCH(patchReq({ status: "rewarded" }), params("7"));
    expect(res.status).toBe(200);
    expect(AdminReferralSchema.parse(await res.json())).toMatchObject({ id: 7, status: "rewarded", rewardedByEmail: "owner@example.com" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/rest/v1/rpc/admin_referral_mark");
    expect(JSON.parse(String(init.body))).toEqual({ p_id: 7, p_status: "rewarded", p_admin: ADMIN.id });
  });

  it("is 404 for no such referral and 409 for a move its status does not allow", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "P0002", hint: "not_found", message: "No referral has that id." }, 400));
    expect((await PATCH(patchReq({ status: "void" }), params("7"))).status).toBe(404);
    fetchMock.mockResolvedValueOnce(json({ code: "P0001", hint: "referral_state", message: "This referral is rewarded, so it cannot be marked void." }, 400));
    const conflict = await PATCH(patchReq({ status: "void" }), params("7"));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).message).toContain("cannot be marked void");
  });

  it("is 409 with the database's reason for a reward not yet due (the friend's first payment may still fail)", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "P0001", hint: "referral_unsettled", message: "The friend's first payment may still fail: reward from Oct 12, 16:00 UTC." }, 400));
    const res = await PATCH(patchReq({ status: "rewarded" }), params("7"));
    expect(res.status).toBe(409);
    expect((await res.json()).message).toContain("reward from Oct 12");
  });

  it("is 502 when the write fails", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "XX000", message: "boom" }, 500));
    const res = await PATCH(patchReq({ status: "rewarded" }), params("7"));
    expect(res.status).toBe(502);
    expect((await res.json()).message).toContain("admin_referral_mark");
  });
});
