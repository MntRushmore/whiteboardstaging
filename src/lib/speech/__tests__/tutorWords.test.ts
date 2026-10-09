import { describe, expect, it } from "vitest";
import { coachSpeech, hintSpeech, newTutorNote } from "../tutorWords";

const echo = (props: Record<string, unknown>, meta: Record<string, unknown> = { aiNote: true }) => ({
  typeName: "shape",
  type: "math",
  meta,
  props: { latex: "2x + 3 = 7", status: "warn", note: "", ...props },
});

describe("newTutorNote: the tutor's words on a ringed line, never the student's", () => {
  it("a model's new note on a ringed line", () => {
    expect(newTutorNote(echo({ note: "" }), echo({ note: "Check the sign when you move the 3." }))).toBe("Check the sign when you move the 3.");
    expect(newTutorNote(null, echo({ note: "Look at the 3 again." }))).toBe("Look at the 3 again.");
  });

  it("a changed note is said again; the same note is not", () => {
    expect(newTutorNote(echo({ note: "One" }), echo({ note: "Two" }))).toBe("Two");
    expect(newTutorNote(echo({ note: "Same" }), echo({ note: " Same " }))).toBeNull();
  });

  it("not the engine's own notes, not a line that is fine, not a cleared note", () => {
    expect(newTutorNote(null, echo({ note: "Balanced: x = 2" }, {}))).toBeNull();
    expect(newTutorNote(null, echo({ note: "Nice", status: "ok" }))).toBeNull();
    expect(newTutorNote(echo({ note: "Old" }), echo({ note: "" }))).toBeNull();
  });

  it("only math shapes: the student's ink, a binding or junk say nothing", () => {
    expect(newTutorNote(null, { typeName: "shape", type: "draw", meta: { aiNote: true }, props: { note: "x", status: "warn" } })).toBeNull();
    expect(newTutorNote(null, { typeName: "binding", type: "math" })).toBeNull();
    expect(newTutorNote(null, null)).toBeNull();
    expect(newTutorNote(null, "math")).toBeNull();
  });
});

describe("hintSpeech / coachSpeech", () => {
  it("the hint, then its question", () => {
    expect(hintSpeech({ message: "Try taking 3 from both sides.", question: "What is left on the left?" })).toBe("Try taking 3 from both sides. What is left on the left?");
    expect(hintSpeech({ message: "Only a hint.", question: "" })).toBe("Only a hint.");
    expect(hintSpeech({})).toBe("");
  });

  it("a coach mark's title, then the line under it", () => {
    expect(coachSpeech("Stuck? Tap Help me.", "Your tutor writes the next step.")).toBe("Stuck? Tap Help me. Your tutor writes the next step.");
    expect(coachSpeech("Only a title.", null)).toBe("Only a title.");
  });
});
