/**
 * The admin console's routes (src/app/api/admin/{users,boards,bugs,issues}): requireAdmin first (its
 * 401 and 404 pass through untouched, before any read or rate limit), the console's buckets, 400 for
 * bad ids, queries and bodies, 404 for missing rows, 503 without the service key or when a look
 * cannot be logged, 502 naming the table, and each answer in the contract's shape, never cached
 * (screenshots: privately, 5 minutes). fixtures/consoleTables.ts stands in for PostgREST.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/server/admin", () => ({ requireAdmin: gate.requireAdmin }));

import { GET as boardGet } from "@/app/api/admin/boards/[id]/route";
import { GET as boardsGet } from "@/app/api/admin/boards/route";
import { POST as bugReply } from "@/app/api/admin/bugs/[id]/messages/route";
import { PATCH as bugPatch } from "@/app/api/admin/bugs/[id]/route";
import { GET as screenshotGet } from "@/app/api/admin/bugs/[id]/screenshot/route";
import { GET as bugsGet } from "@/app/api/admin/bugs/route";
import { GET as issuesGet, PATCH as issuesPatch } from "@/app/api/admin/issues/route";
import { GET as userGet } from "@/app/api/admin/users/[id]/route";
import { GET as usersGet } from "@/app/api/admin/users/route";
import {
  AdminBoardDocSchema,
  AdminBoardListSchema,
  AdminBugListSchema,
  AdminBugSchema,
  AdminBoardUnchangedSchema,
  AdminIssueListSchema,
  AdminUserDetailSchema,
  AdminUserListSchema,
  issueFingerprint,
} from "@/lib/admin/contracts";
import { resetServerEnvCache } from "@/lib/env";
import { resetConsoleCaches } from "@/lib/server/adminConsole/rest";
import { LIMITS, resetRateLimits } from "@/lib/server/rate-limit";
import { B1, BUG, BUG2, consoleFake, consoleTables, MAYA, NOW, PNG_BASE64 } from "./fixtures/consoleTables";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co/",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  OPENROUTER_API_KEY: "sk-or-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const saved: Record<string, string | undefined> = {};

const ADMIN_USER = { id: "00000000-0000-4000-8000-000000000099", email: "owner@example.com" };
const MISSING = "00000000-0000-4000-8000-0000000000ff";
const BASE = "http://localhost/api/admin";

const req = (path: string, init: RequestInit = {}) => new Request(`${BASE}${path}`, { ...init, headers: { Authorization: "Bearer a.b.c", ...(init.headers ?? {}) } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (path: string, body: unknown) => req(path, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } });

/** Every route, called once with something valid. */
const CALLS: Array<[string, () => Promise<Response>]> = [
  ["GET users", () => usersGet(req("/users"))],
  ["GET users/[id]", () => userGet(req(`/users/${MAYA}`), ctx(MAYA))],
  ["GET boards", () => boardsGet(req("/boards"))],
  ["GET boards/[id]", () => boardGet(req(`/boards/${B1}`), ctx(B1))],
  ["GET bugs", () => bugsGet(req("/bugs"))],
  ["PATCH bugs/[id]", () => bugPatch(patch(`/bugs/${BUG}`, { status: "seen" }), ctx(BUG))],
  ["POST bugs/[id]/messages", () => bugReply(req(`/bugs/${BUG}/messages`, { method: "POST", body: JSON.stringify({ body: "Thanks, looking." }), headers: { "Content-Type": "application/json" } }), ctx(BUG))],
  ["GET bugs/[id]/screenshot", () => screenshotGet(req(`/bugs/${BUG}/screenshot`), ctx(BUG))],
  ["GET issues", () => issuesGet(req("/issues"))],
  ["PATCH issues", () => issuesPatch(patch("/issues", { fingerprint: "live.solve||x", status: "muted" }))],
];

let db: ReturnType<typeof consoleFake>;

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  resetServerEnvCache();
  resetRateLimits();
  resetConsoleCaches();
  gate.requireAdmin.mockReset();
  gate.requireAdmin.mockResolvedValue({ user: ADMIN_USER });
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  db = consoleFake();
  vi.stubGlobal("fetch", db.fetch);
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

