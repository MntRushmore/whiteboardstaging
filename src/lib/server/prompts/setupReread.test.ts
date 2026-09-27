import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@/lib/env";
import { RereadRequestSchema, SetupRequestSchema } from "@/lib/live/contracts";
import { chatJsonWithFallback, CreditsExhaustedError, UpstreamError } from "@/lib/server/openrouter";
import { buildRereadMessages, cleanRereadLatex, REREAD_SYSTEM_PROMPT, rereadReasoning, RereadReplySchema } from "./reread";
import { buildSetupMessages, cleanSetupReply, MAX_SETUP_LINES, SETUP_SYSTEM_PROMPT, SetupReplySchema } from "./setup";

/**
 * The two prompts adapted from the model benchmark (docs/eval/models.md): job 1 (word problem →
 * equations) for /api/live/setup and job 3 (misread repair) for /api/live/reread — what the model
 * sees and how its reply is cleaned — and the non-streaming fallback both routes call through.
 */

const CROP = "data:image/jpeg;base64,ZmFrZQ==";

describe("setup prompt", () => {
  it("keeps the benchmark's rules: set up, never calculate, no words, percentages as decimals", () => {
    expect(SETUP_SYSTEM_PROMPT).toMatch(/You never calculate/);
    expect(SETUP_SYSTEM_PROMPT).toMatch(/v = \\frac\{150\}\{2\.5\}, not v = 60/);
    expect(SETUP_SYSTEM_PROMPT).toMatch(/no \\text, no words/);
    expect(SETUP_SYSTEM_PROMPT).toMatch(/15% is 0\.15/);
    expect(SETUP_SYSTEM_PROMPT).toMatch(/"lines": \[\]/);
  });

  it("sends the problem's lines as they were read, top to bottom, empty ones dropped", () => {
    const req = SetupRequestSchema.parse({ boardId: "b", lines: ["\\text{Three consecutive integers add up to 48.}", "  ", "\\text{What is the smallest?}", "x = ?"] });
    const [system, user] = buildSetupMessages(req);
    expect(system).toEqual({ role: "system", content: SETUP_SYSTEM_PROMPT });
    expect(user).toEqual({
      role: "user",
      content: "Problem lines:\n\\text{Three consecutive integers add up to 48.}\n\\text{What is the smallest?}\nx = ?\n\nJSON only.",
    });
  });

  it("cleans the reply: strings only, $ off, empties and long lines dropped, capped", () => {
    const reply = SetupReplySchema.parse({ unknown: "$v$", lines: ["$v = \\frac{150}{2.5}$", "", null, "x".repeat(501), "a", "b", "c", "d"] });
    expect(cleanSetupReply(reply)).toEqual({ lines: ["v = \\frac{150}{2.5}", "a", "b", "c"].slice(0, MAX_SETUP_LINES), unknown: "v" });
  });

  it("a reply without lines or unknown parses as empty (the route then refunds)", () => {
    expect(cleanSetupReply(SetupReplySchema.parse({}))).toEqual({ lines: [], unknown: "" });
    expect(cleanSetupReply(SetupReplySchema.parse({ lines: "v = 60", unknown: 5 }))).toEqual({ lines: [], unknown: "" });
  });
});

describe("reread prompt", () => {
  it("keeps the benchmark's proofreading rules: unchanged when right, never solve or fix the maths", () => {
    expect(REREAD_SYSTEM_PROMPT).toMatch(/return it unchanged/);
    expect(REREAD_SYSTEM_PROMPT).toMatch(/look-alike digit or Greek letter, the wrong case/);
    expect(REREAD_SYSTEM_PROMPT).toMatch(/never solve, simplify or fix/);
    expect(REREAD_SYSTEM_PROMPT).toMatch(/\{"latex": string, "changed": boolean\}/);
  });

  it("puts the image first, then Mathpix's LaTeX and the lines above (as the benchmark did)", () => {
    const req = RereadRequestSchema.parse({ boardId: "b", lineId: "l", crop: CROP, latex: "0=2", above: ["v=u+a t", "u=3"] });
    const [system, user] = buildRereadMessages(req);
    expect(system).toEqual({ role: "system", content: REREAD_SYSTEM_PROMPT });
    expect(user.content).toEqual([
      { type: "image_url", image_url: { url: CROP } },
      { type: "text", text: "Recognizer's LaTeX for the line in the image: 0=2\nLines above, top to bottom:\n1. v=u+a t\n2. u=3\nJSON only." },
    ]);
  });

  it("says when there is nothing above, and adds the lines below only when there are some", () => {
    const first = buildRereadMessages(RereadRequestSchema.parse({ boardId: "b", lineId: "l", crop: CROP, latex: "6^{x}=10" }));
    expect((first[1].content as Array<{ text?: string }>)[1].text).toBe("Recognizer's LaTeX for the line in the image: 6^{x}=10\nLines above: none\nJSON only.");
    const mid = buildRereadMessages(RereadRequestSchema.parse({ boardId: "b", lineId: "l", crop: CROP, latex: "U=3", below: ["a = 2"] }));
    expect((mid[1].content as Array<{ text?: string }>)[1].text).toContain("Lines below, top to bottom:\n1. a = 2");
  });

  it("cleans the reply and picks minimal reasoning except for Anthropic", () => {
    expect(cleanRereadLatex("  $a = 5$ ")).toBe("a = 5");
    expect(RereadReplySchema.parse({ latex: "a=5" })).toEqual({ latex: "a=5", changed: false });
    expect(RereadReplySchema.safeParse({ changed: true }).success).toBe(false);
    expect(rereadReasoning("google/gemini-3.1-flash-lite")).toBe("minimal");
    expect(rereadReasoning("anthropic/claude-haiku-4.5")).toBeUndefined();
  });
});

