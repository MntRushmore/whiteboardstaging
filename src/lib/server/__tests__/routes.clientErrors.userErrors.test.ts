/**
 * An error a student saw, as the browser's reporter builds it (`createUserReporter`,
 * src/lib/clientErrors.ts), is a report POST /api/client-errors accepts: every kind a surface
 * reports, every level, the longest code and message. (The route's own behaviour:
 * routes.clientErrors.test.ts.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: { message: "invalid token" } }) } }),
}));
vi.mock("@/lib/logger", () => {
  const make = (): Record<string, unknown> => ({ child: () => make(), error: () => {}, warn: () => {}, info: () => {} });
  return { logger: make() };
});

import { resetServerEnvCache } from "@/lib/env";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { POST } from "@/app/api/client-errors/route";
import { createUserReporter, type ClientErrorReport, type UserErrorInput, type UserErrorKind } from "@/lib/clientErrors";

const BOARD = "0b6f8a52-3c1d-4e2f-9a7b-1c2d3e4f5a6b";

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key", OPENROUTER_API_KEY: "sk-or-test" };
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [name, value] of Object.entries(ENV)) {
    savedEnv[name] = process.env[name];
    process.env[name] = value;
  }
  resetServerEnvCache();
  resetRateLimits();
});

afterEach(() => {
  for (const name of Object.keys(ENV)) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
});

function built(inputs: UserErrorInput[]): ClientErrorReport[] {
  const sent: ClientErrorReport[] = [];
  const report = createUserReporter((r) => sent.push(r), () => ({ path: `/board/${BOARD}`, userAgent: "Mozilla/5.0 UA" }), { max: 100 });
  inputs.forEach(report);
  return sent;
}

const KINDS: UserErrorKind[] = ["live.recognize", "live.check", "live.solve", "live.capabilities", "live.chat", "live.lecture", "live.save", "live.load", "live.practice", "live.progress", "live.ink", "live.account", "live.boards", "live.image", "live.pdf", "live.report", "live.auth", "live.settings", "live.app"];

describe("POST /api/client-errors takes the reports of errors a student saw", () => {
  it("every kind, every level, the longest code and words: 204", async () => {
    const reports = built([
      ...KINDS.map((kind) => ({ kind, code: "upstream", message: "The tutor service had a hiccup" })),
      { kind: "live.solve", code: "ink", message: "You're out of ink" },
      { kind: "live.check", code: "rate_limited", message: "Slowing down — try again in 12 seconds" },
      { kind: "live.save", code: "x".repeat(200), message: "m".repeat(5000) },
    ]);
    expect(reports).toHaveLength(KINDS.length + 3);
    for (const [i, report] of reports.entries()) {
      const res = await POST(
        new Request("http://localhost/api/client-errors", { method: "POST", body: JSON.stringify(report), headers: { "x-forwarded-for": `203.0.113.${i}` } }),
      );
      expect(res.status, JSON.stringify(report)).toBe(204);
    }
  });
});
