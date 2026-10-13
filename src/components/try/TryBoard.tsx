"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { TrialWords } from "@/components/landing/TrialWords";
import inkStyles from "@/components/landing/ink.module.css";
import type { TryBandId } from "@/lib/try/contracts";
import type { MarkKind } from "@/lib/live/marks";
import { TRY_COPY } from "./copy";
import { helpScale, inkBox, inkD, markPaths, TRY_HAND_SIZE } from "./tryInk";
import { joinHref, openRow, TryStore, type KidRow, type TryBoardProblem, type TryDeps, type TryNotice, type TryRow, type TryState, type TutorRow } from "./tryModel";
import { latexWords } from "./words";
import styles from "./try.module.css";

/**
 * The try board (/try, docs/TRY-BOARD.md): pick a grade band, the tutor's problem is on the page in
 * its blue hand (server-rendered `HandMath`, handed in as `ink`), write a line on the lined pad
 * under it, and the tutor checks it with its own marks. The state and the server talk are
 * `TryStore` (tryModel.ts); this is the page: the pen, the lines, the marks, the words, the buttons.
 *
 * The pen: pointer events on the open line only (`touch-action: none` there and nowhere else, so
 * the page still scrolls), a finger, an Apple Pencil (a pen seen once turns a resting palm's touches
 * away) or a mouse, one pointer at a time, its moves batched to a frame.
 *
 * Accessibility: the pad is named; the tutor's words (and each verdict) are in a polite live region;
 * the grade, Check my line, Show me a step, Erase and try again, Another problem and Join are all
 * buttons or links; writing is the one thing a keyboard cannot do.
 */

export interface TryBoardProblemView extends TryBoardProblem {
  /** the problem as a screen reader says it */
  words: string;
  /** the problem in the tutor's hand (server-rendered) */
  ink: ReactNode;
}

export interface TryBoardProps {
  problems: readonly TryBoardProblemView[];
  bands: ReadonlyArray<{ id: TryBandId; label: string }>;
  defaultBand: TryBandId;
  /** the contract's TRY_API */
  api: TryDeps["api"];
  /** the contract's TRY_MAX_LINES */
  maxLines: number;
  /** the trial's words, the plan's (`planWords`), and a friend's invite's */
  terms: { usual: string; invited: string };
  /** the tutor's check mark beside "Solved!" (server-rendered, draws itself in) */
  finishMark?: ReactNode;
  /**
   * Inside /start's `try` screen (src/components/start/StartTry.tsx): no Join card (the flow goes on
   * to the plan instead), and the flow hears what happened (`checked`: the tutor checked a line
   * right; `solved`: a problem is finished), each time it changes. The grade picker shows only when
   * there is more than one band to pick from.
   */
  join?: boolean;
  onProgress?: (progress: { checked: boolean; solved: boolean }) => void;
  /** tests: the state to start from, and what the board talks to */
  initial?: Partial<TryState>;
  deps?: Partial<TryDeps>;
}

/** The pens, in CSS px: the kid's marker, the tutor's marks, the tutor's hand. */
const KID_PEN = 3.4;
const MARK_PEN = 3;
const TUTOR_PEN = 4.2;
/** How long each mark takes to draw (ms). */
const MARK_MS: Record<MarkKind, number> = { check: 320, circle: 640, question: 420 };

