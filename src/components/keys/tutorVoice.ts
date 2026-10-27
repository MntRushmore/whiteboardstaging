"use client";

/**
 * The Keys page's tutor voice (docs/KEYS.md, Phase 2), browser side:
 *
 *  - `fetchSay`: POST /api/keys/say with the kid's token. Plain fetch, not `authedFetch` (that one
 *    announces every POST under /api/live as ink spent; Keys' lines cost none).
 *  - `askHint`: Help me for a slip no bug rule names: the check endpoint's hint (`src/lib/keys/hint.ts`).
 *  - `speakLine` / the read-aloud switch: the tutor's lines read aloud through /api/live/speak (the
 *    browser's own voice when the route cannot), off by default, a switch in More. The captions are
 *    the lines on the page, always shown. Its own speaker, not the board's read-aloud module (that
 *    one listens to the tldraw board, which Keys never loads).
 */
import { useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { clientMetric } from "@/lib/logger";
import { streamLiveSse } from "@/lib/live/sseClient";
import { hintRequest, HINT_WAIT_MS, usableHint } from "@/lib/keys/hint";
import type { SayRequest } from "@/lib/keys/say";
import type { ProblemState } from "@/lib/keys/session";
import { fetchSpeech } from "@/lib/speech/speakClient";
import { Speaker, type AudioLike, type SynthLike, type UtteranceLike } from "@/lib/speech/speaker";

async function token(): Promise<string | null> {
  try {
    return (await supabase.auth.getSession()).data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** POST /api/keys/say; resolves to the JSON body, or rejects (the page then says the fixed line). */
export async function fetchSay(body: SayRequest, signal: AbortSignal): Promise<unknown> {
  const t = await token();
  if (!t) throw new Error("signed out");
  const res = await fetch("/api/keys/say", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`say ${res.status}`);
  return res.json();
}

/**
 * The check endpoint's hint for the line that broke, or null (no line, a refusal such as no ink, a
 * hint that gives the answer away, or nothing within HINT_WAIT_MS).
 */
export async function askHint(p: ProblemState): Promise<string | null> {
  const body = hintRequest(p);
  if (!body) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HINT_WAIT_MS);
  try {
    for await (const ev of streamLiveSse("/api/live/check", body, { signal: ctrl.signal })) {
      if (ev.event === "annotation" && ev.data.verdict !== "ok") {
        const hint = usableHint(p.item, ev.data.message, ev.data.question);
        clientMetric("keys.hint", { used: hint !== null });
        if (hint) return hint;
      }
      if (ev.event === "done" || ev.event === "error") break;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

// ------------------------------------------------------------------ read aloud

const VOICE_KEY = "agathon.keys.readAloud";
const VOICE_EVENT = "agathon:keys-read-aloud";

function readVoice(): boolean {
  try {
    return window.localStorage.getItem(VOICE_KEY) === "on";
  } catch {
    return false;
  }
}

function subscribeVoice(fn: () => void): () => void {
  window.addEventListener(VOICE_EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(VOICE_EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

/** Read aloud on this device for Keys (off by default). */
export function useReadAloud(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeVoice, readVoice, () => false);
  const set = (next: boolean) => {
    try {
      window.localStorage.setItem(VOICE_KEY, next ? "on" : "off");
    } catch {
      // private mode: the switch lasts this page only
    }
    if (!next) speaker?.stop();
    else getSpeaker().unlock({ voice: true });
    window.dispatchEvent(new Event(VOICE_EVENT));
  };
  return [on, set];
}

let speaker: Speaker | null = null;

function getSpeaker(): Speaker {
  if (speaker) return speaker;
  const audio = typeof Audio === "undefined" ? null : new Audio();
  if (audio) audio.preload = "auto";
  const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
  speaker = new Speaker({
    fetchSpeech: (text, signal) => fetchSpeech(text, signal),
    audio: audio as AudioLike | null,
    synth: synth as unknown as SynthLike | null,
    makeUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
    toUrl: (blob) => URL.createObjectURL(blob),
    revokeUrl: (url) => URL.revokeObjectURL(url),
    metric: clientMetric,
  });
  return speaker;
}

/** Says a tutor line now when read aloud is on (a key press has already unlocked audio). */
export function speakLine(text: string): void {
  if (!text.trim() || typeof window === "undefined" || !readVoice()) return;
  const s = getSpeaker();
  s.unlock({ voice: true });
  void s.speak(text);
}
