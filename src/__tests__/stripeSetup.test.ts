/**
 * Unit tests for scripts/stripe-setup.mjs: argument parsing, the request bodies, how existing
 * objects are found again (idempotency), the env output, and that the script's prices agree with
 * `public.plans`. Offline: a fake Stripe stands in for the CLI.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_TAG,
  PLANS,
  WEBHOOK_EVENTS,
  envLines,
  findPaymentLink,
  findPrice,
  findProduct,
  findWebhook,
  formFields,
  isLocalSite,
  normalizeSite,
  parseArgs,
  paymentLinkBody,
  portalBody,
  redactSecrets,
  setup,
  upgradeReturnUrl,
  webhookBody,
  webhookHasEvents,
} from "../../scripts/stripe-setup.mjs";
import { mapBillingEvent } from "@/app/api/billing/webhook/route";
import { parseBillingLinks, parseBillingPriceMap } from "@/lib/env";

const ROOT = resolve(__dirname, "..", "..");

describe("parseArgs", () => {
  it("defaults to test mode on localhost:3000", () => {
    expect(parseArgs([])).toEqual({ mode: "test", site: "http://localhost:3000", dryRun: false, secretFile: null, help: false });
  });
  it("reads --mode, --site (origin only), --dry-run and --secret-file, with = or a space", () => {
    expect(parseArgs(["--mode=live", "--site", "https://whiteboard.rushilchopra.com/account/", "--dry-run", "--secret-file", "/tmp/x"])).toEqual({
      mode: "live",
      site: "https://whiteboard.rushilchopra.com",
      dryRun: true,
      secretFile: "/tmp/x",
      help: false,
    });
  });
  it("rejects an unknown mode, a bad site, a missing value, an unknown flag, and live on localhost", () => {
    expect(parseArgs(["--mode", "prod"])).toMatchObject({ error: /test or live/ });
    expect(parseArgs(["--site", "ftp://x"])).toMatchObject({ error: /http\(s\)/ });
    expect(parseArgs(["--site"])).toMatchObject({ error: /needs a value/ });
    expect(parseArgs(["--site", "--dry-run"])).toMatchObject({ error: /needs a value/ });
    expect(parseArgs(["--live"])).toMatchObject({ error: /unknown argument/ });
    expect(parseArgs(["--mode", "live"])).toMatchObject({ error: /public --site/ });
  });
});

describe("site helpers", () => {
  it("normalizes to the origin and knows local hosts", () => {
    expect(normalizeSite(" https://a.example.com/x?y=1 ")).toBe("https://a.example.com");
    expect(normalizeSite("javascript:alert(1)")).toBeNull();
    expect(isLocalSite("http://localhost:3112")).toBe(true);
    expect(isLocalSite("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalSite("https://whiteboard.rushilchopra.com")).toBe(false);
    expect(upgradeReturnUrl("https://a.example.com", "plus")).toBe("https://a.example.com/account?upgraded=plus");
  });
});

describe("formFields", () => {
  it("encodes nested objects and arrays the way Stripe's form API expects", () => {
    expect(formFields({ a: 1, b: { c: "x", d: [{ e: true }, "f"] }, skip: undefined, nil: null })).toEqual([
      ["a", "1"],
      ["b[c]", "x"],
      ["b[d][0][e]", "true"],
      ["b[d][1]", "f"],
    ]);
  });
});

describe("request bodies", () => {
  const plus = PLANS.find((p) => p.id === "plus")!;

  it("a Payment Link redirects to the account page and tags the session with the plan", () => {
    const body = paymentLinkBody(plus, "price_1", "https://a.example.com");
    expect(body.after_completion).toEqual({ type: "redirect", redirect: { url: "https://a.example.com/account?upgraded=plus" } });
    expect(body.metadata).toEqual({ app: APP_TAG, plan_id: "plus", price_id: "price_1" });
    // the subscription's plan is its price: no plan_id there, or a portal switch would be undone
    expect(body.subscription_data.metadata).toEqual({ app: APP_TAG });
    expect(body.line_items).toEqual([{ price: "price_1", quantity: 1 }]);
  });

  it("the portal switches plans, cancels at period end, updates cards and has a login page", () => {
    const body = portalBody("https://a.example.com", [
      { product: "prod_plus", price: "price_plus" },
      { product: "prod_pro", price: "price_pro" },
    ]);
    expect(body.default_return_url).toBe("https://a.example.com/account");
    expect(body.login_page).toEqual({ enabled: true });
    expect(body.features.subscription_cancel).toMatchObject({ enabled: true, mode: "at_period_end" });
    expect(body.features.payment_method_update).toEqual({ enabled: true });
    expect(body.features.subscription_update.default_allowed_updates).toEqual(["price"]);
    expect(body.features.subscription_update.products).toEqual([
      { product: "prod_plus", prices: ["price_plus"], adjustable_quantity: { enabled: false } },
      { product: "prod_pro", prices: ["price_pro"], adjustable_quantity: { enabled: false } },
    ]);
    // Stripe caps the headline at 60 characters
    expect(body.business_profile.headline.length).toBeLessThanOrEqual(60);
  });

  it("the webhook listens to exactly the events the route handles", () => {
    const body = webhookBody("https://a.example.com");
    expect(body.url).toBe("https://a.example.com/api/billing/webhook");
    expect(body.enabled_events).toEqual([...WEBHOOK_EVENTS]);
    for (const type of WEBHOOK_EVENTS) {
      const mapped = mapBillingEvent({ id: "evt", type, data: { object: {} } }, {});
      if (mapped.kind === "ignored") expect(mapped.reason).not.toMatch(/unhandled event type/);
    }
    expect(webhookHasEvents({ enabled_events: [...WEBHOOK_EVENTS, "invoice.paid"] })).toBe(true);
    expect(webhookHasEvents({ enabled_events: ["checkout.session.completed"] })).toBe(false);
    expect(webhookHasEvents({ enabled_events: ["*"] })).toBe(true);
  });
});

describe("finding what exists", () => {
  const plus = PLANS.find((p) => p.id === "plus")!;
  const ours = { app: APP_TAG, plan_id: "plus" };

  it("finds our product by metadata, never someone else's product with the same name", () => {
    const products = [
      { id: "prod_other", name: "Agathon Plus", active: true, created: 1, metadata: {} },
      { id: "prod_old", active: false, created: 2, metadata: ours },
      { id: "prod_ours", active: true, created: 3, metadata: ours },
      { id: "prod_dup", active: true, created: 4, metadata: ours },
    ];
    expect(findProduct(products, "plus")?.id).toBe("prod_ours");
    expect(findProduct(products, "pro")).toBeNull();
  });

  it("finds a price only with the exact amount, currency and monthly interval", () => {
    const base = { active: true, product: "prod_1", currency: "usd", recurring: { interval: "month", interval_count: 1 } };
    const prices = [
      { ...base, id: "price_wrong_amount", unit_amount: 1000 },
      { ...base, id: "price_yearly", unit_amount: plus.priceCents, recurring: { interval: "year" } },
      { ...base, id: "price_other_product", unit_amount: plus.priceCents, product: "prod_2" },
      { ...base, id: "price_ok", unit_amount: plus.priceCents },
    ];
    expect(findPrice(prices, plus, "prod_1")?.id).toBe("price_ok");
    expect(findPrice(prices.slice(0, 3), plus, "prod_1")).toBeNull();
  });

  it("finds the Payment Link selling that exact price, and the webhook by URL + tag", () => {
    const links = [
      { id: "plink_old", active: true, metadata: { ...ours, price_id: "price_old" } },
      { id: "plink_ok", active: true, metadata: { ...ours, price_id: "price_ok" } },
    ];
    expect(findPaymentLink(links, "plus", "price_ok")?.id).toBe("plink_ok");
    expect(findPaymentLink(links, "plus", "price_new")).toBeNull();
    const hooks = [
      { id: "we_fuime", url: "https://app.fuime.com/hook", metadata: {} },
      { id: "we_ours", url: "https://a.example.com/api/billing/webhook", metadata: { app: APP_TAG } },
    ];
    expect(findWebhook(hooks, "https://a.example.com/api/billing/webhook")?.id).toBe("we_ours");
    expect(findWebhook(hooks, "https://app.fuime.com/hook")).toBeNull();
  });
});

describe("output", () => {
  it("prints env values the app itself parses", () => {
    const [links, map] = envLines({
      links: { plus: "https://buy.stripe.com/test_a", pro: "https://buy.stripe.com/test_b" },
      portal: "https://billing.stripe.com/p/login/test_c",
      priceMap: { price_a: "plus", price_b: "pro" },
    });
    expect(links.startsWith("NEXT_PUBLIC_BILLING_LINKS=")).toBe(true);
    expect(parseBillingLinks(links.slice("NEXT_PUBLIC_BILLING_LINKS=".length))).toEqual({
      plus: "https://buy.stripe.com/test_a",
      pro: "https://buy.stripe.com/test_b",
      portal: "https://billing.stripe.com/p/login/test_c",
    });
    expect(parseBillingPriceMap(map.slice("BILLING_PRICE_MAP=".length))).toEqual({ map: { price_a: "plus", price_b: "pro" } });
  });

  it("masks anything shaped like a Stripe secret", () => {
    expect(redactSecrets("bad key sk_test_abc123 and whsec_XYZ and rk_live_q")).toBe("bad key sk_[redacted] and whsec_[redacted] and rk_[redacted]");
  });
});

describe("prices agree with public.plans", () => {
  it("PLANS matches the paid-plans migration (monthly credits and price in cents)", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20260928110000_paid_plans.sql"), "utf8");
    for (const plan of PLANS) {
      const m = sql.match(new RegExp(`set monthly_credits = (\\d+),\\s*price_cents = (\\d+)\\s*where id = '${plan.id}'`));
      expect(m, `no UPDATE for ${plan.id}`).not.toBeNull();
      expect(Number(m![1])).toBe(plan.credits);
      expect(Number(m![2])).toBe(plan.priceCents);
    }
    expect(sql).toMatch(/set monthly_credits = 300,[\s\S]*?where id = 'free'/);
  });
});

/* ------------------------------------------------------------------------- */
/* The whole run against a fake Stripe                                        */
/* ------------------------------------------------------------------------- */

