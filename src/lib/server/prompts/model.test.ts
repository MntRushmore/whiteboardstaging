import { describe, expect, it } from "vitest";
import { VisualModelSchema, type VisualModelKind } from "@/lib/live/chat/contracts";
import { modelProblems } from "@/lib/live/chat/models/check";
import { cleanChatActions } from "./chat";
import { buildModelRepairMessages, lenientModelAction, MODEL_FORMAT, MODEL_REPAIR_PROMPT, ModelRepairReplySchema } from "./model";

/** The JSON objects a text shows (the format's examples): `{"kind": …}` balanced to its brace. */
function examples(text: string): unknown[] {
  const out: unknown[] = [];
  for (let i = text.indexOf('{"kind"'); i >= 0; i = text.indexOf('{"kind"', i + 1)) {
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "{") depth++;
      if (text[j] === "}" && --depth === 0) {
        out.push(JSON.parse(text.slice(i, j + 1)));
        break;
      }
    }
  }
  return out;
}

describe("draw_model's prompt and repair", () => {
  it("shows every kind once, each example a spec the board draws as it is", () => {
    const shown = examples(MODEL_FORMAT);
    const kinds = shown.map((e) => (e as { kind: VisualModelKind }).kind);
    expect(new Set(kinds)).toEqual(new Set(["number_line", "fraction_bars", "fraction_circles", "array", "equal_groups", "area_model", "base_ten", "place_value", "tape", "ten_frame", "clock"]));
    for (const e of shown) {
      const parsed = VisualModelSchema.parse(e);
      expect(modelProblems(parsed), JSON.stringify(e)).toEqual([]);
    }
    expect(MODEL_FORMAT).toMatch(/"near": the number of a problem on THIS screen/);
  });

  it("the repair gets the request, the spec and the board's problems, and answers a model", () => {
    const model = VisualModelSchema.parse({ kind: "fraction_bars", bars: [{ parts: 4, shaded: 5 }] });
    const messages = buildModelRepairMessages("show me 3/4 ", model, modelProblems(model));
    expect(messages[0]).toEqual({ role: "system", content: MODEL_REPAIR_PROMPT });
    expect(messages[1].content).toContain("REQUEST: show me 3/4");
    expect(messages[1].content).toContain(JSON.stringify(model));
    expect(messages[1].content).toContain("- bar 1 has 5 of 4 parts shaded: shaded must be at most parts");
    expect(ModelRepairReplySchema.safeParse({ model: { kind: "clock", hour: 3, minute: 45 } }).success).toBe(true);
    expect(ModelRepairReplySchema.safeParse({ model: { kind: "clock", hour: 13, minute: 45 } }).success).toBe(false);
  });

  it("reads a draw_model written loosely, and refuses one that is not a model", () => {
    expect(lenientModelAction({ type: "draw_model", kind: "ten_frame", filled: 7, near: null })).toEqual({ type: "draw_model", model: { kind: "ten_frame", filled: 7 } });
    expect(lenientModelAction({ type: "draw_model", model: { kind: "ten_frame", filled: 7 }, near: "2" })).toEqual({ type: "draw_model", model: { kind: "ten_frame", filled: 7 }, near: 2 });
    const { actions, dropped } = cleanChatActions([
      { type: "draw_model", model: { kind: "array", rows: 3, cols: 4 }, near: 1 },
      { type: "draw_model", model: { kind: "hexagon", sides: 6 } },
      { type: "draw_model", model: { kind: "ten_frame", filled: 25 } },
    ]);
    expect(actions).toEqual([{ type: "draw_model", model: { kind: "array", rows: 3, cols: 4 }, near: 1 }]);
    expect(dropped.map((d) => d.type)).toEqual(["draw_model", "draw_model"]);
  });
});
