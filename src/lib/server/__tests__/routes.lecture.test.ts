/**
 * POST /api/live/lecture (lecture mode's director), driven through its real handler with fakes for
 * supabase-js (auth, RPCs, and the user's own `usage_events` rows, which `consume_credits` writes
 * and `refund_credits` deletes as the real ones do), OpenRouter (`chatJsonWithFallback`) and the
 * figure drawer's check. The Live contract: 401 before anything, 429 before the charge, zod 400
 * before the charge. Billing is PER MINUTE of a session: the first request in each wall-clock
 * minute is charged 1 credit under `lec:<session>:<minute>` (`charged: true`), the rest of that
 * minute are free; a failed charging request is refunded under the same id, so the next request
 * that minute pays instead; a failed free request refunds nothing; a reply with nothing drawn (or
 * everything dropped) keeps the charge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RpcReply = { data?: unknown; error?: { message: string; code?: string } | null } | Error;

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  calls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
  replies: {} as Record<string, (args?: Record<string, unknown>) => RpcReply>,
  /** the user's usage_events rows (what consume_credits wrote and refund_credits has not deleted) */
  rows: [] as Array<{ user_id: string; request_id: string; units: number }>,
  /** the next usage_events select fails with this */
  selectError: null as string | null,
  /** the figure drawer's check: [] is a clean figure */
  drawer: { check: (() => []) as (spec: unknown) => string[] },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN ? { data: { user: { id: fake.USER_ID, email: "qa@example.com" } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      fake.calls.push({ fn, args });
      const reply = fake.replies[fn]?.(args) ?? { error: { message: `no fake reply for ${fn}` } };
      if (reply instanceof Error) throw reply;
      return { data: reply.data ?? null, error: reply.error ?? null };
    },
    // the one table read the route makes: the user's own charge row for this minute (RLS: owner select)
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (col: string, v: unknown) => {
          filters[col] = v;
          return query;
        },
        limit: async (n: number) => {
          fake.calls.push({ fn: `select ${table}`, args: { ...filters } });
          if (fake.selectError) return { data: null, error: { message: fake.selectError } };
          const rows = fake.rows.filter((r) => Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
          return { data: rows.slice(0, n).map((_, i) => ({ id: i + 1 })), error: null };
        },
      };
      return query;
    },
  }),
}));

vi.mock("@/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/openrouter")>();
  return { ...actual, chatJsonWithFallback: vi.fn() };
});

vi.mock("@/lib/live/figureDraw/check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/live/figureDraw/check")>();
  return { ...actual, checkFigure: (spec: unknown) => fake.drawer.check(spec) };
});

import { resetServerEnvCache } from "@/lib/env";
import { PROBE_FIGURE } from "@/lib/live/chat/figure";
import { LIVE_MODELS } from "@/lib/live/contracts";
import { LECTURE_LIMITS, LectureResponseSchema } from "@/lib/live/lecture/contracts";
import { resetBillingWarnings } from "@/lib/server/billing";
import { LECTURE_ATTEMPT_MS, lectureMinuteId } from "@/lib/server/lectureDirector";
import { chatJsonWithFallback, UpstreamError } from "@/lib/server/openrouter";
import { LECTURE_SYSTEM_PROMPT } from "@/lib/server/prompts/lecture";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { maxDuration, POST as lecture } from "@/app/api/live/lecture/route";

const ENV_VARS = ["BILLING_ENFORCE", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "LIVE_MODEL_LECTURE"];
const savedEnv: Record<string, string | undefined> = {};
const SESSION = "sess_abc12345";
const BODY = {
  boardId: "board-1",
  session: SESSION,
  context: "Last time we looked at supply and demand.",
  fresh: "GDP grew 2.3 percent in 2019, fell 3.4 percent in 2020, then grew 5.9 percent in 2021.",
  screen: { empty: false, topic: "Economic Growth", drawn: ["heading: Economic Growth"], room: 0.7 },
  recent: [],
};
const BAR = { type: "chart", chart: { kind: "bar", title: "GDP growth", labels: ["2019", "2020", "2021"], series: [{ values: [2.3, -3.4, 5.9] }], unit: "%" } };
/** 12:00:10 UTC: a minute has begun (minute boundaries at :00) */
const T0 = Date.UTC(2026, 8, 28, 12, 0, 10);

