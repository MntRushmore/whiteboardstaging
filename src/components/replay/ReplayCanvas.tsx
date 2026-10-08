"use client";

// The replay's own bundle carries tldraw's styles: the admin's viewer route loads them only here.
import "tldraw/tldraw.css";
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Tldraw, type TLComponents } from "tldraw";
import { ScreenBackground, ScreenFrame } from "@/components/screens/ScreenFrame";
import { liveShapeUtils } from "@/shapes";
import { buildTimeline, type Timeline } from "@/lib/replay/timeline";
import { loadBoard, type LoadedBoard } from "./loadBoard";
import { ReplayPlayer, type PlayerOptions, type PlayerState } from "./player";
import styles from "./replay.module.css";

/** The board's own look (the screen on its table), and nothing to edit with. */
const COMPONENTS: TLComponents = { Background: ScreenBackground, OnTheCanvas: ScreenFrame };

/** The buttons drawn inside the board's own shapes: an echo's badge, a graph's zoom and close. */
const BADGE = ".live-math__badge, .live-graph__btn";

/** A native capture listener on the canvas's box: a click on one of those stops there. */
function guardBadges(node: HTMLDivElement | null): (() => void) | void {
  if (!node) return;
  const stop = (e: Event) => {
    if ((e.target as Element | null)?.closest?.(BADGE)) {
      e.stopPropagation();
      e.preventDefault();
    }
  };
  node.addEventListener("click", stop, true);
  return () => node.removeEventListener("click", stop, true);
}

/**
 * The read-only canvas a player draws on: a `<Tldraw>` of its own (its own store; no autosave, no
 * Live, no asset uploads; no toolbar or panels: `hideUi`), pan and zoom only. Memoised: the
 * controls re-render every frame, the canvas never does.
 */
export const ReplayCanvas = memo(function ReplayCanvas({ player, className }: { player: ReplayPlayer; className?: string }) {
  return (
    <div
      className={`${styles.root} ${className ?? ""}`}
      data-replay-canvas=""
      // The tutor's echo badges are buttons that ask the board's LiveLoop for a hint (a window event
      // with the line's id, which the replay shares with the board it came from), a graph's buttons
      // rewrite the graph: in a replay they are pictures. Pointer events never reach them (CSS); a
      // keyboard click is stopped here, before React sees it.
      ref={guardBadges}
    >
      <Tldraw
        hideUi
        shapeUtils={liveShapeUtils}
        components={COMPONENTS}
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        autoFocus={false}
        onMount={(editor) => {
          player.attach(editor);
          if (process.env.NODE_ENV !== "production") (window as unknown as { __agathonReplay?: ReplayPlayer }).__agathonReplay = player;
          return () => player.detach();
        }}
      />
    </div>
  );
});

/** A stored board, read and laid out for the replay: its migrated records and its timeline (memoised on the snapshot). */
export function useReplayBoard(snapshot: unknown, opts: { revealHidden?: boolean } = {}): { board: LoadedBoard; timeline: Timeline } {
  const { revealHidden = false } = opts;
  return useMemo(() => {
    const board = loadBoard(snapshot, { revealHidden });
    return { board, timeline: buildTimeline(board.records) };
  }, [snapshot, revealHidden]);
}

/** A player for `board`, kept for the component's life; a new board (following it live) is handed to it. */
export function useReplayPlayer(board: LoadedBoard, timeline: Timeline, opts: PlayerOptions = {}): { player: ReplayPlayer; state: PlayerState } {
  const [player] = useState(() => new ReplayPlayer(board, timeline, opts));
  const shown = useRef(board);
  useEffect(() => {
    if (shown.current === board) return;
    shown.current = board;
    player.setBoard(board, timeline);
  }, [player, board, timeline]);
  useEffect(() => () => player.pause(), [player]);
  const state = useSyncExternalStore(player.subscribe, player.getState, player.getState);
  return { player, state };
}
