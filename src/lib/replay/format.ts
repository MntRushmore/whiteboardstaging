/** The replay's times, as its controls say them. Pure. */

/** "0:07", "1:26", "12:05", "1:02:09": a position on the replay's clock. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "Tue 4:12 pm": when the moment on screen was drawn, in the viewer's zone (or `timeZone`). */
export function formatRealTime(at: number, timeZone?: string): string {
  const d = new Date(at);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone })
    .format(d)
    .replace(/\s?([AP])M$/i, (_, ap: string) => ` ${ap.toLowerCase()}m`)
    .replace(/[  ]/g, " ");
  return `${day} ${time}`;
}

/** "1.2 MB", "840 KB" */
export function formatSize(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(kb >= 10_240 ? 0 : 1)} MB`;
  return `${Math.max(0, Math.round(kb))} KB`;
}

/**
 * "Screen 3": a screen's name in the switcher, by its place in the board (1-based), as the board's
 * own strip says it ("Screen 3 of 5", src/components/screens/ScreenStrip.tsx). Never the stored
 * page name: the first screen of every board is tldraw's "Page 1", and a screen keeps the number it
 * was made with after one before it is deleted.
 */
export function screenName(position: number): string {
  return `Screen ${position}`;
}
