import { loadSnapshot, react, type Editor, type TLPageId, type TLRecord } from "tldraw";
import { diffRecords } from "@/lib/replay/diff";
import { firstOnPage, frameAt, type ReplayItem, type Timeline } from "@/lib/replay/timeline";
import { DEFAULT_SCREEN, readScreenMeta, screenForContent, type ScreenMeta } from "@/lib/screens/screens";
import type { LoadedBoard } from "./loadBoard";
import { ReplayStage } from "./stage";

export type ReplayMode = "board" | "replay";

export const REPLAY_SPEEDS = [1, 2, 4, 8, 16] as const;

/** ←/→ move the replay this far (its own clock) */
export const SEEK_STEP_MS = 5_000;

/** The slowest speed (from `min`) that plays the whole replay in about `targetMs`; the fastest when none does. */
export function speedFor(durationMs: number, targetMs: number, min = 1): number {
  for (const s of REPLAY_SPEEDS) if (s >= min && durationMs / s <= targetMs) return s;
  return REPLAY_SPEEDS[REPLAY_SPEEDS.length - 1];
}

export interface PlayerState {
  mode: ReplayMode;
  playing: boolean;
  speed: number;
  /** on the replay's clock */
  ms: number;
  durationMs: number;
  /** the screen shown */
  pageId: string | null;
  /** the replay reached its end (by playing) */
  ended: boolean;
  /** bumped each time the replay moves to another screen (the UI fades it in) */
  pageTurns: number;
}

export interface PlayerOptions {
  mode?: ReplayMode;
  speed?: number;
  /** start playing as soon as the canvas is there */
  autoplay?: boolean;
  /** room around the screen when it is fitted to the canvas, px */
  padding?: number;
  /** what the camera holds: the whole screen (the board's own view; default), or the part of it with ink (bigger on a phone) */
  fit?: "screen" | "ink";
  /** each time a forward play draws new items (not on a seek): the student's replay cheers its ticks */
  onItemsStarted?: (items: ReplayItem[]) => void;
}

interface FrameStats {
  /** ms between animation frames while playing */
  intervals: number[];
  /** ms spent putting each frame on the store */
  applies: number[];
}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 100) / 100;
};

/**
 * Plays a board's timeline on a read-only editor of its own. Not React: the canvas hands it the
 * editor (`attach`), the controls read `getState()` through `subscribe` (one small object per
 * animation frame, so only they re-render), and every frame goes straight from the clock to the
 * store (`ReplayStage`). Knows nothing of who may watch: it takes a board and a timeline.
 */
export class ReplayPlayer {
  private state: PlayerState;
  private readonly listeners = new Set<() => void>();
  private editor: Editor | null = null;
  private stage: ReplayStage | null = null;
  private baseById = new Map<string, TLRecord>();
  private screens = new Map<string, ScreenMeta>();
  /** `fit: "ink"`: each screen's inked part */
  private inks = new Map<string, ScreenMeta>();
  private raf = 0;
  private lastTick = 0;
  private stopViewport: (() => void) | null = null;
  private readonly stats: FrameStats = { intervals: [], applies: [] };

  constructor(
    private board: LoadedBoard,
    private timeline: Timeline,
    private readonly opts: PlayerOptions = {},
  ) {
    const mode = opts.mode ?? "board";
    this.state = {
      mode,
      playing: false,
      speed: opts.speed ?? 1,
      ms: mode === "board" ? timeline.durationMs : 0,
      durationMs: timeline.durationMs,
      pageId: board.currentPageId,
      ended: false,
      pageTurns: 0,
    };
  }

  // ------------------------------------------------------------------ state

