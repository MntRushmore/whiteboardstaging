#!/usr/bin/env node
/**
 * Creates (or finds) the Stripe objects behind Agathon's ink packs and the Agathon Unlimited
 * subscription, retires the old Plus/Pro subscription objects, and prints the env values the app
 * needs. Idempotent: every object carries `metadata.app = agathon-classroom` and is found again by
 * it, so a second run changes nothing unless the config below changed.
 *
 *   node scripts/stripe-setup.mjs [--mode test|live] [--site <url>] [--dry-run] [--secret-file <path>]
 *
 *   --mode         test (default) or live. Live passes the Stripe CLI's own `--live` flag.
 *   --site         the app's origin; Payment Links redirect to <site>/account?ink=<pack>, and the
 *                  webhook posts to <site>/api/billing/webhook. Default http://localhost:3000.
 *   --dry-run      read what exists and say what would change; create nothing.
 *   --secret-file  where a NEW webhook endpoint's signing secret is written (mode 600). Default
 *                  ~/.config/agathon-classroom/stripe-webhook-secret-<mode>. Never printed.
 *
 * What it manages (docs/RUNBOOK-billing.md):
 *   - a product + a ONE-TIME price per ink pack (PACKS below); a changed amount makes a new price
 *     and archives the old one
 *   - a Payment Link per pack, in payment mode, with `metadata.pack_id` (copied onto every Checkout
 *     Session, where the webhook reads it) and a redirect back to the account page; the app appends
 *     `client_reference_id=<user id>` and `prefilled_email=<email>` (src/lib/billing/checkout.ts)
 *   - Agathon Unlimited (UNLIMITED below): a product, a $25 MONTHLY price, and a subscription
 *     Payment Link with the 7-day free trial on it (`subscription_data.trial_period_days`), the card
 *     taken up front (`payment_method_collection: always`), `metadata.plan_id = unlimited` on the
 *     link (so on its Checkout Sessions) and on every subscription it starts
 *     (`subscription_data.metadata`), and a redirect to `<site>/?unlimited=started`
 *   - the referral link (REFERRAL below, 2026-10-09): a second Payment Link for the monthly price
 *     with a 30-day trial, `offer = referral` (NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK, optional). The
 *     monthly link's lookup and clean-up skip any link with an `offer`, so it is never taken for a
 *     stale monthly link.
 *   - a customer portal configuration for Unlimited (cancel at the period end, update the card,
 *     invoices) with its no-code login page, whose URL is NEXT_PUBLIC_BILLING_PORTAL_URL
 *   - a webhook endpoint for exactly the events src/app/api/billing/webhook handles (not for a
 *     localhost site: use `stripe listen --forward-to` there)
 *   - the retired subscription objects it made before ink: the Plus/Pro Payment Links are
 *     deactivated, their products and prices archived, and their customer portal configuration
 *     deactivated (unless it is the account's default, which Stripe will not deactivate). The
 *     Unlimited configuration (`metadata.plan_id = unlimited`) is never retired.
 *
 * SHARED ACCOUNT. The Stripe account also runs Fuime. This script lists what it must (Stripe's
 * list endpoints have no metadata filter) but writes ONLY to objects tagged app=agathon-classroom
 * that it made, never to anything untagged, and never to account-level settings (branding,
 * business profile, the default portal configuration, payouts, tax). It never puts a `fuime_*`
 * metadata key on anything: Fuime's webhook handlers and payment sweep act on those keys.
 *
 * Talks to Stripe only through the Stripe CLI (`stripe get|post … [--live]`), so no key is read,
 * stored or printed here; the CLI uses the account it is logged in to (`stripe config --list`).
 * The packs here and `public.ink_packs` must agree: src/__tests__/stripeSetup.test.ts pins them.
 *
 * The pure helpers are exported for that test; the CLI runs only when this file is the entry script.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Tag on every object this script owns. */
export const APP_TAG = "agathon-classroom";
export const PRODUCT_PREFIX = "Agathon";

/**
 * The ink packs, at the prices the owner set (2026-10-02): keep them equal to the `ink_packs` seed
 * in supabase/migrations/20261002000000_ink.sql.
 * @type {ReadonlyArray<{ id: string, name: string, ink: number, priceCents: number, currency: string }>}
 */
export const PACKS = Object.freeze([
  Object.freeze({ id: "small", name: "Small", ink: 1000, priceCents: 500, currency: "usd" }),
  Object.freeze({ id: "medium", name: "Medium", ink: 5000, priceCents: 2000, currency: "usd" }),
  Object.freeze({ id: "large", name: "Large", ink: 14000, priceCents: 5000, currency: "usd" }),
]);

