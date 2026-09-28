#!/usr/bin/env node
/**
 * Creates (or finds) the Stripe objects behind Agathon's paid plans, and prints the
 * env values the app needs. Idempotent: every object carries `metadata.app = agathon-classroom`
 * and is found again by it, so a second run changes nothing unless the config below changed.
 *
 *   node scripts/stripe-setup.mjs [--mode test|live] [--site <url>] [--dry-run] [--secret-file <path>]
 *
 *   --mode         test (default) or live. Live passes the Stripe CLI's own `--live` flag.
 *   --site         the app's origin; Payment Links redirect to <site>/account?upgraded=<plan>, the
 *                  portal returns to <site>/account, and the webhook posts to
 *                  <site>/api/billing/webhook. Default http://localhost:3000.
 *   --dry-run      read what exists and say what would change; create nothing.
 *   --secret-file  where a NEW webhook endpoint's signing secret is written (mode 600). Default
 *                  ~/.config/agathon-classroom/stripe-webhook-secret-<mode>. Never printed.
 *
 * What it manages (docs/RUNBOOK-billing.md):
 *   - a product + a monthly price per paid plan (PLANS below); a changed amount makes a new price
 *     and archives the old one (existing subscribers stay on the old price until they switch)
 *   - a Payment Link per plan that redirects back to the account page after payment; the app
 *     appends `client_reference_id=<user id>` and `prefilled_email=<email>` (src/lib/billing/checkout.ts)
 *   - a customer portal configuration: switch between the plans (upgrades now, downgrades at the
 *     period end), cancel at the period end, update the card, see invoices; its login page URL is
 *     the "portal" link
 *   - a webhook endpoint for the three events src/app/api/billing/webhook handles (not for a
 *     localhost site: use `stripe listen --forward-to` there)
 *
 * Talks to Stripe only through the Stripe CLI (`stripe get|post … [--live]`), so no key is read,
 * stored or printed here; the CLI uses the account it is logged in to (`stripe config --list`).
 * The prices here and `public.plans` must agree: src/__tests__/stripeSetup.test.ts pins them.
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
 * The paid plans, at the launch prices the owner set (2026-09-28): keep them equal to `public.plans`
 * (supabase/migrations/20260928110000_paid_plans.sql, then the runbook's UPDATE).
 * @type {ReadonlyArray<{ id: string, name: string, credits: number, priceCents: number, currency: string, interval: "month" }>}
 */
export const PLANS = Object.freeze([
  Object.freeze({ id: "plus", name: "Plus", credits: 3000, priceCents: 1200, currency: "usd", interval: "month" }),
  Object.freeze({ id: "pro", name: "Pro", credits: 12000, priceCents: 3900, currency: "usd", interval: "month" }),
]);

/** The events src/app/api/billing/webhook/route.ts acts on. */
export const WEBHOOK_EVENTS = Object.freeze([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export const WEBHOOK_PATH = "/api/billing/webhook";
export const DEFAULT_SITE = "http://localhost:3000";

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

/** Where a Payment Link sends the customer after paying: the account page's "Upgrading…" state. */
export function upgradeReturnUrl(site, planId) {
  return `${site}/account?upgraded=${encodeURIComponent(planId)}`;
}

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

export function productName(plan) {
  return `${PRODUCT_PREFIX} ${plan.name}`;
}

export function productDescription(plan) {
  return `${plan.credits.toLocaleString("en-US")} tutor credits every month.`;
}

export function productBody(plan) {
  return {
    name: productName(plan),
    description: productDescription(plan),
    metadata: { app: APP_TAG, plan_id: plan.id },
  };
}

export function priceBody(plan, productId) {
  return {
    product: productId,
    currency: plan.currency,
    unit_amount: plan.priceCents,
    recurring: { interval: plan.interval },
    nickname: `${plan.name} monthly`,
    metadata: { app: APP_TAG, plan_id: plan.id, credits: plan.credits },
  };
}

/**
 * The Payment Link. `metadata` is copied onto every Checkout Session it creates, which is where the
 * webhook reads `plan_id` (the session's line items are not in the event). The subscription only
 * gets the app tag: its plan is its PRICE (BILLING_PRICE_MAP), which the portal can change.
 */
export function paymentLinkBody(plan, priceId, site) {
  return {
    line_items: [{ price: priceId, quantity: 1 }],
    after_completion: { type: "redirect", redirect: { url: upgradeReturnUrl(site, plan.id) } },
    metadata: { app: APP_TAG, plan_id: plan.id, price_id: priceId },
    subscription_data: { metadata: { app: APP_TAG } },
  };
}

/**
 * Customer portal: switch between the plans (upgrades at once and invoiced now; downgrades
 * wait for the period end, so a month of Pro credits cannot be bought at the Plus price),
 * cancel at the period end, update the card, see invoices. `login_page.enabled` gives the
 * no-code login URL the app links to.
 * @param {string} site
 * @param {Array<{ product: string, price: string }>} products
 */
export function portalBody(site, products) {
  return {
    business_profile: { headline: `${PRODUCT_PREFIX}: your plan and billing` },
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
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "always_invoice",
        // one seat per subscription: credits are per plan, so the quantity must not be changeable
        products: products.map((p) => ({ product: p.product, prices: [p.price], adjustable_quantity: { enabled: false } })),
        schedule_at_period_end: { conditions: [{ type: "decreasing_item_amount" }] },
      },
    },
    login_page: { enabled: true },
    metadata: { app: APP_TAG },
  };
}

