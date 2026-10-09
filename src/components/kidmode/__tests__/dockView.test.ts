import { describe, expect, it } from "vitest";
import { TUTOR_INK_COLOR } from "@/lib/live/answer";
import { KID_COPY } from "../copy";
import { hitMarginFor, isKidColor, KID_COLORS, kidDockView, LITTLE_HANDS, penSizeOnClose, penSizeOnOpen, type KidDockState } from "../dockView";

/** What the simple board's dock shows a young kid, and the little-hands rules behind it. */

function dock(partial: Partial<KidDockState> = {}) {
  return kidDockView({ narrow: false, tool: "draw", color: "black", canUndo: false, page: 1, pages: 1, maxPages: 50, ...partial });
}

describe("kidDockView", () => {
  it("shows which of Pen and Eraser is in hand, and neither for a grown-up's tool", () => {
    expect(dock({ tool: "draw" })).toMatchObject({ pen: true, eraser: false });
    expect(dock({ tool: "eraser" })).toMatchObject({ pen: false, eraser: true });
    expect(dock({ tool: "select" })).toMatchObject({ pen: false, eraser: false });
  });

  it("greys Undo out with nothing to undo", () => {
    expect(dock().undo).toBe(false);
    expect(dock({ canUndo: true }).undo).toBe(true);
  });

  it("lays the colours out as big swatches, folded into one Colour button on a phone", () => {
    expect(dock().colours).toEqual({ layout: "row", current: "black" });
    expect(dock({ narrow: true }).colours.layout).toBe("button");
    // a colour picked on the grown-up board that the dock does not offer: none shows as picked
    expect(dock({ color: "light-blue" }).colours.current).toBe(null);
  });

  it("offers a few colours, never the tutor's blue", () => {
    expect(KID_COLORS.length).toBeGreaterThanOrEqual(3);
    expect(KID_COLORS.length).toBeLessThanOrEqual(5);
    expect(isKidColor(TUTOR_INK_COLOR)).toBe(false);
    expect(KID_COLORS).not.toContain("light-blue");
    for (const c of KID_COLORS) expect(KID_COPY.colourName[c]).toMatch(/^[A-Z][a-z]+$/);
  });

  it("shows ‹ n / N › only once there is a page to go back to, and New page always", () => {
    expect(dock().pages).toEqual({ arrows: false, label: null, canPrev: false, canNext: false, canAdd: true });
    expect(dock({ page: 2, pages: 3 }).pages).toEqual({ arrows: true, label: "2 / 3", canPrev: true, canNext: true, canAdd: true });
    expect(dock({ page: 1, pages: 2 }).pages).toMatchObject({ canPrev: false, canNext: true });
    expect(dock({ page: 2, pages: 2 }).pages).toMatchObject({ canPrev: true, canNext: false });
  });

  it("greys New page out on a full board", () => {
    expect(dock({ page: 50, pages: 50 }).pages.canAdd).toBe(false);
  });

  it("names everything in one short word a 6-year-old reads", () => {
    for (const word of [KID_COPY.pen, KID_COPY.eraser, KID_COPY.undo, KID_COPY.colour]) expect(word).toMatch(/^[A-Z][a-z]{1,7}$/);
    expect(KID_COPY.newPage).toBe("New page");
  });
});

describe("little hands", () => {
  it("thickens only tldraw's default pen, and puts back only what it thickened", () => {
    expect(penSizeOnOpen("m")).toBe(LITTLE_HANDS.pen);
    // a size someone picked on purpose is theirs
    expect(penSizeOnOpen("s")).toBe(null);
    expect(penSizeOnOpen("xl")).toBe(null);
    expect(penSizeOnOpen("l")).toBe(null);
    expect(penSizeOnClose("l", true)).toBe("m");
    expect(penSizeOnClose("l", false)).toBe(null);
    // picked again meanwhile (the grown-up's style panel): left alone
    expect(penSizeOnClose("xl", true)).toBe(null);
  });

  it("is a size thicker, not a marker: tldraw's l over m", () => {
    expect(LITTLE_HANDS).toMatchObject({ pen: "l", grownUpPen: "m" });
  });

  it("widens the eraser's reach only while the eraser is in hand", () => {
    expect(hitMarginFor("eraser", 8)).toBe(LITTLE_HANDS.eraserReach);
    expect(LITTLE_HANDS.eraserReach).toBeGreaterThan(8);
    for (const tool of ["draw", "select", "hand", "math"]) expect(hitMarginFor(tool, 8)).toBe(8);
    // never narrower than tldraw's own
    expect(hitMarginFor("eraser", 24)).toBe(24);
  });
});