/** The events src/app/api/billing/webhook/route.ts acts on (HANDLED_EVENTS in src/lib/server/billingWebhook.ts). */
export const WEBHOOK_EVENTS = Object.freeze([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "charge.refunded",
  // Agathon Unlimited: the subscription's state (its checkout comes through the first one)
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/**
 * Agathon Unlimited, at the owner's price (2026-10-03): $25 a month after a 7-day free trial (3 days
 * for a few hours on 2026-10-06; the live link was updated in place both ways). Keep it
 * equal to UNLIMITED_PLAN in src/lib/billing/unlimited.ts (what the app shows): stripeSetup.test.ts
 * pins the two together. Changing the price or the trial makes a new price and Payment Link (the old
 * link is deactivated; subscribers on the old price keep it until they cancel).
 * @type {Readonly<{ id: string, name: string, priceCents: number, currency: string, interval: "month", trialDays: number }>}
 */
export const UNLIMITED = Object.freeze({ id: "unlimited", name: "Agathon Unlimited", priceCents: 2500, currency: "usd", interval: "month", trialDays: 7 });

/**
 * A referred family's free first month (2026-10-09, "give a month, get a month"): a second Payment
 * Link for the MONTHLY price with a 30-day trial, tagged `offer = referral`. Keep the trial equal to
 * REFERRAL_TRIAL_DAYS in src/lib/billing/planChoice.ts. Its link is
 * NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK (optional: the app offers it only to referred accounts, and
 * only when it is set).
 * @type {Readonly<{ offer: "referral", trialDays: number }>}
 */
export const REFERRAL = Object.freeze({ offer: "referral", trialDays: 30 });

/**
 * Which way an Unlimited object sells the plan (`metadata.offer`): "referral", or none, the monthly
 * plan (its objects were made before the key existed, so the absence IS monthly).
 */
export function offerOf(obj) {
  return metaOf(obj).offer ?? "monthly";
}

/** The subscription plans this script sold before ink; their objects are retired on every run. */
export const RETIRED_PLAN_IDS = Object.freeze(["plus", "pro"]);

export const WEBHOOK_PATH = "/api/billing/webhook";
export const DEFAULT_SITE = "http://localhost:3000";
/** The production origin: test-mode objects must never point at it (a test webhook would post real-looking events there). */
export const PRODUCTION_SITE = "https://whiteboard.rushilchopra.com";

/* ------------------------------------------------------------------------- */
/* Arguments                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * @typedef {{ mode: "test" | "live", site: string, dryRun: boolean, secretFile: string | null, help: boolean }} Options
 */

/**
 * @param {string[]} argv arguments after the script name
 * @returns {Options | { error: string }}
 */
export function parseArgs(argv) {
  /** @type {Options} */
  const opts = { mode: "test", site: DEFAULT_SITE, dryRun: false, secretFile: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
      return v;
    };
    try {
      switch (flag) {
        case "--mode": {
          const m = value();
          if (m !== "test" && m !== "live") return { error: `--mode must be test or live, not "${m}"` };
          opts.mode = m;
          break;
        }
        case "--site": {
          const site = normalizeSite(value());
          if (!site) return { error: "--site must be an absolute http(s) URL, e.g. https://whiteboard.rushilchopra.com" };
          opts.site = site;
          break;
        }
        case "--secret-file":
          opts.secretFile = value();
          break;
        case "--dry-run":
          opts.dryRun = true;
          break;
        case "--help":
        case "-h":
          opts.help = true;
          break;
        default:
          return { error: `unknown argument ${arg}` };
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (opts.mode === "test" && opts.site === PRODUCTION_SITE && !opts.dryRun) {
    return { error: `--mode test must not point at ${PRODUCTION_SITE} (it would make a test webhook endpoint for production); use a local or preview --site` };
  }
  if (opts.mode === "live" && isLocalSite(opts.site)) {
    return { error: "--mode live needs the public --site (a live Payment Link cannot send customers to localhost)" };
  }
  return opts;
}

/** The origin of an absolute http(s) URL, without a trailing slash; null otherwise. */
export function normalizeSite(raw) {
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** True for a site Stripe cannot reach (webhooks are then forwarded by `stripe listen`). */
export function isLocalSite(site) {
  try {
    const host = new URL(site).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1" || host.endsWith(".local");
  } catch {
    return true;
  }
}

/** Where a Payment Link sends the customer after paying: the account page's "Adding your ink…" state. */
export function inkReturnUrl(site, packId) {
  return `${site}/account?ink=${encodeURIComponent(packId)}`;
}

/**
 * Where the Unlimited Payment Link sends the grown-up after checkout: the home, which says the free
 * week has started (UNLIMITED_RETURN_PARAM / _VALUE in src/lib/billing/unlimited.ts).
 */
export function unlimitedReturnUrl(site) {
  return `${site}/?unlimited=started`;
}

/** Where the customer portal's "Return to Agathon" goes: the account page's Plan section. */
export function portalReturnUrl(site) {
  return `${site}/account`;
}

export function webhookUrl(site) {
  return `${site}${WEBHOOK_PATH}`;
}

export function defaultSecretFile(mode) {
  return path.join(os.homedir(), ".config", "agathon-classroom", `stripe-webhook-secret-${mode}`);
}

/* ------------------------------------------------------------------------- */
/* Request bodies (plain objects; `formFields` turns them into Stripe's form) */
/* ------------------------------------------------------------------------- */

/**
 * Stripe's bracket form encoding as [key, value] pairs:
 * `{ a: { b: [ { c: 1 } ] } }` -> `[["a[b][0][c]", "1"]]`; `{ e: ["x"] }` -> `[["e[0]", "x"]]`.
 * `undefined` / `null` values are left out.
 * @param {Record<string, unknown>} obj
 * @returns {Array<[string, string]>}
 */
export function formFields(obj, prefix = "") {
  /** @type {Array<[string, string]>} */
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item && typeof item === "object") out.push(...formFields(/** @type {Record<string, unknown>} */ (item), `${name}[${i}]`));
        else out.push([`${name}[${i}]`, String(item)]);
      });
    } else if (typeof value === "object") {
      out.push(...formFields(/** @type {Record<string, unknown>} */ (value), name));
    } else {
      out.push([name, String(value)]);
    }
  }
  return out;
}

const inkCount = (n) => n.toLocaleString("en-US");

export function productName(pack) {
  return `${PRODUCT_PREFIX} ${pack.name} ink pack`;
}

export function productDescription(pack) {
  return `${inkCount(pack.ink)} ink for the AI tutor. Ink never expires.`;
}

export function productBody(pack) {
  return {
    name: productName(pack),
    description: productDescription(pack),
    metadata: { app: APP_TAG, pack_id: pack.id },
  };
}

/** A one-time price: no `recurring`. */
export function priceBody(pack, productId) {
  return {
    product: productId,
    currency: pack.currency,
    unit_amount: pack.priceCents,
    nickname: `${pack.name} ink pack`,
    metadata: { app: APP_TAG, pack_id: pack.id, ink: pack.ink },
  };
}

/** Appended to the account's statement descriptor, so a card statement says what was bought. */
export const STATEMENT_DESCRIPTOR_SUFFIX = "AGATHON";

