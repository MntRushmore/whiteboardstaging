/**
 * The alert rules as pure decisions (down, error spike, low credit: transitions, throttling,
 * recovery, thresholds), then `evaluateAlerts` end to end over a fake PostgREST and a fake Resend:
 * what is sent, what is saved, what happens when a send or the state read fails.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

import { ALERT_RULES } from "@/lib/admin/contracts";
import type { SendEmailInput, SendEmailResult } from "@/lib/email/resend";
import { logger } from "@/lib/logger";
import {
  ALERT_KEYS,
  decideAll,
  decideDown,
  decideLowCredits,
  decideSpike,
  evaluateAlerts,
  idleState,
  isSpike,
  notifiedSince,
  summarizeErrors,
  throttleOpen,
  timeBucket,
  type AlertDeps,
  type AlertState,
  type SpikeSummary,
} from "@/lib/server/health/alerts";
import type { CheckResult } from "@/lib/server/health/checks";
import type { ErrorEventRow } from "@/lib/server/health/store";

const T0 = new Date("2026-10-05T14:00:00.000Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const iso = (min: number) => at(min).toISOString();

const KEY = ALERT_KEYS.down("mathpix");
const fail = { ok: false, detail: "keys rejected (401)" };
const pass = { ok: true, detail: "key works" };

/** Runs `decideDown` over a sequence of checks 5 minutes apart, starting at T0. */
function runDown(checks: Array<{ ok: boolean; detail: string; held?: boolean }>, start: AlertState = idleState(KEY)) {
  let state = start;
  return checks.map((check, i) => {
    const d = decideDown("mathpix", state, check, at(i * 5));
    state = d.next;
    return d;
  });
}

