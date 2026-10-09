import type { CSSProperties } from "react";
import Image from "next/image";
import { Flame } from "lucide-react";
import { BOARD_LINES } from "@/lib/landing/boardInk";
import { HERO_LINE_INDEXES, pathBounds, replayTimeline, stackLines, type ReplayLine } from "@/lib/landing/replay";
import { LANDING_COPY } from "./copy";
import { ReplayButton } from "./ReplayButton";
import { REPLAY_ID, REPLAY_START_SCRIPT } from "./replayStart";
import styles from "./device.module.css";

/**
 * The hero: an iPad with a real Agathon board on it (a 1st grader's simple board), and three sums
 * being written and marked on it, stroke by stroke (`replayTimeline`). A parent sees what the product
 * does before reading a word: a check mark and a cheer for a right answer, a circle and "So close!"
 * for a slip.
 *
 * Server-rendered and static. The screen is a screenshot of the real board; the ink is SVG drawn
 * over its canvas; the replay is CSS animations, held at the start until the iPad is half in view
 * (`REPLAY_START_SCRIPT`, run as the page is read, so it needs no hydration). With reduced motion
 * (or without CSS animations) the board is simply shown finished. Only Watch again is a client
 * component.
 */

/** The screenshot (public/landing/board-ipad.webp), in CSS px of the board it was taken from. */
const SCREEN = { width: 1180, height: 820 } as const;
/** The board's empty canvas in the screenshot: below the kid's toolbar, clear of the page dots. */
const CANVAS = { left: 16, top: 88, width: 1148, height: 644 } as const;
/** Board units to canvas pixels: the ink a little larger than life, as an iPad shows it zoomed. */
const SCALE = 2;
/** Board units between one line and the next. */
const GAP = 34;
/** Board units between a mark and what the board says about it. */
const CHEER_GAP = 14;
/** About how wide "So close! Try that step again." is beside the ring, in canvas px, for centring. */
const MISS_WIDTH = 250;

const LINES = HERO_LINE_INDEXES.map((i) => BOARD_LINES[i]);
const REPLAY = replayTimeline(LINES, stackLines(LINES, GAP));
const COLUMN_HEIGHT = (LINES.reduce((sum, line) => sum + line.height, 0) + GAP * (LINES.length - 1)) * SCALE;

/** The writing and the ring's note, centred on the canvas as one block. */
function composition() {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const line of REPLAY.lines) {
    minX = Math.min(minX, line.x * SCALE);
    const right = (line.x + line.width) * SCALE;
    maxX = Math.max(maxX, line.mark === "ring" ? right + CHEER_GAP * SCALE + MISS_WIDTH : right);
  }
  return { left: (CANVAS.width - (maxX - minX)) / 2 - minX, top: (CANVAS.height - COLUMN_HEIGHT) / 2 };
}
const { left: LEFT, top: TOP } = composition();

const pct = (value: number, of: number) => `${((value / of) * 100).toFixed(3)}%`;

const CANVAS_STYLE: CSSProperties = {
  left: pct(CANVAS.left, SCREEN.width),
  top: pct(CANVAS.top, SCREEN.height),
  width: pct(CANVAS.width, SCREEN.width),
  height: pct(CANVAS.height, SCREEN.height),
};

function Cheer({ line }: { line: ReplayLine }) {
  const { cheer } = line;
  const x = LEFT + (line.x + line.width + CHEER_GAP) * SCALE;
  const y = TOP + (line.y + line.height / 2) * SCALE;
  const style = {
    left: pct(x, CANVAS.width),
    top: pct(y, CANVAS.height),
    "--show": `${cheer.showMs}ms`,
    "--hide": cheer.hideMs === null ? undefined : `${cheer.hideMs}ms`,
  } as CSSProperties;
  return (
    <span className={`${styles.cheer} ${cheer.tone === "win" ? styles.win : styles.miss}`} style={style}>
      {cheer.text}
      {cheer.streak && (
        <span className={styles.streak}>
          <Flame aria-hidden />
          {cheer.streak}
        </span>
      )}
    </span>
  );
}

/**
 * A mark from the board, small, for the key under the iPad. The ring is drawn into a rounder box than
 * its own (it circles a whole line, so at icon size it would be a flat pill), at an even pen width.
 */
function MarkIcon({ kind }: { kind: "tick" | "ring" }) {
  const line = BOARD_LINES.find((l) => l.mark.kind === kind);
  if (!line) return null;
  const b = pathBounds(line.mark.stroke.d);
  const pad = kind === "ring" ? 8 : 3;
  return (
    <svg
      className={`${styles.keyIcon} ${kind === "ring" ? styles.keyRing : ""}`}
      viewBox={`${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`}
      preserveAspectRatio={kind === "ring" ? "none" : undefined}
      aria-hidden
    >
      <path
        d={line.mark.stroke.d}
        fill="none"
        stroke="#4465e9"
        strokeWidth={2.4}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BoardReplay({ className }: { className?: string }) {
  const copy = LANDING_COPY.replay;
  return (
    <div className={className}>
      <figure className={styles.frame} role="img" aria-label={copy.label} id={REPLAY_ID}>
        <div className={styles.ipad}>
          <span className={styles.camera} />
          <div className={styles.screen}>
            <Image
              src="/landing/board-ipad.webp"
              alt=""
              fill
              preload
              sizes="(max-width: 639px) 600px, (max-width: 1136px) calc(100vw - 80px), 1056px"
              className={styles.screenImage}
            />
            <div className={styles.canvas} style={CANVAS_STYLE} aria-hidden>
              <svg className={styles.ink} viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}>
                {REPLAY.lines.map((line) => (
                  <g key={line.latex} transform={`translate(${LEFT + line.x * SCALE} ${TOP + line.y * SCALE}) scale(${SCALE})`}>
                    {line.strokes.map((stroke, k) => (
                      <path
                        key={k}
                        d={stroke.d}
                        pathLength={1}
                        className={`${styles.stroke} ${stroke.ink === "student" ? styles.student : styles.tutor}`}
                        style={{ "--at": `${stroke.delayMs}ms`, "--for": `${stroke.durationMs}ms` } as CSSProperties}
                      />
                    ))}
                  </g>
                ))}
              </svg>
              {REPLAY.lines.map((line) => (
                <Cheer key={line.latex} line={line} />
              ))}
            </div>
          </div>
        </div>
      </figure>
      {/* Hold the replay until the iPad is half in view: as the page is read, before any paint. */}
      <script dangerouslySetInnerHTML={{ __html: REPLAY_START_SCRIPT }} />
      <div className={styles.caption}>
        <span className={styles.key}>
          <MarkIcon kind="tick" />
          {copy.tick}
        </span>
        <span className={styles.key}>
          <MarkIcon kind="ring" />
          {copy.ring}
        </span>
        <ReplayButton targetId={REPLAY_ID} label={copy.again} className={styles.again} />
      </div>
    </div>
  );
}
