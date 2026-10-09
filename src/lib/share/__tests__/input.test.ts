import { describe, expect, it } from "vitest";
import { avatarEmoji, shareCardData, skillNames } from "../input";

describe("shareCardData", () => {
  it("turns a page's ids into the card's words", () => {
    expect(
      shareCardData({ name: "Maya J", avatar: "fox", grade: 3, problems: 42, independent: 28, streak: 5, mastered: ["times_tables", "add_within_100"] }),
    ).toEqual({
      name: "Maya J",
      avatar: "🦊",
      gradeLabel: "3rd grade",
      problems: 42,
      independent: 28,
      streak: 5,
      mastered: ["Times tables", "Adding 2-digit numbers"],
      link: null,
    });
  });

  it("uses the course when there is no grade, and cleans the numbers", () => {
    const data = shareCardData({ grade: null, course: "Algebra 1", problems: -3, independent: Number.NaN, streak: 2.7 });
    expect(data.gradeLabel).toBe("Algebra 1");
    expect([data.problems, data.independent, data.streak]).toEqual([0, 0, 2]);
    expect(data.mastered).toEqual([]);
  });

  it("keeps at most three skills, without duplicates or 'other'", () => {
    expect(skillNames(["fractions", "Fractions", "other", "", "Long division"])).toEqual(["Fractions", "Long division"]);
    expect(shareCardData({ problems: 1, mastered: ["a", "b", "c", "d"] }).mastered).toEqual(["a", "b", "c"]);
  });
});

describe("avatarEmoji", () => {
  it("knows avatar ids and passes emoji through, but never a word", () => {
    expect(avatarEmoji("owl")).toBe("🦉");
    expect(avatarEmoji("🐼")).toBe("🐼");
    expect(avatarEmoji("Maya")).toBeNull();
    expect(avatarEmoji("12")).toBeNull();
    expect(avatarEmoji(null)).toBeNull();
  });
});
