/**
 * Static enforcement of the route-handler invariants documented in
 * docs/ARCHITECTURE.md ("Routes" table). No network, no Next runtime: the test
 * reads every src/app/api/**\/route.ts from disk and greps for the shared helpers.
 *
 * Invariants
 *   1. Every handler verifies the JWT (requireUser, or livePreamble which wraps it)
 *      unless the file is in PUBLIC_ROUTES.
 *   2. Every handler is rate limited (checkRateLimit / livePreamble); public routes too.
 *   3. Every POST handler validates its JSON body with zod (parseJsonBody / safeParse /
 *      livePreamble) unless the file is in NO_BODY_ROUTES.
 *   4. Every non-public handler mints a request id (crypto.randomUUID or livePreamble)
 *      for log correlation; /api/live/* additionally returns it as X-Request-Id.
 *   5. No route reads process.env directly: keys come from getServerEnv()/aiConfig.
 *   6. The static registry in scripts/lib/routes.mjs matches the filesystem exactly.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as configStatusGet } from "@/app/api/config/status/route";
import { resetRateLimits } from "@/lib/server/rate-limit";
import {
  API_ROUTES,
  NO_BODY_ROUTES,
  PUBLIC_ROUTES,
  protectedRoutes,
  routeFileToPath,
  routeProbes,
} from "../../scripts/lib/routes.mjs";

const REPO_ROOT = join(__dirname, "..", "..");
const API_DIR = join(REPO_ROOT, "src", "app", "api");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/** Recursively collect repo-relative paths of every route.ts under src/app/api. */
export function discoverRouteFiles(dir = API_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...discoverRouteFiles(full));
    else if (entry === "route.ts") out.push(relative(REPO_ROOT, full).split(sep).join("/"));
  }
  return out.sort();
}

