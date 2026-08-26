"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Tldraw } from "tldraw";
import { TldrawErrorBoundary } from "@/components/TldrawErrorBoundary";

type Props = ComponentProps<typeof Tldraw>;

/**
 * If tldraw's license gate or a throw removes `.tl-canvas`, remount.
 * Paper/rail live outside this wrapper and stay visible.
 */
export function PersistentTldraw(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const seenCanvas = useRef(false);
  const remounts = useRef(0);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    seenCanvas.current = false;
    const host = hostRef.current;
    if (!host) return;

    const tick = () => {
      const canvas = host.querySelector(".tl-canvas");
      const gated = host.querySelector('[data-testid="tl-license-expired"]');
      if (canvas) seenCanvas.current = true;
      if (!seenCanvas.current) return;
      if ((!canvas || gated) && remounts.current < 8) {
        seenCanvas.current = false;
        remounts.current += 1;
        setEpoch((value) => value + 1);
      }
    };

    const id = window.setInterval(tick, 800);
    return () => window.clearInterval(id);
  }, [epoch]);

  return (
    <div
      ref={hostRef}
      data-testid="persistent-tldraw"
      style={{ position: "absolute", inset: 0 }}
    >
      <TldrawErrorBoundary onReset={() => setEpoch((value) => value + 1)}>
        <Tldraw key={epoch} {...props} />
      </TldrawErrorBoundary>
    </div>
  );
}
