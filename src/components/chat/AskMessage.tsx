"use client";

import { Fragment, Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import { PencilLine, RotateCcw, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { hasMath, mathAsText, parseRichText, type RichBlock, type RichInline } from "@/lib/live/ask/richText";
import { CHAT_COPY, tutorStatus, type ChatMessage } from "./chatView";

/** Running out of ink: the board dialog's panel (the plan), fetched only when a 402 arrives. */
const OutOfInkPanel = lazy(() => import("@/components/billing/OutOfInkPanel").then((m) => ({ default: m.OutOfInkPanel })));

type RenderMath = (src: string, display: boolean) => string | null;

/** KaTeX, loaded the first time a reply holds a formula (never with the board, nor with the panel). */
let mathRenderer: RenderMath | null = null;
let mathLoading: Promise<RenderMath | null> | null = null;
function loadMath(): Promise<RenderMath | null> {
  mathLoading ??= import("./askMath")
    .then((m) => (mathRenderer = m.renderAskMath))
    .catch(() => {
      // a chunk that would not load: the formulas stay readable as words, and the next one tries again
      mathLoading = null;
      return null;
    });
  return mathLoading;
}

function useMathRenderer(needed: boolean): RenderMath | null {
  const [render, setRender] = useState<RenderMath | null>(() => mathRenderer);
  useEffect(() => {
    if (!needed || render) return;
    let live = true;
    void loadMath().then((r) => {
      if (live && r) setRender(() => r);
    });
    return () => {
      live = false;
    };
  }, [needed, render]);
  return render;
}

/** The blinking bar at the end of words still arriving. */
function Caret() {
  return <span aria-hidden className="ml-0.5 inline-block h-[1.05em] w-[3px] translate-y-[0.2em] rounded-full bg-blue-500 motion-safe:animate-pulse" />;
}

function MathNode({ src, display, render }: { src: string; display: boolean; render: RenderMath | null }) {
  const html = useMemo(() => (render ? render(src, display) : null), [render, src, display]);
  if (!html) {
    // until KaTeX is here (or for a formula it cannot read): the formula in plain words
    return <span className={cn("font-medium", display && "block py-1 text-center")}>{mathAsText(src)}</span>;
  }
  if (display) {
    // a long formula scrolls sideways on a phone instead of pushing the panel wider
    return <span className="block max-w-full overflow-x-auto overflow-y-hidden py-1 text-center" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  // A fraction in a line is set as big as a display one (`askMathSource`): as an inline-block with a
  // little room above and below, its line grows to hold it, so one line's denominator never meets the
  // next line's numerator. Kept on its baseline; maths with no fraction stays inline, its line tight.
  if (TALL_INLINE.test(src)) return <span className="my-[0.3em] inline-block max-w-full align-baseline" dangerouslySetInnerHTML={{ __html: html }} />;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Inline maths KaTeX sets in display style, as tall as a display fraction (`askMathSource`'s rule). */
const TALL_INLINE = /\\(?:d?frac|binom)\b/;

function Inlines({ nodes, render, tail }: { nodes: readonly RichInline[]; render: RenderMath | null; tail?: ReactNode }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.t === "text") return <Fragment key={i}>{n.v}</Fragment>;
        if (n.t === "br") return <br key={i} />;
        if (n.t === "math") return <MathNode key={i} src={n.v} display={n.display} render={render} />;
        return (
          <strong key={i} className="font-semibold">
            <Inlines nodes={n.c} render={render} />
          </strong>
        );
      })}
      {tail}
    </>
  );
}

function Block({ block, render, tail }: { block: RichBlock; render: RenderMath | null; tail?: ReactNode }) {
  if (block.t === "p") {
    return (
      <p>
        <Inlines nodes={block.c} render={render} tail={tail} />
      </p>
    );
  }
  if (block.t === "math") {
    return (
      <div>
        <MathNode src={block.v} display render={render} />
        {tail}
      </div>
    );
  }
  const items = block.items.map((item, i) => (
    <li key={i} className="pl-1">
      <Inlines nodes={item} render={render} tail={i === block.items.length - 1 ? tail : undefined} />
    </li>
  ));
  return block.t === "ul" ? (
    <ul className="list-disc space-y-1 pl-5 marker:text-slate-400">{items}</ul>
  ) : (
    <ol start={block.start} className="list-decimal space-y-1 pl-6 marker:font-semibold marker:text-slate-500">
      {items}
    </ol>
  );
}

/**
 * The tutor's words as rich text (`parseRichText`): paragraphs, bold, lists and typeset maths. Only
 * React text nodes and KaTeX's own markup ever reach the page — no raw HTML from the reply.
 */
