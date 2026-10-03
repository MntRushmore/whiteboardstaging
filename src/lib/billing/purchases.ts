/**
 * Purchase history for the account page: the student's own `ink_purchases` rows (RLS: owner
 * select), newest first, in plain words. No React, no network; unit-tested in
 * __tests__/purchases.test.ts.
 */

import { z } from "zod";
import { formatInk } from "@/lib/billing/inkSummary";
import { formatPrice } from "@/lib/billing/inkPacks";

const count = z.coerce.number().finite();

/** The columns the history reads (the select in PurchaseHistory.tsx). */
export const PURCHASE_COLUMNS = "id,pack_id,ink,amount_cents,currency,status,refunded_ink,refund_unrecovered_ink,created_at";

export const PurchaseRowSchema = z.object({
  id: count,
  pack_id: z.string(),
  ink: count,
  amount_cents: count,
  currency: z.string(),
  status: z.enum(["paid", "partially_refunded", "refunded"]),
  refunded_ink: count,
  refund_unrecovered_ink: count.default(0),
  created_at: z.string(),
});

export type PurchaseRow = z.infer<typeof PurchaseRowSchema>;

/** Rows from `ink_purchases`; malformed rows are dropped rather than crashing the card. */
export function parsePurchases(payload: unknown): PurchaseRow[] {
  if (!Array.isArray(payload)) return [];
  const out: PurchaseRow[] = [];
  for (const row of payload) {
    const parsed = PurchaseRowSchema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export type PurchaseLine = {
  id: number;
  /** "Oct 2, 2026" in the browser's zone. */
  date: string;
  /** "Medium pack" (the pack's current name; its id when the pack is gone). */
  pack: string;
  /** "+5,000 ink" */
  ink: string;
  /** "$20" (other currencies keep their code: "20.00 EUR") */
  amount: string;
  status: "paid" | "partially_refunded" | "refunded";
  /** "Paid" | "Refunded" | "Partly refunded" */
  statusLabel: string;
  /** For a refund: what happened to the ink, e.g. "4,000 ink taken back; 1,000 had been used". */
  refundNote: string | null;
};

const DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

function amountLabel(cents: number, currency: string): string {
  if (currency.toLowerCase() === "usd") return formatPrice(cents);
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/** One line per purchase, newest first; `packNames` maps pack ids to names (`ink_packs`). */
export function purchaseLinesFor(
  rows: ReadonlyArray<PurchaseRow>,
  packNames: Readonly<Record<string, string>> = {},
  timeZone?: string,
): PurchaseLine[] {
  return [...rows]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)
    .map((row) => {
      const when = new Date(row.created_at);
      const refunded = row.status !== "paid";
      const back = row.refunded_ink;
      const used = row.refund_unrecovered_ink;
      return {
        id: row.id,
        date: Number.isNaN(when.getTime()) ? "" : when.toLocaleDateString("en-US", { ...DATE, ...(timeZone ? { timeZone } : {}) }),
        pack: `${packNames[row.pack_id] ?? row.pack_id} pack`,
        ink: `+${formatInk(row.ink)} ink`,
        amount: amountLabel(row.amount_cents, row.currency),
        status: row.status,
        statusLabel: row.status === "paid" ? "Paid" : row.status === "refunded" ? "Refunded" : "Partly refunded",
        refundNote: refunded
          ? used > 0
            ? `${formatInk(back)} ink taken back; ${formatInk(used)} had already been used`
            : `${formatInk(back)} ink taken back`
          : null,
      };
    });
}

export const PURCHASES_COPY = {
  title: "Purchases",
  description: "Every ink pack you've bought.",
  empty: "No purchases yet",
  emptyHint: "Packs you buy show up here, with any refund.",
  failedTitle: "Couldn't load your purchases",
  fallback: "The purchase list didn't arrive. Retry in a moment.",
} as const;
