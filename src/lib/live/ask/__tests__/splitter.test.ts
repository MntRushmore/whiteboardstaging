import { describe, expect, it } from "vitest";
import { AskStreamSplitter, jsonObjectIn, partialSuffix } from "../splitter";

/** Feed `chunks` and collect what the panel would show, then the end. */
function run(chunks: string[]) {
  const s = new AskStreamSplitter();
  let shown = "";
  for (const c of chunks) shown += s.push(c);
  const end = s.end();
  shown += end.tail;
  return { shown, ...end, overflow: s.overflow };
}

describe("AskStreamSplitter", () => {
  it("passes a reply with no block straight through", () => {
    const r = run(["Hi ", "Maya! ", "What do you think 3 × 4 is?"]);
    expect(r.shown).toBe("Hi Maya! What do you think 3 × 4 is?");
    expect(r.reply).toBe(r.shown);
    expect(r.board).toBeNull();
  });

  it("hides the board block and returns its JSON", () => {
    const r = run(["Here are 3 for you.\n", '<board>{"actions":[{"type":"new_screen"}]}</board>']);
    expect(r.shown).toBe("Here are 3 for you.\n");
    expect(JSON.parse(r.board!)).toEqual({ actions: [{ type: "new_screen" }] });
  });

  it("holds back a tag split across chunks", () => {
    const s = new AskStreamSplitter();
    expect(s.push("Try these <bo")).toBe("Try these ");
    expect(s.push('ard>{"actions":[]}</bo')).toBe("");
    expect(s.push("ard> Good luck!")).toBe(" Good luck!");
    const end = s.end();
    expect(end.reply).toBe("Try these  Good luck!");
    expect(end.board).toBe('{"actions":[]}');
  });

  it("shows a '<' that turns out not to be the tag", () => {
    const r = run(["Is 3 <", " 5? Yes!"]);
    expect(r.shown).toBe("Is 3 < 5? Yes!");
    expect(r.board).toBeNull();
  });

  it("keeps a lone '<' at the very end as reply", () => {
    const r = run(["x <"]);
    expect(r.shown).toBe("x <");
  });

  it("strips fences inside the block", () => {
    const r = run(['Ok.<board>\n```json\n{"actions":[{"type":"clear_tutor"}]}\n```\n</board>']);
    expect(JSON.parse(r.board!)).toEqual({ actions: [{ type: "clear_tutor" }] });
  });

  it("keeps an unclosed block (the model ran out of tokens) as the block", () => {
    const r = run(['Ok.<board>{"actions":[{"type":"new_screen"}]}']);
    expect(r.shown).toBe("Ok.");
    expect(r.board).toBe('{"actions":[{"type":"new_screen"}]}');
  });

  it("counts only the first block", () => {
    const r = run(['A<board>{"actions":[1]}</board>B<board>{"actions":[2]}</board>C']);
    expect(r.shown).toBe("ABC");
    expect(r.board).toBe('{"actions":[1]}');
  });

  it("answers null for a block with no object in it", () => {
    expect(run(["Hi<board>nothing</board>"]).board).toBeNull();
  });

  it("caps a block that grows too long", () => {
    const r = run(["<board>{", "x".repeat(30_000), "}</board>"]);
    expect(r.overflow).toBe(true);
  });
});

describe("partialSuffix / jsonObjectIn", () => {
  it("finds the longest tag prefix at the end", () => {
    expect(partialSuffix("abc<boa", "<board>")).toBe(4);
    expect(partialSuffix("abc", "<board>")).toBe(0);
    expect(partialSuffix("<board", "<board>")).toBe(6);
  });
  it("finds the object", () => {
    expect(jsonObjectIn('sure: {"a":1} ok')).toBe('{"a":1}');
    expect(jsonObjectIn("none")).toBeNull();
  });
});