type Obj = Record<string, unknown> & { id: string; created: number };

function fakeStripe() {
  let seq = 0;
  const db = {
    products: [] as Obj[],
    prices: [] as Obj[],
    links: [] as Obj[],
    configs: [] as Obj[],
    hooks: [] as Obj[],
  };
  const posts: string[] = [];
  const make = (prefix: string, body: Record<string, unknown>): Obj => ({ id: `${prefix}_${++seq}`, created: seq, active: true, ...body });
  const list = (data: Obj[]) => ({ object: "list", data, has_more: false });
  const byId = (arr: Obj[], id: string) => {
    const o = arr.find((x) => x.id === id);
    if (!o) throw new Error(`no ${id}`);
    return o;
  };
  const api = {
    async get(path: string, params: Record<string, unknown> = {}) {
      if (path === "/v1/account") return { id: "acct_fake", settings: { dashboard: { display_name: "Fake" } } };
      if (path === "/v1/products") return list(db.products.filter((p) => p.active));
      if (path === "/v1/prices") return list(db.prices.filter((p) => p.active === (params.active !== "false") && p.product === params.product));
      if (path === "/v1/payment_links") return list(db.links.filter((l) => l.active));
      if (path === "/v1/billing_portal/configurations") return list(db.configs);
      if (path === "/v1/webhook_endpoints") return list(db.hooks);
      throw new Error(`unexpected GET ${path}`);
    },
    async post(path: string, body: Record<string, unknown> = {}) {
      posts.push(path);
      let m: RegExpMatchArray | null;
      if (path === "/v1/products") return db.products.push(make("prod", body)) && db.products.at(-1);
      if ((m = path.match(/^\/v1\/products\/(.+)$/))) return Object.assign(byId(db.products, m[1]), body);
      if (path === "/v1/prices") return db.prices.push(make("price", body)) && db.prices.at(-1);
      if ((m = path.match(/^\/v1\/prices\/(.+)$/))) return Object.assign(byId(db.prices, m[1]), body);
      if (path === "/v1/payment_links") {
        const link = make("plink", body);
        link.url = `https://buy.stripe.com/test_${link.id}`;
        db.links.push(link);
        return link;
      }
      if ((m = path.match(/^\/v1\/payment_links\/(.+)$/))) return Object.assign(byId(db.links, m[1]), body);
      if (path === "/v1/billing_portal/configurations") {
        const c = make("bpc", body);
        c.login_page = { enabled: true, url: `https://billing.stripe.com/p/login/test_${c.id}` };
        db.configs.push(c);
        return c;
      }
      if ((m = path.match(/^\/v1\/billing_portal\/configurations\/(.+)$/))) {
        const c = byId(db.configs, m[1]);
        const { login_page: _lp, ...rest } = body;
        void _lp;
        return Object.assign(c, rest);
      }
      if (path === "/v1/webhook_endpoints") return db.hooks.push({ ...make("we", body), secret: "whsec_fake_secret" }) && db.hooks.at(-1);
      if ((m = path.match(/^\/v1\/webhook_endpoints\/(.+)$/))) return Object.assign(byId(db.hooks, m[1]), body);
      throw new Error(`unexpected POST ${path}`);
    },
  };
  return { api, db, posts };
}

