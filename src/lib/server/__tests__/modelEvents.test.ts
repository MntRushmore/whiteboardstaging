/**
 * Model failures as app events (src/lib/server/openrouter.ts): the fallback helpers record
 * `model.<route>` — a warn `fallback` when the primary failed and the fallback answered, an error
 * (code timeout | upstream | invalid | credits) when the call failed for good, nothing on success or
 * when the caller went away. Driven through the real helpers over a fake OpenRouter (fetch), with
 * recordEvent replaced by a spy. Also: every Live call's X-Title names a metered route.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/server/events", () => ({ recordEvent: vi.fn(), recordEventNow: vi.fn(async () => undefined) }));

import { resetServerEnvCache } from "@/lib/env";
import { recordEvent } from "@/lib/server/events";
import { ROUTE_COSTS } from "@/lib/server/billing";
import {
  CreditsExhaustedError,
  UpstreamError,
  WatchdogTimeoutError,
  chatJsonWithFallback,
  modelEventKind,
  modelFailureCode,
  streamWithFallback,
} from "@/lib/server/openrouter";

const PRIMARY = "openai/gpt-5.4-mini";
const FALLBACK = "deepseek/deepseek-v4.1-flash";
const ENV_VARS = ["OPENROUTER_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const saved: Record<string, string | undefined> = {};

type Answer = (init: RequestInit) => Promise<Response>;
let answers: Record<string, Answer>;
let asked: string[];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const reply = (content: string): Answer => async () => json(200, { choices: [{ message: { content }, finish_reason: "stop" }] });
const status = (code: number, message = "boom"): Answer => async () => json(code, { error: { code, message } });
/** Never answers; rejects like fetch when its signal aborts. */
const hang: Answer = (init) =>
  new Promise((_, reject) => {
    const fail = () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
    if (init.signal?.aborted) fail();
    init.signal?.addEventListener("abort", fail, { once: true });
  });
