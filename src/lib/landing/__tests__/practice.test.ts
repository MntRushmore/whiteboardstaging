import { describe, expect, it } from "vitest";
import { GRADES, gradePath } from "@/lib/learning/grades";
import { isTopicId } from "@/lib/learning/topics";
import { COURSES } from "@/lib/onboarding/courses";
import { DEFAULT_PRACTICE_TAB, HIGH_SCHOOL_TAB, practiceTabs } from "../practice";

describe("practiceTabs", () => {
  const tabs = practiceTabs();

  it("has one tab per grade, Kindergarten to 8th, then High school", () => {
    expect(tabs.map((t) => t.id)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", HIGH_SCHOOL_TAB]);
    expect(tabs[0].chip).toBe("K");
    expect(tabs[3].title).toBe("3rd grade");
    expect(tabs.some((t) => t.id === DEFAULT_PRACTICE_TAB)).toBe(true);
  });

  it("lists each grade's path from GRADE_PATHS, in teaching order", () => {
    for (const g of GRADES) {
      const tab = tabs.find((t) => t.id === String(g.id));
      expect(tab?.kind).toBe("grade");
      if (tab?.kind !== "grade") continue;
      expect(tab.skills.map((s) => s.id)).toEqual(gradePath(g.id).filter(isTopicId));
      expect(tab.skills.length).toBeGreaterThan(0);
    }
  });

  it("only lists skills a student can open today", () => {
    for (const tab of tabs) {
      if (tab.kind === "grade") for (const skill of tab.skills) expect(isTopicId(skill.id), skill.id).toBe(true);
    }
  });

  it("names each skill as the app does, with its example", () => {
    const third = tabs.find((t) => t.id === "3");
    const skill = third?.kind === "grade" ? third.skills.find((s) => s.id === "times_tables") : undefined;
    expect(skill?.name).toBe("Times tables");
    expect(skill?.icon).toBe("multiply");
    // the app keeps "6 × 7" on one line (keepMathsTogether), with no-break spaces
    expect(skill?.blurb?.replace(/[\s⁠]+/g, " ")).toBe("Multiply facts like 6 × 7");
  });

  it("offers the high-school courses, not Something else", () => {
    const hs = tabs.find((t) => t.id === HIGH_SCHOOL_TAB);
    expect(hs?.kind).toBe("courses");
    if (hs?.kind !== "courses") return;
    expect(hs.courses.map((c) => c.id)).toEqual(COURSES.filter((c) => c.id !== "other").map((c) => c.id));
    for (const course of hs.courses) expect(course.topics.length).toBeGreaterThan(0);
  });
});
