import { describe, expect, it } from "vitest";
import type { LiveLineState } from "@/lib/live/contracts";
import type { LiveError } from "@/lib/live/liveStore";
import {
  CARD_EST_H,
  EDGE,
  cardWidth,
  errorCardAnchor,
  lineAnchor,
  onScreen,
  placeCard,
  type AnchorEditor,
  type CardArea,
  type CardPlacement,
} from "../hintPlacement";

/**
 * Where the hint and error cards go, at the two sizes students use most: a phone held upright
 * (390 x 844), whose top bar wraps to three rows (help tabs / Solve it + Ask / pill + ink + bug),
 * and an iPad (1180 x 820), whose bar is one row. The bar is z 1000 and the cards z 900, so a
 * card under the bar cannot be read or tapped; tldraw's toolbar sits along the bottom.
 */

/** bar: 16 px from the top, three rows of 36 px with 6 px gaps -> its bottom at 136 */
const PHONE: CardArea = { width: 390, height: 844, top: 136, bottom: 64 };
/** bar: one row, 16 + 40 */
const IPAD: CardArea = { width: 1180, height: 820, top: 56, bottom: 64 };

function bottomOf(p: CardPlacement): number {
  return p.top + CARD_EST_H;
}

function overlaps(a: CardPlacement, b: CardPlacement): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < bottomOf(b) && b.top < bottomOf(a);
}

describe("placeCard", () => {
  it("a card with no line to sit by goes just under the bar, not 72 px down where the phone's bar still is", () => {
    const width = cardWidth(PHONE.width);
    expect(width).toBe(280);
    const p = placeCard(null, PHONE, { width });
    // the old fallback (screen.y + 72) put the card's top inside the bar's second row
    expect(p.top).toBeGreaterThanOrEqual(PHONE.top + EDGE);
    expect(p.left).toBeCloseTo((390 - 280) / 2);
    expect(bottomOf(p)).toBeLessThanOrEqual(PHONE.height - PHONE.bottom);

    const pad = placeCard(null, IPAD, { width: cardWidth(IPAD.width) });
    expect(pad.top).toBe(IPAD.top + EDGE);
    expect(pad.left).toBeCloseTo((1180 - 280) / 2);
  });

  it("below its line, inside the screen's sides", () => {
    const line = { x: 40, y: 300, w: 220, h: 48 };
    const p = placeCard(line, PHONE, { width: 280 });
    expect(p.top).toBe(line.y + line.h + 8);
    expect(p.left).toBe(40);

    // a line near the right edge of the iPad: the card is pulled in, whole
    const right = placeCard({ x: 1050, y: 300, w: 100, h: 48 }, IPAD, { width: 280 });
    expect(right.left + right.width).toBeLessThanOrEqual(IPAD.width - EDGE);
    expect(right.top).toBe(356);
  });

  it("a line written under the bar (zoomed in, or high on the screen) still gets its card below the bar", () => {
    const p = placeCard({ x: 20, y: 40, w: 200, h: 40 }, PHONE, { width: 280 });
    expect(p.top).toBeGreaterThanOrEqual(PHONE.top + EDGE);
    const pad = placeCard({ x: 20, y: -200, w: 200, h: 40 }, IPAD, { width: 280 });
    expect(pad.top).toBeGreaterThanOrEqual(IPAD.top + EDGE);
  });

  it("a line just above the bottom toolbar gets its card above it, clear of the toolbar and the bar", () => {
    const line = { x: 40, y: 700, w: 220, h: 48 };
    const p = placeCard(line, PHONE, { width: 280 });
    expect(bottomOf(p)).toBeLessThanOrEqual(line.y);
    expect(bottomOf(p)).toBeLessThanOrEqual(PHONE.height - PHONE.bottom);
    expect(p.top).toBeGreaterThanOrEqual(PHONE.top + EDGE);

    const pad = placeCard({ x: 600, y: 690, w: 300, h: 50 }, IPAD, { width: 280 });
    expect(bottomOf(pad)).toBeLessThanOrEqual(690);
    expect(bottomOf(pad)).toBeLessThanOrEqual(IPAD.height - IPAD.bottom);
  });

  it("never under the bar, even when the free area is shorter than a card (a phone held sideways)", () => {
    const sideways: CardArea = { width: 844, height: 300, top: 120, bottom: 64 };
    for (const y of [-50, 0, 100, 150, 250, 400]) {
      const p = placeCard({ x: 10, y, w: 100, h: 40 }, sideways, { width: 280 });
      expect(p.top).toBeGreaterThanOrEqual(sideways.top + EDGE);
    }
    expect(placeCard(null, sideways, { width: 280 }).top).toBe(sideways.top + EDGE);
  });

  it("two cards on one line (a hint, then the error of the More help after it) do not cover each other", () => {
    const line = { x: 40, y: 300, w: 220, h: 48 };
    for (const area of [PHONE, IPAD]) {
      const first = placeCard(line, area, { width: 280, stack: 0 });
      const second = placeCard(line, area, { width: 280, stack: 1 });
      expect(overlaps(first, second)).toBe(false);
      const low = { ...line, y: 640 };
      expect(overlaps(placeCard(low, area, { width: 280, stack: 0 }), placeCard(low, area, { width: 280, stack: 1 }))).toBe(false);
    }
  });

  it("cardWidth fits a narrow screen and caps on a wide one", () => {
    expect(cardWidth(1180)).toBe(280);
    expect(cardWidth(200)).toBe(184);
    expect(cardWidth(100)).toBe(160);
  });
});

