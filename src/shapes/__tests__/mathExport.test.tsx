import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Editor, TLShapeId } from "tldraw";
import { MATH_SHAPE_DEFAULTS, type MathShape } from "@/lib/live/contracts";
import { updateLiveSettings } from "@/lib/live/liveSettings";
import { MathShapeUtil, mathHtml, mathText, readbackHidden } from "../math/MathShapeUtil";

/**
 * An export of the board — the screenshot a bug report sends — is what the student sees. A parent's
 * report (2026-10-06) showed `\smile`, raw LaTeX in grey monospace, printed under her daughter's `=`:
 * the readback of a misread line, which the board itself only shows on hover, exported as source.
 */

const math = (props: Partial<MathShape["props"]>): MathShape =>
  ({
    id: "shape:m" as TLShapeId,
    typeName: "shape",
    type: "math",
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1",
    parentId: "page:page",
    isLocked: false,
    opacity: 1,
    meta: {},
    props: { ...MATH_SHAPE_DEFAULTS, anchorIds: [], ...props },
  }) as MathShape;

const util = new MathShapeUtil({} as Editor);
const exported = (shape: MathShape): string | null => {
  const el = util.toSvg(shape);
  return el ? renderToStaticMarkup(<svg>{el}</svg>) : null;
};

describe("MathShapeUtil.toSvg: an export shows what the student sees", () => {
  afterEach(() => updateLiveSettings({ handwriting: true }));

  it("a readback the board shows only on hover is left out of the export, as it is off the board", () => {
    expect(exported(math({ source: "echo", latex: "\\smile", tone: "muted" }))).toBeNull();
    expect(exported(math({ source: "echo", latex: "=9", status: "solved" }))).toBeNull();
    expect(readbackHidden({ source: "echo", latex: "=9", resultLatex: "" }, true)).toBe(true);
  });

  it("one that always shows — an answer asked for with `=`, or with the tutor's hand off — is exported as text, never as LaTeX", () => {
    const asked = exported(math({ source: "echo", latex: "\\frac{1}{2} + \\frac{1}{4} =", resultLatex: "\\frac{3}{4}" }));
    expect(asked).toContain("½ + ¼ = ¾");
    expect(asked).not.toMatch(/\\[a-zA-Z]/);
    updateLiveSettings({ handwriting: false });
    const read = exported(math({ source: "echo", latex: "\\smile 9 \\times 2" }));
    expect(read).toContain("⌣ 9 × 2");
    expect(read).not.toMatch(/\\[a-zA-Z]/);
    expect(exported(math({ source: "echo", latex: "", status: "unknown" }))).toContain("Couldn&#x27;t read this");
  });

  it("the tutor's own typeset maths is exported as text too", () => {
    const tutor = exported(math({ source: "ai", latex: "x = \\sqrt{16}" }));
    expect(tutor).toContain("x = √16");
    expect(tutor).not.toMatch(/\\[a-zA-Z]/);
  });
});

describe("mathHtml / mathText: never a LaTeX command on the board", () => {
  it("typesets what KaTeX can", () => {
    expect(mathHtml("\\frac{1}{2}")).toContain("katex");
    expect(mathHtml("\\smile")).toContain("katex");
  });

  it("writes what it cannot as text, not as its source in red", () => {
    for (const latex of ["\\notacommand{2} + 1", "\\frac{1}{"]) {
      const html = mathHtml(latex);
      expect(html, latex).not.toMatch(/katex-error|#cc0000/);
      expect(html, latex).not.toMatch(/\\[a-zA-Z]/);
      expect(mathText(latex), latex).not.toMatch(/\\/);
    }
  });
});
