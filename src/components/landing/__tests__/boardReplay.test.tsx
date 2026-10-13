import { describe, expect, it } from "vitest";
import { pathBounds } from "@/lib/landing/replay";
import { HERO_BOARD } from "../BoardReplay";
import { halfInView, REPLAY_ID, REPLAY_START_SCRIPT } from "../replayStart";

const { SCREEN, CANVAS, CHROME, SCALE, CHEER_GAP, MISS_WIDTH, LEFT, TOP, lines } = HERO_BOARD;

/** Everything the replay draws on the canvas, in canvas px: every stroke, and the ring's note beside it. */
function inkBox() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of lines) {
    for (const stroke of line.strokes) {
      const b = pathBounds(stroke.d);
      minX = Math.min(minX, LEFT + (line.x + b.minX) * SCALE);
      maxX = Math.max(maxX, LEFT + (line.x + b.maxX) * SCALE);
      minY = Math.min(minY, TOP + (line.y + b.minY) * SCALE);
      maxY = Math.max(maxY, TOP + (line.y + b.maxY) * SCALE);
    }
    if (line.mark === "ring") maxX = Math.max(maxX, LEFT + (line.x + line.width + CHEER_GAP) * SCALE + MISS_WIDTH);
  }
  return { minX, minY, maxX, maxY };
}

describe("the hero's board", () => {
  it("draws on the board's white screen, between its top bar and its dock", () => {
    expect(CANVAS.left).toBeGreaterThanOrEqual(0);
    expect(CANVAS.left + CANVAS.width).toBeLessThanOrEqual(SCREEN.width);
    expect(CANVAS.top).toBeGreaterThan(CHROME.barBottom);
    expect(CANVAS.top + CANVAS.height).toBeLessThan(CHROME.dockTop);
  });

  it("writes inside the canvas with room to spare, the block centred on it", () => {
    const box = inkBox();
    const margin = 48;
    expect(box.minX).toBeGreaterThan(margin);
    expect(box.minY).toBeGreaterThan(margin);
    expect(box.maxX).toBeLessThan(CANVAS.width - margin);
    expect(box.maxY).toBeLessThan(CANVAS.height - margin);
    // as much room above the writing as below it, and either side of the writing and its note
    expect(Math.abs(box.minY - (CANVAS.height - box.maxY))).toBeLessThan(4);
    expect(Math.abs(box.minX - (CANVAS.width - box.maxX))).toBeLessThan(80);
  });

  it("writes at a child's size: each line well over 40 px tall on the 820 px board", () => {
    for (const line of lines) expect(line.height * SCALE).toBeGreaterThan(40);
  });
});

/** Runs the inline hold script against a stand-in page; returns the observer's callback and the hold. */
function runStartScript() {
  let report: ((entries: unknown[]) => void) | null = null;
  const hold = { id: "", textContent: "", removed: false, remove() {
    this.removed = true;
  } };
  const head: unknown[] = [];
  const document = {
    getElementById: (id: string) => (id === REPLAY_ID ? {} : null),
    createElement: () => hold,
    head: { appendChild: (el: unknown) => head.push(el) },
  };
  class IntersectionObserver {
    constructor(cb: (entries: unknown[]) => void) {
      report = cb;
    }
    observe() {}
    disconnect() {}
  }
  const window = { IntersectionObserver };
  new Function("window", "document", "IntersectionObserver", REPLAY_START_SCRIPT)(window, document, IntersectionObserver);
  const entry = (height: number, visible: number) => ({ boundingClientRect: { height }, intersectionRect: { height: visible } });
  return { hold, head, report: (height: number, visible: number) => report?.([entry(height, visible)]) };
}

describe("the replay's hold", () => {
  it("holds the replay until half the iPad is in view", () => {
    const page = runStartScript();
    expect(page.head).toEqual([page.hold]);
    page.report(706, 260);
    expect(page.hold.removed).toBe(false);
    page.report(706, 353);
    expect(page.hold.removed).toBe(true);
  });

  it("keeps holding while the iPad has no height yet (its stylesheet still loading)", () => {
    const page = runStartScript();
    page.report(0, 0);
    expect(page.hold.removed).toBe(false);
    page.report(746, 259);
    expect(page.hold.removed).toBe(false);
  });

  it("halfInView: half the height in view, never a box with no height", () => {
    const at = (height: number, visible: number) => halfInView({ boundingClientRect: { height } as DOMRectReadOnly, intersectionRect: { height: visible } as DOMRectReadOnly });
    expect(at(0, 0)).toBe(false);
    expect(at(400, 199)).toBe(false);
    expect(at(400, 200)).toBe(true);
  });
});