/** An SSE stream of these frames (`data:` payloads). */
const sse = (...frames: unknown[]): Answer => async () =>
  new Response(frames.map((f) => `data: ${typeof f === "string" ? f : JSON.stringify(f)}\n\n`).join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
const delta = (content: string) => ({ choices: [{ delta: { content } }] });

beforeEach(() => {
  for (const name of ENV_VARS) saved[name] = process.env[name];
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  resetServerEnvCache();
  vi.mocked(recordEvent).mockReset();
  asked = [];
  answers = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const model = String((JSON.parse(String(init?.body)) as { model?: unknown }).model);
      asked.push(model);
      const answer = answers[model];
      if (!answer) throw new Error(`no fake answer for ${model}`);
      return answer(init ?? {});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
});

const Reply = z.object({ ok: z.boolean() });
const proofStep = (signal?: AbortSignal) =>
  chatJsonWithFallback(PRIMARY, FALLBACK, {
    messages: [{ role: "user", content: "next row" }],
    schema: Reply,
    requestId: "req-1",
    title: "Agathon Live - proof step",
    attemptTimeoutMs: 50,
    signal,
  });
const events = () => vi.mocked(recordEvent).mock.calls.map(([e]) => e);

describe("chatJsonWithFallback", () => {
  it("records nothing when the primary answers", async () => {
    answers[PRIMARY] = reply('{"ok":true}');
    await expect(proofStep()).resolves.toEqual({ data: { ok: true }, model: PRIMARY });
    expect(events()).toEqual([]);
  });

  it("the primary failed, the fallback answered: one warn `fallback`, with both models and the time", async () => {
    answers[PRIMARY] = status(500, "Internal Server Error");
    answers[FALLBACK] = reply('{"ok":true}');
    await expect(proofStep()).resolves.toEqual({ data: { ok: true }, model: FALLBACK });
    expect(events()).toEqual([
      {
        source: "server",
        level: "warn",
        kind: "model.live.proof",
        code: "fallback",
        message: `${PRIMARY} failed (upstream); ${FALLBACK} answered`,
        requestId: "req-1",
        meta: expect.objectContaining({ primary: PRIMARY, fallback: FALLBACK, call: "proof step", reason: "upstream", primaryMs: expect.any(Number), ms: expect.any(Number) }),
      },
    ]);
  });

  it("a primary that does not answer in time is a `timeout` reason", async () => {
    answers[PRIMARY] = hang;
    answers[FALLBACK] = reply('{"ok":true}');
    await proofStep();
    expect(events()[0]).toMatchObject({ level: "warn", code: "fallback", meta: { reason: "timeout" } });
  });

  it("both failed: one error, coded by the fallback's failure, the primary's in meta", async () => {
    answers[PRIMARY] = hang;
    answers[FALLBACK] = reply("not json at all");
    await expect(proofStep()).rejects.toBeInstanceOf(UpstreamError);
    expect(events()).toEqual([
      expect.objectContaining({
        level: "error",
        kind: "model.live.proof",
        code: "invalid",
        message: `${PRIMARY} and ${FALLBACK} both failed`,
        meta: expect.objectContaining({ model: FALLBACK, primaryCode: "timeout" }),
      }),
    ]);
  });

  it("out of credits: never retried, one error `credits`", async () => {
    answers[PRIMARY] = status(402, "Insufficient credits");
    await expect(proofStep()).rejects.toBeInstanceOf(CreditsExhaustedError);
    expect(asked).toEqual([PRIMARY]);
    expect(events()).toEqual([expect.objectContaining({ level: "error", code: "credits", message: "OpenRouter is out of credits" })]);
  });

  it("no distinct fallback: the only model's failure is the error", async () => {
    answers[PRIMARY] = status(503);
    await expect(
      chatJsonWithFallback(PRIMARY, PRIMARY, { messages: [], schema: Reply, title: "Agathon Live - reread", attemptTimeoutMs: 50 }),
    ).rejects.toBeInstanceOf(UpstreamError);
    expect(events()).toEqual([expect.objectContaining({ level: "error", kind: "model.live.reread", code: "upstream", message: `${PRIMARY} failed` })]);
  });

  it("records nothing when the caller went away", async () => {
    answers[PRIMARY] = hang;
    answers[FALLBACK] = hang;
    const caller = new AbortController();
    const pending = proofStep(caller.signal);
    caller.abort();
    await expect(pending).rejects.toThrow();
    expect(events()).toEqual([]);
  });
});

async function drain(stream: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}
const solve = (signal?: AbortSignal) =>
  streamWithFallback(PRIMARY, FALLBACK, { messages: [{ role: "user", content: "solve" }], requestId: "req-2", title: "Agathon Live - solve", signal }, 40);

describe("streamWithFallback", () => {
  it("records nothing when the primary streams", async () => {
    answers[PRIMARY] = sse(delta("x = 3"), "[DONE]");
    await drain(solve());
    expect(events()).toEqual([]);
  });

  it("the primary failed before any content, the fallback streamed: one warn `fallback`", async () => {
    answers[PRIMARY] = status(500);
    answers[FALLBACK] = sse(delta("x = 3"), "[DONE]");
    const out = await drain(solve());
    expect(out).toContainEqual({ type: "model", model: FALLBACK });
    expect(events()).toEqual([expect.objectContaining({ level: "warn", kind: "model.live.solve", code: "fallback", requestId: "req-2", meta: expect.objectContaining({ reason: "upstream" }) })]);
  });

  it("a silent primary (the first-byte watchdog) then a failing fallback: one error, `both failed`", async () => {
    answers[PRIMARY] = hang;
    answers[FALLBACK] = status(502, "Bad Gateway");
    await expect(drain(solve())).rejects.toBeInstanceOf(UpstreamError);
    expect(events()).toEqual([expect.objectContaining({ level: "error", code: "upstream", message: `${PRIMARY} and ${FALLBACK} both failed`, meta: expect.objectContaining({ primaryCode: "timeout" }) })]);
  });

  it("a primary that breaks off mid-answer is never retried: one error `mid-answer`", async () => {
    answers[PRIMARY] = sse(delta("x ="), { error: { code: 502, message: "Provider disconnected" } });
    await expect(drain(solve())).rejects.toBeInstanceOf(UpstreamError);
    expect(asked).toEqual([PRIMARY]);
    expect(events()).toEqual([expect.objectContaining({ level: "error", code: "upstream", message: `${PRIMARY} failed mid-answer` })]);
  });

  it("records nothing when the caller went away", async () => {
    answers[PRIMARY] = hang;
    const caller = new AbortController();
    const stream = solve(caller.signal);
    const pending = drain(stream);
    caller.abort();
    await expect(pending).rejects.toThrow();
    expect(events()).toEqual([]);
  });
});

/**
 * An SSE answer whose frames arrive over time: `[afterMs, frame]` pairs (each delay from the one
 * before). The body errors like fetch's when the request is aborted.
 */
const timed = (...frames: Array<[number, unknown]>): Answer => async (init) => {
  const encoder = new TextEncoder();
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const abort = () => {
        timers.forEach(clearTimeout);
        try {
          ctrl.error(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
        } catch {
          /* already closed */
        }
      };
      init.signal?.addEventListener("abort", abort, { once: true });
      let at = 0;
      frames.forEach(([after, frame], i) => {
        at += after;
        timers.push(
          setTimeout(() => {
            try {
              ctrl.enqueue(encoder.encode(`data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`));
              if (i === frames.length - 1) ctrl.close();
            } catch {
              /* aborted */
            }
          }, at),
        );
      });
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
};
const thinking = (text = "Let me work this out") => ({ choices: [{ delta: { content: "", reasoning: text } }] });
const thinkingDetails = () => ({ choices: [{ delta: { reasoning_details: [{ type: "reasoning.summary", summary: "..." }] } }] });
const solveWith = (limits: Parameters<typeof streamWithFallback>[4]) =>
  streamWithFallback(PRIMARY, FALLBACK, { messages: [{ role: "user", content: "solve" }], requestId: "req-3", title: "Agathon Live - solve" }, 60, limits);

describe("streamWithFallback: a thinking primary, the fallback's watchdog, the route's deadline", () => {
  it("reasoning deltas are a sign of life when the route allows thinking: the primary answers, no fallback", async () => {
    // 4 x 40 ms of thinking: well past the 60 ms first-content watchdog
    answers[PRIMARY] = timed([30, thinking()], [40, thinkingDetails()], [40, thinking()], [40, delta("x = 3")], [5, "[DONE]"]);
    answers[FALLBACK] = sse(delta("x = 4"), "[DONE]");
    const out = await drain(solveWith({ primaryThinkingMs: 1000 }));
    expect(out).toEqual([{ type: "model", model: PRIMARY }, { type: "text", text: "x = 3" }]);
    expect(asked).toEqual([PRIMARY]);
    expect(events()).toEqual([]);
  });

  it("without it, reasoning is no content (the old first-byte watchdog): the fallback answers", async () => {
    answers[PRIMARY] = timed([30, thinking()], [40, thinking()], [40, delta("x = 3")], [5, "[DONE]"]);
    answers[FALLBACK] = sse(delta("x = 4"), "[DONE]");
    const out = await drain(solveWith({}));
    expect(out).toContainEqual({ type: "text", text: "x = 4" });
    expect(events()).toEqual([expect.objectContaining({ code: "fallback", meta: expect.objectContaining({ reason: "timeout" }) })]);
  });

  it("thinking past its allowance still goes to the fallback, a timeout `it was still thinking`", async () => {
    answers[PRIMARY] = timed([20, thinking()], [40, thinking()], [40, thinking()], [40, thinking()], [400, delta("x = 3")]);
    answers[FALLBACK] = sse(delta("x = 4"), "[DONE]");
    const out = await drain(solveWith({ primaryThinkingMs: 120 }));
    expect(out).toContainEqual({ type: "text", text: "x = 4" });
    expect(events()).toEqual([expect.objectContaining({ code: "fallback", meta: expect.objectContaining({ reason: "timeout", error: expect.stringContaining("still thinking") }) })]);
  });

  it("the fallback's own watchdog: a silent fallback fails as a timeout instead of running until the platform kills the function", async () => {
    answers[PRIMARY] = hang;
    answers[FALLBACK] = hang;
    await expect(drain(solveWith({ fallbackWatchdogMs: 60 }))).rejects.toBeInstanceOf(WatchdogTimeoutError);
    expect(events()).toEqual([expect.objectContaining({ level: "error", code: "timeout", message: `${PRIMARY} and ${FALLBACK} both failed` })]);
  });

  it("the route's deadline ends a fallback that started answering and never finished: an error, mid-answer", async () => {
    answers[PRIMARY] = status(500);
    answers[FALLBACK] = timed([10, delta('{"index":1')], [5_000, "[DONE]"]);
    await expect(drain(solveWith({ deadline: Date.now() + 150 }))).rejects.toBeInstanceOf(WatchdogTimeoutError);
    expect(events()).toEqual([
      expect.objectContaining({ level: "warn", code: "fallback" }),
      expect.objectContaining({ level: "error", code: "timeout", message: `${FALLBACK} failed mid-answer`, meta: expect.objectContaining({ error: expect.stringContaining("the route's time ran out") }) }),
    ]);
  });
});

describe("modelFailureCode", () => {
  it("names each way a model call fails", () => {
    expect(modelFailureCode(new CreditsExhaustedError())).toBe("credits");
    expect(modelFailureCode(new WatchdogTimeoutError(PRIMARY, 40))).toBe("timeout");
    expect(modelFailureCode(new UpstreamError(504, `${PRIMARY} did not answer within 12000 ms`))).toBe("timeout");
    expect(modelFailureCode(new UpstreamError(502, "Model returned non-JSON output"))).toBe("invalid");
    expect(modelFailureCode(new UpstreamError(502, "Model output failed validation: Required"))).toBe("invalid");
    expect(modelFailureCode(new UpstreamError(502, "Model returned an empty response"))).toBe("invalid");
    expect(modelFailureCode(new UpstreamError(429, "Rate limited"))).toBe("upstream");
    expect(modelFailureCode(new TypeError("fetch failed"))).toBe("upstream");
  });
});

describe("modelEventKind", () => {
  it("maps a Live call's title to its metered route (usage_events.route with `.` for `/`)", () => {
    expect(modelEventKind("Agathon Live - solve")).toBe("model.live.solve");
    expect(modelEventKind("Agathon Live - chat proof")).toBe("model.live.chat");
    expect(modelEventKind("Agathon Live - figure")).toBe("model.live.setup");
    expect(modelEventKind("Agathon Live - board title")).toBe("model.live.title");
    expect(modelEventKind(undefined)).toBe("model.other");
    expect(modelEventKind("Agathon")).toBe("model.other");
  });

  it("every X-Title a Live call sends names a real route (a renamed title would file its failures elsewhere)", () => {
    const root = resolve(__dirname, "../../..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "__tests__") walk(path);
        } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(path);
      }
    };
    walk(join(root, "app/api/live"));
    walk(join(root, "lib/server"));
    const routes = new Set([...Object.keys(ROUTE_COSTS), "live/title"].map((r) => `model.${r.replace(/\//g, ".")}`));
    const titles = files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/"(Agathon Live - [^"]+)"/g)].map((m) => m[1]));
    expect(titles.length).toBeGreaterThan(10);
    for (const title of titles) expect(routes, title).toContain(modelEventKind(title));
  });
});
