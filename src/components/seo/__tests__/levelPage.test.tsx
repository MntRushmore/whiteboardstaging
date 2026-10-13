import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// A different plan than the real one: no price or trial on these pages may be typed out.
vi.mock("@/lib/billing/unlimited", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/billing/unlimited")>();
  return { ...real, UNLIMITED_PLAN: { ...real.UNLIMITED_PLAN, name: "Agathon Test Plan", monthlyUsd: 31, trialDays: 10 } };
});

const { LevelPage, levelMetadata, pathColumns } = await import("../LevelPage");
const { default: MathLibraryPage, metadata: hubMetadata } = await import("@/app/(platform)/math/page");
const { PracticePicker } = await import("@/components/landing/PracticePicker");
const { GRADES } = await import("@/lib/learning/grades");
const { SIGN_UP_HREF } = await import("@/lib/landing/links");
const { levelBoard, levelCopy, levelNeighbors, levelSkills, warmUpSkills } = await import("@/lib/seo/levels");
const { COURSE_SLUGS, LEVELS, MATH_PATH, gradePath, levelBySlug, levelPath, skillPath } = await import("@/lib/seo/routes");
const { isTopicId } = await import("@/lib/learning/topics");
const { gradePath: gradeSkills } = await import("@/lib/learning/grades");

/** the page's text, entities read back, spaces made plain (the page keeps math on one line with no-break spaces) */
const plain = (markup: string) =>
  markup
    .replace(/<script\b[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[\s ]+/g, " ");

const linksOf = (html: string) =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1].match(/href="([^"]*)"/)?.[1] ?? "", words: plain(m[2]).trim() }));

const jsonLdOf = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

function headingsInOrder(html: string) {
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  expect(levels.filter((l) => l === 1)).toHaveLength(1);
  expect(levels[0]).toBe(1);
  for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
}

const NOT_US = /practis|\bmaths\b|\bticks?\b|\bticked\b|\brings?\b|\bringed\b|ring round|colour|centre|\bbrackets?\b|the way round|favourite/i;
/** the landing test's claims, on the whole page (its own skills' blurbs hold a percent, so no "%" rule here: levels.test.ts holds the page's own words to it) */
const CLAIMS = /testimonial|\brated\b|\breviews?\b|trusted by|thousands|millions|#1|\bbest\b|guarantee|proven|raise[sd]? (their )?grades|★|⭐/i;

