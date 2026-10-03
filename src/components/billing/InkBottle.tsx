import { useId } from "react";
import type { InkTone } from "@/lib/billing/inkSummary";

/**
 * An ink bottle whose liquid level shows the balance (`fill`, 0..1, from bottleFill()). Pure SVG,
 * no state: the small glyph is the ink meter's icon (header and board bar), the large one the
 * account page's Ink card. The liquid is ink-blue while there is plenty, amber when low, and the
 * bottle is an empty red outline at zero, so the three states read without the number too.
 *
 * Imports nothing from tldraw (AppHeader renders it on prerendered pages).
 */

const LIQUID: Record<InkTone, string> = {
  ok: "#3346d3",
  low: "#d97706",
  empty: "transparent",
};
const GLASS: Record<InkTone, string> = {
  ok: "currentColor",
  low: "#b45309",
  empty: "#dc2626",
};

export function InkBottle({
  fill,
  tone,
  size = "sm",
  className,
}: {
  fill: number;
  tone: InkTone;
  size?: "sm" | "lg";
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const level = Math.min(1, Math.max(0, fill));
  return size === "lg" ? <LargeBottle id={id} level={level} tone={tone} className={className} /> : <SmallBottle id={id} level={level} tone={tone} className={className} />;
}

/** 16 x 16: a cap, a short neck and a rounded body; the liquid fills the body from the bottom. */
function SmallBottle({ id, level, tone, className }: { id: string; level: number; tone: InkTone; className?: string }) {
  const clip = `ink-sm-${id}`;
  // The body spans y 5.5..14.5 (9 units); the liquid rises from its floor.
  const top = 14.5 - 9 * level;
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" className={className} aria-hidden focusable="false" data-fill={level.toFixed(2)}>
      <defs>
        <clipPath id={clip}>
          <rect x="3.5" y="5.5" width="9" height="9" rx="2.25" />
        </clipPath>
      </defs>
      <rect x="3.5" y={top} width="9" height={14.5 - top} fill={LIQUID[tone]} clipPath={`url(#${clip})`} />
      <g fill="none" stroke={GLASS[tone]} strokeWidth="1.25" strokeLinejoin="round">
        <rect x="3.5" y="5.5" width="9" height="9" rx="2.25" />
        <path d="M6.25 5.5V3.75h3.5V5.5" />
        <rect x="5.5" y="1.5" width="5" height="2.25" rx="0.75" />
      </g>
    </svg>
  );
}

/**
 * 120 x 150: a squat bottle with shoulders, a neck and a cork. The liquid's surface is a gentle
 * wave; a soft highlight on the glass keeps it from reading as a flat icon.
 */
function LargeBottle({ id, level, tone, className }: { id: string; level: number; tone: InkTone; className?: string }) {
  const clip = `ink-lg-${id}`;
  const shade = `ink-lg-shade-${id}`;
  // The body's inside runs from y 140 (floor) up to y 52 (where the shoulders meet the neck).
  const surface = 140 - 88 * level;
  const body = "M38 40 L38 50 C22 56 14 68 14 84 L14 126 C14 135 21 142 30 142 L90 142 C99 142 106 135 106 126 L106 84 C106 68 98 56 82 50 L82 40 Z";
  return (
    <svg viewBox="0 0 120 150" width="120" height="150" className={className} aria-hidden focusable="false" data-fill={level.toFixed(2)}>
      <defs>
        <clipPath id={clip}>
          <path d={body} />
        </clipPath>
        <linearGradient id={shade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={LIQUID[tone]} stopOpacity="0.85" />
          <stop offset="1" stopColor={LIQUID[tone]} stopOpacity="1" />
        </linearGradient>
      </defs>
      {level > 0 && (
        <path
          d={`M0 ${surface} Q 20 ${surface - 4} 40 ${surface} T 80 ${surface} T 120 ${surface} L120 150 L0 150 Z`}
          fill={`url(#${shade})`}
          clipPath={`url(#${clip})`}
        />
      )}
      <path d={body} fill="none" stroke={GLASS[tone]} strokeWidth="3" strokeLinejoin="round" opacity={tone === "ok" ? 0.75 : 1} />
      <path d="M26 92 C26 80 30 72 38 66" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.55" />
      <rect x="34" y="18" width="52" height="24" rx="5" fill="#8b5e3c" opacity={tone === "empty" ? 0.6 : 0.9} />
      <rect x="34" y="18" width="52" height="24" rx="5" fill="none" stroke={GLASS[tone]} strokeWidth="3" opacity={tone === "ok" ? 0.75 : 1} />
    </svg>
  );
}
