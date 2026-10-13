import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { LANDING_COPY } from "@/components/landing/copy";
import { UNLIMITED_PLAN } from "@/lib/billing/unlimited";
import { MAX_KIDS } from "@/lib/family/contracts";
import { practiceTabs } from "@/lib/landing/practice";
import { LEGAL } from "@/lib/legal";
import type { TopicId } from "@/lib/learning/topics";
import {
  AGATHON_DEFINITION,
  agathonFacts,
  FAQ,
  faqAnswer,
  howItWorks,
  linkablePaths,
  linksIn,
  LLMS_FULL_PATH,
  llmsFullTxt,
  levelEntries,
  llmsTxt,
  plainMath,
  PRIVACY_POINTS,
  skillEntries,
} from "../llms";
import { publicPages, SKILL_IDS, SKILL_SLUGS } from "../routes";
import { SKILL_GUIDES, type SkillGuide } from "../skillGuide";

const ORIGIN = "https://www.agathon.app";
const TEST_PLAN = { name: "Agathon Test Plan", monthlyUsd: 31, trialDays: 10 };

/** A guide as the seo-skills and seo-guides-k8 branches write them (theirs are empty on this branch). */
const GUIDE: SkillGuide = {
  title: "Long division",
  what: "Long division splits a big number into equal groups, one place value at a time.",
  steps: ["Divide the first digit.", "Multiply and subtract.", "Bring down the next digit.", "Repeat until no digits are left."],
  slips: [{ slip: "Forgetting a zero in the answer.", fix: "When a digit is too small to divide, write 0 above it." }],
  faq: [{ q: "When do kids learn long division?", a: "Usually in 4th grade, with one-digit divisors." }],
  related: ["division_facts", "multiply_multi_digit"],
};
const GUIDES: Partial<Record<TopicId, SkillGuide>> = { long_division: GUIDE };

const txt = llmsTxt(ORIGIN);
const full = llmsFullTxt(ORIGIN);
const fullWithGuide = llmsFullTxt(ORIGIN, UNLIMITED_PLAN, GUIDES);

