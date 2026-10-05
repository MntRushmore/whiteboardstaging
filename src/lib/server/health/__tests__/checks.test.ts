/**
 * Each health check against a fake provider (no network): what it calls, what passes, what fails
 * and how the failure reads, plus the per-check deadline.
 */
import { describe, expect, it, vi } from "vitest";
import {
  checkApp,
  checkDatabase,
  checkEmail,
  checkMathpix,
  checkOpenRouter,
  checkStripe,
  creditsDetail,
  parseCreditsDetail,
  runCheck,
  runChecks,
  senderDomain,
  toHealthResult,
  type CheckDeps,
  type CheckEnv,
} from "@/lib/server/health/checks";

const NOW = new Date("2026-10-05T14:00:00.000Z");

const ENV: CheckEnv = {
  supabaseUrl: "https://proj.supabase.co",
  serviceKey: "svc-key",
  siteUrl: "https://whiteboard.example.com",
  openrouterKey: "sk-or-v1-test",
  mathpix: { appId: "app-id", appKey: "app-key" },
  resendKey: "re_test",
  emailFrom: "Agathon <hello@mail.agathon.app>",
  stripeWebhookConfigured: true,
};

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A fetch double: the first route whose prefix matches answers; every call is recorded. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) throw new TypeError(`fetch failed: no route for ${url}`);
    return routes[key](url, init);
  });
  return { calls, fetch: impl as unknown as typeof fetch };
}

function deps(f: ReturnType<typeof fakeFetch>, extra: Partial<CheckDeps> = {}): CheckDeps {
  return { fetch: f.fetch, now: () => NOW, ...extra };
}

const signal = new AbortController().signal;

describe("app", () => {
  it("passes on the site's own 200 { ok: true } and names the release", async () => {
    const f = fakeFetch({ "https://whiteboard.example.com/api/health": () => json(200, { ok: true, db: "up", release: "abc1234" }) });
    await expect(checkApp(ENV, deps(f), signal)).resolves.toEqual({ ok: true, detail: "release abc1234" });
    expect(f.calls[0].init.cache).toBe("no-store");
  });

  it("a 503 db down: the site answers, marked needsDatabase", async () => {
    const f = fakeFetch({ "https://whiteboard.example.com/api/health": () => json(503, { ok: false, db: "down", release: "abc" }) });
    await expect(checkApp(ENV, deps(f), signal)).resolves.toMatchObject({ ok: false, needsDatabase: true, code: "upstream" });
  });

  it("anything else fails with the status", async () => {
    const f = fakeFetch({ "https://whiteboard.example.com/api/health": () => new Response("<html>", { status: 502 }) });
    await expect(checkApp(ENV, deps(f), signal)).resolves.toEqual({ ok: false, code: "upstream", detail: "/api/health answered 502" });
  });
});

describe("database", () => {
  it("one row of profiles with the service role", async () => {
    const f = fakeFetch({ "https://proj.supabase.co/rest/v1/profiles": () => json(200, [{ user_id: "u" }]) });
    await expect(checkDatabase(ENV, deps(f), signal)).resolves.toMatchObject({ ok: true });
    expect(f.calls[0].url).toBe("https://proj.supabase.co/rest/v1/profiles?select=user_id&limit=1");
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer svc-key");
  });

  it("a PostgREST error throws with the table and message (runCheck turns it into a failure)", async () => {
    const f = fakeFetch({ "https://proj.supabase.co/rest/v1/profiles": () => json(503, { code: "PGRST001", message: "Database client error" }) });
    const r = await runCheck("database", checkDatabase, ENV, deps(f), NOW.toISOString());
    expect(r).toMatchObject({ service: "database", ok: false, code: "upstream", detail: "profiles: 503 Database client error" });
  });
});

