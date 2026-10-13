/**
 * A skill's page (`/math/long-division`, SkillPage.tsx): its metadata (title, description,
 * canonical, robots), its JSON-LD, one h1 and headings in order, the math as real text, the answer
 * key in the HTML, the way in (Join Agathon), and the landing page's word rules. Every one of the 56
 * pages is rendered; a skill without a guide yet still makes a whole page.
 */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SIGN_UP_HREF } from "@/lib/landing/links";
import { HS_GUIDES } from "@/lib/seo/guides/hs";
import { MATH_PATH, SKILL_IDS, SKILL_SLUGS, skillPath } from "@/lib/seo/routes";
import { skillGuide } from "@/lib/seo/skillGuide";
import { skillContent } from "@/lib/seo/skillContent";
import type { TopicId } from "@/lib/learning/topics";
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  practiceHeading,
  relatedSkills,
  SkillPage,
  skillDescription,
  skillMetadata,
  skillTitle,
  skillWords,
  titleCase,
  TITLE_MAX,
} from "../SkillPage";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/** the page's text, entities read back */
const plain = (markup: string) =>
  markup
    .replace(/<script\b[\s\S]*?<\/script>/g, " ")
    .replace(/<style\b[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");

/** raw text (a guide's own words) with its spacing as the page's text has it */
const norm = (text: string) => text.replace(/\s+/g, " ").trim();

const html = new Map<TopicId, string>();
beforeAll(() => {
  for (const id of SKILL_IDS) html.set(id, renderToStaticMarkup(<SkillPage id={id} />));
});

const jsonLd = (markup: string) => [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);

const SAMPLE: TopicId[] = ["long_division", "times_tables", "add_fractions_unlike", "two_step_equations", "derivatives", "systems", "trig_equations", "units"];

describe("a skill page's metadata", () => {
  it("has a title of at most 60 characters with the suffix, the search words first, unique to the page", () => {
    const titles = SKILL_IDS.map((id) => String(skillMetadata(id).title));
    for (const [i, t] of titles.entries()) {
      expect(`${t} · Agathon`.length, t).toBeLessThanOrEqual(TITLE_MAX);
      expect(t.toLowerCase(), t).toContain(skillWords(SKILL_IDS[i]).name.toLowerCase().split(" ")[0]);
    }
    expect(new Set(titles).size).toBe(titles.length);
    expect(skillTitle("Long division")).toBe("Long Division Practice: Worked Example & Problems");
  });

  it("keeps a long name inside 60 characters", () => {
    expect(skillTitle("Adding fractions with unlike denominators")).toBe("Adding Fractions with Unlike Denominators Practice");
    for (const name of ["Multiplying by multiples of 10 and 100 and 1000", "A".repeat(80)]) expect(`${skillTitle(name)} · Agathon`.length).toBeLessThanOrEqual(TITLE_MAX);
  });

  it("has a description of 120–160 characters that says what the page gives, unique to the page, with or without a guide", () => {
    const descriptions = SKILL_IDS.map((id) => String(skillMetadata(id).description));
    for (const d of descriptions) {
      expect(d.length, d).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
      expect(d.length, d).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(d, d).toMatch(/worked example/);
      expect(d, d).toMatch(/answer key/);
    }
    expect(new Set(descriptions).size).toBe(descriptions.length);
    // every skill's description fits in both states, before and after its guide is written
    for (const id of SKILL_IDS) {
      const w = skillWords(id);
      for (const name of [w.name, practiceHeading(w.name)]) {
        for (const guide of [true, false]) {
          const d = skillDescription(name.replace(/ practice$/, ""), w.level?.label ?? null, guide);
          expect(d.length, d).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
          expect(d.length, d).toBeLessThanOrEqual(DESCRIPTION_MAX);
        }
      }
    }
  });

  it("is indexable, canonical to its own address, with Open Graph and Twitter cards", () => {
    for (const id of SKILL_IDS) {
      const m = skillMetadata(id);
      expect(m.robots, id).toEqual({ index: true, follow: true });
      expect(m.alternates?.canonical, id).toBe(`${MATH_PATH}/${SKILL_SLUGS[id]}`);
      expect(m.openGraph?.url, id).toBe(skillPath(id));
      expect(m.openGraph?.title, id).toBe(`${String(m.title)} · Agathon`);
      expect(m.openGraph?.description, id).toBe(m.description);
      expect((m.twitter as { card?: string } | undefined)?.card, id).toBe("summary_large_image");
    }
  });

  it("title-cases the way headlines do", () => {
    expect(titleCase("Two-step equations")).toBe("Two-Step Equations");
    expect(titleCase("Adding fractions with unlike denominators")).toBe("Adding Fractions with Unlike Denominators");
    expect(titleCase("Trig values of special angles")).toBe("Trig Values of Special Angles");
  });
});

describe("a skill page", () => {
  it("has exactly one h1, the skill's practice heading, and headings in order", () => {
    for (const id of SKILL_IDS) {
      const page = html.get(id)!;
      const levels = [...page.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
      expect(levels.filter((l) => l === 1), id).toHaveLength(1);
      expect(levels[0], id).toBe(1);
      for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], id).toBeLessThanOrEqual(1);
      const h1 = page.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
      expect(plain(h1).trim(), id).toBe(skillWords(id).h1);
    }
    expect(practiceHeading("Long division")).toBe("Long division practice");
    expect(practiceHeading("Adding fractions with unlike denominators")).toBe("Practice adding fractions with unlike denominators");
  });

  it("puts every problem, every answer and every worked line in the HTML as text", () => {
    for (const id of SKILL_IDS) {
      const text = plain(html.get(id)!);
      const c = skillContent(id);
      for (const p of c.problems) {
        for (const l of p.problem) expect(text, `${id}: ${l.text}`).toContain(l.text);
        expect(text, `${id}: ${p.answer.text}`).toContain(p.answer.text);
      }
      for (const l of [...c.example!.problem, ...c.example!.steps]) expect(text, `${id}: ${l.text}`).toContain(l.text);
    }
  });

  it("keeps the answer key in the page, readable without a script, after the problems", () => {
    for (const id of SAMPLE) {
      const page = html.get(id)!;
      const key = page.indexOf('id="answer-key"');
      expect(key, id).toBeGreaterThan(page.indexOf('id="practice"'));
      expect(page.slice(key, key + 400), id).toMatch(/^id="answer-key"[^>]*data-print-open/);
      expect(page.slice(key), id).toMatch(/<table[\s\S]*<th scope="col">Answer<\/th>/);
      // the answer for long division's first problem, worked by the engine
      if (id === "long_division") expect(plain(page.slice(key))).toContain(`${skillContent(id).problems[0].problem[0].text} ${skillContent(id).problems[0].answer.text}`);
    }
  });

  it("hides the handwriting from screen readers, next to the same words as text", () => {
    for (const id of SAMPLE) {
      const svgs = [...html.get(id)!.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0]);
      expect(svgs.length, id).toBeGreaterThan(3);
      for (const svg of svgs) expect(svg, id).toMatch(/aria-hidden="true"|role="img" aria-label="[^"]{10,}"/);
    }
  });

  it("has JSON-LD that parses: the learning resource, its breadcrumbs, and the guide's questions", () => {
    for (const id of SKILL_IDS) {
      const page = html.get(id)!;
      const w = skillWords(id);
      const data = jsonLd(page);
      const resource = data.find((d) => d["@type"] === "LearningResource")!;
      expect(resource, id).toBeTruthy();
      expect(resource.name).toBe(w.h1);
      expect(resource.description).toBe(w.description);
      expect(resource.isAccessibleForFree).toBe(true);
      expect(resource.inLanguage).toBe("en-US");
      expect(resource.learningResourceType).toBe("Worked example, practice problems");
      expect(resource.teaches).toBe(w.name);
      expect(String(resource.url)).toMatch(new RegExp(`^https?://[^/]+${skillPath(id)}$`));
      expect((resource.provider as Record<string, unknown>)["@type"]).toBe("Organization");
      expect(JSON.stringify(data), id).not.toMatch(/aggregateRating|"review"/);
      const crumbs = data.find((d) => d["@type"] === "BreadcrumbList")!;
      const items = crumbs.itemListElement as { position: number; name: string; item: string }[];
      // Agathon › Math › its grade or course › the skill, as the level pages start theirs: at the home page
      expect(items.slice(0, 2).map((i) => i.name)).toEqual(["Agathon", "Math"]);
      expect(new URL(items[0].item).pathname).toBe("/");
      expect(new URL(items[1].item).pathname).toBe(MATH_PATH);
      if (w.level) expect(items[2]).toMatchObject({ name: w.level.label, position: 3 });
      expect(items).toHaveLength(w.level ? 4 : 3);
      expect(items.at(-1)!.name).toBe(w.name);
      expect(items.at(-1)!.item).toBe(resource.url);
      expect(items.map((i) => i.position)).toEqual(items.map((_, k) => k + 1));
      const faq = data.find((d) => d["@type"] === "FAQPage");
      const guide = skillGuide(id);
      if (guide) {
        // the questions on the page, word for word
        const questions = (faq!.mainEntity as { name: string; acceptedAnswer: { text: string } }[]).map((q) => [q.name, q.acceptedAnswer.text]);
        expect(questions).toEqual(guide.faq.map((f) => [f.q, f.a]));
        const text = plain(page);
        for (const [q, a] of questions) {
          expect(text).toContain(norm(q));
          expect(text).toContain(norm(a));
        }
      } else expect(faq, id).toBeUndefined();
    }
  });

  it("has the breadcrumb up to its grade or course, and links across to related skills", () => {
    const division = html.get("long_division")!;
    expect(division).toContain(`href="${MATH_PATH}"`);
    expect(division).toContain('href="/math/4th-grade"');
    const crumbs = division.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)![0];
    expect(plain(crumbs).trim()).toBe("Agathon Math 4th grade Long division");
    expect(crumbs).toContain('href="/"');
    expect(crumbs).toMatch(/<li aria-current="page">Long division<\/li>/);
    const derivatives = html.get("derivatives")!;
    expect(derivatives).toContain('href="/math/precalculus-and-calculus"');
    // a course is named as its own level page names it
    expect(plain(derivatives.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)![0]).trim()).toBe("Agathon Math Precalculus and calculus Derivatives");
    for (const id of SKILL_IDS) {
      const page = html.get(id)!;
      const related = relatedSkills(id);
      expect(related.length, id).toBeGreaterThanOrEqual(1);
      for (const r of related) {
        expect(r, id).not.toBe(id);
        expect(page, `${id} → ${r}`).toContain(`href="${skillPath(r)}"`);
      }
    }
  });

  it("sends Join Agathon to the sign-up form, and says the plan's terms from the plan", () => {
    for (const id of SAMPLE) {
      const page = html.get(id)!;
      const joins = [...page.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter((m) => m[1].includes(`href="${SIGN_UP_HREF.replace(/&/g, "&amp;")}"`));
      expect(joins.length, id).toBeGreaterThanOrEqual(2);
      for (const j of joins) expect(plain(j[2]).trim()).toBe("Join Agathon");
    }
  });

  it("says only what Agathon does: a check mark, a circle, hints before answers, a topic board's new problems", () => {
    const text = plain(html.get("long_division")!);
    expect(text).toContain("A right step gets a blue check mark.");
    expect(text).toContain("The whole solution only appears if they choose Solve it.");
    expect(text).toMatch(/Choose “Long division” under Pick a topic and the tutor works one example, then writes four new problems/);
    expect(text).toContain("It's on Agathon's 4th grade path");
  });

  it("is in US English, and says nothing it cannot back", () => {
    for (const id of SKILL_IDS) {
      const page = html.get(id)!;
      // the words, without the math (a percent problem's 25% is math, not a claim)
      const words = plain(page.replace(/<(table|ol)\b[^>]*class="[^"]*(?:keyTable|problems|work)[^"]*"[\s\S]*?<\/\1>/g, " "));
      expect(words, id).not.toMatch(/practis|\bmaths\b|\bticks?\b|\bticked\b|\brings?\b|\bringed\b|ring round|colour|centre|\bbrackets?\b|the way round|favourite/i);
      expect(words, id).not.toMatch(/testimonial|\brated\b|\breviews?\b|trusted by|thousands|millions|#1|\bbest\b|guarantee|proven|raise[sd]? (their )?grades/i);
      expect(words, id).not.toMatch(/★|⭐|4\.\d\/5/);
    }
  });

  it("never types a price, a trial length or a plan name in its own files", () => {
    for (const file of ["../SkillPage.tsx", "../skillPage.module.css", "../../../lib/seo/skillContent.ts", "../../../lib/seo/guides/hs.ts"]) {
      const source = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(source, file).not.toMatch(/\$\s?\d|\b25 a month|\d+-day|\b\d+ days\b|free week|a year|annual|Unlimited/i);
    }
  });

  it("is a worksheet when printed: the problems, then the answers, without the bar, the footer or the way in", () => {
    const css = fs.readFileSync(path.join(__dirname, "../skillPage.module.css"), "utf8");
    const print = css.slice(css.indexOf("@media print"));
    expect(print).toMatch(/\.page > header,\s*\.noPrint,\s*\.page \+ :global\(footer\)\s*\{\s*display: none !important;/);
    expect(print).toMatch(/\.answerKey \{\s*break-before: page;/);
    const page = html.get("long_division")!;
    // the library's bar is the page's own header (hidden by `.page > header`)
    expect(page).toMatch(/^<div class="[^"]*" data-skill-page="">(?:<script type="application\/ld\+json">[\s\S]*?<\/script>)+<header\b/);
    // the top, the example, the steps, the slips, the way in, the questions and the related skills are left off the paper
    for (const part of ["worked-example", "how-to", "slips", "on-agathon", "questions", "related"]) expect(page, part).toMatch(new RegExp(`id="${part}" class="[^"]*noPrint`));
    expect(page).toMatch(/<header class="[^"]*hero[^"]*noPrint/);
    // the practice set and its answer key are printed
    expect(page).not.toMatch(/id="practice" class="[^"]*noPrint/);
  });

  it("uses no decorative gradients", () => {
    const css = fs.readFileSync(path.join(__dirname, "../skillPage.module.css"), "utf8");
    expect(css).not.toMatch(/gradient\(/);
  });
});

describe("a skill without a guide yet", () => {
  it("still makes a whole page: the math, the way in and the related skills, without the guide's parts", async () => {
    vi.resetModules();
    vi.doMock("@/lib/seo/skillGuide", () => ({ skillGuide: () => null, SKILL_GUIDES: {} }));
    const mod = await import("../SkillPage");
    const page = renderToStaticMarkup(<mod.SkillPage id="long_division" />);
    const text = plain(page);
    expect(page.match(/<h1\b/g)).toHaveLength(1);
    expect(plain(page.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)![1]).trim()).toBe("Long division practice");
    expect(text).toContain("Watch one worked out");
    expect(text).toContain("Practice problems");
    expect(text).toContain("Answer key");
    expect(text).not.toContain("How to do it");
    expect(text).not.toContain("Where kids slip");
    expect(text).not.toContain("Questions parents ask");
    expect(text).toContain("Related skills");
    expect(jsonLd(page).some((d) => d["@type"] === "FAQPage")).toBe(false);
    const m = mod.skillMetadata("long_division");
    expect(String(m.description).length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
    // the related skills fall back to the ones beside it on its path
    expect(mod.relatedSkills("long_division", null)).toEqual(["multiply_multi_digit", "equivalent_fractions", "add_fractions_like"]);
    vi.doUnmock("@/lib/seo/skillGuide");
  });

  it("each high-school skill has its guide's words on its page", () => {
    for (const [id, g] of Object.entries(HS_GUIDES) as [TopicId, NonNullable<(typeof HS_GUIDES)[TopicId]>][]) {
      const text = plain(html.get(id)!);
      expect(text, id).toContain(norm(g.what));
      for (const s of g.steps) expect(text, id).toContain(norm(s));
      for (const s of g.slips) expect(text, id).toContain(norm(s.slip));
    }
  });
});
