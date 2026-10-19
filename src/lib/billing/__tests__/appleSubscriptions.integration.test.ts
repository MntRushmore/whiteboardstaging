/**
 * Agathon Unlimited through Apple (supabase/migrations/20261017200000_apple_subscriptions.sql) against
 * a LIVE Postgres (normally the local Supabase stack). Opt-in, like the other database suites: runs
 * only when RUN_DB_TESTS=1.
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/billing/__tests__/appleSubscriptions.integration.test.ts
 *
 * The expectations live in apple_subscriptions.test.sql beside this file: apply_apple_subscription()
 * links by the purchase's appAccountToken through the family, refuses another account's purchase,
 * orders payloads by the App Store's signedDate (an older one never overwrites a newer state), maps
 * every notification's resulting state onto has_unlimited() for the grown-up and the kid, moves the
 * referral, and an Apple plan does not block delete_own_account() while a Stripe one still does. It
 * seeds in one transaction and rolls back. Needs `psql` on the PATH and the local stack's Postgres.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SQL = fileURLToPath(new URL("./apple_subscriptions.test.sql", import.meta.url));

suite("Agathon Unlimited through Apple (live Postgres)", () => {
  it("meets every expectation in apple_subscriptions.test.sql, and leaves nothing behind", () => {
    const out = execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-f", SQL], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(out).toContain("apple_subscriptions: all expectations met");
    const left = execFileSync("psql", [DB_URL, "-At", "-c", "select count(*) from auth.users where email like 'apple-test-%'"], { encoding: "utf8" });
    expect(left.trim()).toBe("0");
  }, 60_000);
});
