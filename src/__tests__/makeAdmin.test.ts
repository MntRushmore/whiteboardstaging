/**
 * scripts/make-admin.mjs over a fake fetch: the arguments it takes, the account found by email
 * through the Auth admin API's paged list (any case), and the `admins` row added or removed with
 * the service role, saying when there was nothing to do. No network.
 */
import { describe, expect, it, vi } from "vitest";
import { PER_PAGE, findUserByEmail, parseArgs, setAdmin } from "../../scripts/make-admin.mjs";

const URL_ = "http://127.0.0.1:54321/";
const KEY = "service-role-test";
const ID = "11111111-2222-4333-8444-555555555555";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("parseArgs", () => {
  it("takes one email and --remove", () => {
    expect(parseArgs(["owner@example.com"])).toEqual({ email: "owner@example.com", remove: false, help: false });
    expect(parseArgs(["--remove", " owner@example.com "])).toEqual({ email: "owner@example.com", remove: true, help: false });
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("refuses no email, two, a non-email and an unknown flag", () => {
    expect(() => parseArgs([])).toThrow(/email is required/);
    expect(() => parseArgs(["a@example.com", "b@example.com"])).toThrow(/one email/);
    expect(() => parseArgs(["owner"])).toThrow(/not an email/);
    expect(() => parseArgs(["owner@example.com", "--force"])).toThrow(/unknown argument/);
  });
});

describe("findUserByEmail", () => {
  it("pages through the Auth admin API with the service role and matches any case", async () => {
    const fullPage = Array.from({ length: PER_PAGE }, (_, i) => ({ id: `id-${i}`, email: `user${i}@example.com` }));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const page = new URL(String(input)).searchParams.get("page");
      return json(200, { users: page === "1" ? fullPage : [{ id: ID, email: "Owner@Example.com" }] });
    });
    const user = await findUserByEmail({ url: URL_, serviceKey: KEY, email: "owner@example.COM", fetchImpl: fetchImpl as typeof fetch });
    expect(user).toEqual({ id: ID, email: "Owner@Example.com" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:54321/auth/v1/admin/users?page=1&per_page=${PER_PAGE}`);
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
  });

  it("null when no page has it; throws when the list cannot be read", async () => {
    const empty = vi.fn(async () => json(200, { users: [{ id: "x", email: "someone@example.com" }] }));
    expect(await findUserByEmail({ url: URL_, serviceKey: KEY, email: "owner@example.com", fetchImpl: empty as typeof fetch })).toBeNull();
    const refused = vi.fn(async () => json(401, { msg: "invalid JWT" }));
    await expect(findUserByEmail({ url: URL_, serviceKey: "bad", email: "owner@example.com", fetchImpl: refused as typeof fetch })).rejects.toThrow(/listing accounts failed \(401\)/);
  });
});

describe("setAdmin", () => {
  it("adds the row once (a repeat is ignored, not an error) with the service role", async () => {
    const fetchImpl = vi.fn(async () => json(201, [{ user_id: ID }]));
    expect(await setAdmin({ url: URL_, serviceKey: KEY, userId: ID, remove: false, fetchImpl: fetchImpl as typeof fetch })).toEqual({ changed: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:54321/rest/v1/admins?on_conflict=user_id");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("prefer")).toBe("resolution=ignore-duplicates,return=representation");
    expect(JSON.parse(String(init.body))).toEqual({ user_id: ID });
    const again = vi.fn(async () => json(201, []));
    expect(await setAdmin({ url: URL_, serviceKey: KEY, userId: ID, remove: false, fetchImpl: again as typeof fetch })).toEqual({ changed: false });
  });

  it("removes the row, and says when there was none", async () => {
    const removed = vi.fn(async () => json(200, [{ user_id: ID }]));
    expect(await setAdmin({ url: URL_, serviceKey: KEY, userId: ID, remove: true, fetchImpl: removed as typeof fetch })).toEqual({ changed: true });
    const [url, init] = removed.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:54321/rest/v1/admins?user_id=eq.${ID}`);
    expect(init.method).toBe("DELETE");
    const none = vi.fn(async () => json(200, []));
    expect(await setAdmin({ url: URL_, serviceKey: KEY, userId: ID, remove: true, fetchImpl: none as typeof fetch })).toEqual({ changed: false });
  });

  it("throws on a refused write (the table missing, a bad key)", async () => {
    const missing = vi.fn(async () => json(404, { code: "42P01", message: 'relation "public.admins" does not exist' }));
    await expect(setAdmin({ url: URL_, serviceKey: KEY, userId: ID, remove: false, fetchImpl: missing as typeof fetch })).rejects.toThrow(/adding the admin failed \(404\)/);
  });
});
