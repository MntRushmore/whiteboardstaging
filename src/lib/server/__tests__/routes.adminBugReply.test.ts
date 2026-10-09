/**
 * POST /api/admin/bugs/<id>/messages (src/lib/server/adminConsole/bugReplies.ts), through its real
 * handler: requireAdmin first (its 401 and 404 untouched, nothing read), 400 for a bad id or body,
 * 404 for no such report; the reply saved, new -> seen (other statuses stay), admin_audit
 * 'bug.reply' with the length and never the words; then the email: to the reporter's account
 * address, or a kid profile's grown-up (never the kid), and a failed or impossible email never fails
 * the reply. fixtures/consoleTables.ts stands in for PostgREST, src/lib/email/__tests__/fakes.ts for
 * Resend and email_log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/server/admin", () => ({ requireAdmin: gate.requireAdmin }));

// Email comes from `emailDeps`: each test brings its own fake (recorded sends, an email_log in memory).
const mail = vi.hoisted(() => ({ current: null as import("@/lib/email/server").EmailDeps | null }));
vi.mock("@/lib/email/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email/server")>();
  const pick = () => mail.current ?? real.emailDeps;
  return {
    ...real,
    emailDeps: {
      getEnv: () => pick().getEnv(),
      logStore: () => pick().logStore(),
      send: (m: Parameters<typeof real.emailDeps.send>[0], c: Parameters<typeof real.emailDeps.send>[1]) => pick().send(m, c),
    },
  };
});

const events = vi.hoisted(() => ({ recordRouteEvent: vi.fn() }));
vi.mock("@/lib/server/request", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server/request")>()), recordRouteEvent: events.recordRouteEvent }));

import { POST } from "@/app/api/admin/bugs/[id]/messages/route";
import { AdminBugReplySchema } from "@/lib/admin/contracts";
import { resetServerEnvCache } from "@/lib/env";
import { resetConsoleCaches } from "@/lib/server/adminConsole/rest";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { fakeDeps, testEnv, type FakeDeps } from "@/lib/email/__tests__/fakes";
import { BUG, BUG2, consoleFake, consoleTables, iso, MAYA, NOW, uid, USERS } from "./fixtures/consoleTables";
import type { Tables } from "./fixtures/fakeSupabase";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  OPENROUTER_API_KEY: "sk-or-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const saved: Record<string, string | undefined> = {};

const ADMIN_USER = { id: uid(99), email: "owner@example.com" };
const KID = uid(5);
const PARENT = uid(6);
const KID_EMAIL = `kid-${KID}@kids.agathon.app`;
const BUG_KID = "f0000000-0000-4000-8000-0000000000b5";
const BUG_NOBODY = "f0000000-0000-4000-8000-0000000000b6";
const MISSING = "f0000000-0000-4000-8000-0000000000ff";
const REPLY = "Thanks for telling us. It's fixed now, try again.";

/** The console's world plus a kid profile (Maya Lee, grown-up PARENT) who filed a report, and a report from no account. */
function world(): Tables {
  const t = consoleTables();
  t.profiles.push({ user_id: KID, display_name: "Maya Lee", course: null, created_at: iso(86_400_000), onboarded_at: null, ink_balance: 0 });
  t.family_members.push({ child_id: KID, parent_id: PARENT });
  t.bug_reports.push(
    { id: BUG_KID, user_id: KID, user_email: KID_EMAIL, board_id: null, message: "my board went blank", screenshot: null, diagnostics: {}, logs: [], status: "new", admin_note: null, resolved_at: null, reporter_seen_at: null, created_at: iso(7_200_000) },
    { id: BUG_NOBODY, user_id: null, user_email: null, board_id: null, message: "old report", screenshot: null, diagnostics: {}, logs: [], status: "seen", admin_note: null, resolved_at: null, reporter_seen_at: null, created_at: iso(9_000_000) },
  );
  return t;
}
const users = { ...USERS, [KID]: { email: KID_EMAIL }, [PARENT]: { email: "parent@example.com" } };

let db: ReturnType<typeof consoleFake>;
let deps: FakeDeps;