describe("chatJsonWithFallback", () => {
  const schema = SetupReplySchema;
  const reply = (content: string) => Response.json({ choices: [{ message: { content } }] });
  let bodies: Array<Record<string, unknown>>;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"]) saved[k] = process.env[k];
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    resetServerEnvCache();
    bodies = [];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetServerEnvCache();
    vi.unstubAllGlobals();
  });

  function stubFetch(answers: Array<Response | Error | "hang">): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        const next = answers.shift();
        if (next === "hang") {
          return new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
          });
        }
        if (next instanceof Error) throw next;
        return next ?? reply("{}");
      }),
    );
  }

  const opts = { messages: [{ role: "user" as const, content: "hi" }], schema, attemptTimeoutMs: 1_000, reasoningFor: (m: string) => (m.startsWith("anthropic/") ? undefined : ("low" as const)), latencyFirst: true };

  it("answers from the primary, with JSON mode, latency routing, its reasoning, and single-backslash LaTeX repaired", async () => {
    stubFetch([reply('{"unknown": "v", "lines": ["v = \\frac{150}{2.5}"]}')]);
    const out = await chatJsonWithFallback("openai/gpt-5.4-mini", "deepseek/deepseek-v4.1-flash", opts);
    expect(out.model).toBe("openai/gpt-5.4-mini");
    expect(out.data.lines).toEqual(["v = \\frac{150}{2.5}"]);
    expect(bodies[0]).toMatchObject({ model: "openai/gpt-5.4-mini", response_format: { type: "json_object" }, provider: { sort: "latency" }, reasoning: { effort: "low" } });
  });

  it("falls back once when the primary fails, and the fallback gets its own reasoning (none for Anthropic)", async () => {
    stubFetch([new Response("{}", { status: 500 }), reply('{"lines": ["x = 1"]}')]);
    const out = await chatJsonWithFallback("google/gemini-3.1-flash-lite", "anthropic/claude-haiku-4.5", opts);
    expect(out.model).toBe("anthropic/claude-haiku-4.5");
    expect(bodies.map((b) => b.model)).toEqual(["google/gemini-3.1-flash-lite", "anthropic/claude-haiku-4.5"]);
    expect(bodies[1].reasoning).toBeUndefined();
  });

  it("falls back when the primary does not answer in time; two timeouts are an upstream error", async () => {
    stubFetch(["hang", reply('{"lines": ["x = 1"]}')]);
    expect((await chatJsonWithFallback("a/one", "b/two", { ...opts, attemptTimeoutMs: 30 })).model).toBe("b/two");
    stubFetch(["hang", "hang"]);
    await expect(chatJsonWithFallback("a/one", "b/two", { ...opts, attemptTimeoutMs: 30 })).rejects.toBeInstanceOf(UpstreamError);
  });

  it("never retries out-of-credits, and a non-JSON reply from both is an upstream error", async () => {
    stubFetch([new Response(JSON.stringify({ error: { message: "insufficient credits" } }), { status: 402 })]);
    await expect(chatJsonWithFallback("a/one", "b/two", opts)).rejects.toBeInstanceOf(CreditsExhaustedError);
    expect(bodies).toHaveLength(1);
    bodies = [];
    stubFetch([reply("Sorry, I cannot."), reply("still no")]);
    await expect(chatJsonWithFallback("a/one", "b/two", opts)).rejects.toBeInstanceOf(UpstreamError);
    expect(bodies).toHaveLength(2);
  });
});
