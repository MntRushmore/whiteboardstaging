import { describe, expect, it } from "vitest";

import { ATLAS, COMMON_LETTERS, EM_BASELINE, EM_HEIGHT, glyphKey, hasGlyph, tokenizeHand } from "@/lib/hand/atlas";
import { pickGlyph, type GlyphPick } from "@/lib/hand/compose";
import { mulberry32, samplePath } from "@/lib/hand/path";

describe("hand atlas integrity", () => {
  const keys = Object.keys(ATLAS);

  it("carries a full hand", () => {
    expect(keys.length).toBeGreaterThanOrEqual(90);
    const alternates = keys.reduce((n, k) => n + ATLAS[k].length, 0);
    expect(alternates).toBeGreaterThanOrEqual(keys.length);
    // 26 lowercase + 26 uppercase + 10 digits are the non-negotiable core.
    for (const ch of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") {
      expect(hasGlyph(ch), `missing glyph ${ch}`).toBe(true);
    }
  });

  it("gives every alternate a positive advance and at least one drawable polyline", () => {
    for (const key of keys) {
      const alts = ATLAS[key];
      expect(alts.length, `no alternates for ${key}`).toBeGreaterThan(0);
      for (let i = 0; i < alts.length; i++) {
        const glyph = alts[i];
        const where = `${key}[${i}]`;
        expect(glyph.advance, `${where} advance`).toBeGreaterThan(0);
        if (key === " ") {
          expect(glyph.paths).toHaveLength(0);
          continue;
        }
        const polylines = glyph.paths.flatMap((d) => samplePath(d));
        expect(polylines.length, `${where} produced no polyline`).toBeGreaterThanOrEqual(1);
        for (const poly of polylines) {
          expect(poly.length, `${where} produced a degenerate polyline`).toBeGreaterThanOrEqual(2);
          for (const p of poly) {
            expect(Number.isFinite(p.x), `${where} NaN x`).toBe(true);
            expect(Number.isFinite(p.y), `${where} NaN y`).toBe(true);
          }
        }
      }
    }
  });

  it("keeps every alternate inside a sane em box", () => {
    for (const key of keys) {
      for (const glyph of ATLAS[key]) {
        for (const poly of glyph.paths.flatMap((d) => samplePath(d))) {
          for (const p of poly) {
            expect(p.x, `${key} x out of box`).toBeGreaterThanOrEqual(-1);
            expect(p.x, `${key} x out of box`).toBeLessThanOrEqual(glyph.advance + 1.5);
            expect(p.y, `${key} y out of box`).toBeGreaterThanOrEqual(0);
            expect(p.y, `${key} y out of box`).toBeLessThanOrEqual(EM_HEIGHT + 1.5);
          }
        }
      }
    }
  });

  it("splits a multi-subpath glyph into separate strokes", () => {
    // "=" is one path string with two `M` commands: two bars, never one zigzag.
    const equals = ATLAS["="][0];
    const polylines = equals.paths.flatMap((d) => samplePath(d));
    expect(polylines).toHaveLength(2);
    for (const poly of polylines) {
      const xs = poly.map((p) => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1);
    }
  });

  it("gives the common letters alternates so a hand never repeats itself", () => {
    for (const ch of COMMON_LETTERS) {
      expect(ATLAS[ch].length, `${ch} needs alternates`).toBeGreaterThanOrEqual(2);
    }
  });

  it("never stamps the same alternate twice in a row", () => {
    const rng = mulberry32(42);
    const prev: GlyphPick = { key: "", alt: -1 };
    let last = -1;
    for (let i = 0; i < 200; i++) {
      const glyph = pickGlyph("e", rng, prev);
      expect(glyph).not.toBeNull();
      expect(prev.alt).not.toBe(last);
      last = prev.alt;
    }
  });

  it("resolves keys, aliases and ligatures", () => {
    expect(glyphKey("A")).toBe("A");
    expect(glyphKey("*")).toBe("×");
    expect(hasGlyph("§")).toBe(false);
    expect(tokenizeHand("d/dx = 2")).toEqual(["d/dx", " ", "=", " ", "2"]);
    expect(EM_BASELINE).toBeLessThan(EM_HEIGHT);
  });

  it("rejects a malformed path rather than emitting NaN", () => {
    expect(() => samplePath("M 1 2 L oops 4")).toThrow();
    expect(() => samplePath("A 1 2 3")).toThrow();
  });
});
