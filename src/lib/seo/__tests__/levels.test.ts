import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { drawProblems } from "@/lib/learning/generators";
import { GRADE_PATHS, gradePath } from "@/lib/learning/grades";
import { courseTopicIds, isTopicId } from "@/lib/learning/topics";
import { handInk } from "@/lib/landing/handInk";
import { GRADE_STARTERS, STARTER_PROBLEMS } from "@/lib/onboarding/courses";
import {
  HUB_COPY,
  LIBRARY_COPY,
  cardWords,
  hubJsonLd,
  levelBoard,
  levelCopy,
  levelJsonLd,
  levelName,
  levelNeighbors,
  levelSkillIds,
  levelSkills,
  mathText,
  sampleProblem,
  siteUrl,
  warmUpSkills,
} from "../levels";
import { LEVELS, SKILL_IDS, levelBySlug, levelPath, mathSlugs, skillPath } from "../routes";

/** The landing page's rules for words (src/components/landing/__tests__/landing.test.tsx), on this page's words. */
const CLAIMS = /\d+\s?%|\b\d[\d,]*\+(?=\s|$|[".,;:!?)])|testimonial|rated|review|trusted by|thousands|millions|#1|best|guarantee|proven|raise[sd]? (their )?grades/i;
const NOT_US = /practis|\bmaths\b|\bticks?\b|\bticked\b|\brings?\b|\bringed\b|ring round|colour|centre|\bbrackets?\b|the way round|favourite/i;
/** A price, a trial length or a plan name typed out (the landing test's, plus the plan's name). */
const PRICE = /\$\s?25\b|\b25 a month|7-day|\b7 days|\$199|a year|annual|free week|Agathon Unlimited/i;

/** Every hand-written word on every level page and the hub (not the app's own skill names). */
function allWords(): string {
  const levels = LEVELS.map((l) => {
    const name = levelName(l);
    const course = l.kind === "course";
    return {
      copy: levelCopy(l),
      path: [LIBRARY_COPY.pathTitle(name, course), LIBRARY_COPY.pathLede(levelSkills(l).length, course)],
      warm: [LIBRARY_COPY.warmTitle("2nd grade"), LIBRARY_COPY.warmBody("2nd grade", name)],
      how: LIBRARY_COPY.how(name, course),
      faq: LIBRARY_COPY.faqTitle(name, course),
    };
  });
  return JSON.stringify({ levels, library: LIBRARY_COPY, hub: HUB_COPY });
}

describe("mathText: the board's LaTeX as words a crawler reads", () => {
  it("writes the math in plain Unicode", () => {
    expect(mathText("46 \\times 7")).toBe("46 × 7");
    expect(mathText("\\frac{3}{4} + \\frac{1}{6}")).toBe("3/4 + 1/6");
    expect(mathText("72 - 35")).toBe("72 − 35");
    expect(mathText("x^{2} - 5x + 6 = 0")).toBe("x² − 5x + 6 = 0");
    expect(mathText("6\\frac{5}{6} - 3\\frac{5}{6}")).toBe("6 5/6 − 3 5/6");
    expect(mathText("\\sqrt{x + 6} = 2")).toBe("√(x + 6) = 2");
    expect(mathText("8^{2} + \\sqrt{64}")).toBe("8² + √64");
    expect(mathText("\\frac{x^{2} - 9x + 20}{x - 4}")).toBe("(x² − 9x + 20)/(x − 4)");
    expect(mathText("A = \\frac{1}{2}(6 + 10) \\cdot 6")).toBe("A = (1/2)(6 + 10) · 6");
    expect(mathText("y = -\\frac{2}{3}x + 9")).toBe("y = −(2/3)x + 9");
    expect(mathText("\\pi r^{2} = 144\\pi")).toBe("πr² = 144π");
    expect(mathText("C = 2\\pi \\cdot 4")).toBe("C = 2π · 4");
    expect(mathText("2x + 38^{\\circ} = 180^{\\circ}")).toBe("2x + 38° = 180°");
    expect(mathText("\\log_{2} 64 - \\log_{2} 4")).toBe("log₂ 64 − log₂ 4");
    expect(mathText("3^{x - 1} = 243")).toBe("3ˣ⁻¹ = 243");
    expect(mathText("\\lim_{x \\to -2} \\frac{x^{2} - 4}{x + 2}")).toBe("lim x→−2 (x² − 4)/(x + 2)");
    expect(mathText("\\frac{d}{dx}(5e^{3x})")).toBe("d/dx (5e³ˣ)");
    expect(mathText("\\int_{1}^{4} 4x^{3} \\, dx")).toBe("∫₁⁴ 4x³ dx");
    expect(mathText("\\tan x = 1, \\ 0 \\le x < 2\\pi")).toBe("tan x = 1, 0 ≤ x < 2π");
    expect(mathText("M = \\left(\\frac{4 + 10}{2}, \\frac{2 + 10}{2}\\right)")).toBe("M = ((4 + 10)/2, (2 + 10)/2)");
    expect(mathText("4 \\mathrm{cm} \\to \\mathrm{mm}")).toBe("4 cm → mm");
    expect(mathText("10\\% \\times x = 5")).toBe("10% × x = 5");
    expect(mathText("1{,}000")).toBe("1,000");
  });

  it("leaves no LaTeX in any problem the app's generators write", () => {
    for (const id of SKILL_IDS) {
      for (let seed = 1; seed <= 25; seed++) {
        for (const line of drawProblems(id, 1, seed)[0] ?? []) {
          expect(mathText(line), `${id} ${line}`).not.toMatch(/[\\{}]/);
        }
      }
    }
  });
});

describe("a level's skills", () => {
  it("lists a grade's path in teaching order, and a course's topics, only skills a student can open today", () => {
    for (const level of LEVELS) {
      const ids = levelSkillIds(level);
      expect(ids.length, level.slug).toBeGreaterThan(0);
      for (const id of ids) expect(isTopicId(id), id).toBe(true);
      if (level.kind === "grade") expect(ids).toEqual(GRADE_PATHS[level.grade].filter(isTopicId));
      else expect(ids).toEqual(courseTopicIds(level.course).filter(isTopicId));
    }
  });

  it("links each skill to its page in the library", () => {
    for (const level of LEVELS) for (const s of levelSkills(level)) expect(s.href).toBe(skillPath(s.id));
  });

  it("gives every skill a sample problem the board's hand can write, the same every build", () => {
    for (const id of SKILL_IDS) {
      const p = sampleProblem(id);
      expect(p.latex.length, id).toBeGreaterThan(0);
      expect(p.text).toHaveLength(p.latex.length);
      for (const line of p.latex) expect(() => handInk(line), `${id}: ${line}`).not.toThrow();
      for (const line of p.text) expect(line, id).not.toMatch(/[\\{}]/);
      expect(sampleProblem(id)).toEqual(p);
    }
  });

  it("carries over the grade below's skills that the grade does not list itself", () => {
    const third = levelBySlug("3rd-grade")!;
    expect(warmUpSkills(third).map((s) => s.id)).toEqual(["add_within_100", "subtract_within_100"]);
    for (const level of LEVELS) {
      if (level.kind !== "grade" || level.grade === 0) {
        expect(warmUpSkills(level), level.slug).toEqual([]);
        continue;
      }
      const own = new Set<string>(gradePath(level.grade));
      for (const s of warmUpSkills(level)) {
        expect(own.has(s.id)).toBe(false);
        expect(gradePath(level.grade, { warmUp: true })).toContain(s.id);
      }
    }
  });

  it("puts each level's first starter on its board, its first step checked", () => {
    for (const level of LEVELS) {
      const starter = level.kind === "grade" ? GRADE_STARTERS[level.grade][0] : STARTER_PROBLEMS[level.course][0];
      const lines = levelBoard(level);
      expect(lines.at(-1)?.checked).toBe(true);
      expect(lines.filter((l) => l.checked)).toHaveLength(1);
      expect(lines.map((l) => l.latex).join(" ")).toContain(starter.firstStep);
      expect(lines[0].latex).toContain(starter.lines[0]);
      for (const line of lines) {
        expect(() => handInk(line.latex), line.latex).not.toThrow();
        expect(line.text).not.toMatch(/[\\{}]/);
      }
    }
    expect(levelBoard(levelBySlug("3rd-grade")!).map((l) => l.text)).toEqual(["6 × 7 = 42"]);
    expect(levelBoard(levelBySlug("5th-grade")!).map((l) => l.text)).toEqual(["1/2 + 1/3", "= 3/6 + 2/6"]);
  });

  it("goes from each level to the one below and the one after, 8th grade on to Algebra 1", () => {
    expect(levelNeighbors(LEVELS[0]).prev).toBeNull();
    expect(levelNeighbors(LEVELS.at(-1)!).next).toBeNull();
    expect(levelNeighbors(levelBySlug("8th-grade")!).next?.slug).toBe("algebra-1");
    expect(levelNeighbors(levelBySlug("3rd-grade")!).prev?.slug).toBe("2nd-grade");
  });
});

describe("the words", () => {
  it("keeps every title within 60 characters with the ' · Agathon' suffix, and makes each one unique", () => {
    const titles = [...LEVELS.map((l) => levelCopy(l).title), HUB_COPY.title];
    for (const title of titles) expect(`${title} · Agathon`.length, title).toBeLessThanOrEqual(60);
    expect(new Set(titles).size).toBe(titles.length);
    // the search words first
    for (const level of LEVELS) expect(levelCopy(level).title.toLowerCase(), level.slug).toMatch(/^(kindergarten|\d(st|nd|rd|th) grade|algebra|geometry|precalculus)/);
  });

  it("gives every page a description of 120 to 160 characters, each its own", () => {
    const descriptions = [...LEVELS.map((l) => levelCopy(l).description), HUB_COPY.description];
    for (const d of descriptions) {
      expect(d.length, d).toBeGreaterThanOrEqual(120);
      expect(d.length, d).toBeLessThanOrEqual(160);
    }
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("answers three or four questions a parent asks about each level, in a few sentences each", () => {
    for (const level of LEVELS) {
      const faq = levelCopy(level).faq;
      expect(faq.length, level.slug).toBeGreaterThanOrEqual(3);
      expect(faq.length, level.slug).toBeLessThanOrEqual(4);
      for (const item of faq) {
        expect(item.q.endsWith("?"), item.q).toBe(true);
        const sentences = item.a.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).length;
        expect(sentences, item.a).toBeLessThanOrEqual(3);
      }
    }
  });

  it("headlines each level with skills on its own list", () => {
    for (const level of LEVELS) {
      const { headline } = levelCopy(level);
      expect(headline.length).toBeGreaterThanOrEqual(2);
      expect(headline.length).toBeLessThanOrEqual(3);
      for (const id of headline) expect(levelSkillIds(level), `${level.slug} ${id}`).toContain(id);
    }
  });

  it("says nothing it cannot back: no ratings, counts, results or 'best'", () => {
    expect(allWords()).not.toMatch(CLAIMS);
    expect(allWords()).not.toMatch(/★|⭐|\d\.\d\/5|official|aligned|alignment/i);
  });

  it("is in US English: math, practice, check mark, circle, parentheses", () => {
    expect(allWords()).not.toMatch(NOT_US);
    for (const level of LEVELS) for (const s of [...levelSkills(level), ...warmUpSkills(level)]) expect(`${s.name} ${s.blurb ?? ""}`).not.toMatch(NOT_US);
  });

  it("never types a price, a trial length or the plan's name", () => {
    expect(allWords()).not.toMatch(PRICE);
    const root = path.join(__dirname, "../../..");
    const files = [
      "lib/seo/levels.ts",
      "components/seo/LevelPage.tsx",
      "components/seo/mathCard.tsx",
      "app/(platform)/math/page.tsx",
      "app/(platform)/math/opengraph-image.tsx",
      "app/(platform)/math/[slug]/opengraph-image.tsx",
    ];
    for (const file of files) expect(fs.readFileSync(path.join(root, file), "utf8"), file).not.toMatch(PRICE);
  });
});

interface PageLd {
  "@type": string;
  url: string;
  mainEntity: { "@type": string; itemListElement: { position: number; url: string }[] };
}
interface CrumbsLd {
  "@type": string;
  itemListElement: { item: string }[];
}
interface FaqLd {
  "@type": string;
  mainEntity: { name: string; acceptedAnswer: { text: string } }[];
}

describe("structured data", () => {
  it("lists a level's skills, its breadcrumb and its questions", () => {
    for (const level of LEVELS) {
      const [page, crumbs, faq] = levelJsonLd(level) as unknown as [PageLd, CrumbsLd, FaqLd];
      expect(page["@type"]).toBe("CollectionPage");
      expect(page.url).toBe(siteUrl(levelPath(level)));
      expect(page.mainEntity["@type"]).toBe("ItemList");
      expect(page.mainEntity.itemListElement.map((i) => i.url)).toEqual(levelSkills(level).map((s) => siteUrl(s.href)));
      expect(page.mainEntity.itemListElement.map((i) => i.position)).toEqual(levelSkills(level).map((_, i) => i + 1));
      expect(crumbs["@type"]).toBe("BreadcrumbList");
      expect(crumbs.itemListElement.map((i) => i.item)).toEqual([siteUrl("/"), siteUrl("/math"), siteUrl(levelPath(level))]);
      expect(faq["@type"]).toBe("FAQPage");
      expect(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(levelCopy(level).faq.map((f) => [f.q, f.a]));
      expect(JSON.stringify(levelJsonLd(level))).not.toMatch(/aggregateRating|"review"/);
    }
  });

  it("lists every grade and course on the hub", () => {
    const [page, crumbs] = hubJsonLd() as unknown as [PageLd, CrumbsLd];
    expect(page["@type"]).toBe("CollectionPage");
    expect(page.mainEntity.itemListElement.map((i) => i.url)).toEqual(LEVELS.map((l) => siteUrl(levelPath(l))));
    expect(crumbs.itemListElement).toHaveLength(2);
  });
});

describe("the share card", () => {
  it("has words and a problem the hand can write for every /math/[slug] page", () => {
    for (const slug of mathSlugs()) {
      const words = cardWords(slug);
      expect(words, slug).not.toBeNull();
      expect(words!.title.length).toBeGreaterThan(0);
      expect(words!.problem.length, slug).toBeGreaterThan(0);
      for (const line of words!.problem) expect(() => handInk(line)).not.toThrow();
      expect(`${words!.eyebrow} ${words!.title}`).not.toMatch(NOT_US);
    }
    expect(cardWords("no-such-page")).toBeNull();
    expect(cardWords("long-division")?.title).toBe("Long division");
    expect(cardWords("long-division")?.eyebrow).toBe("4th grade math");
    expect(cardWords("3rd-grade")?.title).toBe("3rd grade math practice");
  });
});
