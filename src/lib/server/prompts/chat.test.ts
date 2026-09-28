import { describe, expect, it } from "vitest";
import {
  ALGEBRA_PROOF_EXAMPLE,
  buildChatMessages,
  buildFigureRepairMessages,
  buildProofRepairMessages,
  CHAT_SYSTEM_PROMPT,
  cleanChatActions,
  cleanReplyText,
  dropMissingProblems,
  PROOF_EXAMPLES,
  PROOF_REPAIR_PROMPT,
  problemNumbers,
  ProofRepairReplySchema,
} from "./chat";
import { PROBE_FIGURE } from "@/lib/live/chat/figure";
import { CHAT_ACTION_TYPES } from "@/lib/live/chat/contracts";

describe("chat prompt", () => {
  it("names every action and the rules that keep the board to maths", () => {
    for (const t of CHAT_ACTION_TYPES) expect(CHAT_SYSTEM_PROMPT).toContain(`"${t}"`);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/no words/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/never solve/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/TRUE TO SCALE/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/only help with maths/);
  });

  it("the user message: the screen, the chat so far, the request", () => {
    const [system, user] = buildChatMessages({
      message: "3 more like these",
      history: [{ role: "user", text: "3 two-step equations" }],
      screen: { empty: false, student: ["2x = 8"], tutor: ["x = 4"], problems: ["2x + 3 = 11"] },
    });
    expect(system.content).toBe(CHAT_SYSTEM_PROMPT);
    expect(user.content).toBe(
      [
        "THIS SCREEN: has work on it",
        "Problems the tutor wrote here:",
        "1. 2x + 3 = 11",
        "The student's lines (as read):",
        "- 2x = 8",
        "The tutor's other lines:",
        "- x = 4",
        "",
        "CHAT SO FAR:",
        "student: 3 two-step equations",
        "",
        "REQUEST: 3 more like these",
        "",
        "JSON only.",
      ].join("\n"),
    );
    const [, empty] = buildChatMessages({ message: "graph y = x^2", history: [], screen: { empty: true, student: [], tutor: [], problems: [] } });
    expect(String(empty.content)).toMatch(/^THIS SCREEN: empty\n\nREQUEST: graph y = x\^2/);
  });

  it("help with a problem on the board: help_problem, a step or the solution, never a question back when the problem is clear", () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('"help_problem"');
    for (const ask of ["help me with 3", "I'm stuck on 2", "how do I start 3", "solve 3", "show me how to solve it", "work out 3", "what's the answer to 1"]) {
      expect(CHAT_SYSTEM_PROMPT).toContain(ask);
    }
    expect(CHAT_SYSTEM_PROMPT).toMatch(/never a question back/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/With no problems listed here, never help_problem/);
    expect(CHAT_SYSTEM_PROMPT).toContain('{"type": "help_problem", "problem": 3, "depth": "step"}');
  });

  it("problems are listed as numbered on the board", () => {
    const [, user] = buildChatMessages({ message: "help me with 7", history: [], screen: { empty: false, problems: ["x + 1 = 2", "x + 2 = 4", "x + 3 = 6", "x + 4 = 8"], numbers: [5, 6, 7, 8] } });
    expect(String(user.content)).toContain("Problems the tutor wrote here:\n5. x + 1 = 2\n6. x + 2 = 4\n7. x + 3 = 6\n8. x + 4 = 8");
    // an older client sends no numbers: 1, 2, 3…
    expect(problemNumbers({ problems: ["a", "b"] })).toEqual([1, 2]);
    expect(problemNumbers({ problems: ["a", "b"], numbers: [4] })).toEqual([4, 2]);
  });

  it("proofs: never a question back; worked unless the student asks for one to do; the engine's reasons named; algebra as maths lines", () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/Never ask which proof: choose a sensible one yourself/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/never for a proof: choose one/);
    for (const ask of ["write a proof", "a two-column proof", "show me a proof", "the hardest proof ever", "give me a proof to do", "a proof I can try"]) expect(CHAT_SYSTEM_PROMPT).toContain(`"${ask}"`);
    // the reasons the planner and checker know, and what they do not
    for (const reason of ["SSS", "SAS", "ASA", "AAS", "HL", "CPCTC", "Reflexive", "Vertical ∠s", "Def. of midpoint", "Alt. int."]) expect(CHAT_SYSTEM_PROMPT).toContain(reason);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/No similarity/);
    // the theorem being proved is not a reason for itself
    expect(CHAT_SYSTEM_PROMPT).toMatch(/must not use that theorem/);
    // every example is in the prompt as the model is to write it
    for (const e of PROOF_EXAMPLES) expect(CHAT_SYSTEM_PROMPT).toContain(`Request: ${e.request} → ${JSON.stringify({ reply: e.reply, actions: [e.action] })}`);
    expect(CHAT_SYSTEM_PROMPT).toContain(JSON.stringify(ALGEBRA_PROOF_EXAMPLE.lines));
    expect(CHAT_SYSTEM_PROMPT).toMatch(/A proof asked for is the other exception/);
  });

  it("the proof repair carries the proof and every problem the engine found", () => {
    const action = PROOF_EXAMPLES[0].action;
    const [system, user] = buildProofRepairMessages("write a proof", action, ["The proof engine could not prove it", "AB is drawn 5 long"]);
    expect(system.content).toBe(PROOF_REPAIR_PROMPT);
    // the proved examples are in reach of the repair: "a harder one" can be the hardest example
    for (const e of PROOF_EXAMPLES) expect(PROOF_REPAIR_PROMPT).toContain(JSON.stringify(e.action.given));
    expect(String(user.content)).toContain(JSON.stringify({ figure: action.figure, given: action.given, prove: action.prove }));
    expect(String(user.content)).toContain("- The proof engine could not prove it\n- AB is drawn 5 long");
    expect(ProofRepairReplySchema.parse({ figure: action.figure, given: "\\overline{AB} \\cong \\overline{CD}", prove: "\\overline{AE} \\cong \\overline{CE}" }).given).toEqual(["\\overline{AB} \\cong \\overline{CD}"]);
  });

  it("the figure repair carries the spec and every problem", () => {
    const [, user] = buildFigureRepairMessages("a right triangle", PROBE_FIGURE, ["point D is not defined", "zero-length side"]);
    expect(String(user.content)).toContain(JSON.stringify(PROBE_FIGURE));
    expect(String(user.content)).toContain("- point D is not defined\n- zero-length side");
  });
});

