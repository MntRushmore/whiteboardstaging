import type { TLRecord, TLStore } from "tldraw";
import { deepEqual } from "@/lib/sync/deepEqual";
import type { ReplayFrame, Timeline } from "@/lib/replay/timeline";

/**
 * Puts a replay frame on the replay's own store (never a board's: the player owns a throwaway
 * editor). The store holds the board's document, pages and assets; the stage holds its shapes.
 *
 * Every shape is on the store from the start (`mount`), the ones not drawn yet at opacity 0: a frame
 * only ever updates records — reveals what started since the last frame, cuts the stroke being drawn
 * to its points so far (`isComplete: false`), hides again what comes after a seek back. Measured on a
 * 2,448-shape screen (production build), adding or removing a shape costs a frame about four times
 * what updating one does (tldraw re-lays the whole shape list), and this keeps groups and arrows'
 * bindings intact (nothing is ever taken out from under them). A shape with others inside it (a
 * group, a frame) is never hidden: hiding it would hide what is inside. All writes are one
 * `mergeRemoteChanges` per frame, and only of records that changed: no undo entry, one store change.
 */
export class ReplayStage {
  private timeline: Timeline;
  private byId = new Map<string, TLRecord>();
  private containers = new Set<string>();
  private bindings = new Map<string, TLRecord>();
  /** what the store holds for each shape this stage put: the board's own record, its hidden copy, or a part-drawn copy */
  private shown = new Map<string, TLRecord>();
  private shownBindings = new Map<string, TLRecord>();
  private hiddenCopies = new Map<string, { of: TLRecord; copy: TLRecord }>();
  private upTo = 0;
  private partial: { id: string; index: number; points: number } | null = null;
  /** store writes so far (tests, the perf readout) */
  writes = 0;

  constructor(
    private readonly store: TLStore,
    records: readonly TLRecord[],
    timeline: Timeline,
  ) {
    this.timeline = timeline;
    this.index(records);
  }

  private index(records: readonly TLRecord[]): void {
    this.byId = new Map();
    this.containers = new Set();
    this.bindings = new Map();
    for (const r of records) {
      if (r.typeName === "shape") this.byId.set(r.id, r);
      else if (r.typeName === "binding") this.bindings.set(r.id, r);
    }
    for (const r of this.byId.values()) {
      const parent = (r as { parentId?: string }).parentId;
      if (parent && this.byId.has(parent)) this.containers.add(parent);
    }
  }

  /** How many timeline items are drawn (the last perhaps part drawn). */
  get shownCount(): number {
    return this.upTo;
  }

  /** Puts the board's shapes (and bindings) on the store as `frame` shows them. */
  mount(frame: ReplayFrame): void {
    this.sync(frame);
  }

  /** Brings the store to `frame`, writing only what changed since the last one. */
  apply(frame: ReplayFrame): void {
    const items = this.timeline.items;
    const target = frame.upTo;
    const partialIndex = frame.current && frame.currentPoints !== Infinity ? target - 1 : -1;
    const puts: TLRecord[] = [];

    // back: hide what starts after the new position
    if (target < this.upTo) {
      for (let i = target; i < this.upTo; i++) this.show(items[i].id, "hidden", puts);
      if (this.partial && this.partial.index >= target) this.partial = null;
      this.upTo = target;
    }
    // the stroke that was being drawn, now whole
    if (this.partial && this.partial.index !== partialIndex && this.partial.index < target) this.show(this.partial.id, "whole", puts);
    // forward: what started since
    for (let i = this.upTo; i < target; i++) if (i !== partialIndex) this.show(items[i].id, "whole", puts);
    // the stroke being drawn, its points so far
    if (partialIndex >= 0 && (!this.partial || this.partial.index !== partialIndex || this.partial.points !== frame.currentPoints)) {
      this.show(items[partialIndex].id, frame.currentPoints, puts);
    }
    this.partial = partialIndex >= 0 ? { id: items[partialIndex].id, index: partialIndex, points: frame.currentPoints } : null;
    this.upTo = target;
    this.commit(puts, []);
  }

  /** Everything drawn. */
  showAll(): void {
    this.apply({ upTo: this.timeline.items.length, current: null, currentPoints: Infinity, pageId: null, shown: new Map() });
  }

  /** Nothing drawn yet. */
  clear(): void {
    this.apply({ upTo: 0, current: null, currentPoints: Infinity, pageId: null, shown: new Map() });
  }

