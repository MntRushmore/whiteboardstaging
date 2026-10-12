/**
 * POST /api/client-errors: a stale chunk from a tab on another build than this deployment is
 * recorded at info, so an old tab never re-opens the ChunkLoadError issues (tabs from 2342d69 still
 * reported them on 2026-10-10, days after src/lib/chunkReload.ts shipped). This deployment is
 * a64cddd here (`RELEASE`, mocked); the route's other behaviour: routes.clientErrors.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  release: "a64cddd",
  lines: [] as Array<{ fields: Record<string, unknown>; level: string }>,
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: { message: "invalid token" } }) } }),
}));
vi.mock("@/lib/logger", () => {
  const make = (): Record<string, unknown> => ({
    child: () => make(),
    error: (fields: Record<string, unknown>) => fake.lines.push({ fields, level: "error" }),
    warn: (fields: Record<string, unknown>) => fake.lines.push({ fields, level: "warn" }),
    info: (fields: Record<string, unknown>) => fake.lines.push({ fields, level: "info" }),
    debug: (fields: Record<string, unknown>) => fake.lines.push({ fields, level: "debug" }),
  });
  return { logger: make() };
});
vi.mock("@/lib/release", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/release")>()),
  get RELEASE() {
    return fake.release;
  },
}));
vi.mock("@/lib/server/events", () => ({ recordEvent: (e: Record<string, unknown>) => void fake.events.push(e) }));

import { resetServerEnvCache } from "@/lib/env";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { POST } from "@/app/api/client-errors/route";
import { CHUNK_FAILED_REPORT } from "@/lib/chunkReload";
import { isOtherRelease } from "@/lib/release";

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key", OPENROUTER_API_KEY: "sk-or-test" };
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [name, value] of Object.entries(ENV)) {
    savedEnv[name] = process.env[name];
    process.env[name] = value;
  }
  resetServerEnvCache();
  resetRateLimits();
  fake.release = "a64cddd";
  fake.lines.length = 0;
  fake.events.length = 0;
});

afterEach(() => {
  for (const name of Object.keys(ENV)) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  resetServerEnvCache();
});

/** The crash 2342d69's /welcome/plan sent on 2026-10-10 (client.boundary, then client.error). */
const STALE_CRASH = {
  source: "boundary",
  message: "ChunkLoadError: Failed to load chunk /_next/static/chunks/0fhcpomg5-fvq.js from module 964893",
  stack: "ChunkLoadError: Failed to load chunk /_next/static/chunks/0fhcpomg5-fvq.js from module 964893\n    at https://www.agathon.app/_next/static/chunks/turbopack-0l2eny4k2z50_.js:1:6163",
  path: "/welcome/plan",
  userAgent: "Mozilla/5.0 (Macintosh) UA",
  release: "2342d69",
};

/** What a tab on a build with src/lib/chunkReload.ts sends for an import() nothing caught. */
const CHUNK_FAILED = { source: "live", path: "/board", userAgent: "Mozilla/5.0 UA", release: "924eb6b", ...CHUNK_FAILED_REPORT };

