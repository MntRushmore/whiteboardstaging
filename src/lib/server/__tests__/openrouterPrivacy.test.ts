/**
 * Every request the server sends to OpenRouter carries PROVIDER_PRIVACY (`data_collection: "deny"`,
 * `zdr: true`): what goes in is a child's work, so no provider that trains on prompts or keeps them
 * may answer. Checked on the bytes `fetch` receives, through each path a route uses (the plain call,
 * the stream, the JSON helper with and without its latency preference, its fallback, the lecture
 * sketch), plus a scan that no other server file posts to OpenRouter by itself.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resetServerEnvCache } from "@/lib/env";
import {
  OPENROUTER_CHAT_URL,
  PROVIDER_PRIVACY,
  chatJson,
  chatJsonWithFallback,
  openrouterChat,
  streamChatText,
  withProviderPrivacy,
} from "@/lib/server/openrouter";
import { openrouterSketchCall } from "@/lib/server/sketch/illustrate";

const ENV_VARS = ["OPENROUTER_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const saved: Record<string, string | undefined> = {};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A fake fetch that answers each call with `reply(n)` and keeps every parsed request body. */
function captureBodies(reply: (n: number) => Response) {
  const bodies: Array<Record<string, unknown>> = [];
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return reply(bodies.length);
    }),
  );
  return { bodies, urls };
}

const reply = (content: string) => json(200, { choices: [{ message: { content }, finish_reason: "stop" }], provider: "Google" });

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

const PRIVATE = { provider: { data_collection: "deny", zdr: true } };

describe("PROVIDER_PRIVACY", () => {
  it("is no training and zero retention", () => {
    expect(PROVIDER_PRIVACY).toEqual({ data_collection: "deny", zdr: true });
  });

  it("withProviderPrivacy keeps the caller's preferences, always wins over them, and copies", () => {
    const body = { model: "m", provider: { sort: "latency", data_collection: "allow", zdr: false } };
    expect(withProviderPrivacy(body)).toEqual({ model: "m", provider: { sort: "latency", data_collection: "deny", zdr: true } });
    expect(body.provider).toEqual({ sort: "latency", data_collection: "allow", zdr: false });
    expect(withProviderPrivacy({ model: "m" })).toEqual({ model: "m", ...PRIVATE });
    expect(withProviderPrivacy({ model: "m", provider: "nonsense" })).toEqual({ model: "m", ...PRIVATE });
  });
});

describe("every OpenRouter request carries it", () => {
  it("openrouterChat sends the body as given, plus the privacy preferences", async () => {
    const { bodies, urls } = captureBodies(() => reply("hi"));
    await openrouterChat({ model: "google/gemini-3.5-flash", messages: [], data_collection: "allow" });
    expect(urls).toEqual([OPENROUTER_CHAT_URL]);
    expect(bodies[0]).toMatchObject({ model: "google/gemini-3.5-flash", ...PRIVATE });
  });

  it("chatJson, with and without the latency preference (the Live JSON routes)", async () => {
    const { bodies } = captureBodies(() => reply('{"ok":true}'));
    const schema = z.object({ ok: z.boolean() });
    await chatJson({ model: "openai/gpt-5.4-mini", messages: [{ role: "user", content: "x" }], schema });
    await chatJson({ model: "openai/gpt-5.4-mini", messages: [{ role: "user", content: "x" }], schema, latencyFirst: true });
    expect(bodies[0]).toMatchObject(PRIVATE);
    expect(bodies[1]).toMatchObject({ provider: { sort: "latency", data_collection: "deny", zdr: true } });
  });

  it("chatJsonWithFallback: the primary and the fallback both", async () => {
    const { bodies } = captureBodies((n) => (n === 1 ? json(500, { error: { message: "down" } }) : reply('{"ok":true}')));
    const out = await chatJsonWithFallback("openai/gpt-5.4-mini", "deepseek/deepseek-v4.1-flash", {
      messages: [{ role: "user", content: "x" }],
      schema: z.object({ ok: z.boolean() }),
      attemptTimeoutMs: 5_000,
      latencyFirst: true,
    });
    expect(out.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(bodies.map((b) => b.model)).toEqual(["openai/gpt-5.4-mini", "deepseek/deepseek-v4.1-flash"]);
    for (const body of bodies) expect(body).toMatchObject(PRIVATE);
  });

  it("streamChatText (check, solve): the stream keeps its latency sort and gains the privacy preferences", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
    const { bodies } = captureBodies(() => new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const parts: string[] = [];
    for await (const text of streamChatText({ model: "google/gemini-3.5-flash", messages: [{ role: "user", content: "x" }] })) parts.push(text);
    expect(parts.join("")).toBe("ok");
    expect(bodies[0]).toMatchObject({ stream: true, provider: { sort: "latency", data_collection: "deny", zdr: true } });
  });

  it("the lecture sketch call", async () => {
    const { bodies } = captureBodies(() => reply("<svg></svg>"));
    await openrouterSketchCall({ model: "google/gemini-3.8-flash", messages: [], maxTokens: 100, reasoning: "low", signal: new AbortController().signal });
    expect(bodies[0]).toMatchObject({ provider: { sort: "latency", data_collection: "deny", zdr: true } });
  });
});

describe("nothing else posts to OpenRouter on its own", () => {
  /** Server code that ships: src/ without tests and evals. */
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name === "__tests__" || name === "__eval__" || name === "node_modules") continue;
        out.push(...sourceFiles(path));
      } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push(path);
      }
    }
    return out;
  }

  it("only src/lib/server/openrouter.ts names the chat completions URL or posts to it", () => {
    const src = resolve(__dirname, "..", "..", "..");
    const offenders = sourceFiles(src)
      .filter((file) => /openrouter\.ai\/api\/v1\/chat|OPENROUTER_CHAT_URL/.test(readFileSync(file, "utf8")))
      .map((file) => relative(src, file));
    expect(offenders).toEqual(["lib/server/openrouter.ts"]);
  });

  it("the operator's board-renaming script asks for the same providers", () => {
    const script = readFileSync(resolve(__dirname, "..", "..", "..", "..", "scripts", "rename-boards.ts"), "utf8");
    expect(script).toMatch(/provider: PROVIDER_PRIVACY/);
  });
});
