import { beforeAll, describe, expect, it } from "vitest";
import type { LiveEngine } from "../../contracts";
import { getEngine } from "..";
import { judgeColumn } from "../columnWork";
import { readVariants } from "../../youngHand";

/**
 * What a messy read of a child's step may have been (`readVariants`), taken only to find the step
 * right (`judgeLine`). Re-said as plain LaTeX from the real-ink bench — no child's ink here.
 */

let engine: LiveEngine;
beforeAll(async () => {
  engine = await getEngine();
}, 60_000);

const marks = (column: { problem?: string[]; lines: string[] }) =>
  judgeColumn(engine, column).map((a) => (a ? `${a.verdict}${a.solved ? "+solved" : ""}` : null));

describe("judgeLine takes a read's variant only to find the step right", () => {
  it("a side note behind a left arrow, a plus written high, her x read as a times sign", () => {
    expect(marks({ problem: ["2x + 3 = 11"], lines: ["2 x=11-3 \\Longleftarrow 9"] })).toEqual(["ok"]);
    expect(marks({ problem: ["-5(x - 4) - 6x"], lines: ["-5 x^{+} 20-6 x"] })).toEqual(["ok"]);
    expect(marks({ lines: ["2 x=4", "\\times=2"] })[1]).toBe("ok+solved");
  });

  it("never makes a wrong step right, nor a ring: the variant is a slip too, the read stands", () => {
    expect(marks({ lines: ["2 x=4", "\\times=3"] })[1]).not.toBe("ok+solved");
    expect(marks({ lines: ["2 x=4", "\\times=3"] })[1]).not.toBe("ok");
  });

  it("never drops a number the problem has: `\\Longleftarrow 11` under 2x + 3 = 11 stays as read", () => {
    expect(marks({ problem: ["2x + 3 = 11"], lines: ["2 x=11-3 \\Longleftarrow 11"] })).not.toEqual(["ok"]);
    expect(readVariants("2 x=11-3 \\Longleftarrow 11", false, ["2x + 3 = 11"])).toEqual([]);
    expect(readVariants("2 x=11-3 \\Longleftarrow 9", false, ["2x + 3 = 11"])).toEqual(["2 x=11-3"]);
  });

  it("the minus a read dropped is offered only with her ink's minus: forgetting it is a real slip, still ringed", () => {
    // no minus stroke in the ink: no variant, and the step that forgot the minus is a slip
    expect(readVariants("5 x+20-6 x")).toEqual([]);
    expect(marks({ problem: ["-5(x - 4) - 6x"], lines: ["5 x+20-6 x"] })).toEqual(["mismatch"]);
    // her ink starts with a minus right before the 5 (`inkLeadsWithMinus`): the variant is the right step
    expect(readVariants("5 x+20-6 x", true)).toEqual(["-5 x+20-6 x"]);
    expect(marks({ problem: ["-5(x - 4) - 6x"], lines: ["-5 x+20-6 x"] })).toEqual(["ok"]);
  });
});
