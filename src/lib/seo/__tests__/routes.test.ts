import { describe, expect, it } from "vitest";
import { formsFor } from "@/lib/learning/generators";
import { TOPIC_IDS } from "@/lib/learning/topics";
import { COURSE_IDS } from "@/lib/onboarding/courseIds";
import { LEVELS, SKILL_IDS, SKILL_SLUGS, levelBySlug, mathSlugs, publicPages, skillBySlug } from "../routes";

describe("SEO routes", () => {
  it("gives every topic the app can teach an address", () => {
    const teachable = TOPIC_IDS.filter((id) => formsFor(id).length > 0);
    expect([...SKILL_IDS].sort()).toEqual([...teachable].sort());
  });

  it("gives every grade and every real course a level", () => {
    expect(LEVELS.filter((l) => l.kind === "grade")).toHaveLength(9);
    expect(LEVELS.filter((l) => l.kind === "course").map((l) => (l.kind === "course" ? l.course : null)).sort()).toEqual(
      COURSE_IDS.filter((c) => c !== "other").sort(),
    );
  });

  it("never lets two pages share a slug (levels and skills share /math/[slug])", () => {
    const slugs = mathSlugs();
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("resolves each slug to the one page that owns it", () => {
    for (const l of LEVELS) expect(levelBySlug(l.slug)).toEqual(l);
    for (const id of SKILL_IDS) expect(skillBySlug(SKILL_SLUGS[id])).toBe(id);
    expect(levelBySlug("long-division")).toBeNull();
    expect(skillBySlug("3rd-grade")).toBeNull();
  });

  it("lists each public page once, the landing page first", () => {
    const paths = publicPages().map((p) => p.path);
    expect(paths[0]).toBe("/");
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toHaveLength(1 + 1 + LEVELS.length + SKILL_IDS.length + 1 + 3);
  });
});
