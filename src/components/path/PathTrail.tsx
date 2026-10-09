"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import {
  Calculator,
  ChartPie,
  ChartSpline,
  Check,
  DecimalsArrowRight,
  Diff,
  Divide,
  FlaskConical,
  GraduationCap,
  Loader2,
  Lock,
  Minus,
  Percent,
  Plus,
  Scale,
  Shapes,
  Sigma,
  Star,
  TriangleRight,
  Variable,
  X,
} from "lucide-react";
import { ButtonLink } from "@/components/app/ButtonLink";
import { snakeLayout, trailWindow } from "@/lib/path/pathLayout";
import { linkWalked, MAX_STARS, PATH_COPY, type PathIcon, type PathNode, type PathView } from "@/lib/path/pathView";
import { LEVEL_LABELS } from "@/lib/learning/progressView";
import { useCenterCurrent, useTrailShape } from "./useTrail";
import styles from "./path.module.css";

/**
 * The skill path's parts, shared by the home's card (`SkillPathCard`) and the top of the Progress
 * page (`ProgressPath`): the trail of stops, the count, the "Pick your grade" card and the loading
 * shape. A real ordered list of buttons, in teaching order, each named in full for a screen reader;
 * the picture is drawn by `path.module.css` (tokens, a dark theme, still for reduced motion).
 */

const GLYPHS: Readonly<Record<PathIcon, (size: number) => ReactNode>> = {
  add: (s) => <Plus size={s} strokeWidth={2.4} />,
  subtract: (s) => <Minus size={s} strokeWidth={2.4} />,
  addSubtract: (s) => <Diff size={s} strokeWidth={2.2} />,
  multiply: (s) => <X size={s} strokeWidth={2.4} />,
  divide: (s) => <Divide size={s} strokeWidth={2.2} />,
  fraction: (s) => <ChartPie size={s} strokeWidth={2} />,
  decimal: (s) => <DecimalsArrowRight size={s} strokeWidth={2} />,
  percent: (s) => <Percent size={s} strokeWidth={2.2} />,
  ratio: (s) => <Scale size={s} strokeWidth={2} />,
  arithmetic: (s) => <Calculator size={s} strokeWidth={2} />,
  algebra: (s) => <Variable size={s} strokeWidth={2} />,
  functions: (s) => <ChartSpline size={s} strokeWidth={2} />,
  geometry: (s) => <Shapes size={s} strokeWidth={2} />,
  trig: (s) => <TriangleRight size={s} strokeWidth={2} />,
  calculus: (s) => <Sigma size={s} strokeWidth={2} />,
  science: (s) => <FlaskConical size={s} strokeWidth={2} />,
};

/** A stop's picture: the operation's sign, or the skill's area. */
export function PathGlyph({ icon, size = 24 }: { icon: PathIcon; size?: number }) {
  return <>{(GLYPHS[icon] ?? GLYPHS.arithmetic)(size)}</>;
}

/** Three stars, filled as the skill grows. Decorative: the stop's name says how many. */
export function StarRow({ stars, className }: { stars: number; className?: string }) {
  return (
    <span className={[styles.stars, className].filter(Boolean).join(" ")} aria-hidden>
      {Array.from({ length: MAX_STARS }, (_, k) => (
        <Star key={k} size={14} strokeWidth={2} className={k < stars ? styles.starOn : styles.starOff} />
      ))}
    </span>
  );
}

export interface PathTrailProps {
  view: PathView;
  /** a topic board is being made: that stop spins, the others wait */
  busy: string | null;
  onOpen: (node: PathNode) => void;
}

function Stop({ node, cell, walked, busy, onOpen }: { node: PathNode; cell: ReturnType<typeof snakeLayout>[number]; walked: boolean } & Omit<PathTrailProps, "view">) {
  const spinning = busy !== null && busy === node.topic;
  return (
    <li
      className={styles.stop}
      data-stop=""
      data-state={node.state}
      data-link={cell.link ?? undefined}
      data-dir={cell.forward ? "forward" : "back"}
      data-walked={walked || undefined}
      style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }}
    >
      <button
        type="button"
        className={styles.node}
        data-node={node.id}
        aria-label={node.label}
        aria-current={node.state === "current" ? "step" : undefined}
        aria-busy={spinning || undefined}
        disabled={busy !== null}
        onClick={() => onOpen(node)}
      >
        {node.state === "current" && (
          <span className={styles.nextUp} aria-hidden>
            {PATH_COPY.nextUp}
          </span>
        )}
        <span className={styles.slot} aria-hidden>
          <span className={styles.circle}>
            {spinning ? <Loader2 size={24} className={styles.spin} /> : <PathGlyph icon={node.icon} size={node.state === "current" ? 28 : 24} />}
            {node.state === "done" && (
              <span className={styles.badge} data-badge="done">
                <Check size={12} strokeWidth={3.2} />
              </span>
            )}
            {node.state === "upcoming" && (
              <span className={styles.badge} data-badge="locked">
                <Lock size={11} strokeWidth={2.6} />
              </span>
            )}
          </span>
        </span>
        <StarRow stars={node.stars} />
        <span className={styles.name} aria-hidden>
          {node.name}
        </span>
      </button>
    </li>
  );
}

