"use client";
/**
 * Ask's mic, the browser's part (docs/ASK-V2.md, part "voice"): recording with MediaRecorder and
 * sending it to POST /api/live/transcribe (ElevenLabs Scribe), or listening with the browser's own
 * recognizer (`webkitSpeechRecognition`) when there is no recorder or the route says
 * `speech_unavailable`. The decisions are in `micLogic.ts`; this is only the plumbing.
 *
 * The recording lives in memory until it is sent, and is dropped after: it is never kept.
 */
import { TRANSCRIBE_PATH } from "@/lib/live/ask/contracts";
import { supabase } from "@/lib/supabase";
import { MIC, pickRecorderType, prefersMp4, recognizerErrorProblem, recognizerLang, recognizerText, recordingName, speechLang, transcribeOutcome, type MicProblem, type TranscribeOutcome } from "./micLogic";

// ------------------------------------------------------------------ what this browser has

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function micSupport(): { recorder: boolean; recognizer: boolean } {
  const recorder = typeof window !== "undefined" && typeof window.MediaRecorder === "function" && typeof navigator.mediaDevices?.getUserMedia === "function";
  return { recorder, recognizer: recognitionCtor() !== null };
}

// ------------------------------------------------------------------ the route's state, for this tab

let routeDownUntil = 0;
let failures = 0;

/** The route said `speech_unavailable` lately (or kept failing): the browser's recognizer meanwhile. */
export function routeIsDown(now: number = Date.now()): boolean {
  return now < routeDownUntil;
}

function noteOutcome(outcome: TranscribeOutcome): void {
  if (outcome.kind === "fallback") {
    routeDownUntil = Date.now() + MIC.routeDownMs;
    failures = 0;
  } else if (outcome.kind === "error") {
    if (++failures >= MIC.failuresBeforeFallback) {
      routeDownUntil = Date.now() + MIC.routeDownMs;
      failures = 0;
    }
  } else {
    failures = 0;
  }
}

/** Forget what the route said (tests, the QA page). */
export function resetMicRoute(): void {
  routeDownUntil = 0;
  failures = 0;
}

// ------------------------------------------------------------------ recording

export interface Recording {
  /** how loud it is now, 0–1 (for the ring) */
  level(): number;
  /** stops, and gives the recording */
  finish(): Promise<{ blob: Blob; ms: number }>;
  /** stops and drops it */
  cancel(): void;
}

/** Asks for the mic (a prompt the first time) and starts recording. Throws getUserMedia's errors. */
export async function startRecording(): Promise<Recording> {
  // The ring's loudness comes from an analyser on the same stream. Its AudioContext is made here,
  // still inside the press (before any await): iOS leaves one made later suspended, and silent.
  let ctx: AudioContext | null = null;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      ctx = new Ctx();
      void ctx.resume().catch(() => undefined);
    }
  } catch {
    ctx = null;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    void ctx?.close().catch(() => undefined);
    throw err;
  }
  const release = () => stream.getTracks().forEach((t) => t.stop());
  // a start that fails anywhere after the mic is granted gives it back: iOS keeps its mic light on
  // for as long as a track is live
  function giveUp(err: unknown): never {
    release();
    void ctx?.close().catch(() => undefined);
    throw err;
  }

  let recorder: MediaRecorder;
  try {
    const type = pickRecorderType((t) => MediaRecorder.isTypeSupported(t), prefersMp4(navigator.userAgent)) ?? "";
    recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: MIC.bitsPerSecond });
  } catch (err) {
    giveUp(err);
  }

  let analyser: AnalyserNode | null = null;
  let samples: Uint8Array<ArrayBuffer> | null = null;
  try {
    if (ctx) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    }
  } catch {
    analyser = null;
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => resolve();
  });
  const startedAt = performance.now();
  try {
    // a chunk a second: a recorder that fails late still has most of it
    recorder.start(1_000);
  } catch (err) {
    giveUp(err);
  }

  let done = false;
  const close = () => {
    done = true;
    release();
    void ctx?.close().catch(() => undefined);
  };

  return {
    level() {
      if (!analyser || !samples || done) return 0;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      // speech sits around 0.02–0.2 RMS: stretched so a normal voice fills the ring
      return Math.min(1, Math.sqrt(sum / samples.length) * 5);
    },
    async finish() {
      const ms = performance.now() - startedAt;
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      close();
      return { blob: new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "audio/webm" }), ms };
    },
    cancel() {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* already stopped */
      }
      chunks.length = 0;
      close();
    },
  };
}