/** Exported HTTP handlers in a route source (`export async function GET` / `export const GET =`). */
export function exportedHandlers(source: string): string[] {
  const found = new Set<string>();
  for (const method of HTTP_METHODS) {
    const fn = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`);
    const constant = new RegExp(`export\\s+const\\s+${method}\\s*[=:]`);
    if (fn.test(source) || constant.test(source)) found.add(method);
  }
  return [...found].sort();
}

function read(file: string): string {
  return readFileSync(join(REPO_ROOT, file), "utf8");
}

const routeFiles = discoverRouteFiles();
const sources = new Map(routeFiles.map((f) => [f, read(f)]));

const usesLivePreamble = (src: string) => /\blivePreamble\s*\(/.test(src);
const usesRequireUser = (src: string) => /\brequireUser\s*\(/.test(src);
const usesRateLimit = (src: string) => /\bcheckRateLimit\s*\(/.test(src) || /\brateLimitedResponse\s*\(/.test(src);
const usesBodyValidation = (src: string) => /\bparseJsonBody\s*\(/.test(src) || /\.safeParse\s*\(/.test(src);
const mintsRequestId = (src: string) => /crypto\.randomUUID\s*\(\)/.test(src);
const setsRequestIdHeader = (src: string) => /\bwithRequestId\s*\(/.test(src) || /["']X-Request-Id["']/i.test(src);

describe("route discovery", () => {
  it("finds the API routes", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
    expect(routeFiles).toContain("src/app/api/credits/route.ts");
  });

  it("every route file exports at least one HTTP handler", () => {
    for (const [file, src] of sources) {
      expect(exportedHandlers(src), file).not.toEqual([]);
    }
  });

  it("exportedHandlers recognises both export styles", () => {
    expect(exportedHandlers("export async function GET(req: Request) {}")).toEqual(["GET"]);
    expect(exportedHandlers("export const POST = handler;\nexport function DELETE() {}")).toEqual(["DELETE", "POST"]);
    expect(exportedHandlers("function GET() {}")).toEqual([]);
  });
});

describe("allow-lists", () => {
  it("PUBLIC_ROUTES is exactly config/status", () => {
    // Public by design: it reports which provider keys exist as booleans (never values,
    // prefixes or lengths) so the setup screen can render before sign-in.
    expect([...PUBLIC_ROUTES]).toEqual(["src/app/api/config/status/route.ts"]);
  });

  it("allow-listed files exist on disk", () => {
    for (const file of [...PUBLIC_ROUTES, ...NO_BODY_ROUTES]) {
      expect(routeFiles, `${file} is allow-listed but missing`).toContain(file);
    }
  });

  it("NO_BODY_ROUTES only contains routes that never call parseJsonBody", () => {
    for (const file of NO_BODY_ROUTES) {
      expect(usesBodyValidation(sources.get(file) ?? ""), `${file} validates a body; drop it from NO_BODY_ROUTES`).toBe(false);
    }
  });
});

describe("auth + rate limiting", () => {
  for (const file of routeFiles) {
    const src = sources.get(file)!;
    const isPublic = PUBLIC_ROUTES.includes(file);

    it(`${file} ${isPublic ? "is public by allow-list" : "calls requireUser (or livePreamble)"}`, () => {
      if (isPublic) {
        expect(usesRequireUser(src) || usesLivePreamble(src), "a public route must not verify a JWT; remove it from PUBLIC_ROUTES instead").toBe(false);
      } else {
        expect(usesRequireUser(src) || usesLivePreamble(src)).toBe(true);
      }
    });

    it(`${file} is rate limited`, () => {
      expect(usesRateLimit(src) || usesLivePreamble(src)).toBe(true);
    });

    it(`${file} never reads process.env directly`, () => {
      // Keys must flow through getServerEnv()/aiConfig so placeholder values are rejected once.
      expect(/process\.env\b/.test(src)).toBe(false);
    });
  }
});

describe("body validation", () => {
  for (const file of routeFiles) {
    const src = sources.get(file)!;
    const handlers = exportedHandlers(src);
    const hasBodyMethod = handlers.some((m) => ["POST", "PUT", "PATCH"].includes(m));
    if (!hasBodyMethod) continue;

    it(`${file} validates its JSON body with zod (or is allow-listed as body-less)`, () => {
      if (NO_BODY_ROUTES.includes(file)) {
        expect(/req\.json\s*\(|req\.text\s*\(|req\.formData\s*\(/.test(src), "a NO_BODY route must not read the body").toBe(false);
      } else {
        expect(usesBodyValidation(src) || usesLivePreamble(src)).toBe(true);
      }
    });
  }
});

describe("request ids", () => {
  for (const file of routeFiles) {
    const src = sources.get(file)!;
    if (PUBLIC_ROUTES.includes(file)) continue;

    it(`${file} mints a requestId for log correlation`, () => {
      expect(mintsRequestId(src) || usesLivePreamble(src)).toBe(true);
    });

    if (file.startsWith("src/app/api/live/")) {
      it(`${file} returns X-Request-Id (live contract)`, () => {
        expect(setsRequestIdHeader(src)).toBe(true);
      });
    }
  }
});

describe("scripts/lib/routes.mjs registry matches the filesystem", () => {
  it("lists exactly the route files on disk", () => {
    expect(API_ROUTES.map((r) => r.file).sort()).toEqual(routeFiles);
  });

  it("paths derive from files", () => {
    for (const route of API_ROUTES) {
      expect(routeFileToPath(route.file), route.file).toBe(route.path);
    }
    expect(() => routeFileToPath("src/lib/env.ts")).toThrow(/not an API route file/);
  });

  it("methods match the exported handlers", () => {
    for (const route of API_ROUTES) {
      expect([...route.methods].sort(), route.file).toEqual(exportedHandlers(sources.get(route.file)!));
    }
  });

  it("auth / body flags agree with the allow-lists", () => {
    for (const route of API_ROUTES) {
      expect(route.auth === "public", route.file).toBe(PUBLIC_ROUTES.includes(route.file));
      expect(route.body === "none", route.file).toBe(NO_BODY_ROUTES.includes(route.file));
    }
  });

  it("every limit names a real LIMITS bucket (or an ip:* bucket for public routes)", () => {
    const rateLimitSrc = readFileSync(join(REPO_ROOT, "src/lib/server/rate-limit.ts"), "utf8");
    for (const route of API_ROUTES) {
      if (route.auth === "public") {
        expect(route.limit, route.file).toMatch(/^ip:/);
      } else {
        expect(rateLimitSrc, `${route.file}: LIMITS.${route.limit} missing`).toMatch(new RegExp(`^\\s+${route.limit}:`, "m"));
        expect(sources.get(route.file)!, `${route.file} should use bucket "${route.limit}"`).toContain(`"${route.limit}"`);
      }
    }
  });

  it("status is active or a documented deprecation", () => {
    for (const route of API_ROUTES) {
      expect(route.status, route.file).toMatch(/^(active|deprecated: .+)$/);
    }
    const deprecated = API_ROUTES.filter((r) => r.status.startsWith("deprecated")).map((r) => r.path).sort();
    expect(deprecated).toEqual(["/api/check-help-needed", "/api/ocr"]);
  });

  it("deprecated routes are not referenced by client code", () => {
    const clientFiles = collectFiles(join(REPO_ROOT, "src"), (p) => /\.(ts|tsx)$/.test(p) && !p.includes(`${sep}app${sep}api${sep}`) && !p.includes("__tests__"));
    for (const route of API_ROUTES.filter((r) => r.status.startsWith("deprecated"))) {
      const users = clientFiles.filter((f) => readFileSync(f, "utf8").includes(`"${route.path}`));
      expect(users, `${route.path} is marked deprecated but still used`).toEqual([]);
    }
  });

  it("helpers expose probes for the smoke script", () => {
    expect(protectedRoutes().every((r) => r.auth === "user")).toBe(true);
    expect(protectedRoutes().length).toBe(API_ROUTES.length - PUBLIC_ROUTES.length);
    const probes = routeProbes();
    expect(probes.length).toBe(API_ROUTES.reduce((n, r) => n + r.methods.length, 0));
    expect(probes).toContainEqual(expect.objectContaining({ method: "GET", path: "/api/live/recognize" }));
  });
});

describe("GET /api/config/status (public, IP rate limited)", () => {
  beforeEach(() => resetRateLimits());

  const request = (ip?: string) =>
    new Request("http://localhost/api/config/status", { headers: ip ? { "x-forwarded-for": ip } : undefined });

  it("answers 200 with booleans only and no token", async () => {
    const res = await configStatusGet(request("203.0.113.5, 10.0.0.1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { configured: boolean; providers: Array<Record<string, unknown>> };
    expect(typeof body.configured).toBe("boolean");
    expect(body.providers.length).toBeGreaterThan(0);
    for (const p of body.providers) {
      expect(typeof p.present).toBe("boolean");
      expect(Object.keys(p)).not.toContain("value");
      expect(JSON.stringify(p)).not.toMatch(/sk-[A-Za-z0-9]/);
    }
  });

  it("returns 429 rate_limited with Retry-After after 60 requests from one IP", async () => {
    for (let i = 0; i < 60; i++) {
      expect((await configStatusGet(request("198.51.100.7"))).status).toBe(200);
    }
    const limited = await configStatusGet(request("198.51.100.7"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(((await limited.json()) as { error: string }).error).toBe("rate_limited");
    // Another IP (and a request with no forwarding header) is unaffected.
    expect((await configStatusGet(request("198.51.100.8"))).status).toBe(200);
    expect((await configStatusGet(request())).status).toBe(200);
  });
});

function collectFiles(dir: string, keep: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}
