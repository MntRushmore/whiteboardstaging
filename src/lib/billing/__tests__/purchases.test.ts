import { describe, expect, it } from "vitest";
import { PURCHASES_COPY, PURCHASE_COLUMNS, parsePurchases, purchaseLinesFor } from "../purchases";

const PAID = { id: 1, pack_id: "small", ink: 1000, amount_cents: 500, currency: "usd", status: "paid", refunded_ink: 0, refund_unrecovered_ink: 0, created_at: "2026-09-30T15:00:00+00:00" };
const REFUNDED = { id: 2, pack_id: "medium", ink: 5000, amount_cents: 2000, currency: "usd", status: "refunded", refunded_ink: 4000, refund_unrecovered_ink: 1000, created_at: "2026-10-02T15:00:00+00:00" };
const PARTIAL = { id: 3, pack_id: "large", ink: 14000, amount_cents: 5000, currency: "eur", status: "partially_refunded", refunded_ink: 7000, refund_unrecovered_ink: 0, created_at: "2026-10-01T15:00:00+00:00" };
const NAMES = { small: "Small", medium: "Medium", large: "Large" };

describe("parsePurchases", () => {
  it("keeps well-formed rows and drops the rest (an unknown status, missing fields)", () => {
    expect(parsePurchases([PAID, { ...PAID, id: 9, status: "pending" }, { id: 4 }, null])).toEqual([PAID]);
    expect(parsePurchases(undefined)).toEqual([]);
  });
  it("selects exactly the columns the schema reads", () => {
    expect(PURCHASE_COLUMNS.split(",").sort()).toEqual(["amount_cents", "created_at", "currency", "id", "ink", "pack_id", "refund_unrecovered_ink", "refunded_ink", "status"]);
  });
});

describe("purchaseLinesFor", () => {
  it("newest first, in plain words, with what a refund did to the ink", () => {
    const lines = purchaseLinesFor(parsePurchases([PAID, REFUNDED, PARTIAL]), NAMES, "UTC");
    expect(lines).toEqual([
      {
        id: 2,
        date: "Oct 2, 2026",
        pack: "Medium pack",
        ink: "+5,000 ink",
        amount: "$20",
        status: "refunded",
        statusLabel: "Refunded",
        refundNote: "4,000 ink taken back; 1,000 had already been used",
      },
      { id: 3, date: "Oct 1, 2026", pack: "Large pack", ink: "+14,000 ink", amount: "50.00 EUR", status: "partially_refunded", statusLabel: "Partly refunded", refundNote: "7,000 ink taken back" },
      { id: 1, date: "Sep 30, 2026", pack: "Small pack", ink: "+1,000 ink", amount: "$5", status: "paid", statusLabel: "Paid", refundNote: null },
    ]);
  });

  it("names a pack that is no longer in the catalogue by its id", () => {
    expect(purchaseLinesFor(parsePurchases([{ ...PAID, pack_id: "mini" }]), NAMES, "UTC")[0].pack).toBe("mini pack");
  });

  it("has words for an empty history", () => {
    expect(purchaseLinesFor([], NAMES)).toEqual([]);
    expect(PURCHASES_COPY.empty).toBe("No purchases yet");
  });
});
