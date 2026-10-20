/**
 * The Training Center's calls (src/lib/server/training.ts): the iPad sends `"training": true` to the
 * five Live routes its tutor uses, and an admin's call spends no ink. With fakes for supabase-js
 * (token verification and every RPC), the `admins` lookup (fetch), Mathpix, the models and the app
 * events, through the real handlers:
 *
 *  - a non-admin's flag is a 403 `forbidden` before anything is read or charged;
 *  - an admin's flagged call with BILLING_ENFORCE=1 is answered without consume_credits, and is an
 *    app event `training_call`; the same admin without the flag is charged as usual;
 *  - nothing to give back: a failed training read, an SSE stream that fails before its first
 *    annotation, and setup's "nothing asked" call no refund RPC;
 *  - the admin lookup failing is a 503; the training buckets (180 a minute, 4000 a day) answer 429;
 *  - the five routes pass the gate's flag into every billing call, and no other route does;
 *  - GET /api/training/status: the admin's answer, 404 for anyone else, 401 signed out.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  ADMIN_TOKEN: "admin.token.sig",
  STUDENT_TOKEN: "student.token.sig",
  FLAKY_TOKEN: "flaky.token.sig",
  ADMIN_ID: "11111111-2222-4333-8444-555555555555",
  STUDENT_ID: "99999999-2222-4333-8444-555555555555",
  // an admin whose lookup fails (the answer is never cached, so it fails every time)
  FLAKY_ID: "77777777-2222-4333-8444-555555555555",
  calls: [] as Array<{ fn: string; args?: Record<string, unknown>; key?: string }>,
  mathpix: null as unknown,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, key: string) => ({
    auth: {
      getUser: async (token: string) => {
        const user =
          token === fake.ADMIN_TOKEN
            ? { id: fake.ADMIN_ID, email: "owner@example.com" }
            : token === fake.STUDENT_TOKEN
              ? { id: fake.STUDENT_ID, email: "student@example.com" }
              : token === fake.FLAKY_TOKEN
                ? { id: fake.FLAKY_ID, email: "flaky@example.com" }
                : null;
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid token" } };
      },
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      fake.calls.push({ fn, args, key });
      if (fn === "consume_credits") return { data: { ok: true, remaining: 100, reason: null }, error: null };
      if (fn === "refund_ink_for") return { data: { refunded: 1, remaining: 101 }, error: null };
      return { data: null, error: { message: `no fake reply for ${fn}` } };
    },
  }),
}));
vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/openrouter")>();
  return { ...actual, chatJson: vi.fn(), chatJsonWithFallback: vi.fn(), streamWithFallback: vi.fn() };
});
vi.mock("@/lib/server/mathpix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mathpix")>();
  return { ...actual, isMathpixConfigured: () => true, recognizeStrokes: vi.fn(async () => fake.mathpix), recognizeImage: vi.fn() };
});

import { resetServerEnvCache } from "@/lib/env";
import { logger } from "@/lib/logger";
import { resetBillingWarnings } from "@/lib/server/billing";
import { recordEvent } from "@/lib/server/events";
import { recognizeStrokes } from "@/lib/server/mathpix";
import { chatJsonWithFallback, streamWithFallback, UpstreamError, type FallbackStreamEvent } from "@/lib/server/openrouter";
import { checkRateLimit, LIMITS, rateLimitKey, resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { TRAINING_ROUTES, trainingGate, wantsTraining } from "@/lib/server/training";
import { POST as recognize } from "@/app/api/live/recognize/route";
import { POST as liveCheck } from "@/app/api/live/check/route";
import { POST as liveSetup } from "@/app/api/live/setup/route";
import { GET as trainingStatusRoute } from "@/app/api/training/status/route";

const ENV_VARS = ["BILLING_ENFORCE", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "RECOGNIZE_CROP_READER", "RECOGNIZE_SECOND_OPINION"] as const;
const saved: Record<string, string | undefined> = {};

const READ_OK = { ok: true, latex: "x=4", text: "x=4", confidence: 0.97, raw: {} };
const RECOGNIZE = { boardId: "board-1", lineId: "ln_1", strokes: { x: [[1, 2, 3]], y: [[1, 2, 3]] }, bounds: { w: 100, h: 40 } };
const CHECK = {
  boardId: "board-1",
  mode: "suggest",
  region: { x: 0, y: 0, w: 400, h: 200 },
  lines: [
    { id: "l1", latex: "2x+3=11", bbox: [0, 0, 1, 0.5], local: { kind: "equation", verdict: "none" } },
    { id: "l2", latex: "x=5", bbox: [0, 0.5, 1, 1], local: { kind: "equation", verdict: "mismatch" } },
  ],
  focusLineId: "l2",
  userAsked: true,
};
const ANNOTATION_LINE = JSON.stringify({ lineId: "l2", verdict: "warn", kind: "algebra", message: "Check the division on the last line.", confidence: 0.9 }) + "\n";

function post(path: string, body: unknown, token: string | null = fake.ADMIN_TOKEN): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

function getStatus(token: string | null): Request {
  return new Request("http://localhost/api/training/status", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

const callsTo = (fn: string) => fake.calls.filter((c) => c.fn === fn);
const events = () => vi.mocked(recordEvent).mock.calls.map(([e]) => e);
const trainingEvents = () => events().filter((e) => e.code === "training_call");

function fakeStream(items: Array<FallbackStreamEvent | Error>): void {
  vi.mocked(streamWithFallback).mockImplementation(async function* () {
    for (const ev of items) {
      if (ev instanceof Error) throw ev;
      yield ev;
    }
  });
}

/** The SSE body to its end (it closes only after the route settled, refunds included), as event names. */
async function sseEvents(res: Response): Promise<string[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.trim() && !frame.startsWith(":"))
    .map((frame) => /^event:\s*(.+)$/m.exec(frame)?.[1].trim() ?? "message");
}

