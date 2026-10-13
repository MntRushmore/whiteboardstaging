"use client";

import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check } from "lucide-react";
import type { Editor, TLEventInfo } from "tldraw";
import { FREE_BOARD_COPY, sheetName } from "@/lib/billing/freeBoardCopy";
import { FREE_BOARD_PROBLEMS, type FreeBoardEnd } from "@/lib/billing/freeBoard";
import { penIsResting } from "@/lib/billing/inkDialog";
import { useOwnProfile } from "@/lib/profile/useOwnProfile";
import styles from "./freeBoardSheet.module.css";

/** How often a waiting sheet looks again whether the pen has rested (as the ink dialog does). */
const CHECK_MS = 250;
/** The longest the sheet waits for the profile's name before it shows without one. */
const NAME_WAIT_MS = 1_500;
/** Today's practice's own celebration (DailyBoard): the sheet waits until it has closed. */
const DAILY_CELEBRATION = "[data-daily-celebration]";

export interface FreeBoardSheetCardProps {
  reason: FreeBoardEnd;
  /** the kid's first name (`sheetName`), or null */
  name: string | null;
  goal?: number;
  onStart: () => void;
  onNotNow: () => void;
  /** the dialog's own title and description parts (the markup test passes plain elements) */
  Title?: typeof DialogPrimitive.Title | "h2";
  Description?: typeof DialogPrimitive.Description | "p";
}

/** What the sheet says: exported for its markup test. */
export function FreeBoardSheetCard({ reason, name, goal = FREE_BOARD_PROBLEMS, onStart, onNotNow, Title = "h2", Description = "p" }: FreeBoardSheetCardProps) {
  const problems = reason === "problems";
  return (
    <div className={styles.card} data-free-board-sheet={reason}>
      {problems && (
        // the tutor's ticks, one per problem: what the free board was for
        <ol className={styles.ticks} aria-hidden>
          {Array.from({ length: goal }, (_, i) => (
            <li key={i} className={styles.tick} style={{ ["--i" as string]: i }}>
              <Check size={18} strokeWidth={3} />
            </li>
          ))}
        </ol>
      )}
      <Title className={styles.title}>{problems ? FREE_BOARD_COPY.problemsTitle(name) : FREE_BOARD_COPY.inkTitle}</Title>
      <Description className={styles.body}>
        {problems ? FREE_BOARD_COPY.problemsBody(name, goal) : FREE_BOARD_COPY.inkBody} {FREE_BOARD_COPY.keepGoing}
      </Description>
      <div className={styles.actions}>
        <button type="button" className={styles.start} onClick={onStart} data-autofocus="">
          {FREE_BOARD_COPY.start}
        </button>
        <button type="button" className={styles.notNow} onClick={onNotNow}>
          {FREE_BOARD_COPY.notNow}
        </button>
      </div>
      <p className={styles.terms}>{FREE_BOARD_COPY.terms}</p>
    </div>
  );
}

export interface FreeBoardSheetProps {
  editor: Editor;
  userId: string;
  reason: FreeBoardEnd;
  /** the sheet came up (the board rests the tutor under it) */
  onOpen?: () => void;
  /** Start your free trial: the plan screen */
  onStart: () => void;
  /** Not now: the board stays, readable; help from here goes to the plan screen */
  onClose: () => void;
}

/**
 * The moment the free board is used up (`useFreeBoard().usedUp`): its 5th problem done ("Nice work,
 * Sam! Sam finished 5 problems.") or its starter ink refused ("That's your free board done."), with
 * one primary Start your free trial (the plan screen) and Not now. Calm on purpose: no confetti (the
 * tutor's own tick has just cheered), the five ticks the board earned, flat colours.
 *
 * Lazy (the board's first load is at its budget): fetched only when the free board ends. It opens
 * once the pen has rested, so it never lands mid-stroke, and after Today's practice's celebration
 * when both arrive together. The name is the profile's display name (its first word), when set.
 */
export default function FreeBoardSheet({ editor, userId, reason, onOpen, onStart, onClose }: FreeBoardSheetProps) {
  const profile = useOwnProfile(userId);
  const [open, setOpen] = useState(false);
  const [waitedForName, setWaitedForName] = useState(false);
  const lastPenAt = useRef(0);

  useEffect(() => {
    // the last line was written a moment ago: the rest is counted from here
    lastPenAt.current = Date.now();
    const onEvent = (info: TLEventInfo) => {
      if (info.type === "pointer") lastPenAt.current = Date.now();
    };
    editor.on("event", onEvent);
    return () => {
      editor.off("event", onEvent);
    };
  }, [editor]);

  useEffect(() => {
    const t = setTimeout(() => setWaitedForName(true), NAME_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  const nameKnown = profile !== undefined || waitedForName;
  useEffect(() => {
    if (open) onOpen?.();
  }, [open, onOpen]);
  useEffect(() => {
    if (open || !nameKnown) return;
    const id = setInterval(() => {
      const pointerDown = editor.inputs.isPointing || editor.inputs.isDragging || editor.inputs.buttons.size > 0;
      const celebrating = typeof document !== "undefined" && document.querySelector(DAILY_CELEBRATION) !== null;
      if (!celebrating && penIsResting({ pointerDown, lastPenAt: lastPenAt.current, now: Date.now() })) setOpen(true);
    }, CHECK_MS);
    return () => clearInterval(id);
  }, [open, nameKnown, editor]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.overlay} />
        <DialogPrimitive.Content
          className={styles.content}
          onOpenAutoFocus={(e) => {
            // the one primary button takes focus: Enter starts the trial, Esc is Not now
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
          }}
        >
          <FreeBoardSheetCard
            reason={reason}
            name={sheetName(profile?.displayName)}
            onStart={onStart}
            onNotNow={onClose}
            Title={DialogPrimitive.Title}
            Description={DialogPrimitive.Description}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
