"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useEditor, type Editor } from "tldraw";
import { CircleCheck, Flame, Home, Pencil, Star, X } from "lucide-react";
import { ConfettiBurst } from "@/components/onboarding/ConfettiBurst";
import { BOARD_BAR_ATTR } from "@/components/live/hintPlacement";
import type { LiveController } from "@/lib/live/contracts";
import { clientMetric } from "@/lib/logger";
import { DAILY_BOARD_COPY } from "@/lib/daily/copy";
import { PILL, pillSpot, type PillSpot } from "@/lib/daily/pill";
import { boardProblems } from "@/lib/daily/progress";
import { useDailyBoard, type BoardProblem } from "./useDailyBoard";
import styles from "./dailyBoard.module.css";

/**
 * A Today's practice board's progress and celebration (src/lib/daily/contracts.ts): loaded with a
 * dynamic import, only on a board with a daily marker (`hasDailyMarker`, read synchronously by the
 * board page).
 *
 * A small pill — "⭐⭐⭐☆☆ 3 of 5" — sits by the board's top bar and lets every touch through, so
 * it never gets in the way of writing. At the day's goal a celebration pops up in the middle:
 * confetti, "You did it! 🔥 4 days in a row", Back home and Keep going (three more problems on a new
 * screen). It closes itself after a little while, so the board is never covered for long.
 *
 * Tiny on purpose: plain buttons and CSS (no motion library), the confetti the home already has,
 * and the planner only fetched when Keep going is tapped.
 */

export interface DailyBoardProps {
  boardId: string;
  userId: string;
  controller: LiveController;
}

/** The celebration closes itself after this long: the board is the student's again. */
export const CELEBRATION_MS = 20_000;

/** The simple board's More (`GrownUpMore`), in the top-right corner beside the bar. */
const MORE_SELECTOR = "[aria-controls=grown-up-more]";

/**
 * Where the pill goes, measured against the board's top bar as it wraps and the board resizes, and
 * against the simple board's More as it comes and goes (lazy, and with the Simple board switch).
 */