const post = (id: string, body: unknown) =>
  POST(
    new Request(`http://localhost/api/admin/bugs/${id}/messages`, { method: "POST", headers: { Authorization: "Bearer a.b.c", "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

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
  events.recordRouteEvent.mockReset();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  db = consoleFake(world(), { users });
  vi.stubGlobal("fetch", db.fetch);
  deps = fakeDeps({ now: new Date(NOW) });
  mail.current = deps;
});

afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetServerEnvCache();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mail.current = null;
});

const written = () => db.calls.filter((c) => c.method !== "GET" && c.method !== "HEAD");

describe("who may reply", () => {
  it("a non-admin gets requireAdmin's 404 and signed out its 401; nothing is read or sent", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    gate.requireAdmin.mockResolvedValueOnce({ response: new Response(null, { status: 404 }) });
    expect((await post(BUG, { body: REPLY })).status).toBe(404);
    gate.requireAdmin.mockResolvedValueOnce({ response: Response.json({ error: "unauthorized" }, { status: 401 }) });
    expect((await post(BUG, { body: REPLY })).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    expect(deps.send).not.toHaveBeenCalled();
  });
});

describe("what it takes", () => {
  it.each([
    ["not JSON", "{"],
    ["no body", {}],
    ["an empty reply", { body: "   \n " }],
    ["a reply over 4,000 characters", { body: "x".repeat(4001) }],
  ])("400 for %s, nothing written", async (_what, body) => {
    const res = await post(BUG, body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
    expect(written()).toEqual([]);
  });

  it("400 for an id that is not a uuid; 404 for no such report, nothing written or sent", async () => {
    expect((await post("nope", { body: REPLY })).status).toBe(400);
    const missing = await post(MISSING, { body: REPLY });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "not_found" });
    expect(written()).toEqual([]);
    expect(deps.send).not.toHaveBeenCalled();
  });
});

describe("a reply", () => {
  it("is saved and answered with the report as it now stands; new moves to seen; logged with its length only; emailed to the reporter", async () => {
    const res = await post(BUG, { body: `  ${REPLY}  ` });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const answer = AdminBugReplySchema.parse(await res.json());
    expect(answer.bug).toMatchObject({ id: BUG, status: "seen", waiting: false });
    expect(answer.bug.thread.map((m) => [m.author, m.body])).toEqual([["admin", REPLY]]);
    expect(answer.email).toEqual({ status: "sent", to: "reporter" });

    expect(db.tables.bug_report_messages).toEqual([expect.objectContaining({ report_id: BUG, author: "admin", author_id: ADMIN_USER.id, body: REPLY })]);
    const audit = db.tables.admin_audit.at(-1)!;
    expect(audit).toMatchObject({ admin_id: ADMIN_USER.id, action: "bug.reply", target_kind: "bug", target_id: BUG, meta: { length: REPLY.length } });
    expect(JSON.stringify(audit)).not.toContain("fixed now");

    expect(deps.sent).toHaveLength(1);
    expect(deps.sent[0]).toMatchObject({ to: "maya@example.com", subject: "We replied to your bug report" });
    expect(deps.sent[0].html).toContain(`/reports#${BUG}`);
    expect(deps.log.rows).toEqual([expect.objectContaining({ user_id: MAYA, kind: "bug_reply", ref: answer.bug.thread[0].id })]);
  });

  it("a report already seen, fixed or set aside stays where the admin put it", async () => {
    const seen = AdminBugReplySchema.parse(await (await post(BUG2, { body: "Could you tell us more?" })).json());
    expect(seen.bug.status).toBe("seen");
    db.tables.bug_reports.find((b) => b.id === BUG)!.status = "fixed";
    const fixed = AdminBugReplySchema.parse(await (await post(BUG, { body: "This is fixed." })).json());
    expect(fixed.bug.status).toBe("fixed");
    expect(written().filter((c) => c.method === "PATCH")).toEqual([]);
  });

  it("the reporter wrote last: Waiting on you, until the reply", async () => {
    db.tables.bug_report_messages.push(
      { id: "a1", report_id: BUG2, author: "admin", author_id: ADMIN_USER.id, body: "Which device?", created_at: iso(3_600_000) },
      { id: "r1", report_id: BUG2, author: "reporter", author_id: uid(2), body: "My iPad", created_at: iso(60_000) },
    );
    const answer = AdminBugReplySchema.parse(await (await post(BUG2, { body: "Thanks, we'll look." })).json());
    expect(answer.bug.thread.map((m) => m.author)).toEqual(["admin", "reporter", "admin"]);
    expect(answer.bug.waiting).toBe(false);
  });
});

