"use client";

import { useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";

const subscribeNever = () => () => {};

/**
 * Watch again, under the hero's iPad: plays the board's replay from the start. The replay is CSS
 * animations on the server-rendered board (`BoardReplay`), so this restarts them where they are
 * rather than re-rendering anything. Disabled until the page is interactive (a tap before then would
 * do nothing), and hidden by CSS for reduced motion, where there is no replay to watch.
 */
export function ReplayButton({ targetId, label, className }: { targetId: string; label: string; className?: string }) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  return (
    <button
      type="button"
      className={className}
      disabled={!hydrated}
      onClick={() => {
        const board = document.getElementById(targetId);
        for (const animation of board?.getAnimations({ subtree: true }) ?? []) {
          animation.cancel();
          animation.play();
        }
      }}
    >
      <RotateCcw size={16} strokeWidth={2} aria-hidden />
      {label}
    </button>
  );
}