function browserDeps(api: TryDeps["api"], maxLines: number): TryDeps {
  return {
    fetch: (...args) => fetch(...args),
    storage: () => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    },
    now: () => Date.now(),
    online: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
    api,
    maxLines,
  };
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The status line's words for the board's state, and its tone. */
export function statusFor(state: Pick<TryState, "busy" | "notice" | "solved">, problem: TryBoardProblem | null): { text: string; tone: "prompt" | "busy" | "good" | "nudge" | "warn" | "solved" } {
  if (state.busy === "reading") return { text: TRY_COPY.reading, tone: "busy" };
  if (state.busy === "helping") return { text: TRY_COPY.helping, tone: "busy" };
  const notice: TryNotice | null = state.notice;
  const answer = problem?.oneStep ?? false;
  switch (notice?.kind) {
    case "check":
      return { text: answer ? TRY_COPY.verdict.check : TRY_COPY.verdict.checkNext, tone: "good" };
    case "solved":
      return { text: TRY_COPY.verdict.solved, tone: "solved" };
    case "ring":
      // the engine's own note as it is ("This follows from the circled line. Fix that one first."), else a nudge
      if (notice.note) return { text: notice.nudge, tone: "nudge" };
      return { text: notice.nudge ? `${TRY_COPY.verdict.ring} ${notice.nudge}` : TRY_COPY.verdict.ring, tone: "nudge" };
    case "unread":
      return { text: TRY_COPY.verdict.unread, tone: "nudge" };
    case "unjudged":
      return { text: TRY_COPY.verdict.unjudged, tone: "nudge" };
    case "helped":
      return { text: notice.solves ? TRY_COPY.helpedSolved : TRY_COPY.helped, tone: "good" };
    case "noStep":
      return { text: TRY_COPY.noStep, tone: "nudge" };
    case "full":
      return { text: TRY_COPY.full, tone: "nudge" };
    case "rate":
      return { text: `${TRY_COPY.errors.rate} ${TRY_COPY.errors.rateWhen(notice.retryAfterMs)}`, tone: "warn" };
    case "down":
      return { text: TRY_COPY.errors.down, tone: "warn" };
    case "upstream":
      return { text: TRY_COPY.errors.upstream, tone: "warn" };
    case "offline":
      return { text: TRY_COPY.errors.offline, tone: "warn" };
    case "invalid":
      return { text: TRY_COPY.errors.invalid, tone: "warn" };
    default:
      return { text: TRY_COPY.prompt(answer), tone: "prompt" };
  }
}

/** The mark a kid's line wears, by its verdict. */
function markOf(row: KidRow): MarkKind | null {
  if (row.verdict === "check" || row.verdict === "solved") return "check";
  if (row.verdict === "ring") return "circle";
  if (row.verdict === "unread") return "question";
  return null;
}

function rowWords(row: TryRow, n: number): string | null {
  if (row.kind === "tutor") return TRY_COPY.row.tutor(n, latexWords(row.latex));
  if (row.verdict === "check" || row.verdict === "solved") return TRY_COPY.row.check(n);
  if (row.verdict === "ring") return TRY_COPY.row.ring(n);
  if (row.verdict === "unread") return TRY_COPY.row.unread(n);
  return null;
}

/** A kid's line: the ink in the kid's pen (an unread line's faint), and the tutor's mark drawing itself in. */
function KidInk({ row, width }: { row: KidRow; width: number }) {
  const kind = markOf(row);
  const marked = row.verdict === "unread" ? row.ghost : row.strokes;
  const marks = useMemo(() => {
    const box = kind && marked ? inkBox(marked) : null;
    return kind && box ? markPaths(kind, box, row.id * 7 + 3, width) : [];
  }, [kind, marked, row.id, width]);
  return (
    <svg className={styles.ink} aria-hidden focusable="false">
      {row.ghost && (
        <g className={`${styles.kid} ${styles.ghost}`}>
          {row.ghost.map((s, i) => (
            <path key={i} d={inkD(s)} strokeWidth={KID_PEN} />
          ))}
        </g>
      )}
      <g className={styles.kid}>
        {row.strokes.map((s, i) => (
          <path key={i} d={inkD(s)} strokeWidth={KID_PEN} />
        ))}
      </g>
      {kind && marks.length > 0 && (
        <g key={`${kind}-${row.verdict}`} className={`${styles.mark} ${inkStyles.draw}`} data-mark={kind}>
          {marks.map((d, i) => (
            <path
              key={i}
              d={d}
              pathLength={1}
              strokeWidth={MARK_PEN}
              // the question mark's dot comes after its hook
              style={{ "--at": `${i * MARK_MS[kind]}ms`, "--for": `${i === 0 ? MARK_MS[kind] : 90}ms` } as CSSProperties}
            />
          ))}
        </g>
      )}
    </svg>
  );
}

/** The tutor's step, in its blue hand, at the page's size, writing itself in stroke by stroke. */
function TutorInk({ row, line }: { row: TutorRow; line: { w: number; h: number } }) {
  const scale = helpScale(row.ink, TRY_HAND_SIZE, line.h, line.w - 24);
  const pen = TUTOR_PEN / scale;
  const pad = pen;
  const w = row.ink.width + 2 * pad;
  const h = row.ink.height + 2 * pad;
  return (
    <svg
      className={`${inkStyles.hand} ${inkStyles.tutor} ${inkStyles.draw} ${styles.tutorInk}`}
      viewBox={`${-pad} ${-pad} ${w} ${h}`}
      width={Math.round(w * scale * 10) / 10}
      height={Math.round(h * scale * 10) / 10}
      aria-hidden
      focusable="false"
      data-tutor-step=""
    >
      {row.ink.strokes.map((s, i) => (
        <path key={i} d={s.d} pathLength={1} strokeWidth={Math.round(pen * s.weight * 100) / 100} style={{ "--at": `${s.atMs}ms`, "--for": `${s.forMs}ms` } as CSSProperties} />
      ))}
    </svg>
  );
}

