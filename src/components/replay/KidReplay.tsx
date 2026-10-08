"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Editor, TLPageId } from "tldraw";
import { Check, Clock3, Pause, PenLine, Play, Rabbit, Rocket, RotateCcw, Sparkles, Turtle, Wrench, X } from "lucide-react";
import { CheerPops, type Pop } from "@/components/live/Celebrations";
import { ConfettiBurst } from "@/components/onboarding/ConfettiBurst";
import { confettiPieces } from "@/lib/confetti";
import { celebrate, INITIAL_CELEBRATE, STREAK_FROM, streakText } from "@/lib/live/celebrate";
import { learningBus } from "@/lib/learning/bus";
import { KID_REPLAY_COPY, replaySummary, summaryLine, workMinutes, type ReplaySummary } from "@/lib/replay/summary";
import { buildTimeline, type ReplayItem } from "@/lib/replay/timeline";
import { boardFromStore } from "./loadBoard";
import { REPLAY_SPEEDS, SEEK_STEP_MS, speedFor, type ReplayPlayer } from "./player";
import { ReplayCanvas, useReplayPlayer } from "./ReplayCanvas";
import { Scrubber, type ScrubberMarker } from "./Scrubber";

/** A lively first speed: the whole replay in about 25 seconds (a short board at 1x). */
export function kidSpeed(durationMs: number): number {
  return durationMs <= 10_000 ? 1 : speedFor(durationMs, 25_000, 2);
}

/** how long a cheer stays up (the `celebrate-pop` animation) */
const CHEER_MS = 2200;
/** a cheer's bubble needs about this much room to its right */
const BUBBLE_ROOM = 172;

/** The tutor's ticks cheered again as the replay draws them: the board's own words and confetti. */
function useReplayCheers(playerRef: { current: ReplayPlayer | null }) {
  const [pops, setPops] = useState<Pop[]>([]);
  const [said, setSaid] = useState("");
  const state = useRef(INITIAL_CELEBRATE);
  const seq = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const marks = useRef(new Set<string>());

  useEffect(() => {
    const live = timers.current;
    return () => live.forEach((t) => clearTimeout(t));
  }, []);

  const clear = useCallback(() => setPops([]), []);
  const reset = useCallback(() => {
    state.current = INITIAL_CELEBRATE;
    marks.current = new Set();
    setPops([]);
  }, []);

  const onItems = useCallback(
    (items: ReplayItem[]) => {
      const editor = playerRef.current?.getEditor();
      if (!editor) return;
      for (const item of items) {
        if (!item.mark || !item.lineId || item.by !== "tutor") continue;
        // one cheer per line and verdict, on its first stroke
        const key = `${item.lineId}|${item.mark}`;
        if (marks.current.has(key)) continue;
        marks.current.add(key);
        if (item.mark !== "check" && item.mark !== "circle") continue;
        const { state: next, cheer } = celebrate(state.current, item.lineId, item.mark);
        state.current = next;
        // a ring in a replay is history: the streak starts again, but no "so close" for it
        if (!cheer || cheer.tone !== "win") continue;
        const shape = editor.getShape(item.id as Parameters<Editor["getShape"]>[0]);
        if (!shape || shape.parentId !== (editor.getCurrentPageId() as TLPageId)) continue;
        const b = editor.getShapePageBounds(shape);
        if (!b) continue;
        const v = editor.getViewportScreenBounds();
        // beside the tick when there is room (as on the board), else just above it (a phone)
        const right = editor.pageToScreen({ x: b.maxX + 12, y: b.midY });
        const above = editor.pageToScreen({ x: b.midX, y: b.minY });
        const beside = v.x + v.w - right.x >= BUBBLE_ROOM;
        const x = Math.min(Math.max(beside ? right.x : above.x - 60, v.x + 12), v.x + v.w - BUBBLE_ROOM);
        const y = Math.min(Math.max(beside ? right.y : above.y - 30, v.y + 40), v.y + v.h - 40);
        const id = ++seq.current;
        const pieces = cheer.burst === "big" ? confettiPieces(36, 110) : confettiPieces(16, 64);
        setPops((all) => [...all.slice(-2), { id, cheer, x, y, pieces }]);
        setSaid(cheer.streak >= STREAK_FROM ? `${cheer.text} ${streakText(cheer.streak)}` : cheer.text);
        const done = setTimeout(() => {
          timers.current.delete(done);
          setPops((all) => all.filter((p) => p.id !== id));
        }, CHEER_MS);
        timers.current.add(done);
      }
    },
    [playerRef],
  );

  return { pops, said, onItems, reset, clear };
}

/** the end card waits this long after the replay ends, so its last cheer is seen first */
const DONE_DELAY_MS = 1200;

function SpeedIcon({ speed }: { speed: number }) {
  if (speed <= 2) return <Turtle className="size-5" aria-hidden />;
  if (speed <= 8) return <Rabbit className="size-5" aria-hidden />;
  return <Rocket className="size-5" aria-hidden />;
}

