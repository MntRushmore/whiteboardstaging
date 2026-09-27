/**
 * High-school GEOMETRY on the maths scoreboard (Common Core G-CO, G-SRT, G-C, G-GPE, G-GMD,
 * G-MG): what a geometry student writes beside a figure — angle equations, the Pythagorean
 * theorem, trig ratios, formulas with their values, coordinates, proportions — one LaTeX string
 * per line, as Mathpix returns it, and what a teacher accepts as the answer to Solve on the last
 * line. Wired into `CORPUS` (`../corpus.ts`); read the conventions there.
 *
 * Geometry's own conventions on top of them:
 *  - an angle written with a degree sign is an angle, so its value is in RADIANS here (the oracle
 *    reads `70^{\circ}` as 7π/18): `deg(70)`. An angle equation with no degree sign
 *    (`m\angle A + 48 + 67 = 180`) is in plain numbers;
 *  - a length has only its positive root: `interval: LENGTH` (so `5^{2} + 12^{2} = c^{2}` is
 *    c = 13, never -13); an angle of a triangle is in (0°, 90°) for a sine or tangent (`ACUTE`)
 *    and in (0°, 180°) for a cosine (`TRIANGLE`);
 *  - a named angle or segment is its own unknown: `\angle C` is `angle_C`, `AB` is `AB`
 *    (`src/lib/live/engine/geometryNotation.ts`);
 *  - a point answer (a midpoint, an image, a circle's centre) is `point`.
 *
 * (The algebra engineer is adding a `course` field to `EvalProblem`; once it lands, these are
 * `course: "geometry"`.)
 */
import type { EvalProblem } from "../corpus";

export const GEOMETRY_TOPICS = ["geometry-angles", "geometry-right-triangles", "geometry-measure", "geometry-circles", "geometry-coordinates", "geometry-similarity"] as const;

/** An angle in degrees, as the radians the oracle reads `d^{\circ}` as. */
const deg = (d: number): number => (d * Math.PI) / 180;
/** A length: its positive root only. */
const LENGTH = { lo: 0, hi: Infinity };
/** An acute angle of a right triangle (sin⁻¹, tan⁻¹). */
const ACUTE = { lo: 0, hi: Math.PI / 2 };
/** Any angle of a triangle (cos⁻¹). */
const TRIANGLE = { lo: 0, hi: Math.PI };
const D2R = Math.PI / 180;

