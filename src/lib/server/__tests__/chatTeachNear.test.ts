import { describe, expect, it } from "vitest";
import { getEngine } from "@/lib/live/engine";
import type { TeachAction } from "@/lib/live/chat/contracts";
import { gateChatTeach } from "../chatTeach";
import { cleanChatActions } from "../prompts/chat";

/**
 * A worked solution names the problem on the screen it works (`near`): the board writes it in that
 * problem's cell, under it, instead of taking the student to a new screen (docs/ASK-V2.md).
 */
describe("teach near", () => {
  it("is read leniently, as a drawing's is", () => {
    const { actions } = cleanChatActions([{ type: "teach", near: "#4", steps: [{ say: "Subtract 3.", math: ["2x + 3 = 11", "2x = 8"] }], answer: "2x = 8" }]);
    expect(actions[0]).toMatchObject({ type: "teach", near: 4 });
  });

  it("a repaired solution keeps the problem it is written under", async () => {
    const engine = await getEngine();
    const slip: TeachAction = { type: "teach", near: 3, steps: [{ say: "Divide by 2.", math: ["2x = 8", "x = 5"] }], answer: "x = 5" };
    const out = await gateChatTeach(slip, engine, async () => ({ steps: [{ say: "Divide by 2.", math: ["2x = 8", "x = 4"] }], answer: "x = 4" }));
    expect(out).toMatchObject({ ok: true, repaired: true, action: { type: "teach", near: 3 } });
  });
});