beforeEach(() => {
  for (const name of ENV_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.BILLING_ENFORCE = "1";
  process.env.RATE_LIMIT_BACKEND = "memory";
  resetServerEnvCache();
  resetBillingWarnings();
  resetRateLimits();
  resetRateLimitFallbackWarning();
  fake.calls.length = 0;
  fake.mathpix = READ_OK;
  vi.mocked(recordEvent).mockReset();
  vi.mocked(recognizeStrokes).mockClear();
  vi.mocked(streamWithFallback).mockReset();
  vi.mocked(chatJsonWithFallback).mockReset();
  // the `admins` lookup (admin.ts): the service role's read of one user id
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("/rest/v1/admins")) throw new Error(`unexpected fetch in this test: ${url}`);
      if (url.includes(fake.FLAKY_ID)) return Response.json({ message: "Database client error" }, { status: 503 });
      return Response.json(url.includes(fake.ADMIN_ID) ? [{ user_id: fake.ADMIN_ID }] : []);
    }),
  );
  logger.level = "silent";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
  logger.level = process.env.LOG_LEVEL || "info";
});

describe("wantsTraining", () => {
  it("is the boolean `true` on a JSON object, and nothing else", () => {
    expect(wantsTraining({ training: true })).toBe(true);
    expect(wantsTraining({ ...RECOGNIZE, training: true })).toBe(true);
    for (const raw of [{ training: "true" }, { training: 1 }, { training: false }, {}, [{ training: true }], null, "training", true]) {
      expect(wantsTraining(raw), JSON.stringify(raw)).toBe(false);
    }
  });
});