/** The landing page's US English rule (landing.test.tsx). */
const NOT_US = /practis|\bmaths\b|\bticks?\b|\bticked\b|\brings?\b|\bringed\b|ring round|colour|centre|\bbrackets?\b|the way round|favourite/i;
/** The landing page's rule for its own words: no testimonials, ratings, counts, outcomes or superlatives. */
const CLAIMS = /\d+\s?%|\b\d[\d,]*\+(?=\s|$|[".,;:!?)])|testimonial|rated|review|trusted by|thousands|millions|#1|best|guarantee|proven|raise[sd]? (their )?grades/i;
/** The same, for whole files that also carry the app's math ("25% of 80") and other branches' guides. */
const CLAIMS_IN_FILES = /testimonial|\brated\b|trusted by|thousands of|millions of|#1|\bbest\b|guarantee|proven|raise[sd]? (their )?grades|★|⭐|\d\.\d\/5/i;

describe("llms.txt", () => {
  it("is in the llmstxt.org shape: the name, the definition as a quote, then sections of links", () => {
    const lines = txt.split("\n");
    expect(lines[0]).toBe("# Agathon");
    expect(lines[2]).toBe(`> ${AGATHON_DEFINITION}`);
    expect(lines.filter((l) => l.startsWith("# "))).toHaveLength(1);
    const sections = lines.filter((l) => l.startsWith("## "));
    expect(sections).toEqual(["## Product", "## Math library", "## Policies", "## Optional"]);
    // every list line under a section is a link with a note
    const after = lines.slice(lines.indexOf("## Product"));
    for (const line of after.filter((l) => l.startsWith("- "))) expect(line, line).toMatch(/^- \[[^\]]+\]\(https:\/\/[^)]+\): \S.{10,}$/);
  });

  it("links every public page once, and nothing else", () => {
    const urls = linksIn(txt);
    const allowed = linkablePaths();
    for (const url of urls) {
      expect(url.startsWith(`${ORIGIN}/`), url).toBe(true);
      expect(allowed.has(new URL(url).pathname), url).toBe(true);
    }
    const linked = [...txt.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => new URL(m[1]).pathname);
    for (const page of publicPages()) expect(linked.filter((p) => p === page.path), page.path).toHaveLength(1);
    expect(linked).toContain(LLMS_FULL_PATH);
    expect(linked).toHaveLength(publicPages().length + 1);
  });

  it("gives every skill its one line and the grades and courses it is on", () => {
    expect(txt).toContain(`[Long division](${ORIGIN}/math/long-division): 4th grade. Like 864 ÷ 4.`);
    expect(txt).toContain(`[Times tables](${ORIGIN}/math/times-tables): 3rd grade. Multiply facts like 6 × 7.`);
    expect(txt).toContain("Algebra 1 and Algebra 2. Multiply out parentheses: (x + 2)(x − 3).");
    for (const s of skillEntries()) expect(txt).toContain(`](${ORIGIN}/math/${SKILL_SLUGS[s.id]}): `);
  });

  it("names a skill by its guide once the guide is written", () => {
    const guided = llmsTxt(ORIGIN, UNLIMITED_PLAN, { long_division: { ...GUIDE, title: "Long division with remainders" } });
    expect(guided).toContain(`[Long division with remainders](${ORIGIN}/math/long-division)`);
  });

  it("states the key facts: who, devices, price and trial from the plan, privacy, the maker and the contact", () => {
    expect(txt).toContain("Kindergarten to 8th grade");
    expect(txt).toContain("Algebra 1, Geometry, Algebra 2 and Pre-calculus / Calculus");
    expect(txt).toContain("$25 a month for up to 6 kids");
    expect(txt).toContain("Free for 7 days");
    expect(txt).toContain(LEGAL.contactEmail);
    expect(txt).toContain(LEGAL.operatorName);
    expect(txt).toContain("never sells a child's data");
    expect(txt).toContain("Apple Pencil");
  });

  it("takes the price, the trial and the plan's name from the plan", () => {
    const other = llmsTxt(ORIGIN, TEST_PLAN);
    expect(other).toContain(`$31 a month for up to ${MAX_KIDS} kids`);
    expect(other).toContain("Free for 10 days");
    expect(other).toContain("Agathon Test Plan");
    expect(other).not.toMatch(/\$25|7 days|free week|Agathon Unlimited/);
  });
});

