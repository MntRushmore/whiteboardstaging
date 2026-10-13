import { describe, expect, it } from "vitest";
import { TRY_PROBLEMS } from "@/lib/try/problems";
import { buildStartInkSet, SKILL_EXAMPLES, startSkills } from "../inkSet";

const set = buildStartInkSet();

describe("the handwriting /start shows (GET /api/start/ink)", () => {
  it("every skill a family can pick has its example, and the hand writes every line of it", () => {
    for (const skill of startSkills()) {
      expect(set.skills[skill], skill).toBeDefined();
      expect(set.skills[skill].latex).toEqual([...SKILL_EXAMPLES[skill]]);
      for (const line of set.skills[skill].lines) {
        expect(line.strokes.length, skill).toBeGreaterThan(0);
        expect(line.width).toBeGreaterThan(0);
      }
    }
  });

  it("no example is left over for a skill no screen shows", () => {
    expect(Object.keys(SKILL_EXAMPLES).sort()).toEqual([...startSkills()].sort());
  });

  it("every try problem is written, line by line", () => {
    for (const p of TRY_PROBLEMS) {
      expect(set.problems[p.id], p.id).toHaveLength(p.lines.length);
    }
  });

  it("stays small enough to fetch after the first answer", () => {
    expect(JSON.stringify(set).length).toBeLessThan(140_000);
  });
});
