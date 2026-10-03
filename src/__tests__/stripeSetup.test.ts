/**
 * Unit tests for scripts/stripe-setup.mjs: argument parsing, the request bodies, how existing
 * objects are found again (idempotency), the env output, that the script's packs agree with
 * `public.ink_packs`, and that on the account it shares with Fuime it never writes to anything
 * that is not tagged as Agathon's. Offline: a fake Stripe stands in for the CLI.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_TAG,
  PACKS,
  RETIRED_PLAN_IDS,
  STATEMENT_DESCRIPTOR_SUFFIX,
  WEBHOOK_EVENTS,
  envLines,
  findPaymentLink,
  findPrice,
  findProduct,
  findWebhook,
  formFields,
  guardedApi,
  inkReturnUrl,
  isLocalSite,
  listAll,
  metadataKeys,
  normalizeSite,
  parseArgs,
  paymentLinkBody,
  priceBody,
  productBody,
  redactSecrets,
  retiredObjects,
  setup,
  webhookBody,
  webhookEventsMatch,
} from "../../scripts/stripe-setup.mjs";
import { APP_TAG as WEBHOOK_APP_TAG, HANDLED_EVENTS, mapBillingEvent } from "@/lib/server/billingWebhook";
import { parseInkPriceMap } from "@/lib/env";
import { parseBillingLinks } from "@/lib/billing/checkout";

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
  it("refuses test-mode objects that point at production (a test webhook endpoint there), except as a read-only dry run", () => {
    expect(parseArgs(["--mode", "test", "--site", "https://whiteboard.rushilchopra.com"])).toMatchObject({ error: /must not point at https:\/\/whiteboard\.rushilchopra\.com/ });
    expect(parseArgs(["--site", "https://whiteboard.rushilchopra.com/"])).toMatchObject({ error: /must not point at/ });
    expect(parseArgs(["--mode", "test", "--site", "https://whiteboard.rushilchopra.com", "--dry-run"])).toMatchObject({ mode: "test", dryRun: true });
    expect(parseArgs(["--mode", "test", "--site", "https://preview-abc.vercel.app"])).toMatchObject({ mode: "test", site: "https://preview-abc.vercel.app" });
  });
});

describe("site helpers", () => {
  it("normalizes to the origin and knows local hosts", () => {
    expect(normalizeSite(" https://a.example.com/x?y=1 ")).toBe("https://a.example.com");
    expect(normalizeSite("javascript:alert(1)")).toBeNull();
    expect(isLocalSite("http://localhost:3112")).toBe(true);
    expect(isLocalSite("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalSite("https://whiteboard.rushilchopra.com")).toBe(false);
    expect(inkReturnUrl("https://a.example.com", "medium")).toBe("https://a.example.com/account?ink=medium");
  });
});

describe("formFields", () => {
  it("encodes nested objects and arrays the way Stripe's form API expects", () => {
    expect(formFields({ a: 1, b: { c: "x", d: [{ e: true }, "f"] }, skip: undefined, nil: null, empty: "" })).toEqual([
      ["a", "1"],
      ["b[c]", "x"],
      ["b[d][0][e]", "true"],
      ["b[d][1]", "f"],
      ["empty", ""],
    ]);
  });
});

describe("request bodies", () => {
  const medium = PACKS.find((p) => p.id === "medium")!;

  it("a pack is a product with a ONE-TIME price, both tagged with the pack", () => {
    expect(productBody(medium)).toEqual({
      name: "Agathon Medium ink pack",
      description: "5,000 ink for the AI tutor. Ink never expires.",
      metadata: { app: APP_TAG, pack_id: "medium" },
    });
    const price = priceBody(medium, "prod_1");
    expect(price).toEqual({
      product: "prod_1",
      currency: "usd",
      unit_amount: 2000,
      nickname: "Medium ink pack",
      metadata: { app: APP_TAG, pack_id: "medium", ink: 5000 },
    });
    expect(price).not.toHaveProperty("recurring");
  });

  it("a Payment Link sells one pack, tags the session and the payment intent, and comes back to the account page", () => {
    const body = paymentLinkBody(medium, "price_1", "https://a.example.com");
    expect(body.line_items).toEqual([{ price: "price_1", quantity: 1 }]);
    expect(body.after_completion).toEqual({ type: "redirect", redirect: { url: "https://a.example.com/account?ink=medium" } });
    expect(body.metadata).toEqual({ app: APP_TAG, pack_id: "medium", price_id: "price_1" });
    expect(body.payment_intent_data).toEqual({ metadata: { app: APP_TAG, pack_id: "medium" }, statement_descriptor_suffix: "AGATHON" });
    // no promotion codes: the shared account's coupons must never make a pack free
    expect(body.allow_promotion_codes).toBe(false);
    // Stripe: the suffix is at most 22 characters, letters, digits and spaces, not all digits
    expect(STATEMENT_DESCRIPTOR_SUFFIX).toMatch(/^(?=.*[A-Z])[A-Z0-9 ]{1,22}$/);
  });

  it("the webhook listens to exactly the events the route handles", () => {
    const body = webhookBody("https://a.example.com");
    expect(body.url).toBe("https://a.example.com/api/billing/webhook");
    expect(body.enabled_events).toEqual([...WEBHOOK_EVENTS]);
    expect([...WEBHOOK_EVENTS]).toEqual([...HANDLED_EVENTS]);
    for (const type of WEBHOOK_EVENTS) {
      const mapped = mapBillingEvent({ id: "evt", type, data: { object: { metadata: { app: APP_TAG } } } }, {});
      if (mapped.kind === "foreign" || mapped.kind === "ignored") expect(mapped.reason).not.toMatch(/unhandled event type/);
    }
    expect(webhookEventsMatch({ enabled_events: [...WEBHOOK_EVENTS] })).toBe(true);
    // the plan-era events are dropped, not kept alongside
    expect(webhookEventsMatch({ enabled_events: [...WEBHOOK_EVENTS, "customer.subscription.updated"] })).toBe(false);
    expect(webhookEventsMatch({ enabled_events: ["checkout.session.completed"] })).toBe(false);
    expect(webhookEventsMatch({ enabled_events: ["*"] })).toBe(false);
  });

  it("the script and the webhook agree on the tag", () => {
    expect(APP_TAG).toBe("agathon-classroom");
    expect(WEBHOOK_APP_TAG).toBe(APP_TAG);
  });
});

describe("shared account: nothing of ours looks like Fuime's", () => {
  it("no metadata key in any body the script sends starts with fuime", () => {
    const bodies: Array<Record<string, unknown>> = PACKS.flatMap((pack) => [productBody(pack), priceBody(pack, "prod_x"), paymentLinkBody(pack, "price_x", "https://a.example.com")]);
    bodies.push(webhookBody("https://a.example.com"));
    const keys = bodies.flatMap((b) => metadataKeys(b));
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.filter((k) => /^fuime/i.test(k))).toEqual([]);
    // and on the wire: no form field with a fuime metadata key either
    const fields = bodies.flatMap((b) => formFields(b).map(([k]) => k));
    expect(fields.filter((k) => /\[metadata\]\[fuime/i.test(k) || /^metadata\[fuime/i.test(k))).toEqual([]);
  });

  it("metadataKeys finds keys at any depth, and only under metadata", () => {
    expect(metadataKeys({ metadata: { a: 1 }, payment_intent_data: { metadata: { b: 2 }, x: 3 }, c: { d: 4 } }).sort()).toEqual(["a", "b"]);
  });

  it("the write guard refuses fuime keys, untagged creates and writes to objects not known to be ours", async () => {
    const posts: string[] = [];
    const inner = {
      get: async () => ({}),
      post: async (p: string) => {
        posts.push(p);
        return { id: "prod_new" };
      },
    };
    const ours = new Set(["prod_ours"]);
    const api = guardedApi(inner, ours);
    await expect(api.post("/v1/products", { name: "x", metadata: { app: APP_TAG, fuime_event_id: "e" } })).rejects.toThrow(/fuime_event_id/);
    await expect(api.post("/v1/payment_links", { payment_intent_data: { metadata: { Fuime_x: "1" } }, metadata: { app: APP_TAG } })).rejects.toThrow(/Fuime_x/);
    await expect(api.post("/v1/products", { name: "x", metadata: {} })).rejects.toThrow(/without metadata\.app/);
    await expect(api.post("/v1/products/prod_fuime", { active: false })).rejects.toThrow(/not an object tagged/);
    await expect(api.post("/v1/billing_portal/configurations/bpc_default", { active: false })).rejects.toThrow(/not an object tagged/);
    expect(posts).toEqual([]);
    await api.post("/v1/products/prod_ours", { active: false });
    await api.post("/v1/products", { name: "x", metadata: { app: APP_TAG } });
    expect(ours.has("prod_new")).toBe(true); // a created object may be updated later in the run
    expect(posts).toEqual(["/v1/products/prod_ours", "/v1/products"]);
  });
});

describe("finding what exists", () => {
  const medium = PACKS.find((p) => p.id === "medium")!;
  const ours = { app: APP_TAG, pack_id: "medium" };

  it("finds our product by metadata, never someone else's product with the same name", () => {
    const products = [
      { id: "prod_other", name: "Agathon Medium ink pack", active: true, created: 1, metadata: {} },
      { id: "prod_old", active: false, created: 2, metadata: ours },
      { id: "prod_ours", active: true, created: 3, metadata: ours },
      { id: "prod_dup", active: true, created: 4, metadata: ours },
    ];
    expect(findProduct(products, "medium")?.id).toBe("prod_ours");
    expect(findProduct(products, "large")).toBeNull();
  });

  it("finds a price only when it is ours, one-time, with the exact amount and currency", () => {
    const base = { active: true, product: "prod_1", currency: "usd", type: "one_time", metadata: ours };
    const prices = [
      { ...base, id: "price_wrong_amount", unit_amount: 1000 },
      { ...base, id: "price_monthly", unit_amount: medium.priceCents, type: "recurring", recurring: { interval: "month" } },
      { ...base, id: "price_other_product", unit_amount: medium.priceCents, product: "prod_2" },
      { ...base, id: "price_untagged", unit_amount: medium.priceCents, metadata: {} },
      { ...base, id: "price_ok", unit_amount: medium.priceCents },
    ];
    expect(findPrice(prices, medium, "prod_1")?.id).toBe("price_ok");
    expect(findPrice(prices.slice(0, 4), medium, "prod_1")).toBeNull();
  });

  it("finds the Payment Link selling that exact price, and the webhook by URL + tag", () => {
    const links = [
      { id: "plink_old", active: true, metadata: { ...ours, price_id: "price_old" } },
      { id: "plink_ok", active: true, metadata: { ...ours, price_id: "price_ok" } },
    ];
    expect(findPaymentLink(links, "medium", "price_ok")?.id).toBe("plink_ok");
    expect(findPaymentLink(links, "medium", "price_new")).toBeNull();
    const hooks = [
      { id: "we_fuime", url: "https://app.fuime.com/hook", metadata: {} },
      { id: "we_same_url_untagged", url: "https://a.example.com/api/billing/webhook", metadata: {} },
      { id: "we_ours", url: "https://a.example.com/api/billing/webhook", metadata: { app: APP_TAG } },
    ];
    expect(findWebhook(hooks, "https://a.example.com/api/billing/webhook")?.id).toBe("we_ours");
    expect(findWebhook(hooks, "https://app.fuime.com/hook")).toBeNull();
  });

  it("only our tagged Plus/Pro objects and our portal configuration are retired", () => {
    const found = retiredObjects({
      products: [
        { id: "prod_plus", active: true, metadata: { app: APP_TAG, plan_id: "plus" } },
        { id: "prod_medium", active: true, metadata: { app: APP_TAG, pack_id: "medium" } },
        { id: "prod_fuime_plus", active: true, metadata: { plan_id: "plus" } },
      ],
      links: [
        { id: "plink_pro", active: true, metadata: { app: APP_TAG, plan_id: "pro" } },
        { id: "plink_fuime", active: true, metadata: { fuime_event_id: "e" } },
      ],
      configs: [
        { id: "bpc_ours", active: true, metadata: { app: APP_TAG } },
        { id: "bpc_fuime_default", active: true, is_default: true, metadata: {} },
      ],
    });
    expect(found.products.map((p: { id: string }) => p.id)).toEqual(["prod_plus"]);
    expect(found.links.map((l: { id: string }) => l.id)).toEqual(["plink_pro"]);
    expect(found.configs.map((c: { id: string }) => c.id)).toEqual(["bpc_ours"]);
    expect([...RETIRED_PLAN_IDS]).toEqual(["plus", "pro"]);
  });
});

describe("listAll", () => {
  it("follows has_more to the very end (no page cap: the shared account can hold thousands of objects)", async () => {
    const pages = 75;
    let calls = 0;
    const api = {
      get: async (_path: string, params: Record<string, unknown> = {}) => {
        calls++;
        const page = params.starting_after ? Number(String(params.starting_after).slice(4)) + 1 : 0;
        return { data: [{ id: `obj_${page}` }], has_more: page < pages - 1 };
      },
      post: async () => ({}),
    };
    const all = await listAll(api, "/v1/products");
    expect(all).toHaveLength(pages);
    expect(calls).toBe(pages);
    expect(all.at(-1)).toEqual({ id: "obj_74" });
  });
});

describe("output", () => {
  it("prints env values the app itself parses", () => {
    const [links, map] = envLines({
      links: { small: "https://buy.stripe.com/test_a", medium: "https://buy.stripe.com/test_b", large: "https://buy.stripe.com/test_c" },
      priceMap: { price_a: "small", price_b: "medium", price_c: "large" },
    });
    expect(links.startsWith("NEXT_PUBLIC_BILLING_LINKS=")).toBe(true);
    expect(parseBillingLinks(links.slice("NEXT_PUBLIC_BILLING_LINKS=".length))).toEqual({
      small: "https://buy.stripe.com/test_a",
      medium: "https://buy.stripe.com/test_b",
      large: "https://buy.stripe.com/test_c",
    });
    expect(map.startsWith("INK_PRICE_MAP=")).toBe(true);
    expect(parseInkPriceMap(map.slice("INK_PRICE_MAP=".length))).toEqual({ map: { price_a: "small", price_b: "medium", price_c: "large" } });
  });

  it("masks anything shaped like a Stripe secret", () => {
    expect(redactSecrets("bad key sk_test_abc123 and whsec_XYZ and rk_live_q")).toBe("bad key sk_[redacted] and whsec_[redacted] and rk_[redacted]");
  });
});

describe("packs agree with public.ink_packs", () => {
  it("PACKS matches the ink migration's seed (id, name, ink, price in cents, order, all active, USD)", () => {
    const sql = readFileSync(join(ROOT, "supabase/migrations/20261002000000_ink.sql"), "utf8");
    const seed = [...sql.matchAll(/\('([a-z][a-z0-9_-]*)',\s*'([^']+)',\s*(\d+),\s*(\d+),\s*(\d+),\s*(true|false)\)/g)].map((m) => ({
      id: m[1],
      name: m[2],
      ink: Number(m[3]),
      priceCents: Number(m[4]),
      sort: Number(m[5]),
      active: m[6] === "true",
    }));
    expect(seed).toEqual(PACKS.map((p, i) => ({ id: p.id, name: p.name, ink: p.ink, priceCents: p.priceCents, sort: i + 1, active: true })));
    expect(PACKS.map((p) => [p.id, p.ink, p.priceCents])).toEqual([
      ["small", 1000, 500],
      ["medium", 5000, 2000],
      ["large", 14000, 5000],
    ]);
    expect(PACKS.every((p) => p.currency === "usd")).toBe(true);
  });
});

/* ------------------------------------------------------------------------- */
/* The whole run against a fake Stripe                                        */
/* ------------------------------------------------------------------------- */

