/**
 * POST /api/client-errors, driven through its real handler with a fake supabase-js (token
 * verification) and a spy in place of the pino logger. The contract: a valid report is one
 * `client-error` log line and a 204; a token only adds the user id (never the token); oversized
 * bodies are 413 and malformed ones 400, neither logged; past the per-IP budget, 429.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  GOOD_TOKEN: "aaaa.bbbb.cccc",
  USER_ID: "11111111-2222-4333-8444-555555555555",
  lines: [] as Array<{ fields: Record<string, unknown>; msg: string; level: string; bindings: Record<string, unknown> }>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === fake.GOOD_TOKEN ? { data: { user: { id: fake.USER_ID, email: "qa@example.com" } }, error: null } : { data: { user: null }, error: { message: "invalid token" } },
    },
  }),
}));

vi.mock("@/lib/logger", () => {
  const make = (bindings: Record<string, unknown>) => ({
    child: (more: Record<string, unknown>) => make({ ...bindings, ...more }),
    error: (fields: Record<string, unknown>, msg: string) => fake.lines.push({ fields, msg, level: "error", bindings }),
    warn: (fields: Record<string, unknown>, msg: string) => fake.lines.push({ fields, msg, level: "warn", bindings }),
    info: (fields: Record<string, unknown>, msg: string) => fake.lines.push({ fields, msg, level: "info", bindings }),
    debug: (fields: Record<string, unknown>, msg: string) => fake.lines.push({ fields, msg, level: "debug", bindings }),
  });
  return { logger: make({}) };
});

import { resetServerEnvCache } from "@/lib/env";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { POST } from "@/app/api/client-errors/route";
import { MAX_REPORT_BYTES } from "@/lib/clientErrors";

const BOARD = "0b6f8a52-3c1d-4e2f-9a7b-1c2d3e4f5a6b";

const REPORT = {
  source: "error",
  message: "TypeError: x is not a function",
  stack: "TypeError: x is not a function\n    at h (https://app.test/_next/static/chunks/c.js:3:4)",
  path: `/board/${BOARD}`,
  boardId: BOARD,
  userAgent: "Mozilla/5.0 (Macintosh) UA",
  release: "abc1234",
};

function post(body: unknown, { ip = "203.0.113.9", token, headers = {} }: { ip?: string; token?: string; headers?: Record<string, string> } = {}): Request {
  return new Request("http://localhost/api/client-errors", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-forwarded-for": ip, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  });
}

const ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of ENV_VARS) savedEnv[name] = process.env[name];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  resetServerEnvCache();
  resetRateLimits();
  fake.lines.length = 0;
});

afterEach(() => {
  for (const name of ENV_VARS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
});

describe("POST /api/client-errors", () => {
  it("a valid report: 204, no body, one structured client-error line", async () => {
    const res = await POST(post(REPORT));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(fake.lines).toHaveLength(1);
    const [line] = fake.lines;
    expect(line.bindings).toEqual({ module: "client-error" });
    expect(line.level).toBe("error");
    expect(line.msg).toBe("client error");
    expect(line.fields).toEqual({
      source: "error",
      level: "error",
      kind: undefined,
      code: undefined,
      message: REPORT.message,
      stack: REPORT.stack,
      path: REPORT.path,
      boardId: BOARD,
      release: "abc1234",
      digest: undefined,
      userAgent: REPORT.userAgent,
      userId: undefined,
    });
  });

  it("names the user when a valid token comes with it, and never logs the token", async () => {
    expect((await POST(post(REPORT, { token: fake.GOOD_TOKEN }))).status).toBe(204);
    expect(fake.lines[0].fields.userId).toBe(fake.USER_ID);
    expect(JSON.stringify(fake.lines)).not.toContain(fake.GOOD_TOKEN);
  });

  it("a bad token is not an error: 204 without a user id", async () => {
    expect((await POST(post(REPORT, { token: "xxxx.yyyy.zzzz" }))).status).toBe(204);
    expect(fake.lines[0].fields.userId).toBeUndefined();
  });

  it("strips query strings and hashes the client left in, and drops unknown fields", async () => {
    const res = await POST(
      post({
        ...REPORT,
        path: "/login?email=a%40b.com&password=hunter2",
        message: "Failed https://app.test/login?password=hunter2",
        stack: "Error\n    at https://app.test/login?password=hunter2:1:23",
        boardContent: "the student's working",
      }),
    );
    expect(res.status).toBe(204);
    const { fields } = fake.lines[0];
    expect(fields.path).toBe("/login");
    expect(fields.stack).toBe("Error\n    at https://app.test/login:1:23");
    expect(JSON.stringify(fields)).not.toMatch(/hunter2|a%40b|student's working|boardContent/);
  });

  it("noise from a tab on an older release (isNoise): 204 and only a debug line", async () => {
    const injected = {
      ...REPORT,
      message: "TypeError: undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')",
      stack: `global code@https://www.agathon.app/board/${BOARD}:1:16`,
    };
    for (const body of [injected, { ...REPORT, message: "ResizeObserver loop completed with undelivered notifications." }]) {
      fake.lines.length = 0;
      const res = await POST(post(body, { token: fake.GOOD_TOKEN }));
      expect(res.status).toBe(204);
      expect(fake.lines.map((l) => [l.level, l.msg])).toEqual([["debug", "client error (noise, not recorded)"]]);
    }
    // one inline frame at the page and one of our own: a real crash
    fake.lines.length = 0;
    await POST(post({ ...REPORT, stack: `${injected.stack}\nrender@https://www.agathon.app/_next/static/chunks/a.js:2:3` }));
    expect(fake.lines.map((l) => l.level)).toEqual(["error"]);
  });

  it("an error a student saw is never noise, whatever its words", async () => {
    await POST(post({ ...REPORT, source: "live", kind: "live.chat", code: "aborted", message: "The request was aborted" }));
    expect(fake.lines.map((l) => [l.level, l.msg])).toEqual([["error", "client error"]]);
  });

  it("falls back to the User-Agent header when the report has none", async () => {
    await POST(post({ ...REPORT, userAgent: undefined }, { headers: { "user-agent": "HeaderUA/1" } }));
    expect(fake.lines[0].fields.userAgent).toBe("HeaderUA/1");
  });

  it("oversized: 413 by Content-Length, and by the bytes actually read", async () => {
    const big = JSON.stringify({ ...REPORT, stack: "s".repeat(MAX_REPORT_BYTES) });
    const declared = await POST(post(big));
    expect(declared.status).toBe(413);
    expect(((await declared.json()) as { error: string }).error).toBe("invalid_request");

    // No (or a lying) Content-Length: the stream is cut off at the cap.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new TextEncoder().encode("x".repeat(4096));
        for (let i = 0; i < 8; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const streamed = await POST(
      new Request("http://localhost/api/client-errors", { method: "POST", body: stream, headers: { "x-forwarded-for": "203.0.113.9" }, duplex: "half" } as RequestInit),
    );
    expect(streamed.status).toBe(413);
    expect(fake.lines).toHaveLength(0);
  });

  it.each([
    ["not JSON", "{oops"],
    ["empty body", ""],
    ["no message", JSON.stringify({ ...REPORT, message: "" })],
    ["unknown source", JSON.stringify({ ...REPORT, source: "console" })],
    ["relative path", JSON.stringify({ ...REPORT, path: "board/x" })],
    ["bad board id", JSON.stringify({ ...REPORT, boardId: "'; drop table" })],
    ["stack too long", JSON.stringify({ ...REPORT, stack: "s".repeat(4001) })],
    ["no release", JSON.stringify({ ...REPORT, release: undefined })],
  ])("malformed (%s): 400 invalid_request, nothing logged", async (_label, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
    expect(fake.lines).toHaveLength(0);
  });

  it("rate limited per IP: 120 a minute (a classroom shares one IP), then 429 with Retry-After; other IPs unaffected", async () => {
    for (let i = 0; i < 120; i++) {
      expect((await POST(post(REPORT, { ip: "198.51.100.7" }))).status).toBe(204);
    }
    const limited = await POST(post(REPORT, { ip: "198.51.100.7" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(((await limited.json()) as { error: string }).error).toBe("rate_limited");
    expect(fake.lines).toHaveLength(120);
    expect((await POST(post(REPORT, { ip: "198.51.100.8" }))).status).toBe(204);
  });
});
