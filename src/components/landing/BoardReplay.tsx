import type { CSSProperties } from "react";
import Image from "next/image";
import { Flame } from "lucide-react";
import { BOARD_LINES } from "@/lib/landing/boardInk";
import { pathBounds, replayTimeline, stackLines, type ReplayLine } from "@/lib/landing/replay";
import { LANDING_COPY } from "./copy";
import { ReplayButton } from "./ReplayButton";
import styles from "./device.module.css";

/**
 * The hero: an iPad with a real Agathon board on it, and five sums being written and marked on the
 * board, stroke by stroke (`replayTimeline`). A parent sees what the product does before reading a
 * word: a tick and a cheer for a right answer, a ring and "So close!" for a slip.
 *
 * Server-rendered and static. The screen is a screenshot of the real board; the ink is SVG drawn
 * over its canvas; the replay is CSS animations, so nothing waits for a script, and with reduced
 * motion (or without CSS animations) the board is simply shown finished. Only Watch again is a
 * client component.
 */

/** The canvas in the screenshot, in its own pixels: the SVG's coordinate space. */
const CANVAS = { width: 1147, height: 644 } as const;
/** Board units to canvas pixels: the board's zoom in the screenshot. */
const SCALE = 1.5;
/** Board units between one line and the next. */
const GAP = 30;
/** Where the first line's writing starts on the canvas. */
const LEFT = 120;
/** Board units between a mark and what the board says about it. */
const CHEER_GAP = 14;

export const REPLAY_ID = "lp-replay";

const REPLAY = replayTimeline(BOARD_LINES, stackLines(BOARD_LINES, GAP));
const COLUMN_HEIGHT = (BOARD_LINES.reduce((sum, line) => sum + line.height, 0) + GAP * (BOARD_LINES.length - 1)) * SCALE;
const TOP = (CANVAS.height - COLUMN_HEIGHT) / 2;

const pct = (value: number, of: number) => `${((value / of) * 100).toFixed(3)}%`;

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

/** A mark from the board, small, for the key under the iPad. */
function MarkIcon({ kind }: { kind: "tick" | "ring" }) {
  const line = BOARD_LINES.find((l) => l.mark.kind === kind);
  if (!line) return null;
  const b = pathBounds(line.mark.stroke.d);
  const pad = 3;
  return (
    <svg className={styles.keyIcon} viewBox={`${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`} aria-hidden>
      <path d={line.mark.stroke.d} fill="none" stroke="#4465e9" strokeWidth={kind === "ring" ? 4 : 3.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BoardReplay({ className }: { className?: string }) {
  const copy = LANDING_COPY.replay;
  return (
    <div className={className}>
      <figure className={styles.frame} role="img" aria-label={copy.label} id={REPLAY_ID} style={{ margin: 0 }}>
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
            <div className={styles.canvas} aria-hidden>
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
