import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { LANDING_COPY } from "@/components/landing/copy";
import { BOARD_LINES } from "@/lib/landing/boardInk";
import { pathBounds, stackLines } from "@/lib/landing/replay";

/**
 * The picture a shared /parents link shows (Open Graph and X): the page's promise beside three of
 * the hero board's real lines, ticked and ringed by the tutor. Drawn at build time from the same
 * words and ink as the page, and with no price on it, so a price change never leaves a stale card.
 *
 * The headline is in the page's display face, Geist SemiBold (Geist-SemiBold.ttf beside this file,
 * from the `geist` package, SIL Open Font License; Satori reads .ttf, not .woff2); the rest is in
 * next/og's own Geist Regular.
 */

export const runtime = "nodejs";
export const alt = LANDING_COPY.meta.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LINES = BOARD_LINES.slice(0, 3);
const GAP = 34;
const SCALE = 1.7;
const PLACES = stackLines(LINES, GAP);
const STUDENT_WIDTH = 4.4;
const TUTOR_WIDTH = 3;

/** The ink's true extent (every stroke, placed), so the card centres the ink itself, not its line boxes. */
const BOX = LINES.reduce(
  (box, line, i) => {
    for (const stroke of [...line.kid, line.mark.stroke]) {
      const b = pathBounds(stroke.d);
      box.minX = Math.min(box.minX, PLACES[i].x + b.minX);
      box.maxX = Math.max(box.maxX, PLACES[i].x + b.maxX);
      box.minY = Math.min(box.minY, PLACES[i].y + b.minY);
      box.maxY = Math.max(box.maxY, PLACES[i].y + b.maxY);
    }
    return box;
  },
  { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
);
/** Half the thickest pen, so round caps at the edges are not cut off. */
const EDGE = STUDENT_WIDTH / 2;
const VIEW = {
  x: BOX.minX - EDGE,
  y: BOX.minY - EDGE,
  width: BOX.maxX - BOX.minX + 2 * EDGE,
  height: BOX.maxY - BOX.minY + 2 * EDGE,
};

/**
 * "Kindergarten to 8th grade" in one run of text: Satori lays a line out word by word and leaves a
 * visibly wider gap after some words; no-break spaces keep the eyebrow evenly spaced (it is short
 * enough never to need a break).
 */
const EYEBROW = LANDING_COPY.hero.eyebrow.trim().replace(/\s+/g, " ");

/** Read once per build: the image is static. */
const semiBold = readFile(join(process.cwd(), "src/app/(platform)/parents/Geist-SemiBold.ttf"));
const regular = readFile(join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf"));

export default async function OpenGraphImage() {
  const [semiBoldData, regularData] = await Promise.all([semiBold, regular]);
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          gap: 60,
          padding: "0 80px",
          background: "#f6f6f6",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", flex: 1, flexDirection: "column", color: "#111" }}>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.6, color: "#111" }}>Agathon</div>
          <div style={{ marginTop: 26, fontSize: 68, fontWeight: 600, lineHeight: 1.06, letterSpacing: -2.4 }}>
            {LANDING_COPY.hero.title}
          </div>
          <div style={{ marginTop: 26, fontSize: 28, fontWeight: 400, lineHeight: 1.35, color: "#5e5e5e" }}>
            {EYEBROW}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            width: 480,
            height: 430,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 36,
            background: "#fcfcfc",
            border: "1px solid #e8e8e8",
            boxShadow: "0 20px 60px rgba(0,0,0,0.10)",
          }}
        >
          <svg width={VIEW.width * SCALE} height={VIEW.height * SCALE} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}>
            {LINES.map((line, i) => (
              <g key={line.latex} transform={`translate(${PLACES[i].x} ${PLACES[i].y})`}>
                {line.kid.map((stroke, k) => (
                  <path
                    key={k}
                    d={stroke.d}
                    fill="none"
                    stroke="#1d1d1d"
                    strokeWidth={STUDENT_WIDTH}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                <path
                  d={line.mark.stroke.d}
                  fill="none"
                  stroke="#4465e9"
                  strokeWidth={TUTOR_WIDTH}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            ))}
          </svg>
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
