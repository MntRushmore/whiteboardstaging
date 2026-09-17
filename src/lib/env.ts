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

  // Billing (all optional; see docs/ARCHITECTURE.md "Billing").
  BILLING_ENFORCE: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  BILLING_PRICE_MAP: optionalString,
  NEXT_PUBLIC_BILLING_LINKS: optionalString,

  // Rate limiting: 'db' (default; shared counters via rate_limit_hit RPC) or 'memory' (per instance).
  RATE_LIMIT_BACKEND: optionalString,

  // Storage GC cron (GET|POST /api/admin/gc): Vercel sends `Authorization: Bearer <CRON_SECRET>`.
  CRON_SECRET: optionalString,
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

export type RateLimitBackend = "db" | "memory";

/**
 * `RATE_LIMIT_BACKEND`: where per-user rate-limit counters live. `"memory"` selects the
 * per-instance limiter; anything else (including unset) selects the database-backed one
 * (`rate_limit_hit` RPC), which still falls back to memory when the RPC is unavailable.
 * Lenient on purpose: a typo must fail towards the stricter, shared backend.
 */
export function getRateLimitBackend(): RateLimitBackend {
  const raw = getServerEnv().RATE_LIMIT_BACKEND;
  return raw?.trim().toLowerCase() === "memory" ? "memory" : "db";
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

/* ------------------------------------------------------------------------- */
/* Billing                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Credit metering is on unless `BILLING_ENFORCE=0` (dev/staging escape hatch).
 * Anything other than the literal string "0" (including unset) enforces.
 */
export function billingEnforced(): boolean {
  return getServerEnv().BILLING_ENFORCE !== "0";
}

/** `BILLING_PRICE_MAP`: provider price id -> plan id, e.g. `{"price_123":"plus"}`. */
const priceMapSchema = z.record(z.string().min(1), z.string().min(1));

export type BillingPriceMap = Record<string, string>;

/**
 * Parse a `BILLING_PRICE_MAP` value. Returns `{ map }` (empty when unset) or
 * `{ error }` describing why the JSON is unusable. Pure; no env access.
 */
export function parseBillingPriceMap(raw: string | undefined): { map: BillingPriceMap } | { error: string } {
  if (!raw || raw.trim() === "") return { map: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "BILLING_PRICE_MAP is not valid JSON." };
  }
  const result = priceMapSchema.safeParse(parsed);
  if (!result.success) {
    return { error: 'BILLING_PRICE_MAP must be a JSON object of {"<price id>": "<plan id>"} strings.' };
  }
  return { map: result.data };
}

/** Lazily validated `BILLING_PRICE_MAP`; throws with a clear message when malformed. */
export function getBillingPriceMap(): BillingPriceMap {
  const parsed = parseBillingPriceMap(getServerEnv().BILLING_PRICE_MAP);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed.map;
}

/** Absolute http(s) URL only: a bad env must not be able to inject `javascript:` links. */
const httpUrl = z.string().refine((v) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}, "must be an absolute http(s) URL");

const BILLING_LINK_KEYS = ["plus", "pro", "portal"] as const;

export type BillingLinks = Partial<Record<(typeof BILLING_LINK_KEYS)[number], string>>;

/**
 * Parse a `NEXT_PUBLIC_BILLING_LINKS` value (`{"plus":"https://…","pro":"https://…","portal":"https://…"}`).
 * Lenient on purpose: an unset or malformed value yields `{}` so the app keeps serving and
 * the UI falls back to "Coming soon". Unknown keys are dropped; non-URL values are dropped.
 */
export function parseBillingLinks(raw: string | undefined): BillingLinks {
  if (!raw || raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: BillingLinks = {};
  for (const key of BILLING_LINK_KEYS) {
    const single = httpUrl.safeParse((parsed as Record<string, unknown>)[key]);
    if (single.success) out[key] = single.data;
  }
  return out;
}

/** Checkout / portal links from `NEXT_PUBLIC_BILLING_LINKS` (server side). */
export function getBillingLinks(): BillingLinks {
  return parseBillingLinks(getServerEnv().NEXT_PUBLIC_BILLING_LINKS);
}
