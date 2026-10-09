/**
 * scripts/stripe-setup.mjs and the referral link (2026-10-09, "give a month, get a month"): a second
 * Payment Link for the MONTHLY price with a 30-day trial that agrees with the app
 * (src/lib/billing/planChoice.ts), carries the plan's tags so the webhook takes its subscriptions as
 * Unlimited, and is kept apart from the LIVE monthly link: a run on an account that has only the
 * monthly plan adds it and writes nothing to the rest. Offline: a fake Stripe stands in for the CLI.
 */
import { describe, expect, it } from "vitest";
import {
  APP_TAG,
  REFERRAL,
  REFERRAL_CHECKOUT_NOTE,
  UNLIMITED,
  envLines,
  findReferralLink,
  findUnlimitedLink,
  formFields,
  metadataKeys,
  offerOf,
  referralLinkBody,
  setup,
  unlimitedLinkBody,
} from "../../scripts/stripe-setup.mjs";
import { REFERRAL_TRIAL_DAYS } from "@/lib/billing/planChoice";
import { UNLIMITED_PLAN, parseUnlimitedLink } from "@/lib/billing/unlimited";
import { mapBillingEvent } from "@/lib/server/billingWebhook";

const SITE = "https://a.example.com";
const TAG = { app: APP_TAG, plan_id: "unlimited" };

describe("the referral link", () => {
  it("agrees with the app: the monthly price, 30 days free", () => {
    expect(REFERRAL).toEqual({ offer: "referral", trialDays: 30 });
    expect(REFERRAL.trialDays).toBe(REFERRAL_TRIAL_DAYS);
    expect(UNLIMITED.priceCents).toBe(UNLIMITED_PLAN.monthlyUsd * 100);
  });

  it("is the monthly link's shape with the 30-day trial and offer = referral", () => {
    const body = referralLinkBody("price_m", SITE);
    const monthly = unlimitedLinkBody("price_m", SITE);
    expect(body.line_items).toEqual(monthly.line_items);
    expect(body.after_completion).toEqual(monthly.after_completion);
    expect(body.payment_method_collection).toBe("always");
    expect(body.allow_promotion_codes).toBe(false);
    expect(body.subscription_data).toEqual({ trial_period_days: 30, metadata: { ...TAG, offer: "referral" } });
    expect(body.metadata).toEqual({ ...TAG, price_id: "price_m", trial_days: "30", offer: "referral" });
    expect(body.custom_text.submit.message).toBe(REFERRAL_CHECKOUT_NOTE);
    // the price is read from the plan, never written down twice
    expect(REFERRAL_CHECKOUT_NOTE).toBe(
      `Your first month is free, then $${UNLIMITED_PLAN.monthlyUsd} a month until you cancel. Cancel before the 30 days are up and you won't be charged.`,
    );
    expect(body).not.toHaveProperty("submit_type");
    expect(body).not.toHaveProperty("payment_intent_data");
  });

  it("its checkouts and subscriptions are Agathon Unlimited to the webhook", () => {
    const body = referralLinkBody("price_m", SITE);
    const session = { id: "cs_r", mode: "subscription", subscription: "sub_r", client_reference_id: "8d2a3f1e-4b6c-4d7e-9f01-23456789abcd", metadata: body.metadata };
    expect(mapBillingEvent({ id: "evt", type: "checkout.session.completed", data: { object: session } }, {})).toMatchObject({ kind: "link" });
    const sub = { id: "sub_r", status: "trialing", metadata: body.subscription_data.metadata };
    expect(mapBillingEvent({ id: "evt2", type: "customer.subscription.created", data: { object: sub } }, {})).toMatchObject({ kind: "subscription" });
  });

  it("nothing in it looks like Fuime's", () => {
    const body = referralLinkBody("price_x", SITE);
    expect(metadataKeys(body).filter((k) => /^fuime/i.test(k))).toEqual([]);
    expect(formFields(body).map(([k]) => k).filter((k) => /fuime/i.test(k))).toEqual([]);
  });

  it("is found by its price, trial and offer, and the monthly lookup never takes it", () => {
    const referral = { id: "plink_r", created: 0, active: true, metadata: { ...TAG, price_id: "price_m", trial_days: "30", offer: "referral" } };
    // even a referral link with the monthly trial (a hand edit) is not the monthly link
    const referral7 = { id: "plink_r7", created: 0, active: true, metadata: { ...TAG, price_id: "price_m", trial_days: "7", offer: "referral" } };
    const monthly = { id: "plink_m", created: 1, active: true, metadata: { ...TAG, price_id: "price_m", trial_days: "7" } };
    expect(offerOf(monthly)).toBe("monthly");
    expect(offerOf(referral)).toBe("referral");
    expect(findReferralLink([referral7, referral, monthly], "price_m")?.id).toBe("plink_r");
    expect(findReferralLink([referral], "price_other")).toBeNull();
    expect(findUnlimitedLink([referral7, referral, monthly], "price_m")?.id).toBe("plink_m");
  });

  it("is printed in the form the app reads, after the monthly link", () => {
    const lines = envLines({ links: {}, priceMap: {}, unlimitedLink: "https://buy.stripe.com/m", referralLink: "https://buy.stripe.com/r", portalUrl: "https://billing.stripe.com/p/login/p" });
    expect(lines.slice(2)).toEqual([
      "NEXT_PUBLIC_UNLIMITED_LINK=https://buy.stripe.com/m",
      "NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK=https://buy.stripe.com/r",
      "NEXT_PUBLIC_BILLING_PORTAL_URL=https://billing.stripe.com/p/login/p",
    ]);
    expect(parseUnlimitedLink(lines[3].split("=")[1])).toBe("https://buy.stripe.com/r");
  });
});