/**
 * The Payment Link, in payment mode (a one-time price makes it one). `metadata` is copied onto
 * every Checkout Session it creates, which is where the webhook reads `app` (is it ours?) and
 * `pack_id`; the payment intent (and so its charge) is tagged too, so a refund is recognisably
 * Agathon's and the Dashboard can filter revenue by app. Quantity is fixed at 1: one pack per
 * checkout, so the ink granted is always the pack's. Nothing here may carry a `fuime_*` key: the
 * account's other app acts on exactly those (src/__tests__/stripeSetup.test.ts asserts it).
 */
export function paymentLinkBody(pack, priceId, site) {
  return {
    line_items: [{ price: priceId, quantity: 1 }],
    after_completion: { type: "redirect", redirect: { url: inkReturnUrl(site, pack.id) } },
    metadata: { app: APP_TAG, pack_id: pack.id, price_id: priceId },
    payment_intent_data: {
      metadata: { app: APP_TAG, pack_id: pack.id },
      statement_descriptor_suffix: STATEMENT_DESCRIPTOR_SUFFIX,
    },
    submit_type: "pay",
    // No promotion codes: the account's coupons belong to Fuime too, and a 100 % code would make
    // the pack free (the webhook would record such a checkout for review and grant nothing).
    allow_promotion_codes: false,
  };
}

/** "$25" */
const dollars = (cents) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/**
 * What a card statement shows for the plan's charges. The account is shared with Fuime, so its own
 * descriptor is FUIME, and a subscription's charges cannot take a suffix the way the packs' do
 * (`payment_intent_data` is payment mode only: Stripe makes renewal charges itself). Stripe takes a
 * subscription payment's descriptor from its invoice, else from the first item's PRODUCT
 * `statement_descriptor`, else the account's (docs.stripe.com/get-started/account/statement-descriptors),
 * so it is set on the product: every invoice of every Unlimited subscription, the first $25 after
 * the free trial included, shows it. Stripe's rules: 5 to 22 Latin characters, at least one letter,
 * none of < > \ ' " *.
 */
export const UNLIMITED_STATEMENT_DESCRIPTOR = "AGATHON";

/** The Unlimited product: what Checkout, the receipt and the portal call the plan, and what the card statement shows. */
export function unlimitedProductBody() {
  return {
    name: UNLIMITED.name,
    description: `Help from the AI tutor without counting ink. ${UNLIMITED.trialDays} days free, then ${dollars(UNLIMITED.priceCents)} a ${UNLIMITED.interval}. Cancel any time.`,
    statement_descriptor: UNLIMITED_STATEMENT_DESCRIPTOR,
    metadata: { app: APP_TAG, plan_id: UNLIMITED.id },
  };
}

/** The Unlimited price: RECURRING, monthly. */
export function unlimitedPriceBody(productId) {
  return {
    product: productId,
    currency: UNLIMITED.currency,
    unit_amount: UNLIMITED.priceCents,
    recurring: { interval: UNLIMITED.interval },
    nickname: `${UNLIMITED.name} monthly`,
    metadata: { app: APP_TAG, plan_id: UNLIMITED.id },
  };
}

/** Shown above Checkout's button: what happens after the free trial, in plain words. */
export const UNLIMITED_CHECKOUT_NOTE = `Free for ${UNLIMITED.trialDays} days, then ${dollars(UNLIMITED.priceCents)} a ${UNLIMITED.interval} until you cancel. Cancel before the free trial ends and you won't be charged.`;

/**
 * The Unlimited Payment Link, in subscription mode (a recurring price makes it one). The free trial
 * is on the link (`subscription_data.trial_period_days`), and the card is collected up front
 * (`payment_method_collection: always`), so the plan renews by itself unless cancelled. `metadata`
 * goes onto every Checkout Session (the webhook links the subscription to `client_reference_id`
 * there) and `subscription_data.metadata` onto every subscription it starts (the webhook knows
 * the subscription's events by it). `trial_days` in the link's metadata finds it again only while
 * the trial is unchanged. No `submit_type` or `payment_intent_data` (payment mode only). No
 * promotion codes: the account's coupons belong to Fuime too.
 */
export function unlimitedLinkBody(priceId, site) {
  return {
    line_items: [{ price: priceId, quantity: 1 }],
    after_completion: { type: "redirect", redirect: { url: unlimitedReturnUrl(site) } },
    metadata: { app: APP_TAG, plan_id: UNLIMITED.id, price_id: priceId, trial_days: String(UNLIMITED.trialDays) },
    subscription_data: {
      trial_period_days: UNLIMITED.trialDays,
      metadata: { app: APP_TAG, plan_id: UNLIMITED.id },
    },
    payment_method_collection: "always",
    allow_promotion_codes: false,
    custom_text: { submit: { message: UNLIMITED_CHECKOUT_NOTE } },
  };
}

/** Above the referral Checkout's button: the free month, then the monthly price, in plain words. */
export const REFERRAL_CHECKOUT_NOTE = `Your first month is free, then ${dollars(UNLIMITED.priceCents)} a ${UNLIMITED.interval} until you cancel. Cancel before the ${REFERRAL.trialDays} days are up and you won't be charged.`;

/**
 * The referral Payment Link: the MONTHLY price with a 30-day trial (`offer = referral`), otherwise
 * the monthly link's shape. A Payment Link's URL is public once it is in the app's bundle, so anyone
 * who reads the page's code could use it: the cost is 23 more free days on a first plan (one free
 * trial per account, has_unlimited()). docs/RUNBOOK-billing.md section 13.
 */