describe("a training call (live/recognize)", () => {
  it("from a non-admin: 403 forbidden, before Mathpix or any charge", async () => {
    const res = await recognize(post("/api/live/recognize", { ...RECOGNIZE, training: true }, fake.STUDENT_TOKEN));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", message: "Training calls are for admins." });
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(recognizeStrokes).not.toHaveBeenCalled();
    expect(callsTo("consume_credits")).toEqual([]);
    expect(trainingEvents()).toEqual([]);
  });

  it("from an admin, with billing enforced: answered, no ink (consume_credits never called), an app event training_call", async () => {
    const res = await recognize(post("/api/live/recognize", { ...RECOGNIZE, training: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ latex: "x=4", provider: "mathpix" });
    expect(recognizeStrokes).toHaveBeenCalledTimes(1);
    expect(fake.calls).toEqual([]);
    expect(events()).toEqual([
      expect.objectContaining({
        source: "server",
        level: "info",
        kind: "route.live.recognize",
        code: "training_call",
        route: "/api/live/recognize",
        userId: fake.ADMIN_ID,
        requestId: res.headers.get("X-Request-Id"),
        meta: { training: true },
      }),
    ]);
  });

  it("the same admin without the flag (or with a flag that is not `true`) is charged as usual", async () => {
    for (const body of [RECOGNIZE, { ...RECOGNIZE, training: "true" }, { ...RECOGNIZE, training: false }]) {
      fake.calls.length = 0;
      const res = await recognize(post("/api/live/recognize", body));
      expect(res.status).toBe(200);
      expect(callsTo("consume_credits"), JSON.stringify(body)).toHaveLength(1);
      expect(callsTo("consume_credits")[0].args).toMatchObject({ p_route: "live/recognize", p_units: 1 });
    }
    expect(trainingEvents()).toEqual([]);
  });

  it("a failed training read (Mathpix read nothing: 503) calls no refund, where an ordinary one is refunded", async () => {
    fake.mathpix = { ok: false, reason: "api_error", status: 200, detail: "image_no_content" };
    const res = await recognize(post("/api/live/recognize", { ...RECOGNIZE, training: true }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "recognizer_failed" });
    expect(fake.calls).toEqual([]);

    const charged = await recognize(post("/api/live/recognize", RECOGNIZE));
    expect(charged.status).toBe(503);
    expect(fake.calls.map((c) => c.fn)).toEqual(["consume_credits", "refund_ink_for"]);
  });

  it("the admin lookup failing: 503 feature_unavailable, nothing read or charged", async () => {
    const res = await recognize(post("/api/live/recognize", { ...RECOGNIZE, training: true }, fake.FLAKY_TOKEN));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "feature_unavailable", message: "Training access could not be checked right now. Try again in a minute." });
    expect(recognizeStrokes).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
  });
});

describe("the training buckets", () => {
  const admin = { id: fake.ADMIN_ID, email: "owner@example.com" };
  const gateLog = () => logger.child({ module: "live", route: "recognize", userId: fake.ADMIN_ID });

  it("180 training calls a minute pass; the next is a 429 (memory backend), and the admin's ordinary calls are untouched", async () => {
    expect(LIMITS.liveTraining).toEqual({ limit: 180, windowMs: 60_000 });
    for (let i = 0; i < 180; i++) {
      expect(await trainingGate({ user: admin, token: fake.ADMIN_TOKEN, log: gateLog() }), `call ${i + 1}`).toEqual({ ok: true });
    }
    const limited = await recognize(post("/api/live/recognize", { ...RECOGNIZE, training: true }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(await limited.json()).toMatchObject({ error: "rate_limited", backend: "memory" });
    expect(recognizeStrokes).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);

    const ordinary = await recognize(post("/api/live/recognize", RECOGNIZE));
    expect(ordinary.status).toBe(200);
    expect(callsTo("consume_credits")).toHaveLength(1);
  });

  it("the day's 4000 spent: 429 with the minute's bucket fresh", async () => {
    expect(LIMITS.liveTrainingDay).toEqual({ limit: 4000, windowMs: 24 * 60 * 60_000 });
    for (let i = 0; i < 4000; i++) checkRateLimit(rateLimitKey(fake.ADMIN_ID, "liveTrainingDay"), LIMITS.liveTrainingDay);
    const res = await recognize(post("/api/live/recognize", { ...RECOGNIZE, training: true }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "rate_limited", backend: "memory" });
    expect(recognizeStrokes).not.toHaveBeenCalled();
  });

  it("a non-admin is refused before the buckets: their refusals spend nothing there", async () => {
    for (let i = 0; i < 3; i++) expect((await recognize(post("/api/live/recognize", { ...RECOGNIZE, training: true }, fake.STUDENT_TOKEN))).status).toBe(403);
    expect(checkRateLimit(rateLimitKey(fake.STUDENT_ID, "liveTraining"), LIMITS.liveTraining).remaining).toBe(179);
  });
});

describe("a training call on an SSE route (live/check) and setup's direct refund", () => {
  it("live/check: the stream is answered and no ink is spent", async () => {
    fakeStream([{ type: "model", model: "m1" }, { type: "text", text: ANNOTATION_LINE }]);
    const res = await liveCheck(post("/api/live/check", { ...CHECK, training: true }));
    expect(res.status).toBe(200);
    expect(await sseEvents(res)).toEqual(["meta", "annotation", "done"]);
    expect(fake.calls).toEqual([]);
    expect(trainingEvents()).toEqual([expect.objectContaining({ kind: "route.live.check", userId: fake.ADMIN_ID })]);
  });

  it("live/check: a stream that fails before its first annotation calls no refund", async () => {
    fakeStream([{ type: "model", model: "m1" }, new UpstreamError(500, "both models failed")]);
    const res = await liveCheck(post("/api/live/check", { ...CHECK, training: true }));
    expect(await sseEvents(res)).toEqual(["meta", "error"]);
    expect(fake.calls).toEqual([]);
  });

  it("live/setup: the 200 that asks nothing (refunded for a student) calls no refund for a training call", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { unknown: "", lines: [] }, model: "m1" } as never);
    const res = await liveSetup(post("/api/live/setup", { boardId: "board-1", lines: ["2x2"], training: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ lines: [], reason: "nothing_asked" });
    expect(fake.calls).toEqual([]);
  });
});