describe("openrouter", () => {
  const key = (body: unknown, status = 200) => () => json(status, body);

  it("credit left is the lower of the key's limit and the account balance", async () => {
    const f = fakeFetch({
      "https://openrouter.ai/api/v1/key": key({ data: { limit_remaining: 40, usage: 10, limit: 50 } }),
      "https://openrouter.ai/api/v1/credits": key({ data: { total_credits: 100, total_usage: 87.6 } }),
    });
    await expect(checkOpenRouter(ENV, deps(f), signal)).resolves.toEqual({ ok: true, detail: "$12.40 credit left", creditsLeftUsd: expect.closeTo(12.4, 5) });
    expect(f.calls.every((c) => (c.init.headers as Record<string, string>).Authorization === "Bearer sk-or-v1-test")).toBe(true);
  });

  it("/credits refusing a non-management key: the key's limit alone", async () => {
    const f = fakeFetch({
      "https://openrouter.ai/api/v1/key": key({ data: { limit_remaining: 7.5 } }),
      "https://openrouter.ai/api/v1/credits": key({ error: { message: "Only management keys can perform this operation" } }, 403),
    });
    await expect(checkOpenRouter(ENV, deps(f), signal)).resolves.toMatchObject({ ok: true, creditsLeftUsd: 7.5, detail: "$7.50 credit left" });
  });

  it("no limit and no balance: passes, credit unknown", async () => {
    const f = fakeFetch({
      "https://openrouter.ai/api/v1/key": key({ data: { limit_remaining: null, usage: 3 } }),
      "https://openrouter.ai/api/v1/credits": key({}, 403),
    });
    await expect(checkOpenRouter(ENV, deps(f), signal)).resolves.toMatchObject({ ok: true, creditsLeftUsd: null, detail: expect.stringContaining("credit unknown") });
  });

  it("out of credit fails", async () => {
    const f = fakeFetch({
      "https://openrouter.ai/api/v1/key": key({ data: { limit_remaining: null } }),
      "https://openrouter.ai/api/v1/credits": key({ data: { total_credits: 20, total_usage: 20.3 } }),
    });
    await expect(checkOpenRouter(ENV, deps(f), signal)).resolves.toMatchObject({ ok: false, code: "out_of_credit", detail: "out of credit ($0.00 credit left)" });
  });

  it("a rejected key fails as unauthorized", async () => {
    const f = fakeFetch({
      "https://openrouter.ai/api/v1/key": key({ error: { message: "No auth credentials found", code: 401 } }, 401),
      "https://openrouter.ai/api/v1/credits": key({}, 401),
    });
    await expect(checkOpenRouter(ENV, deps(f), signal)).resolves.toMatchObject({ ok: false, code: "unauthorized", detail: "key rejected (401): No auth credentials found", creditsLeftUsd: null });
  });

  it("the balance call failing on the network does not fail the check", async () => {
    const f = fakeFetch({ "https://openrouter.ai/api/v1/key": key({ data: { limit_remaining: 9 } }) });
    await expect(checkOpenRouter(ENV, deps(f), signal)).resolves.toMatchObject({ ok: true, creditsLeftUsd: 9 });
  });

  it("without OPENROUTER_API_KEY: unconfigured", async () => {
    await expect(checkOpenRouter({ ...ENV, openrouterKey: undefined }, deps(fakeFetch({})), signal)).resolves.toMatchObject({ ok: false, code: "unconfigured" });
  });

  it("creditsDetail round-trips for the overview", () => {
    expect(parseCreditsDetail(creditsDetail(12.4))).toBe(12.4);
    expect(parseCreditsDetail("key works")).toBeNull();
  });
});

