"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, ChevronDown, ChevronUp, Smile, Square, Star, Volume2, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import type { LiveController } from "@/lib/live/contracts";
import { ASK_LIMITS } from "@/lib/live/ask/contracts";
import { canStop, CHAT_COPY, followTarget, helloFor, sendsOnKey, spokenWords, WEAK_SPOTS_COPY } from "./chatView";
import { useBoardChat, type SendOptions } from "./useBoardChat";
import { AskMessage } from "./AskMessage";
import { AskMic } from "./voice/AskMic";
import { useAskSpeech } from "./voice/useAskSpeech";
import { CHAT_TOGGLE_ATTR } from "./askButton";
import { hasPlan, isUnlimited } from "@/lib/billing/unlimited";
import { useUnlimited } from "@/lib/billing/useUnlimited";

/** Words to send as soon as the panel is up (the topic picker's "What do you want to work on?"). */
export interface ChatKickoff {
  /** a new id sends again (the board's New topic sheet, a second time) */
  id: number;
  message: string;
}

interface BoardChatPanelProps {
  boardId: string;
  controller: LiveController;
  onClose: () => void;
  kickoff?: ChatKickoff | null;
  /** the kickoff is being sent (the board clears its marker: a reload never sends it twice) */
  onKickoffSent?: () => void;
  /** a bottom sheet pulled up to most of the screen (the page sizes its host); absent: no control */
  tall?: boolean;
  onTallChange?: (tall: boolean) => void;
}

/** A moment after the panel opens, so the board's loop is up when the words go. */
export const KICKOFF_DELAY_MS = 400;
/** Kickoffs sent in this tab (`<boardId>:<id>`): React's development double effects send once. */
const sentKickoffs = new Set<string>();

/**
 * Sends a kickoff's words once, `delayMs` from now (the panel's effect; its cleanup cancels a send
 * not yet made). A kickoff already sent in this tab is never sent again: a remount, or React's
 * development double effects, start it twice.
 */
export function startKickoff(key: string | null, text: string, act: { send: (text: string) => void; sent?: () => void }, delayMs: number = KICKOFF_DELAY_MS): () => void {
  if (!key || !text.trim() || sentKickoffs.has(key)) return () => {};
  const timer = setTimeout(() => {
    if (sentKickoffs.has(key)) return;
    sentKickoffs.add(key);
    act.sent?.();
    act.send(text);
  }, delayMs);
  return () => clearTimeout(timer);
}

/** Forget the kickoffs sent in this tab (tests). */
export function resetKickoffs(): void {
  sentKickoffs.clear();
}

/** The student's grade per user (0 = K … 8; null: high school or not known), read once per tab. */
const grades = new Map<string, number | null>();

/** The grade for the first chips: undefined while it is read (the profile module is a dynamic import). */
function useGrade(userId: string | undefined): number | null | undefined {
  // a read that failed this time (an offline tab): no grade now, and the next open tries again
  const [read, setRead] = useState<{ userId: string; grade: number | null } | null>(null);
  useEffect(() => {
    if (!userId || grades.has(userId)) return;
    let live = true;
    import("@/lib/learning/profile")
      .then(({ readLearnerProfile }) => readLearnerProfile(userId))
      .then((p) => {
        grades.set(userId, p.grade);
        if (live) setRead({ userId, grade: p.grade });
      })
      .catch(() => {
        if (live) setRead({ userId, grade: null });
      });
    return () => {
      live = false;
    };
  }, [userId]);
  if (!userId) return null;
  if (grades.has(userId)) return grades.get(userId) ?? null;
  return read?.userId === userId ? read.grade : undefined;
}

/** Does the screen have work on it (`chatScreen().empty` false)? Never throws. */
function screenHasWorkOn(controller: LiveController): boolean {
  try {
    return controller.chatScreen ? !controller.chatScreen().empty : false;
  } catch {
    return false;
  }
}

/**
 * A phone, upright or sideways: the mic sits small beside the words (`AskMic compact`). An iPad is
 * wider than 639 px and taller than 500 px whichever way it is held.
 */
