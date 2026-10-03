"use client";

import { Suspense, lazy, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LiveController } from "@/lib/live/contracts";
import { CHAT_COPY, CHAT_SUGGESTIONS, sendsOnKey, type ChatMessage } from "./chatView";
import { useBoardChat } from "./useBoardChat";

interface BoardChatPanelProps {
  boardId: string;
  controller: LiveController;
  onClose: () => void;
}

/** Running out of credits: the board dialog's panel, fetched only when a 402 arrives. */
const OutOfCreditsPanel = lazy(() => import("@/components/billing/OutOfCreditsPanel").then((m) => ({ default: m.OutOfCreditsPanel })));

/** A marker the board page gives the Ask button: Esc there closes the panel too. */
export const CHAT_TOGGLE_ATTR = "data-chat-toggle";

/**
 * The board chat: ask in words, the tutor writes it on the board in its hand, and the panel shows
 * a one-line reply. Docked on the right on a desktop, a bottom sheet on a phone (the page lays it
 * out; this is its content). The words stay here — the board only ever gets maths.
 */
export function BoardChatPanel({ boardId, controller, onClose }: BoardChatPanelProps) {
  const { messages, busy, send, retry } = useBoardChat(boardId, controller);
  const [draft, setDraft] = useState("");
  const panelRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // the newest message in view
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

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
      if (inPanel || onToggle || !active || active === document.body) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const grow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    setDraft("");
    requestAnimationFrame(grow);
    void send(text);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sendsOnKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
      e.preventDefault();
      submit(draft);
    }
  };

  return (
    <section ref={panelRef} aria-label={CHAT_COPY.title} data-board-chat="" className="flex h-full min-h-0 flex-col bg-white text-gray-900">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-2.5">
        <h2 className="text-sm font-semibold">{CHAT_COPY.title}</h2>
        <Button variant="ghost" size="icon-sm" aria-label={CHAT_COPY.close} title={`${CHAT_COPY.close} (Esc)`} onClick={onClose}>
          <X />
        </Button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">{CHAT_COPY.intro}</p>
            <div className="flex flex-col items-start gap-2">
              {CHAT_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => submit(s)}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-left text-sm text-gray-800 shadow-xs transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <Message key={m.id} message={m} onRetry={() => retry(m.id)} busy={busy} />)
        )}
      </div>

      <form onSubmit={onSubmit} className="shrink-0 border-t border-gray-200 px-3 pb-3 pt-2.5">
        <div className="flex items-end gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 shadow-xs focus-within:border-gray-300 focus-within:ring-2 focus-within:ring-gray-200">
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            maxLength={500}
            aria-label={CHAT_COPY.title}
            placeholder={CHAT_COPY.placeholder}
            onChange={(e) => {
              setDraft(e.target.value);
              grow();
            }}
            onKeyDown={onKeyDown}
            className="max-h-32 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-sm leading-5 outline-none placeholder:text-gray-400"
          />
          <Button type="submit" size="icon-sm" aria-label={CHAT_COPY.send} disabled={busy || !draft.trim()} className="mb-0.5 shrink-0 rounded-full">
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-gray-500">{CHAT_COPY.cost}</p>
      </form>
    </section>
  );
}

function Message({ message: m, onRetry, busy }: { message: ChatMessage; onRetry: () => void; busy: boolean }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gray-900 px-3 py-2 text-sm text-white">{m.text}</p>
      </div>
    );
  }
  if (m.state === "thinking") {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {CHAT_COPY.thinking}
      </p>
    );
  }
  if (m.state === "error" && m.error?.kind === "credits") {
    // the board dialog's words and Upgrade buttons, inline (lazy: fetched only when needed)
    return (
      <div className="rounded-lg border border-red-100 bg-red-50/60 px-3 py-2.5">
        <Suspense fallback={<p className="text-sm text-red-700">{CHAT_COPY.errors.credits}</p>}>
          <OutOfCreditsPanel variant="inline" titleAs="p" />
        </Suspense>
      </div>
    );
  }
  if (m.state === "error" && m.error) {
    return (
      <div className="space-y-2 rounded-lg border border-red-100 bg-red-50/60 px-3 py-2">
        <p className="text-sm text-red-700">{m.error.message}</p>
        {m.error.retry ? (
          <Button variant="outline" size="sm" className="bg-white" disabled={busy} onClick={onRetry}>
            <RotateCcw />
            {CHAT_COPY.retry}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p className="whitespace-pre-wrap break-words text-sm">{m.text}</p>
      {(m.notes ?? []).map((n) => (
        <p key={n} className="text-xs text-gray-500">
          {n}
        </p>
      ))}
      {m.state === "writing" && (
        <p className={cn("flex items-center gap-2 text-xs text-blue-700")}>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {CHAT_COPY.writing}
        </p>
      )}
    </div>
  );
}