describe("llms-full.txt", () => {
  it("opens like llms.txt and links only public pages and the two text files", () => {
    expect(full.startsWith(`# Agathon\n\n> ${AGATHON_DEFINITION}\n`)).toBe(true);
    const allowed = linkablePaths();
    for (const url of [...linksIn(full), ...linksIn(fullWithGuide)]) {
      expect(url.startsWith(`${ORIGIN}/`), url).toBe(true);
      expect(allowed.has(new URL(url).pathname), url).toBe(true);
    }
  });

  it("carries the landing page's words, every question with its answer", () => {
    const copy = LANDING_COPY;
    for (const item of copy.faq.items) {
      expect(full).toContain(item.q);
      expect(full).toContain(item.a);
    }
    expect(full).toContain(copy.hero.lede);
    for (const step of copy.how.steps) expect(full).toContain(step.title.replace(/\n/g, " "));
    for (const f of copy.ask.features) expect(full).toContain(f.body);
    for (const f of copy.grownUps.features) expect(full).toContain(f.body);
    for (const i of copy.pricing.includes) expect(full).toContain(i);
    expect(full).toContain(copy.pricing.fine);
    expect(full).toContain(copy.join.body);
    // the demo's answer as plain text, not LaTeX
    expect(full).toContain("So 1/2 is bigger than 1/3.");
    expect(full).not.toMatch(/\\frac|\$\\/);
  });

  it("lists each grade's skill path in order, and each course's skills", () => {
    // each skill under its guide's title once written, else its name in the app (skillEntries)
    const names = new Map(skillEntries().map((e) => [e.id, e.name]));
    for (const tab of practiceTabs()) {
      if (tab.kind !== "grade") continue;
      const block = full.slice(full.indexOf(`### ${tab.title}\n`));
      tab.skills.forEach((s, i) => expect(block, `${tab.title} ${s.name}`).toContain(`${i + 1}. ${names.get(s.id as TopicId)}: `));
    }
    for (const entry of levelEntries()) {
      if (entry.level.kind !== "course") continue;
      const block = full.slice(full.indexOf(`### ${entry.label}\n`));
      for (const id of entry.skills) expect(block, `${entry.label} ${id}`).toContain(`- ${names.get(id)}: `);
    }
  });

  it("carries every skill guide written so far: title, what, steps, slips and questions", () => {
    expect(full).toContain("## Skill guides");
    for (const guide of Object.values(SKILL_GUIDES)) expect(full).toContain(`### ${guide.title}\n`);
    expect(fullWithGuide).toContain("## Skill guides");
    expect(fullWithGuide).toContain(`### ${GUIDE.title}`);
    expect(fullWithGuide).toContain(GUIDE.what);
    GUIDE.steps.forEach((s, i) => expect(fullWithGuide).toContain(`${i + 1}. ${s}`));
    expect(fullWithGuide).toContain(`- ${GUIDE.slips[0].slip} ${GUIDE.slips[0].fix}`);
    expect(fullWithGuide).toContain(`- ${GUIDE.faq[0].q} ${GUIDE.faq[0].a}`);
    expect(fullWithGuide).toContain(`Division facts (${ORIGIN}/math/division-facts)`);
  });

  it("takes the price and the trial from the plan", () => {
    const other = llmsFullTxt(ORIGIN, TEST_PLAN);
    expect(other).toContain("$31");
    expect(other).toContain("10 days");
    expect(other).not.toMatch(/\$25|7 days|free week|Agathon Unlimited/);
  });
});

describe("the words", () => {
  it("are US English everywhere", () => {
    for (const text of [txt, full, fullWithGuide, llmsTxt(ORIGIN, TEST_PLAN)]) expect(text).not.toMatch(NOT_US);
  });

  it("claim nothing the product cannot back", () => {
    for (const text of [txt, full, fullWithGuide]) expect(text).not.toMatch(CLAIMS_IN_FILES);
    // the words this file writes itself, held to the landing page's own rule
    const own = [
      AGATHON_DEFINITION,
      howItWorks(),
      ...agathonFacts(ORIGIN).map((f) => `${f.term} ${f.detail}`),
      ...PRIVACY_POINTS.map((p) => p.text),
    ].join("\n");
    expect(own).not.toMatch(CLAIMS);
    expect(own).not.toMatch(NOT_US);
  });

  it("says only what the Privacy Policy promises", async () => {
    const { default: PrivacyPage } = await import("@/app/(platform)/privacy/page");
    const policy = renderToStaticMarkup(createElement(PrivacyPage))
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ");
    for (const point of PRIVACY_POINTS) for (const words of point.policy) expect(policy, point.text).toContain(words);
  });

  it("finds every question it leans on in the landing copy", () => {
    for (const [key, q] of Object.entries(FAQ)) expect(faqAnswer(LANDING_COPY, q), key).not.toBeNull();
  });

  it("lists the facts an answer engine asks for, and only sourced ones", () => {
    const facts = agathonFacts(ORIGIN);
    expect(facts.map((f) => f.term)).toEqual(["Type", "Grades", "Subjects", "Devices", "Price", "Free trial", "Website", "Contact", "Made by"]);
    expect(facts.find((f) => f.term === "Website")?.detail).toBe("www.agathon.app");
    expect(facts.find((f) => f.term === "Contact")?.detail).toBe(LEGAL.contactEmail);
    expect(JSON.stringify(facts)).not.toMatch(/founded|since 20|headquarter|employees|team of/i);
  });

  it("turns the copy's LaTeX into plain math", () => {
    expect(plainMath("So $\\frac{1}{2}$ is bigger than $\\frac{1}{3}$.")).toBe("So 1/2 is bigger than 1/3.");
  });

  it("never types a price, a trial length or the plan's name in the source", () => {
    const root = path.join(__dirname, "../../../..");
    const files = ["src/lib/seo/llms.ts", "src/app/llms.txt/route.ts", "src/app/llms-full.txt/route.ts", "src/app/(platform)/about/page.tsx"];
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source, file).not.toMatch(/\$\s?\d|\b\d+ a month|\d+-day|\b\d+ days?\b|free week|a year|annual|Agathon Unlimited/i);
    }
  });
});

