/**
 * POST /api/live/proof (two-column proofs: a figure read, or one next row), driven through its real
 * handler with fakes for supabase-js (auth + RPCs) and OpenRouter (`chatJsonWithFallback`). The Live
 * contract: 401 before anything, 429 before the charge, zod 400 before the charge, 2 credits up
 * front, the SAME request id refunded on any non-2xx (an empty read or row included).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RpcReply = { data?: unknown; error?: { message: string; code?: string } | null } | Error;

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  calls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
  replies: {} as Record<string, (args?: Record<string, unknown>) => RpcReply>,
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
  }),
}));

vi.mock("@/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/openrouter")>();
  return { ...actual, chatJsonWithFallback: vi.fn() };
});

import { resetServerEnvCache } from "@/lib/env";
import { LIVE_MODELS } from "@/lib/live/contracts";
import { ProofResponseSchema } from "@/lib/live/proof/contracts";
import { resetBillingWarnings } from "@/lib/server/billing";
import { chatJsonWithFallback, UpstreamError } from "@/lib/server/openrouter";
import { resetRateLimitFallbackWarning, resetRateLimits } from "@/lib/server/rate-limit";
import { POST as proof } from "@/app/api/live/proof/route";

const ENV_VARS = ["BILLING_ENFORCE", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "LIVE_MODEL_PROOF"];
const savedEnv: Record<string, string | undefined> = {};
const CROP = "data:image/jpeg;base64,ZmFrZQ==";
const FIGURE_BODY = { boardId: "board-1", task: "figure", givens: ["\\overline{AB} \\cong \\overline{CB}"], prove: "\\triangle ABD \\cong \\triangle CBD", labels: ["A", "B", "C", "D"], crop: CROP };
const STEP_BODY = {
  boardId: "board-1",
  task: "step",
  givens: ["\\overline{AB} \\cong \\overline{CB}", "\\overline{AD} \\cong \\overline{CD}"],
  prove: "\\triangle ABD \\cong \\triangle CBD",
  rows: [{ statement: "\\overline{AB} \\cong \\overline{CB}", reason: "\\text{Given}" }],
  figure: { points: { A: [0, 50], B: [50, 0], C: [100, 50], D: [50, 110] }, lines: ["AB", "BC", "CD", "DA", "BD"] },
};

function request(body: unknown, token: string | null = fake.GOOD_TOKEN): Request {
  return new Request("http://localhost/api/live/proof", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const callsTo = (fn: string) => fake.calls.filter((c) => c.fn === fn);

beforeEach(() => {
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
  for (const key of Object.keys(fake.replies)) delete fake.replies[key];
  fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 19, retry_after_ms: 0, backend: "db" } });
  fake.replies.consume_credits = () => ({ data: { ok: true, remaining: 100, reason: null } });
  fake.replies.refund_credits = () => ({ data: { refunded: 2, remaining: 102 } });
  vi.mocked(chatJsonWithFallback).mockReset();
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
});

describe("live/proof", () => {
  it("401 without a token; 429 from liveProof before the charge; 400 on a bad body", async () => {
    expect((await proof(request(FIGURE_BODY, null))).status).toBe(401);
    expect(fake.calls).toEqual([]);
    fake.replies.rate_limit_hit = () => ({ data: { allowed: false, remaining: 0, retry_after_ms: 900 } });
    expect((await proof(request(FIGURE_BODY))).status).toBe(429);
    expect(callsTo("rate_limit_hit")[0].args).toMatchObject({ p_bucket: "liveProof" });
    fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 19, retry_after_ms: 0, backend: "db" } });
    // a figure read needs its crop; a step needs what is to be proved
    expect((await proof(request({ ...FIGURE_BODY, crop: undefined }))).status).toBe(400);
    expect((await proof(request({ ...STEP_BODY, prove: "" }))).status).toBe(400);
    expect(callsTo("consume_credits")).toEqual([]);
    expect(chatJsonWithFallback).not.toHaveBeenCalled();
  });

  it("figure: the crop goes to the proof model as an image; the read comes back cleaned, 2 credits kept", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({
      data: { points: { A: [10, 50], B: [50, "8"], C: [90, 50], D: [50, 95], x: [1, 1] }, lines: ["AB", "B-C", "CD", "DA", "BD", "AQ", 7], angles: { "1": "ABD", "2": "AB" } },
      model: LIVE_MODELS.proof,
    } as never);
    const res = await proof(request(FIGURE_BODY));
    expect(res.status).toBe(200);
    const body = ProofResponseSchema.parse(await res.json());
    expect(body.figure).toEqual({ points: { A: [10, 50], B: [50, 8], C: [90, 50], D: [50, 95] }, lines: ["AB", "BC", "CD", "DA", "BD"], angles: { "1": "ABD" } });
    expect(callsTo("consume_credits")[0].args).toMatchObject({ p_route: "live/proof", p_units: 2 });
    expect(callsTo("refund_credits")).toEqual([]);
    const [primary, fallback, opts] = vi.mocked(chatJsonWithFallback).mock.calls[0];
    expect([primary, fallback]).toEqual([LIVE_MODELS.proof, LIVE_MODELS.proofFallback]);
    const user = opts.messages.find((m) => m.role === "user");
    expect(user?.content).toEqual([{ type: "image_url", image_url: { url: CROP } }, expect.objectContaining({ type: "text" })]);
  });

  it("step: the proof as text with the figure read; one row back", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { statement: "$\\overline{AD} \\cong \\overline{CD}$", reason: "Given" }, model: LIVE_MODELS.proofFallback } as never);
    const res = await proof(request(STEP_BODY));
    expect(res.status).toBe(200);
    const body = ProofResponseSchema.parse(await res.json());
    expect(body.row).toEqual({ statement: "\\overline{AD} \\cong \\overline{CD}", reason: "Given" });
    expect(body.model).toBe(LIVE_MODELS.proofFallback);
    const opts = vi.mocked(chatJsonWithFallback).mock.calls[0][2];
    const text = String(opts.messages.find((m) => m.role === "user")?.content);
    expect(text).toContain("Prove: \\triangle ABD \\cong \\triangle CBD");
    expect(text).toContain("1. \\overline{AB} \\cong \\overline{CB} | \\text{Given}");
    expect(text).toContain("straight lines AB, BC, CD, DA, BD");
  });

  it("an empty read or row is a 502, refunded under the same request id; so is a model failure", async () => {
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { statement: "", reason: "" }, model: LIVE_MODELS.proof } as never);
    expect((await proof(request(STEP_BODY))).status).toBe(502);
    vi.mocked(chatJsonWithFallback).mockResolvedValue({ data: { points: {}, lines: [] }, model: LIVE_MODELS.proof } as never);
    expect((await proof(request(FIGURE_BODY))).status).toBe(502);
    vi.mocked(chatJsonWithFallback).mockRejectedValue(new UpstreamError(504, "timed out"));
    expect((await proof(request(STEP_BODY))).status).toBe(502);
    const charged = callsTo("consume_credits").map((c) => c.args?.p_request_id);
    const refunded = callsTo("refund_credits").map((c) => c.args?.p_request_id);
    expect(charged).toHaveLength(3);
    expect(refunded).toEqual(charged);
  });
});
