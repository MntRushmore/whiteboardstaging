import { describe, expect, it } from "vitest";
import { TUTOR_INK_COLOR } from "@/lib/live/answer";
import { CHAT_BUTTON_COPY } from "@/components/chat/askButton";
import {
  DOCK_COPY,
  DOCK_SIZE,
  dockFit,
  dockRowWidth,
  dockStackWidth,
  hitMarginFor,
  isKidColor,
  KID_COLORS,
  KID_SHAPES,
  kidDockView,
  LITTLE_HANDS,
  penSizeOnClose,
  penSizeOnOpen,
  shapeInHand,
  shapeTool,
  type KidDockState,
} from "../dockView";

/** What the simple board's dock shows, how much of it fits one row, and the little-hands rules behind it. */

function dock(partial: Partial<KidDockState> = {}) {
  return kidDockView({ width: 1440, tool: "draw", geo: "rectangle", color: "black", canUndo: false, canRedo: false, type: true, page: 1, pages: 1, maxPages: 50, ...partial });
}

/** The boards the dock is drawn on: a laptop, an iPad either way, an iPad beside the Ask panel, a phone. */
const BOARDS = { laptop: 1440, laptopWithAsk: 1080, ipadLandscape: 1180, ipadPortrait: 820, ipadWithAsk: 820, phone: 390, smallPhone: 375 } as const;

describe("how much of the dock fits (dockFit)", () => {
  it("everything in one row on a laptop and an iPad on its side, with Ask docked beside a laptop's board too", () => {
    for (const width of [BOARDS.laptop, BOARDS.laptopWithAsk, BOARDS.ipadLandscape]) {
      expect(dock({ width, pages: 3, page: 3 }).fit).toBe("row");
      expect(dock({ width, pages: 3, page: 3 }).colours.layout).toBe("row");
    }
  });

  it("an upright iPad (or one beside the Ask panel): one row, Shapes, Picture and Redo behind More", () => {
    const one = dock({ width: BOARDS.ipadPortrait });
    expect(one).toMatchObject({ fit: "fold", folded: true, stack: false });
    // one page: the colours still fit as swatches
    expect(one.colours.layout).toBe("row");
    // three pages (‹ 3 / 3 ›): the colours go behind Color rather than the row wrapping
    expect(dock({ width: BOARDS.ipadWithAsk, pages: 3, page: 2 }).colours.layout).toBe("button");
    expect(dock({ width: BOARDS.ipadWithAsk, pages: 3, page: 2 }).fit).toBe("fold");
  });

  it("a phone: two rows in one dock, the less-used tools behind More and the colours behind Color", () => {
    for (const pages of [1, 3]) {
      const v = dock({ width: BOARDS.phone, pages, page: 1 });
      expect(v).toMatchObject({ fit: "stack", stack: true, folded: true });
      expect(v.colours.layout).toBe("button");
    }
  });

  it("never draws a row wider than the board: the chosen layout always fits, from a small phone up", () => {
    for (let width = 340; width <= 1600; width += 10) {
      for (const type of [true, false]) {
        for (const arrows of [true, false]) {
          const { fit, colourButton, typeInMore } = dockFit(width, { type, arrows });
          const room = width - 2 * DOCK_SIZE.margin;
          const used = fit === "stack" ? dockStackWidth({ type, arrows }, typeInMore) : dockRowWidth({ type, arrows }, { fold: fit === "fold", colourButton });
          expect(used, `${width}px, type ${type}, arrows ${arrows}: ${fit}`).toBeLessThanOrEqual(room);
        }
      }
    }
  });

  it("a phone under the Ask sheet: the tools alone, the pages and Ask's row folded away (the sheet is Ask)", () => {
    expect(dock({ width: BOARDS.phone }).askRow).toBe(true);
    expect(dock({ width: BOARDS.phone, chatOpen: true })).toMatchObject({ stack: true, askRow: false });
    // one row everywhere else: nothing to fold
    expect(dock({ width: BOARDS.laptop, chatOpen: true }).askRow).toBe(false);
  });

  it("at 390 px the phone's widest row (Select, Pen, Eraser, Type, Color | Undo, More) fits, Type and all", () => {
    expect(dockStackWidth({ type: true, arrows: true })).toBeLessThanOrEqual(BOARDS.phone - 2 * DOCK_SIZE.margin - 8);
    expect(dock({ width: BOARDS.phone }).typeInMore).toBe(false);
    // a phone narrower than most: Type goes behind More too, rather than the row running off the dock
    expect(dock({ width: 360 })).toMatchObject({ fit: "stack", typeInMore: true });
    expect(dock({ width: 360, type: false }).typeInMore).toBe(false);
  });

  it("folds only as much as it must: a wider board never shows less", () => {
    const rank = { row: 0, fold: 1, stack: 2 } as const;
    let last = 3;
    for (let width = 320; width <= 1600; width += 5) {
      const { fit } = dockFit(width, { type: true, arrows: true });
      expect(rank[fit]).toBeLessThanOrEqual(last);
      last = rank[fit];
    }
  });

  it("matches the dock as drawn: 947 px for a laptop's row with Type and three pages (measured, QA 2026-10-12)", () => {
    expect(dockRowWidth({ type: true, arrows: true }, { fold: false, colourButton: false })).toBe(947);
    expect(dockRowWidth({ type: true, arrows: true }, { fold: true, colourButton: true })).toBe(713);
    expect(dockStackWidth({ type: true, arrows: true })).toBe(359);
  });
});

