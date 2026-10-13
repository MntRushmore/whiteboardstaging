/**
 * POST /api/try/check and POST /api/try/help through their real handlers: the kill switch, the
 * same-origin check, the capped body, the schema and the problem id, the per-visitor limits, the
 * day's cap on reads (counted by `global_budget_spend` with the service role, failing open), the
 * Mathpix read and its failures, the engine's verdict and next step, and the one log line per read
 * (never strokes, never an IP). Mathpix and app events are a stubbed fetch; the service role's RPC
 * client is a stub; the engine and the hand are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const cap = vi.hoisted(() => ({ client: null as null | { rpc: Rpc } }));
vi.mock("@/lib/server/billing", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/billing")>();
  return { ...real, serviceClient: () => cap.client };
});

import { POST as check } from "@/app/api/try/check/route";
import { POST as help } from "@/app/api/try/help/route";
import { resetServerEnvCache } from "@/lib/env";
import { MATHPIX_STROKES_URL } from "@/lib/server/mathpix";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { DAY_MS, resetDailyCapWarning, TRY_CAP_TIMEOUT_MS } from "@/lib/server/try/dailyCap";
import { tryLogger } from "@/lib/server/try/http";
import { TRY_LIMITS, TryCheckResponseSchema, TryErrorSchema, TryHelpResponseSchema } from "@/lib/try/contracts";

const ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  OPENROUTER_API_KEY: "sk-or-test",
  MATHPIX_APP_ID: "mp-app",
  MATHPIX_APP_KEY: "mp-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

const IP = "203.0.113.9";
const STROKES = { x: [[10, 20, 30], [40, 50]], y: [[10, 40, 10], [20, 20]] };
const CHECK = { problemId: "k2-0", work: [], strokes: STROKES, bounds: { w: 120, h: 60 } };

function post(url: string, body: unknown, headers: Record<string, string | undefined> = {}): Request {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries({ "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", "cf-connecting-ip": IP, ...headers })) if (v !== undefined) h[k] = v;
  return new Request(url, { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body) });
}
const checkReq = (body: unknown = CHECK, headers?: Record<string, string | undefined>) => post("http://localhost:3000/api/try/check", body, headers);
const helpReq = (body: unknown, headers?: Record<string, string | undefined>) => post("http://localhost:3000/api/try/help", body, headers);

/** Mathpix's answer for the next reads (a body, or a status with a body, or a thrown error). */
let mathpix: { status?: number; body?: unknown; throws?: boolean };
let fetchMock: ReturnType<typeof vi.fn>;
let rpc: ReturnType<typeof vi.fn>;
/** the day's counter as the RPC keeps it */
let used: number;
let logs: Array<{ level: string; obj: Record<string, unknown>; msg: string; bindings: Record<string, unknown> }>;

const mathpixCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === MATHPIX_STROKES_URL);

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  resetServerEnvCache();
  resetRateLimits();
  resetDailyCapWarning();
  mathpix = { body: { latex_styled: "7", text: "\\( 7 \\)", confidence: 0.98, is_handwritten: true } };
  fetchMock = vi.fn(async (url: unknown) => {
    if (String(url) === MATHPIX_STROKES_URL) {
      if (mathpix.throws) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(mathpix.body ?? {}), { status: mathpix.status ?? 200, headers: { "Content-Type": "application/json" } });
    }
    // app events (a Mathpix failure is one): accepted, nothing to read back
    return new Response(null, { status: 201 });
  });
  vi.stubGlobal("fetch", fetchMock);
  used = 0;
  rpc = vi.fn(async (_fn: string, args?: Record<string, unknown>) => {
    used += Number(args?.p_amount ?? 0);
    const limit = Number(args?.p_limit);
    const allowed = used <= limit;
    return { data: { allowed, remaining: Math.max(0, limit - used), retry_after_ms: allowed ? 0 : 3_600_000, backend: "db" }, error: null };
  });
  cap.client = { rpc: rpc as unknown as Rpc };
  logs = [];
  const fake = (bindings: Record<string, unknown>): unknown => {
    const line = (level: string) => (obj: Record<string, unknown>, msg: string) => logs.push({ level, obj, msg, bindings });
    return { info: line("info"), warn: line("warn"), error: line("error"), debug: line("debug"), child: (b: Record<string, unknown>) => fake({ ...bindings, ...b }), bindings: () => bindings };
  };
  vi.spyOn(tryLogger, "child").mockImplementation(((b: Record<string, unknown>) => fake({ module: "try", ...b })) as unknown as typeof tryLogger.child);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetServerEnvCache();
});

