/**
 * The technical SEO core (docs/SEO.md, seo-core): robots.txt, the sitemap, the icons and manifest,
 * the site-wide metadata, the landing page's title and structured data, the legal pages, the footer
 * and IndexNow.
 */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A different plan than the real one: every price, trial and plan name must follow it.
vi.mock("@/lib/billing/unlimited", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/billing/unlimited")>();
  return { ...real, UNLIMITED_PLAN: { ...real.UNLIMITED_PLAN, name: "Agathon Test Plan", monthlyUsd: 31, trialDays: 10 } };
});
// next/font only runs inside Next's compiler; the root layout's metadata is all this file reads of it.
vi.mock("@/app/fonts", () => {
  const face = { variable: "", className: "", style: { fontFamily: "" } };
  return { geistSans: face, geistMono: face };
});

const { default: robots } = await import("@/app/robots");
const { default: sitemap } = await import("@/app/sitemap");
const { default: manifest } = await import("@/app/manifest");
const { metadata: rootMetadata } = await import("@/app/layout");
const { default: ParentsPage, metadata: landingMetadata } = await import("@/app/(platform)/parents/page");
const { metadata: loginMetadata } = await import("@/app/(platform)/login/page");
const privacy = await import("@/app/(platform)/privacy/page");
const terms = await import("@/app/(platform)/terms/page");
const refunds = await import("@/app/(platform)/refunds/page");
const { LegalFooter } = await import("@/components/legal/LegalFooter");
const { LANDING_COPY } = await import("@/components/landing/copy");
const { LEGAL, LEGAL_LINKS } = await import("@/lib/legal");
const { MAX_KIDS } = await import("@/lib/family/contracts");
const { ABOUT_PATH, LEGAL_PATHS, MATH_PATH, publicPages } = await import("../routes");
const site = await import("../site");
const { landingJsonLd, schemaIds, schemaPrice } = await import("../landingJsonLd");
const { INDEXNOW_KEY, indexNowPayload } = await import("../indexNow");

const ROOT = path.resolve(__dirname, "../../../..");
const APP = path.join(ROOT, "src/app");
const { SITE_ORIGIN, CRAWLERS, PRIVATE_PATHS, PUBLIC_PATHS, robotsGroups, verificationCodes } = site;

/** The page's text, entities read back (as the landing test reads it). */
const plain = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

/** Words no public page says (docs/SEO.md "Rules for every page"). */
const UNBACKED = /\bbest\b|#1|\bproven\b|guarantee|\brated\b|\breviews?\b|trusted by|thousands|millions|\d+\s?%|★/i;
const NOT_US = /practis|\bmaths\b|\bticks?\b|\bticked\b|\brings?\b|\bringed\b|colour|centre|\bbrackets?\b|favourite/i;

// ------------------------------------------------------------------ robots.txt

/**
 * Whether a crawler that follows Google's rules may fetch `urlPath` under `group`: the longest
 * matching Allow or Disallow wins, Allow on a tie (no wildcards are used).
 */
function allowed(group: { allow: string[]; disallow: string[] }, urlPath: string): boolean {
  let best = { len: -1, allow: true };
  for (const [rules, allow] of [
    [group.allow, true],
    [group.disallow, false],
  ] as const) {
    for (const rule of rules) {
      if (!urlPath.startsWith(rule)) continue;
      if (rule.length > best.len || (rule.length === best.len && allow)) best = { len: rule.length, allow };
    }
  }
  return best.allow;
}

/** Every route segment at the top of the app (route groups opened, private folders skipped). */
function topRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("(") && entry.name.endsWith(")")) out.push(...topRoutes(path.join(dir, entry.name)));
    else if (!entry.name.startsWith("_")) out.push(`/${entry.name}`);
  }
  return out;
}