async function levelOf(body: Record<string, unknown>, ip: string): Promise<{ log: string; event: unknown }> {
  fake.lines.length = 0;
  fake.events.length = 0;
  const res = await POST(new Request("http://localhost/api/client-errors", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": ip } }));
  expect(res.status).toBe(204);
  expect(fake.lines).toHaveLength(1);
  expect(fake.events).toHaveLength(1);
  return { log: fake.lines[0].level, event: fake.events[0].level };
}

describe("POST /api/client-errors: a stale chunk from another build", () => {
  it("a ChunkLoadError crash from an older build is info, as kind, code and words were (the same issue, never re-opened)", async () => {
    for (const source of ["boundary", "error", "rejection", "global"]) {
      expect(await levelOf({ ...STALE_CRASH, source }, "203.0.113.1")).toEqual({ log: "info", event: "info" });
      expect(fake.events[0]).toMatchObject({ kind: `client.${source}`, message: STALE_CRASH.message, release: "2342d69" });
    }
    // each browser's words for a failed import()
    for (const message of ["TypeError: Failed to fetch dynamically imported module: https://www.agathon.app/_next/static/chunks/x.js", "TypeError: Importing a module script failed."]) {
      expect(await levelOf({ ...STALE_CRASH, source: "rejection", message, stack: undefined }, "203.0.113.2")).toEqual({ log: "info", event: "info" });
    }
  });

  it("the chunk_failed warning from another build is info too", async () => {
    expect(await levelOf(CHUNK_FAILED, "203.0.113.3")).toEqual({ log: "info", event: "info" });
    expect(fake.events[0]).toMatchObject({ kind: "live.app", code: "chunk_failed" });
  });

  it("the same failure from this very build keeps its level (a chunk missing from the live release, the connection down)", async () => {
    expect(await levelOf({ ...STALE_CRASH, release: "a64cddd" }, "203.0.113.4")).toEqual({ log: "error", event: "error" });
    expect(await levelOf({ ...CHUNK_FAILED, release: "a64cddd" }, "203.0.113.5")).toEqual({ log: "warn", event: "warn" });
    // a full sha of this build is this build
    expect(await levelOf({ ...STALE_CRASH, release: "A64CDDDAD86DA5B1F4BBDB659FA22CA8F4B3E2B9" }, "203.0.113.6")).toEqual({ log: "error", event: "error" });
  });

  it("a release unknown on either side keeps today's level", async () => {
    for (const release of ["dev", "build-m2x9k1", "preview"]) {
      expect(await levelOf({ ...STALE_CRASH, release }, "203.0.113.7")).toEqual({ log: "error", event: "error" });
      expect(await levelOf({ ...CHUNK_FAILED, release }, "203.0.113.8")).toEqual({ log: "warn", event: "warn" });
    }
    // this deployment's own release unknown (a local `next start` without git, a name set by hand)
    fake.release = "dev";
    expect(await levelOf(STALE_CRASH, "203.0.113.9")).toEqual({ log: "error", event: "error" });
    expect(await levelOf(CHUNK_FAILED, "203.0.113.10")).toEqual({ log: "warn", event: "warn" });
  });

  it("any other error from an older build keeps its level", async () => {
    expect(await levelOf({ ...STALE_CRASH, message: "TypeError: x is not a function", stack: undefined }, "203.0.113.11")).toEqual({ log: "error", event: "error" });
    // an error a student saw that merely mentions a chunk is not a stale chunk
    expect(await levelOf({ ...CHUNK_FAILED, kind: "live.solve", code: "upstream", message: "Failed to load chunk", level: undefined }, "203.0.113.12")).toEqual({ log: "error", event: "error" });
  });
});

describe("isOtherRelease", () => {
  it("compares two commits as short shas", () => {
    expect(isOtherRelease("2342d69", "a64cddd")).toBe(true);
    expect(isOtherRelease("a64cddd", "a64cddd")).toBe(false);
    expect(isOtherRelease("a64cdddad86da5b1f4bbdb659fa22ca8f4b3e2b9", "a64cddd")).toBe(false);
    expect(isOtherRelease("A64CDDD", "a64cddd")).toBe(false);
  });

  it("is never true when either side is not a commit", () => {
    for (const [release, current] of [
      ["dev", "a64cddd"],
      ["a64cddd", "dev"],
      ["build-m2x9k1", "a64cddd"],
      ["2342d69", "build-m2x9k1"],
      ["", "a64cddd"],
      [undefined, "a64cddd"],
      [null, "a64cddd"],
      ["a64cd", "a64cddd"],
    ] as const) {
      expect(isOtherRelease(release, current), `${release} vs ${current}`).toBe(false);
    }
  });
});