async function expectError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(TryErrorSchema.safeParse(body).success).toBe(true);
  expect(body.error).toBe(error);
  return body as { error: string; retryAfterMs?: number };
}

describe("POST /api/try/check", () => {
  it("reads the line once with Mathpix, counts it for the day, and answers the engine's verdict", async () => {
    const res = await check(checkReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const body = await res.json();
    expect(TryCheckResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({ latex: "7", verdict: "solved", note: null });

    expect(mathpixCalls()).toHaveLength(1);
    const [, init] = mathpixCalls()[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body));
    expect(sent.strokes.strokes).toEqual(STROKES);
    expect(sent.metadata).toEqual({ improve_mathpix: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("global_budget_spend", { p_bucket: "tryReads", p_amount: 1, p_limit: TRY_LIMITS.perDay, p_window_ms: DAY_MS });
  }, 30_000);

  it("rings a slip and ticks a step under the visitor's work", async () => {
    mathpix = { body: { latex_styled: "3 + 4 = 8", confidence: 0.97 } };
    expect(await (await check(checkReq())).json()).toEqual({ latex: "3 + 4 = 8", verdict: "ring", note: "Re-check the arithmetic here" });
    mathpix = { body: { latex_styled: "x = 6", confidence: 0.97 } };
    expect(await (await check(checkReq({ ...CHECK, problemId: "g68-3", work: ["2x = 12"] }))).json()).toEqual({ latex: "x = 6", verdict: "solved", note: null });
    mathpix = { body: { latex_styled: "2x = 12", confidence: 0.97 } };
    expect((await (await check(checkReq({ ...CHECK, problemId: "g68-3" }))).json()).verdict).toBe("check");
    mathpix = { body: { latex_styled: "2x =", confidence: 0.97 } };
    expect((await (await check(checkReq({ ...CHECK, problemId: "g68-3" }))).json()).verdict).toBe("unjudged");
  }, 30_000);

  it("answers unread for a read Mathpix was not sure of, an empty read, and ink Mathpix could not read", async () => {
    mathpix = { body: { latex_styled: "7", confidence: 0.2 } };
    expect(await (await check(checkReq())).json()).toEqual({ latex: "7", verdict: "unread", note: null });
    mathpix = { body: { latex_styled: "", text: "", confidence: 0 } };
    expect(await (await check(checkReq())).json()).toEqual({ latex: "", verdict: "unread", note: null });
    mathpix = { body: { error: "Image has no content", error_info: { id: "image_no_content" } } };
    const res = await check(checkReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ latex: "", verdict: "unread", note: null });
  }, 30_000);

  it("logs one line per read: the verdict, band and times, never strokes or an IP", async () => {
    await check(checkReq());
    const reads = logs.filter((l) => l.msg === "try read");
    expect(reads).toHaveLength(1);
    expect(reads[0].level).toBe("info");
    expect(reads[0].obj).toMatchObject({ verdict: "solved", band: "k2", problem: "k2-0", strokes: 2, dailyCap: "db" });
    expect(reads[0].obj.ms).toEqual(expect.any(Number));
    expect(reads[0].bindings).toMatchObject({ module: "try", route: "check" });
    const all = JSON.stringify(logs);
    expect(all).not.toContain(IP);
    expect(all).not.toContain("[10,20,30]");
  }, 30_000);

  it("is a 503 upstream_error when the reader fails (never a 502: Cloudflare would swap it), with no vision fallback", async () => {
    for (const failure of [{ status: 401, body: { error: "Invalid credentials" } }, { status: 500, body: {} }, { throws: true }]) {
      mathpix = failure;
      await expectError(await check(checkReq()), 503, "upstream_error");
    }
    // only Mathpix and app events were called: no model
    for (const [url] of fetchMock.mock.calls) expect([MATHPIX_STROKES_URL, "https://proj.supabase.co/rest/v1/app_events"]).toContain(String(url));
  }, 30_000);

  it("is a 503 unavailable without Mathpix, before anything is counted", async () => {
    vi.stubEnv("MATHPIX_APP_KEY", "");
    resetServerEnvCache();
    await expectError(await check(checkReq()), 503, "unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is a 503 unavailable with TRY_ENABLED=0, before anything else", async () => {
    vi.stubEnv("TRY_ENABLED", "0");
    resetServerEnvCache();
    await expectError(await check(checkReq("not json", { "Sec-Fetch-Site": "cross-site" })), 503, "unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a request that is not from our page with a 403, before reading the body", async () => {
    for (const headers of [{ "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }, { "Sec-Fetch-Site": undefined }, { "Sec-Fetch-Site": undefined, Origin: "https://evil.example" }]) {
      await expectError(await check(checkReq(CHECK, headers)), 403, "invalid_request");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    // an older browser without Sec-Fetch-Site, on our page
    expect((await check(checkReq(CHECK, { "Sec-Fetch-Site": undefined, Origin: "https://www.agathon.app" }))).status).toBe(200);
  }, 30_000);

  it("is a 400 invalid_request for a body that is not the schema or a problem we do not have, and 413 past 1 MB", async () => {
    const bad = [
      "not json",
      {},
      { ...CHECK, problemId: "k2-99" },
      { ...CHECK, problemId: "" },
      { ...CHECK, strokes: { x: [[1, 2]], y: [[1]] } },
      { ...CHECK, strokes: { x: [], y: [] } },
      { ...CHECK, work: ["a", "b", "c", "d", "e", "f"] },
      { ...CHECK, bounds: { w: 0, h: 10 } },
    ];
    for (const body of bad) await expectError(await check(checkReq(body)), 400, "invalid_request");
    await expectError(await check(checkReq("x".repeat(1_000_001))), 413, "invalid_request");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gives a visitor TRY_LIMITS.read reads, by cf-connecting-ip first, then 429 with retryAfterMs", async () => {
    for (let i = 0; i < TRY_LIMITS.read.limit; i++) expect((await check(checkReq(CHECK, { "x-forwarded-for": `172.70.0.${i % 3}` }))).status, `read ${i + 1}`).toBe(200);
    const limited = await check(checkReq(CHECK, { "x-forwarded-for": "172.70.0.9" }));
    const body = await expectError(limited, 429, "rate_limited");
    expect(body.retryAfterMs).toBeGreaterThan(0);
    expect(body.retryAfterMs).toBeLessThanOrEqual(TRY_LIMITS.read.windowMs);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(mathpixCalls()).toHaveLength(TRY_LIMITS.read.limit);
    // another visitor behind the same Cloudflare edge is not affected
    expect((await check(checkReq(CHECK, { "cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "172.70.0.9" }))).status).toBe(200);
    // without Cloudflare: x-forwarded-for
    expect((await check(checkReq(CHECK, { "cf-connecting-ip": undefined, "x-forwarded-for": "198.51.100.4" }))).status).toBe(200);
  }, 120_000);

  it("stops everyone once the day's reads are spent, before the reader, counted across instances in the database", async () => {
    vi.stubEnv("TRY_DAILY_READS", "2");
    resetServerEnvCache();
    expect((await check(checkReq(CHECK, { "cf-connecting-ip": "203.0.113.1" }))).status).toBe(200);
    expect((await check(checkReq(CHECK, { "cf-connecting-ip": "203.0.113.2" }))).status).toBe(200);
    const spent = await check(checkReq(CHECK, { "cf-connecting-ip": "203.0.113.3" }));
    const body = await expectError(spent, 429, "rate_limited");
    expect(body.retryAfterMs).toBe(3_600_000);
    expect(mathpixCalls()).toHaveLength(2);
    expect(rpc.mock.calls.map(([, args]) => (args as { p_limit: number }).p_limit)).toEqual([2, 2, 2]);
  }, 30_000);

  it("fails open on the day's cap when the counter cannot be reached, and keeps the visitor's limit", async () => {
    const failures: Array<null | { rpc: Rpc }> = [
      null,
      { rpc: async () => ({ data: null, error: { message: "Could not find the function public.global_budget_spend" } }) },
      { rpc: async () => ({ data: { nope: true }, error: null }) },
      {
        rpc: async () => {
          throw new Error("connection refused");
        },
      },
    ];
    for (const client of failures) {
      cap.client = client;
      const res = await check(checkReq());
      expect(res.status).toBe(200);
      expect((await res.json()).verdict).toBe("solved");
    }
    expect(logs.filter((l) => l.msg === "try read").map((l) => l.obj.dailyCap)).toEqual(["open", "open", "open", "open"]);
    // the per-visitor limit still holds
    cap.client = null;
    for (let i = failures.length; i < TRY_LIMITS.read.limit; i++) await check(checkReq());
    await expectError(await check(checkReq()), 429, "rate_limited");
  }, 120_000);

  it("does not wait on a slow counter", async () => {
    cap.client = { rpc: () => new Promise(() => {}) };
    const startedAt = Date.now();
    const res = await check(checkReq());
    expect(res.status).toBe(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(TRY_CAP_TIMEOUT_MS - 50);
    expect(logs.find((l) => l.msg === "try read")?.obj.dailyCap).toBe("open");
  }, 30_000);
});

describe("POST /api/try/help", () => {
  it("answers the next step in the tutor's hand, with no read and no count", async () => {
    const res = await help(helpReq({ problemId: "g68-3", work: [] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const body = await res.json();
    expect(TryHelpResponseSchema.safeParse(body).success).toBe(true);
    expect(body.latex).toBe("2x = 12");
    expect(body.solves).toBe(false);
    expect(body.ink.strokes.length).toBeGreaterThan(0);
    expect(body.ink.strokes[0]).toEqual({ d: expect.stringMatching(/^M/), weight: expect.any(Number), atMs: 0, forMs: expect.any(Number) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  }, 30_000);

  it("says when the step finishes the problem, and has nothing once it is solved", async () => {
    expect(await (await help(helpReq({ problemId: "g68-3", work: ["2x = 12"] }))).json()).toMatchObject({ latex: "x = 6", solves: true });
    expect(await (await help(helpReq({ problemId: "k2-0", work: [] }))).json()).toMatchObject({ latex: "= 7", solves: true });
    expect(await (await help(helpReq({ problemId: "k2-0", work: ["7"] }))).json()).toEqual({ latex: null, ink: null, solves: false });
  }, 30_000);

  it("has the check's guards: kill switch, origin, body, schema, problem id", async () => {
    await expectError(await help(helpReq({ problemId: "g68-3", work: [] }, { "Sec-Fetch-Site": "cross-site" })), 403, "invalid_request");
    await expectError(await help(helpReq({ problemId: "nope", work: [] })), 400, "invalid_request");
    await expectError(await help(helpReq({ problemId: "g68-3", work: "2x = 12" })), 400, "invalid_request");
    await expectError(await help(helpReq({ problemId: "g68-3", work: ["x".repeat(201)] })), 400, "invalid_request");
    await expectError(await help(helpReq("x".repeat(20_000))), 413, "invalid_request");
    vi.stubEnv("TRY_ENABLED", "0");
    resetServerEnvCache();
    await expectError(await help(helpReq({ problemId: "g68-3", work: [] })), 503, "unavailable");
  }, 30_000);

  it("gives a visitor TRY_LIMITS.help steps, then 429; its own bucket, apart from the reads", async () => {
    for (let i = 0; i < TRY_LIMITS.help.limit; i++) expect((await help(helpReq({ problemId: "k2-0", work: [] }))).status, `step ${i + 1}`).toBe(200);
    const body = await expectError(await help(helpReq({ problemId: "k2-0", work: [] })), 429, "rate_limited");
    expect(body.retryAfterMs).toBeGreaterThan(0);
    // the reads are another bucket
    expect((await check(checkReq())).status).toBe(200);
    expect((await help(helpReq({ problemId: "k2-0", work: [] }, { "cf-connecting-ip": "203.0.113.77" }))).status).toBe(200);
  }, 120_000);

  it("needs no reader and no counter", async () => {
    vi.stubEnv("MATHPIX_APP_ID", "");
    resetServerEnvCache();
    cap.client = null;
    expect((await help(helpReq({ problemId: "hs-0", work: [] }))).status).toBe(200);
  }, 30_000);
});