describe("cleaning the model's reply", () => {
  it("keeps valid actions, drops unknown and malformed ones with why", () => {
    const { actions, dropped } = cleanChatActions([
      { type: "write_problems", problems: ["$2x + 3 = 11$", "\\text{Find } x", ["x + y = 3", "x - y = 1"]] },
      { type: "draw", shape: "cat" },
      "clear",
      { type: "graph", relations: ["y = x^{2}"], window: null },
      { type: "graph", relations: [] },
      { type: "clear_tutor" },
    ]);
    expect(actions).toEqual([
      { type: "write_problems", problems: [["2x + 3 = 11"], ["x + y = 3", "x - y = 1"]] },
      { type: "graph", relations: ["y = x^{2}"] },
      { type: "clear_tutor" },
    ]);
    expect(dropped.map((d) => d.type)).toEqual(["write_problems", "draw", "?", "graph"]);
    expect(dropped[0].reason).toBe("1 invalid problem");
  });

  it("a problem set with no valid problem left is dropped whole; at most six actions", () => {
    expect(cleanChatActions([{ type: "write_problems", problems: ["\\text{hello}"] }]).actions).toEqual([]);
    const many = cleanChatActions(Array(8).fill({ type: "new_screen" }));
    expect(many.actions).toHaveLength(6);
    expect(many.dropped).toHaveLength(2);
  });

  it("help_problem: a number (or \"3\"), a depth (none given is a step); anything else is dropped", () => {
    const { actions, dropped } = cleanChatActions([
      { type: "help_problem", problem: 3, depth: "step" },
      { type: "help_problem", problem: "2", depth: "solve" },
      { type: "help_problem", problem: 1 },
      { type: "help_problem", problem: "three", depth: "step" },
      { type: "help_problem", problem: 2, depth: "answer" },
      { type: "help_problem", problem: 0, depth: "step" },
    ]);
    expect(actions).toEqual([
      { type: "help_problem", problem: 3, depth: "step" },
      { type: "help_problem", problem: 2, depth: "solve" },
      { type: "help_problem", problem: 1, depth: "step" },
    ]);
    expect(dropped.map((d) => d.type)).toEqual(["help_problem", "help_problem", "help_problem"]);
  });

  it("help with a problem that is not on the screen is dropped, with a note for the panel", () => {
    const screen = { problems: ["2\\cos x = 1", "\\tan x = \\sqrt{3}", "\\sin x = -\\frac{1}{2}"] };
    const res = dropMissingProblems(
      [
        { type: "help_problem", problem: 3, depth: "step" },
        { type: "help_problem", problem: 7, depth: "step" },
        { type: "help_problem", problem: 7, depth: "solve" },
        { type: "new_screen" },
      ],
      screen,
    );
    expect(res.actions).toEqual([{ type: "help_problem", problem: 3, depth: "step" }, { type: "new_screen" }]);
    expect(res.notes).toEqual(["There's no problem 7 on this screen."]);
    expect(res.dropped).toHaveLength(2);
    // the board's own numbers count, not the position in the list
    expect(dropMissingProblems([{ type: "help_problem", problem: 1, depth: "step" }], { problems: ["a"], numbers: [5] }).notes).toEqual(["There's no problem 1 on this screen."]);
  });

  it("a proof: $ unwrapped, one Given as a string is a list, worked when it does not say", () => {
    const { figure } = PROOF_EXAMPLES[0].action;
    const { actions, dropped } = cleanChatActions([
      { type: "write_proof", figure, given: "$\\overline{AB} \\cong \\overline{CD}$", prove: "$\\overline{AE} \\cong \\overline{CE}$", worked: null },
      { type: "write_proof", figure, given: [], prove: "x" },
    ]);
    expect(actions).toEqual([{ type: "write_proof", figure, given: ["\\overline{AB} \\cong \\overline{CD}"], prove: "\\overline{AE} \\cong \\overline{CE}", worked: true }]);
    expect(dropped).toEqual([{ type: "write_proof", reason: expect.stringMatching(/^given/) }]);
  });

  it("a point's label that is not true / false is let go, not the whole figure", () => {
    const figure = { points: { A: { x: 0, y: 0, label: "A" }, B: { x: 4, y: 0, dot: "yes" }, C: { x: 0, y: 3, label: false } }, segments: [{ from: "A", to: "B" }] };
    const { actions } = cleanChatActions([{ type: "draw_figure", figure }]);
    expect(actions).toEqual([{ type: "draw_figure", figure: { points: { A: { x: 0, y: 0 }, B: { x: 4, y: 0 }, C: { x: 0, y: 3, label: false } }, segments: [{ from: "A", to: "B" }] } }]);
  });

  it("a figure must pass the shared spec schema", () => {
    expect(cleanChatActions([{ type: "draw_figure", figure: PROBE_FIGURE }]).actions).toHaveLength(1);
    const bad = cleanChatActions([{ type: "draw_figure", figure: { points: { "1A": { x: 0, y: 0 } } } }]);
    expect(bad.actions).toEqual([]);
    expect(bad.dropped[0].type).toBe("draw_figure");
  });

  it("the reply: plain, no $, cut at a sentence when long", () => {
    expect(cleanReplyText("  Here are $3$ problems.  ")).toBe("Here are 3 problems.");
    const long = `${"This is a sentence that goes on. ".repeat(12)}`;
    const cut = cleanReplyText(long);
    expect(cut.length).toBeLessThanOrEqual(280);
    expect(cut.endsWith(".")).toBe(true);
  });
});
