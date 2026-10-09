/**
 * "Save video" (2026-10-09, Phase 2 "parents recommend it"): the student's replay recorded as a
 * short video a grown-up can send — the board drawn again, stroke by stroke, then the finished
 * board, then a small Agathon card. Loaded on the tap (the replay's own chunk imports it lazily).
 *
 * HOW. A browser can only record a canvas in real time (MediaRecorder), and drawing a board frame
 * (tldraw's `toImage`) takes longer than a frame lasts. So it is done in two passes:
 *  1. Draw. For each frame of the plan (`planVideo`), the player is moved to that moment
 *     (`player.seek`: the same store updates the replay itself makes) and the screen's shown shapes
 *     are exported as a JPEG at the video's size. A frame where nothing changed reuses the last one.
 *     Only the small JPEGs are kept, not bitmaps, so a long board stays a few MB.
 *  2. Record. The frames are painted onto a canvas at the video's frame rate, each decoded just
 *     before its turn, while MediaRecorder records the canvas: MP4 where the browser can, else WebM.
 *     A hidden page pauses the recording until it is back (recordPacer.ts), so switching apps
 *     mid-way never leaves a frozen-then-skipping video.
 * The camera holds each screen's whole ink from start to end, so the video never jumps about.
 */
import { Box, DefaultColorThemePalette, type Editor, type TLPageId, type TLShape } from "tldraw";
import { CARD_COLORS, tickPoints } from "@/lib/share/card";
import { REPLAY_VIDEO_COPY } from "@/lib/share/copy";
import { canRecordVideo, fitInside, pickVideoFormat, planVideo, videoSize, VIDEO, type Rect, type VideoFormat, type VideoSize } from "@/lib/share/video";
import { frameAt, type Timeline } from "@/lib/replay/timeline";
import { cardFamilies, loadCardFonts, strokeTick } from "@/components/share/renderCard";
import type { ReplayPlayer } from "./player";
import { createRecordPacer, RecordingInterruptedError } from "./recordPacer";

export interface RecordProgress {
  phase: "drawing" | "recording";
  /** 0..1 across both passes (drawing is most of the wait) */
  share: number;
}

export interface RecordedVideo {
  blob: Blob;
  format: VideoFormat;
  durationMs: number;
}

/** Why a video could not be made: no recorder in this browser, or nothing to record. */
export class VideoUnavailableError extends Error {}

/** The share of the wait each pass takes, for one progress bar. */
const DRAW_SHARE = 0.75;
/** room round each screen's ink, in page units, before it is fitted to the frame */
const INK_PAD = 24;
/** the brand line under the board */
const FOOT = 76;
/** the board's own paper (frames are exported in the light theme): the whole frame is this, so the board has no edge */
const PAPER = DefaultColorThemePalette.lightMode.background;

const abortError = () => new DOMException("The video was cancelled.", "AbortError");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The box round everything on a screen (hidden shapes included: the whole board is on the store). */
function inkBounds(editor: Editor, pageId: string): Box | null {
  let box: Box | null = null;
  for (const id of editor.getPageShapeIds(pageId as TLPageId)) {
    const b = editor.getShapePageBounds(id);
    if (!b) continue;
    box = box ? Box.Common([box, b]) : b.clone();
  }
  return box ? box.expandBy(INK_PAD) : null;
}

/** The shapes the replay shows on `pageId` right now (the stage keeps the rest at opacity 0). */
function shownShapes(editor: Editor, pageId: string): TLShape[] {
  const out: TLShape[] = [];
  for (const id of editor.getPageShapeIds(pageId as TLPageId)) {
    const shape = editor.getShape(id);
    if (shape && shape.opacity > 0) out.push(shape);
  }
  return out;
}

/** A frame's identity on the timeline: two moments with the same one look the same. */
function frameKey(timeline: Timeline, ms: number): string {
  const f = frameAt(timeline, ms);
  return `${f.pageId}|${f.upTo}|${f.currentPoints}`;
}

interface Layout {
  size: VideoSize;
  /** where the board goes */
  content: Rect;
}

function layoutFor(size: VideoSize): Layout {
  const pad = VIDEO.padding;
  return { size, content: { x: pad, y: pad, w: size.width - 2 * pad, h: size.height - pad - FOOT - 8 } };
}

