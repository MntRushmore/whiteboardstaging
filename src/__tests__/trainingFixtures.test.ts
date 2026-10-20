/**
 * scripts/training-fixtures.mjs without a network: the arguments it takes, which project it agrees
 * to read (the local stack, or production only with --prod and the key given in the environment),
 * the file name a case gets (never a path outside the folder), and the paged read over a fake fetch.
 * The read against a real database is in src/lib/server/__tests__/training.integration.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OUT, PAGE, fetchFixtureRows, fixtureFileName, parseArgs, resolveTarget } from "../../scripts/training-fixtures.mjs";

const ID = "7b14d039-a98a-44fc-843c-fd7947b2cf2c";

describe("parseArgs", () => {
  it("defaults to the iOS fixtures folder; takes --out <dir>, --prod and -h", () => {
    expect(parseArgs([])).toEqual({ out: DEFAULT_OUT, prod: false, help: false });
    expect(DEFAULT_OUT).toBe("ios/Packages/AgathonLive/Tests/AgathonLiveTests/Fixtures/training");
    expect(parseArgs(["--out", "/tmp/x", "--prod"])).toEqual({ out: "/tmp/x", prod: true, help: false });
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("refuses an unknown flag and --out without a folder", () => {
    expect(() => parseArgs(["--force"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--out"])).toThrow(/needs a folder/);
    expect(() => parseArgs(["--out", "--prod"])).toThrow(/needs a folder/);
  });
});

describe("resolveTarget", () => {
  const local = { url: "http://127.0.0.1:54321", serviceKey: "local-service" };

  it("the local stack by default", () => {
    expect(resolveTarget({ prod: false, env: {}, local })).toEqual(local);
    expect(resolveTarget({ prod: false, env: {}, local: { ...local, url: "http://localhost:54321" } })).toMatchObject({ url: "http://localhost:54321" });
  });

  it("refuses any other project without --prod, whatever the environment says", () => {
    const remote = { url: "https://abcd.supabase.co", serviceKey: "prod-service" };
    expect(resolveTarget({ prod: false, env: { SUPABASE_URL: remote.url, SUPABASE_SERVICE_ROLE_KEY: "k" }, local: remote })).toEqual({ error: expect.stringMatching(/not the local stack/) });
    expect(resolveTarget({ prod: false, env: {}, local: {} })).toEqual({ error: expect.stringMatching(/Missing/) });
  });

  it("--prod reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment, both required", () => {
    expect(resolveTarget({ prod: true, env: { SUPABASE_URL: "https://abcd.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" }, local })).toEqual({ url: "https://abcd.supabase.co", serviceKey: "k" });
    expect(resolveTarget({ prod: true, env: { SUPABASE_URL: "https://abcd.supabase.co" }, local })).toEqual({ error: expect.stringMatching(/--prod needs/) });
    expect(resolveTarget({ prod: true, env: {}, local })).toEqual({ error: expect.stringMatching(/--prod needs/) });
  });
});

describe("fixtureFileName", () => {
  it("<case_key>-<first 8 of id>.json", () => {
    expect(fixtureFileName({ id: ID, case_key: "add-2-digit_01.v2" })).toBe("add-2-digit_01.v2-7b14d039.json");
  });

  it("a key can never name a path outside the folder", () => {
    for (const key of ["../../etc/passwd", "/abs/path", "..", "a/b\\c", ".hidden"]) {
      const name = fixtureFileName({ id: ID, case_key: key });
      expect(name, key).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*-7b14d039\.json$/);
      expect(name, key).not.toContain("/");
    }
    expect(fixtureFileName({ id: ID, case_key: "../.." })).toBe("case-7b14d039.json");
  });
});

describe("fetchFixtureRows", () => {
  it("reads regression cases with a fixture, page by page, with the service role", async () => {
    const urls: string[] = [];
    const page = (n: number, start: number) => Array.from({ length: n }, (_, i) => ({ id: `${start + i}`, case_key: `k${start + i}`, fixture: { i: start + i } }));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer svc");
      return Response.json(urls.length === 1 ? page(PAGE, 0) : page(3, PAGE));
    });
    const rows = await fetchFixtureRows({ url: "http://127.0.0.1:54321/", serviceKey: "svc", fetchImpl: fetchImpl as typeof fetch });
    expect(rows).toHaveLength(PAGE + 3);
    expect(urls).toHaveLength(2);
    const first = new URL(urls[0]);
    expect(first.pathname).toBe("/rest/v1/training_cases");
    expect(Object.fromEntries(first.searchParams)).toMatchObject({ regression: "is.true", fixture: "not.is.null", offset: "0", limit: String(PAGE) });
    expect(new URL(urls[1]).searchParams.get("offset")).toBe(String(PAGE));
  });

  it("a failed read throws with the status", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ message: "relation does not exist" }, { status: 404 }));
    await expect(fetchFixtureRows({ url: "http://127.0.0.1:54321", serviceKey: "svc", fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/\(404\)/);
  });
});
