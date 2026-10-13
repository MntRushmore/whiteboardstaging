import type { CSSProperties } from "react";
import { getImageProps } from "next/image";
import type { HeroSceneImage, SceneBoard, ScenePoint } from "@/lib/landing/heroScene";
import { inkBounds, paintedInk, type PaintedLine } from "@/lib/landing/sceneInk";
import { tornOutline } from "@/lib/landing/torn";
import { INK_DRAW_ATTR } from "./inkStart";
import ink from "./ink.module.css";
import styles from "./paper.module.css";

/**
 * The hero's painted scene (v4): a storybook painting of a boy writing on a tablet at the kitchen
 * table (src/lib/landing/heroScene.ts), printed on a sheet of paper with a white margin and torn out
 * by hand. A phone (under 700 px) gets its own crop, the boy and the tablet.
 *
 * The painted tablet's screen is blank, and real ink is drawn onto it (`ScreenInk`): a line in the
 * kid's pen, written in the board's hand (handInk, HandMath's engine) from just right of his stylus,
 * and the tutor's check mark after it (the board's own tick, InkCheck's). Laid out on a flat screen
 * and projected onto the painted one, point by point, on the server (sceneInk.ts): one static SVG in
 * the painting's pixels. It draws once in view (INK_START_SCRIPT), and with reduced motion it is
 * simply there. The ink multiplies into the paint, as ink on a screen in a painting would.
 *
 * Without `src` (before the art came) it is a flat warm block of the same size, labelled "painting"
 * in development only. Putting art in is one line in Hero.tsx (`HERO_ART`).
 */
export interface HeroSceneProps {
  /** the painting, e.g. "/landing/v4/hero-scene.webp"; without it, the placeholder */
  src?: string;
  alt?: string;
  /** the file's own size in px */
  width?: number;
  height?: number;
  /** the tablet's blank screen in the painting, and where the stylus touches it: ink is drawn there */
  board?: SceneBoard | null;
  penTip?: ScenePoint | null;
  /** how much of the painting's bottom, in its own px, the wide layout leaves out (quiet tabletop) */
  cropBottom?: number;
  /** a phone's own crop (under 700 px), with its own screen and pen tip */
  phone?: HeroSceneImage;
  className?: string;
}

/** The paper's torn outline, shaped at the hero's widest (the wide measure, the cropped painting plus its margin). */
const OUTLINE = tornOutline({ seed: 47, width: 1280, height: 640, depth: 7, step: [10, 20] });

/** The painting is shown at the wide measure, the page's gutters either side. */
const SIZES = "(max-width: 699px) calc(100vw - 32px), (max-width: 1360px) calc(100vw - 80px), 1280px";

/** One key for the ink on both crops: whichever is on screen starts it. */
const KEY = "hero-scene";

/**
 * The line on the painted screen: the first of the replay's sums (BoardReplay, right after the hero),
 * so the painting's tablet and the real board say the same thing.
 */
const LINE: PaintedLine = { latex: "7+5=12", size: 112, seed: 4, startMs: 500 };

const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(3)}%`;

/**
 * The ink, projected onto the painting's tablet: an SVG in the painting's own px, just the ink's box
 * (so it starts drawing as soon as the tablet is in view), laid over the painting where that box is.
 * `shown` is how much of the painting's height is on the page (all of it, unless cropped).
 */
function ScreenInk({ image, shown, className }: { image: Pick<HeroSceneImage, "width" | "board" | "penTip">; shown: number; className: string }) {
  if (!image.board || !image.penTip) return null;
  const { strokes } = paintedInk(image.board, image.penTip, LINE);
  const box = inkBounds(strokes);
  const place: CSSProperties = { left: pct(box.x, image.width), top: pct(box.y, shown), width: pct(box.width, image.width), height: pct(box.height, shown) };
  return (
    <svg
      className={`${styles.sceneInk} ${ink.draw} ${className}`}
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      preserveAspectRatio="none"
      style={place}
      aria-hidden
      {...{ [INK_DRAW_ATTR]: KEY }}
    >
      {strokes.map((s, i) => (
        <path
          key={i}
          d={s.d}
          pathLength={1}
          className={s.ink === "kid" ? ink.kid : ink.tutor}
          strokeWidth={s.width}
          style={{ "--at": `${s.atMs}ms`, "--for": `${s.forMs}ms` } as CSSProperties}
        />
      ))}
    </svg>
  );
}

export function HeroScene({ src, alt = "", width = 1600, height = 900, board = null, penTip = null, cropBottom = 0, phone, className }: HeroSceneProps) {
  const shown = height - cropBottom;
  const ratio = { "--ar": `${width} / ${shown}`, "--ar-phone": phone ? `${phone.width} / ${phone.height}` : `${width} / ${shown}` } as CSSProperties;
  return (
    <div className={className ? `${styles.scene} ${className}` : styles.scene}>
      <div className={styles.scenePaper} style={{ clipPath: OUTLINE }}>
        {src ? (
          <div className={styles.sceneFrame} style={ratio}>
            <Painting src={src} alt={alt} width={width} height={height} phone={phone} />
            <ScreenInk image={{ width, board, penTip }} shown={shown} className={phone ? styles.wideInk : ""} />
            {phone && <ScreenInk image={phone} shown={phone.height} className={styles.phoneInk} />}
          </div>
        ) : (
          <div className={`${styles.sceneArt} ${styles.scenePlaceholder}`} aria-hidden>
            {process.env.NODE_ENV === "development" && <span className={styles.sceneLabel}>painting</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** The painting, and a phone's crop in its place under 700 px (one file loaded, never both). */
function Painting({ src, alt, width, height, phone }: { src: string; alt: string; width: number; height: number; phone?: HeroSceneImage }) {
  const common = { alt, sizes: SIZES, loading: "eager", fetchPriority: "high" } as const;
  const { props: wide } = getImageProps({ ...common, src, width, height });
  if (!phone) {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- getImageProps' own img, its alt included
    return <img {...wide} className={styles.sceneArt} />;
  }
  const { props: small } = getImageProps({ ...common, alt: phone.alt, src: phone.src, width: phone.width, height: phone.height });
  return (
    <picture>
      <source media="(max-width: 699px)" srcSet={small.srcSet} sizes={small.sizes} width={phone.width} height={phone.height} />
      {/* eslint-disable-next-line jsx-a11y/alt-text -- getImageProps' own img, its alt included (inside a picture, Next allows a plain img) */}
      <img {...wide} className={styles.sceneArt} />
    </picture>
  );
}
