import type { FigureSpec } from "../../figureDraw/contracts";
import type { TeachInput } from "../teach";

/**
 * The owner's SAT problem ("O is the center of the circle, R and S lie on the circle. O = (a, b),
 * R = (a + √6, b + 5), ∠ROS is a right angle. What is RS²?"), worked as the textbook works it —
 * the solution the chat is to teach on the board, and its figure true to scale.
 */
export const OWNER_TEACH: TeachInput = {
  steps: [
    { say: "O is the center and R and S are on the circle, so OR and OS are radii: OR = OS." },
    {
      say: "Find OR with the distance formula.",
      math: ["OR = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}", "= \\sqrt{(a + \\sqrt{6} - a)^2 + (b + 5 - b)^2}", "= \\sqrt{(\\sqrt{6})^2 + 5^2}", "= \\sqrt{6 + 25}", "= \\sqrt{31}"],
    },
    { say: "The radii are equal.", math: ["OS = OR = \\sqrt{31}"] },
    {
      say: "Angle ROS is a right angle, so use the Pythagorean theorem in triangle ROS.",
      math: ["RS^{2} = OR^{2} + OS^{2}", "= 2 \\cdot OR^{2}", "= 2(\\sqrt{31})^{2}", "= 2(31)", "= 62"],
    },
  ],
  answer: "RS^{2} = 62",
};

/** O at the origin, R = O + (√6, 5), S a quarter turn from R: the circle through R, the right angle at O. */
export const OWNER_FIGURE: FigureSpec = {
  points: { O: { x: 0, y: 0 }, R: { x: 2.449, y: 5 }, S: { x: -5, y: 2.449 } },
  circles: [{ center: "O", through: "R" }],
  segments: [
    { from: "O", to: "R", label: "\\sqrt{31}" },
    { from: "O", to: "S" },
    { from: "R", to: "S" },
  ],
  angles: [{ at: "O", from: "R", to: "S", right: true }],
};

/** A linear equation the chat wrote, explained step by step. */
export const LINEAR_TEACH: TeachInput = {
  steps: [
    { say: "Subtract 3 from both sides.", math: ["2x + 3 = 11", "2x = 8"] },
    { say: "Divide both sides by 2.", math: ["x = 4"] },
    { say: "Check: put 4 back in.", math: ["2(4) + 3 = 11"] },
  ],
  answer: "x = 4",
};

/**
 * Problem 1 of a pasted worksheet page (the 2026-10-13 demo): the average rate of change of
 * y = x² − x + 1 over [0, 3], worked as the tutor works it.
 */
export const AVG_RATE_TEACH: TeachInput = {
  steps: [
    { say: "The average rate of change is the slope between the two endpoints.", math: ["\\frac{f(b) - f(a)}{b - a}"] },
    { say: "Find the y-value at x = 0.", math: ["f(0) = 0^{2} - 0 + 1", "= 1"] },
    { say: "Find the y-value at x = 3.", math: ["f(3) = 3^{2} - 3 + 1", "= 9 - 3 + 1", "= 7"] },
    { say: "Divide the change in y by the change in x.", math: ["\\frac{f(3) - f(0)}{3 - 0} = \\frac{7 - 1}{3 - 0}", "= \\frac{6}{3}", "= 2"] },
  ],
  answer: "2",
};

/** A worksheet page pasted in the middle of a 1600×900 screen, as on the demo board (a PDF page, 634×820). */
export const WORKSHEET_PAGE = { x: 483, y: 40, w: 634, h: 820 } as const;
