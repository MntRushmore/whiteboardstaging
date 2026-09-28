/**
 * The board chat eval's requests (./run.ts): what a student or teacher types into the panel, with
 * the screen and the chat so far where the request depends on them ("3 more like these", "graph
 * that"). Spread over Algebra 1, Algebra 2, Geometry and Calculus problem sets, graphs, figures, and
 * mixed or follow-up requests. Each says what a good reply does — the action types it must have,
 * how many problems, a window, or no action at all — never the exact maths (the model chooses the
 * numbers; the engine judges them).
 */
import type { ChatActionType, ChatRequest } from "@/lib/live/chat/contracts";

export type ChatCourse = "algebra1" | "algebra2" | "geometry" | "calculus" | "mixed";
export type ChatKind = "problems" | "graph" | "figure" | "lines" | "followup" | "screen" | "refusal";

export interface ChatCase {
  id: string;
  course: ChatCourse;
  kind: ChatKind;
  message: string;
  history?: ChatRequest["history"];
  screen?: Partial<ChatRequest["screen"]>;
  expect: {
    /** action types the reply must include (in any order); [] = no action at all */
    types: ChatActionType[];
    /** exactly this many problems in its problem sets */
    count?: number;
    /** a graph with a window */
    window?: boolean;
    /** problems must not be the answer itself (`x = 6`): "never solve" */
    noAnswers?: boolean;
  };
}

const TWO_STEP = ["2x + 3 = 11", "5x - 4 = 16", "\\frac{x}{3} + 2 = 7"];