function request(body: unknown, token: string | null = fake.GOOD_TOKEN): Request {
  return new Request("http://localhost/api/live/lecture", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const callsTo = (fn: string) => fake.calls.filter((c) => c.fn === fn);
const modelReplies = (...replies: unknown[]) => {
  for (const r of replies) vi.mocked(chatJsonWithFallback).mockResolvedValueOnce({ data: r, model: LIVE_MODELS.lecture } as never);
};
const post = async (body: unknown = BODY) => {
  const res = await lecture(request(body));
  return { res, body: res.ok ? LectureResponseSchema.parse(await res.json()) : null };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  for (const name of ENV_VARS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  resetServerEnvCache();
  resetBillingWarnings();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.calls.length = 0;
  fake.rows.length = 0;
  fake.selectError = null;
  for (const key of Object.keys(fake.replies)) delete fake.replies[key];
  fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 11, retry_after_ms: 0, backend: "db" } });
  fake.replies.consume_credits = (args) => {
    fake.rows.push({ user_id: fake.USER_ID, request_id: String(args?.p_request_id), units: Number(args?.p_units) });
    return { data: { ok: true, remaining: 100, reason: null } };
  };
  fake.replies.refund_credits = (args) => {
    const before = fake.rows.length;
    fake.rows.splice(0, fake.rows.length, ...fake.rows.filter((r) => r.request_id !== args?.p_request_id));
    return { data: { refunded: before - fake.rows.length, remaining: 101 } };
  };
  fake.drawer.check = () => [];
  vi.mocked(chatJsonWithFallback).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
});

