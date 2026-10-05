/**
 * requireAdmin (src/lib/server/admin.ts), with a fake supabase-js (token verification) and a fake
 * fetch for the `admins` lookup. The contract: 401 signed out, 404 with no body for a user who is
 * not an admin, the user for an admin; the lookup is made with the service role, kept 60 s per
 * user (both answers), and a failed lookup is a 503 that is not kept.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  ADMIN_TOKEN: "admin.token.sig",
  STUDENT_TOKEN: "student.token.sig",
  ADMIN_ID: "11111111-2222-4333-8444-555555555555",
  STUDENT_ID: "99999999-2222-4333-8444-555555555555",
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.ADMIN_TOKEN
          ? { data: { user: { id: fake.ADMIN_ID, email: "owner@example.com" } }, error: null }
          : token === fake.STUDENT_TOKEN
            ? { data: { user: { id: fake.STUDENT_ID, email: "student@example.com" } }, error: null }
            : { data: { user: null }, error: { message: "invalid token" } },
    },
  }),
}));

const ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const saved: Record<string, string | undefined> = {};

let lookups: Array<{ url: string; headers: Headers }>;
let answer: (url: string) => Promise<Response>;
let requireAdmin: typeof import("@/lib/server/admin").requireAdmin;

const adminsTable = async (url: string) => Response.json(url.includes(fake.ADMIN_ID) ? [{ user_id: fake.ADMIN_ID }] : []);

function request(token?: string): Request {
  return new Request("http://localhost/api/admin/overview", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

beforeEach(async () => {
  for (const name of ENV_VARS) saved[name] = process.env[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  lookups = [];
  answer = adminsTable;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      lookups.push({ url: String(input), headers: new Headers(init?.headers) });
      return answer(String(input));
    }),
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
  // the answers are kept per module instance: a fresh one per test
  vi.resetModules();
  (await import("@/lib/env")).resetServerEnvCache();
  ({ requireAdmin } = await import("@/lib/server/admin"));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  (await import("@/lib/env")).resetServerEnvCache();
});

const statusOf = (r: Awaited<ReturnType<typeof requireAdmin>>) => ("response" in r ? r.response.status : 200);

describe("requireAdmin", () => {
  it("401 signed out or with a bad token, before any lookup", async () => {
    expect(statusOf(await requireAdmin(request()))).toBe(401);
    expect(statusOf(await requireAdmin(request("bad.token.sig")))).toBe(401);
    expect(lookups).toEqual([]);
  });

  it("404 with no body for a signed-in user who is not an admin", async () => {
    const result = await requireAdmin(request(fake.STUDENT_TOKEN));
    expect("response" in result).toBe(true);
    if (!("response" in result)) return;
    expect(result.response.status).toBe(404);
    expect(await result.response.text()).toBe("");
  });

  it("an admin gets through, looked up in admins with the service role", async () => {
    const result = await requireAdmin(request(fake.ADMIN_TOKEN));
    expect(result).toEqual({ user: { id: fake.ADMIN_ID, email: "owner@example.com" } });
    expect(lookups).toHaveLength(1);
    expect(lookups[0].url).toBe(`http://127.0.0.1:54321/rest/v1/admins?select=user_id&user_id=eq.${fake.ADMIN_ID}`);
    expect(lookups[0].headers.get("apikey")).toBe("service-role-test");
    expect(lookups[0].headers.get("authorization")).toBe("Bearer service-role-test");
  });

  it("keeps each user's answer for 60 s, both ways, then asks again", async () => {
    await requireAdmin(request(fake.ADMIN_TOKEN));
    await requireAdmin(request(fake.STUDENT_TOKEN));
    vi.setSystemTime(new Date("2026-10-05T12:00:59Z"));
    expect(statusOf(await requireAdmin(request(fake.ADMIN_TOKEN)))).toBe(200);
    expect(statusOf(await requireAdmin(request(fake.STUDENT_TOKEN)))).toBe(404);
    expect(lookups).toHaveLength(2);
    // removed from admins meanwhile: the next lookup, after the minute, says so
    answer = async () => Response.json([]);
    vi.setSystemTime(new Date("2026-10-05T12:01:01Z"));
    expect(statusOf(await requireAdmin(request(fake.ADMIN_TOKEN)))).toBe(404);
    expect(lookups).toHaveLength(3);
  });

  it("503 when the lookup fails (an error status, the network), and the failure is not kept", async () => {
    answer = async () => Response.json({ message: "Database client error" }, { status: 503 });
    const down = await requireAdmin(request(fake.ADMIN_TOKEN));
    expect(statusOf(down)).toBe(503);
    if ("response" in down) expect(await down.response.json()).toMatchObject({ error: "feature_unavailable" });
    answer = async () => {
      throw new TypeError("fetch failed");
    };
    expect(statusOf(await requireAdmin(request(fake.ADMIN_TOKEN)))).toBe(503);
    answer = adminsTable;
    expect(statusOf(await requireAdmin(request(fake.ADMIN_TOKEN)))).toBe(200);
    expect(lookups).toHaveLength(3);
  });

  it("503 without SUPABASE_SERVICE_ROLE_KEY, and no lookup with any other key", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    (await import("@/lib/env")).resetServerEnvCache();
    expect(statusOf(await requireAdmin(request(fake.ADMIN_TOKEN)))).toBe(503);
    expect(lookups).toEqual([]);
  });
});
