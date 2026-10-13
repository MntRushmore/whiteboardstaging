import type { CSSProperties } from "react";
import { ChevronRight, Lightbulb } from "lucide-react";
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
 *  - the biggest, the board itself (its white and its dot grid): 3(x − 2) = 12 opened up as
 *    3x − 2 = 12; the live tutor circles the slip and writes only the next step beside it,
 *    3x − 6 = 12 (stepInk.ts HELP_SCENE, Help me's own handwritten step);
 *  - a small one with the tutor's check mark (the board's own stroke, InkMark's InkCheck);
 *  - one with the Help me button, as the board draws it.
 *
 * The kid's lines are there from the start; the tutor's circle, its step and the check draw in once
 * the collage is in view (INK_START_SCRIPT, one key for the whole picture). With reduced motion they
 * are simply there. One picture to a screen reader (`role="img"`), its scraps hidden from it.
 * Server-rendered and static.
 */

const KEY = "honest";

/** Board units of paper round the scene's ink: a margin, so a scrap's tear never meets a stroke. */
const PAD = { x: 44, y: 38 } as const;

/** The tutor's strokes on the board scrap: the circle, a breath, then the step at its writing pace. */
function tutorTimes() {
  let t = 350;
  return HELP_SCENE.strokes.map((stroke) => {
    if (stroke.ink !== "tutor") return null;
    const ring = stroke.len > 200;
    const forMs = ring ? 720 : Math.round(Math.min(380, Math.max(110, stroke.len * 7)));
    const at = t;
    t += forMs + (ring ? 240 : 70);
    return { atMs: at, forMs };
  });
}
const TIMES = tutorTimes();
/** When the step is written: the check follows it. */
const STEP_DONE_MS = Math.max(...TIMES.map((x) => (x ? x.atMs + x.forMs : 0)));

/** Each scrap's torn outline, shaped at its size on a laptop. */
const OUTLINES = {
  board: tornOutline({ seed: 71, width: 540, height: 226, depth: 6, step: [6, 13] }),
  check: tornOutline({ seed: 73, width: 150, height: 140, depth: 5, step: [5, 11] }),
  help: tornOutline({ seed: 79, width: 250, height: 96, depth: 5, step: [5, 11] }),
} as const;

const vars = (v: Record<string, string>) => v as CSSProperties;

/** The board's scrap: its white, its dot grid, and the kid's lines with the tutor's ink on them. */
function BoardScrap() {
  const w = HELP_SCENE.width + 2 * PAD.x;
  const h = HELP_SCENE.height + 2 * PAD.y;
  return (
    <div className={`${styles.scrap} ${styles.board}`} style={{ clipPath: OUTLINES.board, aspectRatio: `${w} / ${h}` }}>
      <svg className={styles.ink} viewBox={`${-PAD.x} ${-PAD.y} ${w} ${h}`}>
        <defs>
          <pattern id="lp-honest-dots" width="24" height="24" patternUnits="userSpaceOnUse" x={-PAD.x} y={-PAD.y}>
            <circle className={styles.dot} cx="12" cy="12" r="1.3" />
          </pattern>
        </defs>
        <rect x={-PAD.x} y={-PAD.y} width={w} height={h} fill="url(#lp-honest-dots)" />
        {HELP_SCENE.strokes.map((stroke, i) => {
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
