import type { TLRecord, TLStore } from "tldraw";
import { deepEqual } from "@/lib/sync/deepEqual";
import type { ReplayFrame, Timeline } from "@/lib/replay/timeline";

/**
 * Puts a replay frame on the replay's own store (never a board's: the player owns a throwaway
 * editor). The store already holds the board's document, pages and assets; the stage adds and takes
 * away its shapes (and the bindings between them) so the store shows `frame`.
 *
 * Incremental: playing forward puts only the items started since the last frame, and the stroke
 * being drawn with its points so far (`isComplete: false`); going back takes off only the items
 * after the new position. Anything a group or frame is involved in (a shape inside another) is
 * synced in full instead, since taking a child out of a group makes tldraw tidy the group away. All
 * writes are one `mergeRemoteChanges` per frame: no undo entry, one store change.
 */
export class ReplayStage {
  private timeline: Timeline;
  private byId = new Map<string, TLRecord>();
  /** shape id -> its parent shape (only shapes inside shapes) */
  private parentOf = new Map<string, string>();
  private hasChildren = new Set<string>();
  private bindings: TLRecord[] = [];
  /** shape ids on the store, each with the record put (whole: the board's own object; part drawn: a copy) */
  private present = new Map<string, TLRecord>();
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
    this.parentOf = new Map();
    this.hasChildren = new Set();
    this.bindings = [];
    for (const r of records) {
      if (r.typeName === "shape") this.byId.set(r.id, r);
      else if (r.typeName === "binding") this.bindings.push(r);
    }
    for (const r of this.byId.values()) {
      const parent = (r as { parentId?: string }).parentId;
      if (parent && this.byId.has(parent)) {
        this.parentOf.set(r.id, parent);
        this.hasChildren.add(parent);
      }
    }
  }

  /** How many timeline items are on the store (the last perhaps part drawn). */
  get shownCount(): number {
    return this.upTo;
  }

  /** Brings the store to `frame`, writing only what changed since the last one. */
  apply(frame: ReplayFrame): void {
    const items = this.timeline.items;
    const target = frame.upTo;
    const partialIndex = frame.current && frame.currentPoints !== Infinity ? target - 1 : -1;
    const puts: TLRecord[] = [];
    const removes: TLRecord["id"][] = [];

    // back: take off what starts after the new position
    if (target < this.upTo) {
      for (let i = target; i < this.upTo; i++) {
        const id = items[i].id;
        if (!this.present.has(id)) continue;
        if (this.hasChildren.has(id) || this.parentOf.has(id)) return this.sync(frame);
        removes.push(id as TLRecord["id"]);
        this.present.delete(id);
      }
      if (this.partial && this.partial.index >= target) this.partial = null;
      this.upTo = target;
    }

    // the stroke that was being drawn, now whole
    if (this.partial && this.partial.index !== partialIndex && this.partial.index < target) this.add(this.partial.id, null, puts);
    // forward: what started since
    for (let i = this.upTo; i < target; i++) if (i !== partialIndex) this.add(items[i].id, null, puts);
    // the stroke being drawn, its points so far
    if (partialIndex >= 0 && (!this.partial || this.partial.index !== partialIndex || this.partial.points !== frame.currentPoints)) {
      this.add(items[partialIndex].id, frame.currentPoints, puts);
    }
    this.partial = partialIndex >= 0 ? { id: items[partialIndex].id, index: partialIndex, points: frame.currentPoints } : null;
    this.upTo = target;
    this.commit(puts, removes);
  }

  /** Everything on the board. */
  showAll(): void {
    this.apply({ upTo: this.timeline.items.length, current: null, currentPoints: Infinity, pageId: null, shown: new Map() });
  }

  /** None of the board's shapes. */
  clear(): void {
    const removes = [...this.present.keys()] as TLRecord["id"][];
    this.present.clear();
    this.upTo = 0;
    this.partial = null;
    this.commit([], removes);
  }

  /**
   * The board changed (following it live): new records and their timeline. The store is brought to
   * `frame` of the new timeline, putting only shapes that are new or changed and removing those gone.
   */
  setBoard(records: readonly TLRecord[], timeline: Timeline, frame: ReplayFrame): void {
    const before = this.byId;
    this.timeline = timeline;
    this.index(records);
    for (const [id, shown] of this.present) {
      const now = this.byId.get(id);
      const old = before.get(id);
      // unchanged and whole: adopt the new object, so it is not put again. A changed shape keeps the
      // old one (no longer the board's: `add` puts it again); a shape gone is removed by `sync`.
      if (now && shown === old && deepEqual(old, now)) this.present.set(id, now);
    }
    this.partial = null;
    this.sync(frame);
  }

  /** The store to `frame` whatever it held: put what is missing or different, remove the rest. */
  private sync(frame: ReplayFrame): void {
    const items = this.timeline.items;
    const partialIndex = frame.current && frame.currentPoints !== Infinity ? frame.upTo - 1 : -1;
    const want = new Set<string>();
    for (let i = 0; i < frame.upTo; i++) want.add(items[i].id);
    // a shape inside another needs its ancestors
    for (const id of [...want]) {
      let up = this.parentOf.get(id);
      while (up && !want.has(up)) {
        want.add(up);
        up = this.parentOf.get(up);
      }
    }
    const removes: TLRecord["id"][] = [];
    for (const id of [...this.present.keys()]) {
      if (want.has(id)) continue;
      removes.push(id as TLRecord["id"]);
      this.present.delete(id);
    }
    const puts: TLRecord[] = [];
    for (let i = 0; i < frame.upTo; i++) this.add(items[i].id, i === partialIndex ? frame.currentPoints : null, puts);
    for (const id of want) if (!this.present.has(id)) this.add(id, null, puts);
    this.upTo = frame.upTo;
    this.partial = partialIndex >= 0 ? { id: items[partialIndex].id, index: partialIndex, points: frame.currentPoints } : null;
    this.commit(puts, removes);
  }

  /** Queues `id` (its ancestors first): whole when `points` is null, else its first `points` points. */
  private add(id: string, points: number | null, puts: TLRecord[]): void {
    const rec = this.byId.get(id);
    if (!rec) return;
    if (points === null && this.present.get(id) === rec) return;
    const parent = this.parentOf.get(id);
    if (parent && !this.present.has(parent)) this.add(parent, null, puts);
    const out = points === null ? rec : partialStroke(rec, points);
    puts.push(out);
    this.present.set(id, out);
  }

  private commit(puts: TLRecord[], removes: TLRecord["id"][]): void {
    const bindings = this.bindings.filter((b) => {
      const { fromId, toId } = b as unknown as { fromId: string; toId: string };
      return this.present.has(fromId) && this.present.has(toId) && !this.store.has(b.id);
    });
    if (puts.length === 0 && removes.length === 0 && bindings.length === 0) return;
    this.writes++;
    this.store.mergeRemoteChanges(() => {
      const gone = removes.filter((id) => this.store.has(id));
      if (gone.length) this.store.remove(gone);
      if (puts.length) this.store.put(puts);
      if (bindings.length) this.store.put(bindings);
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
