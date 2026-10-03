/**
 * The legal pages say what the product does. Each fact they state about Agathon Unlimited, the
 * emails and the AI services is pinned here to the code that does it, so changing the product
 * without changing the pages fails a test. Also: every link between the pages lands on a section
 * that exists (/terms#unlimited is what the plan screens link to).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/(platform)/privacy/page";
import RefundsPage from "@/app/(platform)/refunds/page";
import TermsPage from "@/app/(platform)/terms/page";
import { LEGAL_LAST_UPDATED } from "@/components/legal/LegalPage";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { DEFAULT_EMAIL_FROM } from "@/lib/email/resend";
import { TRIAL_REMINDER_WINDOW } from "@/lib/email/trialReminders";
import { isPlaceholder, LEGAL, TERMS_VERSION } from "@/lib/legal";
import { LIVE_MODELS } from "@/lib/live/contracts";
import { buildStrokesBody } from "@/lib/server/mathpix";
import { PROVIDER_PRIVACY, TEXT_MODELS } from "@/lib/server/openrouter";

const PAGES = {
  "/terms": renderToStaticMarkup(<TermsPage />),
  "/privacy": renderToStaticMarkup(<PrivacyPage />),
  "/refunds": renderToStaticMarkup(<RefundsPage />),
} as const;
type PagePath = keyof typeof PAGES;

/** The page's text, tags dropped and entities decoded enough for sentence checks. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const hrefs = (html: string) => [...html.matchAll(/\shref="([^"]+)"/g)].map((m) => m[1]);

const HOUR_MS = 60 * 60 * 1000;
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

describe("legal pages: links and anchors", () => {
  it("give the plan's sections the stable ids the app links to", () => {
    expect(ids(PAGES["/terms"])).toContain("unlimited");
    expect(ids(PAGES["/terms"])).toContain("fair-use");
    expect(ids(PAGES["/refunds"])).toContain("subscriptions");
    for (const id of ["ai", "emails", "providers", "children", "retention"]) expect(ids(PAGES["/privacy"])).toContain(id);
  });

  it("every link to a legal page's section lands on a section that exists", () => {
    const links = Object.entries(PAGES).flatMap(([from, html]) => hrefs(html).map((href) => ({ from: from as PagePath, href })));
    const anchored = links.filter(({ href }) => href.includes("#"));
    expect(anchored.length).toBeGreaterThan(10);
    for (const { from, href } of anchored) {
      const [path, hash] = href.split("#");
      const target = (path || from) as PagePath;
      expect(PAGES[target], `${from} links ${href}`).toBeDefined();
      expect(ids(PAGES[target]), `${from} links ${href}`).toContain(hash);
    }
  });

  it("the terms and the refund policy point at each other's plan section", () => {
    expect(hrefs(PAGES["/terms"])).toContain("/refunds#subscriptions");
    expect(hrefs(PAGES["/refunds"])).toContain("/terms#unlimited");
    expect(hrefs(PAGES["/privacy"])).toContain("/terms#fair-use");
  });
});

describe("terms: Agathon Unlimited as sold", () => {
  const terms = text(PAGES["/terms"]);
  const price = `$${UNLIMITED_PLAN.monthlyUsd}`;

  it("states the price, the free week, the automatic renewal and when the card is charged", () => {
    expect(UNLIMITED_PLAN).toMatchObject({ monthlyUsd: 25, trialDays: 7 });
    expect(terms).toContain(`${price} a month`);
    expect(terms).toContain(`When the free week ends, ${UNLIMITED_PLAN.trialDays} days after checkout, the card is charged ${price}.`);
    expect(terms).toContain("Checkout asks for a card but charges nothing that day.");
    expect(terms).toContain("It renews automatically");
    expect(terms).toContain("until you cancel");
  });

  it("says how to cancel online, and that cancelling in the free week costs nothing", () => {
    expect(terms).toContain("Cancel online at any time, in a few clicks. No phone call or email is needed.");
    expect(terms).toContain("Manage or cancel");
    expect(terms).toContain("Cancel before the free week ends and you will not be charged.");
    expect(terms).toContain("The plan stays on until the end of the month you have paid for");
  });

  it("states the fair-use limit the database enforces", () => {
    // the last migration to define unlimited_fair_use_per_day() wins
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    let cap: number | null = null;
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), "utf8");
      for (const m of sql.matchAll(/function public\.unlimited_fair_use_per_day\(\)[\s\S]*?\$\$\s*select\s+(\d+)\s*\$\$/g)) cap = Number(m[1]);
    }
    expect(cap).toBe(LEGAL.unlimited.fairUseActionsPerDay);
    expect(terms).toContain(`${LEGAL.unlimited.fairUseActionsPerDay.toLocaleString("en-US")} AI actions in any 24 hours`);
  });

  it("promises the reminder the cron actually sends: 2 to 3 days before the free week ends", () => {
    // a daily run reminds trials ending 24 to 72 hours out, so the first run to see one is 2 to 3 days ahead
    expect(TRIAL_REMINDER_WINDOW).toEqual({ fromMs: 24 * HOUR_MS, toMs: 72 * HOUR_MS });
    expect(terms).toContain("About 2 to 3 days before the free week ends, we email the address on the Agathon account");
    expect(text(PAGES["/privacy"])).toContain("one reminder about 2 to 3 days before the free week ends");
  });

  it("covers failed payments, price changes, who pays, repeat free weeks and deleting an account", () => {
    expect(terms).toContain("Until a payment goes through, help uses ink again");
    expect(terms).toContain(`at least ${LEGAL.unlimited.priceChangeNoticeDays} days ahead`);
    expect(terms).toContain("a parent or guardian starts the plan with their own card");
    expect(terms).toContain("We may limit it to one per person, family or card.");
    expect(terms).toContain("The app will not delete an account whose plan would charge the card again.");
  });
});

describe("refunds: the plan", () => {
  const refunds = text(PAGES["/refunds"]);

  it("keeps the ink-pack rule and adds the plan's", () => {
    expect(refunds).toContain(`Within ${LEGAL.refundWindowDays} days of buying a pack`);
    expect(refunds).toContain("The free week is free.");
    expect(refunds).toContain(`within ${LEGAL.unlimited.refundWindowDays} days of that charge`);
    expect(refunds).toContain("no refunds for part of a month");
  });
});

describe("privacy: who gets what", () => {
  const privacy = text(PAGES["/privacy"]);

  it("names every company the app sends data to", () => {
    for (const name of ["Supabase", "Vercel", "OpenRouter", "Mathpix", "Stripe", "Resend", "ElevenLabs", "tldraw", "unpkg"]) {
      expect(privacy, name).toContain(name);
    }
  });

  it("names the maker of every AI model the code can call", () => {
    const MAKERS: Record<string, string> = { google: "Google", openai: "OpenAI", anthropic: "Anthropic", deepseek: "DeepSeek" };
    const prefixes = new Set([...Object.values(LIVE_MODELS), ...Object.values(TEXT_MODELS)].map((id) => id.split("/")[0]));
    for (const prefix of prefixes) {
      expect(MAKERS[prefix], `a model from "${prefix}": name its maker on /privacy`).toBeDefined();
      expect(privacy).toContain(MAKERS[prefix]);
    }
  });

  it("lists the emails we send, from the domain we send them from", () => {
    expect(DEFAULT_EMAIL_FROM).toContain("@mail.agathon.app");
    expect(privacy).toContain("mail.agathon.app");
    for (const email of ["Password reset:", "Welcome:", "Free week ending:"]) expect(privacy).toContain(email);
    expect(privacy).toContain("We send no newsletters or marketing emails.");
  });

  it("says what is kept after an account is deleted", () => {
    expect(privacy).toContain("its plan’s record (Stripe ids, status and dates, nothing that names you) is kept without the link to the account");
    expect(privacy).toContain("Payment notices from Stripe: kept after an account is deleted");
  });

  it("says AI services neither keep nor train on what we send, only because every request asks and is refused otherwise", () => {
    expect(isPlaceholder(LEGAL.aiProviderTraining)).toBe(false);
    expect(privacy).toContain(LEGAL.aiProviderTraining);
    // OpenRouter: only endpoints that do not train on prompts and keep none (a 404 where there is none)
    expect(PROVIDER_PRIVACY).toEqual({ data_collection: "deny", zdr: true });
    // Mathpix: no image data or result persisted
    expect(buildStrokesBody({ x: [[0, 1]], y: [[0, 1]], w: 1, h: 1 }).metadata).toEqual({ improve_mathpix: false });
    expect(privacy).toContain("Mathpix keeps only a record that a request was made");
    // no leftover promise that providers keep data "for a limited time"
    expect(privacy).not.toContain("may keep what they receive for a limited time");
  });
});

describe("legal pages: dates", () => {
  it("the pages are dated no earlier than the version sign-up records", () => {
    const updated = new Date(`${LEGAL_LAST_UPDATED} 00:00:00 UTC`);
    expect(Number.isNaN(updated.getTime())).toBe(false);
    expect(updated.toISOString().slice(0, 10) >= TERMS_VERSION).toBe(true);
    for (const html of Object.values(PAGES)) expect(text(html)).toContain(`Last updated ${LEGAL_LAST_UPDATED}`);
  });
});
