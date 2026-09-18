import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TLShapeId, TLStore } from "tldraw";
import {
  backoffDelay,
  createSaveQueue,
  extractStoreMap,
  MSG_BOARD_GONE,
  MSG_MERGE_FAILED,
  RETRY_BACKOFF_MS,
} from "../saveQueue";
import { buildFrom, cloneStore, fakeRemote, makeStore, putShape, shapeIds } from "../__fixtures__/store";
import type { BackupPayload, BuildResult, LocalBackup, PersistResult, SaveQueueDeps } from "../types";

const tick = () => vi.advanceTimersByTimeAsync(0);

function memoryBackup(): LocalBackup & { map: Map<string, BackupPayload> } {
  const map = new Map<string, BackupPayload>();
  return {
    map,
    read: (id) => map.get(id) ?? null,
    write: (id, p) => {
      map.set(id, p);
      return true;
    },
    clear: (id) => void map.delete(id),
  };
}

function makeDeps(store: TLStore, over: Partial<SaveQueueDeps> = {}): SaveQueueDeps {
  const remote = fakeRemote(store);
  return {
    boardId: "b1",
    store,
    initialVersion: 1,
    buildUpdate: buildFrom(store),
    persist: remote.persist,
    fetchRemote: remote.fetchRemote,
    isOnline: () => true,
    ...over,
  };
}

