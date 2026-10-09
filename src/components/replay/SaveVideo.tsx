"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Film, Loader2, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { clientMetric } from "@/lib/logger";
import { localDay } from "@/lib/daily/contracts";
import { REPLAY_VIDEO_COPY } from "@/lib/share/copy";
import { canRecordVideo, videoFileName } from "@/lib/share/video";
import type { ReplayPlayer } from "./player";

type Making = { kind: "idle" } | { kind: "making"; share: number; phase: "drawing" | "recording" } | { kind: "ready"; file: File; url: string };

/** The user closed the phone's share sheet: not an error. */
const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/**
 * "Save video" on the student's replay: makes a short video of the board being drawn
 * (`recordReplay.ts`, fetched on the tap), with a progress card and Cancel while it is made, then
 * offers Share (the phone's sheet, with the file) and Save. Shown only where the browser can record.
 * Every failure is a quiet toast; the replay is left as it was.
 */
export function SaveVideoButton({ player, disabled }: { player: ReplayPlayer; disabled?: boolean }) {
  const [state, setState] = useState<Making>({ kind: "idle" });
  const [supported, setSupported] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const url = useRef<string | null>(null);

  // asked after mount: the server render has no MediaRecorder
  useEffect(() => setSupported(canRecordVideo()), []);
  // closing the replay mid-way stops the recording; its video goes
  useEffect(
    () => () => {
      abort.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  const reset = useCallback(() => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setState({ kind: "idle" });
  }, []);

  const start = useCallback(async () => {
    if (state.kind === "making") return;
    reset();
    const controller = new AbortController();
    abort.current = controller;
    setState({ kind: "making", share: 0, phase: "drawing" });
    const t0 = performance.now();
    let recorder: typeof import("./recordReplay") | null = null;
    try {
      recorder = await import("./recordReplay");
      const video = await recorder.recordReplayVideo(player, {
        signal: controller.signal,
        onProgress: (p) => !controller.signal.aborted && setState({ kind: "making", share: p.share, phase: p.phase }),
      });
      if (controller.signal.aborted) return;
      const file = new File([video.blob], videoFileName(localDay(), video.format.extension), { type: video.blob.type });
      url.current = URL.createObjectURL(file);
      setState({ kind: "ready", file, url: url.current });
      clientMetric("share.video.made", { ms: Math.round(performance.now() - t0), bytes: file.size, type: file.type });
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) {
        setState({ kind: "idle" });
        return;
      }
      console.error("Replay video failed:", error);
      // "this browser can't" and "nothing to record" say so; anything else is a plain failure
      toast.error(recorder && error instanceof recorder.VideoUnavailableError ? error.message : REPLAY_VIDEO_COPY.failed);
      clientMetric("share.video.failed", { message: error instanceof Error ? error.message : String(error) });
      setState({ kind: "idle" });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }, [player, reset, state.kind]);

  const cancel = useCallback(() => abort.current?.abort(), []);

  const ready = state.kind === "ready" ? state : null;
  const canShareFile = Boolean(ready && typeof navigator !== "undefined" && navigator.canShare?.({ files: [ready.file] }));

  const share = useCallback(async () => {
    if (!ready) return;
    try {
      await navigator.share({ files: [ready.file], title: REPLAY_VIDEO_COPY.shareTitle });
      clientMetric("share.video.shared", {});
    } catch (error) {
      if (isAbort(error)) return;
      console.warn("Video share failed:", error);
      toast.error(REPLAY_VIDEO_COPY.shareFailed);
    }
  }, [ready]);

  const save = useCallback(() => {
    if (!ready) return;
    const a = document.createElement("a");
    a.href = ready.url;
    a.download = ready.file.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    clientMetric("share.video.saved", {});
  }, [ready]);

  if (!supported) return null;
  const percent = state.kind === "making" ? Math.round(state.share * 100) : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => void start()}
        disabled={disabled || state.kind === "making"}
        data-testid="replay-save-video"
        className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-violet-900 shadow-md ring-1 ring-violet-100 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-300 disabled:opacity-40"
      >
        <Film className="size-4" aria-hidden />
        {REPLAY_VIDEO_COPY.save}
      </button>

      {state.kind === "making" && (
        <div className="fixed inset-0 z-1320 grid place-items-center bg-white/60 p-4 backdrop-blur-[3px]" data-testid="replay-video-making">
          <div role="status" aria-live="polite" className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl ring-1 ring-violet-100">
            <Loader2 className="mx-auto size-8 animate-spin text-violet-600 motion-reduce:animate-none" aria-hidden />
            <h2 className="mt-3 text-xl font-extrabold tracking-tight text-gray-900">{REPLAY_VIDEO_COPY.making}</h2>
            <p className="mt-1 text-sm font-medium text-gray-600">
              {state.phase === "drawing" ? REPLAY_VIDEO_COPY.drawing : REPLAY_VIDEO_COPY.recording} · {percent}%
            </p>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-violet-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <div className="h-full rounded-full bg-violet-600 transition-[width] duration-200" style={{ width: `${percent}%` }} />
            </div>
            <button
              type="button"
              onClick={cancel}
              className="mt-5 inline-flex h-11 items-center justify-center rounded-full border-2 border-gray-200 bg-white px-5 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200"
            >
              {REPLAY_VIDEO_COPY.cancel}
            </button>
          </div>
        </div>
      )}

      {ready && (
        <div className="fixed inset-0 z-1320 grid place-items-center bg-white/60 p-4 backdrop-blur-[3px]" data-testid="replay-video-ready">
          <div role="dialog" aria-label={REPLAY_VIDEO_COPY.ready} className="relative w-full max-w-sm rounded-3xl bg-white p-5 text-center shadow-2xl ring-1 ring-violet-100">
            <button
              type="button"
              onClick={reset}
              aria-label={REPLAY_VIDEO_COPY.done}
              className="absolute top-3 right-3 grid size-9 place-items-center rounded-full text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200"
            >
              <X className="size-4" aria-hidden />
            </button>
            <h2 className="text-xl font-extrabold tracking-tight text-gray-900">{REPLAY_VIDEO_COPY.ready}</h2>
            <video src={ready.url} className="mx-auto mt-4 max-h-[46dvh] w-auto max-w-full rounded-2xl bg-gray-50 ring-1 ring-black/5" autoPlay muted loop playsInline controls data-testid="replay-video" />
            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
              {canShareFile && (
                <button
                  type="button"
                  onClick={() => void share()}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-violet-600 px-6 text-base font-bold text-white shadow-md transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-300"
                >
                  <Share2 className="size-5" aria-hidden />
                  {REPLAY_VIDEO_COPY.share}
                </button>
              )}
              <button
                type="button"
                onClick={save}
                data-testid="replay-video-save"
                className={
                  canShareFile
                    ? "inline-flex h-12 items-center justify-center gap-2 rounded-full border-2 border-gray-200 bg-white px-6 text-base font-semibold text-gray-800 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-200"
                    : "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-violet-600 px-6 text-base font-bold text-white shadow-md transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-300"
                }
              >
                <Download className="size-5" aria-hidden />
                {REPLAY_VIDEO_COPY.download}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
