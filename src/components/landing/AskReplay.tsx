"use client";

import { useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";

const subscribeNever = () => () => {};

/**
 * Watch again, under the Ask demo: plays the exchange from the start. The demo is CSS animations on
 * the server-rendered panel and board (`AskDemo`), so this restarts them where they are rather than
 * re-rendering anything (as the hero's ReplayButton does). Disabled until the page is interactive,
 * and hidden by CSS for reduced motion, where there is nothing to watch.
 */
export function AskReplay({ targetId, label, className }: { targetId: string; label: string; className?: string }) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  return (
    <button
      type="button"
      className={className}
      disabled={!hydrated}
      onClick={() => {
        for (const animation of document.getElementById(targetId)?.getAnimations({ subtree: true }) ?? []) {
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
