import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Editor, TLUiToolsContextType } from "tldraw";
import { MathShapeTool, liveTools, liveUiOverrides } from "..";

const tool = (id: string, kbd?: string) => ({ id, label: id, icon: id, kbd, onSelect: () => {} }) as unknown as TLUiToolsContextType[string];

describe("the old Math tool and Type it are gone from the board: everything is written", () => {
  it("Live's overrides offer no math tool, so no toolbar button and no `m` shortcut", () => {
    const tools = { draw: tool("draw", "d,b,x"), math: tool("math", "m") } as TLUiToolsContextType;
    const out = liveUiOverrides.tools!({} as Editor, tools, {} as never);
    expect(Object.keys(out)).toEqual(["draw"]);
    expect(Object.values(out).some((t) => t.kbd?.split(",").includes("m"))).toBe(false);
  });

  it("the toolbar has no Math item and no Type button (Type it was taken off, 2026-10-13)", () => {
    const src = readFileSync(join(__dirname, "..", "LiveToolbar.tsx"), "utf8");
    expect(src).not.toMatch(/tools\.math|"math"/);
    expect(src).not.toMatch(/id="type"|typeBar|Keyboard/);
  });

  it("the math shape's tool stays registered, so a board left in it still loads", () => {
    expect(liveTools).toContain(MathShapeTool);
  });

});