describe("the email", () => {
  it("a kid profile's report goes to their grown-up, named, never to the kid's address", async () => {
    const answer = AdminBugReplySchema.parse(await (await post(BUG_KID, { body: REPLY })).json());
    expect(answer.email).toEqual({ status: "sent", to: "grown_up" });
    expect(deps.sent).toHaveLength(1);
    expect(deps.sent[0]).toMatchObject({ to: "parent@example.com", subject: "We replied to Maya's bug report" });
    expect(JSON.stringify(deps.sent)).not.toContain("kids.agathon.app");
    // the log row is the kid's (it goes with their account)
    expect(deps.log.rows[0]).toMatchObject({ user_id: KID, kind: "bug_reply" });
  });

  it("a kid with no grown-up on record: no email, the reply saved", async () => {
    db.tables.family_members.length = 0;
    const res = await post(BUG_KID, { body: REPLY });
    expect(res.status).toBe(200);
    expect(AdminBugReplySchema.parse(await res.json()).email).toEqual({ status: "skipped", reason: "no_grown_up" });
    expect(deps.send).not.toHaveBeenCalled();
    expect(db.tables.bug_report_messages).toHaveLength(1);
  });

  it("a report from no account: saved, nobody to email", async () => {
    const answer = AdminBugReplySchema.parse(await (await post(BUG_NOBODY, { body: REPLY })).json());
    expect(answer.email).toEqual({ status: "skipped", reason: "no_reporter" });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("Resend failing never fails the reply: saved, 200, the email failed, a warning event", async () => {
    deps.sendReplies.push({ ok: false, error: "rate_limit_exceeded", status: 429 });
    const res = await post(BUG, { body: REPLY });
    expect(res.status).toBe(200);
    expect(AdminBugReplySchema.parse(await res.json()).email).toEqual({ status: "failed", to: "reporter" });
    expect(db.tables.bug_report_messages).toHaveLength(1);
    expect(events.recordRouteEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ level: "warn", code: "email_failed" }));
  });

  it("the account cannot be looked up: still saved and answered, the email failed", async () => {
    vi.stubGlobal("fetch", consoleFake(world(), { users, fail: { family_members: 500 } }).fetch);
    const res = await post(BUG_KID, { body: REPLY });
    expect(res.status).toBe(200);
    expect(AdminBugReplySchema.parse(await res.json()).email).toEqual({ status: "failed", to: null });
  });

  it("no RESEND_API_KEY (development): the reply works, no email, nothing looked up for it", async () => {
    mail.current = fakeDeps({ env: testEnv({ resend: { apiKey: null } }) });
    const res = await post(BUG, { body: REPLY });
    expect(res.status).toBe(200);
    expect(AdminBugReplySchema.parse(await res.json()).email).toEqual({ status: "skipped", reason: "not_configured" });
    expect(db.calls.some((c) => c.path.startsWith("/auth/v1/"))).toBe(false);
    expect(mail.current.send).not.toHaveBeenCalled();
  });
});

describe("failures", () => {
  it("502 naming the table when the reply cannot be written; nothing emailed", async () => {
    vi.stubGlobal("fetch", consoleFake(world(), { users, fail: { bug_report_messages: 500 } }).fetch);
    const res = await post(BUG, { body: REPLY });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { message: string }).message).toMatch(/bug_report_messages/);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it("503 without the service role key", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetServerEnvCache();
    expect((await post(BUG, { body: REPLY })).status).toBe(503);
  });
});
