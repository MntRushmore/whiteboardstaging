import { describe, expect, it } from "vitest";
import { LECTURE_BOXES } from "../plan";
import { sketchHeading, sketchNote } from "../text";
import { problemsOf, wallMs } from "./gallery";

const HEAD = LECTURE_BOXES.heading.maxW;
const NOTE = LECTURE_BOXES.note.maxW;

describe("planHeading", () => {
  it("writes a topic large on one line, underlined, in about two seconds", () => {
    const sk = sketchHeading("Photosynthesis", { seed: 1, maxW: HEAD })!;
    expect(sk).not.toBeNull();
    expect(problemsOf(sk, { w: HEAD, h: 200 })).toEqual([]);
    expect(sk.plan.size).toBeGreaterThanOrEqual(48);
    expect(sk.texts).toHaveLength(1);
    // the underline is the last thing drawn, under the words
    const last = sk.plan.lines[sk.plan.lines.length - 1];
    expect(last.strokes.every((s) => s.kind === "rule")).toBe(true);
    expect(last.y).toBeGreaterThan(sk.texts[0].rect.y + sk.texts[0].rect.h);
    expect(last.strokes.reduce((w, s) => Math.max(w, ...s.points.map((p) => p.x + last.x)), 0)).toBeGreaterThan(sk.texts[0].rect.x + sk.texts[0].rect.w);
    expect(wallMs(sk)).toBeGreaterThanOrEqual(1000);
    expect(wallMs(sk)).toBeLessThanOrEqual(2500);
  });

  it("shrinks a long topic to its width before it takes a second line", () => {
    const text = "The causes of the First World War, 1900-1914";
    const wide = sketchHeading(text, { seed: 2, maxW: HEAD })!;
    expect(wide.plan.bounds.w).toBeLessThanOrEqual(HEAD);
    const narrow = sketchHeading(text, { seed: 2, maxW: 700 })!;
    expect(narrow.plan.bounds.w).toBeLessThanOrEqual(700);
    expect(narrow.plan.size).toBeLessThan(wide.plan.size);
    expect(problemsOf(narrow)).toEqual([]);
    expect(wallMs(wide)).toBeLessThanOrEqual(2500);
    // too narrow for even two lines of it
    expect(sketchHeading(text, { seed: 2, maxW: 160 })).toBeNull();
  });

  it("writes a continued topic's `(cont.)`", () => {
    const sk = sketchHeading("Photosynthesis (cont.)", { seed: 4, maxW: 800 })!;
    expect(sk.texts[0].text).toBe("Photosynthesis (cont.)");
    expect(problemsOf(sk)).toEqual([]);
  });

  it("is null when there is nothing the hand can write", () => {
    expect(sketchHeading("☃☃", { seed: 1, maxW: HEAD })).toBeNull();
  });
});

describe("planNote", () => {
  it("writes one point with a bullet and a hanging indent, in two to four seconds", () => {
    const sk = sketchNote("Newton's second law: the net force on an object equals its mass times its acceleration, F = ma.", { seed: 3, maxW: NOTE })!;
    expect(problemsOf(sk, { w: NOTE, h: 400 })).toEqual([]);
    expect(sk.plan.size).toBeGreaterThanOrEqual(28);
    expect(sk.plan.size).toBeLessThanOrEqual(36);
    // the bullet first, left of the words; every line of the words starts at the same x
    const bullet = sk.plan.lines[0];
    expect(bullet.strokes.every((s) => s.kind === "rule")).toBe(true);
    expect(bullet.x).toBeLessThan(sk.texts[0].rect.x);
    expect(wallMs(sk)).toBeGreaterThanOrEqual(2000);
    expect(wallMs(sk)).toBeLessThanOrEqual(4000);
  });

  it("keeps a short note short", () => {
    const sk = sketchNote("Mitochondria make ATP.", { seed: 3, maxW: NOTE })!;
    expect(sk.plan.bounds.h).toBeLessThan(50);
    expect(sk.plan.size).toBe(34);
    expect(wallMs(sk)).toBeLessThanOrEqual(3600);
  });

  it("is deterministic by seed", () => {
    const a = sketchNote("Water boils at 100°C at sea level.", { seed: 7, maxW: NOTE })!;
    const b = sketchNote("Water boils at 100°C at sea level.", { seed: 7, maxW: NOTE })!;
    expect(b.plan).toEqual(a.plan);
  });

  it("is null when the note will not fit its width", () => {
    expect(sketchNote("Photosynthesis", { seed: 1, maxW: 80 })).toBeNull();
  });
});
