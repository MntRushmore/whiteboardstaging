import { describe, expect, it } from "vitest";
import {
  ACCOUNT_PATH,
  FULL_BOTTLE_INK,
  INK_COPY,
  BILLING_PATH,
  LOW_INK,
  bottleFill,
  formatInk,
  inkLabel,
  inkTone,
  parseInkSummary,
} from "../inkSummary";

/** What ink_summary() returns for a student who bought a Medium pack and has used some. */
const SUMMARY = {
  balance: 4870,
  granted: 5300,
  purchased: 5000,
  refunded: 0,
  used: 430,
  starter: 300,
  starter_at: "2026-10-02T12:00:00+00:00",
  purchases: 1,
  last_purchase: { id: 7, pack_id: "medium", pack_name: "Medium", ink: 5000, amount_cents: 2000, currency: "usd", status: "paid", refunded_ink: 0, created_at: "2026-10-02T12:30:00+00:00" },
};

describe("parseInkSummary", () => {
  it("reads the jsonb object and a one-row array, coercing numeric strings", () => {
    expect(parseInkSummary(SUMMARY)).toMatchObject({ balance: 4870, used: 430, last_purchase: { pack_id: "medium", ink: 5000 } });
    expect(parseInkSummary([{ ...SUMMARY, balance: "12" }])?.balance).toBe(12);
    expect(parseInkSummary({ ...SUMMARY, last_purchase: null, starter_at: null })).toMatchObject({ last_purchase: null, starter_at: null });
  });

  it("is null for an empty or malformed payload (the meter then shows nothing)", () => {
    for (const payload of [null, undefined, 5, "x", [], {}, { balance: 3 }, { ...SUMMARY, balance: "lots" }]) {
      expect(parseInkSummary(payload), JSON.stringify(payload)).toBeNull();
    }
  });
});

describe("formatting", () => {
  it("whole ink with separators; ink is a mass noun", () => {
    expect(formatInk(14000)).toBe("14,000");
    expect(formatInk(12.6)).toBe("13");
    expect(formatInk(Number.NaN)).toBe("0");
    expect(formatInk(undefined)).toBe("0");
    expect(inkLabel(1)).toBe("1 ink");
    expect(inkLabel(1645)).toBe("1,645 ink");
    expect(INK_COPY.meterLabel(300)).toBe("300 ink left");
  });

  it("links to the account page and its Billing section", () => {
    expect(ACCOUNT_PATH).toBe("/account");
    expect(BILLING_PATH).toBe("/account#billing");
  });
});

describe("inkTone", () => {
  it("is empty at zero, low under LOW_INK, ok otherwise; nothing to warn about without a balance", () => {
    expect(LOW_INK).toBe(100);
    expect(inkTone(0)).toBe("empty");
    expect(inkTone(-3)).toBe("empty");
    expect(inkTone(1)).toBe("low");
    expect(inkTone(99)).toBe("low");
    expect(inkTone(100)).toBe("ok");
    expect(inkTone(300)).toBe("ok");
    expect(inkTone(null)).toBe("ok");
    expect(inkTone(undefined)).toBe("ok");
    expect(inkTone(Number.NaN)).toBe("ok");
  });
});

describe("bottleFill", () => {
  it("is 0 only with no ink, full at FULL_BOTTLE_INK and above", () => {
    expect(bottleFill(0)).toBe(0);
    expect(bottleFill(-5)).toBe(0);
    expect(bottleFill(undefined)).toBe(0);
    expect(bottleFill(FULL_BOTTLE_INK)).toBe(1);
    expect(bottleFill(14000)).toBe(1);
  });

  it("reads the starter as about half a bottle and a little ink as visibly some", () => {
    expect(bottleFill(300)).toBeCloseTo(0.548, 2);
    expect(bottleFill(LOW_INK)).toBeCloseTo(0.316, 2);
    expect(bottleFill(1)).toBe(0.08); // never so little that it looks empty
  });

  it("only ever grows with the balance", () => {
    let last = -1;
    for (let ink = 0; ink <= 1200; ink += 7) {
      const f = bottleFill(ink);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
  });
});
