import { describe, expect, it } from "vitest";
import type { Annotation, CheckRequest } from "@/lib/live/contracts";
import { classifyKind, filterAnnotation, normalizeStep, textCoverage } from "@/lib/server/live-rules";

describe("classifyKind", () => {
  it("returns unknown for empty latex", () => {
    expect(classifyKind("")).toBe("unknown");
    expect(classifyKind("   ")).toBe("unknown");
  });

  it("detects chemistry when an arrow and element tokens are present", () => {
    expect(classifyKind("Fe + O_2 \\rightarrow Fe_2O_3")).toBe("chem");
    expect(classifyKind("2H_{2} + O_{2} \\to 2H_{2}O")).toBe("chem");
    expect(classifyKind("C_3H_8+O_2 -> CO_2+H_2O")).toBe("chem");
  });

  it("does not call an implication arrow with lowercase algebra chemistry", () => {
    expect(classifyKind("x = 2 \\rightarrow y = 4")).toBe("math");
  });

  it("returns text when \\text{} dominates or nothing math-like appears", () => {
    expect(classifyKind("\\text{Solve for x}")).toBe("text");
    expect(classifyKind("hello there")).toBe("text");
    expect(classifyKind("x^2 + 3x = 10", false)).toBe("text");
  });

  it("returns math otherwise", () => {
    expect(classifyKind("2x+3=11")).toBe("math");
    expect(classifyKind("\\frac{1}{2}")).toBe("math");
    expect(classifyKind("x")).toBe("text"); // bare identifier, no digit/operator
  });

  it("measures text coverage", () => {
    expect(textCoverage("\\text{ab}")).toBe(1);
    expect(textCoverage("x=1")).toBe(0);
  });
});

const lines: CheckRequest["lines"] = [
  { id: "l1", latex: "2x+3=11", bbox: [0, 0, 1, 0.3], local: { kind: "equation", verdict: "none" } },
  { id: "l2", latex: "2x=8", bbox: [0, 0.3, 1, 0.6], local: { kind: "equation", verdict: "ok" } },
  { id: "l3", latex: "x=5", bbox: [0, 0.6, 1, 1], local: { kind: "equation", verdict: "mismatch" } },
];
const warn: Annotation = {
  lineId: "l3",
  verdict: "warn",
  kind: "arithmetic",
  message: "Look again at the right side of line 3",
  question: "What is 8 divided by 2?",
  latex: "x = 8/2",
  expected: "8/2",
  confidence: 0.9,
};

describe("filterAnnotation", () => {
  it("drops annotations pointing at unknown lines", () => {
    expect(filterAnnotation({ ...warn, lineId: "nope" }, { lines, mode: "suggest" })).toBeNull();
  });

  it("keeps null lineIds", () => {
    expect(filterAnnotation({ ...warn, lineId: null }, { lines, mode: "suggest" })).not.toBeNull();
  });

  it("strips question and latex in feedback mode", () => {
    const out = filterAnnotation(warn, { lines, mode: "feedback" });
    expect(out).not.toBeNull();
    expect(out).not.toHaveProperty("question");
    expect(out).not.toHaveProperty("latex");
    expect(out?.expected).toBe("8/2");
    expect(out?.message).toBe(warn.message);
  });

  it("keeps question and latex in suggest mode", () => {
    expect(filterAnnotation(warn, { lines, mode: "suggest" })).toEqual(warn);
  });

  it("drops praise unless the last line is locally ok", () => {
    const praise: Annotation = { lineId: null, verdict: "ok", kind: "praise", message: "Nice chain of steps", confidence: 0.8 };
    expect(filterAnnotation(praise, { lines, mode: "suggest" })).toBeNull();
    const okLines = lines.map((l) => ({ ...l, local: { ...l.local, verdict: "ok" as const } }));
    expect(filterAnnotation(praise, { lines: okLines, mode: "suggest" })).toEqual(praise);
  });

  it("never contradicts a local ok with a warn", () => {
    expect(filterAnnotation({ ...warn, lineId: "l2" }, { lines, mode: "suggest" })).toBeNull();
    expect(filterAnnotation({ ...warn, lineId: "l2", verdict: "info" }, { lines, mode: "suggest" })).not.toBeNull();
  });
});

describe("normalizeStep", () => {
  it("re-indexes and boxes the final step", () => {
    expect(normalizeStep({ index: 7, latex: "x = 4", explanation: "Divide both sides by 2", final: true }, 3)).toEqual({
      index: 3,
      latex: "\\boxed{x = 4}",
      explanation: "Divide both sides by 2",
      final: true,
    });
  });

  it("leaves non-final and already boxed steps alone", () => {
    expect(normalizeStep({ index: 1, latex: "2x = 8", explanation: "", final: false }, 1).latex).toBe("2x = 8");
    expect(normalizeStep({ index: 1, latex: "\\boxed{x=4}", explanation: "", final: true }, 1).latex).toBe("\\boxed{x=4}");
  });
});
