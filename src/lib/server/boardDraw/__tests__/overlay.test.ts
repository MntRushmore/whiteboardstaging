/**
 * The overlay (src/lib/server/boardDraw/overlay.ts) on synthetic boards rasterised by sharp (real
 * anti-aliased strokes): a picture that is the board shifted and scaled adds nothing; a red circle
 * the model drew is the overlay; a digit the model redrew never shows as changed; a whole-board
 * grey or cream wash is background, not ink; the picture comes back at exactly the board's size.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { dilate, encodeRgbaPng, inkMask, NEAR_KID, overlayOf, pictureAt, type Rgb } from "../overlay";

const W = 480;
const H = 320;

const svg = (w: number, h: number, body: string, bg = "#ffffff") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>${body}</svg>`;

async function rgb(svgText: string): Promise<Rgb> {
  const { data, info } = await sharp(Buffer.from(svgText)).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

async function png(svgText: string): Promise<Buffer> {
  return sharp(Buffer.from(svgText)).png().toBuffer();
}

/** The kid's work: "2x+3=11" as pen strokes, and a second line "x=4" (dark grey ink). */
const KID = `<g fill="none" stroke="#222" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
  <path d="M60 70 Q75 50 90 70 L60 105 L92 105"/>
  <path d="M105 80 L125 105 M125 80 L105 105"/>
  <path d="M140 92 L162 92 M151 81 L151 103"/>
  <path d="M175 70 Q195 60 190 85 Q200 100 178 106"/>
  <path d="M215 86 L240 86 M215 98 L240 98"/>
  <path d="M260 66 L260 106 M285 66 L285 106"/>
  <path d="M60 170 L82 195 M82 170 L60 195"/>
  <path d="M95 176 L120 176 M95 188 L120 188"/>
  <path d="M150 160 L135 185 L160 185 M152 165 L152 198"/>
</g>`;

const count = (m: Uint8Array) => m.reduce((n, v) => n + v, 0);

