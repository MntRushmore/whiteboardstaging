/**
 * `requireUser` and `identifyUser` (src/lib/server/auth.ts) at the edges of the Authorization
 * header: what reaches Supabase Auth at all (a JWT's three segments, `Bearer` in any case), what is
 * refused before the network (anything else, including unicode and header-injection attempts), a
 * misconfigured server (500, not a fake 401), and `identifyUser` never holding a public route past
 * its 3 s when Auth hangs or throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  getUser: vi.fn(async (token: string): Promise<unknown> => ({ data: { user: null }, error: { status: 401, message: `invalid ${token.length}` } })),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: (token: string) => fake.getUser(token) } }) }));
vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));

import { resetServerEnvCache } from "@/lib/env";
import { identifyUser, requireUser } from "@/lib/server/auth";

const ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl";
const USER = { id: "11111111-2222-4333-8444-555555555555", email: "kid@example.com" };

const withAuth = (value: string | null) => new Request("http://localhost/api/live/chat", { method: "POST", headers: value === null ? {} : { Authorization: value } });

beforeEach(() => {
  for (const name of ENV_VARS) saved[name] = process.env[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  resetServerEnvCache();
  fake.getUser.mockReset();
  fake.getUser.mockImplementation(async (token) => (token === TOKEN ? { data: { user: USER }, error: null } : { data: { user: null }, error: { status: 401, message: "invalid" } }));
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
  vi.useRealTimers();
});

describe("requireUser: the Authorization header", () => {
  it.each([
    ["Bearer", `Bearer ${TOKEN}`],
    ["lower-case bearer", `bearer ${TOKEN}`],
    ["upper-case BEARER", `BEARER ${TOKEN}`],
    ["extra spaces", `  Bearer    ${TOKEN}   `],
  ])("%s: verified with Auth, the user and the token back", async (_name, header) => {
    const r = await requireUser(withAuth(header));
    expect(r).toEqual({ user: USER, token: TOKEN });
    expect(fake.getUser).toHaveBeenCalledWith(TOKEN);
  });

  it.each([
    ["no header", null],
    ["empty", ""],
    ["Bearer alone", "Bearer"],
    ["Bearer and spaces", "Bearer    "],
    ["Basic auth", "Basic dXNlcjpwYXNz"],
    ["the token with no scheme", TOKEN],
    ["two segments", "Bearer aaaa.bbbb"],
    ["four segments", "Bearer aaaa.bbbb.cccc.dddd"],
    ["an empty segment", "Bearer aaaa..cccc"],
    ["two tokens", `Bearer ${TOKEN} ${TOKEN}`],
    ["base64 padding / plus / slash (not base64url)", "Bearer aa+a.bb/b.cc=="],
    // (the runtime refuses non-Latin-1 header values outright; Latin-1 letters do get through)
    ["Latin-1 letters", "Bearer ééé.bbb.ccc"],
    ["quotes and SQL", "Bearer a'b.c\"d.e;--"],
  ])("%s: 401 before any call to Auth", async (_name, header) => {
    const r = await requireUser(withAuth(header));
    expect("response" in r && r.response.status).toBe(401);
    if ("response" in r) {
      expect(r.response.headers.get("www-authenticate")).toBe("Bearer");
      expect(await r.response.json()).toEqual({ error: "unauthorized", message: "You need to be signed in to use this feature." });
    }
    expect(fake.getUser).not.toHaveBeenCalled();
  });

  it("a huge well-formed token is passed to Auth (which refuses it) and answers a plain 401, never a crash", async () => {
    const huge = `Bearer ${"a".repeat(50_000)}.${"b".repeat(50_000)}.${"c".repeat(50_000)}`;
    const r = await requireUser(withAuth(huge));
    expect("response" in r && r.response.status).toBe(401);
  });

  it("Auth answering a user-less success is still a 401", async () => {
    fake.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const r = await requireUser(withAuth(`Bearer ${TOKEN}`));
    expect("response" in r && r.response.status).toBe(401);
  });

  it("a user without an email is { email: null }, not undefined", async () => {
    fake.getUser.mockResolvedValueOnce({ data: { user: { id: USER.id } }, error: null });
    const r = await requireUser(withAuth(`Bearer ${TOKEN}`));
    expect(r).toEqual({ user: { id: USER.id, email: null }, token: TOKEN });
  });

  it("many requests at once are each verified on their own: one good token does not let a bad one through", async () => {
    const headers = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? `Bearer ${TOKEN}` : "Bearer xxxx.yyyy.zzzz"));
    const results = await Promise.all(headers.map((h) => requireUser(withAuth(h))));
    results.forEach((r, i) => expect("user" in r, `request ${i}`).toBe(i % 2 === 0));
    expect(fake.getUser).toHaveBeenCalledTimes(20);
  });
});

describe("requireUser on a misconfigured server", () => {
  it("no Supabase URL: a 500 saying so, not a 401 that blames the student", async () => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const env = await import("@/lib/env");
    env.resetServerEnvCache();
    const fresh = await import("@/lib/server/auth");
    const r = await fresh.requireUser(withAuth(`Bearer ${TOKEN}`));
    expect("response" in r && r.response.status).toBe(500);
    if ("response" in r) expect(((await r.response.json()) as { error: string }).error).toBe("internal_error");
    expect(fake.getUser).not.toHaveBeenCalled();
  });
});

describe("identifyUser (public routes: who it was, never a 401)", () => {
  it("a good token is the user's id; no header, garbage or a refused token is null", async () => {
    expect(await identifyUser(withAuth(`Bearer ${TOKEN}`))).toBe(USER.id);
    expect(await identifyUser(withAuth(null))).toBeNull();
    expect(await identifyUser(withAuth("Bearer not-a-jwt"))).toBeNull();
    expect(await identifyUser(withAuth("Bearer xxxx.yyyy.zzzz"))).toBeNull();
  });

  it("Auth throwing is null, not an exception", async () => {
    fake.getUser.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await identifyUser(withAuth(`Bearer ${TOKEN}`))).toBeNull();
  });

  it("Auth that never answers: null after 3 s, so a slow Auth never holds the caller", async () => {
    vi.useFakeTimers();
    fake.getUser.mockImplementationOnce(() => new Promise(() => {}));
    let done: string | null | undefined;
    const pending = identifyUser(withAuth(`Bearer ${TOKEN}`)).then((v) => (done = v));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(done).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a fast answer clears its timer (no 3 s timer left behind per request)", async () => {
    vi.useFakeTimers();
    await identifyUser(withAuth(`Bearer ${TOKEN}`));
    expect(vi.getTimerCount()).toBe(0);
  });
});
