import { z } from "zod";
import { LIVE_MODELS } from "@/lib/live/contracts";

// Server-only env accessor. `server-only` is not installed, so guard at runtime:
// importing this module in a browser bundle is a programming error.
if (typeof window !== "undefined") {
  throw new Error("src/lib/env.ts is server-only and must not be imported from client code.");
}

/**
 * Values copied straight out of .env.example (e.g. `sk-or-...`, `your-key`) are
 * treated as unset so a half-filled env fails loudly instead of at the first API call.
 * Shared with the BYOK provider registry in src/lib/aiConfig.ts.
 */
export const PLACEHOLDER_VALUE = /^(your|replace|changeme|xxx|sk-or-\.\.\.|sk-\.\.\.|\.\.\.)/i;

export function isPlaceholderValue(v: unknown): boolean {
  return typeof v === "string" && (v.trim() === "" || PLACEHOLDER_VALUE.test(v.trim()));
}

/** Treat empty / whitespace-only / placeholder values as unset so `FOO=` in .env does not pass. */
const optionalString = z.preprocess(
  (v) => (isPlaceholderValue(v) ? undefined : v),
  z.string().optional(),
);

const requiredString = z.preprocess(
  (v) => (isPlaceholderValue(v) ? undefined : v),
  z.string({ required_error: "missing" }).min(1, "missing"),
);

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: requiredString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredString,
  OPENROUTER_API_KEY: requiredString,

  OPENAI_API_KEY: optionalString,
  MATHPIX_APP_ID: optionalString,
  MATHPIX_APP_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  NEXT_PUBLIC_SITE_URL: optionalString,
  LOG_LEVEL: optionalString,

  // Live Math model overrides (OpenRouter ids). Defaults come from LIVE_MODELS.
  LIVE_MODEL_CHECK: optionalString,
  LIVE_MODEL_SOLVE: optionalString,
  LIVE_MODEL_VISION: optionalString,
});

export type ServerEnv = z.infer<typeof envSchema>;

export const REQUIRED_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "OPENROUTER_API_KEY",
] as const;

let cached: ServerEnv | null = null;

/**
 * Lazily validate and cache the server environment.
 * Throws an Error whose message lists exactly which required variables are missing,
 * e.g. "Missing required environment variables: OPENROUTER_API_KEY, NEXT_PUBLIC_SUPABASE_URL".
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = Array.from(
      new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    );
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Add them to .env.local (see .env.example) or your hosting provider's environment settings.",
    );
  }

  cached = result.data;
  return cached;
}

/** Drop the cached env (used by tests and after process.env is mutated). */
export function resetServerEnvCache(): void {
  cached = null;
}

/** True when the OpenAI key is configured (voice tutor / Realtime API). */
export function hasOpenAI(): boolean {
  return Boolean(getServerEnv().OPENAI_API_KEY);
}

/** True when both Mathpix credentials are configured (handwritten math OCR). */
export function hasMathpix(): boolean {
  const env = getServerEnv();
  return Boolean(env.MATHPIX_APP_ID && env.MATHPIX_APP_KEY);
}

export type LiveModels = {
  check: string;
  checkFallback: string;
  solve: string;
  solveFallback: string;
  vision: string;
};

/**
 * Model ids used by the Live Math routes. `LIVE_MODEL_CHECK/SOLVE/VISION` override the
 * primaries; the fallbacks always come from LIVE_MODELS (a fallback equal to the primary
 * would be pointless, so an override that matches a fallback swaps the two).
 */
export function getLiveModels(): LiveModels {
  const env = getServerEnv();
  const check = env.LIVE_MODEL_CHECK || LIVE_MODELS.check;
  const solve = env.LIVE_MODEL_SOLVE || LIVE_MODELS.solve;
  return {
    check,
    checkFallback: check === LIVE_MODELS.checkFallback ? LIVE_MODELS.check : LIVE_MODELS.checkFallback,
    solve,
    solveFallback: solve === LIVE_MODELS.solveFallback ? LIVE_MODELS.solve : LIVE_MODELS.solveFallback,
    vision: env.LIVE_MODEL_VISION || LIVE_MODELS.vision,
  };
}