describe("scripts/seo-audit.mjs", async () => {
  const audit = await import("../../../../scripts/seo-audit.mjs");

  it("reads robots.txt as Google does: the crawler's own group, the longest rule, Allow on a tie", () => {
    const robots = audit.parseRobots(
      ["User-agent: *", "Allow: /", "Disallow: /board/", "Disallow: /api", "", "User-agent: CCBot", "Disallow: /", "", "User-agent: GPTBot", "User-agent: ClaudeBot", "Allow: /math", "Disallow: /", "Sitemap: https://www.agathon.app/sitemap.xml"].join("\n"),
    );
    expect(robots.sitemaps).toEqual(["https://www.agathon.app/sitemap.xml"]);
    expect(audit.robotsAllows(robots, "Googlebot", "/math/long-division")).toBe(true);
    expect(audit.robotsAllows(robots, "Googlebot", "/board/123")).toBe(false);
    expect(audit.robotsAllows(robots, "Googlebot", "/api/live")).toBe(false);
    expect(audit.robotsAllows(robots, "CCBot", "/")).toBe(false);
    expect(audit.robotsAllows(robots, "GPTBot", "/math/long-division")).toBe(true);
    expect(audit.robotsAllows(robots, "ClaudeBot", "/about")).toBe(false);
    expect(audit.robotsAllows(audit.parseRobots("User-agent: *\nDisallow: /*.json$\nAllow: /a"), "Bingbot", "/x.json")).toBe(false);
    expect(audit.robotsAllows(audit.parseRobots("User-agent: *\nDisallow:"), "Bingbot", "/anything")).toBe(true);
  });

  it("reads noindex from a meta or a header, for every crawler or a named one", () => {
    expect(audit.robotsDirectivesBlock("noindex, nofollow", "GPTBot")).toBe(true);
    expect(audit.robotsDirectivesBlock("index, follow, max-snippet: -1", "Googlebot")).toBe(false);
    expect(audit.robotsDirectivesBlock("googlebot: noindex", "Googlebot")).toBe(true);
    expect(audit.robotsDirectivesBlock("googlebot: noindex", "GPTBot")).toBe(false);
    expect(audit.robotsDirectivesBlock("none", "Bingbot")).toBe(true);
  });

  it("checks a page the way the crawlers see it", () => {
    const words = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    const good = `<html><head><title>Long division · Agathon</title><meta name="description" content="${"d".repeat(130)}"><link rel="canonical" href="https://www.agathon.app/math/long-division"><meta property="og:title" content="x"><meta property="og:image" content="https://x/og.png"><meta name="robots" content="index, follow"><script type="application/ld+json">{"@context":"https://schema.org","@type":"LearningResource"}</script></head><body><h1>Long division</h1><p>${words}</p><img src="a.png" alt=""><a href="/math">Math</a><a href="https://www.agathon.app/about">About</a><a href="https://elsewhere.org/">x</a><a href="#top">top</a><a href="mailto:a@b.c">mail</a></body></html>`;
    const args = { pagePath: "/math/long-division", pageUrl: "http://localhost:3104/math/long-division", status: 200, location: null, headers: new Headers(), agent: "Googlebot", siteOrigins: new Set(["http://localhost:3104", "https://www.agathon.app"]), sitemapOrigins: ["https://www.agathon.app"] };
    const ok = audit.checkHtml({ ...args, body: good });
    expect(ok.issues).toEqual([]);
    expect(ok.info.links.sort()).toEqual(["/about", "/math"]);
    expect(ok.info.words).toBeGreaterThanOrEqual(300);

    const bad = `<html><head><title>${"t".repeat(70)}</title><meta name="robots" content="noindex"><link rel="canonical" href="https://agathon.app/parents"><script type="application/ld+json">{"@type":"Product","aggregateRating":{"@type":"AggregateRating"}}</script><script type="application/ld+json">{oops</script></head><body><h1>a</h1><h1>b</h1><img src="x.png"><p>few words</p></body></html>`;
    const checks = audit.checkHtml({ ...args, body: bad, headers: new Headers({ "x-robots-tag": "noindex" }) }).issues.map((i: { level: string; check: string; message: string }) => `${i.level} ${i.check}: ${i.message}`);
    for (const expected of [
      "error noindex: X-Robots-Tag says noindex",
      'error noindex: <meta name="robots"> says noindex',
      "warn title: title over 60 characters",
      "error description: no meta description",
      "error canonical: canonical points to another page",
      "error canonical: canonical on another host than the sitemap",
      "error h1: more than one <h1>",
      "error json-ld: a JSON-LD block has no @context",
      "error json-ld: a JSON-LD block has aggregateRating (never on Agathon's pages)",
      "error og: no og:title",
      "error og: no og:image",
      "error img-alt: an <img> with no alt",
      "warn words: fewer than 250 words of visible text",
    ]) {
      expect(checks, expected).toContain(expected);
    }
    expect(checks.some((c: string) => c.startsWith("error json-ld: a JSON-LD block does not parse"))).toBe(true);
    // Cloudflare's email obfuscation: a warning, and its link is not followed
    const hidden = audit.checkHtml({ ...args, body: good.replace("<a href=\"#top\">", '<a href="/cdn-cgi/l/email-protection#abc"><span class="__cf_email__">[email protected]</span></a><a href="#top">') });
    expect(hidden.issues.map((i: { check: string }) => i.check)).toEqual(["email"]);
    expect(hidden.info.links).not.toContain("/cdn-cgi/l/email-protection");
    expect(audit.checkHtml({ ...args, body: "", status: 308, location: "/x" }).issues[0].check).toBe("status");
    expect(audit.checkHtml({ ...args, body: "", status: 403, agent: "GPTBot" }).issues[0].detail).toBe("GPTBot gets 403");
  });

  it("flags two pages with one title", () => {
    const issues = audit.duplicateIssues([
      { path: "/a", info: { title: "Same", description: "One" } },
      { path: "/b", info: { title: "Same", description: "Two" } },
    ]);
    expect(issues.map((i: { path: string }) => i.path)).toEqual(["/a", "/b"]);
  });

  it("knows every public page without a sitemap, from routes.ts", () => {
    const source = fs.readFileSync(path.join(__dirname, "../routes.ts"), "utf8");
    expect(audit.pathsFromRoutesSource(source).sort()).toEqual(publicPages().map((p) => p.path).sort());
  });

  it("reads the links out of llms.txt", () => {
    const links: string[] = audit.textLinks(txt);
    expect(new Set(links)).toEqual(new Set(linksIn(txt)));
  });
});

describe("the routes", () => {
  it("serve plain text, built at build time", async () => {
    for (const mod of [await import("@/app/llms.txt/route"), await import("@/app/llms-full.txt/route")]) {
      expect(mod.dynamic).toBe("force-static");
      const res = mod.GET();
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      const body = await res.text();
      expect(body.startsWith("# Agathon\n")).toBe(true);
    }
  });

  it("cover every skill address", () => {
    expect(skillEntries().map((s) => s.id)).toEqual(SKILL_IDS);
  });
});
