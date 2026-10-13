import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HERO_SCENE, HERO_SCENE_PHONE, type HeroSceneImage, type ScenePoint } from "../heroScene";

const PUBLIC = path.join(__dirname, "../../../../public");

/** A WebP's pixel size, from its header (lossy VP8, or the extended VP8X canvas). */
function webpSize(buf: Buffer): { width: number; height: number } {
  expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buf.toString("ascii", 8, 12)).toBe("WEBP");
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  throw new Error(`unexpected WebP chunk ${chunk}`);
}

/** z of (b - a) × (c - b): positive turns clockwise in screen space (y down). */
function turn(a: ScenePoint, b: ScenePoint, c: ScenePoint): number {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

const SCENES: [string, HeroSceneImage, number][] = [
  ["wide", HERO_SCENE, 250_000],
  ["phone", HERO_SCENE_PHONE, 120_000],
];

describe.each(SCENES)("the hero painting (%s)", (_name, scene, maxBytes) => {
  const file = path.join(PUBLIC, scene.src);

  it("is in public, at the size it says, small enough for the page", () => {
    expect(scene.src).toMatch(/^\/landing\/v4\/hero-scene/);
    expect(fs.existsSync(file), file).toBe(true);
    const buf = fs.readFileSync(file);
    expect(buf.length).toBeLessThan(maxBytes);
    expect(webpSize(buf)).toEqual({ width: scene.width, height: scene.height });
  });

  it("describes the picture", () => {
    expect(scene.alt.length).toBeGreaterThan(40);
  });

  it("has its blank screen as a clockwise, convex quad inside the picture, with the pen tip on it", () => {
    const board = scene.board;
    expect(board).not.toBeNull();
    if (!board) return;
    const quad = [board.tl, board.tr, board.br, board.bl];
    for (const p of quad) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(scene.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(scene.height);
    }
    for (let i = 0; i < 4; i++) expect(turn(quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4])).toBeGreaterThan(0);
    const tip = scene.penTip;
    expect(tip).not.toBeNull();
    if (!tip) return;
    for (let i = 0; i < 4; i++) expect(turn(quad[i], quad[(i + 1) % 4], tip)).toBeGreaterThan(0);
  });
});