function usePillSpot(editor: Editor, active: boolean): PillSpot {
  const [spot, setSpot] = useState<PillSpot>({ top: PILL.top, right: PILL.gap, inline: false });
  useLayoutEffect(() => {
    if (!active) return;
    const container = editor.getContainer();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    // More mounts beside the bar, in the bar's own layer: watched for it coming and going
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => measure());
    const watched = new Set<Element>();
    const watch = (el: Element | null | undefined) => {
      if (el && !watched.has(el) && ro) {
        watched.add(el);
        ro.observe(el);
      }
    };
    function measure() {
      const bar = container.querySelector(`[${BOARD_BAR_ATTR}]`) ?? document.querySelector(`[${BOARD_BAR_ATTR}]`);
      const layer = bar?.parentElement;
      if (layer && mo && !watched.has(layer)) {
        watched.add(layer);
        mo.observe(layer, { childList: true });
      }
      watch(bar);
      const more = layer?.querySelector(MORE_SELECTOR);
      watch(more);
      const box = container.getBoundingClientRect();
      const b = bar?.getBoundingClientRect();
      const m = more?.getBoundingClientRect();
      const next = pillSpot({
        width: box.width,
        bar: b ? { top: b.top - box.top, right: b.right - box.left, bottom: b.bottom - box.top } : null,
        corner: m && m.width > 0 ? { left: m.left - box.left, bottom: m.bottom - box.top } : null,
      });
      setSpot((prev) => (prev.top === next.top && prev.right === next.right && prev.inline === next.inline ? prev : next));
    }
    ro?.observe(container);
    measure();
    return () => {
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [editor, active]);
  return spot;
}

/** Every shape's meta on every screen of the board: the problems the tutor wrote carry theirs (`CHAT_PROBLEM_META`). */
function* shapeMetas(editor: Pick<Editor, "getPages" | "getPageShapeIds" | "getShape">): Generator<unknown> {
  for (const page of editor.getPages()) {
    for (const id of editor.getPageShapeIds(page)) yield editor.getShape(id)?.meta;
  }
}

/** The problems on the board, each once, on every screen (a set cut short is finished from these). */
export function problemsOnBoard(editor: Pick<Editor, "getPages" | "getPageShapeIds" | "getShape">): BoardProblem[] {
  try {
    return boardProblems(shapeMetas(editor));
  } catch {
    return [];
  }
}

/**
 * The slots: a gold star for each problem solved alone, a blue tick for one done with help (Help me
 * is blue: not a star, so a kid counting stars counts only their own), an empty star still to do.
 */
function Stars({ goal, done, stars, size }: { goal: number; done: number; stars: number; size: number }) {
  return (
    <span className={styles.stars} aria-hidden>
      {Array.from({ length: goal }, (_, i) => {
        const kind = i < stars ? "star" : i < done ? "done" : "empty";
        return (
          <span key={i} className={styles.star} data-star={kind} style={{ "--i": i } as CSSProperties}>
            {kind === "done" ? <CircleCheck size={size} strokeWidth={2.4} /> : <Star size={size} strokeWidth={2.2} />}
          </span>
        );
      })}
    </span>
  );
}

/** The pill. Exported for its markup test. */
export function ProgressPill({ goal, done, stars, spot }: { goal: number; done: number; stars: number; spot: PillSpot }) {
  const shown = Math.min(stars, goal);
  const extra = Math.max(0, done - goal);
  return (
    <div className={styles.pill} data-daily-pill="" data-complete={done >= goal ? "" : undefined} style={{ top: spot.top, right: spot.right }} role="img" aria-label={DAILY_BOARD_COPY.pillLabel(shown, done, goal)}>
      <Stars goal={goal} done={Math.min(done, goal)} stars={shown} size={15} />
      <span className={styles.count} aria-hidden>
        {DAILY_BOARD_COPY.pill(done, goal)}
      </span>
      {extra > 0 && (
        <span className={styles.extra} aria-hidden>
          {DAILY_BOARD_COPY.extra(extra)}
        </span>
      )}
    </div>
  );
}

/** The celebration at the goal. Exported for its markup test. */
export function Celebration({ goal, stars, streak, writing, onHome, onKeepGoing, onClose }: { goal: number; stars: number; streak: number; writing: boolean; onHome: () => void; onKeepGoing: () => void; onClose: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  // the big button takes focus (no scroll): Enter keeps going, Esc closes
  useEffect(() => keepRef.current?.focus({ preventScroll: true }), []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return (
    <div className={styles.overlay} data-daily-celebration="">
      <ConfettiBurst count={64} spread={260} className={styles.confetti} />
      <div className={styles.celebrate} role="dialog" aria-modal="false" aria-labelledby="daily-celebrate-title" onKeyDown={onKeyDown}>
        <button type="button" className={styles.close} aria-label={DAILY_BOARD_COPY.close} onClick={onClose}>
          <X size={20} strokeWidth={2.2} aria-hidden />
        </button>
        <span className={styles.badge} aria-hidden>
          <Star size={40} strokeWidth={1.8} />
        </span>
        <h2 id="daily-celebrate-title" className={styles.title}>
          {DAILY_BOARD_COPY.title}
        </h2>
        <p className={styles.streakLine}>
          <Flame size={20} strokeWidth={2.2} aria-hidden className={styles.flame} />
          {DAILY_BOARD_COPY.streak(streak)}
        </p>
        <Stars goal={goal} done={goal} stars={Math.min(stars, goal)} size={28} />
        <p className={styles.starsLine}>{DAILY_BOARD_COPY.stars(Math.min(stars, goal), goal)}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.home} onClick={onHome}>
            <Home size={18} strokeWidth={2.2} aria-hidden />
            {DAILY_BOARD_COPY.home}
          </button>
          <button ref={keepRef} type="button" className={styles.keep} onClick={onKeepGoing} disabled={writing} aria-busy={writing || undefined}>
            <Pencil size={18} strokeWidth={2.2} aria-hidden />
            {DAILY_BOARD_COPY.keepGoing}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DailyBoard({ boardId, userId, controller }: DailyBoardProps) {
  const editor = useEditor();
  const router = useRouter();
  const onBoard = useCallback(() => problemsOnBoard(editor), [editor]);
  const daily = useDailyBoard(boardId, userId, controller, onBoard);
  const spot = usePillSpot(editor, Boolean(daily.marker));
  const { celebrating, dismiss } = daily;

  // the celebration closes itself after a while
  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(dismiss, CELEBRATION_MS);
    return () => clearTimeout(t);
  }, [celebrating, dismiss]);

  if (!daily.marker) return null;
  return (
    <>
      {/* read out once when the goal is reached */}
      <p role="status" aria-live="polite" className={styles.srOnly}>
        {celebrating ? DAILY_BOARD_COPY.announce(daily.streak) : ""}
      </p>
      <ProgressPill goal={daily.goal} done={daily.done} stars={daily.stars} spot={spot} />
      {celebrating && (
        <Celebration
          goal={daily.goal}
          stars={daily.stars}
          streak={daily.streak}
          writing={daily.writing}
          onClose={dismiss}
          onKeepGoing={daily.keepGoing}
          onHome={() => {
            clientMetric("daily.home", {});
            router.push("/");
          }}
        />
      )}
    </>
  );
}
