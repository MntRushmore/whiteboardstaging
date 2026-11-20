/**
 * v1.0 reliability: a Live call at temperature 0 carries the fixed seed (`LIVE_SEED`), so the
 * providers that take one answer the same ink the same way; a call at a higher temperature (Ask's
 * words) carries none. Checked on the bytes `fetch` receives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resetServerEnvCache } from "@/lib/env";
import { LIVE_SEED, chatJson, chatJsonWithFallback, streamChatText } from "@/lib/server/openrouter";

const ENV_VARS = ["OPENROUTER_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const saved: Record<string, string | undefined> = {};

function capture(reply: () => Response) {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return reply();
    }),
  );
  return bodies;
}

const jsonReply = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
const sseReply = () => new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { "Content-Type": "text/event-stream" } });

beforeEach(() => {
  for (const name of ENV_VARS) saved[name] = process.env[name];
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  resetServerEnvCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
});

describe("the fixed seed on temperature-0 calls", () => {
  const schema = z.object({ ok: z.boolean() });
  const messages = [{ role: "user" as const, content: "x" }];

  it("chatJson (reread, vision read, setup): temperature 0 by default, with the seed", async () => {
    const bodies = capture(jsonReply);
    await chatJson({ model: "google/gemini-3.5-flash-lite", messages, schema });
    expect(bodies[0]).toMatchObject({ temperature: 0, seed: LIVE_SEED });
  });

  it("chatJsonWithFallback: both attempts carry it", async () => {
    let n = 0;
    const bodies = capture(() => (++n === 1 ? new Response("{}", { status: 500 }) : jsonReply()));
    await chatJsonWithFallback("google/gemini-3.5-flash-lite", "anthropic/claude-haiku-4.5", { messages, schema, attemptTimeoutMs: 5_000 });
    expect(bodies.map((b) => b.seed)).toEqual([LIVE_SEED, LIVE_SEED]);
  });

  it("streamChatText (check, solve) at temperature 0 carries it; at 0.4 (Ask) it does not", async () => {
    const bodies = capture(sseReply);
    for await (const _ of streamChatText({ model: "google/gemini-3.5-flash", messages, temperature: 0 })) void _;
    for await (const _ of streamChatText({ model: "google/gemini-3.5-flash", messages, temperature: 0.4 })) void _;
    expect(bodies[0]).toMatchObject({ temperature: 0, seed: LIVE_SEED });
    expect(bodies[1].temperature).toBe(0.4);
    expect(bodies[1]).not.toHaveProperty("seed");
  });
});