type Obj = Record<string, unknown> & { id: string; created: number };

function fakeStripe(seed: { products?: Obj[]; prices?: Obj[]; links?: Obj[]; configs?: Obj[]; hooks?: Obj[] } = {}) {
  let seq = 100;
  const db = {
    products: [...(seed.products ?? [])],
    prices: [...(seed.prices ?? [])],
    links: [...(seed.links ?? [])],
    configs: [...(seed.configs ?? [])],
    hooks: [...(seed.hooks ?? [])],
  };
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
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
      if (path === "/v1/billing_portal/configurations") return list(db.configs.filter((c) => c.active));
      if (path === "/v1/webhook_endpoints") return list(db.hooks);
      throw new Error(`unexpected GET ${path}`);
    },
    async post(path: string, body: Record<string, unknown> = {}) {
      posts.push({ path, body });
      let m: RegExpMatchArray | null;
      if (path === "/v1/products") return db.products.push(make("prod", body)) && db.products.at(-1);
      if ((m = path.match(/^\/v1\/products\/(.+)$/))) return Object.assign(byId(db.products, m[1]), body);
      if (path === "/v1/prices") return db.prices.push(make("price", { type: "one_time", ...body })) && db.prices.at(-1);
      if ((m = path.match(/^\/v1\/prices\/(.+)$/))) return Object.assign(byId(db.prices, m[1]), body);
      if (path === "/v1/payment_links") {
        const link = make("plink", body);
        link.url = `https://buy.stripe.com/test_${link.id}`;
        db.links.push(link);
        return link;
      }
      if ((m = path.match(/^\/v1\/payment_links\/(.+)$/))) return Object.assign(byId(db.links, m[1]), body);
      if ((m = path.match(/^\/v1\/billing_portal\/configurations\/(.+)$/))) return Object.assign(byId(db.configs, m[1]), body);
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
    expect(stripe.db.products).toHaveLength(3);
    expect(stripe.db.prices).toHaveLength(3);
    expect(stripe.db.prices.every((p) => !("recurring" in p))).toBe(true);
    expect(stripe.db.links).toHaveLength(3);
    expect(stripe.db.hooks).toHaveLength(1);
    expect(stripe.db.hooks[0].enabled_events).toEqual([...WEBHOOK_EVENTS]);
    expect(secrets).toEqual([["/tmp/never-written", "whsec_fake_secret"]]);
    expect(log.join("\n")).not.toContain("whsec_fake_secret");
    expect(Object.keys(first.links)).toEqual(["small", "medium", "large"]);
    expect(Object.values(first.priceMap).sort()).toEqual(["large", "medium", "small"]);
    expect(stripe.db.links.map((l) => (l.after_completion as { redirect: { url: string } }).redirect.url)).toEqual([
      "https://a.example.com/account?ink=small",
      "https://a.example.com/account?ink=medium",
      "https://a.example.com/account?ink=large",
    ]);

    stripe.posts.length = 0;
    const second = await setup(live, deps);
    const creates = stripe.posts.filter((p) => /^\/v1\/(products|prices|payment_links|webhook_endpoints)$/.test(p.path));
    expect(creates).toEqual([]);
    expect(second.links).toEqual(first.links);
    expect(second.priceMap).toEqual(first.priceMap);
    expect(secrets).toHaveLength(1);
  });

  it("a changed price makes a new price + link and retires the old ones; a new site only moves the redirect", async () => {
    const stripe = fakeStripe();
    const deps = { api: stripe.api, log: () => undefined, writeSecret: () => undefined };
    const first = await setup(live, deps);

    // the stored Medium price no longer matches PACKS: the same as the owner editing PACKS (which is frozen here)
    const mediumPrice = stripe.db.prices.find((p) => (p.metadata as Record<string, string>).pack_id === "medium")!;
    mediumPrice.unit_amount = 1900;
    const second = await setup(live, deps);
    expect(second.links.medium).not.toBe(first.links.medium);
    expect(second.links.small).toBe(first.links.small);
    expect(mediumPrice.active).toBe(false);
    // the archived price keeps mapping to its pack: a checkout opened before the change still pays it
    expect(second.priceMap[mediumPrice.id]).toBe("medium");
    expect(Object.keys(second.priceMap)).toHaveLength(4);
    expect(stripe.db.links.filter((l) => l.active && (l.metadata as Record<string, string>).pack_id === "medium")).toHaveLength(1);

    const moved = await setup({ ...live, site: "https://b.example.com" }, deps);
    expect(moved.links).toEqual(second.links);
    const mediumLink = stripe.db.links.find((l) => l.url === moved.links.medium)!;
    expect(mediumLink.after_completion).toEqual({ type: "redirect", redirect: { url: "https://b.example.com/account?ink=medium" } });
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

  it("narrows our old endpoint to exactly the ink events", async () => {
    const stripe = fakeStripe({
      hooks: [
        {
          id: "we_ours",
          created: 1,
          url: "https://a.example.com/api/billing/webhook",
          enabled_events: ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted"],
          metadata: { app: APP_TAG },
        },
      ],
    });
    await setup(live, { api: stripe.api, log: () => undefined, writeSecret: () => undefined });
    expect(stripe.db.hooks).toHaveLength(1);
    expect(stripe.db.hooks[0].enabled_events).toEqual([...WEBHOOK_EVENTS]);
  });

  describe("on the account shared with Fuime", () => {
    /** Fuime's live objects (untagged, some with confusable names/urls) next to our retired plan objects. */
    function sharedAccount() {
      const fuime = {
        products: [
          { id: "prod_fuime_ticket", created: 1, active: true, name: "Founders Weekend ticket", metadata: { fuime_event_id: "evt_fw" } },
          { id: "prod_fuime_namesake", created: 2, active: true, name: "Agathon Medium ink pack", metadata: {} },
          { id: "prod_fuime_plus", created: 3, active: true, name: "Plus", metadata: { plan_id: "plus" } },
        ],
        prices: [{ id: "price_fuime", created: 4, active: true, product: "prod_fuime_ticket", unit_amount: 2000, currency: "usd", type: "one_time", metadata: {} }],
        links: [{ id: "plink_fuime", created: 5, active: true, url: "https://buy.stripe.com/fuime", metadata: { fuime_event_id: "evt_fw", pack_id: "medium" } }],
        configs: [{ id: "bpc_fuime_default", created: 6, active: true, is_default: true, metadata: {} }],
        hooks: [
          { id: "we_fuime", created: 7, url: "https://fuime.example/webhooks/stripe", enabled_events: ["*"], metadata: {} },
          { id: "we_untagged_same_url", created: 8, url: "https://a.example.com/api/billing/webhook", enabled_events: ["*"], metadata: {} },
        ],
      };
      const plan = (id: string) => ({ app: APP_TAG, plan_id: id });
      const ours = {
        products: [
          { id: "prod_plus", created: 10, active: true, name: "Agathon Plus", default_price: "price_plus", metadata: plan("plus") },
          { id: "prod_pro", created: 11, active: true, name: "Agathon Pro", default_price: "price_pro", metadata: plan("pro") },
        ],
        prices: [
          { id: "price_plus", created: 12, active: true, product: "prod_plus", unit_amount: 1200, currency: "usd", type: "recurring", recurring: { interval: "month" }, metadata: plan("plus") },
          { id: "price_pro", created: 13, active: true, product: "prod_pro", unit_amount: 3900, currency: "usd", type: "recurring", recurring: { interval: "month" }, metadata: plan("pro") },
          // someone added a price to our product by hand in the Dashboard: untagged, so left alone
          { id: "price_plus_manual", created: 14, active: true, product: "prod_plus", unit_amount: 999, currency: "usd", type: "one_time", metadata: {} },
        ],
        links: [
          { id: "plink_plus", created: 15, active: true, url: "https://buy.stripe.com/plus", metadata: { ...plan("plus"), price_id: "price_plus" } },
          { id: "plink_pro", created: 16, active: true, url: "https://buy.stripe.com/pro", metadata: { ...plan("pro"), price_id: "price_pro" } },
        ],
        configs: [{ id: "bpc_ours", created: 17, active: true, is_default: false, metadata: { app: APP_TAG } }],
      };
      const untaggedIds = [...fuime.products, ...fuime.prices, ...fuime.links, ...fuime.configs, ...fuime.hooks, ours.prices[2]].map((o) => o.id);
      const stripe = fakeStripe({
        products: [...fuime.products, ...ours.products],
        prices: [...fuime.prices, ...ours.prices],
        links: [...fuime.links, ...ours.links],
        configs: [...fuime.configs, ...ours.configs],
        hooks: [...fuime.hooks],
      });
      return { stripe, untaggedIds };
    }

    it("a real run never writes to an untagged object, and retires only our Plus/Pro objects", async () => {
      const { stripe, untaggedIds } = sharedAccount();
      await setup(live, { api: stripe.api, log: () => undefined, writeSecret: () => undefined });
      const touched = stripe.posts.map((p) => p.path.split("/").pop());
      for (const id of untaggedIds) expect(touched, id).not.toContain(id);
      // every write is a create of a tagged object, or an update of one of ours
      for (const { path, body } of stripe.posts) {
        if (/^\/v1\/(products|prices|payment_links|webhook_endpoints)$/.test(path)) expect((body.metadata as Record<string, string>).app, path).toBe(APP_TAG);
        expect(metadataKeys(body).filter((k) => /^fuime/i.test(k)), path).toEqual([]);
      }
      const get = (arr: Obj[], id: string) => arr.find((o) => o.id === id)!;
      // ours retired
      expect(get(stripe.db.links, "plink_plus").active).toBe(false);
      expect(get(stripe.db.links, "plink_pro").active).toBe(false);
      expect(get(stripe.db.products, "prod_plus")).toMatchObject({ active: false, default_price: "" });
      expect(get(stripe.db.prices, "price_pro").active).toBe(false);
      expect(get(stripe.db.configs, "bpc_ours").active).toBe(false);
      // theirs untouched (Fuime's live objects, its default portal configuration, the hand-made price)
      expect(get(stripe.db.products, "prod_fuime_namesake").active).toBe(true);
      expect(get(stripe.db.products, "prod_fuime_plus").active).toBe(true);
      expect(get(stripe.db.links, "plink_fuime").active).toBe(true);
      expect(get(stripe.db.configs, "bpc_fuime_default").active).toBe(true);
      expect(get(stripe.db.prices, "price_plus_manual").active).toBe(true);
      expect(get(stripe.db.hooks, "we_untagged_same_url").enabled_events).toEqual(["*"]);
      // our new endpoint, next to the untagged one at the same URL
      expect(stripe.db.hooks.filter((h) => (h.metadata as Record<string, string>).app === APP_TAG)).toHaveLength(1);
    });

    it("a dry run on the shared account writes nothing and says what it would retire", async () => {
      const { stripe } = sharedAccount();
      const log: string[] = [];
      await setup({ ...live, dryRun: true }, { api: stripe.api, log: (l: string) => log.push(l), writeSecret: () => undefined });
      expect(stripe.posts).toEqual([]);
      const text = log.join("\n");
      expect(text).toMatch(/would deactivate Payment Link plink_plus/);
      expect(text).toMatch(/would archive product prod_pro/);
      expect(text).toMatch(/would deactivate customer portal configuration bpc_ours/);
      expect(text).not.toMatch(/fuime/i);
    });

    it("our portal configuration is left alone when it is the account's default", async () => {
      const stripe = fakeStripe({ configs: [{ id: "bpc_ours_default", created: 1, active: true, is_default: true, metadata: { app: APP_TAG } }] });
      const log: string[] = [];
      await setup(live, { api: stripe.api, log: (l: string) => log.push(l), writeSecret: () => undefined });
      expect(stripe.posts.map((p) => p.path)).not.toContain("/v1/billing_portal/configurations/bpc_ours_default");
      expect(log.join("\n")).toMatch(/bpc_ours_default is the account's default/);
    });
  });
});