describe("mathpix", () => {
  it("mints a 30 s app token (free) with both keys and reads nothing else", async () => {
    const f = fakeFetch({ "https://api.mathpix.com/v3/app-tokens": () => json(200, { app_token: "tok", app_token_expires_at: 1 }) });
    await expect(checkMathpix(ENV, deps(f), signal)).resolves.toEqual({ ok: true, detail: "key works" });
    const call = f.calls[0];
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(String(call.init.body))).toEqual({ expires: 30 });
    expect(call.init.headers).toMatchObject({ app_id: "app-id", app_key: "app-key" });
  });

  it("401 / 403: keys rejected", async () => {
    const f = fakeFetch({ "https://api.mathpix.com/v3/app-tokens": () => json(401, { error: "Invalid credentials" }) });
    await expect(checkMathpix(ENV, deps(f), signal)).resolves.toEqual({ ok: false, code: "unauthorized", detail: "keys rejected (401)" });
  });

  it("5xx: upstream", async () => {
    const f = fakeFetch({ "https://api.mathpix.com/v3/app-tokens": () => json(500, { error: "Internal error" }) });
    await expect(checkMathpix(ENV, deps(f), signal)).resolves.toMatchObject({ ok: false, code: "upstream", detail: "Mathpix answered 500: Internal error" });
  });

  it("not configured", async () => {
    await expect(checkMathpix({ ...ENV, mathpix: null }, deps(fakeFetch({})), signal)).resolves.toMatchObject({ ok: false, code: "unconfigured" });
  });
});

describe("email", () => {
  const domains = (list: unknown[]) => () => json(200, { object: "list", has_more: false, data: list });

  it("the sending domain verified: passes", async () => {
    const f = fakeFetch({ "https://api.resend.com/domains": domains([{ name: "mail.agathon.app", status: "verified" }]) });
    await expect(checkEmail(ENV, deps(f), signal)).resolves.toEqual({ ok: true, detail: "mail.agathon.app verified" });
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
  });

  it("the domain not verified, or missing: fails", async () => {
    const pending = fakeFetch({ "https://api.resend.com/domains": domains([{ name: "mail.agathon.app", status: "pending" }]) });
    await expect(checkEmail(ENV, deps(pending), signal)).resolves.toEqual({ ok: false, code: "unverified", detail: "mail.agathon.app is pending" });
    const other = fakeFetch({ "https://api.resend.com/domains": domains([{ name: "example.com", status: "verified" }]) });
    await expect(checkEmail(ENV, deps(other), signal)).resolves.toMatchObject({ ok: false, detail: "mail.agathon.app is not in this Resend account" });
  });

  it("a sending-only key (401 restricted_api_key) still proves the key works", async () => {
    const f = fakeFetch({ "https://api.resend.com/domains": () => json(401, { statusCode: 401, name: "restricted_api_key", message: "This API key is restricted to only send emails" }) });
    await expect(checkEmail(ENV, deps(f), signal)).resolves.toMatchObject({ ok: true, detail: expect.stringContaining("sending only") });
  });

  it("an invalid or suspended key fails", async () => {
    const f = fakeFetch({ "https://api.resend.com/domains": () => json(403, { statusCode: 403, name: "suspended_api_key", message: "This API key is suspended" }) });
    await expect(checkEmail(ENV, deps(f), signal)).resolves.toMatchObject({ ok: false, code: "unauthorized", detail: "key rejected (403): This API key is suspended" });
  });

  it("senderDomain", () => {
    expect(senderDomain("Agathon <hello@Mail.Agathon.app>")).toBe("mail.agathon.app");
    expect(senderDomain("hello@example.com")).toBe("example.com");
    expect(senderDomain("nobody")).toBeNull();
  });
});

