/**
 * The billing follow-ups migration (supabase/migrations/20261009130000_billing_followups.sql) against
 * a LIVE Postgres (normally the local Supabase stack). Opt-in, like the other database suites: runs
 * only when RUN_DB_TESTS=1.
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/billing/__tests__/billingFollowups.integration.test.ts
 *
 * The expectations live in billing_followups.test.sql beside this file: admin_funnel()'s active
 * count (the basis of MRR) leaves out admins' plans and plans linked to nobody; it seeds in one
 * transaction and rolls back. Needs `psql` on the PATH and the local stack's Postgres.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SQL = fileURLToPath(new URL("./billing_followups.test.sql", import.meta.url));

suite("the billing follow-ups migration (live Postgres)", () => {
  it("meets every expectation in billing_followups.test.sql, and leaves nothing behind", () => {
    const out = execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-f", SQL], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(out).toContain("billing_followups: all expectations met");
    const left = execFileSync("psql", [DB_URL, "-At", "-c", "select count(*) from auth.users where email like 'followups-test-%'"], { encoding: "utf8" });
    expect(left.trim()).toBe("0");
  }, 60_000);
});
