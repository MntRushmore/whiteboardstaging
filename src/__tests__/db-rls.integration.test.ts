/**
 * Behavioural RLS checks against a LIVE Supabase stack (normally the local one
 * from `npx supabase start`). Opt-in: runs only when RUN_DB_TESTS=1.
 *
 *   RUN_DB_TESTS=1 npx vitest run src/__tests__/db-rls.integration.test.ts
 *
 * Connection details come from NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY (and the
 * optional SUPABASE_SERVICE_ROLE_KEY for user cleanup) in process.env, falling
 * back to `npx supabase status -o env` for the local stack. Two throwaway users
 * are created and, when a service role key is available, deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_CHECKS, runCheck } from "../../scripts/lib/rlsChecks.mjs";
import type { CheckContext } from "../../scripts/lib/rlsChecks.mjs";
import { resolveSupabaseEnv, waitForHealth } from "../../scripts/lib/supabaseHttp.mjs";
import { bootstrapVerifyContext } from "../../scripts/lib/verifyContext.mjs";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const title = enabled
  ? "RLS integration (live Supabase)"
  : "RLS integration — skipped: set RUN_DB_TESTS=1 with the local stack running (`npx supabase start`) to enable";

suite(title, () => {
  let ctx: CheckContext;
  let cleanup: (() => Promise<string[]>) | undefined;

  beforeAll(async () => {
    const { url, anonKey, serviceKey, source } = resolveSupabaseEnv(process.env);
    if (!url || !anonKey) {
      throw new Error(
        "RUN_DB_TESTS=1 but no Supabase target: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, " +
          "or start the local stack with `npx supabase start` so `npx supabase status -o env` can supply them.",
      );
    }
    if (!(await waitForHealth(url, { timeoutMs: 180_000 }))) {
      throw new Error(`Supabase at ${url} (from ${source}) did not answer /auth/v1/health within 3 minutes`);
    }
    const boot = await bootstrapVerifyContext({
      url,
      anonKey,
      serviceKey: serviceKey ?? null,
      emailDomain: process.env.VERIFY_EMAIL_DOMAIN,
    });
    ctx = boot.ctx;
    cleanup = boot.cleanup;
  }, 240_000);

  afterAll(async () => {
    if (cleanup) await cleanup();
  }, 60_000);

  for (const check of ALL_CHECKS) {
    it(
      check.name,
      async () => {
        const results = await runCheck(check, ctx);
        expect(results.length).toBeGreaterThan(0);
        expect(results.filter((r) => !r.pass)).toEqual([]);
      },
      60_000,
    );
  }
});
