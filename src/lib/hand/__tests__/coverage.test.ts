import { describe, expect, it } from "vitest";

import { planHandwriting } from "@/lib/live/handwriting";
import { layoutMath, strokeBounds } from "@/lib/hand/mathLayout";
import { layoutSteps } from "@/lib/hand/writeSteps";
import { REASON_LATEX } from "@/lib/live/proof/vocab";

/**
 * Everything the solver can emit must be drawable by the tutor's hand: a block with
 * one `unsupported` construct falls back to a typeset card, and the board is meant to
 * carry neither cards nor words. This table is the contract with the engine — calculus,
 * advanced algebra, sets — and each row must lay out with NO `unsupported` and real ink,
 * alone (`layoutMath`), as part of a worked block (`layoutSteps`), and through the
 * live planner (`planHandwriting`).
 */

const COVERAGE: Record<string, readonly string[]> = {
  "letters and digits": [
    "0123456789",
    "abcdefghijklm",
    "nopqrstuvwxyz",
    "ABCDEFGHIJKLM",
    "NOPQRSTUVWXYZ",
    "3.14159",
    "-42",
    "x_{1}, x_{2}, x_{3}",
  ],
  greek: [
    "\\alpha \\beta \\gamma \\delta",
    "\\epsilon \\varepsilon \\eta \\theta \\vartheta",
    "\\lambda \\mu \\nu \\pi",
    "\\rho \\sigma \\tau \\phi \\varphi",
    "\\chi \\psi \\omega",
    "\\Gamma \\Delta \\Theta \\Lambda",
    "\\Pi \\Sigma \\Phi \\Omega",
    "2\\pi r",
    "\\theta = \\frac{\\pi}{3}",
    "\\Delta y = y_{2} - y_{1}",
  ],
  integrals: [
    "\\int x\\,dx",
    "\\int x^{2}\\,dx = \\frac{x^{3}}{3} + C",
    "\\int_0^2 x^2\\,dx",
    "\\int_{0}^{2} 3x^{2}\\,dx = 8",
    "\\int_{-1}^{1} x\\,dx = 0",
    "\\int_{a}^{b} f(x)\\,dx",
    "\\int_{0}^{\\pi} \\sin x\\,dx = 2",
    "\\int_{1}^{e} \\frac{1}{x}\\,dx = 1",
    "\\int \\frac{1}{x}\\,dx = \\ln|x| + C",
    "\\int e^{2x}\\,dx = \\frac{1}{2}e^{2x} + C",
    "\\int_{0}^{\\infty} e^{-x}\\,dx = 1",
    "\\int\\limits_{0}^{1} x\\,dx",
    "\\iint_{R} xy\\,dA",
    "\\iiint_{V} dV",
    "\\oint_{C} \\vec{F} \\cdot d\\vec{r}",
    "\\int \\left(3x^{2} - 2x + 1\\right) dx",
    "\\int \\sqrt{x}\\,dx = \\frac{2}{3}x^{\\frac{3}{2}} + C",
    "\\int \\mathrm{d}x",
  ],
  "evaluation brackets and bars": [
    "\\left[ x^3 \\right]_0^2",
    "\\left[ \\frac{x^{3}}{3} \\right]_{0}^{2} = \\frac{8}{3}",
    "= \\left[ x^{2} + x \\right]_{1}^{3} = 10",
    "\\Big[ x^2 \\Big]_{a}^{b}",
    "\\big[ \\ln x \\big]_{1}^{e} = 1",
    "\\bigg[ -\\cos x \\bigg]_{0}^{\\pi} = 2",
    "\\Bigg[ \\frac{x^{4}}{4} \\Bigg]_{0}^{1}",
    "x^2 \\bigg|_0^2",
    "\\frac{x^{3}}{3} \\bigg|_{0}^{2} = \\frac{8}{3}",
    "\\left. \\frac{x^{2}}{2} \\right|_{0}^{4} = 8",
    "\\Big|_{x=1}",
    "\\bigl( x + 1 \\bigr)^{2}",
  ],
  limits: [
    "\\lim_{x \\to 2} f(x)",
    "\\lim_{x \\to \\infty} \\frac{1}{x} = 0",
    "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1",
    "\\lim_{x \\to 2} \\frac{x^{2} - 4}{x - 2} = 4",
    "\\lim_{h \\to 0} \\frac{f(x + h) - f(x)}{h}",
    "\\lim_{x \\to -\\infty} e^{x} = 0",
    "\\lim_{x \\to 0^{+}} \\ln x = -\\infty",
    "\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^{n} = e",
    "x \\to 2",
    "x \\rightarrow \\infty",
    "\\max_{x \\in [0, 1]} f(x)",
    "\\min(a, b)",
  ],
  "derivatives and primes": [
    "\\frac{d}{dx}",
    "\\frac{d}{dx}\\left(x^{3}\\right) = 3x^{2}",
    "\\frac{dy}{dx} = 2x",
    "\\frac{d^2y}{dx^2}",
    "\\frac{d^{2}y}{dx^{2}} = 6x",
    "f'(x)",
    "f''(x)",
    "f'''(x) = 0",
    "y'",
    "y' = 3x^{2} - 2",
    "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}",
    "\\frac{d}{dx}\\left[\\sin x\\right] = \\cos x",
    "\\frac{d}{dx}(uv) = u'v + uv'",
    "(f \\circ g)'(x) = f'(g(x)) \\cdot g'(x)",
    "\\frac{\\partial f}{\\partial x}",
    "\\nabla f",
    "x^{\\prime}",
    "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
    "\\prod_{k=1}^{n} k = n!",
  ],
  "absolute value": [
    "|x|",
    "|x| = 3",
    "\\left| 2x-3 \\right|",
    "\\left| 2x - 3 \\right| = 5",
    "\\lvert x \\rvert",
    "\\lvert x - 1 \\rvert \\le 2",
    "|x - 1| < 4",
    "|x| + |y| = 1",
    "\\ln|x|",
    "\\left| \\frac{1}{x} \\right|",
    "\\vert x \\vert",
  ],
  "roots and powers": [
    "\\sqrt{x}",
    "\\sqrt[3]{x}",
    "\\sqrt[3]{27} = 3",
    "\\sqrt[n]{a}",
    "x^{\\frac{1}{2}}",
    "x^{-2}",
    "e^{2x}",
    "e^{-x^{2}}",
    "2^{x+1} = 16",
    "\\left(\\frac{1}{2}\\right)^2",
    "\\sqrt{b^{2} - 4ac}",
    "\\sqrt{\\frac{a}{b}}",
  ],
  "logs, exponentials and trig": [
    "\\ln x",
    "\\ln|x|",
    "\\ln(x) = 2",
    "\\log x",
    "\\log_2 8",
    "\\log_2 8 = 3",
    "\\log_{5} 7",
    "\\log_{3}(x + 1) = 2",
    "x = \\frac{\\ln 5}{2}",
    "e^{\\ln 3} = 3",
    "\\sin x",
    "\\cos(3x)",
    "\\tan^2 x",
    "\\sin^{-1}",
    "\\sin^{-1}\\left(\\frac{1}{2}\\right) = \\frac{\\pi}{6}",
    "\\sin^{2} x + \\cos^{2} x = 1",
    "-\\sin x",
    "\\sec x, \\csc x, \\cot x",
    "\\arctan x",
    "\\sinh x",
  ],
  "quadratics and surds": [
    "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}",
    "x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}",
    "\\frac{4 \\pm 2\\sqrt{3}}{2}",
    "x = 2 \\pm \\sqrt{3}",
    "x = \\frac{-3 \\pm \\sqrt{17}}{4}",
    "x = 1 \\mp \\sqrt{2}",
    "(x - 2)(x - 3) = 0",
    "x = 2 \\text{ or } x = 3",
    "x = 2, \\ x = 3",
    "x_{1} = 2, \\quad x_{2} = 3",
    "b^{2} - 4ac < 0",
    "x^{2} + 2x + 1 = (x + 1)^{2}",
  ],
  "relations and operators": [
    "\\pm",
    "\\mp",
    "a \\neq b",
    "a \\ne b",
    "a \\le b",
    "a \\leq b",
    "a \\ge b",
    "a \\geq b",
    "a < b",
    "a > b",
    "\\pi \\approx 3.14",
    "2 \\cdot 3",
    "2 \\times 3",
    "6 \\div 2",
    "15\\%",
    "a \\equiv b",
    "x \\sim y",
    "a \\not= b",
    "p \\Rightarrow q",
    "p \\implies q",
    "p \\iff q",
    "p \\Leftrightarrow q",
    "a \\leftarrow b",
    "x \\mapsto x^{2}",
    "\\neg p \\land q \\lor r",
    "AB \\parallel CD, \\ AB \\perp BC",
    "\\angle ABC = 90^\\circ",
  ],
  "degrees, units and chemistry": [
    "30^\\circ",
    "90^{\\circ}",
    "\\theta = 45^\\circ",
    "31.36\\,\\mathrm{N}",
    "5\\,\\mathrm{m/s}",
    "9.81\\,\\mathrm{m/s^{2}}",
    "20^\\circ\\mathrm{C}",
    "18.02\\,\\mathrm{g/mol}",
    "5\\,\\text{\\AA}",
    "10\\,\\Omega",
    "\\hbar",
    "\\mathrm{H_{2}O}",
    "\\mathrm{Fe^{3+}}",
    "4\\,\\mathrm{Fe} + 3\\,\\mathrm{O_{2}} \\rightarrow 2\\,\\mathrm{Fe_{2}O_{3}}",
    "\\mathrm{N_{2}} + 3\\,\\mathrm{H_{2}} \\rightleftharpoons 2\\,\\mathrm{NH_{3}}",
    "\\mathrm{CaCO_{3}} \\xrightarrow{\\Delta} \\mathrm{CaO} + \\mathrm{CO_{2}}",
    "\\checkmark",
  ],
  "sets and intervals": [
    "\\varnothing",
    "\\emptyset",
    "x \\in \\mathbb{R}",
    "\\mathbb{R}",
    "\\mathbb{Z}, \\mathbb{N}, \\mathbb{Q}, \\mathbb{C}",
    "x \\notin \\mathbb{Z}",
    "x \\not\\in A",
    "\\{1, 2\\}",
    "\\{x \\mid x > 0\\}",
    "(2, 3)",
    "[1, 4)",
    "(2, 3]",
    "(-\\infty, 2) \\cup (3, \\infty)",
    "A \\cap B",
    "A \\subset B",
    "A \\subseteq B",
    "A \\setminus B",
    "\\forall x \\in \\mathbb{R}",
    "\\exists x",
    "\\therefore x = 4",
    "\\infty",
    "-\\infty",
    "\\langle 1, 2 \\rangle",
    "\\lfloor x \\rfloor + \\lceil x \\rceil",
  ],
  "spacing and plus C": [
    "+ C",
    "F(x) + C",
    "a \\quad b",
    "a \\qquad b",
    "a \\ b",
    "a\\,b",
    "a\\;b",
    "a\\:b",
    "a\\!b",
    "a ~ b",
    "x = 1, \\ y = 2",
    "1, 2, \\ldots, n",
    "1 + 2 + \\cdots + n",
  ],
  fractions: [
    "\\frac{1}{2}",
    "\\dfrac{1}{2}",
    "\\tfrac{1}{2}",
    "\\cfrac{1}{2}",
    "\\frac{\\frac{1}{x}}{2}",
    "\\frac{1 + \\frac{1}{x}}{1 - \\frac{1}{x}}",
    "\\binom{n}{k}",
    "-\\frac{7}{3}",
  ],
  "accents and fonts": [
    "\\overline{x}",
    "\\bar{x}",
    "\\vec{v}",
    "\\vec{v} = (1, 2)",
    "\\hat{x}",
    "\\dot{x}",
    "\\ddot{x}",
    "\\tilde{x}",
    "\\underline{x}",
    "\\overline{AB}",
    "\\operatorname{d}",
    "\\mathrm{d}x",
    "\\mathrm{e}",
    "\\mathbf{v}",
    "\\boldsymbol{x}",
    "\\mathcal{L}",
    "\\boxed{x = 4}",
    "\\displaystyle \\frac{1}{2}",
    "\\textcolor{blue}{x}",
  ],
  "grids and systems": [
    "\\begin{cases} x = 1 \\\\ y = 2 \\end{cases}",
    "\\begin{cases} x + y + z = 6 \\\\ x - y + z = 2 \\\\ 2x + y - z = 1 \\end{cases}",
    "f(x) = \\begin{cases} x^{2} & x \\ge 0 \\\\ -x & x < 0 \\end{cases}",
    "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}",
    "\\begin{bmatrix} 1 & 0 & 0 \\\\ 0 & 1 & 0 \\\\ 0 & 0 & 1 \\end{bmatrix}",
    "\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix} = ad - bc",
    "\\begin{matrix} 1 & 2 \\end{matrix}",
    "\\begin{array}{cc} 1 & 2 \\\\ 3 & 4 \\end{array}",
    "\\begin{aligned} x + y &= 5 \\\\ x &= 3 \\end{aligned}",
    "\\left\\{ \\begin{array}{l} x = 1 \\\\ y = 2 \\end{array} \\right.",
  ],
  // two-column proofs (`src/lib/live/proof`): every statement form the planner writes, and every
  // reason in the fixed vocabulary — the only words the tutor writes, in the reason column
  "geometry proofs": [
    "\\overline{AB} \\cong \\overline{CD}",
    "\\angle ABD \\cong \\angle CDB",
    "\\angle 1 \\cong \\angle 2",
    "\\triangle ABD \\cong \\triangle CDB",
    "\\overline{AB} \\parallel \\overline{DC}",
    "\\overline{BD} \\perp \\overline{AC}",
    "m\\angle ADB = 90^{\\circ}",
    "m\\angle 1 + m\\angle 2 = 180^{\\circ}",
    "\\triangle ABC \\sim \\triangle DEF",
    ...Object.values(REASON_LATEX),
  ],
  words: [
    "\\text{or}",
    "x = 2 \\text{ and } y = 3",
    "\\text{no solution}",
    "\\text{undefined}",
    "x \\in \\mathbb{R}, \\text{ all real numbers}",
  ],
};

