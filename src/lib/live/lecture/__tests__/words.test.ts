import { describe, expect, it } from "vitest";
import { canWrite, fitWords, hyphenating, measureWords, normaliseWords, writeWords } from "../words";

const at = { x: 0, y: 0 };

function pointsOf(strokes: ReadonlyArray<{ points: ReadonlyArray<{ x: number; y: number; z: number }> }>) {
  return strokes.flatMap((s) => s.points);
}

describe("normaliseWords", () => {
  it("drops accents, and makes quotes and dashes the hand's own", () => {
    expect(normaliseWords("Café naïve São Paulo, Ångström")).toBe("Cafe naive Sao Paulo, Angstrom");
    expect(normaliseWords("“quoted” ‘single’ it’s")).toBe(`"quoted" 'single' it's`);
    expect(normaliseWords("1914–1918 — the war")).toBe("1914-1918 - the war");
  });

  it("maps or leaves out what the hand has no glyph for — never a box", () => {
    expect(normaliseWords("• a bullet * star")).toBe("a bullet star");
    expect(normaliseWords("Straße, ½ cup, 5 µm")).toBe("Strasse, 1/2 cup, 5 μm");
    expect(normaliseWords("snow ☃ and 中文")).toBe("snow and");
    expect(normaliseWords("20 ℃")).toBe("20 °C");
    expect(normaliseWords("  lots   of \t space ")).toBe("lots of space");
    expect(normaliseWords("☃☃")).toBe("");
  });

  it("writes everyday punctuation", () => {
    for (const ch of [".", ",", ":", ";", "'", '"', "(", ")", "-", "/", "%", "$", "?", "!", "°", "&", "#", "+", "=", "£", "€"]) {
      expect(canWrite(ch), ch).toBe(true);
      const w = writeWords(ch, at, "left", "top", 30, 1);
      expect(w, ch).not.toBeNull();
      expect(w!.strokes.length, ch).toBeGreaterThan(0);
    }
    for (const ch of "ABCXYZabcxyz0123456789") expect(canWrite(ch), ch).toBe(true);
  });

  it("writes a continued heading's `(cont.)`", () => {
    const w = writeWords("Photosynthesis (cont.)", at, "left", "top", 40, 3)!;
    expect(w.text).toBe("Photosynthesis (cont.)");
    // the brackets and the full stop are there: more strokes than the word alone
    const bare = writeWords("Photosynthesis cont", at, "left", "top", 40, 3)!;
    expect(w.strokes.length).toBeGreaterThanOrEqual(bare.strokes.length + 3);
  });
});

