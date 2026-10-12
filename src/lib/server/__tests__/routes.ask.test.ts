/**
 * POST /api/live/ask (docs/ASK-V2.md), driven through its real handler with fakes for supabase-js
 * (auth and the ink RPCs), OpenRouter (`streamWithFallback`, and `chatJsonWithFallback` for the
 * gates' repairs), Ask's store, the prompt builder and `after()`. The contract:
 *  - JSON errors before the stream (out of ink, a bad body), never SSE;
 *  - `model`, the reply's words as `delta`s (never the board block, even split across chunks), then
 *    `reply`, `actions`, `done`;
 *  - the board block's actions through the chat's engine gates; one that is not JSON dropped with
 *    an event, never a crash; nothing surviving replaces the reply and gives the ink back;
 *  - a failure is an `error` event and a full refund, and nothing is saved;
 *  - the exchange saved (`done.turnId`, absent when saving failed); the memory after the response.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type RpcReply = { data?: unknown; error?: { message: string } | null };

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  calls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
  replies: {} as Record<string, () => RpcReply>,
  /** what the route handed to `after()` (run by the test, as Next runs them once the response is sent) */
  afterTasks: [] as Array<() => unknown>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN ? { data: { user: { id: fake.USER_ID, email: "qa@example.com" } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      fake.calls.push({ fn, args });
      const reply = fake.replies[fn]?.() ?? { error: { message: `no fake reply for ${fn}` } };
      return { data: reply.data ?? null, error: reply.error ?? null };
    },
  }),
}));
vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/openrouter")>();
  return { ...actual, streamWithFallback: vi.fn(), chatJsonWithFallback: vi.fn() };
});
vi.mock("@/lib/server/ask/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/ask/store")>();
  return { ...actual, loadAskContext: vi.fn(), saveAskTurns: vi.fn(), rememberFromTurn: vi.fn() };
});
vi.mock("@/lib/server/prompts/ask", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/prompts/ask")>();
  return { ...actual, buildAskMessages: vi.fn() };
});
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn((task: () => unknown) => void fake.afterTasks.push(task)) };
});

import { resetServerEnvCache } from "@/lib/env";
import { ASK_LIMITS, type AskRequestParsed } from "@/lib/live/ask/contracts";
import { LIVE_MODELS } from "@/lib/live/contracts";
import { logger } from "@/lib/logger";
import { loadAskContext, rememberFromTurn, saveAskTurns, type AskLearnerContext } from "@/lib/server/ask/store";
import { resetBillingWarnings } from "@/lib/server/billing";
import { recordEvent } from "@/lib/server/events";
import {
  chatJsonWithFallback,
  CreditsExhaustedError,
  modelEventKind,
  streamWithFallback,
  UpstreamError,
  WatchdogTimeoutError,
  type ChatMessage,
  type FallbackStreamEvent,
} from "@/lib/server/openrouter";
import { buildAskMessages } from "@/lib/server/prompts/ask";
import { PROVIDER_UNAVAILABLE_MESSAGE } from "@/lib/server/request";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { POST as ask } from "@/app/api/live/ask/route";

const ENV_VARS = ["BILLING_ENFORCE", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY", "LIVE_MODEL_ASK"] as const;
const saved: Record<string, string | undefined> = {};

const IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";
const BODY = {
  boardId: "board-1",
  message: "can you graph y = x squared for me?",
  history: [
    { role: "user", text: "hi" },
    { role: "tutor", text: "Hi! What are we working on today?" },
  ],
  screen: { empty: false, student: ["2x = 8"], tutor: [], problems: ["2x + 3 = 11", "5x - 2 = 13"] },
  clientId: "msg-1",
};
const LEARNER: AskLearnerContext = { name: "Maya", grade: 3, course: null, memory: ["Likes word problems about animals"], recent: ["fractions.divide"] };

/** One answer from `streamWithFallback`: the models it announces, then these chunks of text, then (maybe) a failure. */
type Script = { models?: string[]; chunks: string[]; fail?: Error };
let scripts: Script[];

const block = (actions: unknown[]) => `<board>${JSON.stringify({ actions })}</board>`;

function request(body: unknown = BODY, init: { signal?: AbortSignal } = {}): Request {
  return new Request("http://localhost/api/live/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${fake.GOOD_TOKEN}` },
    body: JSON.stringify(body),
    signal: init.signal,
  });
}

