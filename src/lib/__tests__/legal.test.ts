/**
 * The legal pages' one config (src/lib/legal.ts): placeholders are recognisable, and the pages say
 * "Draft" until every placeholder is filled AND `reviewed` is set.
 */
import { describe, expect, it } from "vitest";
import { isDraft, isPlaceholder, LEGAL, unfilledLegalFields } from "../legal";

const FILLED = {
  ...LEGAL,
  operatorName: "Example Co",
  postalAddress: "1 Example St",
  contactEmail: "help@example.com",
  contactPhone: "+1 555 0100",
  governingLaw: "the State of Example",
  disputeVenue: "the courts of Example County",
  effectiveDate: "January 1, 2027",
  aiProviderTraining: "Our settings do not allow these services to train their models on what we send.",
};

describe("legal config", () => {
  it("recognises [square bracket] placeholders only", () => {
    expect(isPlaceholder("[Legal entity name]")).toBe(true);
    expect(isPlaceholder(" [x] ")).toBe(true);
    expect(isPlaceholder("Example Co")).toBe(false);
    expect(isPlaceholder("Fuime [beta]")).toBe(false);
  });

  it("ships with the operator fields as placeholders, never invented values", () => {
    expect(unfilledLegalFields().sort()).toEqual(
      ["aiProviderTraining", "contactEmail", "contactPhone", "disputeVenue", "effectiveDate", "governingLaw", "operatorName", "postalAddress"].sort(),
    );
    expect(LEGAL.contactEmail).not.toMatch(/@/);
  });

  it("is a draft until every placeholder is filled and it has been reviewed", () => {
    expect(isDraft()).toBe(true);
    expect(isDraft({ ...LEGAL, reviewed: true })).toBe(true);
    expect(isDraft({ ...FILLED, reviewed: false })).toBe(true);
    expect(isDraft({ ...FILLED, reviewed: true })).toBe(false);
  });

  it("states the ink packs on sale and the refund window", () => {
    expect(LEGAL.inkPacks).toEqual([
      { ink: 1_000, priceUsd: 5 },
      { ink: 5_000, priceUsd: 20 },
      { ink: 14_000, priceUsd: 50 },
    ]);
    expect(LEGAL.refundWindowDays).toBe(14);
    expect(LEGAL.stripeSellerName).toBe("Fuime");
  });

  it("states Agathon Unlimited's own terms (the price and the free week are UNLIMITED_PLAN's)", () => {
    expect(LEGAL.unlimited).toEqual({ fairUseActionsPerDay: 1_500, refundWindowDays: 7, priceChangeNoticeDays: 7 });
  });
});
