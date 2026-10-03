/**
 * Pure helpers for buying ink through Stripe with no server secret: one Payment Link per pack
 * (NEXT_PUBLIC_BILLING_LINKS, made by scripts/stripe-setup.mjs, read in links.ts), opened with
 * this user's id and email, and the account page's wait for the webhook after paying. The ink
 * itself arrives through the webhook, which is why the page polls after a return
 * (inkReturnState below).
 *
 * No React, no network: unit-tested in __tests__/checkout.test.ts.
 */
import type { InkSummary } from "@/lib/billing/inkSummary";

/** Pack id -> Payment Link URL, from NEXT_PUBLIC_BILLING_LINKS. */
export type BillingLinks = Readonly<Record<string, string>>;

/** Who is paying: the id goes back to us in the webhook, the email is prefilled at Stripe. */
export type Payer = { userId: string; email?: string | null };

/** Query parameter a Payment Link's after-completion redirect sets: /account?ink=<pack id>. */
export const INK_RETURN_PARAM = "ink";

/** Pack ids as `ink_packs` allows them (ink_packs_id_format). */
const PACK_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

const ALLOWED_LINK_PROTOCOLS = new Set(["https:", "http:"]);

/**
 * Parses the JSON in NEXT_PUBLIC_BILLING_LINKS (`{"small":"https://…","medium":"https://…",…}`).
 * Never throws: an absent or malformed value yields `{}` (every buy button then says "Coming
 * soon"), and only absolute http(s) URLs survive, so a bad env cannot inject `javascript:` links.
 */
export function parseBillingLinks(envString: string | undefined | null): BillingLinks {
  if (!envString || !envString.trim()) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(envString);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const links: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string" || !PACK_ID_RE.test(key)) continue;
    try {
      const url = new URL(value);
      if (ALLOWED_LINK_PROTOCOLS.has(url.protocol)) links[key] = url.toString();
    } catch {
      /* not an absolute URL: skip */
    }
  }
  return links;
}

/**
 * A pack's Payment Link for this user: `client_reference_id` is how the webhook
 * (checkout.session.completed) knows whose ink it is, and `prefilled_email` saves typing.
 * Null without a link or a user id: a checkout that cannot be matched to anyone must not start.
 */
export function checkoutUrl(link: string | undefined | null, payer: Payer | null | undefined): string | null {
  if (!link || !payer?.userId) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol)) return null;
  url.searchParams.set("client_reference_id", payer.userId);
  const email = payer.email?.trim();
  if (email) url.searchParams.set("prefilled_email", email);
  return url.toString();
}

/**
 * NEXT_PUBLIC_BILLING_LINKS made ready to follow for this user. A link that cannot be used (no
 * user id yet, a malformed URL) is left out, so its pack shows "Coming soon" rather than a bad link.
 */
export function payerLinks(links: BillingLinks, payer: Payer | null | undefined): BillingLinks {
  const out: Record<string, string> = {};
  for (const [packId, link] of Object.entries(links)) {
    const url = checkoutUrl(link, payer);
    if (url) out[packId] = url;
  }
  return out;
}

/** The pack the student just paid for, from `?ink=medium`; null when absent or malformed. */
export function parseInkReturn(search: string | URLSearchParams | null | undefined): string | null {
  if (!search) return null;
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const value = params.get(INK_RETURN_PARAM)?.trim().toLowerCase() ?? "";
  return PACK_ID_RE.test(value) ? value : null;
}

/* ------------------------------------------------------------------------- */
/* Back from checkout: wait for the webhook                                   */
/* ------------------------------------------------------------------------- */

/** How often the account page re-reads ink_summary while it waits for the webhook. */
export const INK_RETURN_POLL_MS = 2_000;
/** After this long the page stops waiting and says so (the webhook may still land later). */
export const INK_RETURN_TIMEOUT_MS = 60_000;
/**
 * Without a checkout mark (storage blocked, or the link opened elsewhere), a purchase this recent
 * counts as the one just paid for: the webhook can land a little before the redirect, and the
 * server's clock is not the browser's. Short, so an earlier purchase of the same pack is not it.
 */
export const INK_RETURN_WINDOW_MS = 2 * 60_000;

/** What a buy button remembers when it opens checkout (useInkSummary watchInkCheckout). */
export type CheckoutMark = {
  /** When the student left for checkout (browser clock). */
  at: number;
  /** ink_summary's last purchase id at that moment; null when there was none. */
  lastPurchaseId: number | null;
};

export type InkReturnState = "waiting" | "done" | "timeout";

/**
 * Where the "Adding your ink…" notice is: done once ink_summary's last purchase is the pack paid
 * for AND newer than the purchase the student had when they left for checkout (`mark`; no clocks
 * involved), or, without a mark, made in the last couple of minutes; timeout once `timeoutMs` has
 * passed without it; waiting otherwise (also while the first read is still in flight).
 */
export function inkReturnState(input: {
  target: string;
  summary: Pick<InkSummary, "last_purchase"> | null | undefined;
  mark?: CheckoutMark | null;
  startedAt: number;
  now: number;
  timeoutMs?: number;
}): InkReturnState {
  const last = input.summary?.last_purchase;
  if (last?.pack_id === input.target) {
    const isNew = input.mark
      ? last.id !== input.mark.lastPurchaseId
      : Date.parse(last.created_at) >= input.startedAt - INK_RETURN_WINDOW_MS;
    if (isNew) return "done";
  }
  return input.now - input.startedAt >= (input.timeoutMs ?? INK_RETURN_TIMEOUT_MS) ? "timeout" : "waiting";
}

export const CHECKOUT_COPY = {
  waiting: (pack: string) => `Adding your ${pack} pack…`,
  waitingDetail: "Your payment went through. The ink appears here in a few seconds.",
  done: "Ink added",
  doneDetail: (ink: string, balance: string) => `${ink} is yours. You have ${balance} now, and it never expires.`,
  timeout: "Your ink hasn't arrived yet",
  timeoutDetail:
    "Stripe has your payment, but its confirmation hasn't reached us yet. It usually lands within a minute, so check again shortly. If the ink still isn't here after a few minutes, report it and we'll add it by hand.",
  checkAgain: "Check again",
  dismiss: "Dismiss",
} as const;
