/**
 * SAT v2: the live tutor's problem context on an SAT page (docs/SAT-V2.md "The tutor on an SAT
 * page", src/lib/server/sat/context.ts), through the real live/check, solve, setup, reread and
 * recognize (vision) handlers, with the models stubbed (their messages captured), supabase-js faked
 * (token checks, the SAT gate) and the bank behind `satStoreDeps`:
 *
 *  - with `sat_question_id`: the model reads the BANK's question (stem, choices, the figure as text,
 *    the solution path marked as guidance only), and the student's `sat_figure_marks`;
 *  - marks that are too long (or not text) are ignored, the call still answered;
 *  - no id: the messages are exactly an ordinary board's; an id that is not in the live bank: the
 *    same, the call answered; a malformed id: 400, as before.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ TOKEN: "student.token.sig", USER_ID: "99999999-2222-4333-8444-555555555555", captured: [] as unknown[][] }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.TOKEN ? { data: { user: { id: fake.USER_ID, email: "teen@example.com" } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async (fn: string) => {
      if (fn === "sat_tutor_spend") return { data: { unlimited: false, allowed: true, reason: null, remaining: 0 }, error: null };
      if (fn === "consume_credits") return { data: { ok: true, remaining: 41, reason: null }, error: null };
      if (fn === "refund_ink_for") return { data: { refunded: 1, remaining: 42 }, error: null };
      return { data: null, error: { message: `no fake reply for ${fn}` } };
    },
  }),
}));
vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/mathpix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/mathpix")>();
  return { ...actual, isMathpixConfigured: () => false, recognizeStrokes: vi.fn(), recognizeImage: vi.fn() };
});
vi.mock("@/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/openrouter")>();
  return {
    ...actual,
    chatJsonWithFallback: vi.fn(async (_p: string, _f: string, opts: { messages: unknown[]; schema: { parse: (v: unknown) => unknown } }) => {
      fake.captured.push(opts.messages);
      return { data: opts.schema.parse({ latex: "x=4", changed: false, unknown: "x", lines: ["x=4"] }), model: "stub" };
    }),
    chatJson: vi.fn(async (opts: { messages: unknown[]; schema: { parse: (v: unknown) => unknown } }) => {
      fake.captured.push(opts.messages);
      return opts.schema.parse({ latex: "x=4", text: "x=4", kind: "math", confidence: 0.9 });
    }),
    streamWithFallback: vi.fn((_p: string, _f: string, opts: { messages: unknown[] }) => {
      fake.captured.push(opts.messages);
      return (async function* () {
        yield { type: "model" as const, model: "stub" };
        yield { type: "text" as const, text: "" };
      })();
    }),
  };
});

import { resetServerEnvCache } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { SatQuestion } from "@/lib/sat/contracts";
import { describeFigure, satFigureMarksOf } from "@/lib/sat/tutorContext";
import { resetBillingWarnings } from "@/lib/server/billing";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { resetSatContextCache } from "@/lib/server/sat/context";
import { satStoreDeps } from "@/lib/server/sat/store";
import { POST as check } from "@/app/api/live/check/route";
import { POST as solve } from "@/app/api/live/solve/route";
import { POST as setup } from "@/app/api/live/setup/route";
import { POST as reread } from "@/app/api/live/reread/route";
import { POST as recognize } from "@/app/api/live/recognize/route";

const SAMPLE = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "..", "docs", "sat", "sample-20.json"), "utf8")) as SatQuestion[];
const Q = SAMPLE[3]; // algebra-linear-functions-0001: a plot with two labelled points
const CROP = "data:image/jpeg;base64,AAAA";
const LINE = { id: "l1", latex: "m=\\frac{3}{2}", bbox: [0, 0, 1, 0.2], local: { kind: "equation", verdict: "none" } };
const ROUTES = {
  check: { handler: check, path: "check", body: { boardId: "b1", mode: "feedback", region: { x: 0, y: 0, w: 400, h: 300 }, lines: [LINE], userAsked: true, focusLineId: "l1" } },
  solve: { handler: solve, path: "solve", body: { boardId: "b1", region: { x: 0, y: 0, w: 400, h: 300 }, lines: [LINE] } },
  setup: { handler: setup, path: "setup", body: { boardId: "b1", lines: ["\\text{What is f(6)?}"] } },
  reread: { handler: reread, path: "reread", body: { boardId: "b1", lineId: "l1", crop: CROP, latex: "m=\\frac{3}{2}" } },
  recognize: { handler: recognize, path: "recognize", body: { boardId: "b1", lineId: "l1", strokes: { x: [[1, 2, 3]], y: [[1, 2, 3]] }, bounds: { w: 100, h: 40 }, crop: CROP } },
} as const;

const post = (path: string, body: unknown) =>
  new Request(`http://localhost/api/live/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${fake.TOKEN}` }, body: JSON.stringify(body) });

/** The bank: live rows only, as RLS gives the student. */
function bankClient(): SupabaseClient {
  const from = () => {
    let ids: string[] = [];
    const b = {
      select: () => b,
      eq: () => b,
      in: (_c: string, vs: string[]) => ((ids = vs), b),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: SAMPLE.filter((q) => ids.includes(q.id) && q.status === "live").map((q) => ({ ...q })), error: null }).then(res),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

const ENV_VARS = ["BILLING_ENFORCE", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
const realDeps = { ...satStoreDeps };

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
  resetSatContextCache();
  satStoreDeps.user = () => bankClient();
  fake.captured.length = 0;
  logger.level = "silent";
});