function Stat({ icon, value, label, tone }: { icon: React.ReactNode; value: number; label: string; tone: string }) {
  return (
    <li className={`flex w-[calc(50%-5px)] min-w-0 items-center gap-3 rounded-2xl px-3 py-3 sm:px-4 ${tone}`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/80 shadow-sm">{icon}</span>
      <span className="grid leading-tight">
        <span className="text-2xl font-extrabold tabular-nums">{value}</span>
        <span className="text-sm font-medium opacity-80">{label}</span>
      </span>
    </li>
  );
}

/** The card at the end: what the student did, big, with confetti. */
function DoneCard({ summary, onAgain, onClose }: { summary: ReplaySummary; onAgain: () => void; onClose: () => void }) {
  const minutes = workMinutes(summary);
  const again = useRef<HTMLButtonElement>(null);
  useEffect(() => again.current?.focus(), []);
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-white/55 p-4 backdrop-blur-[2px]">
      <div role="status" className="relative w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl ring-1 ring-violet-100 animate-in fade-in zoom-in-95 duration-300 motion-reduce:animate-none">
        <ConfettiBurst count={48} spread={170} style={{ left: "50%", top: 24 }} />
        <ConfettiBurst count={28} spread={120} style={{ left: "18%", top: 60 }} />
        <ConfettiBurst count={28} spread={120} style={{ left: "82%", top: 60 }} />
        <Sparkles className="mx-auto size-9 text-amber-400" aria-hidden />
        <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-gray-900">{KID_REPLAY_COPY.doneTitle(summary)}</h2>
        <p className="sr-only">{summaryLine(summary)}</p>
        <ul className="mt-5 flex flex-wrap justify-center gap-2.5 text-left">
          {summary.strokes > 0 && <Stat icon={<PenLine className="size-5 text-violet-600" />} value={summary.strokes} label={summary.strokes === 1 ? "stroke" : "strokes"} tone="bg-violet-50 text-violet-950" />}
          {summary.ticks > 0 && <Stat icon={<Check className="size-5 text-emerald-600" strokeWidth={3} />} value={summary.ticks} label={summary.ticks === 1 ? "line right" : "lines right"} tone="bg-emerald-50 text-emerald-950" />}
          {!!summary.fixed && <Stat icon={<Wrench className="size-5 text-amber-600" />} value={summary.fixed} label={summary.fixed === 1 ? "mistake fixed" : "mistakes fixed"} tone="bg-amber-50 text-amber-950" />}
          {minutes !== null && <Stat icon={<Clock3 className="size-5 text-sky-600" />} value={minutes} label={minutes === 1 ? "minute of work" : "minutes of work"} tone="bg-sky-50 text-sky-950" />}
        </ul>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <button
            ref={again}
            type="button"
            onClick={onAgain}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-violet-600 px-6 text-base font-bold text-white shadow-md transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-300"
          >
            <RotateCcw className="size-5" aria-hidden />
            {KID_REPLAY_COPY.again}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-12 items-center justify-center rounded-full border-2 border-gray-200 bg-white px-6 text-base font-semibold text-gray-800 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200"
          >
            {KID_REPLAY_COPY.back}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Replay my board": the student's own board drawn again, stroke by stroke, full screen, at a lively
 * speed — the tutor's ticks cheered as they land — and a card of what they did at the end. Plays the
 * board open right now (its records as they are: no copy, no network). Loaded on first open only
 * (the board page imports it lazily), so none of it is in the board's first load.
 */
export default function KidReplay({ editor, boardId, onClose }: { editor: Editor; boardId: string; onClose: () => void }) {
  const [board] = useState(() => boardFromStore(editor.store, editor.getCurrentPageId()));
  const timeline = useMemo(() => buildTimeline(board.records), [board]);
  const summary = useMemo(() => {
    const fixed = learningBus.attempts().filter((a) => a.boardId === boardId && a.outcome === "self_corrected").length;
    return replaySummary(timeline, { fixed });
  }, [timeline, boardId]);
  const playerRef = useRef<ReplayPlayer | null>(null);
  const cheers = useReplayCheers(playerRef);
  const onItems = useRef(cheers.onItems);
  useEffect(() => {
    onItems.current = cheers.onItems;
  }, [cheers.onItems]);
  const { player, state } = useReplayPlayer(board, timeline, {
    mode: "replay",
    speed: kidSpeed(timeline.durationMs),
    autoplay: true,
    padding: 10,
    // the student's own writing, as big as the screen allows
    fit: "ink",
    onItemsStarted: (items) => onItems.current(items),
  });
  useEffect(() => {
    playerRef.current = player;
  }, [player]);
  const empty = timeline.items.length === 0;
  const playButton = useRef<HTMLButtonElement>(null);

  // the board underneath stops listening to the keyboard while the replay is up, and Tab stays in
  // the replay (the board's page is inert behind it)
  useEffect(() => {
    const wasFocused = editor.getInstanceState().isFocused;
    editor.blur({ blurContainer: false });
    const root = document.querySelector<HTMLElement>("[data-board-root]");
    const wasInert = root?.inert ?? false;
    if (root) root.inert = true;
    playButton.current?.focus();
    return () => {
      if (root) root.inert = wasInert;
      if (wasFocused) editor.focus({ focusContainer: false });
    };
  }, [editor]);

  const again = useCallback(() => {
    cheers.reset();
    player.seek(0);
    player.play();
  }, [cheers, player]);

  // the card, a moment after each time the replay plays to its end (its last cheer first)
  const [cardFor, setCardFor] = useState(0);
  const { clear: clearCheers } = cheers;
  useEffect(() => {
    if (!state.ended || state.endings === 0) return;
    const timer = setTimeout(() => {
      clearCheers();
      setCardFor(state.endings);
    }, DONE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.ended, state.endings, clearCheers]);
  const showCard = state.ended && cardFor === state.endings && !empty;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") return;
      // nothing reaches the board's shortcuts while the replay is open
      e.stopPropagation();
      const onButton = (e.target as HTMLElement | null)?.closest?.("button");
      if (e.key === "Escape") onClose();
      else if (e.key === " " && !onButton) player.toggle();
      else if (e.key === "ArrowLeft") player.seekBy(-SEEK_STEP_MS);
      else if (e.key === "ArrowRight") player.seekBy(SEEK_STEP_MS);
      else if (e.key === "Home") player.seek(0);
      else if (e.key === "End") player.seek(player.getState().durationMs);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [player, onClose]);

  const markers = useMemo<ScrubberMarker[]>(() => timeline.marks.filter((m) => m.kind === "check").map((m) => ({ at: m.at, kind: m.kind })), [timeline]);
  const nextSpeed = () => {
    const i = REPLAY_SPEEDS.indexOf(state.speed as (typeof REPLAY_SPEEDS)[number]);
    player.setSpeed(REPLAY_SPEEDS[(i + 1) % REPLAY_SPEEDS.length]);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={KID_REPLAY_COPY.title}
      data-testid="kid-replay"
      className="fixed inset-0 z-1300 flex flex-col bg-linear-to-b from-sky-50 via-violet-50 to-fuchsia-50 pb-[env(safe-area-inset-bottom)]"
    >
      <header className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-violet-950 sm:text-xl">
          <Sparkles className="size-5 text-amber-400" aria-hidden />
          {KID_REPLAY_COPY.title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={KID_REPLAY_COPY.close}
          className="grid size-11 place-items-center rounded-full bg-white text-gray-700 shadow-md ring-1 ring-black/5 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-300"
        >
          <X className="size-5" aria-hidden />
        </button>
      </header>

      <main className="relative min-h-0 flex-1 px-3 sm:px-4">
        <div className="relative h-full overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-violet-100">
          {/* one white card: no table round the screen, no screen edge (the camera holds the ink) */}
          <ReplayCanvas
            player={player}
            className="absolute inset-0 [&_.tl-background]:bg-white! **:data-[testid=screen-frame]:border-transparent! **:data-[testid=screen-frame]:bg-white! **:data-[testid=screen-frame]:shadow-none!"
          />
          {empty && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <p className="max-w-xs text-lg font-semibold text-gray-700">{KID_REPLAY_COPY.empty}</p>
            </div>
          )}
          {showCard && <DoneCard summary={summary} onAgain={again} onClose={onClose} />}
        </div>
      </main>

      <footer className="flex items-center gap-3 px-4 pt-3 pb-4 sm:gap-4" style={{ "--r-accent": "#7c3aed" } as CSSProperties}>
        <button
          ref={playButton}
          type="button"
          onClick={() => (state.ended ? again() : player.toggle())}
          disabled={empty}
          aria-label={state.playing ? KID_REPLAY_COPY.pause : KID_REPLAY_COPY.play}
          className="grid size-14 shrink-0 place-items-center rounded-full bg-violet-600 text-white shadow-lg transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-300 disabled:opacity-40 active:scale-95"
        >
          {state.playing ? <Pause className="size-6" fill="currentColor" aria-hidden /> : <Play className="ml-0.5 size-6" fill="currentColor" aria-hidden />}
        </button>
        <div className="min-w-0 flex-1">
          <Scrubber player={player} ms={state.ms} durationMs={state.durationMs} markers={markers} size="lg" label={KID_REPLAY_COPY.scrubber} />
        </div>
        <button
          type="button"
          onClick={nextSpeed}
          disabled={empty}
          aria-label={KID_REPLAY_COPY.speed(state.speed)}
          className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-base font-bold tabular-nums text-violet-900 shadow-md ring-1 ring-violet-100 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-300 disabled:opacity-40"
        >
          <SpeedIcon speed={state.speed} />
          {state.speed}×
        </button>
      </footer>

      <CheerPops pops={cheers.pops} said={cheers.said} zClass="z-1310" />
    </div>,
    document.body,
  );
}
