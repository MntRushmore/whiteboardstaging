import { describe, expect, it } from "vitest";
import { buildChatMessages, CHAT_SYSTEM_PROMPT, cleanChatActions, cleanReplyText, buildFigureRepairMessages } from "./chat";
import { PROBE_FIGURE } from "@/lib/live/chat/figure";

describe("chat prompt", () => {
  it("names every action and the rules that keep the board to maths", () => {
    for (const t of ["write_problems", "write_lines", "graph", "draw_figure", "new_screen", "clear_tutor"]) expect(CHAT_SYSTEM_PROMPT).toContain(`"${t}"`);
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