export function referralLinkBody(priceId, site) {
  return {
    line_items: [{ price: priceId, quantity: 1 }],
    after_completion: { type: "redirect", redirect: { url: unlimitedReturnUrl(site) } },
    metadata: { app: APP_TAG, plan_id: UNLIMITED.id, price_id: priceId, trial_days: String(REFERRAL.trialDays), offer: REFERRAL.offer },
    subscription_data: {
      trial_period_days: REFERRAL.trialDays,
      metadata: { app: APP_TAG, plan_id: UNLIMITED.id, offer: REFERRAL.offer },
    },
    payment_method_collection: "always",
    allow_promotion_codes: false,
    custom_text: { submit: { message: REFERRAL_CHECKOUT_NOTE } },
  };
}

/**
 * The customer portal for Unlimited: cancel (at the end of the free trial or the paid month, so the
 * time paid for is kept and nothing more is charged), update the card, see invoices. No plan
 * switching (there is one plan) and no changes to the customer's details. `login_page.enabled`
 * gives the no-code login link the account page opens (NEXT_PUBLIC_BILLING_PORTAL_URL): the
 * grown-up types the checkout's email and gets a one-time code, so the app needs no Stripe key.
 * The legal pages are linked only for a public site (Stripe wants reachable URLs).
 */
export function portalBody(site) {
  const local = isLocalSite(site);
  return {
    business_profile: {
      headline: `${UNLIMITED.name}: manage or cancel your plan`,
      ...(local ? {} : { privacy_policy_url: `${site}/privacy`, terms_of_service_url: `${site}/terms` }),
    },
    default_return_url: portalReturnUrl(site),
    features: {
      customer_update: { enabled: false },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        proration_behavior: "none",
        cancellation_reason: { enabled: true, options: ["too_expensive", "unused", "missing_features", "other"] },
      },
      subscription_update: { enabled: false },
    },
    login_page: { enabled: true },
    metadata: { app: APP_TAG, plan_id: UNLIMITED.id },
  };
}

export function webhookBody(site) {
  return {
    url: webhookUrl(site),
    enabled_events: [...WEBHOOK_EVENTS],
    description: `${PRODUCT_PREFIX} ink packs and Unlimited`,
    metadata: { app: APP_TAG },
  };
}

/* ------------------------------------------------------------------------- */
/* Finding what exists                                                        */
/* ------------------------------------------------------------------------- */

/** @param {any} obj */
function metaOf(obj) {
  return obj && typeof obj.metadata === "object" && obj.metadata ? obj.metadata : {};
}

/** True when the object is ours (and matches every extra metadata pair given). */
export function isOurs(obj, extra = {}) {
  const meta = metaOf(obj);
  if (meta.app !== APP_TAG) return false;
  return Object.entries(extra).every(([k, v]) => meta[k] === v);
}

/** Our active product for the pack (the oldest, if a failed run ever made two). */
export function findProduct(products, packId) {
  return oldest(products.filter((p) => p.active !== false && isOurs(p, { pack_id: packId })));
}

/** Our active ONE-TIME price on the product with exactly the pack's amount and currency. */
export function findPrice(prices, pack, productId) {
  return oldest(
    prices.filter(
      (p) =>
        p.active !== false &&
        isOurs(p, { pack_id: pack.id }) &&
        p.product === productId &&
        p.unit_amount === pack.priceCents &&
        p.currency === pack.currency &&
        !p.recurring &&
        (p.type ?? "one_time") === "one_time",
    ),
  );
}

/** Our active Payment Link for the pack that sells exactly this price. */
export function findPaymentLink(links, packId, priceId) {
  return oldest(links.filter((l) => l.active !== false && isOurs(l, { pack_id: packId, price_id: priceId })));
}

export function findWebhook(endpoints, url) {
  return oldest(endpoints.filter((e) => e.url === url && isOurs(e)));
}

/** Our active Unlimited product (the oldest, if a failed run ever made two). */
export function findUnlimitedProduct(products) {
  return oldest(products.filter((p) => p.active !== false && isOurs(p, { plan_id: UNLIMITED.id })));
}

/** Our active referral Payment Link selling exactly this (monthly) price with exactly the referral trial. */
export function findReferralLink(links, priceId) {
  return oldest(
    links.filter((l) => l.active !== false && isOurs(l, { plan_id: UNLIMITED.id, price_id: priceId, trial_days: String(REFERRAL.trialDays), offer: REFERRAL.offer })),
  );
}

/** Our active MONTHLY Unlimited price on the product with exactly the plan's amount and currency. */
export function findUnlimitedPrice(prices, productId) {
  return oldest(
    prices.filter(
      (p) =>
        p.active !== false &&
        isOurs(p, { plan_id: UNLIMITED.id }) &&
        p.product === productId &&
        p.unit_amount === UNLIMITED.priceCents &&
        p.currency === UNLIMITED.currency &&
        p.recurring?.interval === UNLIMITED.interval &&
        (p.recurring?.interval_count ?? 1) === 1,
    ),
  );
}

/** Our active (monthly) Unlimited Payment Link selling exactly this price with exactly this trial; never the referral one. */
export function findUnlimitedLink(links, priceId) {
  return oldest(
    links.filter(
      (l) => l.active !== false && isOurs(l, { plan_id: UNLIMITED.id, price_id: priceId, trial_days: String(UNLIMITED.trialDays) }) && offerOf(l) === "monthly",
    ),
  );
}

/** Our active Unlimited portal configuration. */
export function findPortalConfig(configs) {
  return oldest(configs.filter((c) => c.active !== false && isOurs(c, { plan_id: UNLIMITED.id })));
}

/** True when the configuration already does what portalBody asks (no update needed). */
export function portalMatches(config, site) {
  const want = portalBody(site);
  const cancel = config?.features?.subscription_cancel;
  return (
    config?.default_return_url === want.default_return_url &&
    config?.login_page?.enabled === true &&
    config?.business_profile?.headline === want.business_profile.headline &&
    (config?.business_profile?.privacy_policy_url ?? undefined) === want.business_profile.privacy_policy_url &&
    cancel?.enabled === true &&
    cancel?.mode === "at_period_end" &&
    config?.features?.payment_method_update?.enabled === true &&
    config?.features?.subscription_update?.enabled !== true
  );
}