describe("decideDown", () => {
  it("one failure counts but does not alert; the second in a row fires 'is down'", () => {
    const [first, second] = runDown([fail, fail]);
    expect(first.email).toBeNull();
    expect(first.next).toMatchObject({ status: "ok", failures: 1, since: iso(0), lastSentAt: null });
    expect(second.next).toMatchObject({ status: "firing", failures: 2, since: iso(0), lastSentAt: iso(5) });
    expect(second.email).toMatchObject({ firing: true, input: { type: "down", service: "mathpix", detail: "keys rejected (401)", since: iso(0), repeat: false } });
    expect(second.email?.idempotencyKey).toBe(`alert/${KEY}/down/${timeBucket(at(5), ALERT_RULES)}`);
  });

  it("a single blip resets: fail, pass, fail never alerts", () => {
    const ds = runDown([fail, pass, fail]);
    expect(ds.every((d) => d.email === null)).toBe(true);
    expect(ds[1].next).toMatchObject({ status: "ok", failures: 0, since: iso(5) });
    expect(ds[2].next).toMatchObject({ status: "ok", failures: 1, since: iso(10) });
  });

  it("while down: silent until repeatAfterMin, then 'still down' once per hour", () => {
    // fail at 0, 5 (fires at 5), then every 5 minutes until 130.
    const ds = runDown(Array.from({ length: 27 }, () => fail));
    const sent = ds.map((d, i) => (d.email ? { min: i * 5, repeat: (d.email.input as { repeat: boolean }).repeat } : null)).filter(Boolean);
    expect(sent).toEqual([
      { min: 5, repeat: false },
      { min: 65, repeat: true },
      { min: 125, repeat: true },
    ]);
    expect(ds[13].email?.idempotencyKey).toMatch(new RegExp(`^alert/${KEY}/still/`));
  });

  it("recovery sends 'back up' with when it went down, and resets the streak", () => {
    const ds = runDown([fail, fail, fail, pass]);
    const up = ds[3];
    expect(up.email).toMatchObject({ firing: false, input: { type: "up", service: "mathpix", downSince: iso(0) } });
    expect(up.email?.idempotencyKey).toBe(`alert/${KEY}/up/${at(0).getTime()}`);
    expect(up.next).toMatchObject({ status: "ok", failures: 0, since: iso(15), lastSentAt: iso(5) });
  });

  it("a relapse within repeatAfterMin of the last email waits for the throttle, then says 'is down' (not 'still')", () => {
    // Down at 0/5 (email at 5), up at 10 (email), down again at 15/20: throttled until 65.
    const ds = runDown([fail, fail, pass, fail, fail, fail]);
    expect(ds[4].next.status).toBe("firing");
    expect(ds[4].email).toBeNull();
    let state = ds[5].next;
    const later = decideDown("mathpix", state, fail, at(65));
    expect(later.email).toMatchObject({ input: { type: "down", repeat: false, since: iso(15) } });
    state = later.next;
    expect(state.lastSentAt).toBe(iso(65));
  });

  it("no 'back up' for an episode the owner never heard about (throttled the whole time)", () => {
    const prev: AlertState = { key: KEY, status: "firing", since: iso(15), lastSentAt: iso(5), failures: 3 };
    const d = decideDown("mathpix", prev, pass, at(30));
    expect(d.email).toBeNull();
    expect(d.next).toMatchObject({ status: "ok", failures: 0, since: iso(30), lastSentAt: iso(5) });
  });

  it("a held failure (the database is down) neither counts nor recovers", () => {
    const prev: AlertState = { key: KEY, status: "ok", since: iso(0), lastSentAt: null, failures: 1 };
    const d = decideDown("mathpix", prev, { ...fail, held: true }, at(5));
    expect(d.next).toBe(prev);
    expect(d.email).toBeNull();
  });

  it("a steady passing service changes nothing (no write)", () => {
    const d = decideDown("mathpix", idleState(KEY), pass, at(0));
    expect(d.next).toBe(d.prev);
  });

  it("downAfterFailures comes from the rules", () => {
    const rules = { ...ALERT_RULES, downAfterFailures: 3 };
    let s = idleState(KEY);
    const emails = [0, 5, 10].map((m) => {
      const d = decideDown("mathpix", s, fail, at(m), rules);
      s = d.next;
      return d.email;
    });
    expect(emails.map(Boolean)).toEqual([false, false, true]);
  });
});

describe("throttle helpers", () => {
  it("throttleOpen: never sent, or at least repeatAfterMin ago", () => {
    expect(throttleOpen(null, at(0), ALERT_RULES)).toBe(true);
    expect(throttleOpen(iso(0), at(59), ALERT_RULES)).toBe(false);
    expect(throttleOpen(iso(0), at(60), ALERT_RULES)).toBe(true);
  });

  it("notifiedSince: a send at or after the episode start", () => {
    expect(notifiedSince(null, iso(0))).toBe(false);
    expect(notifiedSince(iso(5), iso(0))).toBe(true);
    expect(notifiedSince(iso(0), iso(0))).toBe(true);
    expect(notifiedSince(iso(0), iso(5))).toBe(false);
  });
});

function rows(spec: Array<[kind: string, message: string, user: string | null, n?: number]>): ErrorEventRow[] {
  return spec.flatMap(([kind, message, user, n = 1]) => Array.from({ length: n }, () => ({ kind, code: null, message, user_id: user, source: "live" })));
}

