#!/usr/bin/env node
/**
 * Seed the LOCAL Supabase stack with the QA user used by scripts/live-smoke.mjs
 * and manual testing, via the Auth HTTP API only (no psql, no supabase-js).
 *
 *   node scripts/seed-local.mjs
 *
 * Env (optional; falls back to `npx supabase status -o env`):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   SMOKE_EMAIL / SMOKE_PASSWORD    default qa-student@example.com / password123 (shared with live-smoke.mjs)
 *
 * Refuses to run against anything but a loopback URL: the credentials are public.
 */
import { ensureUser, isLoopbackUrl, resolveSupabaseEnv, waitForHealth } from "./lib/supabaseHttp.mjs";

const EMAIL = process.env.SMOKE_EMAIL || "qa-student@example.com";
const PASSWORD = process.env.SMOKE_PASSWORD || "password123";

const { url, anonKey, serviceKey } = resolveSupabaseEnv(process.env);
if (!url || !anonKey) {
  console.error("Local stack not found. Run `npx supabase start` first (or set NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY).");
  process.exit(2);
}

if (!isLoopbackUrl(url)) {
  console.error(`Refusing to seed a non-local project (${url}); the QA password is public.`);
  process.exit(2);
}

process.stdout.write(`Waiting for ${url}/auth/v1/health ... `);
if (!(await waitForHealth(url, { timeoutMs: 180_000, anonKey }))) {
  console.error("\nlocal Supabase did not become healthy; is Docker running?");
  process.exit(2);
}
console.log("ok");

try {
  const user = await ensureUser({ url, anonKey, serviceKey: serviceKey ?? null, email: EMAIL, password: PASSWORD });
  console.log(`${user.created ? "Created" : "Found"} QA user ${EMAIL} (id ${user.userId})`);
} catch (err) {
  console.error(`Could not create ${EMAIL}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

console.log("\nAdd to .env.local:");
console.log(`NEXT_PUBLIC_SUPABASE_URL=${url}`);
console.log(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`);
console.log(`SMOKE_EMAIL=${EMAIL}`);
console.log(`SMOKE_PASSWORD=${PASSWORD}`);