describe("overlayOf", () => {
  it("a picture that is the board, scaled 3% and shifted by a few px, adds nothing", async () => {
    const board = await rgb(svg(W, H, KID));
    // the model returned a bigger picture with the board nudged right and down
    const pic = await rgb(svg(512, 341, `<g transform="translate(9 6) scale(1.03 1.03)">${KID}</g>`));
    const out = overlayOf(board, pic);
    expect(out.alignment.score).toBeGreaterThan(0.9);
    expect(out.addedPx).toBeLessThan(20);
  });

  it("a red circle the model drew is the overlay, in red, and nothing else is", async () => {
    const circle = `<circle cx="380" cy="180" r="34" fill="none" stroke="#e02020" stroke-width="5"/>`;
    const board = await rgb(svg(W, H, KID));
    const pic = await rgb(svg(W, H, KID + circle));
    const out = overlayOf(board, pic);

    const ring = inkMask(await rgb(svg(W, H, circle)));
    const ringNear = dilate(ring, W, H, 3);
    let onRing = 0;
    let offRing = 0;
    let red = 0;
    for (let i = 0; i < W * H; i++) {
      if (!out.mask[i]) continue;
      if (ringNear[i]) onRing++;
      else offRing++;
      if (out.rgba[i * 4] > 150 && out.rgba[i * 4 + 1] < 120) red++;
    }
    expect(onRing / count(ring)).toBeGreaterThan(0.9);
    expect(offRing).toBe(0);
    expect(red / onRing).toBeGreaterThan(0.6);
    // transparent everywhere else
    for (let i = 0; i < W * H; i++) if (!out.mask[i]) expect(out.rgba[i * 4 + 3]).toBe(0);
  });

  it("an addition next to the kid's work survives whole, with the kid's own strokes left out", async () => {
    const answer = `<g fill="none" stroke="#1e50dc" stroke-width="4" stroke-linecap="round"><path d="M310 75 L330 105 M330 75 L310 105"/><path d="M345 90 L365 90"/><path d="M385 70 L385 106"/></g>`;
    const board = await rgb(svg(W, H, KID));
    const pic = await rgb(svg(W, H, KID + answer));
    const out = overlayOf(board, pic);
    const added = inkMask(await rgb(svg(W, H, answer)));
    let covered = 0;
    for (let i = 0; i < W * H; i++) if (added[i] && out.mask[i]) covered++;
    expect(covered / count(added)).toBeGreaterThan(0.9);
  });

  it("a digit the model redrew is never shown as changed: transparent wherever the kid has ink", async () => {
    // the kid's "1" … and the model's "7" painted over it, in the same dark ink
    const one = `<path d="M260 66 L260 106" stroke="#222" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    const seven = `<path d="M250 68 L268 68 L258 106" stroke="#222" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    const kidWithout = KID.replace("M260 66 L260 106 ", "");
    const board = await rgb(svg(W, H, kidWithout + one));
    const pic = await rgb(svg(W, H, kidWithout + seven));
    const out = overlayOf(board, pic);
    const kid = dilate(inkMask(board, 40, 50), W, H, NEAR_KID);
    for (let i = 0; i < W * H; i++) if (kid[i]) expect(out.rgba[i * 4 + 3], `pixel ${i % W},${Math.floor(i / W)}`).toBe(0);
    // and the rest of the "7" (its bar, past the kid's stroke) is a piece of their digit, not an annotation
    expect(out.addedPx).toBeLessThan(20);
  });

  it("an answer the model wrote in dark ink, clear of the kid's work, is kept", async () => {
    const answer = `<g fill="none" stroke="#111" stroke-width="4" stroke-linecap="round"><path d="M320 170 L342 195 M342 170 L320 195"/><path d="M355 176 L380 176 M355 188 L380 188"/><path d="M410 160 L395 185 L420 185 M412 165 L412 198"/></g>`;
    const board = await rgb(svg(W, H, KID));
    const out = overlayOf(board, await rgb(svg(W, H, KID + answer)));
    const added = inkMask(await rgb(svg(W, H, answer)));
    let covered = 0;
    for (let i = 0; i < W * H; i++) if (added[i] && out.mask[i]) covered++;
    expect(covered / count(added)).toBeGreaterThan(0.9);
  });

  it("a whole-board grey wash is background, not an addition", async () => {
    const board = await rgb(svg(W, H, KID));
    const washed = await rgb(svg(W, H, KID, "#dcdcdc"));
    expect(overlayOf(board, washed).addedPx).toBe(0);
  });

  it("a cream wash is background too, and an addition on it is still found", async () => {
    const tick = `<path d="M330 170 L345 190 L380 140" stroke="#e02020" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    const board = await rgb(svg(W, H, KID));
    expect(overlayOf(board, await rgb(svg(W, H, KID, "#f1e7cc"))).addedPx).toBe(0);
    const out = overlayOf(board, await rgb(svg(W, H, KID + tick, "#e4e4e4")));
    const tickInk = inkMask(await rgb(svg(W, H, tick)));
    let covered = 0;
    for (let i = 0; i < W * H; i++) if (tickInk[i] && out.mask[i]) covered++;
    expect(covered / count(tickInk)).toBeGreaterThan(0.85);
    expect(out.addedPx).toBeLessThan(count(dilate(tickInk, W, H, 3)));
  });

  it("an empty board: the painter's marks are all additions", async () => {
    const mark = `<path d="M100 100 L300 100" stroke="#000" stroke-width="5"/>`;
    const out = overlayOf(await rgb(svg(W, H, "")), await rgb(svg(W, H, mark)));
    expect(out.addedPx).toBeGreaterThan(900);
  });

  it("encodes as a transparent PNG of the board's size", async () => {
    const out = overlayOf(await rgb(svg(W, H, KID)), await rgb(svg(W, H, KID + `<circle cx="380" cy="180" r="30" stroke="red" stroke-width="5" fill="none"/>`)));
    const meta = await sharp(await encodeRgbaPng(W, H, out.rgba)).metadata();
    expect([meta.width, meta.height, meta.channels, meta.hasAlpha]).toEqual([W, H, 4, true]);
  });
});

describe("pictureAt", () => {
  it("resizes the painter's picture to exactly the board's W×H, contain-fit and centred on white", async () => {
    // a square picture with a black square in its middle, for a 480×320 board
    const pic = await png(svg(600, 600, `<rect x="250" y="250" width="100" height="100" fill="#000"/>`));
    const at = await pictureAt(pic, W, H);
    expect([at.width, at.height]).toEqual([W, H]);
    // contain: 600 → 320 tall, centred: 80 px of white each side; the square is 53 px in the middle
    const px = (x: number, y: number) => at.data[(y * W + x) * 3];
    expect(px(5, 160)).toBe(255);
    expect(px(474, 160)).toBe(255);
    expect(px(240, 160)).toBeLessThan(30);
    expect(px(240, 120)).toBe(255);
  });
});
