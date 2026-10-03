#!/usr/bin/env node
/**
 * Creates (or finds) the Stripe objects behind Agathon's ink packs, retires the old Plus/Pro
 * subscription objects, and prints the env values the app needs. Idempotent: every object carries
 * `metadata.app = agathon-classroom` and is found again by it, so a second run changes nothing
 * unless the config below changed.
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
 *   - a webhook endpoint for exactly the events src/app/api/billing/webhook handles (not for a
 *     localhost site: use `stripe listen --forward-to` there)
 *   - the retired subscription objects it made before ink: the Plus/Pro Payment Links are
 *     deactivated, their products and prices archived, and its customer portal configuration
 *     deactivated (unless it is the account's default, which Stripe will not deactivate)
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
]);

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

export function webhookBody(site) {
  return {
    url: webhookUrl(site),
    enabled_events: [...WEBHOOK_EVENTS],
    description: `${PRODUCT_PREFIX} ink packs`,
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

/** The subscription-era objects of ours (metadata.plan_id) that are still active. */
export function retiredObjects({ products, links, configs }) {
  const planOf = (o) => metaOf(o).plan_id;
  return {
    products: products.filter((p) => p.active !== false && isOurs(p) && RETIRED_PLAN_IDS.includes(planOf(p))),
    links: links.filter((l) => l.active !== false && isOurs(l) && RETIRED_PLAN_IDS.includes(planOf(l))),
    configs: configs.filter((c) => c.active !== false && isOurs(c)),
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
 * Only public URLs and price ids: nothing here is a secret.
 * @param {{ links: Record<string, string>, priceMap: Record<string, string> }} v
 */
export function envLines({ links, priceMap }) {
  return [`NEXT_PUBLIC_BILLING_LINKS=${JSON.stringify(links)}`, `INK_PRICE_MAP=${JSON.stringify(priceMap)}`];
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
const CREATE_PATHS = new Set(["/v1/products", "/v1/prices", "/v1/payment_links", "/v1/webhook_endpoints"]);

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

  // The subscription plans this script sold before ink: stop selling them.
  log("\nRetired subscription plans (Plus, Pro)");
  const configs = claim(await listAll(api, "/v1/billing_portal/configurations", { active: "true" }));
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

  const lines = envLines({ links: linkUrls, priceMap });
  log("\nSet these (Vercel: Production; locally: the dev server's env):");
  for (const line of lines) log(`  ${line}`);
  log(`  STRIPE_WEBHOOK_SECRET: ${secretNote}`);
  log("  (BILLING_PRICE_MAP from the subscription days is no longer read: remove it.)");
  for (const note of new Set(notes)) log(`\nNote: ${note}`);
  return { links: linkUrls, priceMap, env: lines };
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