const PHONE_QUERY = "(max-width: 639px), (max-height: 500px)";

function useIsPhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = typeof window !== "undefined" ? window.matchMedia?.(PHONE_QUERY) : undefined;
      mq?.addEventListener("change", cb);
      return () => mq?.removeEventListener("change", cb);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(PHONE_QUERY).matches : false),
    () => false,
  );
}

/** Near enough the bottom that new words keep the list following them. */
const STICK_PX = 96;

/**
 * Ask (docs/ASK-V2.md): a tutor to talk to beside the board. The kid types, or holds the mic and
 * says it; the answer streams in as rich text with typeset maths (read aloud when the speaker is
 * on), and when it needs the board the tutor writes there in its hand. Docked on the right on a
 * wide screen held sideways, a bottom sheet on a phone or an upright iPad (the page lays it out;
 * this is its content). The words stay here: the board only ever gets maths.
 */
export function BoardChatPanel({ boardId, controller, onClose, kickoff, onKickoffSent, tall, onTallChange }: BoardChatPanelProps) {
  // What an ask costs, only where asks spend ink: a plan not giving free help right now. Not for
  // a subscriber (unlimited), nor on the guided first board (no plan: its starter ink is the tour's).
  const plan = useUnlimited().state;
  const showCost = hasPlan(plan) && !isUnlimited(plan);
  const speech = useAskSpeech();
  // the chat of the screen the board is on: another screen shows its own (docs/ASK-V2.md, "A chat per screen")
  const { messages, busy, send, stop, retry, weakSpot, practiceWeakSpots, hello, screen } = useBoardChat(boardId, controller, speech);
  const grade = useGrade(useAuth().user?.id);
  const isPhone = useIsPhone();
  const [draft, setDraft] = useState("");
  const panelRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stick = useRef(true);

  // does the screen have work on it ("3 more like these" leads the chips)? Read as the panel opens,
  // when the board moves to another screen, and when a finger or the mouse comes back to it
  const [workOn, setWorkOn] = useState(() => ({ screen: screen.id, has: screenHasWorkOn(controller) }));
  if (workOn.screen !== screen.id) setWorkOn({ screen: screen.id, has: screenHasWorkOn(controller) });
  const screenHasWork = workOn.has;
  const setScreenHasWork = (has: boolean) => setWorkOn({ screen: screen.id, has });

  // the topic picker's words, sent once as the student's first ask
  const sendRef = useRef(send);
  const sentRef = useRef(onKickoffSent);
  useEffect(() => {
    sendRef.current = send;
    sentRef.current = onKickoffSent;
  });
  const kickoffId = kickoff ? `${boardId}:${kickoff.id}` : null;
  const kickoffText = kickoff?.message ?? "";
  useEffect(() => startKickoff(kickoffId, kickoffText, { send: (text) => void sendRef.current(text), sent: () => sentRef.current?.() }), [kickoffId, kickoffText]);

  // Another screen's chat is shown from its end, and followed from there.
  useLayoutEffect(() => {
    stick.current = true;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [screen.id]);

  // New words keep the list following them while the kid is at the bottom, but never scroll the
  // kid's own question out of sight: a long answer stops at its top, to be read from there.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !stick.current) return;
    const questions = list.querySelectorAll<HTMLElement>('[data-ask-message="user"]');
    const target = followTarget({
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      lastIsTutor: messages[messages.length - 1]?.role === "tutor",
      // the list is the question's offset parent (`relative`)
      questionTop: questions.length ? questions[questions.length - 1].offsetTop : null,
    });
    if (target > list.scrollTop) list.scrollTop = target;
  }, [messages]);
  const onScroll = () => {
    const list = listRef.current;
    if (list) stick.current = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_PX;
  };

  // typing starts in the box with a mouse and keyboard; on a touch screen (an iPad is wider than a
  // phone, so width alone cannot tell) the on-screen keyboard would come up over the board
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) inputRef.current?.focus();
  }, []);

  // Esc closes: from inside the panel, from the Ask button, or with nothing focused. On the
  // canvas Esc stays the drawing tools'.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const active = document.activeElement;
      const inPanel = Boolean(active && panelRef.current?.contains(active));
      const onToggle = Boolean(active instanceof HTMLElement && active.closest(`[${CHAT_TOGGLE_ATTR}]`));
      if (inPanel || onToggle || !active || active === document.body) {
        speech.stop();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, speech]);

  const grow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };

  const submit = (text: string, opts?: SendOptions) => {
    if (!text.trim() || busy) return;
    // said into the mic: sent as said, and anything typed stays in the box
    if (!opts?.voice) {
      setDraft("");
      requestAnimationFrame(grow);
    }
    stick.current = true;
    void send(text, opts);
  };

  // Words said into the mic: sent as said, or — the tutor still answering — waiting in the box
  // (a kid mid-sentence when the last ask went finishes it; the words are never lost)
  const onSpoken = (said: string) => {
    const next = spokenWords({ busy, draft, said });
    if (next.send) return submit(next.send, { voice: true });
    if (next.draft !== draft) {
      setDraft(next.draft);
      requestAnimationFrame(grow);
    }
  };

  // Stop ends the words and the voice reading them; closing the panel silences it too
  const halt = () => {
    speech.stop();
    stop();
  };
  const close = () => {
    speech.stop();
    onClose();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canStop(messages)) halt();
    else submit(draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sendsOnKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
      e.preventDefault();
      submit(draft);
    }
  };

  const stoppable = canStop(messages);
  const fresh = messages.length === 0;
  const first = helloFor({ hello: hello.hello, grade, screenHasWork, weakSpot: Boolean(weakSpot), screenIndex: screen.index });
  // the chips wait for the grade and the saved hello, so they never change under a finger
  const helloReady = !hello.loading && grade !== undefined;

  return (
    <section
      ref={panelRef}
      aria-label={CHAT_COPY.title}
      data-board-chat=""
      onPointerEnter={() => fresh && setScreenHasWork(screenHasWorkOn(controller))}
      className="flex h-full min-h-0 flex-col bg-white text-slate-900"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 py-1.5 pl-4 pr-1.5">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
          <Smile className="size-5" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold leading-tight">{CHAT_COPY.title}</h2>
          {/* quiet: the chat follows the screen, so the kid knows which screen's chat this is */}
          {screen.index !== null && (
            <p data-ask-screen="" title={CHAT_COPY.screenHint(screen.index)} className="truncate text-[13px] leading-tight text-slate-500">
              {CHAT_COPY.screen(screen.index)}
            </p>
          )}
        </div>
        {/* named for what a tap does ("Stop reading answers out loud" while it reads) */}
        <HeaderButton label={speech.on ? CHAT_COPY.speakerOff : CHAT_COPY.speakerOn} active={speech.on} onClick={speech.toggle}>
          {speech.on ? <Volume2 className="size-5" aria-hidden /> : <VolumeX className="size-5" aria-hidden />}
        </HeaderButton>
        {onTallChange && (
          // only on a bottom sheet: docked beside the board the panel is already full height
          <HeaderButton label={tall ? CHAT_COPY.shrink : CHAT_COPY.grow} className="md:landscape:hidden" onClick={() => onTallChange(!tall)}>
            {tall ? <ChevronDown className="size-5" aria-hidden /> : <ChevronUp className="size-5" aria-hidden />}
          </HeaderButton>
        )}
        <HeaderButton label={CHAT_COPY.close} title={`${CHAT_COPY.close} (Esc)`} onClick={close}>
          <X className="size-5" aria-hidden />
        </HeaderButton>
      </header>

      <div ref={listRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite" aria-busy={busy}>
        {/* one column a young reader can follow: on a wide sheet (an upright iPad) the lines stop at 640 px */}
        <div className={cn(COLUMN, "space-y-4")}>
          {fresh ? (
            <div className="space-y-3" data-ask-hello="">
              {helloReady ? (
                <div className="flex">
                  <p className="max-w-full rounded-2xl rounded-tl-md bg-blue-50 px-4 py-3 text-[17px] leading-[1.55] text-slate-900">{first.greeting}</p>
                </div>
              ) : (
                <div aria-hidden className="h-[52px] w-56 max-w-full rounded-2xl rounded-tl-md bg-slate-100 motion-safe:animate-pulse" />
              )}
              {helloReady && (
                <div className="flex flex-wrap gap-2">
                  {/* the student's own record: problems on what they are learning, made on the device (no ink) */}
                  {weakSpot && (
                    <button type="button" disabled={busy} title={WEAK_SPOTS_COPY.chipHint} onClick={() => void practiceWeakSpots()} className={cn(CHIP, "border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100")}>
                      <Star className="size-4 shrink-0 fill-blue-500 text-blue-500" aria-hidden />
                      {WEAK_SPOTS_COPY.chip}
                    </button>
                  )}
                  {first.chips.map((s) => (
                    <button key={s} type="button" disabled={busy} onClick={() => submit(s)} className={cn(CHIP, "border-slate-200 bg-white text-slate-800 hover:bg-slate-50")}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            messages.map((m) => <AskMessage key={m.id} message={m} busy={busy} onRetry={() => retry(m.id)} onReplay={speech.replay} />)
          )}
        </div>
      </div>

      <form onSubmit={onSubmit} className="shrink-0 border-t border-slate-200 bg-white px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <div className={cn(COLUMN, "flex items-end gap-1 rounded-[26px] border border-slate-300 bg-white py-1 pl-4 pr-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20")}>
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            maxLength={ASK_LIMITS.message}
            // Return sends (sendsOnKey): an iPad's on-screen keyboard labels the key "send", not "return"
            enterKeyHint="send"
            aria-label={CHAT_COPY.title}
            placeholder={CHAT_COPY.placeholder}
            onChange={(e) => {
              setDraft(e.target.value);
              grow();
            }}
            onKeyDown={onKeyDown}
            // 17 px: big enough to read, and never under 16 px (iOS zooms the page into a smaller box)
            className="max-h-[132px] min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[17px] leading-6 text-slate-900 outline-none placeholder:text-slate-400"
          />
          <AskMic compact={isPhone} disabled={busy} onText={onSpoken} />
          {stoppable ? (
            <button type="submit" aria-label={CHAT_COPY.stop} title={CHAT_COPY.stop} className={cn(ROUND, "bg-slate-800 text-white hover:bg-slate-700")}>
              <Square className="size-4 fill-current" aria-hidden />
            </button>
          ) : (
            <button type="submit" aria-label={CHAT_COPY.send} title={CHAT_COPY.send} disabled={busy || !draft.trim()} className={cn(ROUND, "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400")}>
              <ArrowUp className="size-5" strokeWidth={2.5} aria-hidden />
            </button>
          )}
        </div>
        {showCost && <p className={cn(COLUMN, "mt-1.5 px-1 text-xs text-slate-500")}>{CHAT_COPY.cost}</p>}
      </form>
    </section>
  );
}

/** The conversation's column: the panel's width, centered at 640 px at most (about 70 letters a line). */
const COLUMN = "mx-auto w-full max-w-[640px]";

/** A first ask: a 44 px pill a finger finds. */
const CHIP =
  "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-left text-[15px] font-medium leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:cursor-default disabled:opacity-50";

/** The composer's round send / stop. */
const ROUND =
  "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-1 disabled:cursor-default";

/** A 44 px round header button; `active` tints it (the speaker while it reads: its label says what a tap does). */
function HeaderButton({ label, title, active, className, onClick, children }: { label: string; title?: string; active?: boolean; className?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      className={cn(
        "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50",
        active ? "text-blue-700" : "text-slate-500",
        className,
      )}
    >
      {children}
    </button>
  );
}
