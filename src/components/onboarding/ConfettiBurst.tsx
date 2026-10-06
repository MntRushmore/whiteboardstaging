"use client";

import { useState, type CSSProperties } from "react";
import { confettiPieces } from "@/lib/confetti";

/**
 * One burst of confetti from a point: the board's own cheer (`Celebrations`), for onboarding's big
 * moments — the end of the guided board, and the home welcoming a student back from starting their
 * free trial. Place it with `style` (its origin is its top-left corner); it draws nothing for
 * pointers or screen readers, and prefers-reduced-motion hides it (globals.css).
 */
export function ConfettiBurst({ count = 36, spread = 120, style, className }: { count?: number; spread?: number; style?: CSSProperties; className?: string }) {
  // drawn once per mount: a re-render must not throw the pieces somewhere else mid-flight
  const [pieces] = useState(() => confettiPieces(count, spread));
  return (
    <span aria-hidden data-confetti="" className={className} style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none", ...style }}>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="celebrate-confetti"
          style={
            {
              position: "absolute",
              left: 0,
              top: 0,
              display: "block",
              width: p.round ? 8 : 6,
              height: 8,
              borderRadius: p.round ? 9999 : 1,
              backgroundColor: p.color,
              animationDelay: `${p.delay}ms`,
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
              "--rot": `${p.rot}deg`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