describe("summarizeErrors and isSpike", () => {
  it("counts events, distinct users, and groups by kind + code + message, most frequent first", () => {
    const s = summarizeErrors([
      ...rows([
        ["live.recognize", "Mathpix timed out", "u1", 4],
        ["live.solve", "upstream 502", "u2", 2],
        ["client.error", "boom", null, 1],
      ]),
      { kind: "live.recognize", code: "timeout", message: "Mathpix timed out", user_id: "u3", source: "live" },
    ]);
    expect(s.errors).toBe(8);
    expect(s.users).toBe(3);
    expect(s.groups.map((g) => [g.kind, g.code, g.count])).toEqual([
      ["live.recognize", null, 4],
      ["live.solve", null, 2],
      ["client.error", null, 1],
      ["live.recognize", "timeout", 1],
    ]);
    expect(s.capped).toBe(false);
  });

  it("thresholds: at least minErrors AND at least minUsers", () => {
    const { minErrors, minUsers } = ALERT_RULES.errorSpike;
    const users = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);
    const spread = (errors: number, people: number) => summarizeErrors(Array.from({ length: errors }, (_, i) => ({ kind: "live.check", code: null, message: "x", user_id: users(people)[i % people], source: "live" })));
    expect(isSpike(spread(minErrors, minUsers))).toBe(true);
    expect(isSpike(spread(minErrors - 1, minUsers))).toBe(false);
    expect(isSpike(spread(minErrors * 5, minUsers - 1))).toBe(false); // one student's crash loop is not a spike
    expect(isSpike(spread(minErrors + 20, minUsers + 2))).toBe(true);
  });

  it("marks a read that hit the limit as capped", () => {
    expect(summarizeErrors(rows([["k", "m", "u", 5]]), 5).capped).toBe(true);
  });
});

function spike(errors: number, users: number): SpikeSummary {
  return { errors, users, groups: [{ kind: "live.recognize", code: null, message: "Mathpix timed out", count: errors }], capped: false };
}

describe("decideSpike", () => {
  const S = ALERT_KEYS.spike;

  it("fires on the first run over the thresholds with the top groups", () => {
    const d = decideSpike(idleState(S), spike(12, 4), at(0));
    expect(d.next).toMatchObject({ status: "firing", since: iso(0), lastSentAt: iso(0), failures: 1 });
    expect(d.email).toMatchObject({ firing: true, input: { type: "spike", errors: 12, users: 4, windowMin: 15, repeat: false } });
    expect(d.email?.idempotencyKey).toBe(`alert/${S}/spike/${timeBucket(at(0), ALERT_RULES)}`);
  });

  it("under the thresholds: nothing", () => {
    expect(decideSpike(idleState(S), spike(9, 4), at(0)).email).toBeNull();
    expect(decideSpike(idleState(S), spike(50, 2), at(0)).email).toBeNull();
  });

  it("while it lasts: repeats after repeatAfterMin; when it ends: 'back to normal'", () => {
    let s = idleState(S);
    const emails: string[] = [];
    for (let m = 0; m <= 70; m += 5) {
      const d = decideSpike(s, spike(20, 5), at(m));
      if (d.email) emails.push(`${m}:${(d.email.input as { repeat: boolean }).repeat ? "still" : "spike"}`);
      s = d.next;
    }
    expect(emails).toEqual(["0:spike", "60:still"]);
    const over = decideSpike(s, spike(3, 1), at(75));
    expect(over.email).toMatchObject({ firing: false, input: { type: "spike_over", since: iso(0) } });
    expect(over.next).toMatchObject({ status: "ok", since: iso(75), failures: 0, lastSentAt: iso(60) });
  });

  it("events that could not be read change nothing", () => {
    const prev: AlertState = { key: S, status: "firing", since: iso(0), lastSentAt: iso(0), failures: 2 };
    expect(decideSpike(prev, null, at(5)).next).toBe(prev);
  });
});

