/**
 * The replay as a video (2026-10-09, Phase 2 "parents recommend it"): a timelapse of a kid solving
 * a problem is the other thing parents post. "Save video" on the student's replay draws the replay
 * frame by frame into a canvas and records it (`src/components/replay/recordReplay.ts`); this module
 * is the plan, pure: how long the video runs, which moment of the replay each frame shows, how big
 * it is, and which format the browser can record.
 *
 * Length. However long the lesson, the video is short enough to watch and send: the replay plays at
 * whatever speed makes it about `targetMs` (never slower than the replay itself), then the finished
 * board holds for a moment, then a small Agathon card ends it.
 */

export const VIDEO = {
  /** frames per second: smooth enough for handwriting, few enough to draw quickly */
  fps: 20,
  /** the replay part runs about this long */
  targetMs: 15_000,
  /** a short replay is never stretched: it plays at 1x at least */
  minSpeed: 1,
  /** the finished board, held */
  holdMs: 1_400,
  /** the end card */
  endCardMs: 2_400,
  /** room round the board's ink, in the video's px */
  padding: 56,
  /** the encoder's budget: crisp ink on near-white without a big file (about 1 MB for 15 s) */
  bitsPerSecond: 6_000_000,
  /** a key frame at least this often (see recordReplay: no ghost of the last screen) */
  keyFrameMs: 1_000,
} as const;

export interface VideoSize {
  width: number;
  height: number;
}

/** The video's shapes: portrait for a phone's feed, square, or wide for a wide board. */
export const VIDEO_SIZES: readonly VideoSize[] = [
  { width: 1080, height: 1350 },
  { width: 1080, height: 1080 },
  { width: 1280, height: 720 },
];

/** The size whose shape is closest to the ink's (`width / height`), so the writing fills the frame. */
export function videoSize(inkAspect: number): VideoSize {
  if (!Number.isFinite(inkAspect) || inkAspect <= 0) return VIDEO_SIZES[0];
  let best = VIDEO_SIZES[0];
  let bestScore = Infinity;
  for (const size of VIDEO_SIZES) {
    // compare shapes on a log scale: 2:1 is as far from 1:1 as 1:2 is
    const score = Math.abs(Math.log(size.width / size.height) - Math.log(inkAspect));
    if (score < bestScore) {
      best = size;
      bestScore = score;
    }
  }
  return best;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A `w` × `h` picture scaled to fit inside `box`, centred. */
export function fitInside(w: number, h: number, box: Rect): Rect {
  if (w <= 0 || h <= 0) return { ...box, w: 0, h: 0 };
  const scale = Math.min(box.w / w, box.h / h);
  const fw = w * scale;
  const fh = h * scale;
  return { x: box.x + (box.w - fw) / 2, y: box.y + (box.h - fh) / 2, w: fw, h: fh };
}

export interface VideoPlan {
  /** replay ms per replay second of video */
  speed: number;
  /** the replay's clock at each frame of the replay part, in order (the last is its end) */
  times: number[];
  /** frames of the finished board, held, and of the end card */
  holdFrames: number;
  endFrames: number;
  fps: number;
  /** the whole video, ms */
  durationMs: number;
}

/** Which moment of a `durationMs` replay each frame shows, at a speed that makes it about `targetMs`. */
export function planVideo(durationMs: number, opts: { fps?: number; targetMs?: number } = {}): VideoPlan {
  const fps = opts.fps ?? VIDEO.fps;
  const target = opts.targetMs ?? VIDEO.targetMs;
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const speed = Math.max(VIDEO.minSpeed, duration / target);
  const frames = Math.max(1, Math.ceil(((duration / speed) * fps) / 1000));
  const times: number[] = [];
  for (let i = 1; i <= frames; i++) times.push(Math.min(duration, (i * 1000 * speed) / fps));
  const holdFrames = Math.round((VIDEO.holdMs * fps) / 1000);
  const endFrames = Math.round((VIDEO.endCardMs * fps) / 1000);
  return { speed, times, holdFrames, endFrames, fps, durationMs: Math.round(((frames + holdFrames + endFrames) * 1000) / fps) };
}

export interface VideoFormat {
  mimeType: string;
  extension: "mp4" | "webm";
}

/** What the browser can record, best first: MP4 (plays everywhere, Safari and Chrome record it), else WebM. */
export const VIDEO_TYPES: readonly VideoFormat[] = [
  { mimeType: "video/mp4;codecs=avc1.42E01E", extension: "mp4" },
  { mimeType: "video/mp4;codecs=avc1", extension: "mp4" },
  { mimeType: "video/mp4", extension: "mp4" },
  { mimeType: "video/webm;codecs=vp9", extension: "webm" },
  { mimeType: "video/webm;codecs=vp8", extension: "webm" },
  { mimeType: "video/webm", extension: "webm" },
];

/** The first format `isSupported` (MediaRecorder.isTypeSupported) takes; null when it takes none. */
export function pickVideoFormat(isSupported: (mimeType: string) => boolean): VideoFormat | null {
  for (const format of VIDEO_TYPES) {
    try {
      if (isSupported(format.mimeType)) return format;
    } catch {
      // a browser that throws on the question cannot record it
    }
  }
  return null;
}

/** Whether this browser can record a canvas at all (MediaRecorder, canvas capture, and a format). */
export function canRecordVideo(): boolean {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined") return false;
  if (!("captureStream" in HTMLCanvasElement.prototype)) return false;
  return pickVideoFormat((t) => MediaRecorder.isTypeSupported(t)) !== null;
}

/** The saved file's name: no student name in it. */
export function videoFileName(day: string, extension: VideoFormat["extension"]): string {
  return `agathon-replay-${day}.${extension}`;
}
