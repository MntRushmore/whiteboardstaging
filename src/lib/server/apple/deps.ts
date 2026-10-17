/**
 * What the two Apple routes read from outside the request: the env, the App Store verifier, the
 * service-role store and the clock. The routes call these; tests replace them (a test root
 * certificate, a fake store, a fixed clock). Kept apart from the route files because a route file may
 * export only its handlers and segment config.
 */
import { getServerEnv } from "@/lib/env";
import { billingLogger } from "@/lib/server/billing";
import { appleConfigFrom, isAppleConfigError, type AppleConfig, type AppleConfigError, type AppleConfigInput } from "@/lib/server/apple/config";
import { appleRootCertificates } from "@/lib/server/apple/roots";
import { supabaseAppleStore, type AppleStore } from "@/lib/server/apple/store";
import { createAppleVerifier, type AppleVerifier } from "@/lib/server/apple/verify";

export const appleLogger = billingLogger.child({ provider: "apple" });

export type AppleRouteEnv = AppleConfigInput & {
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export type AppleDeps = {
  getEnv: () => AppleRouteEnv;
  createVerifier: (config: AppleConfig) => AppleVerifier;
  createStore: (url: string, serviceRoleKey: string) => AppleStore;
  /** ms */
  now: () => number;
};

/** One verifier per configuration (the library caches verified chains inside it). */
let cached: { key: string; verifier: AppleVerifier } | null = null;

function realVerifier(config: AppleConfig): AppleVerifier {
  const key = JSON.stringify([config.environments, config.bundleId, config.appAppleId ?? null, config.xcodeCert?.fingerprint256 ?? null]);
  if (cached?.key === key) return cached.verifier;
  const verifier = createAppleVerifier(config, { roots: appleRootCertificates(), onlineChecks: true });
  cached = { key, verifier };
  return verifier;
}

export const appleDeps: AppleDeps = {
  getEnv: () => {
    const env = getServerEnv();
    return {
      NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      APPLE_ENVIRONMENT: env.APPLE_ENVIRONMENT,
      APPLE_BUNDLE_ID: env.APPLE_BUNDLE_ID,
      APPLE_APP_APPLE_ID: env.APPLE_APP_APPLE_ID,
      APPLE_XCODE_CERT: env.APPLE_XCODE_CERT,
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
    };
  },
  createVerifier: realVerifier,
  createStore: supabaseAppleStore,
  now: () => Date.now(),
};

/**
 * The deployment's Apple setup, or the 503 that says why there is none. `refused` (an Xcode setting
 * on production) is logged at error: it is a misconfiguration someone must fix.
 */
export function appleSetup(env: AppleRouteEnv): { config: AppleConfig; serviceRoleKey: string } | { error: AppleConfigError | { kind: "service_role"; error: string } } {
  const config = appleConfigFrom(env);
  if (isAppleConfigError(config)) return { error: config };
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { error: { kind: "service_role", error: "SUPABASE_SERVICE_ROLE_KEY is not set" } };
  return { config, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
}
