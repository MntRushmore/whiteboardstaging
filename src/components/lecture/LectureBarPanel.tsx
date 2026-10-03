"use client";

import { Suspense, lazy, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { AlertCircle, Check, Info, Loader2, Mic, Pause, PenLine, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LECTURE_COPY, lectureBarModel, type LectureBarModel } from "./lectureView";
import { useLectureLive, type LectureHandle } from "./useLecture";

/** Running out of ink: the board dialog's panel, fetched only when a 402 arrives (as in the Ask panel). */
const OutOfInkPanel = lazy(() => import("@/components/billing/OutOfInkPanel").then((m) => ({ default: m.OutOfInkPanel })));

/**
 * Lecture mode's floating panel: the consent note, then while the lecture runs the recording dot
 * and its timer, the words being heard (the newest line or two; the words still being heard in a
 * lighter tone; older words fading out at the top), what the tutor is doing ("Updating the
 * chart…", "Drew: bar chart: …") with a quiet "Live" pulse while a chart can still change, and
 * Draw that / Pause / Stop.
 *
 * Where: bottom centre, just above tldraw's toolbar — clear of the top bar (top left), the pen's
 * style button (top right), the screen strip (bottom left) and
 * the Ask panel (docked beside the board, outside the canvas). It is where captions sit, which is
 * what the ticker is. At 400 px it spans the width less a 16 px margin each side.
 *
 * Styling follows the board's own controls (shadcn Button, Tailwind greys) in the Arc platform's
 * manner — a large soft radius, a hairline border, the floating shadow, near-black for the one
 * primary action — without loading Arc on the board. Nothing here imports tldraw.
 */
export function LectureBarPanel({ lecture }: { lecture: LectureHandle }) {
  const live = useLectureLive(lecture);
  const model = lectureBarModel({ status: lecture.status, error: lecture.error, snap: live?.snapshot ?? null, now: live?.at ?? 0 });
  if (model.mode === "hidden") return null;

  return (
    // a full-width lane centres the panel without a transform (the entrance animation owns that)
    <div className="pointer-events-none absolute inset-x-0 bottom-20 z-[1000] flex justify-center px-4">
      <section
        aria-label={LECTURE_COPY.title}
        data-lecture-bar={model.mode}
        className={cn(
          "pointer-events-auto w-full max-w-[480px] overflow-hidden rounded-[20px] border border-black/[0.07] bg-white text-gray-900",
          "shadow-[0_20px_48px_rgba(0,0,0,0.10),0_3px_10px_rgba(0,0,0,0.045)]",
          "animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out motion-reduce:animate-none",
        )}
      >
        {model.mode === "consent" ? (
          <Consent lecture={lecture} />
        ) : model.mode === "starting" ? (
          <Starting lecture={lecture} />
        ) : model.mode === "error" ? (
          <Failure lecture={lecture} error={model.error} />
        ) : (
          <Active lecture={lecture} model={model} />
        )}
      </section>
    </div>
  );
}

/** The one filled action of the panel: near-black, round, like the Ask panel's Send. */
const PRIMARY = "rounded-full bg-gray-900 text-white shadow-none hover:bg-gray-800 focus-visible:ring-gray-900/25";
const ROUND_GHOST = "rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-900";

function Consent({ lecture }: { lecture: LectureHandle }) {
  const startRef = useRef<HTMLButtonElement | null>(null);
  // the note is a question: its answer is in reach of the keyboard at once
  useEffect(() => startRef.current?.focus(), []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      lecture.cancelConsent();
    }
  };
  return (
    <div className="p-5" role="dialog" aria-labelledby="lecture-consent-title" aria-describedby="lecture-consent-body" onKeyDown={onKeyDown}>
      <div className="flex items-start gap-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white" aria-hidden>
          <Mic className="size-[18px]" />
        </span>
        <div className="min-w-0 space-y-1.5 pt-0.5">
          <p id="lecture-consent-title" className="text-[15px] font-semibold leading-5 tracking-[-0.01em]">
            {LECTURE_COPY.consent.title}
          </p>
          <p id="lecture-consent-body" className="text-sm leading-relaxed text-gray-600">
            {LECTURE_COPY.consent.body}
          </p>
          <p className="text-xs leading-relaxed text-gray-500">{LECTURE_COPY.consent.cost}</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" className={ROUND_GHOST} onClick={lecture.cancelConsent}>
          {LECTURE_COPY.consent.cancel}
        </Button>
        <Button ref={startRef} size="sm" className={cn(PRIMARY, "px-3.5")} onClick={lecture.confirmConsent}>
          <Mic />
          {LECTURE_COPY.consent.start}
        </Button>
      </div>
    </div>
  );
}

function Starting({ lecture }: { lecture: LectureHandle }) {
  return (
    <div className="flex items-center gap-3 py-2.5 pl-4 pr-2.5" role="status">
      <Loader2 className="size-4 shrink-0 animate-spin text-gray-400" aria-hidden />
      <span className="min-w-0 truncate text-sm text-gray-700">{LECTURE_COPY.starting}</span>
      <Button variant="ghost" size="sm" className={cn(ROUND_GHOST, "ml-auto")} onClick={lecture.stop}>
        {LECTURE_COPY.consent.cancel}
      </Button>
    </div>
  );
}

