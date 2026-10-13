import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { TRY_COPY } from "@/components/try/copy";
import { BOARD_LINES } from "@/lib/landing/boardInk";
import { handInk, type HandInk } from "@/lib/landing/handInk";
import { pathBounds } from "@/lib/landing/replay";

/**
 * The picture a shared /try link shows (Open Graph and X), in the landing page's look (its own card
 * is src/app/(platform)/parents/opengraph-image.tsx): the board on the grey table with its dot grid,
 * the page's promise written big, and what the page does, drawn the way the page draws it: a
 * problem in the tutor's blue hand, a kid's answer under it in black (the hand engine, as on the
 * page), and the tutor's check mark beside it, the very stroke a live tutor drew on a real board
 * (boardInk.ts). Flat colours, no price, no claims. Built at build time.
 */

export const runtime = "nodejs";
export const alt = TRY_COPY.meta.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TABLE = "#f1f2f5";
const HAIR = "#e3e5ea";
const DOT = "#dcdfe5";
const INK = "#111111";
const KID = "#1d1d1d";
const TUTOR = "#4465e9";
const ACCENT = "#0562ef";
const RULE = "#d5d9e2";

const TICK = BOARD_LINES.find((l) => l.mark.kind === "tick")!.mark.stroke.d;
const TICK_BOX = pathBounds(TICK);
const TICK_PEN = Math.max(TICK_BOX.maxX - TICK_BOX.minX, TICK_BOX.maxY - TICK_BOX.minY) / 10;

const PROBLEM = handInk("6 \\times 7", { size: 120, seed: 3 });
const ANSWER = handInk("42", { size: 120, seed: 5 });

/** A line of the hand as an SVG at its natural size, in one pen. */
function Hand({ ink, color, pen }: { ink: HandInk; color: string; pen: number }) {
  return (
    <svg width={ink.width + 2 * pen} height={ink.height + 2 * pen} viewBox={`${-pen} ${-pen} ${ink.width + 2 * pen} ${ink.height + 2 * pen}`}>
      {ink.strokes.map((s, i) => (
        <path key={i} d={s.d} fill="none" stroke={color} strokeWidth={pen * s.weight} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

const semiBold = readFile(join(process.cwd(), "src/app/(platform)/parents/Geist-SemiBold.ttf"));
const regular = readFile(join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf"));

export default async function OpenGraphImage() {
  const [semiBoldData, regularData] = await Promise.all([semiBold, regular]);
  const [first, second] = TRY_COPY.title.split(/(?<=\.)\s+/);
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
          <svg width="1150" height="580" style={{ position: "absolute", top: 0, left: 0 }}>
            <defs>
              <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="12" cy="12" r="1.4" fill={DOT} />
              </pattern>
            </defs>
            <rect width="1150" height="580" rx="32" fill="url(#dots)" />
          </svg>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 600, letterSpacing: -1 }}>Agathon</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", width: 660, fontSize: 72, fontWeight: 600, letterSpacing: -2.9, lineHeight: 1.08 }}>
              <div style={{ display: "flex", whiteSpace: "nowrap" }}>{first}</div>
              <div style={{ display: "flex", whiteSpace: "nowrap" }}>{second}</div>
            </div>
            {/* the page's board in small: the problem, a ruled line, the answer and the check mark */}
            <div style={{ display: "flex", flexDirection: "column", width: 300 }}>
              <Hand ink={PROBLEM} color={TUTOR} pen={7} />
              <div style={{ display: "flex", width: 300, alignItems: "center", marginTop: 34, paddingBottom: 16, borderBottom: `3px solid ${RULE}` }}>
                <Hand ink={ANSWER} color={KID} pen={7} />
                <svg width="84" height="84" viewBox={`${TICK_BOX.minX - TICK_PEN} ${TICK_BOX.minY - TICK_PEN} ${TICK_BOX.maxX - TICK_BOX.minX + 2 * TICK_PEN} ${TICK_BOX.maxY - TICK_BOX.minY + 2 * TICK_PEN}`} style={{ marginLeft: 28 }}>
                  <path d={TICK} fill="none" stroke={TUTOR} strokeWidth={TICK_PEN} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 400, letterSpacing: 2.4, color: ACCENT }}>TRY IT FREE · NO ACCOUNT NEEDED</div>
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
