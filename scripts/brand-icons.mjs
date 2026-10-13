/**
 * Agathon's icons, from its real mark: the single-storey "a" with a dot in its bowl (the logo
 * agathon.app showed in its green, traced with potrace from the 1024 px original kept in the launch
 * film's brand-src/agathon-logo.png). One flat green, white mark, no gradient (SEO build 2026-10-13,
 * docs/SEO.md).
 *
 *   node scripts/brand-icons.mjs
 *
 * Writes:
 * - src/app/icon.svg          the browser tab and search result icon (rounded tile, scales to any size)
 * - src/app/favicon.ico       16, 32 and 48 px of the same tile, for whatever still asks for /favicon.ico
 * - src/app/apple-icon.png    180 px, full-bleed (iOS rounds the corners itself)
 * - public/icons/icon-192.png, icon-512.png            the web manifest's icons (rounded tile)
 * - public/icons/icon-maskable-512.png                 the manifest's maskable icon (full-bleed, the
 *                                                      mark inside the 80 % safe circle)
 * Needs sharp (installed with Next).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The brand's green (the color agathon.app drew its logo in), and the mark's white. */
export const BRAND_GREEN = "#13403B";
const MARK_FILL = "#FFFFFF";

/**
 * The mark as potrace wrote it (`potrace -s -u 4 -O 1 -t 4`): quarter-pixel units of the 1024 px
 * original, y up. Its ink spans x 225–799 and y 223–800 of that box, centered on (512, 511.5).
 */
const MARK_PATHS = [
  "M1932 3199c-682-51-1138-678-1010-1386 82-452 423-807 858-894 122-25 293-30 392-12 257 46 456 167 605 370 6 8 13 15 14 15 2 0 4-69 4-153 2-219-15-201 197-201 170 0 171 0 191 31l11 16 0 1063 0 1063-11 16c-20 31-20 31-171 32-233 3-217 18-216-207 0-86-1-156-3-156-2 0-16 19-33 41-190 259-486 388-828 362zm254-371c369-68 600-371 600-784-1-462-305-787-735-788-431 0-741 329-741 790 0 438 261 743 678 792 36 4 156-2 198-10z",
  "M2011 2292c-201-32-279-278-134-421 139-135 375-61 413 130 33 165-113 317-279 291z",
];
const MARK_CENTER = { x: 512, y: 511.5 };

/**
 * One icon as SVG on a 1024 box: the green ground (a rounded tile, or full-bleed for platforms that
 * cut their own shape) and the mark at `scale` of its original size, centered.
 */
function iconSvg({ scale, radius }) {
  // potrace's units q (quarter pixels, y up) to the tile: the original pixel is (qx/4, 1024 − qy/4),
  // moved so the mark's center lands on the tile's and scaled about it.
  const s = scale / 4;
  const e = 512 - scale * MARK_CENTER.x;
  const f = 512 + scale * (1024 - MARK_CENTER.y);
  const ground = radius > 0 ? `<rect width="1024" height="1024" rx="${radius}" fill="${BRAND_GREEN}"/>` : `<rect width="1024" height="1024" fill="${BRAND_GREEN}"/>`;
  const fmt = (n) => Number(n.toFixed(4));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">` +
    `<title>Agathon</title>${ground}` +
    `<g fill="${MARK_FILL}" transform="matrix(${fmt(s)} 0 0 ${fmt(-s)} ${fmt(e)} ${fmt(f)})">${MARK_PATHS.map((d) => `<path d="${d}"/>`).join("")}</g>` +
    `</svg>\n`
  );
}

/** The tab icon: a rounded tile with the mark large, so it still reads at 16 px. */
const TAB = { scale: 1.2, radius: 232 };
/** Home-screen icons: the mark at the size app icons use. */
const APP = { scale: 1.0, radius: 0 };
const APP_ROUNDED = { scale: 1.0, radius: 232 };
/** Maskable: full-bleed, the mark well inside the 80 % circle every platform mask keeps. */
const MASKABLE = { scale: 0.85, radius: 0 };

/** The SVG drawn at its own 1024 px, then scaled down to `size`. */
async function png(svg, size) {
  return sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

/** An .ico of PNG images (every browser since IE Vista reads PNG entries). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

async function main() {
  const out = (rel, data) => {
    const file = path.join(ROOT, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, data);
    console.log(`wrote ${rel} (${data.length} bytes)`);
  };
  const tab = iconSvg(TAB);
  out("src/app/icon.svg", tab);
  out("src/app/favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(tab, size) })))));
  out("src/app/apple-icon.png", await png(iconSvg(APP), 180));
  out("public/icons/icon-192.png", await png(iconSvg(APP_ROUNDED), 192));
  out("public/icons/icon-512.png", await png(iconSvg(APP_ROUNDED), 512));
  out("public/icons/icon-maskable-512.png", await png(iconSvg(MASKABLE), 512));
}

await main();
