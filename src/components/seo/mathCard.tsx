import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BOARD_LINES } from "@/lib/landing/boardInk";
import { handInk } from "@/lib/landing/handInk";
import { pathBounds } from "@/lib/landing/replay";

/**
 * The share card of a math library page (Open Graph and X; docs/SEO.md), in the landing page's card
 * look (src/app/(platform)/parents/opengraph-image.tsx): the board, white with its faint dot grid on
 * the grey table, "Agathon" at the top, the page's name written big, a problem in the kid's pen (the
 * board's own hand, `handInk`), and a line in the accent blue. Flat colors only. Drawn at build time.
 *
 * The words are in the page's display face, Geist SemiBold (Geist-SemiBold.ttf beside the /math/[slug]
 * card, from the `geist` package, SIL Open Font License; Satori reads .ttf, not .woff2), and the small
 * line in next/og's own Geist Regular.
 */

export const CARD_SIZE = { width: 1200, height: 630 };
export const CARD_TYPE = "image/png";

/** The board's colors (landing.module.css): the table, the screen's hairline, the dots, the pens. */
const TABLE = "#f1f2f5";
const HAIR = "#e3e5ea";
const DOT = "#dcdfe5";
const INK = "#111111";
const KID = "#1d1d1d";
const TUTOR = "#4465e9";
const ACCENT = "#0562ef";

const TICK = BOARD_LINES.find((l) => l.mark.kind === "tick")!.mark.stroke.d;
const TICK_BOX = pathBounds(TICK);
const TICK_PEN = Math.max(TICK_BOX.maxX - TICK_BOX.minX, TICK_BOX.maxY - TICK_BOX.minY) / 9;

/** Read once per build: the cards are static. */
const semiBold = readFile(join(process.cwd(), "src/app/(platform)/math/[slug]/Geist-SemiBold.ttf"));
const regular = readFile(join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf"));

/** A line of math in the kid's pen, scaled to fit `maxWidth` × `maxHeight` px. */
function Hand({ latex, maxWidth, maxHeight, check }: { latex: string; maxWidth: number; maxHeight: number; check?: boolean }) {
  const size = 60;
  const hand = handInk(latex, { size, seed: 2 });
  const pen = size / 9;
  const w = hand.width + 2 * pen;
  const h = hand.height + 2 * pen;
  const scale = Math.min(1.4, maxWidth / w, maxHeight / h);
  const checkSize = Math.round(size * scale * 0.95);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <svg width={Math.round(w * scale)} height={Math.round(h * scale)} viewBox={`${-pen} ${-pen} ${w} ${h}`}>
        {hand.strokes.map((s, i) => (
          <path key={i} d={s.d} fill="none" stroke={KID} strokeWidth={pen * s.weight} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      {check && (
        <svg
          width={checkSize}
          height={checkSize}
          viewBox={`${TICK_BOX.minX - TICK_PEN} ${TICK_BOX.minY - TICK_PEN} ${TICK_BOX.maxX - TICK_BOX.minX + 2 * TICK_PEN} ${TICK_BOX.maxY - TICK_BOX.minY + 2 * TICK_PEN}`}
          style={{ marginLeft: 14 }}
        >
          <path d={TICK} fill="none" stroke={TUTOR} strokeWidth={TICK_PEN} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

export interface MathCardProps {
  /** the small line at the foot, in the accent ("3rd grade math"); set in capitals */
  eyebrow: string;
  /** the page's name, big */
  title: string;
  /** one problem (its lines, stacked), or several (side by side, each checked: right answers only) */
  problem?: string[];
  row?: string[];
}

export async function mathCard({ eyebrow, title, problem = [], row = [] }: MathCardProps): Promise<ImageResponse> {
  const [semiBoldData, regularData] = await Promise.all([semiBold, regular]);
  const titleSize = title.length <= 16 ? 108 : title.length <= 26 ? 92 : 76;
  const lineHeight = problem.length > 1 ? 82 : 116;
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
            padding: "48px 72px 52px",
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
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", maxWidth: 1000, fontSize: titleSize, fontWeight: 600, letterSpacing: -titleSize * 0.042, lineHeight: 1.02 }}>{title}</div>
            {problem.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
                {problem.map((line, i) => (
                  <Hand key={i} latex={line} maxWidth={1000} maxHeight={lineHeight} />
                ))}
              </div>
            )}
            {row.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", marginTop: 34 }}>
                {row.map((line, i) => (
                  <div key={i} style={{ display: "flex", marginRight: 48 }}>
                    <Hand latex={line} maxWidth={230} maxHeight={92} check />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 400, letterSpacing: 2.4, color: ACCENT }}>{eyebrow.toUpperCase()}</div>
        </div>
      </div>
    ),
    {
      ...CARD_SIZE,
      fonts: [
        { name: "Geist", data: regularData, weight: 400, style: "normal" },
        { name: "Geist", data: semiBoldData, weight: 600, style: "normal" },
      ],
    },
  );
}
