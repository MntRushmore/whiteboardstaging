import { describe, expect, it } from "vitest";
import { LANDING_COPY } from "@/components/landing/copy";
import { MODEL_BOXES, sketchModel } from "@/lib/live/chat/models";
import { MODEL_PACE } from "@/lib/live/chat/models/kit";
import { ASK_MODEL, askSheets, askTimeline, BOARD_INKS, drawModel, streamReply, thin } from "../askDemo";

const answer = LANDING_COPY.ask.answer;

describe("the drawing", () => {
  it("is the board's own fraction bars: a half and a third, each bar shaded once, labelled ½ and ⅓", () => {
    for (const box of MODEL_BOXES.fraction_bars) {
      const drawing = drawModel(ASK_MODEL, box);
      const plan = sketchModel(ASK_MODEL, box, 7)!.plan;
      // every stroke of the planner's, nothing added
      expect(drawing.paths).toHaveLength(plan.lines.reduce((n, l) => n + l.strokes.length, 0));
      expect(drawing.labels).toEqual(["\\frac{1}{2}", "\\frac{1}{3}"]);
      const fills = drawing.paths.filter((p) => p.fill);
      expect(fills.map((p) => p.fill)).toEqual([BOARD_INKS.orange.tint, BOARD_INKS.green.tint]);
      // the lines are the tutor's blue; a fill's edge is its own colour, finer
      for (const p of drawing.paths.filter((x) => !x.fill)) expect(p.stroke).toBe(BOARD_INKS.blue.ink);
      for (const p of fills) expect(p.width).toBeLessThan(drawing.paths[0].width);
      expect(drawing.width).toBeLessThanOrEqual(box.w);
      expect(drawing.height).toBeLessThanOrEqual(box.h);
    }
  });

  it("is drawn stroke after stroke, at the board's pace", () => {
    const drawing = drawModel(ASK_MODEL, MODEL_BOXES.fraction_bars[1]);
    for (let i = 1; i < drawing.paths.length; i++) {
      expect(drawing.paths[i].atMs).toBeGreaterThanOrEqual(drawing.paths[i - 1].atMs + drawing.paths[i - 1].forMs);
    }
    expect(drawing.durationMs).toBeGreaterThan(2500);
    expect(drawing.durationMs).toBeLessThanOrEqual(MODEL_PACE.maxWallMs);
  });

  it("thins a stroke to the points that matter, keeping its ends and any bend past the tolerance", () => {
    const straight = Array.from({ length: 50 }, (_, i) => ({ x: i * 4, y: (i % 2) * 0.2 }));
    expect(thin(straight)).toEqual([straight[0], straight[49]]);
    const corner = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 20, y: 20 }];
    expect(thin(corner)).toEqual([corner[0], corner[2], corner[4]]);
  });

  it("refuses a model the board would not draw", () => {
    expect(() => drawModel({ kind: "fraction_bars", bars: [{ parts: 24, shaded: 1 }] }, { w: 200, h: 100 })).toThrow(/draws nothing/);
  });
});

describe("the board", () => {
  const sheets = askSheets();

  it("keeps everything on the screen and nothing on top of anything else", () => {
    for (const sheet of [sheets.wide, sheets.narrow]) {
      const boxes = [
        ...sheet.problems.map((p) => ({ x: p.x, y: p.y, w: p.width, h: p.height })),
        { x: sheet.at.x, y: sheet.at.y, w: sheet.drawing.width, h: sheet.drawing.height },
      ];
      for (const b of boxes) {
        expect(b.x).toBeGreaterThan(0);
        expect(b.y).toBeGreaterThan(0);
        expect(b.x + b.w).toBeLessThan(sheet.width);
        expect(b.y + b.h).toBeLessThan(sheet.height);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i], boxes[j]];
          const apart = a.x + a.w + 24 <= b.x || b.x + b.w + 24 <= a.x || a.y + a.h + 24 <= b.y || b.y + b.h + 24 <= a.y;
          expect(apart, `${i} and ${j}`).toBe(true);
        }
      }
      expect(sheet.drawingBottom).toBeCloseTo(sheet.at.y + sheet.drawing.height, 0);
    }
  });

  it("puts the drawing with problem 1: beside it on a wide board (room for its answer), under it on a narrow one", () => {
    const one = sheets.wide.problems[0];
    expect(sheets.wide.at.x).toBeGreaterThanOrEqual(one.x + one.width + 96);
    expect(sheets.wide.at.y).toBeLessThan(one.y + one.height);
    const narrowOne = sheets.narrow.problems[0];
    expect(sheets.narrow.at.y).toBeGreaterThan(narrowOne.y + narrowOne.height);
    expect(sheets.wide.problems[0].latex).toMatch(/^1\.\\;\\;\\frac\{1\}\{2\}\\bigcirc\\frac\{1\}\{3\}$/);
  });
});

describe("the reply", () => {
  it("streams every word of the answer, in order, with its two formulas whole", () => {
    const stream = streamReply(answer, 1000);
    const tokens = stream.paragraphs.flat();
    const back = tokens.map((t) => (t.kind === "text" ? t.text : `$${t.src}$${t.tail}`)).join("");
    expect(back.replace(/\s+/g, " ").trim()).toBe(answer.replace(/\s+/g, " ").trim());
    expect(tokens.filter((t) => t.kind === "math").map((t) => t.kind === "math" && t.src)).toEqual(["\\frac{1}{2}", "\\frac{1}{3}"]);
    // the full stop after ⅓ stays on its line
    expect(tokens.find((t) => t.kind === "math" && t.src === "\\frac{1}{3}")).toMatchObject({ tail: "." });
    for (let i = 1; i < tokens.length; i++) expect(tokens[i].atMs).toBeGreaterThan(tokens[i - 1].atMs);
    expect(tokens[0].atMs).toBe(1000);
    expect(stream.firstSentenceMs).toBe(tokens[1].atMs);
  });

  it("is the same stream every time", () => {
    expect(streamReply(answer, 0)).toEqual(streamReply(answer, 0));
  });
});

describe("the timeline", () => {
  it("plays the exchange in the panel's order, something new every second or two, in under 20 s", () => {
    const t = askTimeline(answer, 4200);
    const order = [t.micDownMs, t.micUpMs, t.sentMs, t.thinkingMs, t.streamMs, t.streamEndMs, t.drawMs, t.drawEndMs, t.doneMs];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    for (let i = 1; i < order.length; i++) expect(order[i] - order[i - 1]).toBeLessThan(6000);
    expect(t.drawEndMs - t.drawMs).toBe(4200);
    expect(t.doneMs).toBeLessThan(20000);
    expect(t.speakFromMs).toBeGreaterThan(t.streamMs);
    expect(t.speakToMs).toBe(t.doneMs);
  });
});
