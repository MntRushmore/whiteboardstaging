/**
 * The try routes' shared guards (src/lib/server/try/http.ts) and env switches: what counts as our own
 * page, who a visitor is, the capped body, the contract's error shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache, tryDailyReads, tryEnabled } from "@/lib/env";
import { isSameOrigin, readCapped, tryError, visitorIp } from "../http";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  OPENROUTER_API_KEY: "sk-or-test",
};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  resetServerEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

const req = (headers: Record<string, string>) => new Request("https://www.agathon.app/api/try/check", { method: "POST", headers });

describe("isSameOrigin", () => {
  it("takes the browser's word: same-origin only", () => {
    expect(isSameOrigin(req({ "Sec-Fetch-Site": "same-origin" }))).toBe(true);
    for (const site of ["cross-site", "same-site", "none"]) expect(isSameOrigin(req({ "Sec-Fetch-Site": site, Origin: "https://www.agathon.app" })), site).toBe(false);
  });

  it("without Sec-Fetch-Site, wants an Origin that is ours", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const origin of ["https://www.agathon.app", "https://agathon.app", "https://whiteboard.rushilchopra.com"]) expect(isSameOrigin(req({ Origin: origin })), origin).toBe(true);
    // the request's own host (a preview deployment)
    expect(isSameOrigin(req({ Origin: "https://agathon-git-x.vercel.app", "x-forwarded-host": "agathon-git-x.vercel.app" }))).toBe(true);
    for (const origin of ["https://evil.example", "http://www.agathon.app", "null", "not a url", "http://localhost:3000"]) expect(isSameOrigin(req({ Origin: origin })), origin).toBe(false);
    // neither header: curl, a server
    expect(isSameOrigin(req({}))).toBe(false);
  });

  it("knows NEXT_PUBLIC_SITE_URL's host, and localhost outside production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://staging.agathon.app");
    resetServerEnvCache();
    expect(isSameOrigin(req({ Origin: "https://staging.agathon.app" }))).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(isSameOrigin(req({ Origin: "http://localhost:3091" }))).toBe(true);
    expect(isSameOrigin(req({ Origin: "http://127.0.0.1:3000" }))).toBe(true);
  });
});

describe("visitorIp", () => {
  it("is cf-connecting-ip first, else the first hop of x-forwarded-for", () => {
    expect(visitorIp(req({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "172.70.1.1" }))).toBe("203.0.113.9");
    expect(visitorIp(req({ "cf-connecting-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(visitorIp(req({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }))).toBe("198.51.100.4");
    // not an address: ignored
    expect(visitorIp(req({ "cf-connecting-ip": "<script>", "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(visitorIp(req({}))).toBe("unknown");
  });
});

describe("readCapped", () => {
  it("reads up to the cap and refuses past it, by Content-Length or while reading", async () => {
    expect(await readCapped(new Request("http://x/", { method: "POST", body: "hello" }), 5)).toBe("hello");
    expect(await readCapped(new Request("http://x/", { method: "POST", body: "hello!" }), 5)).toBeNull();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("abc"));
        c.enqueue(new TextEncoder().encode("def"));
        c.close();
      },
    });
    expect(await readCapped(new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit), 5)).toBeNull();
  });
});

describe("tryError", () => {
  it("is the contract's { error, retryAfterMs? }, never cached, with Retry-After on a wait", async () => {
    const plain = tryError(400, "invalid_request");
    expect(plain.status).toBe(400);
    expect(await plain.json()).toEqual({ error: "invalid_request" });
    expect(plain.headers.get("cache-control")).toBe("no-store");
    const wait = tryError(429, "rate_limited", 1_500);
    expect(await wait.json()).toEqual({ error: "rate_limited", retryAfterMs: 1500 });
    expect(wait.headers.get("retry-after")).toBe("2");
  });
});

describe("TRY_ENABLED and TRY_DAILY_READS", () => {
  it("only the literal 0 turns the board off", () => {
    expect(tryEnabled()).toBe(true);
    for (const [v, on] of [["0", false], [" 0 ", false], ["1", true], ["false", true], ["", true]] as const) {
      vi.stubEnv("TRY_ENABLED", v);
      resetServerEnvCache();
      expect(tryEnabled(), JSON.stringify(v)).toBe(on);
    }
  });

  it("a whole number of reads, else the default; at most a million", () => {
    expect(tryDailyReads(3000)).toBe(3000);
    for (const [v, n] of [["50", 50], ["0", 3000], ["-5", 3000], ["1.5", 3000], ["lots", 3000], ["99999999", 1_000_000]] as const) {
      vi.stubEnv("TRY_DAILY_READS", v);
      resetServerEnvCache();
      expect(tryDailyReads(3000), v).toBe(n);
    }
  });
});