describe("live/lecture", () => {
  it("401 without a token; 429 from liveLecture before the charge; 400 on a bad body", async () => {
    expect((await lecture(request(BODY, null))).status).toBe(401);
    expect(fake.calls).toEqual([]);
    fake.replies.rate_limit_hit = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 900 } });
    expect((await lecture(request(BODY))).status).toBe(429);
    expect(callsTo("rate_limit_hit")[0].args).toMatchObject({ p_bucket: "liveLecture" });
    fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 11, retry_after_ms: 0, backend: "db" } });
    expect((await lecture(request({ ...BODY, fresh: "   " }))).status).toBe(400);
    expect((await lecture(request({ ...BODY, fresh: "x".repeat(LECTURE_LIMITS.freshChars + 1) }))).status).toBe(400);
    expect((await lecture(request({ ...BODY, screen: undefined }))).status).toBe(400);
    expect((await lecture(request({ ...BODY, session: undefined }))).status).toBe(400);
    expect((await lecture(request({ ...BODY, session: "short" }))).status).toBe(400);
    expect((await lecture(request({ ...BODY, screen: { ...BODY.screen, drawn: Array(LECTURE_LIMITS.drawn + 1).fill("x") } }))).status).toBe(400);
    expect((await lecture(request("{not json"))).status).toBe(400);
    expect(callsTo("consume_credits")).toEqual([]);
    expect(chatJsonWithFallback).not.toHaveBeenCalled();
  });

  it("a chart of the numbers said: the transcript and the screen go to the model, the chart comes back", async () => {
    modelReplies({ actions: [BAR] });
    const { res, body } = await post();
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(body).toMatchObject({ actions: [BAR], notes: [], charged: true, model: LIVE_MODELS.lecture });
    expect(body?.refunded).toBeUndefined();
    const [primary, fallback, opts] = vi.mocked(chatJsonWithFallback).mock.calls[0];
    expect([primary, fallback]).toEqual([LIVE_MODELS.lecture, LIVE_MODELS.lectureFallback]);
    expect(opts).toMatchObject({ attemptTimeoutMs: LECTURE_ATTEMPT_MS, latencyFirst: true });
    expect(opts.messages[0].content).toBe(LECTURE_SYSTEM_PROMPT);
    const user = String(opts.messages[1].content);
    expect(user).toContain(BODY.fresh);
    expect(user).toContain("TOPIC: Economic Growth");
    expect(user).not.toContain("DRAW THAT");
    // the route's own budget covers two attempts
    expect(maxDuration * 1000).toBeGreaterThan(2 * LECTURE_ATTEMPT_MS);
  });

  describe("billed per minute of a session", () => {
    it("the first request of a minute is charged 1 credit under the minute's id; the rest of that minute are free; the next minute is charged again", async () => {
      const minute = lectureMinuteId(SESSION, T0);
      modelReplies({ actions: [BAR] }, { actions: [] }, { actions: [] }, { actions: [] });
      expect((await post()).body?.charged).toBe(true);
      expect(callsTo("consume_credits").map((c) => c.args)).toEqual([{ p_route: "live/lecture", p_units: 2, p_request_id: minute, p_model: LIVE_MODELS.lecture }]);
      // the lookup is the user's own row for this minute
      expect(callsTo("select usage_events")[0].args).toEqual({ user_id: fake.USER_ID, request_id: minute });

      vi.setSystemTime(T0 + 45_000); // 12:00:55, the same minute
      expect((await post()).body?.charged).toBe(false);
      expect(callsTo("consume_credits")).toHaveLength(1);

      vi.setSystemTime(T0 + 55_000); // 12:01:05, the next minute
      expect((await post()).body?.charged).toBe(true);
      expect(callsTo("consume_credits").map((c) => c.args?.p_request_id)).toEqual([minute, lectureMinuteId(SESSION, T0 + 60_000)]);

      // another session in the same minute is its own
      expect((await post({ ...BODY, session: "sess_other999" })).body?.charged).toBe(true);
      expect(callsTo("consume_credits")).toHaveLength(3);
      expect(callsTo("refund_credits")).toEqual([]);
    });

    it("a charging request that fails is refunded under the minute's id, and the next request that minute pays instead", async () => {
      vi.mocked(chatJsonWithFallback).mockRejectedValueOnce(new UpstreamError(502, "Model output failed validation"));
      const failed = await post();
      expect(failed.res.status).toBe(502);
      expect(failed.res.headers.get("X-Request-Id")).toBeTruthy();
      const minute = lectureMinuteId(SESSION, T0);
      expect(callsTo("refund_credits").map((c) => c.args)).toEqual([{ p_request_id: minute }]);
      expect(fake.rows).toEqual([]);

      modelReplies({ actions: [BAR] });
      expect((await post()).body?.charged).toBe(true);
      expect(callsTo("consume_credits")).toHaveLength(2);
      expect(fake.rows.map((r) => r.request_id)).toEqual([minute]);
    });

    it("a free request that fails refunds nothing: the minute another request paid for stays paid", async () => {
      modelReplies({ actions: [] });
      await post();
      vi.mocked(chatJsonWithFallback).mockRejectedValueOnce(new UpstreamError(504, "slow"));
      vi.setSystemTime(T0 + 20_000);
      expect((await post()).res.status).toBe(502);
      expect(callsTo("refund_credits")).toEqual([]);
      expect(fake.rows).toHaveLength(1);
    });

    it("everything proposed dropped, or nothing to draw: the minute's charge is kept (the minute is the product)", async () => {
      fake.drawer.check = () => ["point D is used but not defined"];
      modelReplies({ actions: [{ type: "heading", text: "Economic growth" }, { type: "draw_figure", figure: PROBE_FIGURE }] });
      const { res, body } = await post();
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ actions: [], notes: ["The figure couldn't be drawn."], charged: true });
      expect(body?.refunded).toBeUndefined();
      // one call: no repair round-trip for a figure
      expect(chatJsonWithFallback).toHaveBeenCalledTimes(1);
      expect(callsTo("refund_credits")).toEqual([]);
    });

    it("402 when out of credits, before any model call", async () => {
      fake.replies.consume_credits = () => ({ data: { ok: false, remaining: 0, reason: "insufficient_credits" } });
      const res = await lecture(request(BODY));
      expect(res.status).toBe(402);
      expect(await res.json()).toMatchObject({ error: "credits_exhausted" });
      expect(chatJsonWithFallback).not.toHaveBeenCalled();
    });

    it("a lookup that fails charges: a minute is never given away on an error", async () => {
      fake.rows.push({ user_id: fake.USER_ID, request_id: lectureMinuteId(SESSION, T0), units: 2 });
      fake.selectError = "connection reset";
      modelReplies({ actions: [] });
      expect((await post()).body?.charged).toBe(true);
      expect(callsTo("consume_credits")).toHaveLength(1);
    });

    it("BILLING_ENFORCE=0: nothing looked up, nothing charged", async () => {
      process.env.BILLING_ENFORCE = "0";
      resetServerEnvCache();
      modelReplies({ actions: [BAR] });
      const { body } = await post();
      expect(body).toMatchObject({ actions: [BAR], charged: false });
      expect(callsTo("select usage_events")).toEqual([]);
      expect(callsTo("consume_credits")).toEqual([]);
    });
  });

  it("live: the screen's live visuals go to the model; an update of one comes back", async () => {
    const SALES = { kind: "bar", title: "Sales", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ values: [12, null, null, null] }], unit: "million" };
    const grown = { ...SALES, series: [{ values: [12, 15, null, null] }] };
    modelReplies({ actions: [{ type: "update_chart", target: "blk-1", chart: grown }] });
    const { body } = await post({ ...BODY, fresh: "Q2 came in at 15 million.", screen: { ...BODY.screen, drawn: ["bar chart: Sales"], active: [{ id: "blk-1", chart: SALES }] } });
    expect(body?.actions).toEqual([{ type: "update_chart", target: "blk-1", chart: grown }]);
    expect(String(vi.mocked(chatJsonWithFallback).mock.calls[0][2].messages[1].content)).toContain(`- "blk-1": ${JSON.stringify(SALES)}`);
    // at most two live visuals in a request
    const three = Array.from({ length: LECTURE_LIMITS.active + 1 }, (_, i) => ({ id: `blk-${i}`, chart: SALES }));
    expect((await lecture(request({ ...BODY, screen: { ...BODY.screen, active: three } }))).status).toBe(400);
  });

  it("LIVE_MODEL_LECTURE overrides the primary", async () => {
    process.env.LIVE_MODEL_LECTURE = "google/gemini-3.5-flash";
    resetServerEnvCache();
    modelReplies({ actions: [] });
    await lecture(request(BODY));
    expect(vi.mocked(chatJsonWithFallback).mock.calls[0].slice(0, 2)).toEqual(["google/gemini-3.5-flash", LIVE_MODELS.lectureFallback]);
  });

  it('"Draw that" is said to the model', async () => {
    modelReplies({ actions: [{ type: "note", text: "GDP fell in 2020 and recovered in 2021" }] });
    const { body } = await post({ ...BODY, force: true });
    expect(body?.actions).toHaveLength(1);
    expect(String(vi.mocked(chatJsonWithFallback).mock.calls[0][2].messages[1].content)).toContain('DRAW THAT: the student tapped "Draw that"');
  });

  it(`invalid actions are dropped, not guessed at; the valid ones stay; at most ${LECTURE_LIMITS.actions}`, async () => {
    modelReplies({ actions: [{ type: "paint", what: "a graph" }, { type: "note", text: "Costs $5" }, BAR] });
    const { body } = await post();
    expect(body?.actions).toEqual([BAR]);
    expect(body?.notes).toEqual(["Part of the sketch couldn't be drawn, so it was left out."]);
    const hub = { type: "diagram", diagram: { kind: "hub", center: "Growth", spokes: ["Capital", "Labour"] } };
    const flow = { type: "diagram", diagram: { kind: "flow", steps: ["Save", "Invest", "Grow"] } };
    const cycle = { type: "diagram", diagram: { kind: "cycle", steps: ["Boom", "Bust", "Recovery"] } };
    modelReplies({ actions: [{ type: "heading", text: "GDP" }, BAR, hub, flow, cycle] });
    expect((await post()).body?.actions.map((a) => a.type)).toEqual(["heading", "chart", "diagram", "diagram"]);
    // a slide: its title, two bullets beside its chart
    const bullets = [{ type: "note", text: "GDP fell in 2020" }, { type: "note", text: "The recovery was fast" }];
    modelReplies({ actions: [{ type: "heading", text: "GDP" }, ...bullets, BAR] });
    expect((await post()).body?.actions.map((a) => a.type)).toEqual(["heading", "note", "note", "chart"]);
  });
});