export function TryBoard({ problems, bands, defaultBand, api, maxLines, terms, finishMark, join: withJoin = true, onProgress, initial, deps }: TryBoardProps) {
  const [store] = useState(() => new TryStore(problems, { ...browserDeps(api, maxLines), ...deps }, defaultBand, initial));
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const problem = (problems.find((p) => p.id === state.problemId) ?? null) as TryBoardProblemView | null;
  const open = openRow(state);
  const answer = problem?.oneStep ?? false;
  const status = statusFor(state, problem);

  const boardRef = useRef<HTMLDivElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLOListElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const [lineSize, setLineSize] = useState({ w: 326, h: 104 });

  // the lines' size, for the marks (kept on the page) and the tutor's step (kept in its line)
  useEffect(() => {
    const list = linesRef.current;
    if (!list) return;
    const measure = () => {
      const line = list.firstElementChild as HTMLElement | null;
      const w = list.clientWidth;
      const h = line?.getBoundingClientRect().height ?? 0;
      if (w > 0 && h > 0) setLineSize((s) => (Math.abs(s.w - w) < 0.5 && Math.abs(s.h - h) < 0.5 ? s : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  // what happened, for /start: only when it changes
  const checked = state.checkedOnce;
  const solved = state.solved === "kid";
  const progressRef = useRef(onProgress);
  useEffect(() => {
    progressRef.current = onProgress;
  });
  useEffect(() => {
    if (checked || solved) progressRef.current?.({ checked, solved });
  }, [checked, solved]);

  useEffect(() => {
    const back = () => store.online();
    window.addEventListener("online", back);
    return () => {
      window.removeEventListener("online", back);
      store.dispose();
    };
  }, [store]);

  // ---------------------------------------------------------------- the pen
  const pointer = useRef<number | null>(null);
  const penSeen = useRef(false);
  const pending = useRef<Array<{ x: number; y: number }>>([]);
  const frame = useRef(0);

  const flush = useCallback(() => {
    frame.current = 0;
    const points = pending.current;
    pending.current = [];
    if (points.length) store.penMove(points);
  }, [store]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = padRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointer.current !== null) return; // one pen at a time
    if (e.pointerType === "pen") penSeen.current = true;
    else if (e.pointerType === "touch" && penSeen.current) return; // a palm resting while the Pencil writes
    const p = local(e);
    if (!store.penDown(p.x, p.y)) return;
    pointer.current = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // capture is a nicety: the stroke still ends on pointerup
    }
    e.preventDefault();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointer.current) return;
    const coalesced = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    for (const ev of coalesced.length ? coalesced : [e.nativeEvent]) pending.current.push(local(ev));
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointer.current) return;
    pointer.current = null;
    if (frame.current) cancelAnimationFrame(frame.current);
    flush();
    store.penUp();
  };

  // ---------------------------------------------------------------- the buttons
  const anotherProblem = () => {
    store.nextProblem();
    const smooth = !prefersReducedMotion();
    boardRef.current?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
    problemRef.current?.focus({ preventScroll: true });
  };

  const canCheck = !!open && open.strokes.length > 0 && open.verdict === null && !state.busy && !state.drawing;
  const canHelp = !!open && !state.busy && !state.drawing;
  const join = typeof window === "undefined" ? joinHref("") : joinHref(window.location.search);
  // the card says "like this" only once the tutor has checked one of the visitor's lines here
  const shown = state.checkedOnce;

  return (
    <div className={styles.board} ref={boardRef}>
      {bands.length > 1 && (
        <fieldset className={styles.bands}>
          <legend className={styles.srOnly}>{TRY_COPY.bands}</legend>
          {bands.map((band) => (
            <label key={band.id} className={styles.band}>
              <input type="radio" name="try-band" value={band.id} checked={state.band === band.id} onChange={() => store.selectBand(band.id)} className={styles.bandInput} />
              <span className={styles.bandFace}>{band.label}</span>
            </label>
          ))}
        </fieldset>
      )}

      <div className={styles.paper} data-solved={state.solved ? "" : undefined}>
        <BoardDots />
        <div className={styles.problemRow}>
          <div className={styles.problem} ref={problemRef} tabIndex={-1} role="img" aria-label={problem ? TRY_COPY.problem(problem.words) : undefined}>
            {/* keyed: a new problem's ink mounts afresh, so the tutor writes it in */}
            <Fragment key={problem?.id}>{problem?.ink}</Fragment>
          </div>
          <button type="button" className={styles.another} onClick={anotherProblem} title={TRY_COPY.another}>
            <RotateCw size={16} strokeWidth={2} aria-hidden />
            <span className={styles.anotherWords}>{TRY_COPY.another}</span>
          </button>
        </div>

        <ol className={styles.lines} ref={linesRef} aria-label={TRY_COPY.lines}>
          {state.rows.map((row, i) => {
            const isOpen = row === open;
            const words = rowWords(row, i + 1);
            const empty = row.kind === "kid" && row.strokes.length === 0 && !row.ghost;
            return (
              <li
                key={row.id}
                className={styles.line}
                data-open={isOpen ? "" : undefined}
                data-reading={isOpen && state.busy === "reading" ? "" : undefined}
                data-verdict={row.kind === "tutor" ? "tutor" : (row.verdict ?? undefined)}
              >
                {row.kind === "kid" ? <KidInk row={row} width={lineSize.w} /> : <TutorInk row={row} line={lineSize} />}
                {isOpen && empty && (
                  <span className={styles.placeholder} aria-hidden>
                    {TRY_COPY.writeHere(answer && i === 0)}
                  </span>
                )}
                {isOpen && (
                  <div
                    ref={padRef}
                    className={styles.pad}
                    role="group"
                    aria-label={TRY_COPY.pad(i + 1, answer && i === 0)}
                    data-try-pad=""
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerEnd}
                    onPointerCancel={onPointerEnd}
                    onLostPointerCapture={onPointerEnd}
                  />
                )}
                {words && <span className={styles.srOnly}>{words}</span>}
              </li>
            );
          })}
        </ol>
      </div>

      <div className={styles.status}>
        {/* one live region for everything the tutor says, so each change is announced */}
        <p className={state.solved ? styles.finish : styles.statusText} role="status" aria-live="polite" data-tone={status.tone}>
          {state.solved ? (
            <>
              <span aria-hidden>{state.solved === "kid" ? TRY_COPY.finish.title : TRY_COPY.finish.tutorTitle}</span>
              <span className={styles.srOnly}>{status.text}</span>
              {finishMark}
            </>
          ) : (
            status.text
          )}
        </p>
        {state.notice?.kind === "ring" && open?.verdict === "ring" && (
          <button type="button" className={`${styles.button} ${styles.small}`} onClick={() => store.erase()}>
            {TRY_COPY.erase}
          </button>
        )}
      </div>

      <div className={styles.actions}>
        {state.solved || (!open && state.notice?.kind === "full") ? (
          <button type="button" className={styles.button} onClick={anotherProblem}>
            {TRY_COPY.finish.another}
          </button>
        ) : (
          <>
            <button type="button" className={styles.button} onClick={() => void store.check()} disabled={!canCheck}>
              {TRY_COPY.check}
            </button>
            <button type="button" className={`${styles.button} ${styles.helpButton}`} onClick={() => void store.help()} disabled={!canHelp}>
              {TRY_COPY.help}
            </button>
          </>
        )}
      </div>

      <p className={styles.note}>{TRY_COPY.note}</p>

      {withJoin && state.joinOpen && (
        <aside className={styles.join} aria-labelledby="try-join-title" data-try-join="">
          <h2 id="try-join-title" className={styles.joinTitle}>
            {shown ? TRY_COPY.join.title : TRY_COPY.join.titleDown}
          </h2>
          <p className={styles.joinBody}>{shown ? TRY_COPY.join.body : TRY_COPY.join.bodyDown}</p>
          <div className={styles.joinActions}>
            <Link href={join} className={styles.pill}>
              {TRY_COPY.join.cta}
            </Link>
            {/* finished, the board's own button already offers it */}
            {!state.solved && (
              <button type="button" className={styles.quiet} onClick={anotherProblem}>
                {TRY_COPY.join.another}
              </button>
            )}
          </div>
          <p className={styles.terms}>
            <TrialWords usual={terms.usual} invited={terms.invited} />
          </p>
        </aside>
      )}
    </div>
  );
}

/** The board's dot grid, 24 px apart (the landing hero's): an SVG pattern, flat. Decorative. */
function BoardDots() {
  return (
    <svg className={styles.dots} aria-hidden focusable="false">
      <defs>
        <pattern id="try-board-dots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="1.1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#try-board-dots)" />
    </svg>
  );
}
