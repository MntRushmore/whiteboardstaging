"use client";

import { useCallback, useMemo, useState } from "react";
import { History, ListChecks, TriangleAlert } from "lucide-react";
import type { AdminBoardDoc } from "@/lib/admin/contracts";
import { BoardReplay } from "@/components/replay/BoardReplay";
import { useReplayBoard } from "@/components/replay/ReplayCanvas";
import { realToReplay } from "@/lib/replay/timeline";
import { replaySummary, workMinutes } from "@/lib/replay/summary";
import { ADMIN_BOARD_COPY, attemptRows, eventRows, historyRows } from "./view";
import styles from "./adminBoard.module.css";

/** "128 strokes · 7 ticks · 2 rings · 5 screens · 14 min of work · 2 fixed" */
function summaryText(s: ReturnType<typeof replaySummary>): string {
  const parts = [`${s.strokes} ${s.strokes === 1 ? "stroke" : "strokes"}`, `${s.ticks} ${s.ticks === 1 ? "tick" : "ticks"}`, `${s.rings} ${s.rings === 1 ? "ring" : "rings"}`, `${s.screens} ${s.screens === 1 ? "screen" : "screens"}`];
  const min = workMinutes(s);
  if (min !== null) parts.push(`${min} min of work`);
  if (s.fixed) parts.push(`${s.fixed} fixed`);
  return parts.join(" · ");
}

/**
 * The viewer's own chunk (tldraw and the replay): the player, then what happened on the board —
 * the problems worked (outcome, the problem as text), its errors (a tap shows the board at that
 * moment, when the board has times) and its saved versions.
 */
export default function AdminBoardBody({ doc, now }: { doc: AdminBoardDoc; now: number }) {
  const { board, timeline } = useReplayBoard(doc.snapshot, { revealHidden: true });
  const [jumpTo, setJumpTo] = useState<{ at: number } | null>(null);
  const clock = useMemo(() => ({ now }), [now]);
  const attempts = useMemo(() => attemptRows(doc.attempts, clock), [doc.attempts, clock]);
  const errors = useMemo(() => eventRows(doc.events, clock), [doc.events, clock]);
  const history = useMemo(() => historyRows(doc.history, clock), [doc.history, clock]);
  const summary = useMemo(() => replaySummary(timeline, { fixed: doc.attempts.filter((a) => a.outcome === "self_corrected").length }), [timeline, doc.attempts]);
  const markers = useMemo(() => errors.map((e) => ({ at: e.at, label: e.title, tone: e.level === "error" ? ("error" as const) : ("warn" as const) })), [errors]);
  const canJump = timeline.timedShare > 0;
  const jump = useCallback((at: number) => setJumpTo({ at }), []);

  return (
    <div className={styles.layout}>
      <div className={styles.playerCol}>
        <p className={styles.summary}>{summaryText(summary)}</p>
        <BoardReplay board={board} timeline={timeline} events={markers} jumpTo={jumpTo} />
      </div>

      <aside className={styles.side}>
        <section className={styles.sideSection} aria-labelledby="board-attempts">
          <h2 id="board-attempts" className={styles.sideTitle}>
            <ListChecks size={16} aria-hidden />
            {ADMIN_BOARD_COPY.attemptsTitle}
          </h2>
          {attempts.length === 0 ? (
            <p className={styles.quiet}>{ADMIN_BOARD_COPY.attemptsEmpty}</p>
          ) : (
            <ul className={styles.list}>
              {attempts.map((a) => (
                <li key={a.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.problem}>{a.problem}</span>
                    <span className={styles.badge} data-tone={a.outcome.tone}>
                      {a.outcome.label}
                    </span>
                  </div>
                  <p className={styles.rowDetail}>
                    {a.detail} · {a.when}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.sideSection} aria-labelledby="board-errors">
          <h2 id="board-errors" className={styles.sideTitle}>
            <TriangleAlert size={16} aria-hidden />
            {ADMIN_BOARD_COPY.errorsTitle}
          </h2>
          {errors.length === 0 ? (
            <p className={styles.quiet}>{ADMIN_BOARD_COPY.errorsEmpty}</p>
          ) : (
            <ul className={styles.list}>
              {errors.map((e) => {
                const at = canJump ? realToReplay(timeline, e.at) : null;
                const body = (
                  <>
                    <div className={styles.rowHead}>
                      <span className={styles.errorTitle} data-level={e.level}>
                        {e.title}
                      </span>
                      <span className={styles.when}>{e.when}</span>
                    </div>
                    <p className={styles.rowDetail}>{e.message}</p>
                  </>
                );
                return (
                  <li key={e.id} className={styles.row}>
                    {at !== null ? (
                      <button type="button" className={styles.rowButton} onClick={() => jump(e.at)} title={ADMIN_BOARD_COPY.errorsJumpHint}>
                        {body}
                      </button>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={styles.sideSection} aria-labelledby="board-history">
          <h2 id="board-history" className={styles.sideTitle}>
            <History size={16} aria-hidden />
            {ADMIN_BOARD_COPY.historyTitle}
          </h2>
          <p className={styles.quiet}>{ADMIN_BOARD_COPY.historyHint}</p>
          {history.length === 0 ? (
            <p className={styles.quiet}>{ADMIN_BOARD_COPY.historyEmpty}</p>
          ) : (
            <ul className={styles.list}>
              {history.map((h) => (
                <li key={h.id} className={styles.historyRow}>
                  <span>{h.label}</span>
                  <span className={styles.when}>{h.when}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
