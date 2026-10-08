"use client";

import { useEffect, useMemo, type KeyboardEvent } from "react";
import { Pause, Play } from "lucide-react";
import type { TLRecord } from "tldraw";
import { formatClock, formatRealTime } from "@/lib/replay/format";
import { pageThumbnailSvg, svgDataUrl } from "@/lib/replay/thumbnail";
import { realToReplay, replayToReal, type Timeline } from "@/lib/replay/timeline";
import { DEFAULT_SCREEN, readScreenMeta } from "@/lib/screens/screens";
import type { LoadedBoard } from "./loadBoard";
import { REPLAY_SPEEDS, SEEK_STEP_MS, speedFor, type ReplayMode, type ReplayPlayer } from "./player";
import { ReplayCanvas, useReplayPlayer } from "./ReplayCanvas";
import { Scrubber, type ScrubberMarker } from "./Scrubber";
import styles from "./replay.module.css";

export const REPLAY_COPY = {
  region: "Board viewer",
  modes: { board: "Board", replay: "Replay" },
  modesLabel: "View",
  pages: "Screens",
  play: "Play",
  pause: "Pause",
  speed: "Speed",
  scrubber: "Replay position",
  untimed: "Order from the board (no times saved)",
  empty: "Nothing on this board yet.",
  keys: "Space plays and pauses, ← and → move 5 seconds, Home and End go to the start and the end.",
} as const;

export interface BoardReplayProps {
  board: LoadedBoard;
  timeline: Timeline;
  initialMode?: ReplayMode;
  /** the board's events (errors), at real times: marked on the scrubber when the board has times */
  events?: readonly { at: number; label: string; tone: "error" | "warn" }[];
  /** jump the replay to the moment of this real time (a new object for each request) */
  jumpTo?: { at: number } | null;
  /** the player, for a parent that drives it (the admin's side panel) */
  onPlayer?: (player: ReplayPlayer) => void;
  className?: string;
}

/** A screen's name and thumbnail, for the switcher. */
function usePageChips(records: readonly TLRecord[]) {
  return useMemo(() => {
    const pages = records
      .filter((r) => r.typeName === "page")
      .sort((a, b) => {
        const ia = String((a as { index?: string }).index);
        const ib = String((b as { index?: string }).index);
        return ia < ib ? -1 : ia > ib ? 1 : 0;
      }) as unknown as { id: string; name: string; meta: unknown }[];
    return pages.map((p, i) => ({
      id: p.id,
      name: p.name || `Screen ${i + 1}`,
      src: svgDataUrl(pageThumbnailSvg(records, p.id, readScreenMeta(p.meta) ?? DEFAULT_SCREEN, 128)),
    }));
  }, [records]);
}

/**
 * The board viewer: the final board ("Board": every screen, with a switcher of thumbnails) or its
 * replay ("Replay": play, pause, speed, a scrubber marked with the tutor's ticks and rings and the
 * board's errors, the real time on screen). Pan and zoom freely; the replay moves between screens as
 * the student did. Read-only, and blind to who may watch: it takes a board and its timeline.
 */
export function BoardReplay({ board, timeline, initialMode = "board", events = [], jumpTo = null, onPlayer, className }: BoardReplayProps) {
  // a long lesson starts fast enough to watch in a couple of minutes
  const { player, state } = useReplayPlayer(board, timeline, { mode: initialMode, speed: speedFor(timeline.durationMs, 120_000, 2) });
  const chips = usePageChips(board.records);

  useEffect(() => onPlayer?.(player), [onPlayer, player]);

  // a jump asked for from outside (an error's time in the side panel)
  useEffect(() => {
    if (!jumpTo) return;
    const ms = realToReplay(player.getTimeline(), jumpTo.at);
    if (ms === null) return;
    player.pause();
    player.seek(ms);
  }, [jumpTo, player]);

  const markers = useMemo<ScrubberMarker[]>(() => {
    const out: ScrubberMarker[] = timeline.marks.map((m) => ({ at: m.at, kind: m.kind, label: m.kind === "check" ? "Tick" : m.kind === "circle" ? "Ring" : "Question mark" }));
    if (timeline.timedShare > 0) {
      for (const e of events) {
        const at = realToReplay(timeline, e.at);
        if (at !== null) out.push({ at, kind: e.tone, label: e.label });
      }
    }
    return out;
  }, [timeline, events]);

  const real = state.mode === "replay" ? replayToReal(timeline, state.ms) : timeline.realEnd;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    // a button's own Space is its click: leave it alone
    if (e.key === " " && target.closest("button")) return;
    let handled = true;
    if (e.key === " ") player.toggle();
    else if (e.key === "ArrowLeft") player.seekBy(-SEEK_STEP_MS);
    else if (e.key === "ArrowRight") player.seekBy(SEEK_STEP_MS);
    else if (e.key === "Home") player.seek(0);
    else if (e.key === "End") player.seek(state.durationMs);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const empty = timeline.items.length === 0;

  return (
    <section className={`${styles.player} ${className ?? ""}`} aria-label={REPLAY_COPY.region} onKeyDownCapture={onKeyDown}>
      <div className={styles.topBar}>
        <div className={styles.modes} role="group" aria-label={REPLAY_COPY.modesLabel}>
          {(["board", "replay"] as const).map((m) => (
            <button key={m} type="button" className={styles.modeButton} aria-pressed={state.mode === m} onClick={() => player.setMode(m)} disabled={m === "replay" && empty}>
              {REPLAY_COPY.modes[m]}
            </button>
          ))}
        </div>
        {chips.length > 1 && (
          <nav className={styles.pages} aria-label={REPLAY_COPY.pages}>
            {chips.map((c) => (
              <button key={c.id} type="button" className={styles.pageChip} aria-current={state.pageId === c.id ? "page" : undefined} onClick={() => player.showPage(c.id)} title={c.name}>
                {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG drawn from the records, not a file to optimise */}
                <img src={c.src} alt="" width={128} height={72} className={styles.pageThumb} />
                <span className={styles.pageName}>{c.name}</span>
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className={styles.stage} data-turn={state.pageTurns % 2}>
        <ReplayCanvas player={player} className={styles.canvas} />
        {empty && <p className={styles.emptyNote}>{board.error ?? REPLAY_COPY.empty}</p>}
      </div>

      <div className={styles.transport}>
        <button type="button" className={styles.playButton} onClick={() => player.toggle()} aria-label={state.playing ? REPLAY_COPY.pause : REPLAY_COPY.play} disabled={empty}>
          {state.playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
        </button>
        <Scrubber player={player} ms={state.ms} durationMs={state.durationMs} markers={markers} label={REPLAY_COPY.scrubber} />
        <div className={styles.speeds} role="group" aria-label={REPLAY_COPY.speed}>
          {REPLAY_SPEEDS.map((s) => (
            <button key={s} type="button" className={styles.speedButton} aria-pressed={state.speed === s} onClick={() => player.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <p className={styles.times}>
          <span className={styles.clock}>
            {formatClock(state.ms)} / {formatClock(state.durationMs)}
          </span>
          {real !== null ? <span className={styles.real}>{formatRealTime(real)}</span> : !empty && timeline.timedShare === 0 ? <span className={styles.real}>{REPLAY_COPY.untimed}</span> : null}
        </p>
      </div>
      <p className={styles.keysHint}>{REPLAY_COPY.keys}</p>
    </section>
  );
}
