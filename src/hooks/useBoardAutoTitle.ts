"use client";

import { useCallback, useEffect, useRef } from "react";
import { useValue, type Editor } from "tldraw";
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { liveStore } from "@/lib/live/liveStore";
import { problemMetaOf } from "@/lib/live/chat/cells";
import { requestTitle } from "@/lib/live/modelCalls";
import type { SyncState } from "@/lib/sync";
import { trackExitWrite } from "@/lib/boards/exitWrites";
import { pickTitleLine, type TitleLine } from "@/lib/boards/boardTitle";
import {
  INITIAL_NAMER,
  SMART_TITLE_DELAY_MS,
  afterNameWrite,
  askedSmart,
  planFirstLine,
  planSmart,
  replaceableTitles,
  shouldAskSmart,
  titleContent,
} from "@/lib/boards/smartTitle";

/** The longest a closing board waits for its smart name before the dashboard reads the list. */
const EXIT_SMART_MS = 2_000;

function studentLines(): TitleLine[] {
  return Object.values(liveStore.lines.get()).map((s) => ({ id: s.line.id, latex: s.latex, column: s.line.column, row: s.line.row }));
}

/** The first-line name (instant, and the fallback): a primitive, so the board re-renders only when it changes. */
function firstLineTitle(): string | null {
  return pickTitleLine(studentLines())?.title ?? null;
}

/** What the student has written, as the namer reads it: changes when a line is read differently. */
function studentContentKey(): string {
  return titleContent(studentLines()).join("\n");
}

/** The chat's problems on this screen (their lines), each once. */
function problemsOnPage(editor: Editor): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const s of editor.getCurrentPageShapes()) {
    const p = problemMetaOf(s.meta);
    if (!p) continue;
    const key = p.lines.join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p.lines);
  }
  return out;
}

/**
 * Names a board after what is on it. Right after this session's first save it takes the first
 * line of maths Live read ("2 sin x = 1"); a few seconds after the maths settles it asks for a
 * smart name ("Solving trig equations", POST /api/live/title, uncharged) and writes that over it.
 * It writes only once the board has saved in this session, so opening a board to look at it never
 * touches it (the title write bumps `updated_at` like any other), and again as the page closes.
 *
 * Every write is `… WHERE title IN (<names we may replace>)`: the default, the names this session
 * wrote, and any line's first-line name (what the old namer and the welcome wrote), so a board the
 * student named, here or in another tab, is never renamed. Pure rules in
 * `src/lib/boards/smartTitle.ts` and `boardTitle.ts`.
 */
export function useBoardAutoTitle(editor: Editor, boardId: string, sync: Pick<SyncState, "lastSavedAt" | "pending">): void {
  const firstLine = useValue("board.firstLineTitle", firstLineTitle, []);
  const content = useValue("board.titleContent", studentContentKey, []);

  const stateRef = useRef(INITIAL_NAMER);
  const editedRef = useRef(false);
  const smartRef = useRef<Promise<void> | null>(null);
  // Writes run one after another; each plans from the latest state.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    editedRef.current = sync.lastSavedAt !== null || sync.pending;
  });

  /** Everything the namer reads: the chat's problems, then the student's lines. */
  const currentContent = useCallback((): string[] => titleContent(studentLines(), problemsOnPage(editor)), [editor]);

  const writeTitle = useCallback(
    (plan: (state: typeof INITIAL_NAMER) => string | null, smart: boolean): Promise<void> => {
      const run = async () => {
        const title = plan(stateRef.current);
        if (!title) return;
        const replaceable = replaceableTitles(currentContent(), stateRef.current.own);
        const { data, error } = await supabase.from("whiteboards").update({ title }).eq("id", boardId).in("title", replaceable).select("id");
        if (error) {
          // Not worth a toast: the name is a nicety and the next save tries again.
          logger.warn({ id: boardId, code: error.code, message: error.message }, "Could not name the board");
          return;
        }
        stateRef.current = afterNameWrite(stateRef.current, title, Array.isArray(data) && data.length > 0, smart);
      };
      chainRef.current = chainRef.current.then(run, run);
      return chainRef.current;
    },
    [boardId, currentContent],
  );

  /** Ask for a smart name for what is on the screen now, and write it. Resolves when done (never rejects). */
  const nameSmartly = useCallback(
    (signal?: AbortSignal): Promise<void> => {
      const lines = currentContent();
      const key = lines.join("\n");
      const page = editor.getCurrentPageId();
      if (!shouldAskSmart(stateRef.current, key, page)) return smartRef.current ?? Promise.resolve();
      stateRef.current = askedSmart(stateRef.current, key, page);
      const run = requestTitle({ boardId, lines }, { signal })
        .then((res) => writeTitle((s) => planSmart(s, res.title), true))
        .catch((e: unknown) => {
          // offline, rate limited, the model down: the first-line name stands
          logger.info({ id: boardId, error: e instanceof Error ? e.message : String(e) }, "No smart name for the board");
        });
      smartRef.current = run;
      return run;
    },
    [boardId, currentContent, editor, writeTitle],
  );

  // The instant name, after this session's first save and whenever the first line reads differently.
  useEffect(() => {
    if (sync.lastSavedAt === null) return;
    void writeTitle((s) => planFirstLine(s, firstLine), false);
  }, [sync.lastSavedAt, firstLine, writeTitle]);

  // The smart name, once the maths has been quiet for a moment (and the board has saved).
  useEffect(() => {
    if (sync.lastSavedAt === null || !content) return;
    const timer = setTimeout(() => void nameSmartly(), SMART_TITLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [sync.lastSavedAt, content, nameSmartly]);

  // Closing the board: name it now if it was edited, tracked so the dashboard waits for it.
  useEffect(
    () => () => {
      if (!editedRef.current) return;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), EXIT_SMART_MS);
      const firstLineNow = firstLineTitle();
      trackExitWrite(
        writeTitle((s) => planFirstLine(s, firstLineNow), false)
          .then(() => nameSmartly(abort.signal))
          .finally(() => clearTimeout(timer)),
      );
    },
    [writeTitle, nameSmartly],
  );
}
