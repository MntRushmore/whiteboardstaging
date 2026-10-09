"use client";

import { BoardReplay } from "@/components/replay/BoardReplay";
import { useReplayBoard } from "@/components/replay/ReplayCanvas";

/**
 * The replay itself (tldraw, the board's shapes, the player): its own chunk, fetched by ReplayScreen
 * once the board has been read, so none of it is in the report page's bundle. Opens in Replay mode,
 * ready to play. Read-only, like the admin's viewer it shares (src/components/replay/BoardReplay.tsx).
 */
export default function ReplayBody({ snapshot }: { snapshot: unknown }) {
  const { board, timeline } = useReplayBoard(snapshot);
  return <BoardReplay board={board} timeline={timeline} initialMode="replay" />;
}