type Frame = { event: string; data: Record<string, unknown> };
async function frames(res: Response): Promise<Frame[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((f) => f.trim() && !f.startsWith(":"))
    .map((f) => {
      let event = "message";
      let data = "";
      for (const line of f.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}
const names = (out: Frame[]) => out.map((f) => f.event);
const deltas = (out: Frame[]) =>
  out
    .filter((f) => f.event === "delta")
    .map((f) => f.data.text)
    .join("");
const only = (out: Frame[], event: string) => out.find((f) => f.event === event)?.data;
const calls = (fn: string) => fake.calls.filter((c) => c.fn === fn);
const events = () => vi.mocked(recordEvent).mock.calls.map(([e]) => e);
const runAfterTasks = async () => {
  for (const task of fake.afterTasks.splice(0)) await task();
};

// the gates load the board's engine (mathjs) on their first problem set: once, before any test's clock
beforeAll(async () => {
  await import("@/lib/live/engine").then((m) => m.getEngine());
}, 60_000);

beforeEach(() => {
  for (const name of ENV_VARS) saved[name] = process.env[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  delete process.env.BILLING_ENFORCE;
  delete process.env.RATE_LIMIT_BACKEND;
  delete process.env.LIVE_MODEL_ASK;
  resetServerEnvCache();
  resetBillingWarnings();
  resetRateLimits();
  fake.calls.length = 0;
  fake.afterTasks.length = 0;
  for (const key of Object.keys(fake.replies)) delete fake.replies[key];
  fake.replies.rate_limit_hit = () => ({ data: { allowed: true, remaining: 11, retry_after_ms: 0, backend: "db" } });
  fake.replies.consume_credits = () => ({ data: { ok: true, remaining: 100, reason: null } });
  fake.replies.refund_ink_for = () => ({ data: { refunded: 3, remaining: 103 } });
  vi.mocked(recordEvent).mockReset();
  vi.mocked(chatJsonWithFallback).mockReset();
  vi.mocked(loadAskContext).mockReset().mockResolvedValue(LEARNER);
  vi.mocked(saveAskTurns).mockReset().mockResolvedValue(["turn-user", "turn-tutor"]);
  vi.mocked(rememberFromTurn).mockReset().mockResolvedValue(undefined);
  // the brain part's contract: the screen's picture rides in the user message as an image_url part
  vi.mocked(buildAskMessages)
    .mockReset()
    .mockImplementation((req: AskRequestParsed): ChatMessage[] => [
      { role: "system", content: "You are a friendly tutor." },
      ...req.history.map((t) => ({ role: t.role === "user" ? ("user" as const) : ("assistant" as const), content: t.text })),
      { role: "user", content: req.screen.image ? [{ type: "text", text: req.message }, { type: "image_url", image_url: { url: req.screen.image } }] : req.message },
    ]);
  scripts = [];
  vi.mocked(streamWithFallback).mockReset();
  vi.mocked(streamWithFallback).mockImplementation(async function* (): AsyncGenerator<FallbackStreamEvent, void, undefined> {
    const next = scripts.shift();
    if (!next) throw new Error("no script left");
    for (const model of next.models ?? [LIVE_MODELS.ask]) yield { type: "model", model };
    for (const text of next.chunks) yield { type: "text", text };
    if (next.fail) throw next.fail;
  });
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

describe("live/ask: the stream", () => {
  it("the reply's words as they come, then the reply, the checked actions and done; 3 ink kept; saved; memory after the response", async () => {
    scripts = [{ chunks: ["Sure! ", "Here is the graph of $y = x^{2}$.", `\n${block([{ type: "graph", relations: ["y = x^{2}"] }])}`] }];
    const res = await ask(request());
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    const out = await frames(res);

    expect(names(out)).toEqual(["model", "delta", "delta", "delta", "reply", "actions", "done"]);
    expect(only(out, "model")).toEqual({ model: LIVE_MODELS.ask });
    expect(deltas(out)).toBe("Sure! Here is the graph of $y = x^{2}$.\n");
    expect(only(out, "reply")).toEqual({ text: "Sure! Here is the graph of $y = x^{2}$." });
    expect(only(out, "actions")).toEqual({ actions: [{ type: "graph", relations: ["y = x^{2}"] }], notes: [] });
    expect(only(out, "done")).toEqual({ model: LIVE_MODELS.ask, ms: expect.any(Number), turnId: "turn-tutor" });

    // charged as the old chat, and kept
    expect(calls("consume_credits")[0].args).toMatchObject({ p_route: "live/chat", p_units: 3, p_model: LIVE_MODELS.ask });
    expect(calls("refund_ink_for")).toEqual([]);
    expect(events()).toEqual([]);

    // the model call: Ask's models, a short first-words watchdog, the fallback's own, a deadline in budget
    const [primary, fallback, opts, watchdogMs, limits] = vi.mocked(streamWithFallback).mock.calls[0];
    expect([primary, fallback]).toEqual([LIVE_MODELS.ask, LIVE_MODELS.askFallback]);
    expect(watchdogMs).toBeLessThanOrEqual(6_000);
    expect(limits).toMatchObject({ fallbackWatchdogMs: expect.any(Number), deadline: expect.any(Number) });
    expect(limits!.deadline! - Date.now()).toBeLessThan(60_000);
    expect(opts).toMatchObject({ temperature: 0.4, maxTokens: 3500, title: "Agathon Live - ask" });
    expect(opts.reasoningFor?.("anthropic/claude-haiku-5.5")).toBeUndefined();
    expect(opts.reasoningFor?.("openai/gpt-5.4-mini")).toBe("minimal");

    // the prompt gets the request as parsed and what the tutor knows, read on the server
    expect(loadAskContext).toHaveBeenCalledWith({ token: fake.GOOD_TOKEN, userId: fake.USER_ID });
    expect(vi.mocked(buildAskMessages).mock.calls[0][0]).toMatchObject({ message: BODY.message, boardId: "board-1" });
    expect(vi.mocked(buildAskMessages).mock.calls[0][1]).toEqual({ learner: LEARNER });

    // the exchange, saved: the student's turn with its client id, the tutor's with the kinds it wrote
    expect(saveAskTurns).toHaveBeenCalledWith({ token: fake.GOOD_TOKEN, userId: fake.USER_ID }, "board-1", [
      { role: "user", text: BODY.message, clientId: "msg-1" },
      { role: "tutor", text: "Sure! Here is the graph of $y = x^{2}$.", notes: [], wrote: ["graph"] },
    ]);

    // the memory model runs after the response, never during it
    expect(rememberFromTurn).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(rememberFromTurn).toHaveBeenCalledWith(
      { token: fake.GOOD_TOKEN, userId: fake.USER_ID },
      { message: BODY.message, reply: "Sure! Here is the graph of $y = x^{2}$.", memory: LEARNER.memory },
    );
  });

  it("a <board> tag split across chunks never leaks into the words; text after the block is reply again", async () => {
    scripts = [
      {
        chunks: ["Here you go. <", "bo", 'ard>{"actions":[{"type":"new_screen"},', '{"type":"write_lines","lines":["a^{2} + b^{2} = c^{2}"]}]}</bo', "ard> Good luck!"],
      },
    ];
    const out = await frames(await ask(request()));
    const words = deltas(out);
    expect(words).not.toMatch(/[<>]|board|actions/);
    expect(words).toBe("Here you go.  Good luck!");
    expect(only(out, "reply")).toEqual({ text: "Here you go.  Good luck!" });
    expect(only(out, "actions")).toEqual({ actions: [{ type: "new_screen" }, { type: "write_lines", lines: ["a^{2} + b^{2} = c^{2}"] }], notes: [] });
    expect(names(out).at(-1)).toBe("done");
  });

  it("a board block that is not JSON is dropped with an event, never a crash: the reply says so and the ink comes back", async () => {
    // a missing comma; then a block cut off by the token limit (opened, never closed, no whole object)
    const broken = [
      { chunk: '<board>{"actions":[{"type":"graph" "relations":["y = x"]}]}</board>', why: "not JSON" },
      { chunk: '<board>{"actions":[{"type":"graph","relations":["y = x"]', why: "no JSON object" },
    ];
    for (const { chunk, why } of broken) {
      fake.calls.length = 0;
      vi.mocked(recordEvent).mockReset();
      scripts = [{ chunks: ["I put the graph on your board.", chunk] }];
      const res = await ask(request());
      const out = await frames(res);
      expect(names(out)).toEqual(["model", "delta", "reply", "actions", "done"]);
      expect(deltas(out)).toBe("I put the graph on your board.");
      expect(only(out, "reply")).toEqual({ text: "Sorry, I couldn't do that on the board. Try asking another way." });
      expect(only(out, "actions")).toEqual({ actions: [], notes: [] });
      expect(only(out, "done")).toMatchObject({ refunded: true });
      expect(calls("refund_ink_for")[0].args).toEqual({ p_user_id: fake.USER_ID, p_request_id: calls("consume_credits")[0].args?.p_request_id });
      expect(events()).toEqual([
        expect.objectContaining({ level: "warn", kind: "route.live.ask", code: "board_invalid", requestId: res.headers.get("X-Request-Id"), meta: expect.objectContaining({ why }) }),
      ]);
    }
  });

  it("a board block read leniently: LaTeX with single backslashes, one bare action, more than 12 cut", async () => {
    scripts = [
      // as models write it: `\frac` with ONE backslash, which JSON alone would read as a form feed
      { chunks: ["The formula:", '<board>{"actions":[{"type":"write_lines","lines":["x = \\frac{1}{2}"]}]}</board>'] },
      { chunks: ["A new screen.", '<board>{"type":"new_screen"}</board>'] },
      { chunks: ["Lots of screens.", block(Array.from({ length: 14 }, () => ({ type: "new_screen" })))] },
    ];
    const formula = await frames(await ask(request()));
    expect(only(formula, "actions")).toEqual({ actions: [{ type: "write_lines", lines: ["x = \\frac{1}{2}"] }], notes: [] });
    const bare = await frames(await ask(request()));
    expect(only(bare, "actions")).toEqual({ actions: [{ type: "new_screen" }], notes: [] });
    // cut to the contract's 12, then to the board's own limit (`cleanChatActions`): never refused whole
    const lots = await frames(await ask(request()));
    expect((only(lots, "actions")!.actions as unknown[]).length).toBeGreaterThan(0);
    expect(only(lots, "done")).not.toHaveProperty("refunded");
    expect(events()).toEqual([]);
  });

  it("an answer with no board block keeps the reply and the charge (a question back, any school subject)", async () => {
    scripts = [{ chunks: ["Plants make food from sunlight. ", "What do you think they need besides light?"] }];
    const out = await frames(await ask(request({ ...BODY, message: "how do plants eat?" })));
    expect(only(out, "reply")).toEqual({ text: "Plants make food from sunlight. What do you think they need besides light?" });
    expect(only(out, "actions")).toEqual({ actions: [], notes: [] });
    expect(only(out, "done")).not.toHaveProperty("refunded");
    expect(calls("refund_ink_for")).toEqual([]);
  });
});

describe("live/ask: the board's actions through the engine's gates", () => {
  it("every action dropped: the reply is replaced with why, the ink comes back, and the saved turn says the same", async () => {
    scripts = [{ chunks: ["I wrote the next step under problem 7.", block([{ type: "help_problem", problem: 7, depth: "step" }])] }];
    const out = await frames(await ask(request({ ...BODY, message: "help me with 7" })));
    // the words streamed as written; the final reply replaces them
    expect(deltas(out)).toBe("I wrote the next step under problem 7.");
    expect(only(out, "reply")).toEqual({ text: "There's no problem 7 on this screen." });
    expect(only(out, "actions")).toEqual({ actions: [], notes: [] });
    expect(only(out, "done")).toMatchObject({ refunded: true, turnId: "turn-tutor" });
    expect(calls("refund_ink_for")).toHaveLength(1);
    expect(calls("refund_ink_for")[0].args?.p_request_id).toBe(calls("consume_credits")[0].args?.p_request_id);
    expect(vi.mocked(saveAskTurns).mock.calls[0][2][1]).toEqual({ role: "tutor", text: "There's no problem 7 on this screen.", notes: [], wrote: [] });
  });

  it("a problem set the engine refuses gets ONE repair on Ask's models; none left: dropped, an event, the ink back", async () => {
    scripts = [{ chunks: ["Here are 2 to try.", block([{ type: "write_problems", problems: ["y = 2x + 3", "x^{2} + y^{2} = 25"] }])] }];
    vi.mocked(chatJsonWithFallback).mockResolvedValueOnce({ data: { problems: ["y = 3x", "2x + y = 7"] }, model: LIVE_MODELS.ask } as never);
    const out = await frames(await ask(request({ ...BODY, message: "2 practice problems" })));
    expect(only(out, "reply")).toEqual({ text: "Sorry, I couldn't check those problems, so I didn't write them. Try asking for them another way." });
    expect(only(out, "done")).toMatchObject({ refunded: true });
    const [primary, fallback, repair] = vi.mocked(chatJsonWithFallback).mock.calls[0];
    expect([primary, fallback]).toEqual([LIVE_MODELS.ask, LIVE_MODELS.askFallback]);
    expect(repair.title).toBe("Agathon Live - ask problems");
    // Anthropic's primary is sent no reasoning in a repair either; OpenAI's fallback the least
    expect(repair.reasoningFor?.(LIVE_MODELS.ask)).toBeUndefined();
    expect(repair.reasoningFor?.(LIVE_MODELS.askFallback)).toBe("minimal");
    // its model events are the board chat's, as Ask is metered
    expect(modelEventKind(repair.title)).toBe("model.live.chat");
    expect(repair.deadline! - Date.now()).toBeLessThanOrEqual(50_000);
    expect(events()).toEqual([expect.objectContaining({ kind: "route.live.ask", code: "problems_dropped_unsolved", meta: expect.objectContaining({ dropped: 2, setsDropped: 1 }) })]);
  });

  it("help_board passes the gate untouched (the board runs Help me / Solve it on the student's own work)", async () => {
    scripts = [{ chunks: ["Let's look at your work together.", block([{ type: "help_board", depth: "step" }])] }];
    const out = await frames(await ask(request({ ...BODY, message: "is this right?", screen: { empty: false, student: ["3x + 1 = 10", "3x = 9"] } })));
    expect(only(out, "actions")).toEqual({ actions: [{ type: "help_board", depth: "step" }], notes: [] });
    expect(only(out, "reply")).toEqual({ text: "Let's look at your work together." });
    expect(only(out, "done")).not.toHaveProperty("refunded");
    expect(calls("refund_ink_for")).toEqual([]);
    expect(vi.mocked(saveAskTurns).mock.calls[0][2][1]).toMatchObject({ wrote: ["help_board"] });
  });
});

describe("live/ask: the models", () => {
  /** OpenRouter itself, for the real `streamWithFallback`: the primary never answers, the fallback streams. */
  const asked: Array<{ model: string; reasoning?: unknown }> = [];
  const sse = (...texts: string[]) =>
    new Response(texts.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

  it("a primary silent past the watchdog hands over to the fallback: both announced, the fallback's words, each model's own reasoning", async () => {
    asked.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { model: string; reasoning?: unknown };
        asked.push({ model: body.model, reasoning: body.reasoning });
        if (body.model === LIVE_MODELS.ask) {
          return new Promise<Response>((_, reject) => {
            const fail = () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
            if (init?.signal?.aborted) fail();
            init?.signal?.addEventListener("abort", fail, { once: true });
          });
        }
        return sse("Hi! ", "Let's work on it.");
      }),
    );
    const actual = await vi.importActual<typeof import("@/lib/server/openrouter")>("@/lib/server/openrouter");
    let watchdogAsked = 0;
    vi.mocked(streamWithFallback).mockImplementation((primary, fallback, opts, watchdogMs, limits) => {
      watchdogAsked = watchdogMs;
      // the route's own watchdog, shortened so the test does not wait 5 s
      return actual.streamWithFallback(primary, fallback, opts, 40, limits);
    });

    const out = await frames(await ask(request()));
    expect(watchdogAsked).toBeGreaterThan(0);
    expect(watchdogAsked).toBeLessThanOrEqual(6_000);
    expect(out.filter((f) => f.event === "model").map((f) => f.data.model)).toEqual([LIVE_MODELS.ask, LIVE_MODELS.askFallback]);
    expect(deltas(out)).toBe("Hi! Let's work on it.");
    expect(only(out, "done")).toMatchObject({ model: LIVE_MODELS.askFallback, turnId: "turn-tutor" });
    // Anthropic's primary is sent no reasoning; OpenAI's fallback the least
    expect(asked).toEqual([{ model: LIVE_MODELS.ask }, { model: LIVE_MODELS.askFallback, reasoning: { effort: "minimal" } }]);
    // filed with the board chat Ask is metered as; the call's own name says it was Ask
    expect(events()).toEqual([
      expect.objectContaining({ level: "warn", kind: "model.live.chat", code: "fallback", meta: expect.objectContaining({ reason: "timeout", call: "ask" }) }),
    ]);
    expect(calls("refund_ink_for")).toEqual([]);
  });

  it("an upstream failure is an `error` event with its code, the ink back in full, nothing saved", async () => {
    const cases: Array<{ fail: Error; code: string; status: number; message?: string }> = [
      { fail: new UpstreamError(502, "Provider disconnected"), code: "upstream", status: 502 },
      { fail: new WatchdogTimeoutError(LIVE_MODELS.askFallback, 10_000), code: "timeout", status: 504 },
      { fail: new CreditsExhaustedError(), code: "credits_exhausted", status: 503, message: PROVIDER_UNAVAILABLE_MESSAGE },
    ];
    for (const c of cases) {
      fake.calls.length = 0;
      vi.mocked(recordEvent).mockReset();
      // words already shown, then the model breaks off: the reply is cut short, so the ink still comes back
      scripts = [{ chunks: ["Let me think about "], fail: c.fail }];
      const res = await ask(request());
      const out = await frames(res);
      expect(names(out)).toEqual(["model", "delta", "error"]);
      expect(only(out, "error")).toEqual({ code: c.code, status: c.status, message: c.message ?? expect.any(String) });
      expect(calls("refund_ink_for")).toHaveLength(1);
      expect(calls("refund_ink_for")[0].args?.p_request_id).toBe(calls("consume_credits")[0].args?.p_request_id);
      // `delivered: false`: the charge was not kept (the words shown were cut short)
      expect(events()).toEqual([
        expect.objectContaining({ level: "error", kind: "route.live.ask", requestId: res.headers.get("X-Request-Id"), meta: expect.objectContaining({ stream: true, delivered: false }) }),
      ]);
    }
    expect(saveAskTurns).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(rememberFromTurn).not.toHaveBeenCalled();
  });

  it("an empty answer is a failure too: an `error` event and the ink back", async () => {
    scripts = [{ chunks: ["  "] }];
    const out = await frames(await ask(request()));
    expect(only(out, "error")).toMatchObject({ code: "upstream" });
    expect(calls("refund_ink_for")).toHaveLength(1);
    expect(saveAskTurns).not.toHaveBeenCalled();
  });

  it("a student who leaves aborts the model call: nothing saved, no error frame; the ink back only when they saw nothing", async () => {
    /** a model that says `words` (if any), then hangs until the student leaves */
    const leaving = (leave: AbortController, words: string[], aborted: { upstream: boolean }) =>
      async function* (_p: string, _f: string, opts: { signal?: AbortSignal }): AsyncGenerator<FallbackStreamEvent, void, undefined> {
        yield { type: "model", model: LIVE_MODELS.ask };
        for (const text of words) yield { type: "text", text };
        await new Promise<void>((_, reject) => {
          opts.signal?.addEventListener(
            "abort",
            () => {
              aborted.upstream = true;
              reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
            },
            { once: true },
          );
          setTimeout(() => leave.abort(), 10);
        });
      };

    // before any words: the ink comes back
    const early = new AbortController();
    const first = { upstream: false };
    vi.mocked(streamWithFallback).mockImplementation(leaving(early, [], first));
    const out = await frames(await ask(request(BODY, { signal: early.signal })));
    expect(names(out)).toEqual(["model"]);
    await vi.waitFor(() => expect(calls("refund_ink_for")).toHaveLength(1));
    expect(first.upstream).toBe(true);

    // after the reply began: they read it, so the charge is kept
    fake.calls.length = 0;
    const late = new AbortController();
    const second = { upstream: false };
    vi.mocked(streamWithFallback).mockImplementation(leaving(late, ["Fractions are parts of "], second));
    const partial = await frames(await ask(request(BODY, { signal: late.signal })));
    expect(names(partial)).toEqual(["model", "delta"]);
    await vi.waitFor(() => expect(second.upstream).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls("refund_ink_for")).toEqual([]);

    expect(saveAskTurns).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(rememberFromTurn).not.toHaveBeenCalled();
    expect(events()).toEqual([]);
  });
});

describe("live/ask: the request", () => {
  it("out of ink is a JSON 402 before any stream; a bad body a JSON 400 before the charge", async () => {
    fake.replies.consume_credits = () => ({ data: { ok: false, remaining: 1, reason: "insufficient_credits" } });
    const res = await ask(request());
    expect(res.status).toBe(402);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ error: "ink_empty", cost: 3 });
    expect(streamWithFallback).not.toHaveBeenCalled();
    expect(saveAskTurns).not.toHaveBeenCalled();

    fake.calls.length = 0;
    const bad = await ask(request({ ...BODY, screen: { ...BODY.screen, image: "https://example.com/cat.png" } }));
    expect(bad.status).toBe(400);
    expect((await ask(request({ ...BODY, message: "x".repeat(ASK_LIMITS.message + 1) }))).status).toBe(400);
    expect(calls("consume_credits")).toEqual([]);
  });

  it("the screen's picture goes to the model in the user message (an image_url part)", async () => {
    scripts = [{ chunks: ["I can see your drawing of a triangle."] }];
    const out = await frames(await ask(request({ ...BODY, screen: { ...BODY.screen, image: IMAGE } })));
    expect(names(out).at(-1)).toBe("done");
    expect(vi.mocked(buildAskMessages).mock.calls[0][0].screen.image).toBe(IMAGE);
    const messages = vi.mocked(streamWithFallback).mock.calls[0][2].messages;
    const user = messages.at(-1)!;
    expect(user.role).toBe("user");
    expect(user.content).toEqual(expect.arrayContaining([{ type: "image_url", image_url: { url: IMAGE } }]));
  });

  it("saving that fails (null, or a throw) still ends with `done`, without a turn id", async () => {
    vi.mocked(saveAskTurns).mockResolvedValueOnce(null);
    scripts = [{ chunks: ["Hello!"] }];
    const first = await frames(await ask(request()));
    expect(only(first, "done")).toEqual({ model: LIVE_MODELS.ask, ms: expect.any(Number) });

    vi.mocked(saveAskTurns).mockRejectedValueOnce(new Error("relation ask_messages does not exist"));
    scripts = [{ chunks: ["Hello again!"] }];
    const second = await frames(await ask(request()));
    expect(names(second)).toEqual(["model", "delta", "reply", "actions", "done"]);
    expect(only(second, "done")).not.toHaveProperty("turnId");
    expect(calls("refund_ink_for")).toEqual([]);
  });
});