// ---------------------------------------------------------------- which errors get a card

/** An editor at camera (0, 0, zoom 1) whose container starts at (0, 50) on the page. */
function fakeEditor(view: { width: number; height: number }, shapes: Record<string, { x: number; y: number; w: number; h: number }> = {}): AnchorEditor {
  const screen = { x: 0, y: 50, w: view.width, h: view.height, width: view.width, height: view.height };
  return {
    getViewportScreenBounds: () => screen,
    pageToScreen: (p: { x: number; y: number }) => ({ x: p.x + screen.x, y: p.y + screen.y }),
    getShapePageBounds: (id: unknown) => {
      const b = shapes[String(id)];
      return b ? { ...b, maxX: b.x + b.w, maxY: b.y + b.h } : undefined;
    },
  } as unknown as AnchorEditor;
}

function lineState(id: string, bounds: { x: number; y: number; w: number; h: number }, mathShapeId: string | null = null): LiveLineState {
  return {
    line: { id, strokeIds: [], bounds, column: 0, row: 0, hash: "h" },
    latex: "x=5",
    confidence: 1,
    provider: "mathpix",
    analysis: null,
    mathShapeId: mathShapeId as LiveLineState["mathShapeId"],
    graphShapeId: null,
    hintsShown: 0,
    rewritesWithWarn: 0,
    edited: false,
    updatedAt: 0,
  };
}

function solveError(lineId: string, partial: Partial<LiveError> = {}): LiveError {
  return { id: "e1", kind: "solve", code: "upstream", message: "The tutor service had a hiccup", lineId, userAsked: true, at: 0, ...partial };
}

describe("errorCardAnchor: one error, one place", () => {
  const editor = fakeEditor({ width: 390, height: 844 }, { "shape:echo": { x: 40, y: 360, w: 120, h: 30 } });
  const lines = { L1: lineState("L1", { x: 40, y: 300, w: 220, h: 48 }, "shape:echo") };

  it("a Solve error on a line on the screen sits by that line (the ink and its readback)", () => {
    expect(errorCardAnchor(editor, solveError("L1"), lines)).toEqual({ x: 40, y: 300, w: 220, h: 90 });
    expect(lineAnchor(editor, lines.L1)).toEqual({ x: 40, y: 300, w: 220, h: 90 });
  });

  it("a Solve on a drawing fails with the drawing's id: no line, so the pill has it (not a card parked under the bar)", () => {
    expect(errorCardAnchor(editor, solveError("diagram_7"), lines)).toBeNull();
  });

  it("a line scrolled off the screen (zoomed in) leaves the error to the pill", () => {
    const far = { L2: lineState("L2", { x: 40, y: 2000, w: 220, h: 48 }) };
    expect(errorCardAnchor(editor, solveError("L2"), far)).toBeNull();
    expect(onScreen({ x: 40, y: 2000, w: 220, h: 48 }, { width: 390, height: 844 })).toBe(false);
  });

  it("errors that are not the student's ask, or whose way out is in the bar, never get a card", () => {
    expect(errorCardAnchor(editor, null, lines)).toBeNull();
    expect(errorCardAnchor(editor, solveError("L1", { kind: "recognize", userAsked: undefined }), lines)).toBeNull();
    expect(errorCardAnchor(editor, solveError("L1", { userAsked: false }), lines)).toBeNull();
    expect(errorCardAnchor(editor, solveError("L1", { code: "ink" }), lines)).toBeNull();
    expect(errorCardAnchor(editor, solveError("L1", { code: "unauthorized" }), lines)).toBeNull();
    expect(errorCardAnchor(editor, solveError("L1", { kind: "check", code: "timeout" }), lines)).not.toBeNull();
  });
});