describe("every console route", () => {
  it.each(CALLS)("%s: a non-admin gets requireAdmin's 404, and nothing is read", async (_name, call) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    gate.requireAdmin.mockResolvedValue({ response: new Response(null, { status: 404 }) });
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(CALLS)("%s: signed out gets requireAdmin's 401", async (_name, call) => {
    gate.requireAdmin.mockResolvedValue({ response: Response.json({ error: "unauthorized", message: "You need to be signed in to use this feature." }, { status: 401 }) });
    const res = await call();
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
  });

  it.each(CALLS)("%s: 503 without the service role key", async (_name, call) => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetServerEnvCache();
    const res = await call();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("feature_unavailable");
  });

  it.each(CALLS)("%s: answers 2xx with a request id", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("GET /api/admin/users and /users/<id>", () => {
  it("the list in the contract's shape, never cached", async () => {
    const res = await usersGet(req("/users"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(AdminUserListSchema.safeParse(await res.json()).success).toBe(true);
    // the env's trailing slash does not double up
    expect(db.calls.every((c) => !c.path.startsWith("//"))).toBe(true);
  });

  it("one account; 400 for an id that is not a uuid; 404 for no such account", async () => {
    const ok = await userGet(req(`/users/${MAYA}`), ctx(MAYA));
    expect(AdminUserDetailSchema.safeParse(await ok.json()).success).toBe(true);
    const bad = await userGet(req("/users/nope"), ctx("nope"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_request", message: "The user id must be a uuid." });
    const missing = await userGet(req(`/users/${MISSING}`), ctx(MISSING));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "not_found" });
  });

  it("502 naming what failed", async () => {
    vi.stubGlobal("fetch", consoleFake(consoleTables(), { fail: { unlimited_subscriptions: 500 } }).fetch);
    const res = await usersGet(req("/users"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string; requestId: string };
    expect(body.error).toBe("upstream_error");
    expect(body.message).toMatch(/^Couldn't read unlimited_subscriptions: status 500/);
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("GET /api/admin/boards", () => {
  it("a page in the contract's shape", async () => {
    const res = await boardsGet(req(`/boards?userId=${MAYA}&live=1`));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(AdminBoardListSchema.safeParse(body).success).toBe(true);
    expect(body.boards.map((b: { id: string }) => b.id)).toEqual([B1]);
  });

  it.each([["userId=nope"], ["live=maybe"], ["before=yesterday"]])("400 for ?%s", async (qs) => {
    const res = await boardsGet(req(`/boards?${qs}`));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
  });
});

describe("GET /api/admin/boards/<id>", () => {
  it("the document, streamed as JSON, never cached, the look logged", async () => {
    const res = await boardGet(req(`/boards/${B1}`), ctx(B1));
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(AdminBoardDocSchema.safeParse(await res.json()).success).toBe(true);
    expect(db.tables.admin_audit.map((a) => a.action)).toEqual(["board.view"]);
  });

  it("?since= the board's version: { unchanged: true, version } and nothing logged", async () => {
    const res = await boardGet(req(`/boards/${B1}?since=12`), ctx(B1));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ unchanged: true, version: 12 });
    expect(AdminBoardUnchangedSchema.safeParse(body).success).toBe(true);
    expect(db.tables.admin_audit).toEqual([]);
  });

  it("400 for a bad id or since; 404 for no such board", async () => {
    expect((await boardGet(req("/boards/x"), ctx("x"))).status).toBe(400);
    expect((await boardGet(req(`/boards/${B1}?since=-1`), ctx(B1))).status).toBe(400);
    expect((await boardGet(req(`/boards/${B1}?since=abc`), ctx(B1))).status).toBe(400);
    const missing = await boardGet(req(`/boards/${MISSING}`), ctx(MISSING));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "not_found" });
  });

  it("503 when the look cannot be logged: no snapshot leaves", async () => {
    vi.stubGlobal("fetch", consoleFake(consoleTables(), { fail: { admin_audit: 500 } }).fetch);
    const res = await boardGet(req(`/boards/${B1}`), ctx(B1));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ error: "feature_unavailable" });
    expect(text).not.toContain("shape:a");
  });
});

describe("bugs", () => {
  it("GET the inbox in the contract's shape", async () => {
    const res = await bugsGet(req("/bugs"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(AdminBugListSchema.safeParse(await res.json()).success).toBe(true);
  });

  it("PATCH: the report as it now stands", async () => {
    const res = await bugPatch(patch(`/bugs/${BUG}`, { status: "fixed", note: "done" }), ctx(BUG));
    expect(res.status).toBe(200);
    const bug = await res.json();
    expect(AdminBugSchema.safeParse(bug).success).toBe(true);
    expect(bug).toMatchObject({ id: BUG, status: "fixed", note: "done" });
  });

  it.each([
    ["not JSON", "{"],
    ["nothing to change", {}],
    ["an unknown status", { status: "closed" }],
    ["a note over 2,000 characters", { note: "x".repeat(2001) }],
  ])("PATCH 400 for %s", async (_what, body) => {
    const res = await bugPatch(patch(`/bugs/${BUG}`, body), ctx(BUG));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
    expect(db.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("PATCH 400 for a bad id, 404 for no such report", async () => {
    expect((await bugPatch(patch("/bugs/x", { status: "seen" }), ctx("x"))).status).toBe(400);
    const missing = await bugPatch(patch(`/bugs/${MISSING}`, { status: "seen" }), ctx(MISSING));
    expect(missing.status).toBe(404);
  });

  it("GET a screenshot: the image's bytes, private for 5 minutes, the look logged", async () => {
    const res = await screenshotGet(req(`/bugs/${BUG}/screenshot`), ctx(BUG));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).toString("base64")).toBe(PNG_BASE64);
    expect(db.tables.admin_audit.map((a) => a.action)).toEqual(["bug.screenshot"]);
  });

  it("GET a screenshot: 404 without one, 400 for a bad id, 503 when the look cannot be logged", async () => {
    const none = await screenshotGet(req(`/bugs/${BUG2}/screenshot`), ctx(BUG2));
    expect(none.status).toBe(404);
    expect(await none.json()).toMatchObject({ error: "not_found", message: "This bug report has no screenshot." });
    expect((await screenshotGet(req("/bugs/x/screenshot"), ctx("x"))).status).toBe(400);
    vi.stubGlobal("fetch", consoleFake(consoleTables(), { fail: { admin_audit: 500 } }).fetch);
    const unlogged = await screenshotGet(req(`/bugs/${BUG}/screenshot`), ctx(BUG));
    expect(unlogged.status).toBe(503);
    expect(unlogged.headers.get("content-type")).toContain("application/json");
  });

  it("screenshots have their own, larger bucket", async () => {
    expect(LIMITS.adminScreenshot.limit).toBeGreaterThan(LIMITS.adminConsole.limit);
    for (let i = 0; i < LIMITS.adminConsole.limit; i++) await bugsGet(req("/bugs"));
    expect((await bugsGet(req("/bugs"))).status).toBe(429);
    // the console's bucket is spent; a screenshot still loads
    expect((await screenshotGet(req(`/bugs/${BUG}/screenshot`), ctx(BUG))).status).toBe(200);
  });
});

describe("issues", () => {
  it("GET ?days=: 7 by default, 1 and 30 allowed, anything else 400", async () => {
    const res = await issuesGet(req("/issues"));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(AdminIssueListSchema.safeParse(body).success).toBe(true);
    expect(body.days).toBe(7);
    expect(((await (await issuesGet(req("/issues?days=30"))).json()) as { days: number }).days).toBe(30);
    expect((await issuesGet(req("/issues?days=2"))).status).toBe(400);
  });

  it("PATCH: the stored state", async () => {
    const fingerprint = issueFingerprint("live.solve", "upstream", "The tutor couldn't work this one out (attempt 1)");
    const res = await issuesPatch(patch("/issues", { fingerprint, status: "fixed", note: "deployed" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fingerprint, status: "fixed", note: "deployed", fixedAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() });
    expect(db.tables.admin_audit.map((a) => a.action)).toEqual(["issue.update"]);
  });

  it.each([
    ["an unknown status", { fingerprint: "x", status: "closed" }],
    ["no fingerprint", { status: "muted" }],
    ["a fingerprint over 400 characters", { fingerprint: "x".repeat(401), status: "muted" }],
  ])("PATCH 400 for %s", async (_what, body) => {
    const res = await issuesPatch(patch("/issues", body));
    expect(res.status).toBe(400);
    expect(db.tables.admin_issues).toEqual([]);
  });
});
