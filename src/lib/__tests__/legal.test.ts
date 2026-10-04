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
};

describe("legal config", () => {
  it("recognises [square bracket] placeholders only", () => {
    expect(isPlaceholder("[Legal entity name]")).toBe(true);
    expect(isPlaceholder(" [x] ")).toBe(true);
    expect(isPlaceholder("Example Co")).toBe(false);
    expect(isPlaceholder("Fuime [beta]")).toBe(false);
  });

  it("names the operator the owner gave (2026-10-03), with no placeholder left", () => {
    expect(unfilledLegalFields()).toEqual([]);
    expect(LEGAL.operatorName).toBe("Ninth Street Labs");
    expect(LEGAL.contactEmail).toBe("rushil@ninthstreetlabs.com");
    expect(LEGAL.governingLaw).toMatch(/California/);
    // published as final by the owner: no Draft notice
    expect(isDraft()).toBe(false);
  });

  it("is a draft until every placeholder is filled and it has been reviewed", () => {
    expect(isDraft({ ...LEGAL, operatorName: "[Legal entity name]", reviewed: true })).toBe(true);
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
    expect(LEGAL.unlimited).toEqual({ fairUseActionsPerDay: 1_500, refundWindowDays: 14, priceChangeNoticeDays: 7 });
  });
});