function Failure({ lecture, error }: { lecture: LectureHandle; error: LectureBarModel["error"] }) {
  if (!error) return null;
  return (
    <div className="space-y-3.5 p-4" role="alert">
      {error.ink ? (
        // the board dialog's words and Upgrade buttons, inline (lazy: fetched only when needed)
        <div className="max-h-[min(55dvh,420px)] overflow-y-auto rounded-2xl border border-red-100 bg-red-50/60 px-3.5 py-3">
          <Suspense fallback={<p className="text-sm font-medium text-red-800">{LECTURE_COPY.errors.ink}</p>}>
            <OutOfInkPanel variant="inline" titleAs="p" outOfInk />
          </Suspense>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600" aria-hidden>
            <AlertCircle className="size-4" />
          </span>
          <p className="pt-1.5 text-sm leading-relaxed text-gray-800">{error.message}</p>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className={ROUND_GHOST} onClick={lecture.stop}>
          {LECTURE_COPY.close}
        </Button>
        {error.retry ? (
          <Button size="sm" className={cn(PRIMARY, "px-3.5")} onClick={lecture.start}>
            {LECTURE_COPY.tryAgain}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Active({ lecture, model }: { lecture: LectureHandle; model: LectureBarModel }) {
  return (
    <div>
      <div className="flex items-center gap-3 pl-4 pr-2 pt-2.5">
        <RecordDot state={model.dot} />
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold tracking-[-0.01em]">{model.label}</span>
          {/* while reconnecting the label is what matters (and needs the room at 400 px) */}
          {model.dot === "reconnecting" ? null : (
            <span className="text-[13px] tabular-nums text-gray-500" aria-label={`Time ${model.timer}`}>
              {model.timer}
            </span>
          )}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Button size="sm" className={cn(PRIMARY, "mr-1 h-8 px-3")} disabled={!model.drawThat.enabled} title={LECTURE_COPY.drawThatHint} onClick={lecture.drawThat}>
            {model.drawThat.busy ? <Loader2 className="animate-spin" /> : <PenLine />}
            {LECTURE_COPY.drawThat}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={ROUND_GHOST}
            aria-label={model.paused ? LECTURE_COPY.resume : LECTURE_COPY.pause}
            title={model.paused ? LECTURE_COPY.resume : LECTURE_COPY.pause}
            onClick={model.paused ? lecture.resume : lecture.pause}
          >
            {model.paused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
          </Button>
          <Button variant="ghost" size="icon-sm" className={ROUND_GHOST} aria-label={LECTURE_COPY.stop} title={LECTURE_COPY.stopHint} onClick={lecture.stop}>
            <Square className="size-3.5 fill-current" />
          </Button>
        </div>
      </div>

      {/* exactly two lines, the newest at the bottom: older words leave at the top, softened by a
          hairline fade; the lines in view stay crisp */}
      <div className="mt-1.5 h-12 overflow-hidden px-4 [mask-image:linear-gradient(to_bottom,transparent,#000_4px)]">
        <div className="flex h-full flex-col justify-end">
          <p className="break-words text-[15px] leading-6">
            {model.placeholder ? (
              <span className="text-gray-400">{model.placeholder}</span>
            ) : (
              <>
                <span className="text-gray-900">{model.heard}</span>
                {model.heard && model.hearing ? " " : null}
                <span className="text-gray-400">{model.hearing}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-black/[0.06] px-4 py-2.5">
        <p role="status" aria-live="polite" className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-xs", TONE[model.status.tone])}>
          <StatusIcon tone={model.status.tone} />
          <StatusText status={model.status} />
        </p>
        {model.liveVisual ? <LiveBadge /> : null}
      </div>
    </div>
  );
}

const TONE: Record<LectureBarModel["status"]["tone"], string> = {
  busy: "text-blue-700",
  done: "text-gray-800",
  notice: "text-amber-800",
  muted: "text-gray-500",
};

function StatusText({ status }: { status: LectureBarModel["status"] }): ReactNode {
  if (!status.lead) return <span className="truncate">{status.text}</span>;
  return (
    <span className="truncate">
      <span className="text-gray-500">{status.lead}</span> <span className="font-medium">{status.text}</span>
    </span>
  );
}

function StatusIcon({ tone }: { tone: LectureBarModel["status"]["tone"] }) {
  if (tone === "busy") return <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />;
  if (tone === "done") return <Check className="size-3.5 shrink-0 text-emerald-600" strokeWidth={2.5} aria-hidden />;
  if (tone === "notice") return <Info className="size-3.5 shrink-0" aria-hidden />;
  return null;
}

/** Recording: a red dot with a slow soft ring. Paused: grey. Reconnecting: amber, breathing. */
function RecordDot({ state }: { state: LectureBarModel["dot"] }) {
  return (
    <span className="relative flex size-2.5 shrink-0" aria-hidden>
      {state === "recording" ? (
        <span className="absolute inset-0 rounded-full bg-red-500/50 animate-[ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite] motion-reduce:animate-none" />
      ) : null}
      <span
        className={cn(
          "relative size-2.5 rounded-full",
          state === "recording" ? "bg-red-500" : state === "reconnecting" ? "bg-amber-400 animate-[live-pulse_1.2s_ease-in-out_infinite] motion-reduce:animate-none" : "bg-gray-300",
        )}
      />
    </span>
  );
}

/** A chart or diagram on the board is live: it still changes as the lecture goes. The tutor's ink is blue. */
function LiveBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-100" title={LECTURE_COPY.liveHint}>
      <span className="size-1.5 rounded-full bg-blue-500 animate-[live-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none" aria-hidden />
      {LECTURE_COPY.live}
    </span>
  );
}