describe("setup()", () => {
  const live = { mode: "live" as const, site: "https://a.example.com", dryRun: false, secretFile: "/tmp/never-written", help: false };

  it("creates everything once, and a second run creates nothing", async () => {
    const stripe = fakeStripe();
    const log: string[] = [];
    const secrets: Array<[string, string]> = [];
    const deps = { api: stripe.api, log: (l: string) => log.push(l), writeSecret: (f: string, s: string) => secrets.push([f, s]) };

    const first = await setup(live, deps);
    expect(stripe.db.products).toHaveLength(2);
    expect(stripe.db.prices).toHaveLength(2);
    expect(stripe.db.links).toHaveLength(2);
    expect(stripe.db.configs).toHaveLength(1);
    expect(stripe.db.hooks).toHaveLength(1);
    expect(secrets).toEqual([["/tmp/never-written", "whsec_fake_secret"]]);
    expect(log.join("\n")).not.toContain("whsec_fake_secret");
    expect(Object.keys(first.links)).toEqual(["plus", "pro"]);
    expect(Object.values(first.priceMap).sort()).toEqual(["plus", "pro"]);
    expect(first.portal).toMatch(/^https:\/\/billing\.stripe\.com\/p\/login\//);

    stripe.posts.length = 0;
    const second = await setup(live, deps);
    const creates = stripe.posts.filter((p) => /^\/v1\/(products|prices|payment_links|webhook_endpoints|billing_portal\/configurations)$/.test(p));
    expect(creates).toEqual([]);
    expect(second.links).toEqual(first.links);
    expect(second.priceMap).toEqual(first.priceMap);
    expect(secrets).toHaveLength(1);
  });

  it("a changed price makes a new price + link and retires the old ones; a new site only moves the redirect", async () => {
    const stripe = fakeStripe();
    const deps = { api: stripe.api, log: () => undefined, writeSecret: () => undefined };
    const first = await setup(live, deps);

    // the stored Plus price no longer matches PLANS: the same as the owner editing PLANS (which is frozen here)
    const plusPrice = stripe.db.prices.find((p) => (p.metadata as Record<string, string>).plan_id === "plus")!;
    plusPrice.unit_amount = 900;
    const second = await setup(live, deps);
    expect(second.links.plus).not.toBe(first.links.plus);
    expect(second.links.pro).toBe(first.links.pro);
    expect(plusPrice.active).toBe(false);
    // the archived price keeps mapping to its plan: its subscribers still bill on it
    expect(second.priceMap[plusPrice.id]).toBe("plus");
    expect(Object.keys(second.priceMap)).toHaveLength(3);
    expect(stripe.db.links.filter((l) => l.active && (l.metadata as Record<string, string>).plan_id === "plus")).toHaveLength(1);

    const moved = await setup({ ...live, site: "https://b.example.com" }, deps);
    expect(moved.links).toEqual(second.links);
    const plusLink = stripe.db.links.find((l) => l.url === moved.links.plus)!;
    expect(plusLink.after_completion).toEqual({ type: "redirect", redirect: { url: "https://b.example.com/account?upgraded=plus" } });
    expect(stripe.db.hooks).toHaveLength(2); // one per site URL
  });

  it("makes no webhook for a local site and writes nothing in a dry run", async () => {
    const stripe = fakeStripe();
    const deps = { api: stripe.api, log: () => undefined, writeSecret: () => undefined };
    await setup({ ...live, mode: "test", site: "http://localhost:3112" }, deps);
    expect(stripe.db.hooks).toHaveLength(0);

    const dry = fakeStripe();
    await setup({ ...live, dryRun: true }, { api: dry.api, log: () => undefined, writeSecret: () => undefined });
    expect(dry.posts).toEqual([]);
  });
});