describe("stripe", () => {
  const rest = (billing: unknown[], failures: unknown[]) =>
    fakeFetch({
      "https://proj.supabase.co/rest/v1/billing_events": () => json(200, billing),
      "https://proj.supabase.co/rest/v1/app_events": () => json(200, failures),
    });

  it("no traffic is not down: reports the last event, or none yet", async () => {
    await expect(checkStripe(ENV, deps(rest([], [])), signal)).resolves.toEqual({ ok: true, detail: "no webhook events yet" });
    const recent = rest([{ type: "checkout.session.completed", received_at: new Date(NOW.getTime() - 3 * 3600_000).toISOString() }], []);
    await expect(checkStripe(ENV, deps(recent), signal)).resolves.toEqual({ ok: true, detail: "last event 3 h ago (checkout.session.completed)" });
  });

  it("a webhook failure in the last 30 minutes fails the check, and the query asks for exactly that", async () => {
    const f = rest([], [{ at: NOW.toISOString(), kind: "route.billing.webhook", code: "upstream", message: "Could not apply the billing update." }]);
    await expect(checkStripe(ENV, deps(f), signal)).resolves.toMatchObject({ ok: false, code: "failures", detail: expect.stringMatching(/^1 webhook failure in the last 30 min \(latest: Could not apply the billing update\.\)/) });
    const q = decodeURIComponent(f.calls.find((c) => c.url.includes("app_events"))!.url);
    expect(q).toContain("level=eq.error");
    expect(q).toContain(`at=gte.${new Date(NOW.getTime() - 30 * 60_000).toISOString()}`);
    expect(q).toContain("or=(kind.like.*webhook*,route.like.*webhook*)");
  });

  it("without STRIPE_WEBHOOK_SECRET: fails without touching the database", async () => {
    const f = rest([], []);
    await expect(checkStripe({ ...ENV, stripeWebhookConfigured: false }, deps(f), signal)).resolves.toMatchObject({ ok: false, code: "unconfigured" });
    expect(f.calls).toHaveLength(0);
  });

  it("a database read failing is marked needsDatabase", async () => {
    const f = fakeFetch({ "https://proj.supabase.co/rest/v1/": () => json(503, { message: "upstream connect error" }) });
    const r = await runCheck("stripe", checkStripe, ENV, deps(f), NOW.toISOString());
    expect(r).toMatchObject({ ok: false, needsDatabase: true });
  });
});

describe("runCheck / runChecks", () => {
  it("a check that never answers fails at its deadline, and its fetch is aborted", async () => {
    let aborted = false;
    const f = fakeFetch({
      "https://whiteboard.example.com/api/health": (_url, init) =>
        new Promise<Response>(() => {
          init.signal?.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    });
    const r = await runCheck("app", checkApp, ENV, deps(f, { timeoutMs: 30 }), NOW.toISOString());
    expect(r).toMatchObject({ service: "app", ok: false, code: "timeout", detail: "no answer in 0 s" });
    expect(aborted).toBe(true);
  });

  it("a network error becomes a failure, never a throw", async () => {
    const r = await runCheck("app", checkApp, ENV, deps(fakeFetch({})), NOW.toISOString());
    expect(r).toMatchObject({ ok: false, code: "network", detail: expect.stringContaining("network error") });
  });

  it("runs every service at once, in SERVICES order, stamped with the run's time", async () => {
    const order: string[] = [];
    const check = (name: string) => async () => {
      order.push(name);
      return { ok: true, detail: name };
    };
    const results = await runChecks(ENV, deps(fakeFetch({})), {
      app: check("app"),
      database: check("database"),
      openrouter: async () => ({ ok: true, detail: "$9.00 credit left", creditsLeftUsd: 9 }),
      mathpix: check("mathpix"),
      email: check("email"),
      stripe: check("stripe"),
    });
    expect(results.map((r) => r.service)).toEqual(["app", "database", "openrouter", "mathpix", "email", "stripe"]);
    expect(results.every((r) => r.at === NOW.toISOString() && r.ok)).toBe(true);
    expect(results[2].creditsLeftUsd).toBe(9);
    // What the route answers is the contract's HealthResult, nothing more.
    expect(Object.keys(toHealthResult({ ...results[2], code: "timeout", needsDatabase: true })).sort()).toEqual(["at", "detail", "latencyMs", "ok", "service"]);
  });
});