describe("robots.txt", () => {
  const data = robots();
  const groups = robotsGroups();

  it("names every major search and AI crawler, each in its own group", () => {
    const named = [
      "Googlebot",
      "Bingbot",
      "Google-Extended",
      "GPTBot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "ClaudeBot",
      "Claude-SearchBot",
      "Claude-User",
      "PerplexityBot",
      "Perplexity-User",
      "Applebot",
      "Applebot-Extended",
      "CCBot",
      "Amazonbot",
      "DuckAssistBot",
      "meta-externalagent",
      "MistralAI-User",
    ];
    expect([...CRAWLERS]).toEqual(named);
    expect(groups.map((g) => g.userAgent)).toEqual(["*", ...named]);
    expect(data.rules).toEqual(groups);
  });

  it("gives every named group the same lines as *, since a crawler that finds its own group ignores *", () => {
    const [everyone, ...named] = groups;
    for (const group of named) {
      expect(group.allow, group.userAgent).toEqual(everyone.allow);
      expect(group.disallow, group.userAgent).toEqual(everyone.disallow);
    }
  });

  it("lets every crawler read every public page, the sign-in page and the assets", () => {
    const pages = [...publicPages().map((p) => p.path), "/parents", "/login", "/login?mode=signup", "/llms.txt", "/llms-full.txt", "/_next/static/chunks/app.js"];
    for (const group of groups) {
      for (const page of pages) expect(allowed(group, page), `${group.userAgent} ${page}`).toBe(true);
    }
    for (const p of ["/", "/parents", MATH_PATH, ABOUT_PATH, ...LEGAL_PATHS, "/llms.txt", "/llms-full.txt", "/_next/"]) expect(PUBLIC_PATHS).toContain(p);
  });

  it("keeps every crawler out of the app", () => {
    const app = [
      "/board/0b9e",
      "/api/live/check",
      "/admin",
      "/admin/users/1",
      "/account",
      "/family",
      "/progress",
      "/report",
      "/report/replay/1",
      "/reports",
      "/welcome/plan",
      "/reset-password",
      "/train",
    ];
    for (const group of groups) {
      for (const page of app) expect(allowed(group, page), `${group.userAgent} ${page}`).toBe(false);
    }
  });

  it("covers every route in src/app: each is public or disallowed", () => {
    const publicRoots = new Set<string>([...PUBLIC_PATHS, "/login"]);
    const routes = topRoutes(APP);
    expect(routes).toEqual(expect.arrayContaining(["/board", "/api", "/account", "/admin", "/login", "/parents", "/privacy"]));
    for (const route of routes) {
      const isPublic = publicRoots.has(route);
      const isPrivate = !allowed(groups[0], route);
      expect(isPublic !== isPrivate, `${route}: public ${isPublic}, disallowed ${isPrivate}`).toBe(true);
      // and everything under it the same way
      expect(!allowed(groups[0], `${route}/x`), `${route}/x`).toBe(isPrivate);
    }
    for (const p of PRIVATE_PATHS) expect(p.startsWith("/")).toBe(true);
  });

  it("points at the sitemap and the host on the canonical origin", () => {
    expect(data.sitemap).toBe(`${SITE_ORIGIN}/sitemap.xml`);
    expect(data.host).toBe(SITE_ORIGIN);
  });
});

// ------------------------------------------------------------------ sitemap.xml