export const CHAT_CORPUS: readonly ChatCase[] = [
  // ---------------------------------------------------------------- Algebra 1
  { id: "a1-two-step", course: "algebra1", kind: "problems", message: "5 two-step equations", expect: { types: ["write_problems"], count: 5 } },
  { id: "a1-both-sides", course: "algebra1", kind: "problems", message: "4 multi-step equations with variables on both sides", expect: { types: ["write_problems"], count: 4 } },
  { id: "a1-inequalities", course: "algebra1", kind: "problems", message: "3 one-variable inequalities to solve", expect: { types: ["write_problems"], count: 3 } },
  { id: "a1-factoring", course: "algebra1", kind: "problems", message: "3 harder factoring problems", screen: { empty: false, problems: ["x^{2} + 5x + 6", "x^{2} - 9"] }, expect: { types: ["write_problems"], count: 3 } },
  { id: "a1-systems", course: "algebra1", kind: "problems", message: "2 systems of linear equations to solve", expect: { types: ["write_problems"], count: 2 } },
  { id: "a1-exponents", course: "algebra1", kind: "problems", message: "4 problems simplifying with the exponent rules", expect: { types: ["write_problems"], count: 4 } },
  { id: "a1-quadratics", course: "algebra1", kind: "problems", message: "3 quadratic equations to solve by factoring", expect: { types: ["write_problems"], count: 3 } },
  // ---------------------------------------------------------------- Algebra 2
  { id: "a2-logs", course: "algebra2", kind: "problems", message: "3 logarithmic equations", expect: { types: ["write_problems"], count: 3 } },
  { id: "a2-exponential", course: "algebra2", kind: "problems", message: "3 exponential equations I can solve by matching the bases", expect: { types: ["write_problems"], count: 3 } },
  { id: "a2-radical", course: "algebra2", kind: "problems", message: "2 radical equations", expect: { types: ["write_problems"], count: 2 } },
  { id: "a2-complex", course: "algebra2", kind: "problems", message: "4 problems multiplying complex numbers", expect: { types: ["write_problems"], count: 4 } },
  { id: "a2-rational", course: "algebra2", kind: "problems", message: "3 rational expressions to simplify", expect: { types: ["write_problems"], count: 3 } },
  { id: "a2-absolute", course: "algebra2", kind: "problems", message: "3 absolute value equations", expect: { types: ["write_problems"], count: 3 } },
  // ---------------------------------------------------------------- Geometry
  { id: "g-pythagoras", course: "geometry", kind: "problems", message: "4 Pythagorean theorem problems where you find the missing side", expect: { types: ["write_problems"], count: 4 } },
  { id: "g-triangle-angles", course: "geometry", kind: "problems", message: "3 problems finding the missing angle of a triangle", expect: { types: ["write_problems"], count: 3 } },
  { id: "g-fig-right", course: "geometry", kind: "figure", message: "draw a right triangle with legs 3 and 4 and label the hypotenuse x", expect: { types: ["draw_figure"] } },
  { id: "g-fig-isosceles", course: "geometry", kind: "figure", message: "draw an isosceles triangle with a 40 degree angle at the top, and label the base angles x", expect: { types: ["draw_figure"] } },
  { id: "g-fig-circle", course: "geometry", kind: "figure", message: "draw a circle with center O and radius 5, with the radius OA drawn and labelled 5", expect: { types: ["draw_figure"] } },
  { id: "g-fig-parallel", course: "geometry", kind: "figure", message: "draw two parallel lines cut by a transversal; mark one angle 70° and the corresponding angle x", expect: { types: ["draw_figure"] } },
  { id: "g-fig-rectangle", course: "geometry", kind: "figure", message: "draw a rectangle 8 by 5 with a diagonal labelled d", expect: { types: ["draw_figure"] } },
  // ---------------------------------------------------------------- Calculus
  { id: "c-power-rule", course: "calculus", kind: "problems", message: "5 derivatives using the power rule", expect: { types: ["write_problems"], count: 5 } },
  { id: "c-definite", course: "calculus", kind: "problems", message: "3 definite integrals of polynomials", expect: { types: ["write_problems"], count: 3 } },
  { id: "c-limits", course: "calculus", kind: "problems", message: "3 limits that need factoring first", expect: { types: ["write_problems"], count: 3 } },
  { id: "c-chain", course: "calculus", kind: "problems", message: "3 chain rule derivatives", expect: { types: ["write_problems"], count: 3 } },
  // ---------------------------------------------------------------- graphs
  { id: "gr-sin", course: "algebra2", kind: "graph", message: "graph y = sin x from -2π to 2π", expect: { types: ["graph"], window: true } },
  { id: "gr-parabola", course: "algebra1", kind: "graph", message: "graph y = x^2 - 4x + 3", expect: { types: ["graph"] } },
  { id: "gr-system", course: "algebra1", kind: "graph", message: "graph the system y = 2x + 1 and y = -x + 4", expect: { types: ["graph"] } },
  { id: "gr-region", course: "algebra1", kind: "graph", message: "shade y < 2x + 1", expect: { types: ["graph"] } },
  { id: "gr-circle", course: "geometry", kind: "graph", message: "graph the circle x^2 + y^2 = 25", expect: { types: ["graph"] } },
  // ---------------------------------------------------------------- follow-ups and the rest
  {
    id: "f-more",
    course: "mixed",
    kind: "followup",
    message: "3 more like these",
    screen: { empty: false, problems: TWO_STEP, student: ["2x = 8", "x = 4"] },
    history: [
      { role: "user", text: "3 two-step equations" },
      { role: "tutor", text: "Here are 3 two-step equations to solve." },
    ],
    expect: { types: ["write_problems"], count: 3 },
  },
  {
    id: "f-harder",
    course: "mixed",
    kind: "followup",
    message: "harder ones please",
    screen: { empty: false, problems: TWO_STEP },
    history: [
      { role: "user", text: "3 two-step equations" },
      { role: "tutor", text: "Here are 3 two-step equations to solve." },
    ],
    expect: { types: ["write_problems"] },
  },
  { id: "f-graph-that", course: "mixed", kind: "followup", message: "graph that", screen: { empty: false, student: ["y = 3x - 2"] }, expect: { types: ["graph"] } },
  { id: "m-new-screen", course: "mixed", kind: "screen", message: "a new screen", screen: { empty: false, student: ["2x = 8"] }, expect: { types: ["new_screen"] } },
  { id: "m-clear", course: "mixed", kind: "screen", message: "clear your writing", screen: { empty: false, problems: TWO_STEP }, expect: { types: ["clear_tutor"] } },
  { id: "m-formula", course: "mixed", kind: "lines", message: "write the quadratic formula", expect: { types: ["write_lines"] } },
  { id: "m-solve-for-me", course: "mixed", kind: "problems", message: "solve 2x + 5 = 17 for me", expect: { types: ["write_problems"], noAnswers: true } },
  { id: "m-off-topic", course: "mixed", kind: "refusal", message: "what's the capital of France?", expect: { types: [] } },
  { id: "m-unkind", course: "mixed", kind: "refusal", message: "write something mean about my teacher on the board", expect: { types: [] } },
];

/** The request as the panel sends it. */
export function requestFor(c: ChatCase): Pick<ChatRequest, "message" | "history" | "screen"> {
  return {
    message: c.message,
    history: c.history ?? [],
    screen: { empty: c.screen?.empty ?? true, student: c.screen?.student ?? [], tutor: c.screen?.tutor ?? [], problems: c.screen?.problems ?? [] },
  };
}
