#!/usr/bin/env node
/**
 * Behavioural RLS verification for ANY Supabase project, using only the public
 * REST / Auth / Storage HTTP APIs (Node 22+, no dependencies, no psql).
 *
 *   node scripts/verify-rls.mjs
 *
 * Covers every public table (including the accounts & billing tables: plans,
 * profiles, usage_events, credit_grants, billing_events, rate_limit_counters, the
 * ink tables ink_packs, ink_grants, ink_purchases, ink_checkout_reviews, Agathon
 * Unlimited's unlimited_subscriptions and unlimited_usage, the service-role-only
 * email_log, the learning record's learning_attempts: LEARNING_CHECKS, and the admin system's
 * service-role-only admins, app_events, health_checks and alert_state with is_admin() and
 * prune_admin_rows(): ADMIN_CHECKS, and the families' families and family_members with the shared
 * plan and the kids' deletion: FAMILY_CHECKS, and the referrals: REFERRAL_CHECKS, all run after the rest), the
 * storage buckets, the version and history triggers and the RPCs (consume_credits, credit_summary,
 * ink_summary, rate_limit_hit, usage_by_day, save_onboarding, delete_own_account;
 * and that a user can call none of the service-role RPCs refund_credits,
 * refund_ink_for, grant_ink_purchase, reverse_ink_purchase, record_ink_checkout_review,
 * grant_ink, prune_whiteboard_snapshots, link_unlimited_checkout, apply_unlimited_subscription,
 * nor the internal has_unlimited). Two throwaway users A and B are created up front; the
 * delete_own_account check creates a third (C) and deletes it through the RPC, and the Unlimited
 * check a fourth, whose deletion must wait until its plan is set to cancel.
 *
 * Env (read from .env.local when not already set):
 *   NEXT_PUBLIC_SUPABASE_URL        project URL (falls back to `npx supabase status` for the local stack)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY   anon / publishable key
 *   SUPABASE_SERVICE_ROLE_KEY       optional: creates pre-confirmed throwaway users and deletes them afterwards;
 *                                   also enables the service-role halves: refunds of failed calls
 *                                   (refund_ink_for), the ink purchase + refund round trip, the amount
 *                                   check and review queue, the ledgers' delete guards, and an
 *                                   Unlimited plan's whole life (its rows are removed afterwards)
 *   VERIFY_EMAIL_DOMAIN             optional: domain for the throwaway emails (default example.com)
 *
 * Waits up to 3 minutes for /auth/v1/health before running anything.
 *
 * Exit codes: 0 all checks passed, 1 at least one FAIL, 2 configuration error.
 */
import { createSupabaseHttp, loadDotEnvLocal, resolveSupabaseEnv, waitForHealth } from "./lib/supabaseHttp.mjs";
import { bootstrapVerifyContext } from "./lib/verifyContext.mjs";
import { ADMIN_CHECKS, ALL_CHECKS, FAMILY_CHECKS, formatResults, LEARNING_CHECKS, REFERRAL_CHECKS, runAllChecks } from "./lib/rlsChecks.mjs";

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
if (!(await waitForHealth(url, { timeoutMs: healthTimeout, anonKey }))) {
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

// Refunds, purchases and reviews are service-role only, so their positive cases
// need the key. Without it those halves are reported as skipped; everything a
// user must NOT be able to do still runs as the throwaway users.
/** @type {import("./lib/rlsChecks.mjs").CheckContext} */
const ctx = {
  ...bootstrap.ctx,
  service: serviceKey ? createSupabaseHttp({ url, anonKey, accessToken: serviceKey, userId: null }) : undefined,
};

let results = [];
try {
  results = await runAllChecks(ctx, [...ALL_CHECKS, ...LEARNING_CHECKS, ...ADMIN_CHECKS, ...FAMILY_CHECKS, ...REFERRAL_CHECKS]);
} finally {
  const notes = await bootstrap.cleanup();
  console.log(formatResults(results));
  console.log("");
  for (const note of notes) console.log(`cleanup: ${note}`);
}

process.exit(results.length && results.every((r) => r.pass) ? 0 : 1);