/** The board's frame: the board's paper, the screen's picture fitted, and the brand line under it. */
function paintBoard(ctx: CanvasRenderingContext2D, layout: Layout, image: ImageBitmap | null, families: Record<"display" | "body", string>, paper: string): void {
  const { width, height } = layout.size;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  if (image) {
    const r = fitInside(image.width, image.height, layout.content);
    ctx.drawImage(image, r.x, r.y, r.w, r.h);
  }
  const y = height - FOOT / 2;
  strokeTick(ctx, tickPoints(VIDEO.padding, y - 12, 21, 24, 5), 3, CARD_COLORS.tutor);
  ctx.fillStyle = CARD_COLORS.ink;
  ctx.font = `600 30px ${families.display}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(REPLAY_VIDEO_COPY.brand, VIDEO.padding + 32, y + 1);
  ctx.fillStyle = CARD_COLORS.muted;
  ctx.font = `500 24px ${families.body}`;
  ctx.textAlign = "right";
  ctx.fillText(REPLAY_VIDEO_COPY.site, width - VIDEO.padding, y + 1);
}

/**
 * The paper's colour as the JPEG frames came out (a hair off the theme's after compression): the
 * frame is filled with it, so the board's picture has no visible edge.
 */
function paperOf(image: ImageBitmap): string {
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    if (!ctx) return PAPER;
    ctx.drawImage(image, 2, 2, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return PAPER;
  }
}

/** The end card: Arc's wash, the tutor's tick drawing itself in, the name and the site. */
function paintEndCard(ctx: CanvasRenderingContext2D, layout: Layout, t: number, families: Record<"display" | "body", string>): void {
  const { width, height } = layout.size;
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, CARD_COLORS.washFrom);
  g.addColorStop(1, CARD_COLORS.washTo);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  const tickH = Math.min(width, height) * 0.16;
  const pts = tickPoints(cx - tickH * 0.45, cy - tickH * 1.35, tickH * 0.9, tickH, 42);
  // the tick draws itself over the first 40% of the card, as the tutor's pen would
  const drawn = Math.max(2, Math.ceil(pts.length * Math.min(1, t / 0.4)));
  strokeTick(ctx, pts.slice(0, drawn), tickH * 0.11, CARD_COLORS.tutor);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = CARD_COLORS.ink;
  ctx.font = `600 ${Math.round(tickH * 0.62)}px ${families.display}`;
  ctx.fillText(REPLAY_VIDEO_COPY.brand, cx, cy + tickH * 0.3);
  ctx.fillStyle = CARD_COLORS.secondary;
  ctx.font = `500 ${Math.round(tickH * 0.2)}px ${families.body}`;
  ctx.fillText(REPLAY_VIDEO_COPY.tagline, cx, cy + tickH * 0.72);
  ctx.fillStyle = CARD_COLORS.muted;
  ctx.font = `500 ${Math.round(tickH * 0.17)}px ${families.body}`;
  ctx.fillText(REPLAY_VIDEO_COPY.site, cx, height - VIDEO.padding - 8);
}

/**
 * Records the replay `player` shows as a video. Moves the player through the replay (it is paused
 * and put back where it was when done), so the caller covers it with its progress. Throws
 * `VideoUnavailableError` when the browser cannot record or there is nothing to record, and an
 * `AbortError` when `signal` is aborted.
 */
export async function recordReplayVideo(player: ReplayPlayer, opts: { signal?: AbortSignal; onProgress?: (p: RecordProgress) => void } = {}): Promise<RecordedVideo> {
  const { signal, onProgress } = opts;
  const editor = player.getEditor();
  const timeline = player.getTimeline();
  const format = typeof MediaRecorder === "undefined" ? null : pickVideoFormat((t) => MediaRecorder.isTypeSupported(t));
  if (!format || !canRecordVideo()) throw new VideoUnavailableError(REPLAY_VIDEO_COPY.unsupported);
  if (!editor || timeline.items.length === 0) throw new VideoUnavailableError(REPLAY_VIDEO_COPY.empty);

  const before = player.getState();
  player.pause();
  try {
    const families = cardFamilies();
    await loadCardFonts(families);

    // each screen's ink, whole; the video's shape from the busiest screen's
    const counts = new Map<string, number>();
    for (const item of timeline.items) counts.set(item.pageId, (counts.get(item.pageId) ?? 0) + 1);
    const bounds = new Map<string, Box>();
    for (const pageId of counts.keys()) {
      const b = inkBounds(editor, pageId);
      if (b) bounds.set(pageId, b);
    }
    const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const main = (busiest && bounds.get(busiest)) || null;
    const layout = layoutFor(videoSize(main ? main.w / main.h : 0.8));
    const plan = planVideo(timeline.durationMs);

    // 1. draw: one JPEG per distinct frame
    const frames: (Blob | null)[] = [];
    let lastKey = "";
    let last: Blob | null = null;
    for (let i = 0; i < plan.times.length; i++) {
      if (signal?.aborted) throw abortError();
      const ms = plan.times[i];
      const key = frameKey(timeline, ms);
      if (key !== lastKey) {
        lastKey = key;
        player.pause();
        player.seek(ms);
        const pageId = frameAt(timeline, ms).pageId;
        const box = pageId ? bounds.get(pageId) : null;
        const shapes = pageId ? shownShapes(editor, pageId) : [];
        if (!box || shapes.length === 0) last = null;
        else {
          const scale = Math.min(layout.content.w / box.w, layout.content.h / box.h);
          try {
            const { blob } = await editor.toImage(shapes, { bounds: box, background: true, darkMode: false, padding: 0, scale, pixelRatio: 1, format: "jpeg", quality: 0.9 });
            last = blob;
          } catch (error) {
            // one frame that would not draw keeps the one before it
            console.warn("Replay video: a frame did not draw", error);
          }
        }
      }
      frames.push(last);
      onProgress?.({ phase: "drawing", share: (DRAW_SHARE * (i + 1)) / plan.times.length });
    }

    // 2. record, in real time
    const canvas = document.createElement("canvas");
    canvas.width = layout.size.width;
    canvas.height = layout.size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new VideoUnavailableError(REPLAY_VIDEO_COPY.unsupported);
    let paper: string | null = null;
    paintBoard(ctx, layout, null, families, PAPER);
    const stream = canvas.captureStream(plan.fps);
    // a key frame every second (Chrome; others ignore it): a screen turned to a near-white page
    // otherwise keeps a faint ghost of the last one, which the encoder thinks too small to fix
    const recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: VIDEO.bitsPerSecond, videoKeyFrameIntervalDuration: VIDEO.keyFrameMs } as MediaRecorderOptions);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = (e) => reject((e as unknown as { error?: Error }).error ?? new Error("The recorder failed."));
    });
    // cancelled mid-way, nothing waits for it: its failure is not news
    stopped.catch(() => {});

    const total = frames.length + plan.holdFrames + plan.endFrames;
    const frameMs = 1000 / plan.fps;
    const decoded = new Map<Blob, Promise<ImageBitmap>>();
    const decode = (blob: Blob | null) => {
      if (!blob) return Promise.resolve(null);
      let p = decoded.get(blob);
      if (!p) {
        p = createImageBitmap(blob);
        decoded.set(blob, p);
      }
      return p;
    };
    let shown: Blob | null | undefined;
    let bitmap: ImageBitmap | null = null;
    // pauses the recorder while the page is hidden, and keeps the frames on time (recordPacer.ts)
    const pacer = createRecordPacer({ recorder, doc: document, frameMs });
    recorder.start(500);
    pacer.start();
    try {
      for (let i = 0; i < total; i++) {
        if (signal?.aborted) throw abortError();
        await pacer.beforeFrame(signal);
        if (signal?.aborted) throw abortError();
        if (i < frames.length || i < frames.length + plan.holdFrames) {
          const blob = frames[Math.min(i, frames.length - 1)];
          if (blob !== shown) {
            const next = await decode(blob);
            if (bitmap && bitmap !== next) bitmap.close();
            if (shown) decoded.delete(shown);
            if (next && paper === null) paper = paperOf(next);
            bitmap = next;
            shown = blob;
            // decode the next distinct frame while this one shows
            const ahead = frames.slice(i + 1).find((f) => f !== blob);
            if (ahead) void decode(ahead).catch(() => {});
          }
          paintBoard(ctx, layout, bitmap, families, paper ?? PAPER);
        } else {
          paintEndCard(ctx, layout, (i - frames.length - plan.holdFrames) / Math.max(1, plan.endFrames), families);
        }
        onProgress?.({ phase: "recording", share: DRAW_SHARE + ((1 - DRAW_SHARE) * (i + 1)) / total });
        const wait = pacer.waitAfter(i);
        if (wait > 0) await sleep(wait);
      }
    } catch (error) {
      // hidden mid-recording where the recorder cannot pause: no spoiled video offered as ready
      if (error instanceof RecordingInterruptedError) throw new VideoUnavailableError(REPLAY_VIDEO_COPY.keepOpen);
      throw error;
    } finally {
      pacer.dispose();
      if (recorder.state !== "inactive") recorder.stop();
      for (const track of stream.getTracks()) track.stop();
      bitmap?.close();
    }
    await stopped;
    if (signal?.aborted) throw abortError();
    const blob = new Blob(chunks, { type: format.mimeType.split(";")[0] });
    if (blob.size === 0) throw new Error("The recorder made an empty video.");
    return { blob, format, durationMs: plan.durationMs };
  } finally {
    // the replay where it was, paused (the student taps play again)
    player.seek(before.ms);
  }
}