const ALL = Object.values(COVERAGE).flat();

describe("hand coverage: every construct the solver emits is drawable", () => {
  it("covers a large table", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(150);
  });

  for (const [group, lines] of Object.entries(COVERAGE)) {
    it(`draws ${group}`, () => {
      for (const latex of lines) {
        const layout = layoutMath(latex, { seed: 3, size: 28 });
        expect(layout.unsupported, latex).toEqual([]);
        expect(layout.strokes.length, latex).toBeGreaterThan(0);
        const b = strokeBounds(layout.strokes)!;
        expect(b.maxX, latex).toBeCloseTo(layout.width, 6);
        expect(b.maxY, latex).toBeCloseTo(layout.height, 6);
        // (a line whose ink sits wholly above the writing line, `\pm` or `\infty` alone,
        // legitimately has its baseline below the ink box)
        expect(layout.baseline, latex).toBeGreaterThan(0);
        expect(Number.isFinite(layout.baseline), latex).toBe(true);
        for (const stroke of layout.strokes) {
          expect(stroke.points.length, latex).toBeGreaterThanOrEqual(2);
          for (const p of stroke.points) expect(Number.isFinite(p.x) && Number.isFinite(p.y), latex).toBe(true);
        }
      }
    });

    it(`writes ${group} as one worked block and plans it for the canvas`, () => {
      const block = layoutSteps(lines, { seed: 7, size: 26 });
      expect(block.unsupported, group).toEqual([]);
      for (const line of block.lines) expect(line.strokes.length, line.latex).toBeGreaterThan(0);
      for (let i = 1; i < block.lines.length; i++) {
        const above = strokeBounds(block.lines[i - 1].strokes)!;
        const below = strokeBounds(block.lines[i].strokes)!;
        expect(above.maxY, `${block.lines[i - 1].latex} runs into ${block.lines[i].latex}`).toBeLessThan(below.minY);
      }

      const { plan, unsupported } = planHandwriting(lines, { size: 26, seed: 7 });
      expect(unsupported, group).toEqual([]);
      expect(plan, group).not.toBeNull();
      expect(plan!.lines).toHaveLength(lines.length);
      expect(plan!.totalMs).toBeGreaterThan(0);
    });
  }
});

/**
 * What the hand still refuses, on purpose. Each of these must report `unsupported` so
 * the caller never draws a half-understood line.
 */
const STILL_UNSUPPORTED: readonly [string, string][] = [
  ["\\zeta(2)", "\\zeta"],
  ["\\xi + 1", "\\xi"],
  ["\\kappa", "\\kappa"],
  ["\\underbrace{x + x}_{2x}", "\\underbrace"],
  ["\\overset{?}{=}", "\\overset"],
  ["\\cancel{x}", "\\cancel"],
  ["\\begin{tikzcd} A & B \\end{tikzcd}", "\\begin{tikzcd}"],
  // prose: the board carries maths, not sentences
  ["\\text{the discriminant is negative so there are no real roots}", "\\text"],
  ["\\mathrm{this is a whole sentence of words}", "\\mathrm"],
];

describe("hand coverage: what stays unsupported", () => {
  it.each(STILL_UNSUPPORTED)("%s reports %s", (latex, what) => {
    expect(layoutMath(latex, { seed: 3 }).unsupported).toContain(what);
    expect(planHandwriting([latex], { size: 26, seed: 3 }).plan).toBeNull();
  });
});
