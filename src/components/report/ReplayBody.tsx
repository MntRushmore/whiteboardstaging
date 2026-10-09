"use client";

import { useCallback } from "react";
import { BoardReplay } from "@/components/replay/BoardReplay";
import type { ReplayPlayer } from "@/components/replay/player";
import { useReplayBoard } from "@/components/replay/ReplayCanvas";

/**
 * The replay itself (tldraw, the board's shapes, the player): its own chunk, fetched by ReplayScreen
 * once the board has been read, so none of it is in the report page's bundle. "Watch them solve it"
 * means watch: it opens in Replay mode and starts playing at once (unless the reader asked for
 * reduced motion, when it waits for Play). Read-only, like the admin's viewer it shares
 * (src/components/replay/BoardReplay.tsx).
 */
export default function ReplayBody({ snapshot }: { snapshot: unknown }) {
  const { board, timeline } = useReplayBoard(snapshot);
  // Played from the start once the canvas is up (the player pauses whenever its canvas detaches, so
  // playing before that would stop at once), and never after the reader paused or moved it.
  const onPlayer = useCallback(
    (player: ReplayPlayer) => {
      const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (timeline.items.length === 0 || still) return;
      let frames = 0;
      const startWhenReady = () => {
        const s = player.getState();
        if (s.playing || s.ended || s.ms > 0) return;
        if (player.getEditor()) {
          player.play();
          return;
        }
        // about ten seconds for tldraw to mount, then the Play button is the reader's
        if (++frames < 600) requestAnimationFrame(startWhenReady);
      };
      requestAnimationFrame(startWhenReady);
    },
    [timeline],
  );
  return <BoardReplay board={board} timeline={timeline} initialMode="replay" onPlayer={onPlayer} />;
}
