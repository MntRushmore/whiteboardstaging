"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MonitorUp, Square } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { AuthErrorBanner, useAuth } from "@/components/AuthProvider";
import { AppHeader, APP_CONTENT_CLASS } from "@/components/app/AppHeader";
import { supabase } from "@/lib/supabase";
import {
  base64Of,
  changed,
  chunkFrame,
  FRAME_EVENT,
  frameSize,
  greyOf,
  JPEG_QUALITY,
  KEEPALIVE_MS,
  PROBE_H,
  PROBE_W,
  screenTopic,
  TICK_MS,
  VIEWER_EVENT,
} from "@/lib/screenShare/frames";
import { SHARE_COPY, shareStatus, type SharePhase } from "@/lib/screenShare/view";
import { Button } from "@/registry/components/button/button";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import styles from "./share.module.css";

/**
 * agathon.app/share: the Mac's chosen window, live on the iPad's board (its Mac screen panel). The
 * browser captures the window (getDisplayMedia); twice a second it is drawn small, and when it
 * changed (or every few seconds anyway) it goes as a JPEG over the person's private Realtime channel.
 */
export function ShareScreen() {
  const router = useRouter();
  const { user, loading: authLoading, authError } = useAuth();
  const [phase, setPhase] = useState<SharePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [viewerSeenAt, setViewerSeenAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!authLoading && !user && !authError) router.replace("/login");
  }, [user, authLoading, authError, router]);

  // the status line's clock
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => stopRef.current(), []);

  const stop = useCallback(() => {
    stopRef.current();
    stopRef.current = () => {};
    setPhase("idle");
    setViewerSeenAt(null);
  }, []);

  const start = useCallback(async () => {
    if (!user) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(SHARE_COPY.unsupported);
      setPhase("error");
      return;
    }
    setPhase("starting");
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    } catch {
      setError(SHARE_COPY.denied);
      setPhase("error");
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    await video.play().catch(() => {});

    // the person's private channel (realtime.messages RLS: screen:<their id> only)
    await supabase.realtime.setAuth();
    const channel: RealtimeChannel = supabase.channel(screenTopic(user.id), {
      config: { private: true, broadcast: { self: false, ack: false } },
    });
    let lastSent = 0;
    let forceNext = true;
    channel.on("broadcast", { event: VIEWER_EVENT }, () => {
      setViewerSeenAt(Date.now());
      // an iPad that just opened the panel gets a picture at once
      forceNext = true;
    });
    const subscribed = await new Promise<boolean>((resolve) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve(true);
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") resolve(false);
      });
    });
    if (!subscribed) {
      stream.getTracks().forEach((t) => t.stop());
      void supabase.removeChannel(channel);
      setError(SHARE_COPY.failed);
      setPhase("error");
      return;
    }

    const frameCanvas = document.createElement("canvas");
    const probe = document.createElement("canvas");
    probe.width = PROBE_W;
    probe.height = PROBE_H;
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });
    let prevGrey: Uint8Array | null = null;
    let frameNo = 0;
    let busy = false;

    const tick = async () => {
      if (busy || video.readyState < 2 || !probeCtx) return;
      busy = true;
      try {
        probeCtx.drawImage(video, 0, 0, PROBE_W, PROBE_H);
        const grey = greyOf(probeCtx.getImageData(0, 0, PROBE_W, PROBE_H).data);
        const due = forceNext || Date.now() - lastSent > KEEPALIVE_MS;
        if (!changed(prevGrey, grey) && !due) return;
        prevGrey = grey;
        forceNext = false;
        const { w, h } = frameSize(video.videoWidth, video.videoHeight);
        if (w === 0) return;
        frameCanvas.width = w;
        frameCanvas.height = h;
        frameCanvas.getContext("2d")?.drawImage(video, 0, 0, w, h);
        const b64 = base64Of(frameCanvas.toDataURL("image/jpeg", JPEG_QUALITY));
        frameNo += 1;
        for (const chunk of chunkFrame(frameNo, b64, w, h)) {
          await channel.send({ type: "broadcast", event: FRAME_EVENT, payload: chunk });
        }
        lastSent = Date.now();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), TICK_MS);

    stopRef.current = () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      void supabase.removeChannel(channel);
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // the browser's own "Stop sharing" ends the track
    stream.getVideoTracks()[0]?.addEventListener("ended", () => stop());
    setPhase("sharing");
  }, [user, stop]);

  const status = shareStatus(phase, viewerSeenAt, now, error);
  const live = status === SHARE_COPY.live;

  return (
    <div className={styles.page}>
      <AppHeader />
      <main className={`${APP_CONTENT_CLASS} ${styles.main}`}>
        <div className={styles.inner}>
          <AuthErrorBanner />
          <div className={styles.titleBlock}>
            <Link href="/" className={styles.back}>
              <ArrowLeft size={16} aria-hidden />
              {SHARE_COPY.back}
            </Link>
            <h1 className={styles.title}>{SHARE_COPY.title}</h1>
            <p className={styles.subtitle}>{SHARE_COPY.subtitle}</p>
          </div>
          {authLoading || !user ? (
            <Skeleton lines={4} label={SHARE_COPY.loading} />
          ) : (
            <section className={styles.card}>
              <div className={styles.row}>
                {phase === "sharing" ? (
                  <Button variant="secondary" onClick={stop}>
                    <Square size={16} aria-hidden />
                    {SHARE_COPY.stop}
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => void start()} disabled={phase === "starting"}>
                    <MonitorUp size={16} aria-hidden />
                    {SHARE_COPY.start}
                  </Button>
                )}
                <p className={styles.status} data-live={live || undefined} role="status" aria-live="polite">
                  <span className={styles.dot} aria-hidden />
                  {status}
                </p>
              </div>
              <video ref={videoRef} className={styles.preview} data-on={phase === "sharing" || undefined} muted playsInline />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
