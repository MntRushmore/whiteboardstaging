"use client";
/**
 * The panel's microphone (docs/ASK-V2.md, part "voice"): a kid who can't type well holds it and
 * talks, lets go, and their words land in the input (`onText`). A quick tap works too: tap to
 * start, tap again to send (and Enter or Space with a keyboard).
 *
 *  - It records with MediaRecorder (MP4/AAC on Safari and the iPad, WebM/Opus elsewhere) and sends
 *    the recording to POST /api/live/transcribe (ElevenLabs Scribe). Where there is no recorder, or
 *    the route says `speech_unavailable` (no plan, no key), it listens with the browser's own
 *    recognizer instead; that switch lasts a while (`MIC.routeDownMs`), so the kid is asked to say
 *    it again once at most.
 *  - A flat ring around the button grows with the kid's voice; a minute at most, the last seconds
 *    counted down.
 *  - A mic the browser refuses gets a calm line for the kid and one for the grown-up.
 *  - Starting the mic silences Ask's voice (`ASK_MIC_EVENT`): it would be recorded too.
 *
 * A 44 px target; its pointer events stop at the button, so a press never reaches the board.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { ASK_VOICE_COPY } from "./copy";
import { micSupport, routeIsDown, startListening, startRecording, transcribeRecording, type Listening, type Recording } from "./micEngines";
import { ASK_MIC_EVENT, MIC, chooseEngine, micErrorProblem, pressKind, problemWords, secondsLeft, type MicEngine, type MicProblem, type TranscribeOutcome } from "./micLogic";

export interface AskMicProps {
  onText(text: string): void;
  disabled?: boolean;
  /** smaller beside the input on a phone */
  compact?: boolean;
}

type Phase = "idle" | "starting" | "listening" | "sending";

interface Session {
  id: number;
  engine: MicEngine;
  startedAt: number;
  recording?: Recording;
  listening?: Listening;
  request?: AbortController;
}

/** Problems only a grown-up can fix stay up longer. */
const LASTING: ReadonlySet<MicProblem> = new Set(["denied", "no-mic", "busy", "unsupported"]);