/** Sends a recording to POST /api/live/transcribe: what the mic does next. Never throws. */
export async function transcribeRecording(blob: Blob, ms: number, signal?: AbortSignal): Promise<TranscribeOutcome> {
  // the caller's signal or the timeout (no AbortSignal.any: older iPads lack it)
  const request = new AbortController();
  const timer = setTimeout(() => request.abort(), MIC.requestTimeoutMs);
  const onAbort = () => request.abort();
  signal?.addEventListener("abort", onAbort);
  let outcome: TranscribeOutcome;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { kind: "error" };
    const form = new FormData();
    form.set("audio", blob, recordingName(blob.type));
    form.set("lang", speechLang(typeof navigator === "undefined" ? null : navigator.language));
    form.set("seconds", (ms / 1_000).toFixed(2));
    // not `authedFetch`: that announces every POST to /api/live/* as ink spent, and this spends none
    const res = await fetch(TRANSCRIBE_PATH, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, signal: request.signal });
    outcome = transcribeOutcome(res.status, await res.json().catch(() => null));
  } catch {
    if (signal?.aborted) return { kind: "nothing" };
    outcome = { kind: "error" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  noteOutcome(outcome);
  return outcome;
}

// ------------------------------------------------------------------ the browser's recognizer

export interface Listening {
  /** stops, and gives the words heard ("" for none) */
  finish(): Promise<string>;
  cancel(): void;
}

/**
 * Starts the browser's recognizer and resolves once it listens (a prompt the first time). Rejects
 * with the kid's problem (`MicProblem`) when it cannot. `onEnd`: it stopped by itself (a long
 * silence, or a browser that stops every so often), with what it heard.
 */
export function startListening(onEnd: (text: string, problem: MicProblem | null) => void): Promise<Listening> {
  const Recognition = recognitionCtor();
  if (!Recognition) return Promise.reject<Listening>("unsupported" satisfies MicProblem);
  const rec = new Recognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.lang = recognizerLang(typeof navigator === "undefined" ? null : navigator.language);

  const finals = new Map<number, string>();
  let interim = "";
  let problem: MicProblem | null = null;
  let ended = false;
  let finishing: ((text: string) => void) | null = null;
  const text = () => recognizerText([...finals.entries()].sort(([a], [b]) => a - b).map(([, t]) => t), interim);

  return new Promise<Listening>((resolve, reject) => {
    let started = false;
    rec.onstart = () => {
      started = true;
      resolve({
        finish: () =>
          new Promise<string>((done) => {
            if (ended) return done(text());
            finishing = done;
            try {
              rec.stop();
            } catch {
              done(text());
            }
          }),
        cancel: () => {
          ended = true;
          try {
            rec.abort();
          } catch {
            /* not running */
          }
        },
      });
    };
    rec.onresult = (ev) => {
      interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finals.set(i, r[0].transcript);
        else interim += r[0].transcript;
      }
    };
    rec.onerror = (ev) => {
      problem = recognizerErrorProblem(ev.error) ?? problem;
      if (!started) reject(problem ?? "error");
    };
    rec.onend = () => {
      const wasEnded = ended;
      ended = true;
      if (!started) return reject(problem ?? "error");
      if (finishing) return finishing(text());
      if (!wasEnded) onEnd(text(), problem);
    };
    try {
      rec.start();
    } catch {
      reject("error" satisfies MicProblem);
    }
  });
}