  /**
   * The board changed (following it live): new records and their timeline. The store is brought to
   * `frame` of the new timeline, putting only shapes that are new or changed and removing those gone.
   */
  setBoard(records: readonly TLRecord[], timeline: Timeline, frame: ReplayFrame): void {
    const before = this.byId;
    this.timeline = timeline;
    this.index(records);
    // an unchanged shape keeps what is on the store (adopting the new object, so it is not put again)
    for (const [id, now] of this.byId) {
      const old = before.get(id);
      if (!old || old === now || !deepEqual(old, now)) continue;
      if (this.shown.get(id) === old) this.shown.set(id, now);
      const hidden = this.hiddenCopies.get(id);
      if (hidden?.of === old) this.hiddenCopies.set(id, { of: now, copy: hidden.copy });
    }
    for (const [id, now] of this.bindings) {
      const old = this.shownBindings.get(id);
      if (old && old !== now && deepEqual(old, now)) this.shownBindings.set(id, now);
    }
    this.partial = null;
    this.sync(frame);
  }

  /** The store to `frame` whatever it held: every shape and binding put as it should be (only those that differ), the rest removed. */
  private sync(frame: ReplayFrame): void {
    const items = this.timeline.items;
    const partialIndex = frame.current && frame.currentPoints !== Infinity ? frame.upTo - 1 : -1;
    const puts: TLRecord[] = [];
    const removes: TLRecord["id"][] = [];
    for (const id of [...this.shown.keys()]) {
      if (this.byId.has(id)) continue;
      removes.push(id as TLRecord["id"]);
      this.shown.delete(id);
      this.hiddenCopies.delete(id);
    }
    for (const id of [...this.shownBindings.keys()]) {
      if (this.bindings.has(id)) continue;
      removes.push(id as TLRecord["id"]);
      this.shownBindings.delete(id);
    }
    // containers first: their children's parent must be there
    for (const id of this.containers) this.show(id, "whole", puts);
    items.forEach((item, i) => this.show(item.id, i < frame.upTo ? (i === partialIndex ? frame.currentPoints : "whole") : "hidden", puts));
    this.upTo = frame.upTo;
    this.partial = partialIndex >= 0 ? { id: items[partialIndex].id, index: partialIndex, points: frame.currentPoints } : null;
    // bindings, once the shapes at both ends are there
    const bindingPuts: TLRecord[] = [];
    for (const [id, b] of this.bindings) {
      const { fromId, toId } = b as unknown as { fromId: string; toId: string };
      if (this.shownBindings.get(id) === b || !this.shown.has(fromId) || !this.shown.has(toId)) continue;
      bindingPuts.push(b);
      this.shownBindings.set(id, b);
    }
    this.commit([...puts, ...bindingPuts], removes);
  }

  /** Queues `id` drawn whole, hidden, or as its first `points` points. */
  private show(id: string, want: "whole" | "hidden" | number, puts: TLRecord[]): void {
    const rec = this.byId.get(id);
    if (!rec) return;
    const out = want === "whole" || this.containers.has(id) ? rec : want === "hidden" ? this.hiddenCopy(rec) : partialStroke(rec, want);
    if (this.shown.get(id) === out) return;
    puts.push(out);
    this.shown.set(id, out);
  }

  private hiddenCopy(rec: TLRecord): TLRecord {
    const known = this.hiddenCopies.get(rec.id);
    if (known?.of === rec) return known.copy;
    const copy = { ...rec, opacity: 0 } as TLRecord;
    this.hiddenCopies.set(rec.id, { of: rec, copy });
    return copy;
  }

  private commit(puts: TLRecord[], removes: TLRecord["id"][]): void {
    if (puts.length === 0 && removes.length === 0) return;
    this.writes++;
    this.store.mergeRemoteChanges(() => {
      const gone = removes.filter((id) => this.store.has(id));
      if (gone.length) this.store.remove(gone);
      if (puts.length) this.store.put(puts);
    });
  }
}

/** A stroke with only its first `n` points (across its segments), not yet complete. */
export function partialStroke(rec: TLRecord, n: number): TLRecord {
  const props = (rec as { props?: Record<string, unknown> }).props ?? {};
  const segments = Array.isArray(props.segments) ? (props.segments as { points?: unknown[] }[]) : null;
  if (!segments) return rec;
  let left = n;
  const out: { points?: unknown[] }[] = [];
  for (const seg of segments) {
    if (left <= 0) break;
    const pts = Array.isArray(seg.points) ? seg.points : [];
    if (pts.length <= left) {
      out.push(seg);
      left -= pts.length;
    } else {
      out.push({ ...seg, points: pts.slice(0, left) });
      left = 0;
    }
  }
  // a closed, filled outline is filled once whole (as the tutor's own writing does)
  return { ...rec, props: { ...props, segments: out, isComplete: false, ...(props.isClosed ? { isClosed: false, fill: "none" } : {}) } } as TLRecord;
}
