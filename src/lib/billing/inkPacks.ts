/**
 * The ink packs as the UI shows them: the `ink_packs` catalogue (supabase/migrations/
 * 20261002000000_ink.sql), each pack's price and how much ink a dollar buys, and where its buy
 * button goes. No React, no network; unit-tested in __tests__/inkPacks.test.ts.
 *
 * Loaded with the account page and the lazy out-of-ink dialog, never in the board's first load.
 */

import { z } from "zod";
import type { BillingLinks } from "@/lib/billing/checkout";
import { formatInk, inkLabel } from "@/lib/billing/inkSummary";

const count = z.coerce.number().finite();

export const InkPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  ink: count,
  price_cents: count,
  sort: count.default(0),
  active: z.boolean().optional(),
});

export type InkPack = z.infer<typeof InkPackSchema>;

/** Rows from `ink_packs`; malformed rows are dropped rather than crashing the page. */
export function parseInkPacks(payload: unknown): InkPack[] {
  if (!Array.isArray(payload)) return [];
  const out: InkPack[] = [];
  for (const row of payload) {
    const parsed = InkPackSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** "$5", "$20", "$4.50": whole dollars without cents. */
export function formatPrice(priceCents: number): string {
  if (!Number.isFinite(priceCents) || priceCents < 0) return "$0";
  const dollars = priceCents / 100;
  return `$${Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2)}`;
}

/** Ink per dollar, rounded to a whole number (Small 200, Medium 250, Large 280). */
export function inkPerDollar(pack: Pick<InkPack, "ink" | "price_cents">): number {
  if (!(pack.price_cents > 0)) return 0;
  return Math.round(pack.ink / (pack.price_cents / 100));
}

export type PackCard = {
  id: string;
  /** "Medium" */
  name: string;
  ink: number;
  /** "5,000 ink" */
  inkLabel: string;
  /** "$20" */
  price: string;
  /** "250 ink per $1" */
  value: string;
  /** "+25% ink per $1", against the pack with the least ink per dollar; null for that pack. */
  bonus: string | null;
  /** The pack with the most ink per dollar (when packs differ at all). */
  bestValue: boolean;
  /** Its Payment Link for this user (checkout.ts payerLinks), or null: a disabled "Coming soon". */
  href: string | null;
};

/**
 * Cards for the active packs, smallest first (`sort`, then ink). `links` must already carry the
 * user (checkout.ts payerLinks); a pack without one is shown with a disabled "Coming soon".
 */
export function packCardsFor(packs: ReadonlyArray<InkPack>, links: BillingLinks = {}): PackCard[] {
  const active = packs.filter((p) => p.active !== false && p.ink > 0 && p.price_cents > 0);
  active.sort((a, b) => a.sort - b.sort || a.ink - b.ink);
  const rates = active.map(inkPerDollar);
  const base = rates.length ? Math.min(...rates) : 0;
  const best = rates.length ? Math.max(...rates) : 0;
  return active.map((pack, i) => {
    const rate = rates[i];
    const bonus = base > 0 && rate > base ? Math.round(((rate - base) / base) * 100) : 0;
    return {
      id: pack.id,
      name: pack.name,
      ink: pack.ink,
      inkLabel: inkLabel(pack.ink),
      price: formatPrice(pack.price_cents),
      value: `${formatInk(rate)} ink per $1`,
      bonus: bonus > 0 ? `+${bonus}% ink per $1` : null,
      bestValue: best > base && rate === best,
      href: links[pack.id] ?? null,
    };
  });
}

/** True when no pack can be bought here (NEXT_PUBLIC_BILLING_LINKS unset): the grid says so once. */
export function allComingSoon(cards: ReadonlyArray<PackCard>): boolean {
  return cards.length > 0 && cards.every((c) => !c.href);
}

export const PACKS_COPY = {
  title: "Ink packs",
  description: "Ink never expires. Buy once, use it whenever the tutor helps.",
  buy: (price: string) => `Buy for ${price}`,
  comingSoon: "Coming soon",
  comingSoonNote: "Ink packs aren't on sale yet. Your starter ink works in the meantime.",
  bestValue: "Best value",
  newTab: "Checkout opens in a new tab, so your board stays right where it is.",
  loadFailedTitle: "Couldn't load the ink packs",
  loadFallback: "The pack list didn't arrive. Retry in a moment.",
} as const;
