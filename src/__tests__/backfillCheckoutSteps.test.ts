/**
 * scripts/backfill-checkout-steps.mjs: Stripe's Checkout Sessions (as `stripe checkout sessions
 * list` prints them) to the one SQL statement that back-fills `checkout_opened`. Which sessions
 * count, and that the statement joins the references to profiles itself, keeps an existing row's
 * meta and widens it rather than adding to it, and carries nothing but references and times. No
 * database here: the statement was run against the local stack by hand (inside begin … rollback).
 */
import { describe, expect, it } from "vitest";
import { BACKFILL_META, backfillSql, checkoutRows, sessionsOf } from "../../scripts/backfill-checkout-steps.mjs";

const REF_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const REF_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
/** 2026-10-01T12:00:00Z and a day after */
const T1 = 1_790_856_000;
const T2 = T1 + 86_400;

const session = (id: string, ref: unknown, created: unknown = T1, extra: Record<string, unknown> = {}) => ({ id, object: "checkout.session", status: "expired", client_reference_id: ref, created, ...extra });

describe("sessionsOf", () => {
  it("takes the list's data, a bare list, and nothing from anything else", () => {
    const s = session("cs_1", REF_A);
    expect(sessionsOf({ object: "list", data: [s], has_more: false })).toEqual([s]);
    expect(sessionsOf([s])).toEqual([s]);
    for (const junk of [null, "x", 3, {}, { data: "nope" }]) expect(sessionsOf(junk)).toEqual([]);
  });
});

describe("checkoutRows", () => {
  it("one row per session with a uuid reference: the reference in lower case, the time in UTC", () => {
    const { rows, skipped } = checkoutRows([session("cs_1", REF_A.toUpperCase(), T1), session("cs_2", ` ${REF_B} `, T2)]);
    expect(rows).toEqual([
      { ref: REF_A, created: "2026-10-01T12:00:00.000Z" },
      { ref: REF_B, created: "2026-10-02T12:00:00.000Z" },
    ]);
    expect(skipped).toBe(0);
  });

  it("skips a session without a uuid reference or a creation time", () => {
    const { rows, skipped } = checkoutRows([
      session("cs_1", null),
      session("cs_2", "not-a-uuid"),
      session("cs_3", "user_123"),
      session("cs_4", REF_A, "1790856000"),
      session("cs_5", REF_A, 0),
      session("cs_6", REF_A, Number.NaN),
      null,
      "cs_7",
      session("cs_8", REF_A),
    ]);
    expect(rows).toEqual([{ ref: REF_A, created: "2026-10-01T12:00:00.000Z" }]);
    expect(skipped).toBe(8);
  });

  it("counts a session listed twice (overlapping pages) once", () => {
    const { rows } = checkoutRows([...sessionsOf({ data: [session("cs_1", REF_A), session("cs_2", REF_A, T2)] }), ...sessionsOf({ data: [session("cs_2", REF_A, T2)] })]);
    expect(rows).toHaveLength(2);
  });
});

describe("backfillSql", () => {
  it("nothing to back-fill: null", () => {
    expect(backfillSql([])).toBeNull();
    expect(backfillSql([{ ref: "nope'); drop table profiles; --", created: "2026-10-01T12:00:00.000Z" }])).toBeNull();
  });

  it("one statement: every session a (ref, created) value, joined to profiles by checkout_ref, counted per account", () => {
    const sql = backfillSql([
      { ref: REF_A, created: "2026-10-01T12:00:00.000Z" },
      { ref: REF_A, created: "2026-10-02T12:00:00.000Z" },
      { ref: REF_B, created: "2026-10-03T08:30:00.000Z" },
    ])!;
    expect(sql).toContain(`('${REF_A}'::uuid, '2026-10-01T12:00:00.000Z'::timestamptz)`);
    expect(sql).toContain(`('${REF_A}'::uuid, '2026-10-02T12:00:00.000Z'::timestamptz)`);
    expect(sql).toContain(`('${REF_B}'::uuid, '2026-10-03T08:30:00.000Z'::timestamptz)`);
    expect(sql).toMatch(/join public\.profiles p on p\.checkout_ref = s\.ref/);
    expect(sql).toMatch(/min\(s\.created\) as first_at/);
    expect(sql).toMatch(/max\(s\.created\) as last_at/);
    expect(sql).toMatch(/least\(count\(\*\), 10000\)::integer as times/);
    expect(sql).toMatch(/group by p\.user_id/);
    expect(sql).toContain("-- 3 sessions, 2 checkout references.");
    // one statement: no semicolon but the last
    expect(sql.trim().split(";").filter((part) => part.trim() !== "")).toHaveLength(1);
    expect(sql.trim().endsWith(";")).toBe(true);
  });

  it("idempotent: an existing row is widened, never added to, and keeps its meta", () => {
    const sql = backfillSql([{ ref: REF_A, created: "2026-10-01T12:00:00.000Z" }])!;
    expect(sql).toContain("'checkout_opened'");
    expect(sql).toContain(`'${BACKFILL_META}'::jsonb`);
    expect(JSON.parse(BACKFILL_META)).toEqual({ source: "stripe" });
    expect(sql).toMatch(/on conflict \(user_id, step\) do update/);
    expect(sql).toMatch(/first_at = least\(f\.first_at, excluded\.first_at\)/);
    expect(sql).toMatch(/last_at = greatest\(f\.last_at, excluded\.last_at\)/);
    expect(sql).toMatch(/times = greatest\(f\.times, excluded\.times\)/);
    const update = sql.slice(sql.indexOf("do update"), sql.indexOf("returning"));
    expect(update).not.toMatch(/meta/);
    expect(update).not.toMatch(/\+/);
  });

  it("carries nothing from a session but its reference and time", () => {
    const { rows } = checkoutRows([session("cs_secret_1", REF_A, T1, { customer_details: { email: "parent@example.com", name: "Pat Parent" }, amount_total: 2500 })]);
    const sql = backfillSql(rows)!;
    expect(sql).not.toContain("parent@example.com");
    expect(sql).not.toContain("Pat Parent");
    expect(sql).not.toContain("cs_secret_1");
    expect(sql).not.toContain("2500");
  });
});