afterEach(() => {
  Object.assign(satStoreDeps, realDeps);
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
  logger.level = process.env.LOG_LEVEL || "info";
});

/** Call a route and return the text of every message the model was sent. */
async function sent(name: keyof typeof ROUTES, extra: Record<string, unknown> = {}): Promise<{ status: number; text: string; messages: unknown[] }> {
  fake.captured.length = 0;
  const r = ROUTES[name];
  const res = await r.handler(post(r.path, { ...r.body, ...extra }));
  if (res.body) await res.text(); // drain a stream so the model is called
  const messages = fake.captured[0] ?? [];
  return { status: res.status, text: JSON.stringify(messages), messages };
}

describe("the tutor on an SAT page", () => {
  it("every tutor route reads the bank's question, its figure as text, the solution path as guidance, and the student's marks", async () => {
    for (const name of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
      const { status, text } = await sent(name, { sat_question_id: Q.id, sat_figure_marks: "circled near (2, 1); a line from about (0, -2) to (6, 7)" });
      expect(status, name).toBe(200);
      expect(text, name).toContain("SAT PRACTICE PAGE");
      expect(text, name).toContain(JSON.stringify(Q.stem).slice(1, -1));
      expect(text, name).toContain("A) $2$");
      expect(text, name).toContain('A point at (0, -2) labelled \\"(0, -2)\\"');
      expect(text, name).toContain("The graph of y = 1.5*x-2.");
      expect(text, name).toContain("for your guidance only");
      expect(text, name).toContain(JSON.stringify(Q.solution.steps[0].text).slice(1, -1));
      expect(text, name).toContain("The student's marks on the figure (in the figure's coordinates): circled near (2, 1); a line from about (0, -2) to (6, 7)");
    }
  });

  it("the block joins the system prompt; the rest of the request is untouched", async () => {
    const ordinary = await sent("check");
    const sat = await sent("check", { sat_question_id: Q.id });
    const [sysA, userA] = ordinary.messages as Array<{ role: string; content: string }>;
    const [sysB, userB] = sat.messages as Array<{ role: string; content: string }>;
    expect(sat.messages).toHaveLength(ordinary.messages.length);
    expect(sysB.content.startsWith(`${sysA.content}\n\nSAT PRACTICE PAGE`)).toBe(true);
    expect(userB).toEqual(userA);
    // no marks sent: no marks line
    expect(sat.text).not.toContain("marks on the figure");
  });

  it("marks that are too long, not text, or with control characters are ignored; the call is still answered", async () => {
    for (const marks of ["x".repeat(301), 42, "circled\nnear (2, 1)"]) {
      const { status, text } = await sent("check", { sat_question_id: Q.id, sat_figure_marks: marks });
      expect(status).toBe(200);
      expect(text).toContain("SAT PRACTICE PAGE");
      expect(text).not.toContain("marks on the figure");
    }
    expect(satFigureMarksOf({ sat_figure_marks: `  ${"y".repeat(300)}  ` })).toBe("y".repeat(300));
  });

  it("no id: exactly an ordinary board's messages; an unknown id: the same, answered; a malformed id: 400", async () => {
    for (const name of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
      const ordinary = await sent(name);
      expect(ordinary.status, name).toBe(200);
      expect(ordinary.text, name).not.toContain("SAT PRACTICE PAGE");
      const nulled = await sent(name, { sat_question_id: null, sat_figure_marks: "circled near (2, 1)" });
      expect(nulled.text, name).toBe(ordinary.text);
      const unknown = await sent(name, { sat_question_id: "algebra-linear-functions-0999", sat_figure_marks: "circled near (2, 1)" });
      expect(unknown.status, name).toBe(200);
      expect(unknown.text, name).toBe(ordinary.text);
      const bad = await sent(name, { sat_question_id: "not an id" });
      expect(bad.status, name).toBe(400);
    }
  });

  it("describes every figure kind in words", () => {
    const texts = SAMPLE.filter((q) => q.figure).map((q) => describeFigure(q.figure!));
    expect(texts.some((t) => t.startsWith("A table with columns $x$ | $g(x)$. Row: 0 | 5."))).toBe(true);
    expect(texts.some((t) => /A bar at x = 1 of height 10 labelled "1"\./.test(t))).toBe(true);
    expect(texts.some((t) => /10 points at \(1, 57\), \(2, 59\)/.test(t))).toBe(true);
    expect(texts.some((t) => /A polygon with vertices \(0, 0\), \(12, 0\), \(0, 9\)\. A right angle mark at \(0, 0\)\. The label "12" at \(6, -0\.8\)\./.test(t))).toBe(true);
    expect(texts.some((t) => /A circle with centre \(0, 0\) and radius 6\./.test(t))).toBe(true);
    expect(texts.some((t) => /An angle at \(0, 0\) between the rays at 0 and 52 degrees, labelled "\$52\^\\circ\$"/.test(t))).toBe(true);
  });
});