/** The "+10" stop of the home's one row: the rest of a long path, on the Progress page. */
function MoreStop({ count, total, cell, walked }: { count: number; total: number; cell: ReturnType<typeof snakeLayout>[number]; walked: boolean }) {
  return (
    <li
      className={styles.stop}
      data-more=""
      data-state="more"
      data-link={cell.link ?? undefined}
      data-dir="forward"
      data-walked={walked || undefined}
      style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1 }}
    >
      <Link href={PATH_COPY.moreHref} className={styles.node} aria-label={PATH_COPY.moreLabel(total)}>
        <span className={styles.slot} aria-hidden>
          <span className={styles.circle}>
            <span className={styles.moreCount}>+{count}</span>
          </span>
        </span>
        <span className={styles.stars} aria-hidden />
        <span className={styles.name} aria-hidden>
          {PATH_COPY.moreName}
        </span>
      </Link>
    </li>
  );
}

type TrailItem = { kind: "stop"; node: PathNode; index: number } | { kind: "more"; count: number; walked: boolean };

/**
 * The trail: one row that scrolls sideways on a phone (the next stop in the middle), a snake on a
 * wider screen. Done stops are green with three stars, the next one is big and glowing with "Next
 * up", and the stops still to come look locked but open when tapped, like any other. With `oneRow`
 * (the home), a path too long for one row on a wide screen shows the part around the next stop and
 * a "+10" stop that opens the whole path on the Progress page.
 */
export function PathTrail({ view, busy, onOpen, oneRow = false }: PathTrailProps & { oneRow?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const measured = useTrailShape(scrollRef, view.nodes.length);
  useCenterCurrent(scrollRef, measured);

  let items: TrailItem[] = view.nodes.map((node, index) => ({ kind: "stop", node, index }));
  let shape = measured;
  if (oneRow && measured.mode === "snake" && view.nodes.length > measured.fit) {
    const w = trailWindow(view.nodes.length, view.currentIndex, measured.fit);
    items = items.slice(w.start, w.end);
    if (w.after > 0) items.push({ kind: "more", count: w.after, walked: false });
    if (w.before > 0) items.unshift({ kind: "more", count: w.before, walked: linkWalked(view, w.start - 1) });
    shape = { ...measured, cols: items.length };
  }
  const cells = snakeLayout(items.length, shape.cols);

  return (
    <div ref={scrollRef} className={styles.trailFrame} data-mode={shape.mode}>
      <ol className={styles.trail} aria-label={PATH_COPY.listLabel(view.label)} data-mode={shape.mode} style={{ "--cols": shape.cols } as CSSProperties}>
        {items.map((item, i) =>
          item.kind === "stop" ? (
            <Stop key={item.node.id} node={item.node} cell={cells[i]} walked={linkWalked(view, item.index)} busy={busy} onOpen={onOpen} />
          ) : (
            <MoreStop key={`more-${i}`} count={item.count} total={view.total} cell={cells[i]} walked={item.walked} />
          ),
        )}
      </ol>
    </div>
  );
}

/** "2 of 4 done" with a bar that fills as skills are mastered. */
export function PathCount({ view, text }: { view: PathView; text: string }) {
  const percent = view.total > 0 ? Math.round((view.mastered / view.total) * 100) : 0;
  return (
    <div className={styles.count}>
      {/* the bar below says it to a screen reader */}
      <span className={styles.countText} aria-hidden>
        {text}
      </span>
      <span className={styles.countBar} role="progressbar" aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={view.mastered} aria-valuetext={text} aria-label={text}>
        <span className={styles.countFill} style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

/** One, two, three stars: Practicing, Almost there, Mastered (for the grown-up reading Progress). */
export function StarsKey() {
  const levels = ["practicing", "almost", "mastered"] as const;
  return (
    <ul className={styles.key} aria-label={PATH_COPY.starsKey}>
      {levels.map((level, i) => (
        <li key={level}>
          <StarRow stars={i + 1} className={styles.keyStars} />
          <span>{LEVEL_LABELS[level]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Where a card sits: the home spaces it from what comes next; the Progress page's grid does that itself. */
export type PathPlace = "home" | "progress";

/** No grade and no high-school course yet: a friendly nudge to the account page's grade picker. */
export function PickGrade({ place, kid = false }: { place: PathPlace; kid?: boolean }) {
  return (
    <section className={styles.card} data-kind="pick" data-place={place} aria-labelledby="path-pick-title" data-skill-path="pick" data-kid={kid || undefined}>
      <span className={styles.pickIcon} aria-hidden>
        <GraduationCap size={26} strokeWidth={1.8} />
      </span>
      <div className={styles.pickText}>
        <h2 id="path-pick-title" className={styles.title}>
          {kid ? PATH_COPY.kidPickTitle : PATH_COPY.pickTitle}
        </h2>
        <p className={styles.hint}>{kid ? PATH_COPY.kidPickHint : PATH_COPY.pickHint}</p>
      </div>
      {/* a kid's grade is set by their grown-up on /family: nothing for the kid to open */}
      {!kid && (
        <ButtonLink href={PATH_COPY.pickHref} size="lg" className={styles.pickAction}>
          {PATH_COPY.pickAction}
        </ButtonLink>
      )}
    </section>
  );
}

/** Shaped like the card (a title and a row of stops), so nothing jumps when the path arrives. */
export function PathSkeleton({ place }: { place: PathPlace }) {
  return (
    <div className={styles.card} data-place={place} data-skill-path="loading" role="status" aria-label={PATH_COPY.loading} aria-busy>
      <div className={`${styles.skeletonTitle} ${styles.pulse}`} />
      <div className={styles.skeletonRow}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`${styles.skeletonDot} ${styles.pulse}`} />
        ))}
      </div>
    </div>
  );
}
