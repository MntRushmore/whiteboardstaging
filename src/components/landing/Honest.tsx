import type { CSSProperties } from "react";
import { ChevronRight, Lightbulb } from "lucide-react";
import { pathBounds } from "@/lib/landing/replay";
import { HELP_SCENE } from "@/lib/landing/stepInk";
import { tornOutline } from "@/lib/landing/torn";
import { DARK_BAND_ATTR, HOW_ID } from "./bands";
import { LANDING_COPY } from "./copy";
import { InkCheck } from "./InkMark";
import { INK_DRAW_ATTR } from "./inkStart";
import landing from "./landing.module.css";
import styles from "./honest.module.css";

/**
 * "Not a cheat button." (v4): right after How it works, on a dark brown band torn at both edges.
 * What the help holds back: a hint or just the next step, a question before an explanation, and the
 * whole solution only when they choose it.
 *
 * Its picture is a collage of torn paper scraps carrying a real board's ink (never a mark the
 * product would not make):
 *  - the biggest, a strip torn from the board (its white and its dot grid): the slip 3x − 2 = 12,
 *    which the live tutor circles, and only the next step written beside it, 3x − 6 = 12 (stepInk.ts
 *    HELP_SCENE without its first line: How it works shows that whole board just above, so this
 *    quotes the one line that matters here);
 *  - a small one with the tutor's check mark (the board's own stroke, InkMark's InkCheck);
 *  - one with the Help me button, as the board draws it.
 *
 * The kid's lines are there from the start; the tutor's circle, its step and the check draw in once
 * the collage is in view (INK_START_SCRIPT, one key for the whole picture). With reduced motion they
 * are simply there. One picture to a screen reader (`role="img"`), its scraps hidden from it.
 * Server-rendered and static.
 */

const KEY = "honest";

/** Board units of paper round the ink: a margin, so a scrap's tear never meets a stroke. */
const PAD = { x: 36, y: 30 } as const;

/** The slip's line of the Help me board: everything under its first line, 3(x − 2) = 12. */
const SLIP = HELP_SCENE.strokes.filter((stroke) => pathBounds(stroke.d).minY > 45);
/** The strip's ink box, in board units. */
const BOX = SLIP.reduce(
  (b, stroke) => {
    const s = pathBounds(stroke.d);
    return { minX: Math.min(b.minX, s.minX), minY: Math.min(b.minY, s.minY), maxX: Math.max(b.maxX, s.maxX), maxY: Math.max(b.maxY, s.maxY) };
  },
  { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
);

/** The tutor's strokes on the strip: the circle, a breath, then the step at its writing pace. */
function tutorTimes() {
  let t = 350;
  return SLIP.map((stroke) => {
    if (stroke.ink !== "tutor") return null;
    const ring = stroke.len > 200;
    const forMs = ring ? 680 : Math.round(Math.min(320, Math.max(100, stroke.len * 6)));
    const at = t;
    t += forMs + (ring ? 220 : 55);
    return { atMs: at, forMs };
  });
}
const TIMES = tutorTimes();
/** When the step is written: the check follows it. */
const STEP_DONE_MS = Math.max(...TIMES.map((x) => (x ? x.atMs + x.forMs : 0)));

/** Each scrap's torn outline, shaped at its size on a laptop. */
const OUTLINES = {
  board: tornOutline({ seed: 71, width: 560, height: 144, depth: 6, step: [6, 13] }),
  check: tornOutline({ seed: 73, width: 120, height: 112, depth: 5, step: [5, 11] }),
  help: tornOutline({ seed: 79, width: 250, height: 96, depth: 5, step: [5, 11] }),
} as const;

const vars = (v: Record<string, string>) => v as CSSProperties;

/** The strip torn from the board: its white, its dot grid, the slip and the tutor's ink on it. */
function BoardScrap() {
  const x = Math.round(BOX.minX - PAD.x);
  const y = Math.round(BOX.minY - PAD.y);
  const w = Math.round(BOX.maxX - BOX.minX + 2 * PAD.x);
  const h = Math.round(BOX.maxY - BOX.minY + 2 * PAD.y);
  return (
    <div className={`${styles.scrap} ${styles.board}`} style={{ clipPath: OUTLINES.board, aspectRatio: `${w} / ${h}` }}>
      <svg className={styles.ink} viewBox={`${x} ${y} ${w} ${h}`}>
        <defs>
          <pattern id="lp-honest-dots" width="24" height="24" patternUnits="userSpaceOnUse" x={x} y={y}>
            <circle className={styles.dot} cx="12" cy="12" r="1.3" />
          </pattern>
        </defs>
        <rect x={x} y={y} width={w} height={h} fill="url(#lp-honest-dots)" />
        {SLIP.map((stroke, i) => {
          const time = TIMES[i];
          return time ? (
            <path key={i} d={stroke.d} pathLength={1} className={styles.tutor} style={vars({ "--at": `${time.atMs}ms`, "--for": `${time.forMs}ms` })} />
          ) : (
            <path key={i} d={stroke.d} className={styles.kid} />
          );
        })}
      </svg>
    </div>
  );
}

export function Honest() {
  const copy = LANDING_COPY.honest;
  return (
    <section className={`${landing.band} ${landing.dark} ${styles.band}`} aria-labelledby="lp-honest-title" {...{ [DARK_BAND_ATTR]: "" }}>
      <div className={`${landing.inner} ${styles.layout}`}>
        <div className={`${styles.text} ${landing.reveal}`}>
          <p className={landing.eyebrow}>{copy.eyebrow}</p>
          <h2 id="lp-honest-title" className={landing.h2}>
            {copy.title}
          </h2>
          <p className={`${landing.lede} ${styles.body}`}>{copy.body}</p>
          <a href={`#${HOW_ID}`} className={`${landing.textLink} ${styles.link}`}>
            {copy.link}
            <ChevronRight size={18} strokeWidth={2} aria-hidden />
          </a>
        </div>
        <figure className={`${styles.collage} ${landing.reveal}`} role="img" aria-label={copy.alt} {...{ [INK_DRAW_ATTR]: KEY }}>
          <div className={`${styles.piece} ${styles.pieceBoard}`} aria-hidden>
            <BoardScrap />
          </div>
          <div className={`${styles.piece} ${styles.pieceCheck}`} aria-hidden>
            <div className={`${styles.scrap} ${styles.cream}`} style={{ clipPath: OUTLINES.check }}>
              <InkCheck className={styles.check} draw={KEY} atMs={STEP_DONE_MS + 320} forMs={320} />
            </div>
          </div>
          <div className={`${styles.piece} ${styles.pieceHelp}`} aria-hidden>
            <div className={`${styles.scrap} ${styles.butter}`} style={{ clipPath: OUTLINES.help }}>
              <span className={`${landing.helpChip} ${styles.chip}`}>
                <Lightbulb size="1em" strokeWidth={2.25} aria-hidden />
                {copy.helpButton}
              </span>
            </div>
          </div>
        </figure>
      </div>
    </section>
  );
}
