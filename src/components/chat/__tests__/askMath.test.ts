import { describe, expect, it } from "vitest";
import { askMathSource, renderAskMath } from "../askMath";

describe("the panel's maths (KaTeX)", () => {
  it("an inline fraction is as big as a display one (a young reader's ½), a \\tfrac or plain maths left as written", () => {
    expect(askMathSource("\\frac{1}{2}", false)).toBe("\\displaystyle \\frac{1}{2}");
    expect(askMathSource("x = \\dfrac{3}{4}", false)).toBe("\\displaystyle x = \\dfrac{3}{4}");
    expect(askMathSource("\\tfrac{1}{2}", false)).toBe("\\tfrac{1}{2}");
    expect(askMathSource("2x + 5 = 17", false)).toBe("2x + 5 = 17");
    expect(askMathSource("\\frac{1}{2}", true)).toBe("\\frac{1}{2}");
  });

  it("typesets with MathML for screen readers; a formula it cannot read is null (shown as words), never red source", () => {
    const html = renderAskMath("\\frac{1}{2} + \\frac{1}{4}", false)!;
    expect(html).toContain('class="katex"');
    expect(html).toContain("<math");
    expect(renderAskMath("\\frac{1}{", false)).toBeNull();
    // no links or HTML through it
    expect(renderAskMath("\\href{https://example.com}{x}", false) ?? "").not.toContain("<a ");
  });
});
