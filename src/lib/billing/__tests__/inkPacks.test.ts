import { describe, expect, it } from "vitest";
import { PACKS } from "../../../../scripts/stripe-setup.mjs";
import { PACKS_COPY, allComingSoon, formatPrice, inkPerDollar, packCardsFor, parseInkPacks } from "../inkPacks";

/** The ink_packs rows as PostgREST returns them (the migration's seed). */
const ROWS = [
  { id: "large", name: "Large", ink: 14000, price_cents: 5000, sort: 3, active: true },
  { id: "small", name: "Small", ink: 1000, price_cents: 500, sort: 1, active: true },
  { id: "medium", name: "Medium", ink: 5000, price_cents: 2000, sort: 2, active: true },
];

const LINKS = {
  small: "https://buy.stripe.com/s?client_reference_id=u",
  medium: "https://buy.stripe.com/m?client_reference_id=u",
  large: "https://buy.stripe.com/l?client_reference_id=u",
};

describe("parseInkPacks", () => {
  it("keeps well-formed rows, coerces numeric strings and drops junk", () => {
    expect(parseInkPacks([{ ...ROWS[1], ink: "1000" }, { id: "x" }, null, "row"])).toEqual([{ ...ROWS[1], ink: 1000 }]);
    expect(parseInkPacks({ rows: ROWS })).toEqual([]);
  });
});

describe("prices and value", () => {
  it("formats prices in whole dollars, cents only when needed", () => {
    expect(formatPrice(500)).toBe("$5");
    expect(formatPrice(5000)).toBe("$50");
    expect(formatPrice(450)).toBe("$4.50");
    expect(formatPrice(Number.NaN)).toBe("$0");
  });

  it("says how much ink a dollar buys", () => {
    expect(ROWS.map(inkPerDollar)).toEqual([280, 200, 250]);
    expect(inkPerDollar({ ink: 10, price_cents: 0 })).toBe(0);
  });
});

describe("packCardsFor", () => {
  it("smallest first, each with its price, ink per dollar, bonus over Small, and its link", () => {
    expect(packCardsFor(parseInkPacks(ROWS), LINKS)).toEqual([
      { id: "small", name: "Small", ink: 1000, inkLabel: "1,000 ink", price: "$5", value: "200 ink per $1", bonus: null, bestValue: false, href: LINKS.small },
      { id: "medium", name: "Medium", ink: 5000, inkLabel: "5,000 ink", price: "$20", value: "250 ink per $1", bonus: "+25% ink per $1", bestValue: false, href: LINKS.medium },
      { id: "large", name: "Large", ink: 14000, inkLabel: "14,000 ink", price: "$50", value: "280 ink per $1", bonus: "+40% ink per $1", bestValue: true, href: LINKS.large },
    ]);
  });

  it("without links every pack is 'Coming soon' (href null), and the grid can say so once", () => {
    const cards = packCardsFor(parseInkPacks(ROWS));
    expect(cards.every((c) => c.href === null)).toBe(true);
    expect(allComingSoon(cards)).toBe(true);
    expect(allComingSoon(packCardsFor(parseInkPacks(ROWS), { small: LINKS.small }))).toBe(false);
    expect(allComingSoon([])).toBe(false);
    expect(PACKS_COPY.comingSoon).toBe("Coming soon");
  });

  it("leaves out inactive and nonsensical packs", () => {
    const cards = packCardsFor(parseInkPacks([...ROWS, { id: "old", name: "Old", ink: 10, price_cents: 100, sort: 0, active: false }, { id: "free", name: "Free", ink: 10, price_cents: 0 }]), LINKS);
    expect(cards.map((c) => c.id)).toEqual(["small", "medium", "large"]);
  });

  it("a single pack is not 'best value' and has no bonus", () => {
    expect(packCardsFor(parseInkPacks([ROWS[0]]), LINKS)).toEqual([expect.objectContaining({ id: "large", bonus: null, bestValue: false })]);
  });

  it("the catalogue the app shows is the one Stripe charges (scripts/stripe-setup.mjs PACKS)", () => {
    expect(packCardsFor(parseInkPacks(ROWS)).map((c) => [c.id, c.ink, c.price])).toEqual(
      PACKS.map((p: { id: string; ink: number; priceCents: number }) => [p.id, p.ink, formatPrice(p.priceCents)]),
    );
  });
});