describe("a grade's or a course's page", () => {
  for (const level of LEVELS) {
    describe(level.slug, () => {
      const html = renderToStaticMarkup(<LevelPage level={level} />);
      const text = plain(html);
      const links = linksOf(html);
      const copy = levelCopy(level);

      it("has one h1, the page's, and headings in order", () => {
        headingsInOrder(html);
        expect(plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "").trim()).toBe(copy.h1);
      });

      it("shows its path in order, each skill linked to its page, with its sample problem as text", () => {
        const skills = levelSkills(level);
        let at = 0;
        for (const skill of skills) {
          expect(links.some((l) => l.href === skill.href && l.words === skill.name), skill.id).toBe(true);
          const found = text.indexOf(skill.name, at);
          expect(found, skill.name).toBeGreaterThanOrEqual(0);
          at = found;
          for (const line of skill.problem.text) expect(text, `${skill.id}: ${line}`).toContain(line);
        }
        for (const line of levelBoard(level)) expect(text).toContain(line.text);
      });

      it("writes every problem in the board's hand as a picture of its text, hidden from screen readers", () => {
        const hands = [...html.matchAll(/<svg\b[^>]*data-lp-draw="(?:skill|board)-[^"]*"[^>]*>/g)].map((m) => m[0]);
        expect(hands.length).toBeGreaterThanOrEqual(levelSkills(level).length);
        for (const svg of hands) expect(svg).toContain('aria-hidden="true"');
      });

      it("links up, across and to Join", () => {
        expect(links.some((l) => l.href === "/" && l.words.startsWith("Agathon"))).toBe(true);
        expect(links.some((l) => l.href === MATH_PATH)).toBe(true);
        const { prev, next } = levelNeighbors(level);
        if (prev) expect(links.some((l) => l.href === levelPath(prev))).toBe(true);
        if (next) expect(links.some((l) => l.href === levelPath(next))).toBe(true);
        const joins = links.filter((l) => l.href === SIGN_UP_HREF);
        expect(joins.length).toBeGreaterThanOrEqual(3);
        for (const join of joins) expect(join.words).toBe("Join Agathon");
        for (const s of warmUpSkills(level)) expect(links.some((l) => l.href === s.href), s.id).toBe(true);
      });

      it("has structured data that parses and says what the page shows", () => {
        const data = jsonLdOf(html).flat();
        const types = data.map((d) => d["@type"]);
        expect(types).toEqual(["CollectionPage", "BreadcrumbList", "FAQPage"]);
        const faq = data.find((d) => d["@type"] === "FAQPage");
        const visible = [...html.matchAll(/<h3 class="[^"]*question[^"]*">([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => [plain(m[1]).trim(), plain(m[2]).trim()]);
        expect(visible).toEqual(faq.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [q.name, q.acceptedAnswer.text]));
        const items = data.find((d) => d["@type"] === "CollectionPage").mainEntity.itemListElement as { url: string }[];
        for (const item of items) expect(links.some((l) => item.url.endsWith(l.href) && l.href.startsWith(`${MATH_PATH}/`)), item.url).toBe(true);
      });

      it("is in US English and says nothing it cannot back", () => {
        expect(text).not.toMatch(NOT_US);
        expect(text).not.toMatch(CLAIMS);
      });

      it("takes the price and the trial from the plan, never typing them", () => {
        expect(text).toContain("Free for 10 days, then $31 a month");
        expect(text).not.toMatch(/\$25|7-day|7 days|free week/);
      });

      it("has its own title, description and canonical address, and asks to be indexed", () => {
        const meta = levelMetadata(level);
        expect(`${meta.title} · Agathon`.length).toBeLessThanOrEqual(60);
        expect(String(meta.description).length).toBeGreaterThanOrEqual(120);
        expect(String(meta.description).length).toBeLessThanOrEqual(160);
        expect(meta.alternates?.canonical).toBe(levelPath(level));
        expect(meta.robots).toEqual({ index: true, follow: true });
        expect(meta.openGraph?.url).toBe(levelPath(level));
        expect(meta.openGraph?.title).toBe(meta.title);
        expect((meta.twitter as { card?: string })?.card).toBe("summary_large_image");
      });
    });
  }

  it("shows what carries over from the grade below, and nothing for kindergarten or a course", () => {
    const third = renderToStaticMarkup(<LevelPage level={levelBySlug("3rd-grade")!} />);
    expect(plain(third)).toContain("Carried over from 2nd grade");
    expect(plain(renderToStaticMarkup(<LevelPage level={levelBySlug("kindergarten")!} />))).not.toContain("Carried over");
    expect(plain(renderToStaticMarkup(<LevelPage level={levelBySlug("algebra-1")!} />))).not.toContain("Carried over");
  });

  it("lays a path of 4 out in one row, 2 side by side, and longer ones in rows of 3", () => {
    expect([2, 3, 4, 5, 17].map(pathColumns)).toEqual([2, 3, 4, 3, 3]);
  });
});

describe("the hub", () => {
  const html = renderToStaticMarkup(<MathLibraryPage />);
  const text = plain(html);
  const links = linksOf(html);

  it("has one h1 and headings in order", () => {
    headingsInOrder(html);
  });

  it("links every grade and course", () => {
    for (const level of LEVELS) expect(links.some((l) => l.href === levelPath(level)), level.slug).toBe(true);
    expect(links.filter((l) => l.href === SIGN_UP_HREF).length).toBeGreaterThanOrEqual(3);
  });

  it("has structured data that lists every grade and course", () => {
    const data = jsonLdOf(html).flat();
    expect(data.map((d) => d["@type"])).toEqual(["CollectionPage", "BreadcrumbList"]);
    expect(data[0].mainEntity.itemListElement).toHaveLength(LEVELS.length);
  });

  it("is in US English, says nothing it cannot back, and types no price", () => {
    expect(text).not.toMatch(NOT_US);
    expect(text).not.toMatch(CLAIMS);
    expect(text).not.toMatch(/\$25|7-day|7 days|free week/);
  });

  it("has its own title, description and canonical address, and asks to be indexed", () => {
    expect(`${hubMetadata.title} · Agathon`.length).toBeLessThanOrEqual(60);
    expect(hubMetadata.alternates?.canonical).toBe(MATH_PATH);
    expect(hubMetadata.robots).toEqual({ index: true, follow: true });
  });
});

describe("the landing page's picker links into the library", () => {
  const html = renderToStaticMarkup(<PracticePicker />);
  const links = linksOf(html);

  it("links each grade to its page", () => {
    for (const g of GRADES) {
      const link = links.find((l) => l.href === gradePath(g.id));
      expect(link?.words, g.label).toBe(`See all of ${g.id === 0 ? "kindergarten" : g.label} math`);
    }
  });

  it("links each skill on a grade's path to its page, and each course to its course", () => {
    for (const g of GRADES) for (const id of gradeSkills(g.id).filter(isTopicId)) expect(links.some((l) => l.href === skillPath(id)), id).toBe(true);
    for (const slug of Object.values(COURSE_SLUGS)) expect(links.some((l) => l.href === `${MATH_PATH}/${slug}`), slug).toBe(true);
  });

  it("stays a server component with no script", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../landing/PracticePicker.tsx"), "utf8");
    expect(source).not.toMatch(/^["']use client["']/m);
    expect(html).not.toContain("<script");
  });
});