describe("kidDockView", () => {
  it("Ask is named as the board's own button names it, with a hint a kid understands", () => {
    expect(DOCK_COPY.ask).toBe(CHAT_BUTTON_COPY.button);
    expect(DOCK_COPY.askHint).toMatch(/tutor/i);
  });

  it("shows which tool is in hand: Select, Pen, Eraser, or Shapes for a line, an arrow, a box or a circle", () => {
    expect(dock({ tool: "draw" })).toMatchObject({ select: false, pen: true, eraser: false, shapes: { pressed: false } });
    expect(dock({ tool: "eraser" })).toMatchObject({ pen: false, eraser: true });
    expect(dock({ tool: "select" })).toMatchObject({ select: true, pen: false, eraser: false });
    expect(dock({ tool: "line" }).shapes).toEqual({ pressed: true, current: "line" });
    expect(dock({ tool: "arrow" }).shapes).toEqual({ pressed: true, current: "arrow" });
    expect(dock({ tool: "geo", geo: "rectangle" }).shapes).toEqual({ pressed: true, current: "rectangle" });
    expect(dock({ tool: "geo", geo: "ellipse" }).shapes).toEqual({ pressed: true, current: "ellipse" });
    // a geo shape picked on the classic board: Shapes is in hand, none of its four is
    expect(dock({ tool: "geo", geo: "triangle" }).shapes).toEqual({ pressed: true, current: null });
    // a tool only the classic board offers: nothing shows as in hand
    expect(dock({ tool: "note" })).toMatchObject({ select: false, pen: false, eraser: false, shapes: { pressed: false } });
  });

  it("greys Undo and Redo out with nothing to undo or redo", () => {
    expect(dock()).toMatchObject({ undo: false, redo: false });
    expect(dock({ canUndo: true, canRedo: true })).toMatchObject({ undo: true, redo: true });
  });

  it("offers Type only where the board can write a typed line", () => {
    expect(dock({ type: true }).type).toBe(true);
    expect(dock({ type: false }).type).toBe(false);
  });

  it("lays the colours out as big swatches where they fit; a colour the dock does not offer shows none as picked", () => {
    expect(dock().colours).toEqual({ layout: "row", current: "black" });
    expect(dock({ color: "light-blue" }).colours.current).toBe(null);
  });

  it("offers a few colours, never the tutor's blue", () => {
    expect(KID_COLORS.length).toBeGreaterThanOrEqual(3);
    expect(KID_COLORS.length).toBeLessThanOrEqual(5);
    expect(isKidColor(TUTOR_INK_COLOR)).toBe(false);
    expect(KID_COLORS).not.toContain("light-blue");
    for (const c of KID_COLORS) expect(DOCK_COPY.colourName[c]).toMatch(/^[A-Z][a-z]+$/);
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

  it("names everything in one short word a 6-year-old reads, in US English", () => {
    for (const word of [DOCK_COPY.select, DOCK_COPY.pen, DOCK_COPY.eraser, DOCK_COPY.shapes, DOCK_COPY.picture, DOCK_COPY.undo, DOCK_COPY.redo, DOCK_COPY.more, DOCK_COPY.colour]) {
      expect(word).toMatch(/^[A-Z][a-z]{1,7}$/);
    }
    for (const s of KID_SHAPES) expect(DOCK_COPY.shapeName[s]).toMatch(/^[A-Z][a-z]{2,9}$/);
    expect([DOCK_COPY.colour, DOCK_COPY.colours]).toEqual(["Color", "Colors"]);
    expect(DOCK_COPY.newPage).toBe("New page");
  });
});

describe("shapes", () => {
  it("are tldraw's line and arrow tools, and its geo tool as a rectangle or an ellipse (a circle)", () => {
    expect(KID_SHAPES).toEqual(["line", "arrow", "rectangle", "ellipse"]);
    expect(shapeTool("line")).toEqual({ tool: "line" });
    expect(shapeTool("arrow")).toEqual({ tool: "arrow" });
    expect(shapeTool("rectangle")).toEqual({ tool: "geo", geo: "rectangle" });
    expect(shapeTool("ellipse")).toEqual({ tool: "geo", geo: "ellipse" });
    expect(DOCK_COPY.shapeName.ellipse).toBe("Circle");
  });

  it("knows the shape in hand back from the tool and the geo style", () => {
    for (const s of KID_SHAPES) {
      const { tool, geo } = shapeTool(s);
      expect(shapeInHand(tool, geo ?? "rectangle")).toBe(s);
    }
    expect(shapeInHand("draw", "rectangle")).toBe(null);
    expect(shapeInHand("geo", "star")).toBe(null);
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
    // picked again meanwhile (the classic board's style panel): left alone
    expect(penSizeOnClose("xl", true)).toBe(null);
  });

  it("is a size thicker, not a marker: tldraw's l over m", () => {
    expect(LITTLE_HANDS).toMatchObject({ pen: "l", grownUpPen: "m" });
  });

  it("widens the eraser's reach only while the eraser is in hand", () => {
    expect(hitMarginFor("eraser", 8)).toBe(LITTLE_HANDS.eraserReach);
    expect(LITTLE_HANDS.eraserReach).toBeGreaterThan(8);
    for (const tool of ["draw", "select", "hand", "math", "geo", "line"]) expect(hitMarginFor(tool, 8)).toBe(8);
    // never narrower than tldraw's own
    expect(hitMarginFor("eraser", 24)).toBe(24);
  });
});
