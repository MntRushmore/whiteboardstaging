/**
 * The onboarding's funnel steps (src/lib/funnel/steps.ts): which names are steps, and the small
 * details (`meta`) the database takes, cut down by `cleanMeta` rather than refused.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanMeta, FUNNEL_STEPS, isFunnelStep, RECORD_FUNNEL_STEP } from "../steps";

describe("isFunnelStep", () => {
  it("knows every step, and nothing else", () => {
    for (const step of FUNNEL_STEPS) expect(isFunnelStep(step), step).toBe(true);
    for (const other of ["", "plan_seen", "Plan_shown", " plan_shown", "signed_up", "trial_started", null, undefined, 3, {}, ["plan_shown"]]) {
      expect(isFunnelStep(other), String(other)).toBe(false);
    }
  });

  it("names the same 15 steps as the table's check (the newest migration that writes it), once each", () => {
    expect(FUNNEL_STEPS).toHaveLength(15);
    expect(new Set(FUNNEL_STEPS).size).toBe(FUNNEL_STEPS.length);
    // each new step rewrites the check in a migration of its own (try_board, free_board_done): the last one is the table's
    const dir = new URL("../../../../supabase/migrations/", import.meta.url);
    const checks = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(new URL(f, dir), "utf8").match(/funnel_steps_step_known check \(step in \(([\s\S]*?)\)\)/)?.[1])
      .filter((c): c is string => Boolean(c));
    const check = checks.at(-1) ?? "";
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...FUNNEL_STEPS]);
    const sql = readFileSync(new URL("20261012020000_funnel_steps.sql", dir), "utf8");
    expect(RECORD_FUNNEL_STEP).toBe("record_funnel_step");
    expect(sql).toContain(`function public.${RECORD_FUNNEL_STEP}(p_step text, p_meta jsonb default null)`);
  });
});

describe("cleanMeta", () => {
  it("keeps strings, finite numbers, booleans and null", () => {
    expect(cleanMeta({ view: "offer", step: 2, kid: true, grade: null, ratio: -0.5 })).toEqual({ view: "offer", step: 2, kid: true, grade: null, ratio: -0.5 });
  });

  it("drops what the database would not take: nested values, undefined, functions, NaN and Infinity", () => {
    expect(
      cleanMeta({
        view: "offer",
        nested: { a: 1 },
        list: ["a"],
        missing: undefined,
        fn: () => 1,
        nan: Number.NaN,
        inf: Number.POSITIVE_INFINITY,
        negInf: Number.NEGATIVE_INFINITY,
        big: BigInt(1),
      }),
    ).toEqual({ view: "offer" });
  });

  it("drops keys that are not identifiers", () => {
    expect(cleanMeta({ "bad key": 1, "1st": 1, _private: 1, "a-b": 1, Upper: 1, ["x".repeat(33)]: 1, ok_key: 1, camelCase9: 2 })).toEqual({ ok_key: 1, camelCase9: 2 });
  });

  it("cuts a string to 80 characters", () => {
    const out = cleanMeta({ why: "x".repeat(200), short: "fine" });
    expect(out?.why).toBe("x".repeat(80));
    expect(out?.short).toBe("fine");
  });

  it("keeps at most 8 keys, counting only the ones kept", () => {
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(cleanMeta(many) ?? {})).toEqual(["k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7"]);
    const withDropped = { a: { nested: true }, b: undefined, ...many };
    expect(Object.keys(cleanMeta(withDropped) ?? {})).toHaveLength(8);
  });

  it("is null when nothing is left, or there was nothing", () => {
    expect(cleanMeta({})).toBeNull();
    expect(cleanMeta({ nested: {}, gone: undefined, "bad key": 1 })).toBeNull();
    expect(cleanMeta(null)).toBeNull();
    expect(cleanMeta(undefined)).toBeNull();
    expect(cleanMeta("offer" as unknown as Record<string, unknown>)).toBeNull();
  });

  it("the most it keeps of plain text fits the table's 1,000 bytes", () => {
    const longest = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${String(i).padStart(2, "0")}${"x".repeat(29)}`, "y".repeat(200)]));
    const out = cleanMeta(longest) ?? {};
    expect(Object.keys(out)).toHaveLength(8);
    expect(Object.keys(out).every((k) => k.length === 32)).toBe(true);
    // what the table measures is the jsonb's text, which puts a space after each ':' and ','
    const asJsonbText = JSON.stringify(out).length + 2 * Object.keys(out).length;
    expect(asJsonbText).toBeLessThanOrEqual(1000);
  });

  it("drops the last keys while long non-ASCII text would still be over the table's 1,000 bytes", () => {
    const wide = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, "数".repeat(80)]));
    const out = cleanMeta(wide) ?? {};
    // Postgres measures four of these at exactly 1,000 bytes (allowed) and five over it
    expect(Object.keys(out)).toEqual(["k0", "k1", "k2", "k3"]);
    expect(cleanMeta({ ...wide, k0: `${"数".repeat(79)}x` })).toHaveProperty("k3");
  });
});
