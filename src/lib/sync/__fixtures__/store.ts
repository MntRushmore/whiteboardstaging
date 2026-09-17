import {
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  getIndexAbove,
  loadSnapshot,
  ZERO_INDEX_KEY,
  type IndexKey,
  type TLDrawShape,
  type TLPageId,
  type TLShapeId,
  type TLStore,
  type TLStoreSnapshot,
} from "tldraw";
import type { BuildResult, PersistResult } from "../types";

/** Headless store with the document/page/instance records tldraw needs (no Editor, no DOM). */
export function makeStore(): TLStore {
  const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils });
  loadSnapshot(store, { store: {}, schema: store.schema.serialize() });
  return store;
}

/** A second store holding the same document as `source` (simulates another tab). */
export function cloneStore(source: TLStore): TLStore {
  const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils });
  loadSnapshot(store, source.getStoreSnapshot("document"));
  return store;
}

export function pageIdOf(store: TLStore): TLPageId {
  const page = store.allRecords().find((r) => r.typeName === "page");
  if (!page) throw new Error("store has no page");
  return page.id as TLPageId;
}

let index: IndexKey = ZERO_INDEX_KEY;

export function drawRecord(parentId: TLPageId, id: string, x = 10): TLDrawShape {
  index = getIndexAbove(index);
  return {
    id: id as TLShapeId,
    typeName: "shape",
    type: "draw",
    x,
    y: 10,
    rotation: 0,
    index,
    parentId,
    isLocked: false,
    opacity: 1,
    props: {
      color: "black",
      fill: "none",
      dash: "draw",
      size: "m",
      segments: [{ type: "free", points: [{ x: 0, y: 0, z: 0.5 }, { x: 10, y: 4, z: 0.5 }] }],
      isComplete: true,
      isClosed: false,
      isPen: false,
      scale: 1,
    },
    meta: {},
  };
}

/** Put (or move) a draw shape with a fixed id so two stores can share it. */
export function putShape(store: TLStore, id: string, x = 10): TLDrawShape {
  const record = drawRecord(pageIdOf(store), id, x);
  store.put([record]);
  return record;
}

export function shapeIds(store: TLStore): string[] {
  return store
    .allRecords()
    .filter((r) => r.typeName === "shape")
    .map((r) => r.id as string)
    .sort();
}

export function docRecords(store: TLStore): Record<string, unknown> {
  return store.getStoreSnapshot("document").store as Record<string, unknown>;
}

/** `buildUpdate` the way the board page does it: TLEditorSnapshot-shaped `data` plus the document snapshot. */
export function buildFrom(store: TLStore): () => Promise<BuildResult> {
  return async () => {
    const snapshot: TLStoreSnapshot = store.getStoreSnapshot("document");
    return { kind: "update", update: { data: { document: snapshot }, updated_at: new Date(0).toISOString() }, snapshot };
  };
}

export interface FakeRemote {
  row: { data: unknown; version: number } | null;
  persist(update: Record<string, unknown>, expected: number | null): Promise<PersistResult>;
  fetchRemote(): Promise<{ data: unknown; version: number } | null>;
  /** shape ids currently stored in the row */
  shapeIds(): string[];
  persistCalls: Array<{ expected: number | null }>;
}

/** In-memory `whiteboards` row with the trigger's version bump and the optimistic-concurrency check. */
export function fakeRemote(initial: TLStore | null): FakeRemote {
  const remote: FakeRemote = {
    row: initial ? { data: { document: initial.getStoreSnapshot("document") }, version: 1 } : null,
    persistCalls: [],
    async persist(update, expected) {
      remote.persistCalls.push({ expected });
      if (!remote.row) return { ok: false, kind: "gone" };
      if (expected !== null && expected !== remote.row.version) return { ok: false, kind: "conflict" };
      remote.row = { data: update.data, version: remote.row.version + 1 };
      return { ok: true, version: remote.row.version };
    },
    async fetchRemote() {
      return remote.row ? { ...remote.row } : null;
    },
    shapeIds() {
      const doc = (remote.row?.data as { document?: TLStoreSnapshot } | undefined)?.document;
      return Object.values(doc?.store ?? {})
        .filter((r) => (r as { typeName: string }).typeName === "shape")
        .map((r) => (r as { id: string }).id)
        .sort();
    },
  };
  return remote;
}
