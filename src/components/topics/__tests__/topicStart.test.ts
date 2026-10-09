import { describe, expect, it } from "vitest";
import type { MasteryLevel } from "@/lib/learning/contracts";
import { askPlaceholderFor, TOPIC_COPY, topicView, upNext } from "@/lib/learning/topics";
import { whyLabel } from "@/components/daily/TodayCard";
import { TODAY_COPY } from "@/lib/daily/copy";
import { isYoungGrade, pathShowsNext } from "../TopicStart";

const levels = (entries: Record<string, MasteryLevel> = {}) => new Map(Object.entries(entries)) as Map<string, MasteryLevel>;

describe("the home's secondary first steps", () => {
  it("Up next is left out when the skill path above already shows it as Next up", () => {
    const grade3 = upNext("other", levels({ add_subtract_within_1000: "mastered" }), [], 3);
    expect(grade3.next?.id).toBe("times_tables");
    expect(pathShowsNext(grade3.next, 3, "other")).toBe(true);
    // no grade and no course: no path, so Up next stays
    expect(pathShowsNext(topicView("times_tables", levels()), null, "other")).toBe(false);
    expect(pathShowsNext(null, 3, "other")).toBe(false);
  });

  it("Up next for an Algebra 1 student Almost there on Two-step equations is that, not pre-algebra review", () => {
    expect(upNext("algebra1", levels({ two_step_equations: "almost", inequalities: "practicing" })).next?.id).toBe("two_step_equations");
  });

  it("K-3 is young: Pick a topic alone on the home", () => {
    expect([0, 1, 2, 3].every((g) => isYoungGrade(g as 0))).toBe(true);
    expect(isYoungGrade(4)).toBe(false);
    expect(isYoungGrade(null)).toBe(false);
  });

  it("the words box's example fits the grade", () => {
    expect(askPlaceholderFor(0)).toBe(TOPIC_COPY.askPlaceholderYoung);
    expect(askPlaceholderFor(2)).toBe(TOPIC_COPY.askPlaceholderYoung);
    expect(askPlaceholderFor(3)).toBe(TOPIC_COPY.askPlaceholderMiddle);
    expect(askPlaceholderFor(5)).toBe(TOPIC_COPY.askPlaceholderMiddle);
    expect(askPlaceholderFor(7)).toBe(TOPIC_COPY.askPlaceholder);
    expect(askPlaceholderFor(null)).toBe(TOPIC_COPY.askPlaceholder);
  });
});

describe("In today's set", () => {
  it("says New only of a skill never tried; a practised next skill is Next up", () => {
    expect(whyLabel({ why: "next", level: "new" })).toBe(TODAY_COPY.whyNew);
    expect(whyLabel({ why: "next", level: "almost" })).toBe(TODAY_COPY.why.next);
    expect(whyLabel({ why: "next" })).toBe(TODAY_COPY.why.next);
    expect(whyLabel({ why: "weak", level: "practicing" })).toBe("Practice");
    expect(whyLabel({})).toBeNull();
  });
});
