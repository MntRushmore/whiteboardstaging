/**
 * admin_funnel() against a LIVE Postgres (normally the local Supabase stack). Opt-in, like the other
 * database suites: runs only when RUN_DB_TESTS=1.
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/funnel/__tests__/adminFunnel.integration.test.ts
 *
 * The expectations live in admin_funnel.test.sql beside this file, which seeds accounts in one
 * transaction, checks every stage, the time zone, kids, admins and the grants, and rolls back.
 * Needs `psql` on the PATH and the local stack's Postgres (port 54322).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SQL = fileURLToPath(new URL("./admin_funnel.test.sql", import.meta.url));

suite("admin_funnel (live Postgres)", () => {
  it("meets every expectation in admin_funnel.test.sql, and leaves nothing behind", () => {
    const out = execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-f", SQL], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(out).toContain("admin_funnel: all expectations met");
    const left = execFileSync("psql", [DB_URL, "-At", "-c", "select count(*) from auth.users where email like 'funnel-test-%'"], { encoding: "utf8" });
    expect(left.trim()).toBe("0");
  }, 60_000);
});