export function AskMic({ onText, disabled = false, compact = false }: AskMicProps) {
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [mode, setMode] = useState<"hold" | "tap">("hold");
  const [problem, setProblem] = useState<MicProblem | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [engine, setEngine] = useState<MicEngine | null>(null);

  const phaseRef = useRef<Phase>("idle");
  const session = useRef<Session | null>(null);
  const seq = useRef(0);
  const pressedAt = useRef<number | null>(null);
  const ring = useRef<HTMLSpanElement | null>(null);
  const loops = useRef<{ raf: number | null; tick: ReturnType<typeof setInterval> | null; cap: ReturnType<typeof setTimeout> | null }>({ raf: null, tick: null, cap: null });
  const problemTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const stopLoops = useCallback(() => {
    const l = loops.current;
    if (l.raf !== null) cancelAnimationFrame(l.raf);
    if (l.tick !== null) clearInterval(l.tick);
    if (l.cap !== null) clearTimeout(l.cap);
    loops.current = { raf: null, tick: null, cap: null };
    if (ring.current) ring.current.style.transform = "scale(1)";
    setLeft(null);
  }, []);

  const showProblem = useCallback((p: MicProblem | null) => {
    if (problemTimer.current) clearTimeout(problemTimer.current);
    problemTimer.current = null;
    setProblem(p);
    if (p) problemTimer.current = setTimeout(() => setProblem(null), LASTING.has(p) ? MIC.problemMs * 2 : MIC.problemMs);
  }, []);

  /** The kid's words, or what to tell them instead. */
  const settle = useCallback(
    (outcome: TranscribeOutcome | { kind: "problem"; problem: MicProblem }) => {
      setPhase("idle");
      setEngine(null);
      switch (outcome.kind) {
        case "text":
          showProblem(null);
          onTextRef.current(outcome.text);
          return;
        case "nothing":
          return showProblem("nothing");
        case "fallback":
          // the browser's recognizer from now on; this recording is lost, so ask once more
          return showProblem(micSupport().recognizer ? "again" : "unsupported");
        case "limited":
          return showProblem("limited");
        case "problem":
          return showProblem(outcome.problem);
        default:
          return showProblem("error");
      }
    },
    [setPhase, showProblem],
  );

  const cancel = useCallback(() => {
    const s = session.current;
    session.current = null;
    s?.recording?.cancel();
    s?.listening?.cancel();
    s?.request?.abort();
    stopLoops();
    setPhase("idle");
    setEngine(null);
  }, [setPhase, stopLoops]);

  const finishAndSend = useCallback(async () => {
    const s = session.current;
    if (!s || phaseRef.current !== "listening") return;
    stopLoops();
    setPhase("sending");
    if (s.recording) {
      const { blob, ms } = await s.recording.finish();
      if (session.current !== s) return;
      if (ms < MIC.minMs || blob.size === 0) {
        session.current = null;
        return settle({ kind: "nothing" });
      }
      s.request = new AbortController();
      const outcome = await transcribeRecording(blob, ms, s.request.signal);
      if (session.current !== s) return;
      session.current = null;
      settle(outcome);
    } else if (s.listening) {
      const text = await s.listening.finish();
      if (session.current !== s) return;
      session.current = null;
      settle(text ? { kind: "text", text } : { kind: "nothing" });
    }
  }, [setPhase, settle, stopLoops]);

  const startLoops = useCallback(
    (s: Session) => {
      const tick = () => {
        if (session.current !== s) return;
        const level = s.recording?.level() ?? 0;
        if (ring.current) ring.current.style.transform = `scale(${(1 + level * 0.5).toFixed(3)})`;
        loops.current.raf = requestAnimationFrame(tick);
      };
      if (s.recording) loops.current.raf = requestAnimationFrame(tick);
      loops.current.tick = setInterval(() => setLeft(secondsLeft(performance.now() - s.startedAt)), 250);
      loops.current.cap = setTimeout(() => void finishAndSend(), MIC.maxMs);
    },
    [finishAndSend],
  );

  const begin = useCallback(
    async (how: "hold" | "tap") => {
      const chosen = chooseEngine(micSupport(), routeIsDown());
      if (!chosen) return showProblem("unsupported");
      showProblem(null);
      // Ask's voice would be recorded too
      window.dispatchEvent(new CustomEvent(ASK_MIC_EVENT, { detail: "start" }));
      const s: Session = { id: ++seq.current, engine: chosen, startedAt: 0 };
      session.current = s;
      setMode(how);
      setEngine(chosen);
      setPhase("starting");
      try {
        if (chosen === "recorder") {
          const recording = await startRecording();
          if (session.current !== s) return recording.cancel();
          s.recording = recording;
        } else {
          const listening = await startListening((text, problem) => {
            // the recognizer stopped by itself (a long pause): what it heard goes, or why not
            if (session.current !== s || phaseRef.current !== "listening") return;
            session.current = null;
            stopLoops();
            settle(text ? { kind: "text", text } : { kind: "problem", problem: problem ?? "nothing" });
          });
          if (session.current !== s) return listening.cancel();
          s.listening = listening;
        }
      } catch (err) {
        if (session.current !== s) return;
        session.current = null;
        const problem: MicProblem = chosen === "recorder" ? micErrorProblem(err) : typeof err === "string" ? (err as MicProblem) : "error";
        return settle({ kind: "problem", problem });
      }
      s.startedAt = performance.now();
      setPhase("listening");
      startLoops(s);
    },
    [setPhase, settle, showProblem, startLoops, stopLoops],
  );

  // let go of the mic when the panel closes (`disabled` only stops a new start: a kid mid-sentence
  // finishes it, and the words wait in the input)
  useEffect(() => cancel, [cancel]);
  useEffect(
    () => () => {
      if (problemTimer.current) clearTimeout(problemTimer.current);
    },
    [],
  );

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault(); // no focus ring flash, no text selection, no iOS callout
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable (a synthetic event) */
    }
    if (phaseRef.current === "listening") {
      // the second tap: send
      pressedAt.current = null;
      void finishAndSend();
      return;
    }
    if (phaseRef.current !== "idle") return;
    pressedAt.current = performance.now();
    void begin("hold");
  };

  const release = (e: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    e.stopPropagation();
    const at = pressedAt.current;
    pressedAt.current = null;
    if (at === null) return;
    // a tap, a press let go while the mic was still being asked for, or a press the system took
    // over (iOS's permission prompt): it keeps listening until the next tap
    if (cancelled || pressKind(at, performance.now()) === "tap" || phaseRef.current === "starting") {
      setMode("tap");
      return;
    }
    if (phaseRef.current === "listening") void finishAndSend();
  };

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (e.detail !== 0 || disabled) return; // pointers are handled above; this is Enter or Space
    if (phaseRef.current === "idle") void begin("tap");
    else if (phaseRef.current === "listening") void finishAndSend();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Escape" && phaseRef.current !== "idle") {
      e.preventDefault();
      cancel();
    }
  };

  const listening = phase === "listening";
  const busy = phase === "starting" || phase === "sending";
  const words = problem ? problemWords(problem) : null;
  const status =
    phase === "listening"
      ? left !== null
        ? ASK_VOICE_COPY.secondsLeft(left)
        : mode === "hold"
          ? ASK_VOICE_COPY.listeningHold
          : ASK_VOICE_COPY.listeningTap
      : phase === "sending"
        ? ASK_VOICE_COPY.sending
        : (words?.kid ?? "");

  return (
    <div className="relative inline-flex shrink-0" data-ask-mic={phase}>
      {/* what the mic is doing, for a screen reader; the bubble below is its picture */}
      <span role="status" aria-live="polite" className="sr-only">
        {status}
        {words?.grownUp ? ` ${words.grownUp}` : ""}
      </span>
      {status ? (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-max max-w-[15rem] rounded-xl border bg-popover px-3 py-2 text-sm leading-snug text-popover-foreground shadow-md"
        >
          <p className="font-medium">{status}</p>
          {words?.grownUp && !listening && phase !== "sending" ? <p className="mt-1 text-xs text-muted-foreground">{words.grownUp}</p> : null}
        </div>
      ) : null}
      <span
        ref={ring}
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-full bg-primary/25 transition-[transform,opacity] duration-75",
          listening ? "opacity-100" : "opacity-0",
          listening && engine === "browser" && "motion-safe:animate-pulse",
        )}
      />
      <button
        type="button"
        aria-label={listening ? ASK_VOICE_COPY.micStop : ASK_VOICE_COPY.mic}
        aria-pressed={listening}
        title={listening ? ASK_VOICE_COPY.micStop : ASK_VOICE_COPY.micTip}
        disabled={disabled && phase === "idle"}
        data-ask-mic-button=""
        onPointerDown={onPointerDown}
        onPointerUp={(e) => release(e, false)}
        onPointerCancel={(e) => release(e, true)}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          "relative inline-flex size-11 cursor-pointer touch-none select-none items-center justify-center rounded-full outline-none transition-colors [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          listening
            ? "bg-primary text-primary-foreground"
            : compact
              ? "text-foreground hover:bg-accent"
              : "border bg-background text-foreground shadow-xs hover:bg-accent",
        )}
      >
        {busy ? (
          <Loader2 aria-hidden className={cn("animate-spin", compact ? "size-4" : "size-5")} />
        ) : listening ? (
          <Square aria-hidden className={cn("fill-current", compact ? "size-3.5" : "size-4")} />
        ) : (
          <Mic aria-hidden className={compact ? "size-4" : "size-5"} />
        )}
      </button>
    </div>
  );
}