describe("createSaveQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("happy path: debounce, persist with the expected version, adopt the bumped version", async () => {
    const store = makeStore();
    const remote = fakeRemote(store);
    const persist = vi.fn(remote.persist);
    const queue = createSaveQueue(makeDeps(store, { persist }));
    expect(queue.state.get()).toMatchObject({ status: "saved", version: 1, pending: false });

    putShape(store, "shape:a");
    queue.markDirty();
    expect(queue.state.get()).toMatchObject({ status: "dirty", pending: true });
    await vi.advanceTimersByTimeAsync(1999);
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][1]).toBe(1);
    expect(queue.state.get()).toMatchObject({ status: "saved", version: 2, pending: false, attempt: 0 });
    expect(queue.state.get().lastSavedAt).toBe(Date.now());
    expect(remote.shapeIds()).toEqual(["shape:a"]);
    queue.dispose();
  });

  it("two tabs over one remote converge and the remote ends with both edits", async () => {
    const storeA = makeStore();
    const storeB = cloneStore(storeA);
    const remote = fakeRemote(storeA);
    const queueA = createSaveQueue(makeDeps(storeA, { persist: remote.persist, fetchRemote: remote.fetchRemote }));
    const queueB = createSaveQueue(makeDeps(storeB, { persist: remote.persist, fetchRemote: remote.fetchRemote }));

    putShape(storeA, "shape:a");
    queueA.markDirty();
    await queueA.flush();
    expect(queueA.state.get()).toMatchObject({ status: "saved", version: 2 });

    putShape(storeB, "shape:b");
    queueB.markDirty();
    const stateB = await queueB.flush();
    expect(stateB).toMatchObject({ status: "saved", version: 3, pending: false });
    expect(shapeIds(storeB)).toEqual(["shape:a", "shape:b"]);
    expect(remote.shapeIds()).toEqual(["shape:a", "shape:b"]);

    // A edits again from version 2: conflict -> merge b in -> saved as version 4.
    putShape(storeA, "shape:a2");
    queueA.markDirty();
    const stateA = await queueA.flush();
    expect(stateA).toMatchObject({ status: "saved", version: 4 });
    expect(shapeIds(storeA)).toEqual(["shape:a", "shape:a2", "shape:b"]);
    expect(remote.shapeIds()).toEqual(["shape:a", "shape:a2", "shape:b"]);
    expect(remote.persistCalls.map((c) => c.expected)).toEqual([1, 1, 2, 2, 3]);
    queueA.dispose();
    queueB.dispose();
  });

  it("conflict where both tabs edit the same shape: the local edit wins, the other tab's records are adopted", async () => {
    const storeA = makeStore();
    putShape(storeA, "shape:shared", 1);
    const storeB = cloneStore(storeA);
    const remote = fakeRemote(storeA);
    const queueA = createSaveQueue(makeDeps(storeA, { persist: remote.persist, fetchRemote: remote.fetchRemote }));
    const queueB = createSaveQueue(makeDeps(storeB, { persist: remote.persist, fetchRemote: remote.fetchRemote }));

    putShape(storeA, "shape:shared", 100);
    storeA.remove(["shape:shared" as TLShapeId]);
    putShape(storeA, "shape:onlyA", 5);
    queueA.markDirty();
    await queueA.flush();

    putShape(storeB, "shape:shared", 200);
    queueB.markDirty();
    await queueB.flush();
    expect(queueB.state.get()).toMatchObject({ status: "saved", version: 3 });
    expect(shapeIds(storeB)).toEqual(["shape:onlyA", "shape:shared"]);
    expect((storeB.get("shape:shared" as TLShapeId) as { x: number }).x).toBe(200);
    expect(remote.shapeIds()).toEqual(["shape:onlyA", "shape:shared"]);
    queueA.dispose();
    queueB.dispose();
  });

  it("offline -> dirty -> setOnline(true) saves without paying for buildUpdate while offline", async () => {
    const store = makeStore();
    let online = false;
    const buildUpdate = vi.fn(buildFrom(store));
    const queue = createSaveQueue(makeDeps(store, { isOnline: () => online, buildUpdate }));
    putShape(store, "shape:a");
    queue.markDirty();
    expect(queue.state.get()).toMatchObject({ status: "offline", pending: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(buildUpdate).not.toHaveBeenCalled();
    expect(queue.state.get()).toMatchObject({ status: "offline", pending: true });

    online = true;
    queue.setOnline(true);
    await tick();
    expect(buildUpdate).toHaveBeenCalledTimes(1);
    expect(queue.state.get()).toMatchObject({ status: "saved", version: 2, pending: false, attempt: 0 });
    queue.dispose();
  });

  it("an offline persist result restores the dirty set; going back online saves everything once", async () => {
    const store = makeStore();
    let fail = true;
    const remote = fakeRemote(store);
    const persist = vi.fn(async (u: Record<string, unknown>, v: number | null): Promise<PersistResult> =>
      fail ? { ok: false, kind: "offline" } : remote.persist(u, v),
    );
    const queue = createSaveQueue(makeDeps(store, { persist }));
    putShape(store, "shape:a");
    queue.markDirty();
    await vi.advanceTimersByTimeAsync(2000);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(queue.state.get()).toMatchObject({ status: "offline", pending: true, attempt: 1 });

    fail = false;
    putShape(store, "shape:b");
    queue.markDirty();
    queue.setOnline(true);
    await tick();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(queue.state.get()).toMatchObject({ status: "saved", version: 2, pending: false });
    expect(remote.shapeIds()).toEqual(["shape:a", "shape:b"]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(persist).toHaveBeenCalledTimes(2);
    queue.dispose();
  });

  it("retries with 2 s, 5 s, 15 s, 60 s, 60 s backoff after failures", async () => {
    const store = makeStore();
    const persist = vi.fn(async (): Promise<PersistResult> => ({ ok: false, kind: "other", message: "boom" }));
    const queue = createSaveQueue(makeDeps(store, { persist }));
    putShape(store, "shape:a");
    queue.markDirty();
    await vi.advanceTimersByTimeAsync(2000);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(queue.state.get()).toMatchObject({ status: "error", message: "boom", attempt: 1, pending: true });

    for (const [i, delay] of [2000, 5000, 15000, 60000, 60000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(persist).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(persist).toHaveBeenCalledTimes(i + 2);
      expect(queue.state.get().attempt).toBe(i + 2);
    }
    expect(RETRY_BACKOFF_MS).toEqual([2000, 5000, 15000, 60000]);
    expect([1, 2, 3, 4, 5, 99].map(backoffDelay)).toEqual([2000, 5000, 15000, 60000, 60000, 60000]);
    queue.dispose();
  });

  it("manual retry() resets the backoff and saves now", async () => {
    const store = makeStore();
    let fail = true;
    const remote = fakeRemote(store);
    const persist = vi.fn(async (u: Record<string, unknown>, v: number | null): Promise<PersistResult> =>
      fail ? { ok: false, kind: "other" } : remote.persist(u, v),
    );
    const queue = createSaveQueue(makeDeps(store, { persist }));
    putShape(store, "shape:a");
    queue.markDirty();
    await vi.advanceTimersByTimeAsync(2000 + 2000 + 5000);
    expect(queue.state.get().attempt).toBe(3);
    fail = false;
    const s = await queue.retry();
    expect(s).toMatchObject({ status: "saved", attempt: 0, version: 2 });
    queue.dispose();
  });

  it("caps conflict rounds and asks the user to reload", async () => {
    const store = makeStore();
    const persist = vi.fn(async (): Promise<PersistResult> => ({ ok: false, kind: "conflict" }));
    const fetchRemote = vi.fn(async () => ({ data: { document: store.getStoreSnapshot("document") }, version: 7 }));
    const queue = createSaveQueue(makeDeps(store, { persist, fetchRemote }));
    putShape(store, "shape:a");
    queue.markDirty();
    const s = await queue.flush();
    expect(persist).toHaveBeenCalledTimes(4);
    expect(fetchRemote).toHaveBeenCalledTimes(4);
    expect(s).toMatchObject({ status: "error", message: MSG_MERGE_FAILED, pending: true, version: 7 });
    // halted: further edits do not trigger automatic saves
    putShape(store, "shape:b");
    queue.markDirty();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(persist).toHaveBeenCalledTimes(4);
    expect(queue.state.get()).toMatchObject({ status: "error", pending: true });
    queue.dispose();
  });

  it("conflict on a deleted board stops with a clear message", async () => {
    const store = makeStore();
    const persist = vi.fn(async (): Promise<PersistResult> => ({ ok: false, kind: "conflict" }));
    const queue = createSaveQueue(makeDeps(store, { persist, fetchRemote: async () => null }));
    putShape(store, "shape:a");
    queue.markDirty();
    const s = await queue.flush();
    expect(s).toMatchObject({ status: "error", message: MSG_BOARD_GONE, pending: true });
    queue.dispose();
  });

  it("'gone' and 'too-large' results: error stops, refused waits for the next edit", async () => {
    const store = makeStore();
    const gone = createSaveQueue(makeDeps(store, { persist: async () => ({ ok: false, kind: "gone" }) }));
    putShape(store, "shape:a");
    gone.markDirty();
    expect(await gone.flush()).toMatchObject({ status: "error", message: MSG_BOARD_GONE });
    gone.dispose();

    const persist = vi.fn(async (): Promise<PersistResult> => ({ ok: false, kind: "too-large", message: "8 MB cap" }));
    const big = createSaveQueue(makeDeps(store, { persist }));
    putShape(store, "shape:b");
    big.markDirty();
    expect(await big.flush()).toMatchObject({ status: "refused", message: "8 MB cap", pending: true });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(persist).toHaveBeenCalledTimes(1);
    big.markDirty();
    await vi.advanceTimersByTimeAsync(2000);
    expect(persist).toHaveBeenCalledTimes(2);
    big.dispose();
  });

  it("a refused build keeps pending, never auto-retries, and retries after the next markDirty", async () => {
    const store = makeStore();
    const remote = fakeRemote(store);
    let refuse = true;
    const inner = buildFrom(store);
    const buildUpdate = vi.fn(async (): Promise<BuildResult> => (refuse ? { kind: "refused", message: "too big" } : inner()));
    const queue = createSaveQueue(makeDeps(store, { buildUpdate, persist: remote.persist }));
    putShape(store, "shape:a");
    queue.markDirty();
    await vi.advanceTimersByTimeAsync(2000);
    expect(queue.state.get()).toMatchObject({ status: "refused", message: "too big", pending: true, version: 1 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(buildUpdate).toHaveBeenCalledTimes(1);

    refuse = false;
    queue.markDirty();
    await vi.advanceTimersByTimeAsync(2000);
    expect(buildUpdate).toHaveBeenCalledTimes(2);
    expect(queue.state.get()).toMatchObject({ status: "saved", version: 2, pending: false, message: null });
    expect(remote.shapeIds()).toEqual(["shape:a"]);
    queue.dispose();
  });

  it("flush() during the debounce persists immediately and returns the new state", async () => {
    const store = makeStore();
    const remote = fakeRemote(store);
    const persist = vi.fn(remote.persist);
    const queue = createSaveQueue(makeDeps(store, { persist }));
    putShape(store, "shape:a");
    queue.markDirty();
    await vi.advanceTimersByTimeAsync(500);
    const s = await queue.flush();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(s).toMatchObject({ status: "saved", version: 2 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(persist).toHaveBeenCalledTimes(1); // debounce was cancelled, no double save
    expect(await queue.flush()).toMatchObject({ status: "saved" }); // nothing pending: no-op
    expect(persist).toHaveBeenCalledTimes(1);
    queue.dispose();
  });

  it("markDirty during an in-flight save triggers exactly one follow-up save carrying the new edit", async () => {
    const store = makeStore();
    const remote = fakeRemote(store);
    let release: (() => void) | null = null;
    const persist = vi.fn(async (u: Record<string, unknown>, v: number | null): Promise<PersistResult> => {
      if (!release) await new Promise<void>((r) => (release = r));
      return remote.persist(u, v);
    });
    const queue = createSaveQueue(makeDeps(store, { persist }));
    putShape(store, "shape:a");
    queue.markDirty();
    await vi.advanceTimersByTimeAsync(2000);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(queue.state.get().status).toBe("saving");

    putShape(store, "shape:b");
    queue.markDirty();
    queue.markDirty();
    expect(queue.state.get()).toMatchObject({ status: "saving", pending: true });
    release!();
    await tick();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1][1]).toBe(2);
    expect(queue.state.get()).toMatchObject({ status: "saved", version: 3, pending: false });
    expect(remote.shapeIds()).toEqual(["shape:a", "shape:b"]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(persist).toHaveBeenCalledTimes(2);
    queue.dispose();
  });

  it("a document change without markDirty (e.g. AI overlay bookkeeping) is still saved by flush()", async () => {
    const store = makeStore();
    const remote = fakeRemote(store);
    const queue = createSaveQueue(makeDeps(store, { persist: remote.persist }));
    putShape(store, "shape:silent");
    expect(queue.state.get().pending).toBe(false); // nobody told the queue yet
    const s = await queue.flush();
    expect(s).toMatchObject({ status: "saved", version: 2 });
    expect(remote.shapeIds()).toEqual(["shape:silent"]);
    queue.dispose();
  });

  it("writes the unsaved-changes backup ~500 ms after an edit, includes in-flight ids, clears it once saved", async () => {
    const store = makeStore();
    const remote = fakeRemote(store);
    const backup = memoryBackup();
    let release: (() => void) | null = null;
    const persist = vi.fn(async (u: Record<string, unknown>, v: number | null): Promise<PersistResult> => {
      if (!release) await new Promise<void>((r) => (release = r));
      return remote.persist(u, v);
    });
    const queue = createSaveQueue(makeDeps(store, { persist, backup }));
    putShape(store, "shape:a");
    queue.markDirty();
    await vi.advanceTimersByTimeAsync(499);
    expect(backup.map.has("b1")).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(backup.map.get("b1")).toMatchObject({ baseVersion: 1, changed: ["shape:a"], removed: [] });
    expect(Object.keys(backup.map.get("b1")!.snapshot.store)).toContain("shape:a");

    await vi.advanceTimersByTimeAsync(1500); // save starts and blocks in persist
    store.remove(["shape:a" as TLShapeId]);
    expect(queue.writeBackupNow()).toBe(true);
    expect(backup.map.get("b1")).toMatchObject({ changed: [], removed: ["shape:a"] });

    release!();
    await tick();
    await tick();
    expect(queue.state.get()).toMatchObject({ status: "saved", version: 3, pending: false });
    expect(backup.map.has("b1")).toBe(false);
    expect(queue.writeBackupNow()).toBe(false);
    queue.dispose();
  });

  it("setOnline(false) surfaces offline while pending; dispose stops timers and ignores later markDirty", async () => {
    const store = makeStore();
    const persist = vi.fn(fakeRemote(store).persist);
    const queue = createSaveQueue(makeDeps(store, { persist }));
    putShape(store, "shape:a");
    queue.markDirty();
    queue.setOnline(false);
    expect(queue.state.get()).toMatchObject({ status: "offline", pending: true });
    queue.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    queue.markDirty();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(persist).not.toHaveBeenCalled();
  });

  it("extractStoreMap accepts editor and store snapshots and rejects junk", () => {
    expect(extractStoreMap({ store: { a: 1 }, schema: {} })).toEqual({ a: 1 });
    expect(extractStoreMap({ document: { store: { b: 2 } }, session: {} })).toEqual({ b: 2 });
    expect(extractStoreMap({ store: [] })).toBeNull();
    expect(extractStoreMap(null)).toBeNull();
    expect(extractStoreMap("x")).toBeNull();
  });
});
