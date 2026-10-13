/**
 * The high-school skills' guides (guides/hs.ts): one for each of the 19 skills on no grade's path,
 * the right sizes, plain text with the math in Unicode, in US English, and saying nothing the page
 * cannot back (the landing page's word rules, src/components/landing/__tests__/landing.test.tsx).
 */
import { describe, expect, it } from "vitest";
import { gradeOfSkill } from "@/lib/learning/grades";
import { isTopicId, type TopicId } from "@/lib/learning/topics";
import { HS_GUIDES } from "../guides/hs";
import { SKILL_IDS } from "../routes";
import { SKILL_GUIDES } from "../skillGuide";

const HS = [
  "absolute_value",
  "polynomials",
  "factoring",
  "quadratic_equations",
  "radicals",
  "rational_expressions",
  "complex_numbers",
  "functions",
  "exponential_equations",
  "logarithms",
  "angles",
  "triangles",
  "coordinate_geometry",
  "trig_values",
  "trig_equations",
  "limits",
  "derivatives",
  "integrals",
  "units",
] as const satisfies readonly TopicId[];

const guides = Object.entries(HS_GUIDES) as [TopicId, NonNullable<(typeof HS_GUIDES)[TopicId]>][];

/** Every word a guide puts on the page. */
function wordsOf(g: NonNullable<(typeof HS_GUIDES)[TopicId]>): string[] {
  return [g.title, g.what, ...g.steps, ...g.slips.flatMap((s) => [s.slip, s.fix]), ...g.faq.flatMap((f) => [f.q, f.a])];
}

/** Sentences in a piece of text: a full stop, question or exclamation mark followed by a capital. */
const sentences = (text: string) => text.split(/(?<=[.?!])\s+(?=[A-Z“])/).filter(Boolean).length;

describe("the high-school guides", () => {
  it("cover exactly the 19 skills on no grade's path", () => {
    expect(guides.map(([id]) => id).sort()).toEqual([...HS].sort());
    const offPath = SKILL_IDS.filter((id) => gradeOfSkill(id) === null);
    expect([...offPath].sort()).toEqual([...HS].sort());
    for (const id of HS) expect(SKILL_GUIDES[id], id).toBe(HS_GUIDES[id]);
  });

  it("have the guide's sizes: 3–6 steps, 2–4 slips, 2–4 questions, 2–5 related skills", () => {
    for (const [id, g] of guides) {
      expect(g.title.length, id).toBeGreaterThan(3);
      expect(sentences(g.what), id).toBeGreaterThanOrEqual(2);
      expect(sentences(g.what), id).toBeLessThanOrEqual(4);
      expect(g.steps.length, id).toBeGreaterThanOrEqual(3);
      expect(g.steps.length, id).toBeLessThanOrEqual(6);
      for (const step of g.steps) expect(sentences(step), `${id}: ${step}`).toBe(1);
      expect(g.slips.length, id).toBeGreaterThanOrEqual(2);
      expect(g.slips.length, id).toBeLessThanOrEqual(4);
      for (const s of g.slips) {
        expect(s.slip.length, id).toBeGreaterThan(5);
        expect(sentences(s.fix), `${id}: ${s.fix}`).toBeLessThanOrEqual(3);
      }
      expect(g.faq.length, id).toBeGreaterThanOrEqual(2);
      expect(g.faq.length, id).toBeLessThanOrEqual(4);
      for (const f of g.faq) {
        expect(f.q.endsWith("?"), `${id}: ${f.q}`).toBe(true);
        expect(sentences(f.a), `${id}: ${f.a}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it("link 2–5 real skills, never their own", () => {
    for (const [id, g] of guides) {
      expect(g.related.length, id).toBeGreaterThanOrEqual(2);
      expect(g.related.length, id).toBeLessThanOrEqual(5);
      expect(new Set(g.related).size, id).toBe(g.related.length);
      for (const r of g.related) {
        expect(isTopicId(r), `${id} → ${r}`).toBe(true);
        expect(SKILL_IDS, `${id} → ${r}`).toContain(r);
        expect(r, id).not.toBe(id);
      }
    }
  });

  it("are plain text with the math in Unicode: no LaTeX, no markup", () => {
    for (const [id, g] of guides) {
      for (const text of wordsOf(g)) {
        expect(text, id).not.toMatch(/\\[a-zA-Z]|\$|\^\{|_\{|\{|\}|<\/?[a-z]/);
        // a minus in math is the real minus sign, and no word runs into a number
        expect(text, `${id}: ${text}`).not.toMatch(/(?:^|[\s(=])-\d|\d-\s/);
        expect(text.trim(), id).toBe(text);
      }
    }
  });

  it("are in US English, for US parents: math, practice, a check mark, parentheses", () => {
    for (const [id, g] of guides) {
      const text = wordsOf(g).join(" ");
      expect(text, id).not.toMatch(/practis|\bmaths\b|\bticks?\b|\bticked\b|\brings?\b|\bringed\b|ring round|colour|centre|\bbrackets?\b|the way round|favourite/i);
    }
  });

  it("say nothing they cannot back: no ratings, user counts, results or superlatives", () => {
    for (const [id, g] of guides) {
      const text = JSON.stringify(wordsOf(g));
      // the landing page's own check (landing.test.tsx), as it stands
      expect(text, id).not.toMatch(/\d+\s?%|\b\d[\d,]*\+(?=\s|$|[".,;:!?)])|testimonial|rated|review|trusted by|thousands|millions|#1|best|guarantee|proven|raise[sd]? (their )?grades/i);
      expect(text, id).not.toMatch(/★|⭐|4\.\d\/5|\$\s?\d/);
    }
  });

  it("use the slug's search words in their titles", () => {
    expect(HS_GUIDES.absolute_value?.title).toBe("Absolute value equations");
    expect(HS_GUIDES.factoring?.title).toBe("Factoring quadratics");
    expect(HS_GUIDES.trig_values?.title).toBe("Trig values of special angles");
    expect(HS_GUIDES.units?.title).toBe("Unit conversions");
    const titles = guides.map(([, g]) => g.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
  });
});
