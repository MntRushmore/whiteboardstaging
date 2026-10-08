/**
 * `requireUser` when Supabase Auth itself fails (unreachable, a 5xx): the student is told "Please
 * sign in again" (a 401, as before), which no sign-in can fix while Auth is down — so it is an app
 * event (`auth`, `unavailable`). A token Auth refuses (expired, invalid) is a normal 401: no event.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  getUser: (async () => ({ data: { user: null }, error: null })) as (token: string) => Promise<unknown>,
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: (token: string) => fake.getUser(token) } }) }));
vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));

import { resetServerEnvCache } from "@/lib/env";
import { requireUser } from "@/lib/server/auth";
import { recordEvent } from "@/lib/server/events";

const ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
const TOKEN = "aaaa.bbbb.cccc";
const req = () => new Request("http://localhost/api/live/recognize?x=1", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } });
const events = () => vi.mocked(recordEvent).mock.calls.map(([e]) => e);

beforeEach(() => {
  for (const name of ENV_VARS) saved[name] = process.env[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  resetServerEnvCache();
  vi.mocked(recordEvent).mockReset();
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
});

describe("requireUser: Auth down is an event, a refused token is not", () => {
  it("Auth unreachable (supabase-js's AuthRetryableFetchError): still a 401, and an error event `auth` / `unavailable` with the path", async () => {
    fake.getUser = async () => ({ data: { user: null }, error: Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 }) });
    const out = await requireUser(req());
    expect("response" in out && out.response.status).toBe(401);
    expect(events()).toEqual([
      expect.objectContaining({ source: "server", level: "error", kind: "auth", code: "unavailable", route: "/api/live/recognize", meta: expect.objectContaining({ status: 0, error: "AuthRetryableFetchError" }) }),
    ]);
  });

  it("Auth answering 5xx, or the call throwing: an event", async () => {
    fake.getUser = async () => ({ data: { user: null }, error: Object.assign(new Error("upstream"), { name: "AuthApiError", status: 503 }) });
    await requireUser(req());
    fake.getUser = async () => {
      throw new TypeError("fetch failed");
    };
    await requireUser(req());
    expect(events().map((e) => e.code)).toEqual(["unavailable", "unavailable"]);
  });

  it("a token Auth refuses (expired, invalid): the normal 401, no event", async () => {
    fake.getUser = async () => ({ data: { user: null }, error: Object.assign(new Error("invalid JWT"), { name: "AuthApiError", status: 401 }) });
    expect("response" in (await requireUser(req()))).toBe(true);
    fake.getUser = async () => ({ data: { user: null }, error: { message: "invalid token" } });
    expect("response" in (await requireUser(req()))).toBe(true);
    expect(events()).toEqual([]);
  });

  it("a good token: the user, no event", async () => {
    fake.getUser = async () => ({ data: { user: { id: "u-1", email: "kid@example.com" } }, error: null });
    expect(await requireUser(req())).toEqual({ user: { id: "u-1", email: "kid@example.com" }, token: TOKEN });
    expect(events()).toEqual([]);
  });
});