describe("decideLowCredits", () => {
  const C = ALERT_KEYS.lowCredits;

  it("below the threshold: one email, then silence for the rest of the episode", () => {
    const first = decideLowCredits(idleState(C), 4.2, at(0));
    expect(first.email).toMatchObject({ firing: true, input: { type: "low_credits", creditsLeftUsd: 4.2, thresholdUsd: ALERT_RULES.lowCreditsUsd } });
    expect(first.email?.idempotencyKey).toBe(`alert/${C}/low/${at(0).getTime()}`);
    const hourLater = decideLowCredits(first.next, 3.9, at(65));
    expect(hourLater.email).toBeNull();
    expect(hourLater.next.status).toBe("firing");
  });

  it("re-arms silently once credit is back at or above the threshold, and alerts again on the next drop", () => {
    const low = decideLowCredits(idleState(C), 4, at(0)).next;
    const topped = decideLowCredits(low, 25, at(70));
    expect(topped.email).toBeNull();
    expect(topped.next).toMatchObject({ status: "ok", since: iso(70) });
    const again = decideLowCredits(topped.next, 4.5, at(200));
    expect(again.email?.input).toMatchObject({ type: "low_credits", creditsLeftUsd: 4.5 });
  });

  it("exactly the threshold is not low", () => {
    expect(decideLowCredits(idleState(C), ALERT_RULES.lowCreditsUsd, at(0)).email).toBeNull();
  });

  it("unknown credit (null / undefined) changes nothing", () => {
    const prev: AlertState = { key: C, status: "firing", since: iso(0), lastSentAt: iso(0), failures: 0 };
    expect(decideLowCredits(prev, null, at(5)).next).toBe(prev);
    expect(decideLowCredits(prev, undefined, at(5)).next).toBe(prev);
  });

  it("an email that never went out is retried within the episode", () => {
    const prev: AlertState = { key: C, status: "firing", since: iso(0), lastSentAt: null, failures: 0 };
    expect(decideLowCredits(prev, 4, at(5)).email).not.toBeNull();
  });
});

function result(service: CheckResult["service"], ok: boolean, extra: Partial<CheckResult> = {}): CheckResult {
  return { service, ok, latencyMs: 10, at: iso(0), detail: ok ? "fine" : `${service} broke`, ...extra };
}

const ALL_OK = (["app", "database", "openrouter", "mathpix", "email", "stripe"] as const).map((s) => result(s, true));

describe("decideAll", () => {
  it("holds the app and Stripe failures that may only be the database, never the database itself", () => {
    const states = new Map<string, AlertState>();
    for (const s of ["app", "database", "stripe"] as const) states.set(ALERT_KEYS.down(s), { key: ALERT_KEYS.down(s), status: "ok", since: iso(-5), lastSentAt: null, failures: 1 });
    const results = ALL_OK.map((r) =>
      r.service === "database" ? result("database", false) : r.service === "app" || r.service === "stripe" ? result(r.service, false, { needsDatabase: true }) : r,
    );
    const ds = decideAll(results, spike(0, 0), states, at(0));
    const byKey = new Map(ds.map((d) => [d.prev.key, d]));
    expect(byKey.get(ALERT_KEYS.down("database"))?.email?.input).toMatchObject({ type: "down", service: "database" });
    expect(byKey.get(ALERT_KEYS.down("app"))?.email).toBeNull();
    expect(byKey.get(ALERT_KEYS.down("app"))?.next.failures).toBe(1);
    expect(byKey.get(ALERT_KEYS.down("stripe"))?.next.failures).toBe(1);
  });

  it("a needsDatabase failure counts normally when the database is up", () => {
    const states = new Map([[ALERT_KEYS.down("app"), { key: ALERT_KEYS.down("app"), status: "ok" as const, since: iso(-5), lastSentAt: null, failures: 1 }]]);
    const results = ALL_OK.map((r) => (r.service === "app" ? result("app", false, { needsDatabase: true }) : r));
    const app = decideAll(results, spike(0, 0), states, at(0)).find((d) => d.prev.key === ALERT_KEYS.down("app"));
    expect(app?.email?.input).toMatchObject({ type: "down", service: "app" });
  });

  it("feeds OpenRouter's credit to the low-credit rule", () => {
    const results = ALL_OK.map((r) => (r.service === "openrouter" ? result("openrouter", true, { creditsLeftUsd: 2 }) : r));
    const credits = decideAll(results, null, new Map(), at(0)).find((d) => d.prev.key === ALERT_KEYS.lowCredits);
    expect(credits?.email?.input).toMatchObject({ type: "low_credits", creditsLeftUsd: 2 });
  });
});