describe("sitemap.xml", () => {
  const entries = sitemap();

  it("lists every public page once, as an absolute address on the canonical origin", () => {
    const urls = entries.map((e) => e.url);
    expect(urls).toEqual(publicPages().map((p) => (p.path === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${p.path}`)));
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls[0]).toBe(`${SITE_ORIGIN}/`);
    // the landing page's other address is canonical to "/", so it is not listed
    expect(urls).not.toContain(`${SITE_ORIGIN}/parents`);
  });

  it("says when, how often and how important for each", () => {
    for (const e of entries) {
      expect(e.lastModified).toBeInstanceOf(Date);
      expect(["daily", "weekly", "monthly", "yearly"]).toContain(e.changeFrequency);
      expect(e.priority).toBeGreaterThan(0);
      expect(e.priority).toBeLessThanOrEqual(1);
    }
  });

  it("lists nothing robots.txt keeps out", () => {
    for (const e of entries) expect(allowed(robotsGroups()[0], new URL(e.url).pathname), e.url).toBe(true);
  });
});

// ------------------------------------------------------------------ icons and manifest

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("icons and the web manifest", () => {
  it("draws the mark on one flat fill: no gradient, no script", () => {
    const svg = fs.readFileSync(path.join(APP, "icon.svg"), "utf8");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1024 1024">/);
    expect(svg).toContain(`fill="${site.BRAND_GREEN}"`);
    expect(svg).not.toMatch(/gradient|<script|<image|filter/i);
  });

  it("has an apple-icon of 180 px and a favicon.ico of 16, 32 and 48 px", () => {
    expect(pngSize(path.join(APP, "apple-icon.png"))).toEqual({ width: 180, height: 180 });
    const ico = fs.readFileSync(path.join(APP, "favicon.ico"));
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    expect(Array.from({ length: count }, (_, i) => ico.readUInt8(6 + 16 * i))).toEqual([16, 32, 48]);
  });

  it("describes Agathon and its icons, each a file that exists at its size", () => {
    const m = manifest();
    expect(m.name).toBe("Agathon");
    expect(m.short_name).toBe("Agathon");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.description).toBe(site.SITE_DESCRIPTION);
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    for (const icon of m.icons ?? []) {
      const file = icon.src === "/icon.svg" ? path.join(APP, "icon.svg") : path.join(ROOT, "public", icon.src);
      expect(fs.existsSync(file), icon.src).toBe(true);
      if (icon.type === "image/png") {
        const [w, h] = (icon.sizes ?? "").split("x").map(Number);
        expect(pngSize(file), icon.src).toEqual({ width: w, height: h });
      }
    }
    expect((m.icons ?? []).some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("gives search engines a logo of at least 112 px at a stable address", () => {
    const logo = path.join(ROOT, "public", site.LOGO_PATH);
    expect(pngSize(logo).width).toBeGreaterThanOrEqual(112);
  });
});

// ------------------------------------------------------------------ site-wide metadata

describe("the root layout's metadata", () => {
  it("makes every address absolute on the canonical origin and keeps the app out of search", () => {
    expect(String(rootMetadata.metadataBase)).toBe(`${SITE_ORIGIN}/`);
    expect(rootMetadata.robots).toEqual({ index: false, follow: false });
    expect(rootMetadata.title).toEqual({ default: "Agathon", template: "%s · Agathon" });
    expect(rootMetadata.openGraph).toMatchObject({ siteName: "Agathon", locale: "en_US", type: "website" });
  });

  it("says what Agathon is today, in 120 to 160 characters", () => {
    const d = String(rootMetadata.description);
    expect(d).toBe(site.SITE_DESCRIPTION);
    expect(d.length).toBeGreaterThanOrEqual(120);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d).toMatch(/math tutor/);
    expect(d).toMatch(/kindergarten to 8th grade/);
    // the old line promised science and STEM help, which the board does not give
    expect(d).not.toMatch(/science|STEM/i);
    expect(d).not.toMatch(UNBACKED);
  });

  it("adds Google's and Bing's verification codes only when they are set", () => {
    expect(verificationCodes({})).toEqual({});
    expect(verificationCodes({ GOOGLE_SITE_VERIFICATION: " ", BING_SITE_VERIFICATION: "" })).toEqual({});
    expect(verificationCodes({ GOOGLE_SITE_VERIFICATION: "g-code" })).toEqual({ google: "g-code" });
    expect(verificationCodes({ BING_SITE_VERIFICATION: "b-code" })).toEqual({ other: { "msvalidate.01": "b-code" } });
  });

  it("keeps the sign-in page out of search but follows its links", () => {
    expect(loginMetadata.robots).toEqual({ index: false, follow: true });
    expect(loginMetadata.alternates).toBeUndefined();
  });
});

// ------------------------------------------------------------------ the landing page

describe("the landing page's search result", () => {
  const title = landingMetadata.title as { absolute: string };

  it("has a whole title of at most 60 characters with the words parents search for", () => {
    expect(title).toEqual({ absolute: LANDING_COPY.meta.title });
    expect(title.absolute.length).toBeLessThanOrEqual(60);
    expect(title.absolute).toContain("Agathon");
    expect(title.absolute).toMatch(/AI math tutor|math tutor/);
    expect(title.absolute).toContain("kids");
    expect(title.absolute).toContain("K–8");
    // a link preview keeps the brand line
    expect(landingMetadata.openGraph?.title).toBe("Agathon: math practice kids actually do");
    expect(landingMetadata.twitter?.title).toBe("Agathon: math practice kids actually do");
  });

  it("describes the page in at most 160 characters, with the trial from the plan", () => {
    const d = String(landingMetadata.description);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.length).toBeGreaterThanOrEqual(120);
    expect(d).toMatch(/whiteboard/);
    expect(d).toMatch(/by hand/);
    expect(d).toMatch(/checks every line/);
    expect(d).toMatch(/hint instead of the answer/);
    expect(d).toContain("K–8");
    expect(d).toContain("Free for 10 days.");
    expect(d).not.toMatch(UNBACKED);
    expect(d).not.toMatch(NOT_US);
    // the longest trial the words could name still fits
    expect(d.replace("10 days", "100 days").length).toBeLessThanOrEqual(160);
  });

  it("is indexable, canonical at the site root, with the Open Graph defaults", () => {
    expect(landingMetadata.robots).toEqual({ index: true, follow: true });
    expect(landingMetadata.alternates?.canonical).toBe("/");
    expect(landingMetadata.openGraph).toMatchObject({ siteName: "Agathon", locale: "en_US", type: "website", url: "/" });
  });
});

describe("the landing page's structured data", () => {
  const html = renderToStaticMarkup(createElement(ParentsPage));
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const data = JSON.parse(scripts[0] ?? "{}") as { "@context": string; "@graph": Record<string, unknown>[] };
  const graph = data["@graph"] ?? [];
  const byType = (type: string) => graph.find((n) => n["@type"] === type) as Record<string, unknown> & Record<string, never>;
  const ids = schemaIds();

  it("is one schema.org graph in the server's HTML, every node typed", () => {
    expect(scripts).toHaveLength(1);
    expect(data["@context"]).toBe("https://schema.org");
    expect(graph.map((n) => n["@type"])).toEqual(["Organization", "WebSite", "WebApplication", "FAQPage"]);
    for (const node of graph) {
      expect(node["@type"]).toBeTruthy();
      expect(String(node["@id"])).toMatch(new RegExp(`^${SITE_ORIGIN}/#`));
    }
    expect(data).toEqual(JSON.parse(JSON.stringify(landingJsonLd())));
  });

  it("links its nodes by @id, and every reference names a node in the graph", () => {
    const known = new Set(graph.map((n) => n["@id"]));
    const refs: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (Object.keys(o).length === 1 && typeof o["@id"] === "string") refs.push(o["@id"]);
        Object.values(o).forEach(walk);
      }
    };
    graph.forEach(walk);
    expect(refs.length).toBeGreaterThanOrEqual(4);
    for (const ref of refs) expect(known, ref).toContain(ref);
    expect(byType("WebSite").publisher).toEqual({ "@id": ids.organization });
    expect(byType("WebApplication").publisher).toEqual({ "@id": ids.organization });
  });

  it("names Agathon, its address, its logo and the legal pages' contact email", () => {
    const org = byType("Organization");
    expect(org.name).toBe("Agathon");
    expect(org.url).toBe(`${SITE_ORIGIN}/`);
    expect(org.logo).toMatchObject({ url: `${SITE_ORIGIN}${site.LOGO_PATH}` });
    expect(org.email).toBe(LEGAL.contactEmail);
    expect(plain(renderToStaticMarkup(createElement(privacy.default)))).toContain(LEGAL.contactEmail);
    expect(org).not.toHaveProperty("sameAs");
    const web = byType("WebSite");
    expect(web).toMatchObject({ name: "Agathon", url: `${SITE_ORIGIN}/`, inLanguage: "en-US" });
  });

  it("describes the app: educational, in the browser, K–8 and high school", () => {
    const app = byType("WebApplication");
    expect(app).toMatchObject({ name: "Agathon", applicationCategory: "EducationalApplication", operatingSystem: "Web" });
    expect(app.description).toBe(site.SITE_DESCRIPTION);
    expect(app.audience).toMatchObject({ "@type": "EducationalAudience", educationalLevel: ["K–8", "High school"] });
    expect(app.featureList).toEqual([...LANDING_COPY.pricing.includes]);
  });

  it("offers the plan at its price, monthly, with the free trial, all from the plan", () => {
    const offer = byType("WebApplication").offers as Record<string, unknown>;
    expect(offer).toMatchObject({ "@type": "Offer", name: "Agathon Test Plan", price: "31", priceCurrency: "USD" });
    expect(offer.priceSpecification).toMatchObject({
      "@type": "UnitPriceSpecification",
      price: "31",
      priceCurrency: "USD",
      unitCode: "MON",
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
    });
    expect(offer.description).toBe(`Free for 10 days, then $31 a month for up to ${MAX_KIDS} kids. Cancel anytime.`);
    expect(String(offer.url)).toBe(`${SITE_ORIGIN}/#pricing`);
    expect(schemaPrice(24.5)).toBe("24.50");
  });

  it("answers the Questions band's questions, word for word as the page shows them", () => {
    const faq = byType("FAQPage");
    const items = faq.mainEntity as { "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }[];
    expect(items).toHaveLength(LANDING_COPY.faq.items.length);
    // the band's disclosures, in order
    const shown = [...html.matchAll(/<details\b[\s\S]*?<summary\b[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<p>([\s\S]*?)<\/p>/g)].map((m) => ({
      q: plain(m[1]).trim(),
      a: plain(m[2]).trim(),
    }));
    expect(shown).toHaveLength(items.length);
    items.forEach((item, i) => {
      expect(item["@type"]).toBe("Question");
      expect(item.acceptedAnswer["@type"]).toBe("Answer");
      expect(item.name).toBe(shown[i].q);
      expect(item.acceptedAnswer.text).toBe(shown[i].a);
    });
  });

  it("claims no rating, review or count, and says nothing the page cannot back", () => {
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/aggregateRating|"review"|ratingValue|reviewCount|userInteractionCount|interactionStatistic/i);
    expect(text).not.toMatch(UNBACKED);
    expect(text).not.toMatch(NOT_US);
  });

  it("cannot close its own script element", () => {
    expect(scripts[0]).not.toMatch(/<\/script/i);
  });
});

// ------------------------------------------------------------------ legal pages

describe("Privacy, Terms and Refunds", () => {
  const pages = [
    { path: "/privacy", metadata: privacy.metadata },
    { path: "/terms", metadata: terms.metadata },
    { path: "/refunds", metadata: refunds.metadata },
  ];

  it("are indexable, each canonical at its own address", () => {
    for (const { path: p, metadata } of pages) {
      expect(metadata.robots, p).toEqual({ index: true, follow: true });
      expect(metadata.alternates?.canonical, p).toBe(p);
      expect(metadata.openGraph, p).toMatchObject({ url: p, siteName: "Agathon", title: metadata.title, description: metadata.description });
      expect(metadata.twitter, p).toMatchObject({ title: metadata.title, description: metadata.description });
    }
  });

  it("have a title that fits with the suffix and a description of 120 to 160 characters", () => {
    for (const { path: p, metadata } of pages) {
      expect(`${String(metadata.title)} · Agathon`.length, p).toBeLessThanOrEqual(60);
      const d = String(metadata.description);
      expect(d.length, `${p}: ${d}`).toBeGreaterThanOrEqual(120);
      expect(d.length, `${p}: ${d}`).toBeLessThanOrEqual(160);
      expect(d, p).not.toMatch(NOT_US);
    }
  });

  it("take the plan's name from the plan", () => {
    expect(String(terms.metadata.description)).toContain("Agathon Test Plan");
    expect(String(refunds.metadata.description)).toContain("Agathon Test Plan");
    for (const file of ["terms", "refunds", "privacy"]) {
      const source = fs.readFileSync(path.join(APP, "(platform)", file, "page.tsx"), "utf8");
      const meta = source.slice(source.indexOf("const META"), source.indexOf("export const metadata"));
      expect(meta, file).not.toContain("Agathon Unlimited");
    }
  });
});

// ------------------------------------------------------------------ footer

describe("the footer", () => {
  it("links the math library and About before the legal pages", () => {
    const html = renderToStaticMarkup(createElement(LegalFooter));
    const links = [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [m[1], plain(m[2]).trim()]);
    expect(links).toEqual([[MATH_PATH, "Math by grade"], [ABOUT_PATH, "About"], ...LEGAL_LINKS.map((l) => [l.href, l.label])]);
  });
});

// ------------------------------------------------------------------ IndexNow

describe("IndexNow", () => {
  it("serves its key as a text file named for it", () => {
    expect(INDEXNOW_KEY).toMatch(/^[0-9a-f]{32}$/);
    const file = path.join(ROOT, "public", `${INDEXNOW_KEY}.txt`);
    expect(fs.readFileSync(file, "utf8").trim()).toBe(INDEXNOW_KEY);
  });

  it("submits every public page on the canonical host, with the key's address", () => {
    const payload = indexNowPayload();
    expect(payload.host).toBe(new URL(SITE_ORIGIN).host);
    expect(payload.key).toBe(INDEXNOW_KEY);
    expect(payload.keyLocation).toBe(`${SITE_ORIGIN}/${INDEXNOW_KEY}.txt`);
    expect(payload.urlList).toEqual(sitemap().map((e) => e.url));
  });

  it("builds for another origin, drops repeats, and refuses an address on another host", () => {
    const payload = indexNowPayload(["/", "/math", "/math"], "https://www.agathon.app");
    expect(payload).toEqual({
      host: "www.agathon.app",
      key: INDEXNOW_KEY,
      keyLocation: `https://www.agathon.app/${INDEXNOW_KEY}.txt`,
      urlList: ["https://www.agathon.app/", "https://www.agathon.app/math"],
    });
    expect(() => indexNowPayload(["https://example.com/x"], "https://www.agathon.app")).toThrow(/not on www\.agathon\.app/);
  });
});
