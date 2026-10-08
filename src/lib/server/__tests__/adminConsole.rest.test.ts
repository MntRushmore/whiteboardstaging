/**
 * The console's PostgREST client (src/lib/server/adminConsole/rest.ts): pages read in parallel once
 * the first says how many, the cap and whether rows were left out, a missing object named with its
 * migration, reads and writes told apart, emails one by one or from the whole directory.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_EMAIL_LOOKUPS, queryString, resetConsoleCaches, restClient } from "@/lib/server/adminConsole/rest";
import { fakeSupabase, type Row } from "./fixtures/fakeSupabase";

beforeEach(() => resetConsoleCaches());

const deps = (f: typeof fetch) => ({ url: "https://proj.supabase.co", serviceKey: "service-key", fetch: f });
const many = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, at: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString() }));

describe("paged", () => {
  it("the first page counts; the rest are read in parallel, only as far as needed", async () => {
    const db = fakeSupabase({ app_events: many(2_500) });
    const { rows, truncated } = await restClient(deps(db.fetch)).paged<Row>({ table: "app_events", params: { select: "id", order: "id.asc" } });
    expect(rows).toHaveLength(2_500);
    expect(truncated).toBe(false);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2_500);
    expect(db.calls.map((c) => c.params.get("offset"))).toEqual(["0", "1000", "2000"]);
    expect(db.calls[0].headers.get("prefer")).toBe("count=exact");
  });

  it("stops at the cap and says rows were left out", async () => {
    const db = fakeSupabase({ app_events: many(2_500) });
    const { rows, truncated } = await restClient(deps(db.fetch)).paged<Row>({ table: "app_events", params: { select: "id", order: "id.asc" } }, 1_500);
    expect(rows).toHaveLength(1_500);
    expect(truncated).toBe(true);
    expect(db.calls.map((c) => [c.params.get("offset"), c.params.get("limit")])).toEqual([["0", "1000"], ["1000", "500"]]);
  });

  it("without a count in the answer, page by page", async () => {
    const db = fakeSupabase({ app_events: many(2_000) });
    const noCount: typeof fetch = async (input, init) => {
      const res = await db.fetch(input, init);
      return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
    };
    const capped = await restClient(deps(noCount)).paged<Row>({ table: "app_events", params: { select: "id" } }, 2_000);
    expect(capped).toMatchObject({ truncated: false });
    expect(capped.rows).toHaveLength(2_000);
    expect(db.calls.map((c) => c.params.get("offset"))).toEqual(["0", "1000", "2000"]);
  });
});

describe("errors", () => {
  it("a missing table or function is named with the migration; a write says so", async () => {
    const rest = restClient(deps(fakeSupabase({}).fetch));
    await expect(rest.rows({ table: "admin_bug_rows", params: {} })).rejects.toThrow("Couldn't read admin_bug_rows: it does not exist (is migration 20261008000000_admin_console.sql applied?)");
    await expect(rest.rows({ table: "rpc/admin_user_days", params: {} })).rejects.toThrow(/^Couldn't read rpc\/admin_user_days: it does not exist/);
    const failing = restClient(deps(fakeSupabase({ admin_issues: [] }, { fail: { admin_issues: 500 } }).fetch));
    await expect(failing.upsert("admin_issues", "fingerprint", { fingerprint: "x", status: "muted" }, "fingerprint")).rejects.toThrow(/^Couldn't write admin_issues: status 500 XX000/);
  });
});

describe("queryString", () => {
  it("keeps PostgREST's syntax readable and repeats a key given a list", () => {
    expect(queryString({ select: "id,stack:meta->>stack", at: ["gte.2026-10-08T00:00:00.000Z", "lt.2026-10-09T00:00:00+00:00"] })).toBe(
      "select=id,stack:meta->>stack&at=gte.2026-10-08T00:00:00.000Z&at=lt.2026-10-09T00:00:00%2B00:00",
    );
  });
});

describe("emails", () => {
  it("a few accounts one by one (remembered); many from the whole directory", async () => {
    const users = Object.fromEntries(Array.from({ length: MAX_EMAIL_LOOKUPS + 5 }, (_, i) => [`u${i}`, `u${i}@example.com`]));
    const db = fakeSupabase({}, { users });
    const rest = restClient(deps(db.fetch));
    expect(await rest.emails(["u1", "u2", null, "u1", "ghost"])).toEqual(new Map([["u1", "u1@example.com"], ["u2", "u2@example.com"], ["ghost", null]]));
    await rest.emails(["u1"]);
    expect(db.calls.filter((c) => c.path.startsWith("/auth/v1/admin/users/"))).toHaveLength(3);
    const all = await rest.emails(Object.keys(users));
    expect(all.get(`u${MAX_EMAIL_LOOKUPS + 4}`)).toBe(`u${MAX_EMAIL_LOOKUPS + 4}@example.com`);
    expect(db.calls.filter((c) => c.path.startsWith("/auth/v1/admin/users?"))).toHaveLength(1);
  });
});