export function RichText({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = useMemo(() => parseRichText(text, { streaming }), [text, streaming]);
  const render = useMathRenderer(hasMath(blocks));
  const caret = streaming ? <Caret /> : undefined;
  if (blocks.length === 0) return caret ? <p>{caret}</p> : null;
  return (
    <div className="space-y-2.5 break-words [&_.katex]:text-[1.08em]">
      {blocks.map((b, i) => (
        <Block key={i} block={b} render={render} tail={i === blocks.length - 1 ? caret : undefined} />
      ))}
    </div>
  );
}

/** Three dots that breathe while the tutor thinks (still, with reduced motion). */
function ThinkingDots() {
  return (
    <span aria-hidden className="inline-flex items-center gap-1">
      {[0, 160, 320].map((d) => (
        <span key={d} className="size-2 rounded-full bg-blue-400 motion-safe:animate-bounce" style={{ animationDelay: `${d}ms`, animationDuration: "1s" }} />
      ))}
    </span>
  );
}

const TUTOR_BUBBLE = "max-w-full rounded-2xl rounded-tl-md bg-blue-50 px-4 py-3 text-[17px] leading-[1.55] text-slate-900";

interface AskMessageProps {
  message: ChatMessage;
  busy: boolean;
  onRetry: () => void;
  /** read this reply aloud again; absent: no speaker button */
  onReplay?: (text: string) => void;
}

/** One message of the chat: the kid's on the right, the tutor's on the left as rich text. */
export function AskMessage({ message: m, busy, onRetry, onReplay }: AskMessageProps) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end pl-10" data-ask-message="user">
        <p className="max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-slate-800 px-4 py-2.5 text-[16px] leading-[1.5] text-white">{m.text}</p>
      </div>
    );
  }

  if (m.state === "error" && m.error?.kind === "ink") {
    // the board dialog's words and its plan button, inline (lazy: fetched only when needed)
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3" data-ask-message="error">
        <Suspense fallback={<p className="text-[16px] text-slate-700">{CHAT_COPY.errors.ink}</p>}>
          <OutOfInkPanel variant="inline" titleAs="p" outOfInk />
        </Suspense>
      </div>
    );
  }

  if (m.state === "error" && m.error) {
    // one calm line and one big Try again: never red, never a wall of words
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-amber-50 py-2 pl-4 pr-2" role="alert" data-ask-message="error">
        <p className="min-w-0 flex-1 basis-48 text-[16px] leading-snug text-amber-950">{m.error.message}</p>
        {m.error.retry ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRetry}
            className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-amber-200 bg-white px-4 text-[15px] font-semibold text-amber-950 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 disabled:cursor-default disabled:opacity-50"
          >
            <RotateCcw className="size-4" aria-hidden />
            {CHAT_COPY.retry}
          </button>
        ) : null}
      </div>
    );
  }

  const status = tutorStatus(m);
  if (status === "thinking") {
    return (
      <div className="flex" data-ask-message="tutor" data-state="thinking">
        <p className={cn(TUTOR_BUBBLE, "flex items-center gap-3 text-slate-600")} role="status">
          <ThinkingDots />
          <span className="text-[16px]">{CHAT_COPY.thinking}</span>
        </p>
      </div>
    );
  }

  const streaming = status === "streaming";
  const replay = onReplay && m.state === "done" && !m.stopped && m.text.trim() ? onReplay : undefined;
  return (
    <div className="flex flex-col items-start gap-1.5 pr-6" data-ask-message="tutor" data-state={m.state}>
      {(m.text || streaming) && (
        <div className={TUTOR_BUBBLE}>
          <RichText text={m.text} streaming={streaming} />
        </div>
      )}
      {(m.notes ?? []).map((n) => (
        <p key={n} className="px-1 text-[14px] leading-snug text-slate-500">
          {n}
        </p>
      ))}
      {status === "writing" && (
        <p className="flex items-center gap-2 px-1 text-[15px] font-medium text-blue-700" role="status">
          <PencilLine className="size-4 motion-safe:animate-pulse" aria-hidden />
          {CHAT_COPY.writing}
        </p>
      )}
      {replay && (
        <button
          type="button"
          aria-label={CHAT_COPY.replay}
          title={CHAT_COPY.replay}
          onClick={() => replay(m.text)}
          className="-ml-1.5 -mt-1 flex size-11 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        >
          <Volume2 className="size-[18px]" aria-hidden />
        </button>
      )}
    </div>
  );
}
