#!/usr/bin/env node
/**
 * Behavioural RLS verification for ANY Supabase project, using only the public
 * REST / Auth / Storage HTTP APIs (Node 22+, no dependencies, no psql).
 *
 *   node scripts/verify-rls.mjs
 *
 * Covers every public table (including the accounts & billing tables: plans,
 * profiles, usage_events, credit_grants, billing_events), the storage buckets,
 * the version trigger and the credit RPCs (consume_credits, credit_summary,
 * delete_own_account). Two throwaway users A and B are created up front; the
 * delete_own_account check creates a third (C) and deletes it through the RPC.
 *
 * Env (read from .env.local when not already set):
 *   NEXT_PUBLIC_SUPABASE_URL        project URL (falls back to `npx supabase status` for the local stack)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY   anon / publishable key
 *   SUPABASE_SERVICE_ROLE_KEY       optional: creates pre-confirmed throwaway users and deletes them afterwards
 *   VERIFY_EMAIL_DOMAIN             optional: domain for the throwaway emails (default example.com)
 *
 * Waits up to 3 minutes for /auth/v1/health before running anything.
 *
 * Exit codes: 0 all checks passed, 1 at least one FAIL, 2 configuration error.
 */
import { loadDotEnvLocal, resolveSupabaseEnv, waitForHealth } from "./lib/supabaseHttp.mjs";
import { bootstrapVerifyContext } from "./lib/verifyContext.mjs";
import { formatResults, runAllChecks } from "./lib/rlsChecks.mjs";

loadDotEnvLocal();

const { url, anonKey, serviceKey, source } = resolveSupabaseEnv(process.env);
if (!url || !anonKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "Set them in the environment or .env.local, or start the local stack with `npx supabase start`.",
  );
  process.exit(2);
}

const healthTimeout = 180_000;
console.log(`Target: ${url} (config from ${source}${serviceKey ? ", service role available" : ", no service role"})`);
process.stdout.write("Waiting for /auth/v1/health ... ");
if (!(await waitForHealth(url, { timeoutMs: healthTimeout }))) {
  console.error(`\nSupabase at ${url} did not report healthy within ${healthTimeout} ms.`);
  process.exit(2);
}
console.log("ok");

let bootstrap;
try {
  bootstrap = await bootstrapVerifyContext({
    url,
    anonKey,
    serviceKey: serviceKey ?? null,
    emailDomain: process.env.VERIFY_EMAIL_DOMAIN,
  });
} catch (err) {
  console.error(`\nCould not provision throwaway users: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

console.log(`Users: ${bootstrap.users.map((u) => u.email).join(", ")}\n`);

let results = [];
try {
  results = await runAllChecks(bootstrap.ctx);
} finally {
  const notes = await bootstrap.cleanup();
  console.log(formatResults(results));
  console.log("");
  for (const note of notes) console.log(`cleanup: ${note}`);
}

process.exit(results.length && results.every((r) => r.pass) ? 0 : 1);
