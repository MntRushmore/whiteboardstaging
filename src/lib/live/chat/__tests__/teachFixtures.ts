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