describe("static: the gate's flag reaches every billing call of the five routes, and no other route", () => {
  const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
  const source = (route: string) => readFileSync(join(REPO_ROOT, "src", "app", "api", route, "route.ts"), "utf8");
  /** Every enforceInk / runCharged / runChargedStream / refundInk call's first argument (an object literal). */
  const billingCalls = (src: string) => [...src.matchAll(/\b(enforceInk|runCharged|runChargedStream|refundInk)\(\s*(\{[^{}]*\})/g)].map((m) => ({ fn: m[1], arg: m[2] }));

  it("TRAINING_ROUTES are the five Live routes the iPad's tutor uses", () => {
    expect([...TRAINING_ROUTES].sort()).toEqual(["live/check", "live/recognize", "live/reread", "live/setup", "live/solve"]);
  });

  for (const route of TRAINING_ROUTES) {
    it(`${route}: enforceInk and every refund carry training: ctx.training`, () => {
      const calls = billingCalls(source(route));
      expect(calls.filter((c) => c.fn === "enforceInk")).toHaveLength(1);
      expect(calls.filter((c) => c.fn !== "enforceInk").length).toBeGreaterThan(0);
      for (const call of calls) expect(call.arg, `${route}: ${call.fn}`).toMatch(/\btraining:\s*ctx\.training\s*\}$/);
    });
  }

  it("the other charged routes pass no training flag to billing (their training calls are charged)", () => {
    for (const route of ["live/ask", "live/chat", "live/proof", "live/lecture", "live/lecture/sketch", "live/lecture/token"]) {
      expect(source(route), route).not.toMatch(/\btraining\b/);
    }
  });
});

describe("GET /api/training/status", () => {
  it("an admin: what this server takes, uncached", async () => {
    const res = await trainingStatusRoute(getStatus(fake.ADMIN_TOKEN));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      training: true,
      routes: ["live/recognize", "live/reread", "live/setup", "live/check", "live/solve"],
      limits: { perMinute: 180, perDay: 4000 },
    });
  });

  it("a signed-in non-admin: 404 with no body (as from a server without the route)", async () => {
    const res = await trainingStatusRoute(getStatus(fake.STUDENT_TOKEN));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("signed out: 401", async () => {
    const res = await trainingStatusRoute(getStatus(null));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });
});
