/**
 * The /api/report routes through their real handlers: whose week the server reads, whose board it
 * opens, and what the one-tap unsubscribe link can do. supabase-js is faked for what the routes do
 * themselves (verifying the bearer token, the per-user rate limit); the family's rows are the
 * in-memory store in fakeStore.ts, swapped in through `reportDeps`. The contract: 401 before
 * anything, a grown-up sees their own kids and nobody else's, a kid only themselves, a board opens
 * only for its owner or the owner's grown-up (and its data is never read otherwise), and the email
 * link turns off exactly the account it was signed for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

const fake = vi.hoisted(() => ({
  users: new Map<string, { id: string; email: string }>(),
  rateLimit: { allowed: true, remaining: 29, retry_after_ms: 0, backend: "db" } as Record<string, unknown>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const user = fake.users.get(token);
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid token", status: 401 } };
      },
    },
    rpc: async (fn: string) => (fn === "rate_limit_hit" ? { data: fake.rateLimit, error: null } : { data: null, error: { message: `no fake for ${fn}` } }),
  }),
}));

const deps = vi.hoisted(() => ({ store: null as import("../server").ReportStore | null, missing: false }));
vi.mock("@/lib/report/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("../server")>();
  return { ...real, reportDeps: { store: () => (deps.missing ? null : deps.store), now: () => Date.parse("2026-10-08T15:00:00Z") } };
});

import { GET as boardGet } from "@/app/api/report/boards/[id]/route";
import { GET as reportGet } from "@/app/api/report/route";
import { GET as unsubscribeGet, POST as unsubscribePost } from "@/app/api/report/unsubscribe/route";
import { resetServerEnvCache } from "@/lib/env";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import type { ReportAnswer } from "../contracts";
import { unsubscribeTag } from "../unsubscribe";
import { BOARDS, IDS, makeFakeStore, type FakeReportStore } from "./fakeStore";

const TOKENS = {
  parent: "parent.token.aaaa",
  kidA: "kida.token.aaaa",
  otherParent: "otherparent.token.aaaa",
  solo: "solo.token.aaaa",
} as const;

const ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "RATE_LIMIT_BACKEND", "CRON_SECRET", "REPORT_LINK_SECRET", "REPORT_LINK_SECRET_PREVIOUS", "WEEKLY_REPORT_EMAILS"];
const saved: Record<string, string | undefined> = {};
let store: FakeReportStore;
const SECRET = "unit-cron-secret";

beforeEach(() => {
  for (const v of ENV_VARS) saved[v] = process.env[v];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.CRON_SECRET = SECRET;
  delete process.env.REPORT_LINK_SECRET;
  delete process.env.REPORT_LINK_SECRET_PREVIOUS;
  delete process.env.RATE_LIMIT_BACKEND;
  delete process.env.WEEKLY_REPORT_EMAILS;
  resetServerEnvCache();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.rateLimit = { allowed: true, remaining: 29, retry_after_ms: 0, backend: "db" };
  store = makeFakeStore();
  deps.store = store;
  deps.missing = false;
  fake.users = new Map([
    [TOKENS.parent, { id: IDS.parent, email: "parent@example.com" }],
    [TOKENS.kidA, { id: IDS.kidA, email: `kid-${IDS.kidA}@kids.agathon.app` }],
    [TOKENS.otherParent, { id: IDS.otherParent, email: "other@example.com" }],
    [TOKENS.solo, { id: IDS.solo, email: "solo@example.com" }],
  ]);
});

afterEach(() => {
  for (const v of ENV_VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  resetServerEnvCache();
});

const get = (path: string, token?: string) => new Request(`http://localhost${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const boardCtx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/report", () => {
  it("401 without a session, before reading anything", async () => {
    const res = await reportGet(get("/api/report?week=2026-10-05"));
    expect(res.status).toBe(401);
    expect(store.links).not.toHaveBeenCalled();
  });

  it("gives a grown-up their own kids' weeks, and nobody else's", async () => {
    const res = await reportGet(get("/api/report?week=2026-10-05&tz=America/New_York", TOKENS.parent));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const body = (await res.json()) as ReportAnswer;
    expect(body.role).toBe("parent");
    expect(body.report.weekStart).toBe("2026-10-05");
    expect(body.report.ownerId).toBe(IDS.parent);
    // the grown-up did nothing this week: only the kids, in the order they were added
    expect(body.report.children.map((c) => c.displayName)).toEqual(["Maya", "Leo"]);
    const maya = body.report.children[0];
    expect(maya).toMatchObject({ problems: 4, independent: 4, dailySets: 2, highlightBoardId: BOARDS.kidA, grade: 3, avatar: "fox" });
    expect(body.email).toEqual({ optedOut: false, sending: false });
    // read only the caller's family
    const read = (store.attempts as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(read.sort()).toEqual([IDS.kidA, IDS.kidB, IDS.parent].sort());
  });

  it("gives a kid profile only their own week, with no email setting", async () => {
    const body = (await (await reportGet(get("/api/report?week=2026-10-05", TOKENS.kidA))).json()) as ReportAnswer;
    expect(body.role).toBe("kid");
    expect(body.report.children.map((c) => c.userId)).toEqual([IDS.kidA]);
    expect(body.email).toBeNull();
    expect((store.attempts as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([IDS.kidA]);
  });

  it("gives a solo student their own week, named You when they have no name", async () => {
    const body = (await (await reportGet(get("/api/report", TOKENS.solo))).json()) as ReportAnswer;
    expect(body.role).toBe("solo");
    expect(body.report.weekStart).toBe("2026-10-05");
    expect(body.report.children.map((c) => [c.userId, c.displayName])).toEqual([[IDS.solo, "You"]]);
  });

  it("says when the email is sent, and the caller's own setting", async () => {
    process.env.WEEKLY_REPORT_EMAILS = "on";
    store.profileRows.get(IDS.parent)!.optedOut = true;
    const body = (await (await reportGet(get("/api/report", TOKENS.parent))).json()) as ReportAnswer;
    expect(body.email).toEqual({ optedOut: true, sending: true });
  });

  it("400 for a week that is not a date, in the future, or over a year back", async () => {
    for (const week of ["soon", "2026-10-12", "2025-09-01", "2026-13-01"]) {
      const res = await reportGet(get(`/api/report?week=${week}`, TOKENS.parent));
      expect(res.status, week).toBe(400);
    }
    expect(store.links).not.toHaveBeenCalled();
  });

  it("reads an unknown zone as New York, and any date as its week", async () => {
    const body = (await (await reportGet(get("/api/report?week=2026-10-01&tz=Mars/Base", TOKENS.parent))).json()) as ReportAnswer;
    expect(body.report).toMatchObject({ weekStart: "2026-09-28", timeZone: "America/New_York" });
  });

  it("429 past the rate limit, 503 without the service role, 502 when a read fails", async () => {
    fake.rateLimit = { allowed: false, remaining: 0, retry_after_ms: 20_000, backend: "db" };
    expect((await reportGet(get("/api/report", TOKENS.parent))).status).toBe(429);
    fake.rateLimit = { allowed: true, remaining: 29, retry_after_ms: 0, backend: "db" };
    deps.missing = true;
    expect((await reportGet(get("/api/report", TOKENS.parent))).status).toBe(503);
    deps.missing = false;
    (store.attempts as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("down"));
    const res = await reportGet(get("/api/report", TOKENS.parent));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "upstream_error" });
  });
});

describe("GET /api/report/boards/<id>", () => {
  it("opens a kid's board for their grown-up", async () => {
    const res = await boardGet(get(`/api/report/boards/${BOARDS.kidA}`, TOKENS.parent), boardCtx(BOARDS.kidA));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: BOARDS.kidA, ownerId: IDS.kidA, ownerName: "Maya", ownerAvatar: "fox", title: "Times tables" });
  });

  it("opens a kid's own board for them, but never a sibling's", async () => {
    expect((await boardGet(get("/x", TOKENS.kidA), boardCtx(BOARDS.kidA))).status).toBe(200);
    const sibling = await boardGet(get("/x", TOKENS.kidA), boardCtx(BOARDS.kidB));
    expect(sibling.status).toBe(404);
    expect(store.board).toHaveBeenCalledTimes(1);
  });

  it("404 for another family's board, a deleted one, or none, without reading its data", async () => {
    for (const id of [BOARDS.otherKid, BOARDS.deleted, "c0000000-0000-4000-8000-000000000000"]) {
      const res = await boardGet(get("/x", TOKENS.parent), boardCtx(id));
      expect(res.status, id).toBe(404);
    }
    expect((await boardGet(get("/x", TOKENS.otherParent), boardCtx(BOARDS.kidA))).status).toBe(404);
    expect(store.board).not.toHaveBeenCalled();
  });

  it("401 signed out, 400 for an id that is not a uuid", async () => {
    expect((await boardGet(get("/x"), boardCtx(BOARDS.kidA))).status).toBe(401);
    expect((await boardGet(get("/x", TOKENS.parent), boardCtx("../../etc"))).status).toBe(400);
  });
});

describe("/api/report/unsubscribe", () => {
  const url = (u: string, t: string) => `http://localhost/api/report/unsubscribe?u=${u}&t=${t}`;
  const link = (u: string, t: string) => new Request(url(u, t), { headers: { "x-forwarded-for": "198.51.100.7" } });
  /** The confirm page's button, or a mail app's RFC 8058 one-click (its body is never read). */
  const click = (u: string, t: string, oneClick = false) =>
    new Request(url(u, t), {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.7", "content-type": "application/x-www-form-urlencoded" },
      body: oneClick ? "List-Unsubscribe=One-Click" : "",
    });
  const formAction = (html: string) => html.match(/<form method="post" action="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&") ?? null;

  it("opening the link only asks: nothing changes, and the page's one button posts back to the same link", async () => {
    const t = unsubscribeTag(IDS.parent, SECRET);
    const res = await unsubscribeGet(link(IDS.parent, t));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'self'");
    const html = await res.text();
    expect(html).toContain("Stop the weekly email?");
    expect(html).toContain(">Stop the weekly email</button>");
    expect(formAction(html)).toBe(`/api/report/unsubscribe?u=${IDS.parent}&t=${t}`);
    // a mail scanner that opens every link turns nothing off
    expect(store.setOptOut).not.toHaveBeenCalled();
    expect(store.profileRows.get(IDS.parent)!.optedOut).toBe(false);
  });

  it("the button turns off the email of exactly the account the link was signed for", async () => {
    const res = await unsubscribePost(click(IDS.parent, unsubscribeTag(IDS.parent, SECRET)));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("You're unsubscribed");
    expect(store.setOptOut).toHaveBeenCalledWith(IDS.parent, true);
    expect(store.setOptOut).toHaveBeenCalledTimes(1);
    expect(store.profileRows.get(IDS.parent)!.optedOut).toBe(true);
  });

  it("a mail app's one-click (RFC 8058) POST turns it off with no page to confirm", async () => {
    const res = await unsubscribePost(click(IDS.parent, unsubscribeTag(IDS.parent, SECRET), true));
    expect(res.status).toBe(200);
    expect(store.profileRows.get(IDS.parent)!.optedOut).toBe(true);
  });

  it("400 for a link that does not verify: another account's tag, a cut-off tag, another secret; both methods", async () => {
    for (const [u, t] of [
      [IDS.otherParent, unsubscribeTag(IDS.parent, SECRET)],
      [IDS.parent, unsubscribeTag(IDS.parent, SECRET).slice(0, 20)],
      [IDS.parent, unsubscribeTag(IDS.parent, "another-secret")],
      ["not-a-uuid", unsubscribeTag(IDS.parent, SECRET)],
    ]) {
      for (const res of [await unsubscribeGet(link(u, t)), await unsubscribePost(click(u, t))]) {
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("This link didn't work");
        expect(html).not.toContain("<form");
      }
    }
    expect(store.setOptOut).not.toHaveBeenCalled();
  });

  it("signs with REPORT_LINK_SECRET when set; a link signed with REPORT_LINK_SECRET_PREVIOUS still works", async () => {
    process.env.REPORT_LINK_SECRET = "unit-link-secret";
    process.env.REPORT_LINK_SECRET_PREVIOUS = SECRET;
    resetServerEnvCache();
    expect((await unsubscribePost(click(IDS.kidA, unsubscribeTag(IDS.kidA, "unit-link-secret")))).status).toBe(200);
    // an email sent before the rotation, signed with the old (here: the cron's) secret
    expect((await unsubscribePost(click(IDS.parent, unsubscribeTag(IDS.parent, SECRET)))).status).toBe(200);
    expect(store.setOptOut).toHaveBeenCalledTimes(2);
    // once the old value is dropped, its links stop verifying (and the cron's secret alone signs nothing)
    delete process.env.REPORT_LINK_SECRET_PREVIOUS;
    resetServerEnvCache();
    expect((await unsubscribePost(click(IDS.otherParent, unsubscribeTag(IDS.otherParent, SECRET)))).status).toBe(400);
  });

  it("503 without a signing secret or the service role; 502 when the write fails", async () => {
    delete process.env.CRON_SECRET;
    resetServerEnvCache();
    expect((await unsubscribeGet(link(IDS.parent, unsubscribeTag(IDS.parent, SECRET)))).status).toBe(503);
    expect((await unsubscribePost(click(IDS.parent, unsubscribeTag(IDS.parent, SECRET)))).status).toBe(503);
    process.env.CRON_SECRET = SECRET;
    resetServerEnvCache();
    deps.missing = true;
    expect((await unsubscribePost(click(IDS.parent, unsubscribeTag(IDS.parent, SECRET)))).status).toBe(503);
    deps.missing = false;
    (store.setOptOut as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("down"));
    expect((await unsubscribePost(click(IDS.parent, unsubscribeTag(IDS.parent, SECRET)))).status).toBe(502);
  });

  it("is rate limited per IP, both methods on one budget", async () => {
    const t = unsubscribeTag(IDS.parent, SECRET);
    for (let i = 0; i < 10; i++) expect((await unsubscribeGet(link(IDS.parent, t))).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await unsubscribePost(click(IDS.parent, t))).status).toBe(200);
    expect((await unsubscribeGet(link(IDS.parent, t))).status).toBe(429);
    expect((await unsubscribePost(click(IDS.parent, t))).status).toBe(429);
  });
});
