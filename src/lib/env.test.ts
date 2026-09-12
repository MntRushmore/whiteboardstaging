import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_ENV_VARS, getServerEnv, hasMathpix, hasOpenAI, resetServerEnvCache } from "@/lib/env";

const ALL_VARS = [
  ...REQUIRED_ENV_VARS,
  "OPENAI_API_KEY",
  "MATHPIX_APP_ID",
  "MATHPIX_APP_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "LOG_LEVEL",
] as const;

const saved: Record<string, string | undefined> = {};

function setRequired() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
}

beforeEach(() => {
  for (const name of ALL_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  resetServerEnvCache();
});

afterEach(() => {
  for (const name of ALL_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  resetServerEnvCache();
});

describe("getServerEnv", () => {
  it("throws an error naming every missing required variable", () => {
    expect(() => getServerEnv()).toThrowError(/Missing required environment variables/);
    try {
      getServerEnv();
    } catch (err) {
      const message = (err as Error).message;
      for (const name of REQUIRED_ENV_VARS) expect(message).toContain(name);
      expect(message).not.toContain("OPENAI_API_KEY");
    }
  });

  it("names only the variables that are actually missing", () => {
    setRequired();
    delete process.env.OPENROUTER_API_KEY;
    expect(() => getServerEnv()).toThrowError(/OPENROUTER_API_KEY/);
    expect(() => getServerEnv()).not.toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("treats empty strings as missing", () => {
    setRequired();
    process.env.OPENROUTER_API_KEY = "   ";
    expect(() => getServerEnv()).toThrowError(/OPENROUTER_API_KEY/);
  });

  it("returns the parsed env and caches it", () => {
    setRequired();
    const first = getServerEnv();
    expect(first.OPENROUTER_API_KEY).toBe("sk-or-test");
    expect(first.OPENAI_API_KEY).toBeUndefined();

    process.env.OPENROUTER_API_KEY = "changed";
    expect(getServerEnv()).toBe(first); // cached

    resetServerEnvCache();
    expect(getServerEnv().OPENROUTER_API_KEY).toBe("changed");
  });
});

describe("optional feature flags", () => {
  it("hasOpenAI reflects OPENAI_API_KEY", () => {
    setRequired();
    expect(hasOpenAI()).toBe(false);

    resetServerEnvCache();
    process.env.OPENAI_API_KEY = "sk-test";
    expect(hasOpenAI()).toBe(true);
  });

  it("hasMathpix requires both the app id and key", () => {
    setRequired();
    process.env.MATHPIX_APP_ID = "app";
    expect(hasMathpix()).toBe(false);

    resetServerEnvCache();
    process.env.MATHPIX_APP_KEY = "key";
    expect(hasMathpix()).toBe(true);
  });
});
