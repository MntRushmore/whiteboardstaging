/** The words of agathon.app/share, and which status line shows. Pure, for the tests. */
import { VIEWER_STALE_MS } from "./frames";

export const SHARE_COPY = {
  title: "Share a window to your iPad",
  subtitle:
    "Pick the window with your questions (Acely, a worksheet, anything). It shows live beside your board on the iPad, under Mac screen, and you can bring a question onto the board. Nothing is saved.",
  start: "Choose a window",
  stop: "Stop sharing",
  back: "Back",
  loading: "Loading…",
  idle: "Not sharing.",
  waiting: "Sharing. Open a board on your iPad and tap Mac screen.",
  live: "Live on your iPad.",
  unsupported: "This browser can't share a window. Use Chrome, Edge or Safari on a Mac.",
  denied: "Sharing was cancelled.",
  failed: "Couldn't connect to your iPad. Try again.",
  ended: "Sharing stopped.",
} as const;

export type SharePhase = "idle" | "starting" | "sharing" | "error";

/** The status line: idle, waiting for the iPad, or live while the iPad is heard from. */
export function shareStatus(phase: SharePhase, viewerSeenAt: number | null, now: number, error?: string | null): string {
  if (phase === "error") return error ?? SHARE_COPY.failed;
  if (phase !== "sharing") return SHARE_COPY.idle;
  return viewerSeenAt !== null && now - viewerSeenAt < VIEWER_STALE_MS ? SHARE_COPY.live : SHARE_COPY.waiting;
}