/**
 * The subscription-era objects of ours (metadata.plan_id) that are still active. The Unlimited
 * portal configuration is ours too and stays: only the Plus/Pro-era one (tagged, no Unlimited
 * plan) is retired.
 */
export function retiredObjects({ products, links, configs }) {
  const planOf = (o) => metaOf(o).plan_id;
  return {
    products: products.filter((p) => p.active !== false && isOurs(p) && RETIRED_PLAN_IDS.includes(planOf(p))),
    links: links.filter((l) => l.active !== false && isOurs(l) && RETIRED_PLAN_IDS.includes(planOf(l))),
    configs: configs.filter((c) => c.active !== false && isOurs(c) && planOf(c) !== UNLIMITED.id),
  };
}

/** @template T @param {T[]} list @returns {T | null} */
function oldest(list) {
  if (list.length === 0) return null;
  return [...list].sort((a, b) => (/** @type {any} */ (a).created ?? 0) - (/** @type {any} */ (b).created ?? 0))[0];
}

/** Redirect URL a Payment Link currently has (null when it shows Stripe's own confirmation page). */
export function linkRedirect(link) {
  return link?.after_completion?.type === "redirect" ? link.after_completion.redirect?.url ?? null : null;
}

/** True when the endpoint listens to exactly our events (none missing, none left over from plans). */
export function webhookEventsMatch(endpoint) {
  const have = new Set(endpoint?.enabled_events ?? []);
  return have.size === WEBHOOK_EVENTS.length && WEBHOOK_EVENTS.every((e) => have.has(e));
}

/* ------------------------------------------------------------------------- */
/* Output                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * The env values to set, one per line, ready for `vercel env add` / .env.local.
 * Only public URLs and price ids: nothing here is a secret. The Unlimited link and the portal's
 * login page are printed when known (a dry run that would create them does not know them yet).
 * The referral link is optional for the app (the friend's month is offered only when it is set), so
 * it is printed like the others and the owner decides whether to set it.
 * @param {{ links: Record<string, string>, priceMap: Record<string, string>, unlimitedLink?: string | null, referralLink?: string | null, portalUrl?: string | null }} v
 */
export function envLines({ links, priceMap, unlimitedLink = null, referralLink = null, portalUrl = null }) {
  return [
    `NEXT_PUBLIC_BILLING_LINKS=${JSON.stringify(links)}`,
    `INK_PRICE_MAP=${JSON.stringify(priceMap)}`,
    ...(unlimitedLink ? [`NEXT_PUBLIC_UNLIMITED_LINK=${unlimitedLink}`] : []),
    ...(referralLink ? [`NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK=${referralLink}`] : []),
    ...(portalUrl ? [`NEXT_PUBLIC_BILLING_PORTAL_URL=${portalUrl}`] : []),
  ];
}

/** Anything that looks like a Stripe secret, masked before a message is printed. */
export function redactSecrets(text) {
  return String(text).replace(/\b(sk|rk|whsec|ek)_[A-Za-z0-9_]+/g, "$1_[redacted]");
}

/* ------------------------------------------------------------------------- */
/* Stripe through the CLI                                                     */
/* ------------------------------------------------------------------------- */

/**
 * @typedef {{ get(path: string, params?: Record<string, unknown>): Promise<any>, post(path: string, params?: Record<string, unknown>): Promise<any> }} StripeApi
 */

/**
 * @param {"test" | "live"} mode
 * @returns {StripeApi}
 */
export function stripeCli(mode) {
  const run = (method, apiPath, params = {}) =>
    new Promise((resolve, reject) => {
      const args = [method, apiPath];
      for (const [k, v] of formFields(params)) args.push("-d", `${k}=${v}`);
      if (mode === "live") args.push("--live");
      execFile("stripe", args, { maxBuffer: 32 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
        let body = null;
        try {
          body = JSON.parse(stdout);
        } catch {
          /* not JSON: an error below */
        }
        if (body && body.error) {
          reject(new Error(redactSecrets(`${method.toUpperCase()} ${apiPath}: ${body.error.message ?? JSON.stringify(body.error)}`)));
        } else if (body) {
          resolve(body);
        } else {
          reject(new Error(redactSecrets(`${method.toUpperCase()} ${apiPath} failed: ${(stderr || err?.message || stdout || "no output").trim().slice(0, 500)}`)));
        }
      });
    });
  return { get: (p, params) => run("get", p, params), post: (p, params) => run("post", p, params) };
}

/**
 * Every object of a list endpoint, following `has_more` to the end (the shared account can hold
 * thousands of Fuime objects; a capped listing could miss ours and create duplicates). Stripe's
 * search API could filter by metadata, but its index lags writes by up to a minute, which would
 * break the run-twice-creates-nothing guarantee.
 */
