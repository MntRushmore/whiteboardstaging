import { describe, expect, it } from "vitest";
import type { TLShapeId } from "tldraw";
import { lineGroupsOf } from "../typedInk";
import { TYPED_COUNT_META, TYPED_ID_META, TYPED_LATEX_META, TYPED_TEXT_META } from "@/lib/typeMath/contracts";

/** A line group's strokes as the board saves them: the id on each, the lead's meta on the first. */
function group(id: string, n: number, lead: Record<string, unknown> = {}): Array<{ id: TLShapeId; meta: unknown }> {
  return Array.from({ length: n }, (_, i) => ({
    id: `shape:${id}_${i}` as TLShapeId,
    meta: i === 0 ? { [TYPED_ID_META]: id, [TYPED_COUNT_META]: n, ...lead } : { [TYPED_ID_META]: id },
  }));
}

describe("lineGroupsOf — ink written as one line in one go", () => {
  it("a whole typed line: its strokes, its reading and what was typed", () => {
    const strokes = group("ty_a", 4, { [TYPED_LATEX_META]: "2x=8", [TYPED_TEXT_META]: "2x = 8" });
    expect(lineGroupsOf(strokes)).toEqual([{ id: "ty_a", strokeIds: strokes.map((s) => s.id), latex: "2x=8", text: "2x = 8" }]);
  });

  it("a stroke rubbed out, or the lead gone: not whole, ink like any other", () => {
    const strokes = group("ty_a", 4, { [TYPED_LATEX_META]: "2x=8" });
    expect(lineGroupsOf(strokes.slice(1))).toEqual([]);
    expect(lineGroupsOf(strokes.filter((_, i) => i !== 2))).toEqual([]);
  });

  it("a pasted copy beside it (a second lead, the same id): neither is whole", () => {
    const strokes = group("ty_a", 3, { [TYPED_LATEX_META]: "x=4" });
    const copy = strokes.map((s, i) => ({ ...s, id: `shape:copy_${i}` as TLShapeId }));
    expect(lineGroupsOf([...strokes, ...copy])).toEqual([]);
  });

  it("a group with no reading (a phone pen's line) is still one line, with nothing to read it as", () => {
    const strokes = group("ph_1", 2);
    expect(lineGroupsOf(strokes)).toEqual([{ id: "ph_1", strokeIds: strokes.map((s) => s.id) }]);
  });

  it("the pen's own ink, and several groups at once", () => {
    const pen = [{ id: "shape:pen" as TLShapeId, meta: {} }];
    const a = group("ty_a", 2, { [TYPED_LATEX_META]: "1" });
    const b = group("ty_b", 3, { [TYPED_LATEX_META]: "2" });
    expect(lineGroupsOf([...pen, ...b, ...a]).map((g) => g.id).sort()).toEqual(["ty_a", "ty_b"]);
  });
});
