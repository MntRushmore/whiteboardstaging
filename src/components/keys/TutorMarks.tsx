/**
 * The tutor's marks and Blocks' small pictures for the Keys page, as flat SVG: the tick (drawn in one
 * stroke), the ring, the Help me mark, the stickers and the shapes' celebrate pose. Cobalt is the
 * tutor's; nothing the kid makes is drawn in it.
 */
import styles from "./keys.module.css";

const COBALT = "#2D5BFF";
const INK = "#14151F";
const SUNNY = "#FFD12E";
const TOMATO = "#FF5A36";

/** A right line: the tutor's tick. */
export function Tick({ label = "Right" }: { label?: string }) {
  return (
    <svg className={styles.tick} viewBox="0 0 44 40" role="img" aria-label={label}>
      <path className={styles.draw} pathLength={1} d="M4 22 L16 34 L40 5" fill="none" stroke={COBALT} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The line that broke: a gentle hand-drawn ring around it. */
export function Ring({ wide = false }: { wide?: boolean }) {
  return (
    <svg className={`${styles.ring} ${wide ? styles.ringWide : ""}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path
        className={styles.draw}
        pathLength={1}
        d="M88 30 C80 10 56 4 38 7 C16 11 3 30 5 52 C7 78 30 95 58 93 C84 91 98 70 95 46 C94 36 90 28 82 22"
        fill="none"
        stroke={COBALT}
        strokeWidth={3.5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The mark (ring, dot, bar) in one colour: Help me's icon. */
export function HelpMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="12" cy="13" r="8" fill="none" stroke={INK} strokeWidth="4.5" />
      <circle cx="26" cy="7" r="4" fill={INK} />
      <rect x="3" y="25" width="22" height="5" rx="2.5" fill={INK} />
    </svg>
  );
}

/** The eye on "Look again.". */
export function Eye() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12 C5 6 9 4 12 4 C15 4 19 6 22 12 C19 18 15 20 12 20 C9 20 5 18 2 12 Z" fill={INK} />
      <circle cx="12" cy="12" r="4.2" fill={SUNNY} />
      <circle cx="12" cy="12" r="2" fill={INK} />
    </svg>
  );
}

export function StarIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={styles.starIcon}>
      <path d="M12 2.5 L14.9 8.6 L21.5 9.4 L16.6 13.9 L17.9 20.5 L12 17.2 L6.1 20.5 L7.4 13.9 L2.5 9.4 L9.1 8.6 Z" fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

/** A practice sticker: a star (done on your own), a ring (done with a hint) or perfect (5 for 5), die-cut on ink. */
export function Sticker({ kind }: { kind: "star" | "ring" | "perfect" }) {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      {kind === "perfect" ? (
        <>
          <circle cx="28" cy="28" r="25" fill="#FFFFFF" />
          <circle cx="28" cy="28" r="21" fill={TOMATO} />
          <path d="M28 12 L32.2 21.2 L42 22.3 L34.7 29 L36.7 38.8 L28 33.9 L19.3 38.8 L21.3 29 L14 22.3 L23.8 21.2 Z" fill={SUNNY} strokeLinejoin="round" />
        </>
      ) : kind === "star" ? (
        <path
          d="M28 4 L34.6 18.3 L50 20.2 L38.6 30.8 L41.6 46.2 L28 38.6 L14.4 46.2 L17.4 30.8 L6 20.2 L21.4 18.3 Z"
          fill={SUNNY}
          stroke="#FFFFFF"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <circle cx="28" cy="28" r="17" fill="none" stroke="#FFFFFF" strokeWidth="16" />
          <circle cx="28" cy="28" r="17" fill="none" stroke={COBALT} strokeWidth="9" />
        </>
      )}
    </svg>
  );
}

/** The shapes, celebrating: only for the end of a set (docs/DESIGN-SYSTEM.md, "The shapes"). */
export function ShapesCelebrate() {
  return (
    <svg width="180" height="106" viewBox="0 0 220 130" aria-hidden="true">
      <circle cx="70" cy="58" r="44" fill={COBALT} />
      <circle cx="70" cy="58" r="26" fill="#FFFFFF" />
      <circle cx="61" cy="52" r="4.5" fill={INK} />
      <circle cx="80" cy="52" r="4.5" fill={INK} />
      <path d="M58 64 C64 72 76 72 82 64" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      <circle cx="150" cy="30" r="16" fill={SUNNY} />
      <rect x="40" y="108" width="140" height="22" rx="11" fill={TOMATO} />
    </svg>
  );
}

const BURST: { shape: "ring" | "bar" | "dot"; color: string; dx: number; dy: number; rot: number }[] = [
  { shape: "dot", color: SUNNY, dx: -180, dy: -110, rot: 0 },
  { shape: "bar", color: TOMATO, dx: -90, dy: -170, rot: 140 },
  { shape: "ring", color: COBALT, dx: 40, dy: -190, rot: 0 },
  { shape: "dot", color: COBALT, dx: 150, dy: -120, rot: 0 },
  { shape: "bar", color: SUNNY, dx: 210, dy: -30, rot: -120 },
  { shape: "ring", color: TOMATO, dx: -230, dy: -10, rot: 0 },
  { shape: "dot", color: TOMATO, dx: 110, dy: 60, rot: 0 },
  { shape: "bar", color: COBALT, dx: -130, dy: 70, rot: 200 },
];

/** Flat confetti of rings, bars and dots (Reduce Motion: none). */
export function Burst() {
  return (
    <div className={styles.burst} aria-hidden="true">
      {BURST.map((b, i) => {
        const size = b.shape === "bar" ? { width: 28, height: 8, borderRadius: 4 } : b.shape === "dot" ? { width: 14, height: 14, borderRadius: 7 } : { width: 20, height: 20, borderRadius: 10 };
        const fill = b.shape === "ring" ? { border: `5px solid ${b.color}` } : { background: b.color };
        return (
          <i
            key={i}
            style={{ ...size, ...fill, ["--dx" as string]: `${b.dx}px`, ["--dy" as string]: `${b.dy}px`, ["--rot" as string]: `${b.rot}deg`, animationDelay: `${i * 25}ms` }}
          />
        );
      })}
    </div>
  );
}