// ------------------------------------------------------------------ evaluateAlerts (effects)

type Call = { method: string; url: string; body: unknown };

/** A PostgREST double: alert_state rows, app_events rows, and every write recorded. */
function fakeRest(opts: { states?: Array<Record<string, unknown>> | "error"; events?: ErrorEventRow[] | "error"; saveFails?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const reply = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.includes("/rest/v1/alert_state") && method === "GET") return opts.states === "error" ? reply(503, { message: "upstream connect error" }) : reply(200, opts.states ?? []);
    if (url.includes("/rest/v1/alert_state") && method === "POST") return opts.saveFails ? reply(500, { message: "nope" }) : reply(201, null);
    if (url.includes("/rest/v1/app_events")) return opts.events === "error" ? reply(404, { code: "PGRST205", message: "no table" }) : reply(200, opts.events ?? []);
    return reply(404, { message: `no fake for ${url}` });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

function deps(rest: ReturnType<typeof fakeRest>, overrides: Partial<AlertDeps> = {}, sendResult: SendEmailResult = { ok: true, id: "em_1" }) {
  const sent: SendEmailInput[] = [];
  const send = vi.fn(async (m: SendEmailInput) => {
    sent.push(m);
    return sendResult;
  });
  const d: AlertDeps = {
    rest: { url: "https://proj.supabase.co", serviceKey: "svc", fetch: rest.fetchImpl },
    send,
    resend: { apiKey: "re_test", from: "Agathon <hello@mail.agathon.app>" },
    alertEmail: "owner@example.com",
    siteUrl: "https://whiteboard.example.com",
    now: at(5),
    log: logger.child({ test: "alerts" }),
    ...overrides,
  };
  return { d, sent, send };
}

const saved = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.url.includes("alert_state")).flatMap((c) => c.body as Array<Record<string, unknown>>);

