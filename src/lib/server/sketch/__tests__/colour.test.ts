import { describe, expect, it } from "vitest";
import { ALL_INKS, INK_HEX, nearestInk, parsePaint, type Paint } from "../colour";

const ink = (v: string) => {
  const p = parsePaint(v) as Paint;
  if (p.kind !== "colour") throw new Error(`${v}: ${p.kind}`);
  return nearestInk(p.rgb);
};

describe("colours → the board's inks", () => {
  it("every ink's own colour is itself", () => {
    for (const k of ALL_INKS) expect(ink(INK_HEX[k]), k).toBe(k);
  });

  it("NEVER red: every red is orange, a pale red (pink) is violet", () => {
    for (const red of ["red", "#e03131", "#f00", "crimson", "darkred", "maroon", "tomato", "firebrick", "rgb(255, 0, 0)", "hsl(0, 100%, 50%)", "#c0392b"]) expect(ink(red), red).toBe("orange");
    for (const pink of ["pink", "lightpink", "hotpink", "#ffc0cb", "deeppink"]) expect(ink(pink), pink).toBe("violet");
  });

  it("colours by hue, as a person picks a marker", () => {
    const cases: Array<[string, string]> = [
      ["navy", "blue"], ["royalblue", "blue"], ["#1e3a8a", "blue"], ["skyblue", "light-blue"], ["lightblue", "light-blue"], ["cyan", "light-blue"],
      ["turquoise", "light-blue"], ["forestgreen", "green"], ["lime", "green"], ["#22c55e", "green"], ["olive", "yellow"], ["gold", "yellow"],
      ["yellow", "yellow"], ["orange", "yellow"], ["tan", "yellow"], ["brown", "orange"], ["saddlebrown", "orange"], ["chocolate", "orange"],
      ["darkorange", "orange"], ["purple", "violet"], ["indigo", "violet"], ["magenta", "violet"], ["orchid", "violet"],
    ];
    for (const [c, want] of cases) expect(ink(c), c).toBe(want);
  });

  it("black, grey and white by lightness: white is its own answer (the caller drops it)", () => {
    for (const c of ["black", "#000", "#333", "#1d1d1d", "darkslategray"]) expect(ink(c), c).toBe("black");
    for (const c of ["gray", "grey", "#999", "silver", "slategray", "lightgray"]) expect(ink(c), c).toBe("grey");
    for (const c of ["white", "#fff", "#fefefe", "snow", "ivory"]) expect(ink(c), c).toBe("white");
  });

  it("paints: none, currentColor, a gradient (with or without its fallback), alpha, junk", () => {
    expect(parsePaint("none")).toEqual({ kind: "none" });
    expect(parsePaint("transparent")).toEqual({ kind: "none" });
    expect(parsePaint("currentColor")).toEqual({ kind: "current" });
    expect(parsePaint("url(#grad)")).toEqual({ kind: "unknown" });
    expect(parsePaint("url(#grad) #0000ff")).toMatchObject({ kind: "colour", rgb: { r: 0, g: 0, b: 255 } });
    expect(parsePaint("#0000ff80")).toMatchObject({ kind: "colour", alpha: 128 / 255 });
    expect(parsePaint("rgba(0, 0, 0, 0.5)")).toMatchObject({ kind: "colour", alpha: 0.5 });
    expect(parsePaint("rgb(100% 0% 0% / 25%)")).toMatchObject({ kind: "colour", rgb: { r: 255, g: 0, b: 0 }, alpha: 0.25 });
    expect(parsePaint("#zzzzzz")).toEqual({ kind: "unknown" });
    expect(parsePaint("sparkly")).toEqual({ kind: "unknown" });
    expect(parsePaint("inherit")).toBeNull();
    expect(parsePaint(undefined)).toBeNull();
    expect(parsePaint("x".repeat(100_000))).toEqual({ kind: "unknown" });
  });
});