/* ------------------------------------------------------------------------- */
/* A run on an account that sells only the monthly plan (production today)    */
/* ------------------------------------------------------------------------- */

type Obj = Record<string, unknown> & { id: string; created: number };

/** A minimal fake Stripe: lists, creates and updates, recording every write. */
function fakeStripe() {
  let seq = 100;
  const db = { products: [] as Obj[], prices: [] as Obj[], links: [] as Obj[], configs: [] as Obj[] };
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const make = (prefix: string, body: Record<string, unknown>): Obj => ({ id: `${prefix}_${++seq}`, created: seq, active: true, ...body });
  const list = (data: Obj[]) => ({ object: "list", data, has_more: false });
  const byId = (arr: Obj[], id: string): Obj => {
    const found = arr.find((x) => x.id === id);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };
  const api = {
    async get(path: string, params: Record<string, unknown> = {}) {
      if (path === "/v1/account") return { id: "acct_fake" };
      if (path === "/v1/products") return list(db.products.filter((p) => p.active));
      if (path === "/v1/prices") return list(db.prices.filter((p) => p.active === (params.active !== "false") && p.product === params.product));
      if (path === "/v1/payment_links") return list(db.links.filter((l) => l.active));
      if (path === "/v1/billing_portal/configurations") return list(db.configs.filter((c) => c.active));
      if (path === "/v1/webhook_endpoints") return list([]);
      throw new Error(`unexpected GET ${path}`);
    },
    async post(path: string, body: Record<string, unknown> = {}) {
      posts.push({ path, body });
      let m: RegExpMatchArray | null;
      if (path === "/v1/products") return db.products.push(make("prod", body)) && db.products.at(-1);
      if ((m = path.match(/^\/v1\/products\/(.+)$/))) return Object.assign(byId(db.products, m[1]), body);
      if (path === "/v1/prices") return db.prices.push(make("price", body)) && db.prices.at(-1);
      if ((m = path.match(/^\/v1\/prices\/(.+)$/))) return Object.assign(byId(db.prices, m[1]), body);
      if (path === "/v1/payment_links") return db.links.push({ ...make("plink", body), url: `https://buy.stripe.com/test_${seq}` }) && db.links.at(-1);
      if ((m = path.match(/^\/v1\/payment_links\/(.+)$/))) return Object.assign(byId(db.links, m[1]), body);
      if (path === "/v1/billing_portal/configurations") {
        return db.configs.push({ ...make("bpc", body), login_page: { enabled: true, url: "https://billing.stripe.com/p/login/test" } }) && db.configs.at(-1);
      }
      if ((m = path.match(/^\/v1\/billing_portal\/configurations\/(.+)$/))) return Object.assign(byId(db.configs, m[1]), body);
      throw new Error(`unexpected POST ${path}`);
    },
  };
  return { api, db, posts };
}

describe("setup() on an account with the monthly plan only", () => {
  const local = { mode: "test" as const, site: "http://localhost:3000", dryRun: false, secretFile: null, help: false };

  /** What a run before the referral link made: the packs and the monthly plan, exactly as the script makes them. */
  async function monthlyOnlyAccount() {
    const stripe = fakeStripe();
    await setup(local, { api: stripe.api, log: () => undefined, writeSecret: () => undefined });
    stripe.db.links = stripe.db.links.filter((l) => offerOf(l) !== "referral");
    stripe.posts.length = 0;
    return stripe;
  }

  it("adds the referral link for the monthly price, and writes nothing else", async () => {
    const stripe = await monthlyOnlyAccount();
    const result = await setup(local, { api: stripe.api, log: () => undefined, writeSecret: () => undefined });
    expect(stripe.posts.map((p) => p.path)).toEqual(["/v1/payment_links"]);
    expect(result.referralLink).toMatch(/^https:\/\/buy\.stripe\.com\//);
    expect(result.env).toContain(`NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK=${result.referralLink}`);
    const monthlyPrice = stripe.db.prices.find((p) => (p.metadata as Record<string, string>).plan_id === UNLIMITED.id)!;
    const referral = stripe.db.links.find((l) => l.url === result.referralLink)!;
    expect(referral.line_items).toEqual([{ price: monthlyPrice.id, quantity: 1 }]);
    // the monthly link is still the one, still active
    expect(stripe.db.links.filter((l) => l.active === false)).toEqual([]);
    expect(result.unlimitedLink).not.toBe(result.referralLink);
  });

  it("a dry run reads, writes nothing, and says it would make it", async () => {
    const stripe = await monthlyOnlyAccount();
    const log: string[] = [];
    const result = await setup({ ...local, dryRun: true }, { api: stripe.api, log: (l: string) => log.push(l), writeSecret: () => undefined });
    expect(stripe.posts).toEqual([]);
    const text = log.join("\n");
    expect(text).toMatch(/would create referral Payment Link \(30-day trial, card up front\) redirecting to http:\/\/localhost:3000\/\?unlimited=started/);
    expect(text).toMatch(/NEXT_PUBLIC_UNLIMITED_REFERRAL_LINK: \(printed by the real run\)/);
    expect(text).not.toMatch(/would (archive|deactivate)/);
    expect(result.referralLink).toBeNull();
    expect(result.unlimitedLink).toMatch(/^https:\/\//);
  });
});
