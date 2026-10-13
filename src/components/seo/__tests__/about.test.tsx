import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// A different plan than the real one: every price and trial on the page must follow it.
vi.mock("@/lib/billing/unlimited", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/billing/unlimited")>();
  return { ...real, UNLIMITED_PLAN: { ...real.UNLIMITED_PLAN, name: "Agathon Test Plan", monthlyUsd: 31, trialDays: 10 } };
});

const { default: AboutPage, metadata } = await import("@/app/(platform)/about/page");
const { AGATHON_DEFINITION, levelEntries } = await import("@/lib/seo/llms");
const { SIGN_UP_HREF, siteOrigin } = await import("@/lib/landing/links");
const { LEGAL } = await import("@/lib/legal");
const { MAX_KIDS } = await import("@/lib/family/contracts");

const html = renderToStaticMarkup(<AboutPage />);
const plain = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** the page's visible words (the JSON-LD and the ink script are not) */
const text = plain(html.replace(/<script\b[\s\S]*?<\/script>/g, " "));
const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1].match(/href="([^"]*)"/)?.[1] ?? "", words: plain(m[2]) }));
const origin = siteOrigin(process.env.NEXT_PUBLIC_SITE_URL);

describe("/about", () => {
  it("asks the question once, in the one h1, and keeps its headings in order", () => {
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    // the text a browser reads (the tutor’s underline is a drawing inside the word, not a word)
    const h1 = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "").replace(/<svg\b[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "");
    expect(h1).toBe("What is Agathon?");
  });

  it("opens with the one-sentence definition", () => {
    const afterH1 = html.slice(html.indexOf("</h1>"));
    expect(plain(afterH1.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "")).toBe(AGATHON_DEFINITION);
  });

  it("lists Agathon at a glance as terms a machine can read", () => {
    const dl = html.match(/<dl\b[\s\S]*?<\/dl>/)?.[0] ?? "";
    const terms = [...dl.matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map((m) => plain(m[1]));
    expect(terms).toEqual(["Type", "Grades", "Subjects", "Devices", "Price", "Free trial", "Website", "Contact", "Made by"]);
    const details = [...dl.matchAll(/<dd>([\s\S]*?)<\/dd>/g)].map((m) => plain(m[1]));
    expect(details[4]).toBe(`One plan, Agathon Test Plan: $31 a month for up to ${MAX_KIDS} kids. Cancel anytime, online.`);
    expect(details[5]).toContain("Free for 10 days.");
    expect(details[7]).toBe(LEGAL.contactEmail);
    expect(details[8]).toBe(LEGAL.operatorName);
  });

  it("takes every price, trial and plan name from the plan", () => {
    expect(text).toContain("$31 a month");
    expect(text).toContain("10 days");
    expect(text).toContain("Agathon Test Plan");
    expect(text).not.toMatch(/\$25|7-day|7 days|free week|Agathon Unlimited/);
  });

  it("covers the parts a parent and an answer engine ask about", () => {
    const h2s = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => plain(m[1]));
    for (const title of ["Agathon at a glance", "How it works", "Who it's for", "What it covers", "What it costs", "Devices", "Privacy and kids' data", "Who makes Agathon", "How to reach us"]) {
      expect(h2s, title).toContain(title);
    }
    // how it works: the board, check marks and circles, Help me's levels, Ask, Type it
    expect(text).toContain("A right step gets a blue check mark");
    expect(text).toContain("A slip gets a circle");
    expect(text).toMatch(/a Hint, the Next step .* or Solve it/);
    expect(text).toContain("hold the mic");
    expect(text).toContain("Type it on a laptop");
    expect(text).toContain("Cancel before the trial ends and you pay nothing");
  });

  it("links the math library, every grade and course, the policies, and Join", () => {
    const hrefs = links.map((l) => l.href);
    expect(hrefs).toContain("/math");
    for (const level of levelEntries()) expect(hrefs, level.path).toContain(level.path);
    for (const path of ["/privacy", "/privacy#children", "/terms", "/refunds"]) expect(hrefs, path).toContain(path);
    expect(hrefs).toContain(`mailto:${LEGAL.contactEmail}`);
    const joins = links.filter((l) => l.href === SIGN_UP_HREF);
    expect(joins.length).toBeGreaterThanOrEqual(3);
    for (const j of joins) expect(j.words).toBe("Join Agathon");
    // the bar's jumps land on parts of this page
    for (const id of ["how-it-works", "what-it-costs", "privacy", "contact"]) {
      expect(hrefs).toContain(`#${id}`);
      expect(html.match(new RegExp(`\\bid="${id}"`, "g")), id).toHaveLength(1);
    }
  });

  it("says who makes it with only what the legal pages state", () => {
    expect(text).toContain(`Agathon is made and run by ${LEGAL.operatorName}.`);
    expect(text).toContain(LEGAL.contactEmail);
    expect(text).not.toContain(LEGAL.postalAddress);
    expect(text).not.toMatch(/founded|headquarter|our team of|employees/i);
  });

  it("is in US English and claims nothing it cannot back", () => {
    expect(text).not.toMatch(/practis|\bmaths\b|\bticks?\b|\bticked\b|\brings?\b|\bringed\b|ring round|colour|centre|\bbrackets?\b|the way round|favourite/i);
    expect(text).not.toMatch(/\d+\s?%|\b\d[\d,]*\+(?=\s|$|[".,;:!?)])|testimonial|rated|review|trusted by|thousands|millions|#1|best|guarantee|proven|raise[sd]? (their )?grades|★|⭐/i);
  });

  it("describes every picture", () => {
    for (const img of html.match(/<img\b[^>]*>/g) ?? []) expect(img).toMatch(/\balt="/);
  });

  it("gives search and answer engines its metadata", () => {
    const title = `${String(metadata.title)} · Agathon`;
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.startsWith("What is Agathon?")).toBe(true);
    const description = String(metadata.description);
    expect(description.length).toBeGreaterThanOrEqual(120);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(metadata.alternates?.canonical).toBe("/about");
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.openGraph).toMatchObject({ url: "/about", title: metadata.title, description });
    expect(metadata.twitter).toMatchObject({ title: metadata.title, description });
  });

  it("describes itself in JSON-LD: an AboutPage whose main entity is the Organization", () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    expect(blocks).toHaveLength(1);
    const page = blocks[0];
    expect(page["@context"]).toBe("https://schema.org");
    expect(page["@type"]).toBe("AboutPage");
    expect(page.url).toBe(`${origin}/about`);
    expect(page.mainEntity["@type"]).toBe("Organization");
    // the landing page's graph uses the same id, so the two connect
    expect(page.mainEntity["@id"]).toBe(`${origin}/#organization`);
    expect(page.mainEntity.description).toBe(AGATHON_DEFINITION);
    expect(page.mainEntity.email).toBe(LEGAL.contactEmail);
    expect(page.mainEntity.parentOrganization.name).toBe(LEGAL.operatorName);
    expect(JSON.stringify(blocks)).not.toMatch(/aggregateRating|"review"/);
  });
});