describe("evaluateAlerts", () => {
  const mathpixDown = ALL_OK.map((r) => (r.service === "mathpix" ? result("mathpix", false, { detail: "keys rejected (401)" }) : r));
  const oneFailure = [{ key: KEY, status: "ok", since: iso(0), last_sent_at: null, failures: 1 }];

  it("second failure in a row: emails ALERT_EMAIL and saves the firing state", async () => {
    const rest = fakeRest({ states: oneFailure });
    const { d, sent } = deps(rest);
    const summary = await evaluateAlerts(d, mathpixDown);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "owner@example.com", subject: "Mathpix is down: keys rejected (401)" });
    expect(sent[0].idempotencyKey).toBe(`alert/${KEY}/down/${timeBucket(at(5), ALERT_RULES)}`);
    expect(sent[0].text).toContain("https://whiteboard.example.com/admin");
    expect(summary).toMatchObject({ stateless: false, sent: [KEY], firing: [KEY] });
    expect(saved(rest.calls)).toEqual([{ key: KEY, status: "firing", since: iso(0), last_sent_at: iso(5), failures: 2 }]);
  });

  it("everything up and nothing stored: no email, no write", async () => {
    const rest = fakeRest();
    const { d, sent } = deps(rest);
    const summary = await evaluateAlerts(d, ALL_OK);
    expect(sent).toHaveLength(0);
    expect(saved(rest.calls)).toEqual([]);
    expect(summary.firing).toEqual([]);
  });

  it("a send that fails leaves lastSentAt unset, so the next run retries", async () => {
    const rest = fakeRest({ states: oneFailure });
    const { d } = deps(rest, {}, { ok: false, error: "application_error: boom", status: 500 });
    const summary = await evaluateAlerts(d, mathpixDown);
    expect(summary.failed).toEqual([KEY]);
    expect(saved(rest.calls)).toEqual([{ key: KEY, status: "firing", since: iso(0), last_sent_at: null, failures: 2 }]);
  });

  it("Resend's 409 (this key already went out) counts as sent", async () => {
    const rest = fakeRest({ states: oneFailure });
    const { d } = deps(rest, {}, { ok: false, error: "invalid_idempotent_request: used", status: 409 });
    const summary = await evaluateAlerts(d, mathpixDown);
    expect(summary.sent).toEqual([KEY]);
    expect(saved(rest.calls)[0].last_sent_at).toBe(iso(5));
  });

  it("without ALERT_EMAIL (or without Resend): logs and skips, and keeps retrying", async () => {
    for (const overrides of [{ alertEmail: null }, { resend: { apiKey: null } }] as Partial<AlertDeps>[]) {
      const rest = fakeRest({ states: oneFailure });
      const { d, send } = deps(rest, overrides);
      const summary = await evaluateAlerts(d, mathpixDown);
      expect(send).not.toHaveBeenCalled();
      expect(summary.skipped).toEqual([KEY]);
      expect(saved(rest.calls)[0]).toMatchObject({ status: "firing", last_sent_at: null });
    }
  });

  it("an error spike from app_events: the top 3 groups and a link to /admin", async () => {
    const events = rows([
      ["live.recognize", "Mathpix timed out", "u1", 5],
      ["live.solve", "upstream 502", "u2", 3],
      ["client.boundary", "Cannot read properties of undefined", "u3", 2],
      ["live.chat", "rate limited", "u4", 1],
    ]);
    const rest = fakeRest({ events });
    const { d, sent } = deps(rest);
    await evaluateAlerts(d, ALL_OK);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Errors spiking: 11 in 15 min from 4 people");
    expect(sent[0].text).toContain("5× live.recognize: Mathpix timed out");
    expect(sent[0].text).toContain("2× client.boundary: Cannot read properties of undefined");
    expect(sent[0].text).not.toContain("live.chat");
    const query = decodeURIComponent(rest.calls.find((c) => c.url.includes("app_events"))!.url);
    expect(query).toContain("level=eq.error");
    expect(query).toContain("source=in.(live,client,server)");
    expect(query).toContain(`at=gte.${new Date(at(5).getTime() - 15 * 60_000).toISOString()}`);
  });

  it("app_events unreadable: the spike is not judged, the down rules still are", async () => {
    const rest = fakeRest({ states: oneFailure, events: "error" });
    const { d, sent } = deps(rest);
    await evaluateAlerts(d, mathpixDown);
    expect(sent.map((m) => m.subject)).toEqual(["Mathpix is down: keys rejected (401)"]);
  });

  it("alert_state unreadable and the database down: one stateless 'database is down' per hour bucket", async () => {
    const rest = fakeRest({ states: "error" });
    const { d, sent } = deps(rest);
    const results = ALL_OK.map((r) => (r.service === "database" ? result("database", false, { detail: "profiles: 503 upstream connect error" }) : r));
    const summary = await evaluateAlerts(d, results);
    expect(summary.stateless).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("The database is down: profiles: 503 upstream connect error");
    expect(sent[0].idempotencyKey).toBe(`alert/${ALERT_KEYS.down("database")}/stateless/${timeBucket(at(5), ALERT_RULES)}`);
    expect(saved(rest.calls)).toEqual([]);
  });

  it("alert_state unreadable but the database up: nothing is sent (logged)", async () => {
    const rest = fakeRest({ states: "error" });
    const { d, send } = deps(rest);
    const summary = await evaluateAlerts(d, mathpixDown);
    expect(summary.stateless).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("a failed save is logged, never thrown", async () => {
    const rest = fakeRest({ states: oneFailure, saveFails: true });
    const { d } = deps(rest);
    await expect(evaluateAlerts(d, mathpixDown)).resolves.toMatchObject({ sent: [KEY] });
  });
});
