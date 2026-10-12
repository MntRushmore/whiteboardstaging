/**
 * Ask's reply when every board action was dropped (`keepExplanation`): the explanation stays, the
 * sentences claiming board work go, and the gate's line about what failed follows.
 */
import { describe, expect, it } from "vitest";
import { explains, keepExplanation, MIN_EXPLANATION_CHARS, replySentences } from "@/lib/server/askReply";

const PROBLEMS_FAILED = "Sorry, I couldn't check those problems, so I didn't write them. Try asking for them another way.";
const GENERIC = "Sorry, I couldn't do that on the board. Try asking another way.";

describe("keepExplanation", () => {
  it("a long explanation plus 'I put 5 problems on your board': the explanation stays, with the note", () => {
    const reply =
      "To divide fractions, **keep** the first fraction, **change** the sign to multiply, and **flip** the second one. " +
      "So $\\frac{1}{2} \\div \\frac{1}{4} = \\frac{1}{2} \\times \\frac{4}{1} = 2$. I put 5 problems on your board.";
    expect(keepExplanation(reply, PROBLEMS_FAILED)).toBe(
      "To divide fractions, **keep** the first fraction, **change** the sign to multiply, and **flip** the second one. " +
        "So $\\frac{1}{2} \\div \\frac{1}{4} = \\frac{1}{2} \\times \\frac{4}{1} = 2$.\n\n" +
        PROBLEMS_FAILED,
    );
  });

  it("a short 'Here you go — check your board!' becomes the failure line alone", () => {
    expect(keepExplanation("Here you go — check your board!", GENERIC)).toBe(GENERIC);
    // board talk only, however long; and nothing at all
    expect(keepExplanation("I wrote three problems for you. Put them on your screen? I put them on the board.", GENERIC)).toBe(GENERIC);
    expect(keepExplanation("", GENERIC)).toBe(GENERIC);
    // what is left is too short to be an explanation
    const short = "Nice work today!";
    expect(short.length).toBeLessThan(MIN_EXPLANATION_CHARS);
    expect(keepExplanation(`${short} I wrote the steps on your board.`, GENERIC)).toBe(GENERIC);
  });

  it("maths with periods inside $…$ and $$…$$ is never split, and its words never count as board talk", () => {
    const reply = "The decimal $3.5 + 1.25 = 4.75$ adds by lining up the points. Then $$x = 2. \\text{board} = 1.$$ holds. I put it on the board.";
    expect(replySentences(reply).map((s) => s.text)).toEqual([
      "The decimal $3.5 + 1.25 = 4.75$ adds by lining up the points.",
      "Then $$x = 2. \\text{board} = 1.$$ holds.",
      "I put it on the board.",
    ]);
    expect(keepExplanation(reply, GENERIC)).toBe(
      "The decimal $3.5 + 1.25 = 4.75$ adds by lining up the points. Then $$x = 2. \\text{board} = 1.$$ holds.\n\n" + GENERIC,
    );
  });

  it("paragraphs and lists keep their shape; a list's '1.' is no sentence end; a board line in the middle goes", () => {
    const reply = [
      "Here is how to find the area of a rectangle.",
      "",
      "1. Measure the length.",
      "2. Measure the width.",
      "- I wrote a rectangle on your board.",
      "3. Multiply them: $A = l \\times w$.",
      "",
      "Check the board to try one!",
    ].join("\n");
    expect(keepExplanation(reply, GENERIC)).toBe(
      ["Here is how to find the area of a rectangle.", "", "1. Measure the length.", "2. Measure the width.", "3. Multiply them: $A = l \\times w$.", "", GENERIC].join("\n"),
    );
  });

  it("a lone $ (a price) does not swallow the rest; nothing is claimed when nothing is about the board", () => {
    const reply = "A toy costs $5. Two toys cost $10, because you add the price twice. I put them in a table on your screen.";
    expect(keepExplanation(reply, GENERIC)).toBe("A toy costs $5. Two toys cost $10, because you add the price twice.\n\n" + GENERIC);
    const plain = "Plants make their food from sunlight, water and air. What else do you think they need?";
    expect(keepExplanation(plain, GENERIC)).toBe(`${plain}\n\n${GENERIC}`);
  });

  it("sentences joined back are the reply", () => {
    const reply = "First, **look.** Then (think!) \"Why?\" she asked.\n\n- one\n- two $a.b$ end";
    expect(
      replySentences(reply)
        .map((s) => s.text + s.gap)
        .join(""),
    ).toBe(reply);
  });
});

describe("explains: whether Ask keeps the charge when the board part failed", () => {
  it("true when a real explanation stays above the failure line, false when the line is all the student sees", () => {
    const reply = "To divide fractions, keep the first, change the sign to multiply, and flip the second. I put 5 problems on your board.";
    expect(explains(reply)).toBe(true);
    expect(keepExplanation(reply, GENERIC)).not.toBe(GENERIC);
    for (const short of ["Here you go — check your board!", "Sure thing! Two coming up.", "I wrote three problems for you. I put them on the board.", ""]) {
      expect(explains(short), short).toBe(false);
      expect(keepExplanation(short, GENERIC), short).toBe(GENERIC);
    }
  });
});