  getState = (): PlayerState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private set(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of [...this.listeners]) fn();
  }

  getTimeline(): Timeline {
    return this.timeline;
  }

  getEditor(): Editor | null {
    return this.editor;
  }

  /** Frame timings while playing (the perf check): percentiles of the gaps between frames and of the store work per frame. */
  frameStats(): { frames: number; intervalP50: number; intervalP95: number; applyP50: number; applyP95: number; applyMax: number } {
    return {
      frames: this.stats.intervals.length,
      intervalP50: pct(this.stats.intervals, 0.5),
      intervalP95: pct(this.stats.intervals, 0.95),
      applyP50: pct(this.stats.applies, 0.5),
      applyP95: pct(this.stats.applies, 0.95),
      applyMax: pct(this.stats.applies, 1),
    };
  }

  resetFrameStats(): void {
    this.stats.intervals.length = 0;
    this.stats.applies.length = 0;
  }

  // ------------------------------------------------------------------ the canvas

  /** The canvas mounted: the board's pages go on its store, then the frame for the current state. */
  attach(editor: Editor): void {
    this.editor = editor;
    const base = this.board.records.filter((r) => r.typeName !== "shape" && r.typeName !== "binding");
    this.baseById = new Map(base.map((r) => [r.id, r]));
    if (base.some((r) => r.typeName === "page")) {
      loadSnapshot(editor.store, { store: Object.fromEntries(base.map((r) => [r.id, r])), schema: this.board.schema } as Parameters<typeof loadSnapshot>[1]);
    }
    editor.updateInstanceState({ isReadonly: true });
    editor.setCurrentTool("hand");
    this.stage = new ReplayStage(editor.store, this.board.records, this.timeline);
    // every screen's rect, from its meta or (a board from before screens) from all its ink
    this.stage.showAll();
    this.screens = new Map(editor.getPages().map((p) => [p.id, this.screenOf(p.id)]));
    if (this.opts.fit === "ink") {
      for (const [id, screen] of this.screens) {
        const ink = this.inkOf(id, screen);
        if (ink) this.inks.set(id, ink);
      }
    }
    const start = this.state.pageId && editor.getPage(this.state.pageId as TLPageId) ? this.state.pageId : (this.timeline.pages[this.timeline.pages.length - 1] ?? editor.getCurrentPageId());
    this.goToPage(start);
    this.render({ seek: true });
    // the canvas changed size (a phone turned, the panel beside it): the screen is fitted again
    let lastSize = "";
    this.stopViewport = react("replay viewport", () => {
      const b = editor.getViewportScreenBounds();
      const size = `${Math.round(b.w)}x${Math.round(b.h)}`;
      if (size === lastSize) return;
      lastSize = size;
      queueMicrotask(() => this.editor === editor && this.fit(editor.getCurrentPageId(), false));
    });
    if (this.opts.autoplay) this.play();
  }

  detach(): void {
    this.pause();
    this.stopViewport?.();
    this.stopViewport = null;
    this.stage = null;
    this.editor = null;
  }

  dispose(): void {
    this.detach();
    this.listeners.clear();
  }

  /** The box round everything on `pageId` (the whole board is on the store when this is asked). */
  private contentOf(pageId: string): ScreenMeta | null {
    const editor = this.editor;
    if (!editor) return null;
    let box: ScreenMeta | null = null;
    for (const id of editor.getPageShapeIds(pageId as TLPageId)) {
      const b = editor.getShapePageBounds(id);
      if (!b) continue;
      if (!box) box = { x: b.x, y: b.y, w: b.w, h: b.h };
      else {
        const x = Math.min(box.x, b.x);
        const y = Math.min(box.y, b.y);
        box = { x, y, w: Math.max(box.x + box.w, b.maxX) - x, h: Math.max(box.y + box.h, b.maxY) - y };
      }
    }
    return box;
  }

  private screenOf(pageId: string): ScreenMeta {
    const stored = readScreenMeta(this.editor?.getPage(pageId as TLPageId)?.meta);
    return stored ?? screenForContent(this.contentOf(pageId));
  }

  /**
   * `fit: "ink"`: the part of the screen with ink on it, a little room round it, and never less than
   * half the screen each way (one small sum stays a sum, not a poster). Null with no ink.
   */
  private inkOf(pageId: string, screen: ScreenMeta): ScreenMeta | null {
    const ink = this.contentOf(pageId);
    if (!ink) return null;
    const pad = 48;
    const w = Math.min(screen.w, Math.max(ink.w + 2 * pad, screen.w / 2));
    const h = Math.min(screen.h, Math.max(ink.h + 2 * pad, screen.h / 2));
    const cx = ink.x + ink.w / 2;
    const cy = ink.y + ink.h / 2;
    // inside the screen where it can be, so the frame's edge does not show for nothing
    const x = Math.min(Math.max(cx - w / 2, screen.x), screen.x + screen.w - w);
    const y = Math.min(Math.max(cy - h / 2, screen.y), screen.y + screen.h - h);
    return { x, y, w, h };
  }

  /** Holds the camera on `pageId`'s screen (or its ink), fitted to the canvas; pan and zoom stay free inside it. */
  private fit(pageId: string, animate: boolean): void {
    const editor = this.editor;
    if (!editor) return;
    const screen = this.screens.get(pageId) ?? readScreenMeta(editor.getPage(pageId as TLPageId)?.meta) ?? DEFAULT_SCREEN;
    const bounds = (this.opts.fit === "ink" && this.inks.get(pageId)) || screen;
    const pad = this.opts.padding ?? 12;
    editor.setCameraOptions({
      ...editor.getCameraOptions(),
      zoomSteps: [1, 1.5, 2, 3, 4],
      wheelBehavior: "pan",
      constraints: {
        bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
        padding: { x: pad, y: pad },
        origin: { x: 0.5, y: 0.5 },
        initialZoom: "fit-max",
        baseZoom: "fit-max",
        behavior: "contain",
      },
    });
    editor.setCamera(editor.getCamera(), animate ? { reset: true, animation: { duration: 380 } } : { reset: true, immediate: true });
  }

  private goToPage(pageId: string | null): void {
    const editor = this.editor;
    if (!editor || !pageId || !editor.getPage(pageId as TLPageId)) return;
    const turned = editor.getCurrentPageId() !== pageId;
    if (turned) editor.setCurrentPage(pageId as TLPageId);
    this.fit(pageId, false);
    if (turned || this.state.pageId !== pageId) this.set({ pageId, pageTurns: this.state.pageTurns + (turned ? 1 : 0) });
  }

  // ------------------------------------------------------------------ frames

  private render({ seek }: { seek: boolean }): void {
    const stage = this.stage;
    if (!stage || !this.editor) return;
    if (this.state.mode === "board") {
      stage.showAll();
      return;
    }
    const frame = frameAt(this.timeline, this.state.ms);
    const before = stage.shownCount;
    const t0 = performance.now();
    stage.apply(frame);
    if (!seek) push(this.stats.applies, performance.now() - t0);
    if (frame.pageId && frame.pageId !== this.editor.getCurrentPageId()) this.goToPage(frame.pageId);
    if (!seek && frame.upTo > before && this.opts.onItemsStarted) this.opts.onItemsStarted(this.timeline.items.slice(before, frame.upTo));
  }

  private tick = (now: number): void => {
    this.raf = 0;
    if (!this.state.playing) return;
    const dt = Math.min(100, Math.max(0, now - this.lastTick));
    if (this.lastTick > 0) push(this.stats.intervals, now - this.lastTick);
    this.lastTick = now;
    const ms = Math.min(this.state.durationMs, this.state.ms + dt * this.state.speed);
    const ended = ms >= this.state.durationMs;
    this.state = { ...this.state, ms, ended, playing: !ended };
    this.render({ seek: false });
    for (const fn of [...this.listeners]) fn();
    if (!ended) this.raf = requestAnimationFrame(this.tick);
  };

  // ------------------------------------------------------------------ controls

  play(): void {
    if (this.state.mode !== "replay") this.state = { ...this.state, mode: "replay" };
    const atEnd = this.state.ms >= this.state.durationMs;
    this.set({ playing: this.state.durationMs > 0, ended: false, ms: atEnd ? 0 : this.state.ms });
    if (atEnd) this.render({ seek: true });
    if (!this.state.playing || this.raf) return;
    this.lastTick = 0;
    this.raf = requestAnimationFrame((t) => {
      this.lastTick = t;
      this.raf = requestAnimationFrame(this.tick);
    });
  }

  pause(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.state.playing) this.set({ playing: false });
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  /** To `ms` on the replay's clock (into Replay mode). Playing keeps playing from there. */
  seek(ms: number): void {
    const clamped = Math.min(this.state.durationMs, Math.max(0, ms));
    this.set({ mode: "replay", ms: clamped, ended: false });
    this.render({ seek: true });
  }

  seekBy(delta: number): void {
    this.seek(this.state.ms + delta);
  }

  setSpeed(speed: number): void {
    if (speed > 0 && speed !== this.state.speed) this.set({ speed });
  }

  setMode(mode: ReplayMode): void {
    if (mode === this.state.mode) return;
    if (mode === "board") {
      this.pause();
      this.set({ mode, ended: false });
      this.render({ seek: true });
      return;
    }
    this.set({ mode, ms: 0, ended: false });
    this.render({ seek: true });
    this.play();
  }

  /** The page switcher: in Board mode, show that screen; in Replay, jump to when it was first drawn on. */
  showPage(pageId: string): void {
    if (this.state.mode === "board") {
      this.goToPage(pageId);
      return;
    }
    const at = firstOnPage(this.timeline, pageId);
    if (at !== null) this.seek(at + 1);
    else this.goToPage(pageId);
  }

  /** The board changed (following it live). The replay keeps its place; one at its end stays at the end. */
  setBoard(board: LoadedBoard, timeline: Timeline): void {
    const atEnd = this.state.ms >= this.state.durationMs;
    // the student moved to another screen since: the final board follows them there
    const movedTo = board.currentPageId && board.currentPageId !== this.board.currentPageId ? board.currentPageId : null;
    this.board = board;
    this.timeline = timeline;
    const durationMs = timeline.durationMs;
    const ms = this.state.mode === "board" || (atEnd && !this.state.playing) ? durationMs : Math.min(this.state.ms, durationMs);
    this.state = { ...this.state, durationMs, ms };
    const editor = this.editor;
    const stage = this.stage;
    if (editor && stage) {
      const base = board.records.filter((r) => r.typeName !== "shape" && r.typeName !== "binding");
      const { put, remove } = diffRecords(this.baseById, base);
      this.baseById = new Map(base.map((r) => [r.id, r]));
      if (put.length) editor.store.mergeRemoteChanges(() => editor.store.put(put));
      for (const r of put) if (r.typeName === "page" && !this.screens.has(r.id)) this.screens.set(r.id, readScreenMeta((r as { meta?: unknown }).meta) ?? { ...DEFAULT_SCREEN });
      const frame = this.state.mode === "board" ? frameAt(timeline, Infinity) : frameAt(timeline, ms);
      stage.setBoard(board.records, timeline, frame);
      if (remove.length) editor.store.mergeRemoteChanges(() => editor.store.remove(remove.filter((id) => editor.store.has(id))));
      if (movedTo && this.state.mode === "board") this.goToPage(movedTo);
      else if (!editor.getPage(editor.getCurrentPageId())) this.goToPage(editor.getPages()[0]?.id ?? null);
    }
    for (const fn of [...this.listeners]) fn();
  }
}

/** keeps the last 600 samples */
function push(xs: number[], v: number): void {
  xs.push(v);
  if (xs.length > 600) xs.splice(0, xs.length - 600);
}