describe("measureWords / writeWords", () => {
  it("wraps to a width, at most so many lines, else gives up", () => {
    const one = measureWords("The water cycle", 28)!;
    expect(one.lines).toEqual(["The water cycle"]);
    const two = measureWords("The water cycle", 28, { maxWidth: one.w * 0.7, maxLines: 3 })!;
    expect(two.lines.length).toBe(2);
    expect(Math.max(...two.widths)).toBeLessThanOrEqual(one.w * 0.7 + 1e-6);
    expect(measureWords("The water cycle", 28, { maxWidth: one.w * 0.4, maxLines: 1 })).toBeNull();
    // a word wider than the width does not fit, whatever the lines
    expect(measureWords("Photosynthesis", 28, { maxWidth: 60, maxLines: 5 })).toBeNull();
  });

  it("balances lines when asked, fills them when not", () => {
    const text = "Nitrogen and oxygen make up most of the air";
    const full = measureWords(text, 26, { maxWidth: 360 })!;
    const even = measureWords(text, 26, { maxWidth: 360, balance: true })!;
    expect(even.lines.length).toBe(full.lines.length);
    expect(Math.max(...even.widths) - Math.min(...even.widths)).toBeLessThanOrEqual(Math.max(...full.widths) - Math.min(...full.widths));
  });

  it("breaks a long word after its own hyphen or slash", () => {
    const m = measureWords("Alpha-ketoglutarate", 24, { maxWidth: 150, maxLines: 3, balance: true })!;
    expect(m.lines).toEqual(["Alpha-", "ketoglutarate"]);
    expect(measureWords("Runoff/Infiltration", 24, { maxWidth: 150, maxLines: 3, balance: true })!.lines).toEqual(["Runoff/", "Infiltration"]);
    expect(measureWords("Runoff/Infiltration", 24, { maxWidth: 150, maxLines: 3 })!.lines).toEqual(["Runoff/", "Infiltration"]);
    // not when the whole word fits
    expect(measureWords("well-known fact", 24, { maxWidth: 400, balance: true })!.lines).toEqual(["well-known fact"]);
  });

  it("hyphenates a plain word only when asked, and only one too long for a line", () => {
    expect(measureWords("Photosynthesis", 24, { maxWidth: 100, maxLines: 3, balance: true })).toBeNull();
    const m = hyphenating(true, () => measureWords("Photosynthesis", 24, { maxWidth: 100, maxLines: 3, balance: true }))!;
    expect(m.lines).toEqual(["Photo-", "synthesis"]);
    expect(Math.max(...m.widths)).toBeLessThanOrEqual(100);
    // a word that fits a line of its own goes down whole
    expect(hyphenating(true, () => measureWords("Power struggles between rival generals", 22, { maxWidth: 130, maxLines: 4, balance: true }))!.lines.some((l) => l.endsWith("-"))).toBe(false);
    expect(measureWords("Photosynthesis", 24, { maxWidth: 100, maxLines: 3, balance: true })).toBeNull();
  });

  it("shrinks to fit, down to a minimum, then gives up", () => {
    const big = fitWords("Greenhouse gas emissions", { maxWidth: 300, maxLines: 1, maxSize: 36, minSize: 20 })!;
    expect(big.w).toBeLessThanOrEqual(300);
    expect(big.size).toBeLessThan(36);
    expect(fitWords("Greenhouse gas emissions", { maxWidth: 120, maxLines: 1, maxSize: 36, minSize: 20 })).toBeNull();
  });

  it("aligns the block by its anchor and keeps every stroke inside its rect", () => {
    for (const [align, valign] of [
      ["left", "top"],
      ["center", "middle"],
      ["right", "bottom"],
    ] as const) {
      const w = writeWords("Mitochondria make ATP", { x: 200, y: 100 }, align, valign, 30, 5, { maxWidth: 200 })!;
      const bx = align === "left" ? 200 : align === "center" ? 200 - w.box.w / 2 : 200 - w.box.w;
      const by = valign === "top" ? 100 : valign === "middle" ? 100 - w.box.h / 2 : 100 - w.box.h;
      expect(w.box.x).toBeCloseTo(bx, 6);
      expect(w.box.y).toBeCloseTo(by, 6);
      for (const p of pointsOf(w.strokes)) {
        expect(p.x).toBeGreaterThanOrEqual(w.rect.x - 1e-6);
        expect(p.x).toBeLessThanOrEqual(w.rect.x + w.rect.w + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(w.rect.y - 1e-6);
        expect(p.y).toBeLessThanOrEqual(w.rect.y + w.rect.h + 1e-6);
      }
      // the layout box holds the ink but for a hair of tremor
      expect(w.rect.w - w.box.w).toBeLessThan(3);
      expect(w.rect.h - w.box.h).toBeLessThan(3);
    }
  });

  it("is the same hand for the same seed, another for another", () => {
    const a = writeWords("Plate tectonics", at, "left", "top", 30, 42)!;
    const b = writeWords("Plate tectonics", at, "left", "top", 30, 42)!;
    const c = writeWords("Plate tectonics", at, "left", "top", 30, 43)!;
    expect(b.strokes).toEqual(a.strokes);
    expect(c.strokes).not.toEqual(a.strokes);
  });

  it("writes strokes the board can reveal: numbers, points close together, not too many", () => {
    const w = writeWords("Supercalifragilistic expialidocious 1234567890", at, "left", "top", 56, 9)!;
    for (const s of w.strokes) {
      expect(s.kind).toBe("glyph");
      expect(s.points.length).toBeLessThanOrEqual(400);
      for (let i = 1; i < s.points.length; i++) {
        const p = s.points[i];
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
        expect(Math.hypot(p.x - s.points[i - 1].x, p.y - s.points[i - 1].y)).toBeLessThanOrEqual(2.0001);
      }
    }
  });

  it("writes raised and lowered digits smaller (m², H₂O)", () => {
    const m2 = measureWords("m²", 30)!;
    const m2plain = measureWords("m2", 30)!;
    expect(m2.w).toBeLessThan(m2plain.w);
    expect(writeWords("H₂O", at, "left", "top", 30, 1)!.strokes.length).toBeGreaterThan(2);
  });

  it("returns null for nothing to write", () => {
    expect(writeWords("", at, "left", "top", 30, 1)).toBeNull();
    expect(writeWords("☃ ★", at, "left", "top", 30, 1)).toBeNull();
    expect(measureWords("   ", 30)).toBeNull();
  });
});