export async function listAll(api, apiPath, params = {}) {
  /** @type {any[]} */
  const all = [];
  let startingAfter;
  for (;;) {
    const res = await api.get(apiPath, { limit: 100, ...params, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    const data = Array.isArray(res?.data) ? res.data : [];
    all.push(...data);
    if (!res?.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return all;
}

/* ------------------------------------------------------------------------- */
/* The write guard (shared account)                                           */
/* ------------------------------------------------------------------------- */

/** The create endpoints the script uses; each body must carry our tag. */
const CREATE_PATHS = new Set(["/v1/products", "/v1/prices", "/v1/payment_links", "/v1/webhook_endpoints", "/v1/billing_portal/configurations"]);

/** Every metadata key in a request body, at any depth (`metadata`, `payment_intent_data.metadata`, …). */
export function metadataKeys(body, inMetadata = false) {
  /** @type {string[]} */
  const keys = [];
  if (!body || typeof body !== "object") return keys;
  for (const [key, value] of Object.entries(body)) {
    if (inMetadata) keys.push(key);
    if (value && typeof value === "object") keys.push(...metadataKeys(value, key === "metadata"));
  }
  return keys;
}

/**
 * Wraps the API so a write can only go to an object this run created or found tagged as ours,
 * and a create must carry `metadata.app` and no `fuime_*` key. A violation throws before the
 * request is sent: the script stops rather than touch the account's other business.
 * @param {StripeApi} api
 * @param {Set<string>} ours ids known to be ours (grows as the run finds and creates objects)
 * @returns {StripeApi}
 */
export function guardedApi(api, ours) {
  return {
    get: (p, params) => api.get(p, params),
    async post(p, body = {}) {
      const foreignKey = metadataKeys(body).find((k) => k.toLowerCase().startsWith("fuime"));
      if (foreignKey) throw new Error(`refusing to write metadata key ${foreignKey} (it belongs to the account's other app)`);
      if (CREATE_PATHS.has(p)) {
        if (metaOf(body).app !== APP_TAG) throw new Error(`refusing to create ${p} without metadata.app=${APP_TAG}`);
        const created = await api.post(p, body);
        if (created?.id) ours.add(created.id);
        return created;
      }
      const id = p.split("/").pop() ?? "";
      if (!ours.has(id)) throw new Error(`refusing to modify ${p}: not an object tagged app=${APP_TAG}`);
      return api.post(p, body);
    },
  };
}

/* ------------------------------------------------------------------------- */
/* The run                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * @param {Options} opts
 * @param {{ api?: StripeApi, log?: (line: string) => void, writeSecret?: (file: string, secret: string) => void }} [deps]
 */
export async function setup(opts, deps = {}) {
  /** Ids of objects tagged as ours (found) or made by this run: the only ones a write may touch. */
  const ours = new Set();
  const api = guardedApi(deps.api ?? stripeCli(opts.mode), ours);
  const log = deps.log ?? ((line) => console.log(line));
  const writeSecret = deps.writeSecret ?? writeSecretFile;
  const dry = opts.dryRun;
  const would = (what) => log(`  ${dry ? "would " : ""}${what}`);
  /** @template T @param {T[]} list @returns {T[]} */
  const claim = (list) => {
    for (const o of list) if (isOurs(o)) ours.add(/** @type {any} */ (o).id);
    return list;
  };

  // Read only: which account the CLI is on, so the operator sees it before anything changes.
  const account = await api.get("/v1/account");
  log(`Stripe account ${account.id}${account.settings?.dashboard?.display_name ? ` ("${account.settings.dashboard.display_name}")` : ""}, ${opts.mode} mode${dry ? ", dry run" : ""}`);
  log(`Site ${opts.site}`);

  const products = claim(await listAll(api, "/v1/products", { active: "true" }));
  const links = claim(await listAll(api, "/v1/payment_links", { active: "true" }));

  /** @type {Record<string, string>} */
  const linkUrls = {};
  /** @type {Record<string, string>} */
  const priceMap = {};
  /** @type {string[]} */
  const notes = [];

  for (const pack of PACKS) {
    log(`\n${pack.name} (${pack.id}): $${(pack.priceCents / 100).toFixed(2)} once, ${inkCount(pack.ink)} ink`);

    // Product
    let product = findProduct(products, pack.id);
    const body = productBody(pack);
    if (!product) {
      would(`create product "${body.name}"`);
      product = dry ? { id: `(new ${pack.id} product)`, name: body.name } : await api.post("/v1/products", body);
    } else if (product.name !== body.name || product.description !== body.description) {
      would(`update product ${product.id} name/description`);
      if (!dry) product = await api.post(`/v1/products/${product.id}`, { name: body.name, description: body.description });
    }
    log(`  product ${product.id}`);

    // Price
    const prices = product.id.startsWith("prod_") ? claim(await listAll(api, "/v1/prices", { product: product.id, active: "true" })) : [];
    let price = findPrice(prices, pack, product.id);
    if (!price) {
      would(`create one-time price ${pack.priceCents} ${pack.currency}`);
      price = dry ? { id: `(new ${pack.id} price)` } : await api.post("/v1/prices", priceBody(pack, product.id));
    }
    log(`  price ${price.id}`);
    if (!dry && product.default_price !== price.id) {
      await api.post(`/v1/products/${product.id}`, { default_price: price.id });
    }
    for (const stale of prices.filter((p) => p.id !== price.id && isOurs(p))) {
      would(`archive old price ${stale.id} (${stale.unit_amount} ${stale.currency})`);
      if (!dry) await api.post(`/v1/prices/${stale.id}`, { active: false });
    }

    // Payment Link
    const wantRedirect = inkReturnUrl(opts.site, pack.id);
    let link = findPaymentLink(links, pack.id, price.id);
    if (!link) {
      would(`create Payment Link redirecting to ${wantRedirect}`);
      link = dry ? { id: `(new ${pack.id} link)`, url: `(new ${pack.id} link url)` } : await api.post("/v1/payment_links", paymentLinkBody(pack, price.id, opts.site));
    } else if (linkRedirect(link) !== wantRedirect) {
      would(`point Payment Link ${link.id} at ${wantRedirect}`);
      if (!dry) link = await api.post(`/v1/payment_links/${link.id}`, { after_completion: { type: "redirect", redirect: { url: wantRedirect } } });
    }
    log(`  payment link ${link.id} ${link.url}`);
    for (const stale of links.filter((l) => l.id !== link.id && isOurs(l, { pack_id: pack.id }))) {
      would(`deactivate old Payment Link ${stale.id} (${stale.url})`);
      if (!dry) await api.post(`/v1/payment_links/${stale.id}`, { active: false });
      notes.push(`The ${pack.name} Payment Link changed: update NEXT_PUBLIC_BILLING_LINKS and redeploy (the old link no longer sells).`);
    }

    linkUrls[pack.id] = link.url;
    // Archived prices stay in the map: a checkout opened just before a price change still pays the
    // old price, and its session must still find its pack when it has no metadata.
    if (product.id.startsWith("prod_")) {
      const archived = await listAll(api, "/v1/prices", { product: product.id, active: "false" });
      for (const old of [...prices, ...archived]) if (isOurs(old, { pack_id: pack.id })) priceMap[old.id] = pack.id;
    }
    priceMap[price.id] = pack.id;
  }

  // Agathon Unlimited: the monthly plan with the free trial.
  log(`\n${UNLIMITED.name}: ${dollars(UNLIMITED.priceCents)} a ${UNLIMITED.interval} after ${UNLIMITED.trialDays} days free`);
  let uProduct = findUnlimitedProduct(products);
  const uBody = unlimitedProductBody();
  if (!uProduct) {
    would(`create product "${uBody.name}"`);
    uProduct = dry ? { id: "(new unlimited product)", name: uBody.name } : await api.post("/v1/products", uBody);
  } else if (uProduct.name !== uBody.name || uProduct.description !== uBody.description || uProduct.statement_descriptor !== uBody.statement_descriptor) {
    would(`update product ${uProduct.id} name/description/statement descriptor (${uBody.statement_descriptor})`);
    if (!dry) {
      uProduct = await api.post(`/v1/products/${uProduct.id}`, { name: uBody.name, description: uBody.description, statement_descriptor: uBody.statement_descriptor });
    }
  }
  log(`  product ${uProduct.id}`);

  const uPrices = uProduct.id.startsWith("prod_") ? claim(await listAll(api, "/v1/prices", { product: uProduct.id, active: "true" })) : [];
  let uPrice = findUnlimitedPrice(uPrices, uProduct.id);
  if (!uPrice) {
    would(`create monthly price ${UNLIMITED.priceCents} ${UNLIMITED.currency}`);
    uPrice = dry ? { id: "(new unlimited price)" } : await api.post("/v1/prices", unlimitedPriceBody(uProduct.id));
  }
  log(`  price ${uPrice.id}`);
  if (!dry && uProduct.default_price !== uPrice.id) {
    await api.post(`/v1/products/${uProduct.id}`, { default_price: uPrice.id });
  }
  // Subscribers on an archived price keep it until they cancel; new checkouts get the new one.
  for (const stale of uPrices.filter((p) => p.id !== uPrice.id && isOurs(p, { plan_id: UNLIMITED.id }))) {
    would(`archive old price ${stale.id} (${stale.unit_amount} ${stale.currency})`);
    if (!dry) await api.post(`/v1/prices/${stale.id}`, { active: false });
  }

  const wantUnlimitedRedirect = unlimitedReturnUrl(opts.site);
  let uLink = findUnlimitedLink(links, uPrice.id);
  if (!uLink) {
    would(`create subscription Payment Link (${UNLIMITED.trialDays}-day trial, card up front) redirecting to ${wantUnlimitedRedirect}`);
    uLink = dry ? { id: "(new unlimited link)", url: null } : await api.post("/v1/payment_links", unlimitedLinkBody(uPrice.id, opts.site));
  } else if (linkRedirect(uLink) !== wantUnlimitedRedirect) {
    would(`point Payment Link ${uLink.id} at ${wantUnlimitedRedirect}`);
    if (!dry) uLink = await api.post(`/v1/payment_links/${uLink.id}`, { after_completion: { type: "redirect", redirect: { url: wantUnlimitedRedirect } } });
  }
  log(`  payment link ${uLink.id} ${uLink.url ?? "(made on the real run)"}`);
  // Only the monthly links: the referral link is kept (or replaced) by its own section below.
  for (const stale of links.filter((l) => l.id !== uLink.id && isOurs(l, { plan_id: UNLIMITED.id }) && offerOf(l) === "monthly")) {
    would(`deactivate old Payment Link ${stale.id} (${stale.url})`);
    if (!dry) await api.post(`/v1/payment_links/${stale.id}`, { active: false });
    notes.push("The Unlimited Payment Link changed: update NEXT_PUBLIC_UNLIMITED_LINK and redeploy (the old link no longer sells).");
  }

  // A referred family's free first month: the monthly price, a 30-day trial, its own link.
  log(`\n${UNLIMITED.name}, referral: the monthly price after ${REFERRAL.trialDays} days free`);
  let rLink = findReferralLink(links, uPrice.id);
  if (!rLink) {
    would(`create referral Payment Link (${REFERRAL.trialDays}-day trial, card up front) redirecting to ${wantUnlimitedRedirect}`);
    rLink = dry ? { id: "(new referral link)", url: null } : await api.post("/v1/payment_links", referralLinkBody(uPrice.id, opts.site));
  } else if (linkRedirect(rLink) !== wantUnlimitedRedirect) {
    would(`point Payment Link ${rLink.id} at ${wantUnlimitedRedirect}`);
    if (!dry) rLink = await api.post(`/v1/payment_links/${rLink.id}`, { after_completion: { type: "redirect", redirect: { url: wantUnlimitedRedirect } } });
  }
  log(`  payment link ${rLink.id} ${rLink.url ?? "(made on the real run)"}`);
  for (const stale of links.filter((l) => l.id !== rLink.id && isOurs(l, { plan_id: UNLIMITED.id, offer: REFERRAL.offer }))) {
    would(`deactivate old referral Payment Link ${stale.id} (${stale.url})`);
    if (!dry) await api.post(`/v1/payment_links/${stale.id}`, { active: false });
    notes.push("The referral Payment Link changed: update NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK (if set) and redeploy (the old link no longer sells).");
  }

  // The customer portal: where a grown-up cancels or changes the card (the app has no Stripe key).
  log("\nCustomer portal (Unlimited)");
  const configs = claim(await listAll(api, "/v1/billing_portal/configurations", { active: "true" }));
  let portal = findPortalConfig(configs);
  if (!portal) {
    would("create portal configuration (cancel at period end, card, invoices) with a login page");
    portal = dry ? { id: "(new portal configuration)", login_page: { url: null } } : await api.post("/v1/billing_portal/configurations", portalBody(opts.site));
  } else if (!portalMatches(portal, opts.site)) {
    would(`update portal configuration ${portal.id} (features, return URL, login page)`);
    if (!dry) portal = await api.post(`/v1/billing_portal/configurations/${portal.id}`, portalBody(opts.site));
  }
  const portalUrl = portal.login_page?.url ?? null;
  log(`  configuration ${portal.id}`);
  log(`  login page ${portalUrl ?? (dry ? "(made on the real run)" : "(none returned)")}`);
  if (!dry && !portalUrl) {
    notes.push(
      "Stripe returned no portal login page URL. Turn it on by hand: Dashboard > Settings > Billing > Customer portal > the Agathon configuration > " +
        "'Customer portal link' > Activate, then set NEXT_PUBLIC_BILLING_PORTAL_URL to that https://billing.stripe.com/p/login/… link.",
    );
  }

  // The subscription plans this script sold before ink: stop selling them.
  log("\nRetired subscription plans (Plus, Pro)");
  const retired = retiredObjects({ products, links, configs });
  if (retired.products.length + retired.links.length + retired.configs.length === 0) log("  nothing left to retire");
  for (const l of retired.links) {
    would(`deactivate Payment Link ${l.id} (${metaOf(l).plan_id})`);
    if (!dry) await api.post(`/v1/payment_links/${l.id}`, { active: false });
  }
  for (const p of retired.products) {
    const active = claim(await listAll(api, "/v1/prices", { product: p.id, active: "true" })).filter((pr) => isOurs(pr));
    // A product's default price cannot be archived, so the default is cleared first.
    would(`archive product ${p.id} (${p.name}) and its ${active.length} active price${active.length === 1 ? "" : "s"}`);
    if (dry) continue;
    await api.post(`/v1/products/${p.id}`, { default_price: "", active: false });
    for (const pr of active) await api.post(`/v1/prices/${pr.id}`, { active: false });
  }
  for (const c of retired.configs) {
    if (c.is_default) {
      log(`  portal configuration ${c.id} is the account's default; Stripe keeps a default active (it lists only archived plans now)`);
      continue;
    }
    would(`deactivate customer portal configuration ${c.id}`);
    if (!dry) await api.post(`/v1/billing_portal/configurations/${c.id}`, { active: false });
  }

  // Webhook endpoint
  log("\nWebhook");
  /** @type {string} */
  let secretNote;
  if (isLocalSite(opts.site)) {
    secretNote = `${opts.site} is local, so no endpoint was made. Run \`stripe listen --forward-to ${webhookUrl(opts.site)}\`; the whsec_ secret it prints is STRIPE_WEBHOOK_SECRET for that session.`;
    log(`  skipped (local site)`);
  } else {
    const endpoints = claim(await listAll(api, "/v1/webhook_endpoints"));
    const url = webhookUrl(opts.site);
    const endpoint = findWebhook(endpoints, url);
    if (!endpoint) {
      would(`create endpoint ${url} for ${WEBHOOK_EVENTS.join(", ")}`);
      if (dry) {
        secretNote = "(dry run: no endpoint, no secret)";
      } else {
        const created = await api.post("/v1/webhook_endpoints", webhookBody(opts.site));
        const file = opts.secretFile ?? defaultSecretFile(opts.mode);
        writeSecret(file, created.secret);
        log(`  endpoint ${created.id} (API version ${created.api_version ?? "account default"})`);
        secretNote = `written to ${file} (mode 600; the API shows it only once). Also in the Dashboard: Developers > Webhooks > ${created.id} > Signing secret.`;
      }
    } else {
      if (!webhookEventsMatch(endpoint) || endpoint.status === "disabled") {
        would(`update endpoint ${endpoint.id}: events ${WEBHOOK_EVENTS.join(", ")}, enabled`);
        if (!dry) await api.post(`/v1/webhook_endpoints/${endpoint.id}`, { enabled_events: [...WEBHOOK_EVENTS], disabled: false, description: webhookBody(opts.site).description });
      }
      log(`  endpoint ${endpoint.id} (exists)`);
      secretNote = `unchanged. Reveal it in the Dashboard${opts.mode === "test" ? " (test mode)" : ""}: Developers > Webhooks > ${endpoint.id} > Signing secret.`;
    }
  }

  const unlimitedLink = uLink.url ?? null;
  const referralLink = rLink.url ?? null;
  const lines = envLines({ links: linkUrls, priceMap, unlimitedLink, referralLink, portalUrl });
  log("\nSet these (Vercel: Production; locally: the dev server's env):");
  for (const line of lines) log(`  ${line}`);
  if (!unlimitedLink) log("  NEXT_PUBLIC_UNLIMITED_LINK: (printed by the real run)");
  if (!referralLink) log("  NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK: (printed by the real run)");
  log("  (The referral link is optional: a referred family's free month is offered only when it is set.)");
  if (!portalUrl) log("  NEXT_PUBLIC_BILLING_PORTAL_URL: (printed by the real run, or see the note below)");
  log(`  STRIPE_WEBHOOK_SECRET: ${secretNote}`);
  log("  (BILLING_PRICE_MAP from the subscription days is no longer read: remove it.)");
  for (const note of new Set(notes)) log(`\nNote: ${note}`);
  return { links: linkUrls, priceMap, unlimitedLink, referralLink, portalUrl, env: lines };
}

/** Write the webhook signing secret for the operator, readable only by them. */
export function writeSecretFile(file, secret) {
  if (typeof secret !== "string" || !secret) throw new Error("Stripe returned no signing secret for the new endpoint");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

const USAGE = `Usage: node scripts/stripe-setup.mjs [--mode test|live] [--site <url>] [--dry-run] [--secret-file <path>]`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if ("error" in opts) {
    console.error(`${opts.error}\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  try {
    await setup(opts);
  } catch (err) {
    console.error(`\nstripe-setup failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) void main();
