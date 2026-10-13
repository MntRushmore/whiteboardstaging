import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { LANDING_COPY } from "@/components/landing/copy";
import { BOARD_LINES } from "@/lib/landing/boardInk";
import { pathBounds } from "@/lib/landing/replay";

/**
 * The picture a shared agathon.app link shows (Open Graph and X), in the page's v3 look: the board
 * (white, its faint dot grid, on the grey table) with the page's promise written big, and the tutor's
 * pen on it as on the page: "actually" circled and the line checked, with the very strokes the live
 * tutor drew on a real board (boardInk.ts). Flat colours only. Drawn at build time from the page's
 * own words, and with no price on it, so a price change never leaves a stale card.
 *
 * The words are in the page's display face, Geist SemiBold (Geist-SemiBold.ttf beside this file,
 * from the `geist` package, SIL Open Font License; Satori reads .ttf, not .woff2), and the small
 * line in next/og's own Geist Regular.
 */

export const runtime = "nodejs";
export const alt = LANDING_COPY.meta.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The board's colours (landing.module.css): the table, the screen's hairline, the dots, the pens. */
const TABLE = "#f1f2f5";
const HAIR = "#e3e5ea";
const DOT = "#dcdfe5";
const INK = "#111111";
const TUTOR = "#4465e9";
const ACCENT = "#0562ef";

const TITLE_SIZE = 118;

const TICK = BOARD_LINES.find((l) => l.mark.kind === "tick")!.mark.stroke.d;
const RING = BOARD_LINES.find((l) => l.mark.kind === "ring")!.mark.stroke.d;

function viewBox(d: string, pad: number): string {
  const b = pathBounds(d);
  return `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
}
const TICK_BOX = pathBounds(TICK);
/** the check's pen, at the ring's weight */
const TICK_PEN = Math.max(TICK_BOX.maxX - TICK_BOX.minX, TICK_BOX.maxY - TICK_BOX.minY) / 9;

/** "Kindergarten to 8th grade", evenly spaced: Satori leaves wider gaps after some words. */
const EYEBROW = LANDING_COPY.hero.eyebrow.trim().replace(/\s+/g, " ").toUpperCase();

/** Read once per build: the image is static. */
const semiBold = readFile(join(process.cwd(), "src/app/(platform)/parents/Geist-SemiBold.ttf"));
const regular = readFile(join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf"));

export default async function OpenGraphImage() {
  const [semiBoldData, regularData] = await Promise.all([semiBold, regular]);
  const [first, kids, circled, last] = LANDING_COPY.hero.titleParts;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", padding: 24, background: TABLE, fontFamily: "Geist" }}>
        <div
          style={{
            position: "relative",
            display: "flex",
            flex: 1,
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "52px 72px 56px",
            borderRadius: 32,
            border: `1px solid ${HAIR}`,
            background: "#ffffff",
            color: INK,
          }}
        >
          {/* the board's dot grid */}
          <svg width="1150" height="580" style={{ position: "absolute", top: 0, left: 0 }}>
            <defs>
              <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="12" cy="12" r="1.4" fill={DOT} />
              </pattern>
            </defs>
            <rect width="1150" height="580" rx="32" fill="url(#dots)" />
          </svg>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 600, letterSpacing: -1 }}>Agathon</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: TITLE_SIZE, fontWeight: 600, letterSpacing: -5, lineHeight: 1 }}>
            <div style={{ display: "flex" }}>{first}</div>
            <div style={{ display: "flex", alignItems: "center", marginTop: 14 }}>
              <div style={{ display: "flex" }}>{kids}</div>
              <div style={{ position: "relative", display: "flex", margin: "0 36px 0 44px" }}>
                {circled}
                {/* the tutor's ring, stretched round the word */}
                <div style={{ position: "absolute", display: "flex", top: -4, right: -22, bottom: -22, left: -22 }}>
                  <svg width="100%" height="100%" viewBox={viewBox(RING, 2)} preserveAspectRatio="none">
                    <path d={RING} fill="none" stroke={TUTOR} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                </div>
              </div>
              <div style={{ display: "flex" }}>{last}</div>
              <svg width="96" height="96" viewBox={viewBox(TICK, TICK_PEN)} style={{ marginLeft: 12, marginTop: 6 }}>
                <path d={TICK} fill="none" stroke={TUTOR} strokeWidth={TICK_PEN} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 400, letterSpacing: 2.4, color: ACCENT }}>{EYEBROW}</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: regularData, weight: 400, style: "normal" },
        { name: "Geist", data: semiBoldData, weight: 600, style: "normal" },
      ],
    },
  );
}
