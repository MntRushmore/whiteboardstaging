/**
 * "Share a window to your iPad" (agathon.app/share): the Mac's chosen window, sent as JPEG frames
 * over a private Supabase Realtime broadcast channel to the board on the iPad (the owner, 2026-10-27:
 * "i need live view not copy paste img's"). Nothing is stored: the frames only pass through.
 *
 * The pure parts, shared with the tests: the channel's name, the frame's size and rate, a cheap
 * "did it change" check on a tiny grey copy, and the chunks a frame is cut into to fit a broadcast.
 */

/** The private channel of one person's screen: only they may send or listen (RLS on realtime.messages). */
export function screenTopic(userId: string): string {
  return `screen:${userId}`;
}

/** Broadcast events: a frame's chunk (Mac → iPad) and the viewer's "I'm watching" (iPad → Mac). */
export const FRAME_EVENT = "frame";
export const VIEWER_EVENT = "viewer";

/** The widest frame sent, in pixels (a question reads well at this size). */
export const MAX_WIDTH = 1280;
export const JPEG_QUALITY = 0.7;
/** How often the window is looked at, ms (2 a second). */
export const TICK_MS = 500;
/** An unchanged window is still sent this often, so an iPad that opens the panel late gets a picture. */
export const KEEPALIVE_MS = 4000;
/** The viewer says it's watching this often; the Mac shows "Live on your iPad" while it hears it. */
export const VIEWER_PING_MS = 4000;
export const VIEWER_STALE_MS = 12000;

/**
 * A chunk's base64 characters. Supabase's broadcast payload limit is 256 KB on the free plan; this
 * leaves room for the envelope.
 */
export const CHUNK_CHARS = 180_000;

/** One piece of a frame: frame number, piece i of n, the frame's size, and its base64 JPEG slice. */
export type FrameChunk = { f: number; i: number; n: number; w: number; h: number; d: string };

/** A frame's base64 JPEG cut into broadcast-sized chunks, in order. */
export function chunkFrame(frame: number, base64: string, w: number, h: number, size = CHUNK_CHARS): FrameChunk[] {
  const n = Math.max(1, Math.ceil(base64.length / size));
  const out: FrameChunk[] = [];
  for (let i = 0; i < n; i++) out.push({ f: frame, i, n, w, h, d: base64.slice(i * size, (i + 1) * size) });
  return out;
}

/** The size a frame is drawn at: the window's, no wider than MAX_WIDTH. */
export function frameSize(width: number, height: number, max = MAX_WIDTH): { w: number; h: number } {
  if (width <= 0 || height <= 0) return { w: 0, h: 0 };
  const k = Math.min(1, max / width);
  return { w: Math.round(width * k), h: Math.round(height * k) };
}

/** The tiny copy the change check looks at. */
export const PROBE_W = 64;
export const PROBE_H = 36;

/** A grey value per pixel of an RGBA picture. */
export function greyOf(rgba: ArrayLike<number>): Uint8Array {
  const n = Math.floor(rgba.length / 4);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  return out;
}

/**
 * Whether the window changed: more than `minPixels` of the tiny grey copy moved by more than
 * `delta` (a caret blinking is 1–2 pixels; a new question is hundreds). No earlier copy: changed.
 */
export function changed(prev: Uint8Array | null, next: Uint8Array, delta = 24, minPixels = 3): boolean {
  if (!prev || prev.length !== next.length) return true;
  let moved = 0;
  for (let i = 0; i < next.length; i++) {
    if (Math.abs(next[i] - prev[i]) > delta && ++moved >= minPixels) return true;
  }
  return false;
}

/** The base64 part of a data URL ("data:image/jpeg;base64,…"). */
export function base64Of(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : "";
}
