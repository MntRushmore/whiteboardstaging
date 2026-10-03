/**
 * The student's ink as the UI sees it: the `ink_summary()` payload, its tone (fine, low, out) and
 * how full the ink bottle looks. No React, no network, no browser APIs at module scope;
 * unit-tested in __tests__/inkSummary.test.ts.
 *
 * Small on purpose: the ink meter puts this module in the board's first load. The packs
 * (inkPacks.ts), the purchase history (purchases.ts) and the out-of-ink words (outOfInk.ts) load
 * with the account page or the lazy dialog.
 *
 * Ink is the unit. It never expires: 300 starter ink once, packs on top, every AI action spends
 * some (ROUTE_COSTS in src/lib/server/billing.ts). supabase/migrations/20261002000000_ink.sql has
 * the ledger behind these numbers.
 */

import { z } from "zod";

/** Path of the account page every ink surface links to. */
export const ACCOUNT_PATH = "/account";
/** The packs on the account page (the header meter's "Get ink"). */
export const INK_PACKS_PATH = "/account#ink-packs";

/**
 * PostgREST returns `numeric` as strings and `integer` as numbers; coerce so the view never does
 * arithmetic on a string.
 */
const count = z.coerce.number().finite();

const LastPurchaseSchema = z.object({
  pack_id: z.string(),
  pack_name: z.string(),
  ink: count,
  status: z.string(),
  created_at: z.string(),
});

export const InkSummarySchema = z.object({
  /** Ink left. */
  balance: count,
  /** All ink ever granted (starter, purchases, manual grants), net of refund reversals. */
  granted: count,
  /** Ink bought in packs (before refunds). */
  purchased: count,
  /** Ink taken back by refunds. */
  refunded: count,
  /** All ink ever spent (granted - balance). */
  used: count,
  /** The starter grant (300 for a new account; a beta account's carry-over may be more). */
  starter: count,
  starter_at: z.string().nullable(),
  /** How many packs were bought. */
  purchases: count,
  last_purchase: LastPurchaseSchema.nullable(),
});

export type InkSummary = z.infer<typeof InkSummarySchema>;

/**
 * `ink_summary()` comes back as one jsonb object (or, defensively, a one-row array). Null when
 * the payload is empty or malformed.
 */
export function parseInkSummary(payload: unknown): InkSummary | null {
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object") return null;
  const parsed = InkSummarySchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

/** Whole ink with thousands separators; anything non-finite renders as "0". */
export function formatInk(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

/** "1,234 ink" (ink is a mass noun: "1 ink", never "1 inks"). */
export function inkLabel(n: number | null | undefined): string {
  return `${formatInk(n)} ink`;
}

export type InkTone = "ok" | "low" | "empty";

/**
 * Under this much ink the meter turns a calm amber and offers "Get ink": about ten worked
 * solutions, or a few minutes of steady checking.
 */
export const LOW_INK = 100;

/** 'empty' at zero, 'low' under LOW_INK, else 'ok'. No balance yet means nothing to warn about. */
export function inkTone(balance: number | null | undefined): InkTone {
  if (typeof balance !== "number" || !Number.isFinite(balance)) return "ok";
  if (balance <= 0) return "empty";
  if (balance < LOW_INK) return "low";
  return "ok";
}

/** A bottle is full at this much ink (a Small pack). */
export const FULL_BOTTLE_INK = 1000;
/** The least a bottle with any ink left shows, so "a little" never looks like "none". */
const MIN_VISIBLE_FILL = 0.08;

/**
 * 0..1, how full the ink bottle looks. Square-root scaled, so the starter's 300 reads as about
 * half a bottle and LOW_INK as about a third, rather than a sliver; full at FULL_BOTTLE_INK and
 * above; 0 only when there is no ink at all.
 */
export function bottleFill(balance: number | null | undefined): number {
  if (typeof balance !== "number" || !Number.isFinite(balance) || balance <= 0) return 0;
  const fill = Math.sqrt(Math.min(balance, FULL_BOTTLE_INK) / FULL_BOTTLE_INK);
  return Math.min(1, Math.max(MIN_VISIBLE_FILL, fill));
}

export const INK_COPY = {
  getInk: "Get ink",
  /** The meter's tooltip / accessible name. */
  meterLabel: (balance: number) => `${inkLabel(balance)} left`,
  lowHint: "Running low on ink",
  emptyHint: "Out of ink",
} as const;
