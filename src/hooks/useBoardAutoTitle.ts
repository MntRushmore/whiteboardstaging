"use client";

import { useCallback, useEffect, useRef } from "react";
import { useValue } from "tldraw";
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { liveStore } from "@/lib/live/liveStore";
import type { SyncState } from "@/lib/sync";
import { trackExitWrite } from "@/lib/boards/exitWrites";
import {
  INITIAL_AUTO_TITLE,
  afterTitleWrite,
  pickTitleLine,
  planTitleWrite,
  type TitleCandidate,
} from "@/lib/boards/boardTitle";

/** `lineId \u0000 title`: a primitive, so the board re-renders only when the candidate changes. */
function candidateKey(): string | null {
  const lines = Object.values(liveStore.lines.get()).map((s) => ({
    id: s.line.id,
    latex: s.latex,
    column: s.line.column,
    row: s.line.row,
  }));
  const picked = pickTitleLine(lines);
  return picked ? `${picked.lineId}\u0000${picked.title}` : null;
}

function parseKey(key: string | null): TitleCandidate | null {
  if (!key) return null;
  const at = key.indexOf("\u0000");
  return { lineId: key.slice(0, at), title: key.slice(at + 1) };
}

/**
 * Names a board still called "Untitled Whiteboard" after the first line of maths Live read on
 * the screen (the transcript in `liveStore.lines`, seeded from the echoes on open), as plain
 * text. It writes only once the board has saved in this session, so opening a board to look
 * at it never touches it (the title write bumps `updated_at` like any other), and again as the
 * page closes. Every write is `... WHERE title = <what we expect>`: a name the student gave the
 * board, here or in another tab, is never replaced. Pure rules in `src/lib/boards/boardTitle.ts`.
 */
export function useBoardAutoTitle(boardId: string, sync: Pick<SyncState, "lastSavedAt" | "pending">): void {
  const key = useValue("board.titleCandidate", candidateKey, []);

  const stateRef = useRef(INITIAL_AUTO_TITLE);
  const candidateRef = useRef<TitleCandidate | null>(null);
  const editedRef = useRef(false);
  // Writes run one after another; each plans from the latest state and candidate.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    candidateRef.current = parseKey(key);
    editedRef.current = sync.lastSavedAt !== null || sync.pending;
  });

  const writeTitle = useCallback((): Promise<void> => {
    const run = async () => {
      const plan = planTitleWrite(stateRef.current, candidateRef.current);
      if (!plan) return;
      const { data, error } = await supabase
        .from("whiteboards")
        .update({ title: plan.title })
        .eq("id", boardId)
        .eq("title", plan.expected)
        .select("id");
      if (error) {
        // Not worth a toast: the name is a nicety and the next save tries again.
        logger.warn({ id: boardId, code: error.code, message: error.message }, "Could not name the board");
        return;
      }
      stateRef.current = afterTitleWrite(stateRef.current, plan, Array.isArray(data) && data.length > 0);
    };
    chainRef.current = chainRef.current.then(run, run);
    return chainRef.current;
  }, [boardId]);

  // After this session's first save, and whenever the first line reads differently after that.
  useEffect(() => {
    if (sync.lastSavedAt === null) return;
    void writeTitle();
  }, [sync.lastSavedAt, key, writeTitle]);

  // Closing the board: name it now if it was edited, tracked so the dashboard waits for it.
  useEffect(
    () => () => {
      if (editedRef.current) trackExitWrite(writeTitle());
    },
    [writeTitle],
  );
}
