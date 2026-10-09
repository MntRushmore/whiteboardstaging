import { ImageResponse } from "next/og";
import { LANDING_COPY } from "@/components/landing/copy";
import { BOARD_LINES } from "@/lib/landing/boardInk";
import { stackLines } from "@/lib/landing/replay";

/**
 * The picture a shared /parents link shows (Open Graph and X): the page's promise beside three of
 * the hero board's real lines, ticked and ringed by the tutor. Drawn at build time from the same
 * words and ink as the page, and with no price on it, so a price change never leaves a stale card.
 */

export const alt = LANDING_COPY.meta.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LINES = BOARD_LINES.slice(0, 3);
const GAP = 34;
const SCALE = 1.7;
const PLACES = stackLines(LINES, GAP);
const INK_W = Math.max(...LINES.map((l, i) => PLACES[i].x + l.width)) * SCALE;
const INK_H = (LINES.reduce((sum, l) => sum + l.height, 0) + GAP * (LINES.length - 1)) * SCALE;
const LEFT_PAD = Math.max(...LINES.map((l) => l.inkX)) * SCALE;

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", gap: 64, padding: "0 80px", background: "#f6f6f6" }}>
        <div style={{ display: "flex", flex: 1, flexDirection: "column", color: "#111" }}>
          <div style={{ fontSize: 30, letterSpacing: -1, color: "#111" }}>Agathon</div>
          <div style={{ marginTop: 28, fontSize: 70, lineHeight: 1.04, letterSpacing: -3.2 }}>{LANDING_COPY.hero.title}</div>
          <div style={{ marginTop: 28, fontSize: 28, lineHeight: 1.35, color: "#5e5e5e" }}>{LANDING_COPY.hero.eyebrow}</div>
        </div>
        <div
          style={{
            display: "flex",
            width: 470,
            height: 430,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 36,
            background: "#fcfcfc",
            border: "1px solid #e8e8e8",
            boxShadow: "0 20px 60px rgba(0,0,0,0.10)",
          }}
        >
          <svg width={INK_W + LEFT_PAD} height={INK_H} viewBox={`${-LEFT_PAD} 0 ${INK_W + LEFT_PAD} ${INK_H}`}>
            {LINES.map((line, i) => (
              <g key={line.latex} transform={`translate(${PLACES[i].x * SCALE} ${PLACES[i].y * SCALE}) scale(${SCALE})`}>
                {line.kid.map((stroke, k) => (
                  <path key={k} d={stroke.d} fill="none" stroke="#1d1d1d" strokeWidth={4.4} strokeLinecap="round" strokeLinejoin="round" />
                ))}
                <path d={line.mark.stroke.d} fill="none" stroke="#4465e9" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            ))}
          </svg>
        </div>
      </div>
    ),
    size,
  );
}
