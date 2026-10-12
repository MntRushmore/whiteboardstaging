import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Editor, TLUiToolsContextType } from "tldraw";
import { MathShapeTool, liveTools, liveUiOverrides } from "..";

const tool = (id: string, kbd?: string) => ({ id, label: id, icon: id, kbd, onSelect: () => {} }) as unknown as TLUiToolsContextType[string];

describe("the old Math tool is gone from the board (Type it replaces it)", () => {
  it("Live's overrides offer no math tool, so no toolbar button and no `m` shortcut", () => {
    const tools = { draw: tool("draw", "d,b,x"), math: tool("math", "m") } as TLUiToolsContextType;
    const out = liveUiOverrides.tools!({} as Editor, tools, {} as never);
    expect(Object.keys(out)).toEqual(["draw"]);
    expect(Object.values(out).some((t) => t.kbd?.split(",").includes("m"))).toBe(false);
  });

  it("the toolbar has no Math item, and has the Type button first (never in a phone's overflow)", () => {
    const src = readFileSync(join(__dirname, "..", "LiveToolbar.tsx"), "utf8");
    expect(src).not.toMatch(/tools\.math|"math"/);
    expect(src.indexOf('id="type"')).toBeGreaterThan(0);
    expect(src.indexOf('id="type"')).toBeLessThan(src.indexOf("<DefaultToolbarContent />"));
  });

  it("the math shape's tool stays registered, so a board left in it still loads", () => {
    expect(liveTools).toContain(MathShapeTool);
  });
});
