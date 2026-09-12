/**
 * Pure helpers behind the math shape's badge and note line (no React, no tldraw) so the
 * behaviour is unit-testable in node.
 *
 * Seam with the live loop: tapping the badge dispatches a `live:badge-tap` CustomEvent on
 * `window` with `{ lineId, shapeId }`; the loop listens and calls `requestCheck(lineId)`.
 */
import type { LiveVerdict } from "@/lib/live/contracts";

export const BADGE_TAP_EVENT = "live:badge-tap";

export interface BadgeTapDetail {
  lineId: string;
  shapeId: string;
}

export type BadgeStatus = Extract<LiveVerdict, "ok" | "warn" | "solved">;

/** Default badge copy (tooltip + accessible name) when the echo carries no note. */
export const BADGE_COPY: Record<BadgeStatus, string> = {
  ok: "Checks out",
  warn: "Look here",
  solved: "Solved",
};

/** Suffix added to the accessible name so screen-reader users know the badge does something. */
export const BADGE_TAP_HINT = "tap for a hint";

export const BALANCED_NOTE_PREFIX = "Balanced";

export function isBadgeStatus(status: LiveVerdict): status is BadgeStatus {
  return status === "ok" || status === "warn" || status === "solved";
}

/** Tooltip: the note when there is one, otherwise the default copy. */
export function badgeTitle(status: BadgeStatus, note: string): string {
  const n = note.trim();
  return n || BADGE_COPY[status];
}

/** Accessible name: copy (+ note) and, for the amber dot, the tap affordance. */
export function badgeLabel(status: BadgeStatus, note: string): string {
  const n = note.trim();
  const head = n && n !== BADGE_COPY[status] ? `${BADGE_COPY[status]}: ${n}` : BADGE_COPY[status];
  return status === "warn" ? `${head} — ${BADGE_TAP_HINT}` : head;
}

export interface NoteLine {
  /** plain text part (rendered as-is) */
  text: string;
  /** LaTeX part rendered with KaTeX after `text` ('' when none) */
  latex: string;
}

/**
 * The secondary line under the LaTeX: shown for amber-dot notes and for `Balanced…` notes
 * (the loop only sends the balanced equation in Solve mode). `Balanced: <latex>` splits into
 * a text prefix and a KaTeX part so the equation renders properly.
 */
export function noteLineFor(status: LiveVerdict, note: string): NoteLine | null {
  const n = note.trim();
  if (!n) return null;
  const balanced = n.startsWith(BALANCED_NOTE_PREFIX);
  if (status !== "warn" && !balanced) return null;
  if (balanced) {
    const m = /^Balanced\s*:\s*([\s\S]*)$/.exec(n);
    if (m && m[1].trim()) return { text: "Balanced:", latex: m[1].trim() };
  }
  return { text: n, latex: "" };
}

/** Dispatches the badge-tap seam event; false when there is no window (SSR/tests). */
export function dispatchBadgeTap(detail: BadgeTapDetail): boolean {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return false;
  window.dispatchEvent(new CustomEvent<BadgeTapDetail>(BADGE_TAP_EVENT, { detail }));
  return true;
}
