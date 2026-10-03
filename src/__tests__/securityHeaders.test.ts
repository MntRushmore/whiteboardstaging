import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { SECURITY_HEADERS } from "@/lib/securityHeaders";

/**
 * Every response carries the anti-framing headers (security audit, 2026-10-03): before them any
 * site could frame the account page or a board and steer a child's clicks.
 */
describe("security headers (next.config.ts)", () => {
  it("applies the headers to every path", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    expect(all!.headers).toEqual([...SECURITY_HEADERS]);
  });

  it("forbids framing in both the CSP and the legacy header", () => {
    const get = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value ?? "";
    expect(get("Content-Security-Policy")).toMatch(/(^|;\s*)frame-ancestors 'none'(;|$)/);
    expect(get("X-Frame-Options")).toBe("DENY");
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    expect(get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("keeps the microphone for lecture mode on our own pages and nothing else", () => {
    const policy = SECURITY_HEADERS.find((h) => h.key === "Permissions-Policy")?.value ?? "";
    expect(policy).toContain("microphone=(self)");
    expect(policy).toContain("camera=()");
  });

  it("does not ship a script-src (a full CSP needs its own rollout; see securityHeaders.ts)", () => {
    const csp = SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
    expect(csp).not.toMatch(/script-src|default-src|connect-src|img-src/);
  });
});