export const GEOMETRY: EvalProblem[] = [
  // ---------------------------------------------------------------- angles (G-CO.9, G-CO.10)
  { id: "ga-01", topic: "geometry-angles", lines: ["x + 40 = 90"], expect: { values: { x: [50] } }, note: "complementary" },
  { id: "ga-02", topic: "geometry-angles", lines: ["x + 125 = 180"], expect: { values: { x: [55] } }, note: "supplementary" },
  { id: "ga-03", topic: "geometry-angles", lines: ["3x + 10 = 5x - 20"], expect: { values: { x: [15] } }, note: "vertical angles are equal" },
  { id: "ga-04", topic: "geometry-angles", lines: ["(2x + 10) + (3x - 5) = 180"], expect: { values: { x: [35] } }, note: "a linear pair" },
  { id: "ga-05", topic: "geometry-angles", lines: ["(2x + 10)^{\\circ} + (3x - 5)^{\\circ} = 180^{\\circ}"], expect: { values: { x: [35] } }, note: "the degree signs go; x is a number" },
  { id: "ga-06", topic: "geometry-angles", lines: ["x + 35^{\\circ} + 75^{\\circ} = 180^{\\circ}"], expect: { values: { x: [deg(70)] }, answer: "x = 70^{\\circ}" }, note: "triangle angle sum: x is an angle" },
  { id: "ga-07", topic: "geometry-angles", lines: ["\\angle A + 50^{\\circ} + 60^{\\circ} = 180^{\\circ}"], expect: { values: { angle_A: [deg(70)] }, answer: "\\angle A = 70^{\\circ}" }, note: "a named angle" },
  { id: "ga-08", topic: "geometry-angles", lines: ["\\angle A = 50^{\\circ}", "\\angle B = 60^{\\circ}", "\\angle A + \\angle B + \\angle C = 180^{\\circ}", "\\angle C = ?"], expect: { values: { angle_C: [deg(70)] } }, note: "the known angles substituted" },
  { id: "ga-09", topic: "geometry-angles", lines: ["m\\angle A + 48 + 67 = 180"], expect: { values: { angle_A: [65] } }, note: "m∠ in plain numbers" },
  { id: "ga-10", topic: "geometry-angles", lines: ["x = 45^{\\circ} + 70^{\\circ}"], expect: { values: { x: [deg(115)] } }, note: "exterior angle = the two remote interior angles" },
  { id: "ga-11", topic: "geometry-angles", lines: ["2x + 10 = x + 25 + 50"], expect: { values: { x: [65] } }, note: "exterior angle with an unknown" },
  { id: "ga-12", topic: "geometry-angles", lines: ["(8 - 2) \\cdot 180^{\\circ} ="], expect: { answer: "1080^{\\circ}" }, note: "interior angle sum of an octagon" },
  { id: "ga-13", topic: "geometry-angles", lines: ["S = (n - 2) \\cdot 180^{\\circ}", "n = 12", "S = ?"], expect: { values: { S: [deg(1800)] } }, note: "the formula with n in" },
  { id: "ga-14", topic: "geometry-angles", lines: ["\\frac{(8 - 2) \\cdot 180^{\\circ}}{8} ="], expect: { answer: "135^{\\circ}" }, note: "each angle of a regular octagon" },
  { id: "ga-15", topic: "geometry-angles", lines: ["\\frac{360^{\\circ}}{12} ="], expect: { answer: "30^{\\circ}" }, note: "each exterior angle of a regular 12-gon" },
  { id: "ga-16", topic: "geometry-angles", lines: ["(n - 2) \\cdot 180 = 1440"], expect: { values: { n: [10] } }, note: "the number of sides from the angle sum" },
  { id: "ga-17", topic: "geometry-angles", lines: ["\\frac{360}{n} = 24"], expect: { values: { n: [15] } }, note: "the number of sides from an exterior angle" },
  { id: "ga-18", topic: "geometry-angles", lines: ["\\frac{(n - 2) \\cdot 180}{n} = 150"], expect: { values: { n: [12] } }, note: "the number of sides from an interior angle" },
  { id: "ga-19", topic: "geometry-angles", lines: ["4x - 15 = 2x + 25"], expect: { values: { x: [20] } }, note: "alternate interior angles are equal" },
  { id: "ga-20", topic: "geometry-angles", lines: ["(3x + 20)^{\\circ} + (2x + 10)^{\\circ} = 180^{\\circ}"], expect: { values: { x: [30] } }, note: "same-side interior angles are supplementary" },
  { id: "ga-21", topic: "geometry-angles", lines: ["m\\angle 1 = 3x + 10", "m\\angle 2 = 5x - 30", "m\\angle 1 = m\\angle 2"], expect: { values: { x: [20] } }, note: "two angles defined in x, then equal" },
  {
    id: "ga-22",
    topic: "geometry-angles",
    lines: ["m\\angle ABD = 2x + 5", "m\\angle DBC = 3x - 10", "m\\angle ABC = 70", "m\\angle ABD + m\\angle DBC = m\\angle ABC", "m\\angle ABD = ?"],
    expect: { values: { x: [15], angle_ABD: [35] } },
    note: "angle addition, then the part asked for",
  },
  { id: "ga-23", topic: "geometry-angles", lines: ["2x + 30^{\\circ} = x + 70^{\\circ}"], expect: { values: { x: [deg(40)] } }, note: "an angle on both sides" },
  { id: "ga-24", topic: "geometry-angles", lines: ["x + 42^{\\circ} = 90^{\\circ}"], expect: { values: { x: [deg(48)] } }, note: "complementary, in degrees" },
  { id: "ga-25", topic: "geometry-angles", lines: ["x + x + 40^{\\circ} = 180^{\\circ}"], expect: { values: { x: [deg(70)] } }, note: "the base angles of an isosceles triangle" },
  { id: "ga-26", topic: "geometry-angles", lines: ["\\angle 1 + \\angle 2 = 180^{\\circ}", "\\angle 1 = 115^{\\circ}", "\\angle 2 = ?"], expect: { values: { angle_2: [deg(65)] } }, note: "a linear pair, the other angle" },

  // ---------------------------------------------------------------- right triangles and trig (G-SRT.6–8, G-SRT.10–11)
  { id: "gr-01", topic: "geometry-right-triangles", lines: ["5^{2} + 12^{2} = c^{2}"], expect: { values: { c: [13] }, interval: LENGTH }, note: "a length is positive" },
  { id: "gr-02", topic: "geometry-right-triangles", lines: ["a = 3", "b = 4", "a^{2} + b^{2} = c^{2}", "c = ?"], expect: { values: { c: [5] }, interval: LENGTH }, note: "the legs substituted" },
  { id: "gr-03", topic: "geometry-right-triangles", lines: ["6^{2} + b^{2} = 10^{2}"], expect: { values: { b: [8] }, interval: LENGTH }, note: "a missing leg" },
  { id: "gr-04", topic: "geometry-right-triangles", lines: ["4^{2} + 7^{2} = c^{2}"], expect: { values: { c: [Math.sqrt(65)] }, answer: "c = \\sqrt{65}", interval: LENGTH }, note: "exact: √65" },
  { id: "gr-05", topic: "geometry-right-triangles", lines: ["6^{2} + 6^{2} = c^{2}"], expect: { values: { c: [6 * Math.SQRT2] }, answer: "c = 6\\sqrt{2}", interval: LENGTH }, note: "√72 simplified" },
  { id: "gr-06", topic: "geometry-right-triangles", lines: ["x^{2} + 8^{2} = 17^{2}"], expect: { values: { x: [15] }, interval: LENGTH } },
  { id: "gr-07", topic: "geometry-right-triangles", lines: ["5^{2} + 12^{2} = 13^{2}"], expect: { answer: "169 = 169" }, note: "the converse: a right triangle" },
  { id: "gr-08", topic: "geometry-right-triangles", lines: ["6^{2} + 7^{2} = 9^{2}"], expect: { answer: "85 \\neq 81" }, note: "not a right triangle" },
  { id: "gr-09", topic: "geometry-right-triangles", lines: ["8^{2} + 15^{2} \\stackrel{?}{=} 17^{2}"], expect: { answer: "289 = 289" }, note: "the check written with =?" },
  { id: "gr-10", topic: "geometry-right-triangles", lines: ["x\\sqrt{2} = 10"], expect: { values: { x: [5 * Math.SQRT2] }, answer: "x = 5\\sqrt{2}" }, note: "45-45-90: the root out of the denominator" },
  { id: "gr-11", topic: "geometry-right-triangles", lines: ["\\sin 45^{\\circ} = \\frac{x}{10}"], expect: { values: { x: [5 * Math.SQRT2] }, answer: "x = 5\\sqrt{2}" }, note: "45-45-90 through the sine" },
  { id: "gr-12", topic: "geometry-right-triangles", lines: ["x\\sqrt{3} = 9"], expect: { values: { x: [3 * Math.sqrt(3)] }, answer: "x = 3\\sqrt{3}" }, note: "30-60-90" },
  { id: "gr-13", topic: "geometry-right-triangles", lines: ["\\tan 60^{\\circ} = \\frac{x}{4}"], expect: { values: { x: [4 * Math.sqrt(3)] }, answer: "x = 4\\sqrt{3}" }, note: "30-60-90 through the tangent" },
  { id: "gr-14", topic: "geometry-right-triangles", lines: ["\\sin 30^{\\circ} = \\frac{x}{10}"], expect: { values: { x: [5] } }, note: "a side from a special angle" },
  { id: "gr-15", topic: "geometry-right-triangles", lines: ["\\tan 40^{\\circ} = \\frac{x}{12}"], expect: { values: { x: [12 * Math.tan(40 * D2R)] }, answer: "x \\approx 10.07", approxOk: true }, note: "not a special angle: exact, then ≈" },
  { id: "gr-16", topic: "geometry-right-triangles", lines: ["\\cos 60^{\\circ} = \\frac{8}{x}"], expect: { values: { x: [16] } }, note: "the unknown in the denominator" },
  { id: "gr-17", topic: "geometry-right-triangles", lines: ["\\cos 35^{\\circ} = \\frac{15}{x}"], expect: { values: { x: [15 / Math.cos(35 * D2R)] }, approxOk: true }, note: "the hypotenuse from the cosine" },
  { id: "gr-18", topic: "geometry-right-triangles", lines: ["\\tan \\theta = \\frac{3}{4}"], expect: { values: { theta: [Math.atan(3 / 4)] }, answer: "\\theta \\approx 36.87^{\\circ}", approxOk: true, interval: ACUTE }, note: "an angle from its ratio" },
  { id: "gr-19", topic: "geometry-right-triangles", lines: ["\\sin A = \\frac{5}{13}"], expect: { values: { A: [Math.asin(5 / 13)] }, approxOk: true, interval: ACUTE }, note: "a triangle's angle: the principal value" },
  { id: "gr-20", topic: "geometry-right-triangles", lines: ["\\cos B = \\frac{1}{2}"], expect: { values: { B: [deg(60)] }, answer: "B = 60^{\\circ}", interval: TRIANGLE }, note: "a special value: exact" },
  { id: "gr-21", topic: "geometry-right-triangles", lines: ["\\frac{a}{\\sin 30^{\\circ}} = \\frac{10}{\\sin 45^{\\circ}}"], expect: { values: { a: [5 * Math.SQRT2] }, answer: "a = 5\\sqrt{2}" }, note: "law of sines: a side, exact" },
  { id: "gr-22", topic: "geometry-right-triangles", lines: ["\\frac{x}{\\sin 40^{\\circ}} = \\frac{12}{\\sin 75^{\\circ}}"], expect: { values: { x: [(12 * Math.sin(40 * D2R)) / Math.sin(75 * D2R)] }, approxOk: true }, note: "law of sines: a side, ≈" },
  { id: "gr-23", topic: "geometry-right-triangles", lines: ["\\frac{\\sin A}{8} = \\frac{\\sin 30^{\\circ}}{5}"], expect: { values: { A: [Math.asin(0.8)] }, approxOk: true, interval: ACUTE }, note: "law of sines: an angle" },
  { id: "gr-24", topic: "geometry-right-triangles", lines: ["c^{2} = 5^{2} + 7^{2} - 2(5)(7)\\cos 60^{\\circ}"], expect: { values: { c: [Math.sqrt(39)] }, answer: "c = \\sqrt{39}", interval: LENGTH }, note: "law of cosines: a side, exact" },
  { id: "gr-25", topic: "geometry-right-triangles", lines: ["c^{2} = 8^{2} + 11^{2} - 2(8)(11)\\cos 37^{\\circ}"], expect: { values: { c: [Math.sqrt(185 - 176 * Math.cos(37 * D2R))] }, approxOk: true, interval: LENGTH }, note: "law of cosines: a side, ≈" },
  { id: "gr-26", topic: "geometry-right-triangles", lines: ["7^{2} = 5^{2} + 8^{2} - 2(5)(8)\\cos C"], expect: { values: { C: [deg(60)] }, answer: "C = 60^{\\circ}", interval: TRIANGLE }, note: "law of cosines: an angle" },
  { id: "gr-27", topic: "geometry-right-triangles", lines: ["c^{2} = a^{2} + b^{2} - 2ab\\cos C", "a = 5", "b = 7", "C = 60^{\\circ}", "c = ?"], expect: { values: { c: [Math.sqrt(39)] }, interval: LENGTH }, note: "law of cosines with its values in" },
  { id: "gr-28", topic: "geometry-right-triangles", lines: ["A = \\sqrt{9(9 - 5)(9 - 6)(9 - 7)}"], expect: { values: { A: [6 * Math.sqrt(6)] }, answer: "A = 6\\sqrt{6}" }, note: "Heron's formula" },
  { id: "gr-29", topic: "geometry-right-triangles", lines: ["x^{2} + x^{2} = 10^{2}"], expect: { values: { x: [5 * Math.SQRT2] }, interval: LENGTH }, note: "an isosceles right triangle" },
  { id: "gr-30", topic: "geometry-right-triangles", lines: ["AB^{2} + BC^{2} = AC^{2}", "AB = 9", "BC = 12", "AC = ?"], expect: { values: { AC: [15] }, interval: LENGTH }, note: "named sides" },
  { id: "gr-31", topic: "geometry-right-triangles", lines: ["\\sin A = \\frac{BC}{AB}", "AB = 20", "A = 30^{\\circ}", "BC = ?"], expect: { values: { BC: [10] } }, note: "a ratio of named sides" },
  { id: "gr-32", topic: "geometry-right-triangles", lines: ["\\cos 72^{\\circ} = \\frac{x}{25}"], expect: { values: { x: [25 * Math.cos(72 * D2R)] }, approxOk: true }, note: "the angle of elevation / depression kind" },

  // ---------------------------------------------------------------- area, perimeter, volume (G-GMD.1–3, G-MG)
  { id: "gm-01", topic: "geometry-measure", lines: ["A = \\pi (5)^{2}"], expect: { values: { A: [25 * Math.PI] }, answer: "A = 25\\pi" }, note: "exact: 25π" },
  { id: "gm-02", topic: "geometry-measure", lines: ["r = 5", "A = \\pi r^{2}", "A = ?"], expect: { values: { A: [25 * Math.PI] } }, note: "the radius substituted" },
  { id: "gm-03", topic: "geometry-measure", lines: ["r = 7", "C = 2\\pi r", "C = ?"], expect: { values: { C: [14 * Math.PI] } }, note: "circumference" },
  { id: "gm-04", topic: "geometry-measure", lines: ["V = \\frac{4}{3}\\pi r^{3}", "r = 3", "V = ?"], expect: { values: { V: [36 * Math.PI] } }, note: "sphere" },
  { id: "gm-05", topic: "geometry-measure", lines: ["V = \\frac{1}{3}\\pi r^{2} h", "r = 3", "h = 4", "V = ?"], expect: { values: { V: [12 * Math.PI] } }, note: "cone" },
  { id: "gm-06", topic: "geometry-measure", lines: ["V = \\pi r^{2} h", "r = 2", "h = 5", "V = ?"], expect: { values: { V: [20 * Math.PI] } }, note: "cylinder" },
  { id: "gm-07", topic: "geometry-measure", lines: ["SA = 2\\pi r^{2} + 2\\pi r h", "r = 3", "h = 5", "SA = ?"], expect: { values: { SA: [48 * Math.PI] } }, note: "cylinder's surface area: like terms in π" },
  { id: "gm-08", topic: "geometry-measure", lines: ["SA = 4\\pi (6)^{2}"], expect: { values: { SA: [144 * Math.PI] } }, note: "sphere's surface area" },
  { id: "gm-09", topic: "geometry-measure", lines: ["A = \\frac{1}{2} b h", "b = 10", "h = 7", "A = ?"], expect: { values: { A: [35] } }, note: "triangle" },
  { id: "gm-10", topic: "geometry-measure", lines: ["A = \\frac{1}{2}(8 + 12)(5)"], expect: { values: { A: [50] } }, note: "trapezoid" },
  { id: "gm-11", topic: "geometry-measure", lines: ["A = 12 \\cdot 7"], expect: { values: { A: [84] } }, note: "parallelogram, base × height" },
  { id: "gm-12", topic: "geometry-measure", lines: ["V = lwh", "l = 4", "w = 3", "h = 5", "V = ?"], expect: { values: { V: [60] } }, note: "rectangular prism" },
  { id: "gm-13", topic: "geometry-measure", lines: ["V = \\frac{1}{3}Bh", "B = 36", "h = 10", "V = ?"], expect: { values: { V: [120] } }, note: "pyramid" },
  { id: "gm-14", topic: "geometry-measure", lines: ["A = \\pi (2.5)^{2}"], expect: { values: { A: [6.25 * Math.PI] }, answer: "A \\approx 19.63", approxOk: true }, note: "a column in decimals: exact in π, then ≈" },
  { id: "gm-15", topic: "geometry-measure", lines: ["A = \\frac{60^{\\circ}}{360^{\\circ}} \\cdot \\pi (6)^{2}"], expect: { values: { A: [6 * Math.PI] } }, note: "sector area in degrees" },
  { id: "gm-16", topic: "geometry-measure", lines: ["s = \\frac{60^{\\circ}}{360^{\\circ}} \\cdot 2\\pi (6)"], expect: { values: { s: [2 * Math.PI] } }, note: "arc length in degrees" },
  { id: "gm-17", topic: "geometry-measure", lines: ["s = r\\theta", "r = 6", "\\theta = \\frac{\\pi}{3}", "s = ?"], expect: { values: { s: [2 * Math.PI] } }, note: "arc length in radians" },
  { id: "gm-18", topic: "geometry-measure", lines: ["A = \\frac{1}{2} r^{2} \\theta", "r = 4", "\\theta = \\frac{\\pi}{2}", "A = ?"], expect: { values: { A: [4 * Math.PI] } }, note: "sector area in radians" },
  { id: "gm-19", topic: "geometry-measure", lines: ["A = \\pi r^{2}", "A = 50", "r = ?"], expect: { values: { r: [Math.sqrt(50 / Math.PI)] }, approxOk: true, interval: LENGTH }, note: "a radius from an area: π under the root, so ≈" },
  { id: "gm-20", topic: "geometry-measure", lines: ["A = \\pi r^{2}", "A = 49\\pi", "r = ?"], expect: { values: { r: [7] }, interval: LENGTH }, note: "a radius from an area in π" },
  { id: "gm-21", topic: "geometry-measure", lines: ["A = s^{2}", "A = 49", "s = ?"], expect: { values: { s: [7] }, interval: LENGTH }, note: "a side from an area: positive" },
  { id: "gm-22", topic: "geometry-measure", lines: ["V = s^{3}", "V = 64", "s = ?"], expect: { values: { s: [4] } }, note: "a cube's edge from its volume" },
  { id: "gm-23", topic: "geometry-measure", lines: ["V = \\frac{4}{3}\\pi r^{3}", "V = 36\\pi", "r = ?"], expect: { values: { r: [3] }, interval: LENGTH }, note: "a sphere's radius from its volume" },
  { id: "gm-24", topic: "geometry-measure", lines: ["r = 5 \\mathrm{~cm}", "A = \\pi r^{2}", "A = ?"], expect: { answer: "25\\pi \\mathrm{~cm}^{2}" }, note: "units carried" },
  { id: "gm-25", topic: "geometry-measure", lines: ["A = \\frac{1}{2} a P", "a = 5", "P = 60", "A = ?"], expect: { values: { A: [150] } }, note: "regular polygon: apothem and perimeter" },
  { id: "gm-26", topic: "geometry-measure", lines: ["L = \\pi (3)(5)"], expect: { values: { L: [15 * Math.PI] } }, note: "a cone's lateral area" },
  { id: "gm-27", topic: "geometry-measure", lines: ["V = \\pi (1.5)^{2}(4)"], expect: { values: { V: [9 * Math.PI] }, approxOk: true }, note: "a cylinder in decimals" },
  { id: "gm-28", topic: "geometry-measure", lines: ["V = \\frac{1}{3}\\pi(6)^{2}(10)"], expect: { values: { V: [120 * Math.PI] } }, note: "a cone with its values in" },
  { id: "gm-29", topic: "geometry-measure", lines: ["P = 2(12) + 2(7)"], expect: { values: { P: [38] } }, note: "a rectangle's perimeter" },

  // ---------------------------------------------------------------- circles (G-C.2, G-C.5, G-GPE.1)
  { id: "gc-01", topic: "geometry-circles", lines: ["d = 10", "C = \\pi d", "C = ?"], expect: { values: { C: [10 * Math.PI] } }, note: "circumference from the diameter" },
  { id: "gc-02", topic: "geometry-circles", lines: ["C = 2\\pi r", "C = 18\\pi", "r = ?"], expect: { values: { r: [9] } }, note: "a radius from the circumference" },
  { id: "gc-03", topic: "geometry-circles", lines: ["s = \\frac{\\theta}{360^{\\circ}} \\cdot 2\\pi r", "\\theta = 90^{\\circ}", "r = 8", "s = ?"], expect: { values: { s: [4 * Math.PI] } }, note: "arc length with the formula" },
  { id: "gc-04", topic: "geometry-circles", lines: ["A = \\frac{\\theta}{360^{\\circ}} \\cdot \\pi r^{2}", "\\theta = 120^{\\circ}", "r = 6", "A = ?"], expect: { values: { A: [12 * Math.PI] } }, note: "sector area with the formula" },
  { id: "gc-05", topic: "geometry-circles", lines: ["x = \\frac{1}{2} \\cdot 110^{\\circ}"], expect: { values: { x: [deg(55)] } }, note: "an inscribed angle is half its arc" },
  { id: "gc-06", topic: "geometry-circles", lines: ["2 \\cdot 35^{\\circ} = x"], expect: { values: { x: [deg(70)] } }, note: "a central angle from an inscribed one" },
  { id: "gc-07", topic: "geometry-circles", lines: ["\\frac{1}{2}(2x + 20) = 50"], expect: { values: { x: [40] } }, note: "an inscribed angle with an unknown arc" },
  { id: "gc-08", topic: "geometry-circles", lines: ["m\\angle ABC = 40^{\\circ}", "m\\widehat{AC} = 2 \\cdot m\\angle ABC", "m\\widehat{AC} = ?"], expect: { values: { arc_AC: [deg(80)] } }, note: "an arc from its inscribed angle" },
  { id: "gc-09", topic: "geometry-circles", lines: ["x \\cdot 4 = 6 \\cdot 8"], expect: { values: { x: [12] } }, note: "intersecting chords" },
  { id: "gc-10", topic: "geometry-circles", lines: ["PA \\cdot PB = PC \\cdot PD", "PA = 4", "PB = 10", "PC = 5", "PD = ?"], expect: { values: { PD: [8] } }, note: "two secants, named segments" },
  { id: "gc-11", topic: "geometry-circles", lines: ["PT^{2} = PA \\cdot PB", "PA = 4", "PB = 9", "PT = ?"], expect: { values: { PT: [6] }, interval: LENGTH }, note: "a tangent and a secant: a length is positive" },
  { id: "gc-12", topic: "geometry-circles", lines: ["h = 2", "k = -3", "r = 5", "(x - h)^{2} + (y - k)^{2} = r^{2}"], expect: { answer: "(x - 2)^{2} + (y + 3)^{2} = 25" }, note: "the equation from the centre and radius" },
  { id: "gc-13", topic: "geometry-circles", lines: ["(2, -3)", "r = 5", "(x - h)^{2} + (y - k)^{2} = r^{2}"], expect: { answer: "(x - 2)^{2} + (y + 3)^{2} = 25" }, note: "the centre as a point" },
  { id: "gc-14", topic: "geometry-circles", lines: ["x^{2} + y^{2} - 6x + 4y - 12 = 0"], expect: { point: [3, -2], values: { r: [5] } }, note: "completing the square" },
  { id: "gc-15", topic: "geometry-circles", lines: ["x^{2} + y^{2} + 8x - 2y = 8"], expect: { point: [-4, 1], values: { r: [5] } } },
  { id: "gc-16", topic: "geometry-circles", lines: ["2x^{2} + 2y^{2} - 8x + 12y - 6 = 0"], expect: { point: [2, -3], values: { r: [4] } }, note: "divided by 2 first" },
  { id: "gc-17", topic: "geometry-circles", lines: ["(x - 2)^{2} + (y + 3)^{2} = 25", "r = ?"], expect: { point: [2, -3], values: { r: [5] } }, note: "standard form, read" },
  { id: "gc-18", topic: "geometry-circles", lines: ["x^{2} + y^{2} = 49", "(h, k) = ?"], expect: { point: [0, 0], values: { r: [7] } }, note: "centred at the origin" },
  { id: "gc-19", topic: "geometry-circles", lines: ["x^{2} + y^{2} - 4x + 6y - 3 = 0"], expect: { point: [2, -3], values: { r: [4] } } },
  { id: "gc-20", topic: "geometry-circles", lines: ["x^{2} + y^{2} + 2x - 4y - 4 = 0"], expect: { point: [-1, 2], values: { r: [3] } } },
  { id: "gc-21", topic: "geometry-circles", lines: ["x^{2} + y^{2} - 2x + 4y - 15 = 0"], expect: { point: [1, -2], values: { r: [2 * Math.sqrt(5)] } }, note: "the radius a surd: 2√5" },

  // ---------------------------------------------------------------- coordinates and transformations (G-GPE.4–7, G-CO.2–5)
  { id: "gx-01", topic: "geometry-coordinates", lines: ["A(1, 2), \\ B(4, 6)", "AB = ?"], expect: { values: { AB: [5] } }, note: "distance between named points" },
  { id: "gx-02", topic: "geometry-coordinates", lines: ["A(-2, 3), \\ B(4, -5)", "AB ="], expect: { values: { AB: [10] } }, note: "negative coordinates bracketed" },
  { id: "gx-03", topic: "geometry-coordinates", lines: ["(1, 2), (4, 6)", "d = \\sqrt{(x_{2} - x_{1})^{2} + (y_{2} - y_{1})^{2}}"], expect: { values: { d: [5] } }, note: "the distance formula as written" },
  { id: "gx-04", topic: "geometry-coordinates", lines: ["P(0, 0), \\ Q(3, 5)", "PQ = ?"], expect: { values: { PQ: [Math.sqrt(34)] } }, note: "an exact root" },
  { id: "gx-05", topic: "geometry-coordinates", lines: ["d = \\sqrt{(7 - 1)^{2} + (9 - 1)^{2}}"], expect: { values: { d: [10] } }, note: "the formula with numbers in" },
  { id: "gx-06", topic: "geometry-coordinates", lines: ["A(1, 2), \\ B(4, 6)", "M = ?"], expect: { point: [2.5, 4] }, note: "midpoint" },
  { id: "gx-07", topic: "geometry-coordinates", lines: ["(1, 2), (5, 8)", "M = \\left(\\frac{x_{1} + x_{2}}{2}, \\frac{y_{1} + y_{2}}{2}\\right)"], expect: { point: [3, 5] }, note: "the midpoint formula as written" },
  { id: "gx-08", topic: "geometry-coordinates", lines: ["M = \\left(\\frac{-3 + 7}{2}, \\frac{4 + (-2)}{2}\\right)"], expect: { point: [2, 1] }, note: "the midpoint with numbers in" },
  { id: "gx-09", topic: "geometry-coordinates", lines: ["A(1, 2), \\ B(4, 6)", "m = ?"], expect: { values: { m: [4 / 3] } }, note: "slope" },
  { id: "gx-10", topic: "geometry-coordinates", lines: ["A(2, -1), \\ B(6, 7)", "m_{AB} = ?"], expect: { values: { m_A_B: [2] } }, note: "slope, named" },
  { id: "gx-11", topic: "geometry-coordinates", lines: ["(1, 2), (4, 6)", "m = \\frac{y_{2} - y_{1}}{x_{2} - x_{1}}"], expect: { values: { m: [4 / 3] } }, note: "the slope formula as written" },
  { id: "gx-12", topic: "geometry-coordinates", lines: ["A(1, 2), \\ B(5, 5)", "m_{\\perp} = ?"], expect: { values: { m: [0.75], m_perp: [-4 / 3] } }, note: "the perpendicular slope: the negative reciprocal" },
  { id: "gx-13", topic: "geometry-coordinates", lines: ["A(1, 2), \\ B(5, 5)", "m_{\\parallel} = ?"], expect: { values: { m: [0.75], m_parallel: [0.75] } }, note: "a parallel line's slope" },
  { id: "gx-14", topic: "geometry-coordinates", lines: ["A(1, 2), \\ B(11, 12)", "AP : PB = 2 : 3", "P = ?"], expect: { point: [5, 6] }, note: "a segment divided in a ratio" },
  { id: "gx-15", topic: "geometry-coordinates", lines: ["A(-4, 1), \\ B(8, 7)", "AP : PB = 1 : 2", "P = ?"], expect: { point: [0, 3] } },
  { id: "gx-16", topic: "geometry-coordinates", lines: ["(1, 2), (4, 6), (2, 3)", "A = \\frac{1}{2}|x_{1}(y_{2} - y_{3}) + x_{2}(y_{3} - y_{1}) + x_{3}(y_{1} - y_{2})|"], expect: { values: { A: [0.5] } }, note: "a triangle's area from its vertices" },
  { id: "gx-17", topic: "geometry-coordinates", lines: ["A = \\frac{1}{2}|0(4 - 0) + 6(0 - 0) + 3(0 - 4)|"], expect: { values: { A: [6] } }, note: "the area formula with numbers in" },
  { id: "gx-18", topic: "geometry-coordinates", lines: ["R_{90^{\\circ}}(2, 3)"], expect: { point: [-3, 2] }, note: "rotation 90° about the origin" },
  { id: "gx-19", topic: "geometry-coordinates", lines: ["R_{180^{\\circ}}(2, -3)"], expect: { point: [-2, 3] } },
  { id: "gx-20", topic: "geometry-coordinates", lines: ["R_{270^{\\circ}}(4, 1)"], expect: { point: [1, -4] } },
  { id: "gx-21", topic: "geometry-coordinates", lines: ["r_{y = x}(2, 5)"], expect: { point: [5, 2] }, note: "reflection in y = x" },
  { id: "gx-22", topic: "geometry-coordinates", lines: ["r_{y = 0}(4, 7)"], expect: { point: [4, -7] }, note: "reflection in the x-axis, y = 0" },
  { id: "gx-23", topic: "geometry-coordinates", lines: ["r_{x = 0}(-3, 5)"], expect: { point: [3, 5] }, note: "reflection in the y-axis, x = 0" },
  { id: "gx-24", topic: "geometry-coordinates", lines: ["r_{x = 2}(5, 3)"], expect: { point: [-1, 3] }, note: "reflection in x = 2" },
  { id: "gx-25", topic: "geometry-coordinates", lines: ["T_{\\langle 3, -2 \\rangle}(1, 4)"], expect: { point: [4, 2] }, note: "translation" },
  { id: "gx-26", topic: "geometry-coordinates", lines: ["D_{2}(3, -1)"], expect: { point: [6, -2] }, note: "dilation about the origin" },
  { id: "gx-27", topic: "geometry-coordinates", lines: ["(x, y) \\to (x + 3, y - 2)", "(1, 4)"], expect: { point: [4, 2] }, note: "a mapping rule" },
  { id: "gx-28", topic: "geometry-coordinates", lines: ["A(2, 3)", "R_{270^{\\circ}}(A)"], expect: { point: [3, -2] }, note: "a named point rotated" },
  { id: "gx-29", topic: "geometry-coordinates", lines: ["D_{\\frac{1}{2}}(4, -6)"], expect: { point: [2, -3] }, note: "dilation by a half" },

  // ---------------------------------------------------------------- similarity (G-SRT.2–5)
  { id: "gs-01", topic: "geometry-similarity", lines: ["\\frac{x}{6} = \\frac{8}{12}"], expect: { values: { x: [4] } }, note: "cross-multiplied" },
  { id: "gs-02", topic: "geometry-similarity", lines: ["\\frac{8}{x} = \\frac{12}{15}"], expect: { values: { x: [10] } }, note: "the unknown in a denominator" },
  { id: "gs-03", topic: "geometry-similarity", lines: ["\\frac{x + 2}{6} = \\frac{8}{12}"], expect: { values: { x: [2] } } },
  { id: "gs-04", topic: "geometry-similarity", lines: ["\\frac{5}{x} = \\frac{10}{14}"], expect: { values: { x: [7] } } },
  { id: "gs-05", topic: "geometry-similarity", lines: ["k = \\frac{15}{10}"], expect: { values: { k: [1.5] } }, note: "scale factor" },
  { id: "gs-06", topic: "geometry-similarity", lines: ["\\frac{A}{20} = \\left(\\frac{3}{2}\\right)^{2}"], expect: { values: { A: [45] } }, note: "areas scale by k²" },
  { id: "gs-07", topic: "geometry-similarity", lines: ["\\frac{V}{54} = \\left(\\frac{1}{3}\\right)^{3}"], expect: { values: { V: [2] } }, note: "volumes scale by k³" },
  { id: "gs-08", topic: "geometry-similarity", lines: ["A = 20 \\cdot \\left(\\frac{3}{2}\\right)^{2}"], expect: { values: { A: [45] } } },
  { id: "gs-09", topic: "geometry-similarity", lines: ["\\frac{AB}{DE} = \\frac{BC}{EF}", "AB = 6", "DE = 9", "BC = 8", "EF = ?"], expect: { values: { EF: [12] } }, note: "similar triangles, named sides" },
  { id: "gs-10", topic: "geometry-similarity", lines: ["\\frac{AD}{DB} = \\frac{AE}{EC}", "AD = 4", "DB = 6", "AE = 5", "EC = ?"], expect: { values: { EC: [7.5] } }, note: "the side-splitter" },
  { id: "gs-11", topic: "geometry-similarity", lines: ["\\frac{P}{24} = \\frac{5}{4}"], expect: { values: { P: [30] } }, note: "perimeters scale by k" },
  { id: "gs-12", topic: "geometry-similarity", lines: ["\\frac{4}{CD} = \\frac{CD}{9}"], expect: { values: { CD: [6] }, interval: LENGTH }, note: "the geometric mean: a length" },
  { id: "gs-13", topic: "geometry-similarity", lines: ["\\frac{x}{4.5} = \\frac{6}{9}"], expect: { values: { x: [3] } }, note: "a decimal side" },
  { id: "gs-14", topic: "geometry-similarity", lines: ["k = \\frac{3}{2}", "A_{1} = 20", "A_{2} = k^{2} A_{1}", "A_{2} = ?"], expect: { values: { A_2: [45] } }, note: "an area through k²" },
  { id: "gs-15", topic: "geometry-similarity", lines: ["\\frac{h}{6} = \\frac{15}{4}"], expect: { values: { h: [22.5] } }, note: "a height by shadows" },
  { id: "gs-16", topic: "geometry-similarity", lines: ["\\frac{2x + 1}{10} = \\frac{9}{6}"], expect: { values: { x: [7] } } },
];