export function webhookBody(site) {
  return {
    url: webhookUrl(site),
    enabled_events: [...WEBHOOK_EVENTS],
    description: `${PRODUCT_PREFIX} plan changes`,
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

/** Our active product for the plan (the oldest, if a failed run ever made two). */
export function findProduct(products, planId) {
  return oldest(products.filter((p) => p.active !== false && isOurs(p, { plan_id: planId })));
}

/** An active monthly price on the product with exactly the plan's amount and currency. */
export function findPrice(prices, plan, productId) {
  return oldest(
    prices.filter(
      (p) =>
        p.active !== false &&
        p.product === productId &&
        p.unit_amount === plan.priceCents &&
        p.currency === plan.currency &&
        p.recurring?.interval === plan.interval &&
        (p.recurring?.interval_count ?? 1) === 1,
    ),
  );
}

/** Our active Payment Link for the plan that sells exactly this price. */
export function findPaymentLink(links, planId, priceId) {
  return oldest(links.filter((l) => l.active !== false && isOurs(l, { plan_id: planId, price_id: priceId })));
}

export function findPortalConfig(configs) {
  return oldest(configs.filter((c) => c.active !== false && isOurs(c)));
}

export function findWebhook(endpoints, url) {
  return oldest(endpoints.filter((e) => e.url === url && isOurs(e)));
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

/** True when the endpoint already listens to exactly the events we need (extra events are fine). */
export function webhookHasEvents(endpoint) {
  const have = new Set(endpoint?.enabled_events ?? []);
  return have.has("*") || WEBHOOK_EVENTS.every((e) => have.has(e));
}

/* ------------------------------------------------------------------------- */
/* Output                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * The env values to set, one per line, ready for `vercel env add` / .env.local.
 * Only public URLs and price ids: nothing here is a secret.
 * @param {{ links: Record<string, string>, portal: string | null, priceMap: Record<string, string> }} v
 */
export function envLines({ links, portal, priceMap }) {
  const billingLinks = { ...links, ...(portal ? { portal } : {}) };
  return [`NEXT_PUBLIC_BILLING_LINKS=${JSON.stringify(billingLinks)}`, `BILLING_PRICE_MAP=${JSON.stringify(priceMap)}`];
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

/** Every object of a list endpoint, following `has_more`. */
export async function listAll(api, apiPath, params = {}) {
  /** @type {any[]} */
  const all = [];
  let startingAfter;
  for (let page = 0; page < 50; page++) {
    const res = await api.get(apiPath, { limit: 100, ...params, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    const data = Array.isArray(res?.data) ? res.data : [];
    all.push(...data);
    if (!res?.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return all;
}

/* ------------------------------------------------------------------------- */
/* The run                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * @param {Options} opts
 * @param {{ api?: StripeApi, log?: (line: string) => void, writeSecret?: (file: string, secret: string) => void }} [deps]
 */
export async function setup(opts, deps = {}) {
  const api = deps.api ?? stripeCli(opts.mode);
  const log = deps.log ?? ((line) => console.log(line));
  const writeSecret = deps.writeSecret ?? writeSecretFile;
  const dry = opts.dryRun;
  const would = (what) => log(`  ${dry ? "would " : ""}${what}`);

  const account = await api.get("/v1/account");
  log(`Stripe account ${account.id}${account.settings?.dashboard?.display_name ? ` ("${account.settings.dashboard.display_name}")` : ""}, ${opts.mode} mode${dry ? ", dry run" : ""}`);
  log(`Site ${opts.site}`);

  const products = await listAll(api, "/v1/products", { active: "true" });
  const links = await listAll(api, "/v1/payment_links", { active: "true" });

  /** @type {Record<string, string>} */
  const linkUrls = {};
  /** @type {Record<string, string>} */
  const priceMap = {};
  /** @type {Array<{ product: string, price: string }>} */
  const portalProducts = [];
  /** @type {string[]} */
  const notes = [];

  for (const plan of PLANS) {
    log(`\n${plan.name} (${plan.id}): $${(plan.priceCents / 100).toFixed(2)}/${plan.interval}, ${plan.credits} credits`);

    // Product
    let product = findProduct(products, plan.id);
    const body = productBody(plan);
    if (!product) {
      would(`create product "${body.name}"`);
      product = dry ? { id: `(new ${plan.id} product)`, name: body.name } : await api.post("/v1/products", body);
    } else if (product.name !== body.name || product.description !== body.description) {
      would(`update product ${product.id} name/description`);
      if (!dry) product = await api.post(`/v1/products/${product.id}`, { name: body.name, description: body.description });
    }
    log(`  product ${product.id}`);

    // Price
    const prices = product.id.startsWith("prod_") ? await listAll(api, "/v1/prices", { product: product.id, active: "true" }) : [];
    let price = findPrice(prices, plan, product.id);
    if (!price) {
      would(`create price ${plan.priceCents} ${plan.currency}/${plan.interval}`);
      price = dry ? { id: `(new ${plan.id} price)` } : await api.post("/v1/prices", priceBody(plan, product.id));
    }
    log(`  price ${price.id}`);
    if (!dry && product.default_price !== price.id) {
      await api.post(`/v1/products/${product.id}`, { default_price: price.id });
    }
    for (const stale of prices.filter((p) => p.id !== price.id && isOurs(p))) {
      would(`archive old price ${stale.id} (${stale.unit_amount} ${stale.currency}); its subscribers keep it until they switch`);
      if (!dry) await api.post(`/v1/prices/${stale.id}`, { active: false });
    }

    // Payment Link
    const wantRedirect = upgradeReturnUrl(opts.site, plan.id);
    let link = findPaymentLink(links, plan.id, price.id);
    if (!link) {
      would(`create Payment Link redirecting to ${wantRedirect}`);
      link = dry ? { id: `(new ${plan.id} link)`, url: `(new ${plan.id} link url)` } : await api.post("/v1/payment_links", paymentLinkBody(plan, price.id, opts.site));
    } else if (linkRedirect(link) !== wantRedirect) {
      would(`point Payment Link ${link.id} at ${wantRedirect}`);
      if (!dry) link = await api.post(`/v1/payment_links/${link.id}`, { after_completion: { type: "redirect", redirect: { url: wantRedirect } } });
    }
    log(`  payment link ${link.id} ${link.url}`);
    for (const stale of links.filter((l) => l.id !== link.id && isOurs(l, { plan_id: plan.id }))) {
      would(`deactivate old Payment Link ${stale.id} (${stale.url})`);
      if (!dry) await api.post(`/v1/payment_links/${stale.id}`, { active: false });
      notes.push(`The ${plan.name} Payment Link changed: update NEXT_PUBLIC_BILLING_LINKS and redeploy (the old link no longer sells).`);
    }

    linkUrls[plan.id] = link.url;
    // Archived prices stay in the map: their subscribers still bill on them, and the webhook
    // reads a subscription's plan from its price.
    if (product.id.startsWith("prod_")) {
      const archived = await listAll(api, "/v1/prices", { product: product.id, active: "false" });
      for (const old of [...prices, ...archived]) if (isOurs(old, { plan_id: plan.id })) priceMap[old.id] = plan.id;
    }
    priceMap[price.id] = plan.id;
    portalProducts.push({ product: product.id, price: price.id });
  }

  // Customer portal
  log("\nCustomer portal");
  const configs = await listAll(api, "/v1/billing_portal/configurations", { active: "true" });
  let config = findPortalConfig(configs);
  const portal = portalBody(opts.site, portalProducts);
  if (!config) {
    would("create portal configuration with a login page");
    config = dry ? { id: "(new portal configuration)", login_page: { url: null } } : await api.post("/v1/billing_portal/configurations", portal);
  } else {
    would(`update portal configuration ${config.id} (plans, return URL, login page)`);
    if (!dry) config = await api.post(`/v1/billing_portal/configurations/${config.id}`, portal);
  }
  const portalUrl = config.login_page?.url ?? null;
  log(`  configuration ${config.id}`);
  log(`  login page ${portalUrl ?? "(created on the real run)"}`);

  // Webhook endpoint
  log("\nWebhook");
  /** @type {string} */
  let secretNote;
  if (isLocalSite(opts.site)) {
    secretNote = `${opts.site} is local, so no endpoint was made. Run \`stripe listen --forward-to ${webhookUrl(opts.site)}\`; the whsec_ secret it prints is STRIPE_WEBHOOK_SECRET for that session.`;
    log(`  skipped (local site)`);
  } else {
    const endpoints = await listAll(api, "/v1/webhook_endpoints");
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
      if (!webhookHasEvents(endpoint) || endpoint.status === "disabled") {
        would(`update endpoint ${endpoint.id}: events ${WEBHOOK_EVENTS.join(", ")}, enabled`);
        if (!dry) await api.post(`/v1/webhook_endpoints/${endpoint.id}`, { enabled_events: [...WEBHOOK_EVENTS], disabled: false });
      }
      log(`  endpoint ${endpoint.id} (exists)`);
      secretNote = `unchanged. Reveal it in the Dashboard${opts.mode === "test" ? " (test mode)" : ""}: Developers > Webhooks > ${endpoint.id} > Signing secret.`;
    }
  }

  const lines = envLines({ links: linkUrls, portal: portalUrl, priceMap });
  log("\nSet these (Vercel: Production; locally: the dev server's env):");
  for (const line of lines) log(`  ${line}`);
  log(`  STRIPE_WEBHOOK_SECRET: ${secretNote}`);
  for (const note of new Set(notes)) log(`\nNote: ${note}`);
  return { links: linkUrls, portal: portalUrl, priceMap, env: lines };
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
