"use client";

import { useEffect } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadReadAloud, sayNow } from "@/lib/speech/say";
import { SPEECH_COPY } from "./copy";

/**
 * The small speaker beside a hint or a coach mark: tap it and the words are said again, whatever
 * the setting. The read-aloud module is fetched when the button appears, so on iOS the tap itself
 * can start the sound (audio may only start inside a tap there). Its pointer events stop at the
 * button: a tap on it never reaches the canvas.
 */
export function SpeakButton({ text, className }: { text: string; className?: string }) {
  useEffect(() => {
    void loadReadAloud().catch(() => undefined);
  }, []);
  return (
    <button
      type="button"
      aria-label={SPEECH_COPY.replay}
      title={SPEECH_COPY.replay}
      data-speak-button=""
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        sayNow(text);
      }}
      className={cn(
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-gray-500 outline-none transition-colors hover:bg-gray-100 hover:text-gray-800 focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Volume2 aria-hidden className="size-4" />
    </button>
  );
}
