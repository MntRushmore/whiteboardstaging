import { describe, expect, it, vi } from "vitest";
import type { TLStore } from "tldraw";
import { createLocalStorageBackup, backupKey } from "../localBackup";
import { restoreDeviceBackups } from "../restoreBackup";
import { cloneStore, docRecords, makeStore, putShape, shapeIds } from "../__fixtures__/store";
import type { BackupPayload } from "../types";

function memoryStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage & { map: Map<string, string> };
}

/** A tab's backup of one new stroke `id` drawn on top of `server`. */
function strokeBackup(server: TLStore, id: string, at: number): BackupPayload {
  const device = cloneStore(server);
  const record = putShape(device, id, at);
  return { snapshot: { store: { [id]: record }, schema: device.schema.serialize() } as BackupPayload["snapshot"], baseVersion: 1, changed: [id], removed: [], at, base: {} };
}

function setup() {
  const storage = memoryStorage();
  const server = makeStore();
  putShape(server, "shape:base", 1);
  const loaded = cloneStore(server);
  const mine = createLocalStorageBackup(storage, undefined, "mine");
  const queue = { markDirty: vi.fn(), writeBackupNow: vi.fn(() => true) };
  const write = (tab: string | null, payload: unknown) => storage.setItem(backupKey("b1", tab ?? undefined), JSON.stringify(payload));
  return { storage, server, loaded, mine, queue, write };
}

describe("restoreDeviceBackups (two tabs, one device: N1)", () => {
  it("replays the backups of tabs that are gone, oldest first, and removes their keys after writing its own", async () => {
    const { storage, server, loaded, mine, queue, write } = setup();
    write("closed", strokeBackup(server, "shape:closed", 20));
    write(null, strokeBackup(server, "shape:legacy", 10)); // the key every tab shared before
    write("open", strokeBackup(server, "shape:open", 30));
    write("mine", strokeBackup(server, "shape:mine", 40)); // never this mount's own key
    write("broken", "{not a backup}");
    const order: string[] = [];
    queue.writeBackupNow.mockImplementation(() => {
      order.push(`own backup with ${storage.map.size} keys`);
      return true;
    });

    const report = await restoreDeviceBackups({
      store: loaded,
      boardId: "b1",
      loadedVersion: 1,
      backup: mine,
      queue,
      cancelled: () => false,
      openTabs: async () => new Set(["open", "mine"]),
    });

    expect(report).toEqual({ applied: 2, stale: 0 });
    expect(shapeIds(loaded)).toEqual(["shape:base", "shape:closed", "shape:legacy"]);
    expect(queue.markDirty).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["own backup with 5 keys"]); // before any old key went
    expect([...storage.map.keys()].sort()).toEqual([backupKey("b1", "mine"), backupKey("b1", "open")]);
  });

  it("without Web Locks every other tab's backup counts as gone (the behaviour before per-tab keys)", async () => {
    const { storage, server, loaded, mine, queue, write } = setup();
    write("a", strokeBackup(server, "shape:a", 1));
    write("b", strokeBackup(server, "shape:b", 2));
    const report = await restoreDeviceBackups({
      store: loaded,
      boardId: "b1",
      loadedVersion: 1,
      backup: mine,
      queue,
      cancelled: () => false,
      openTabs: async () => null,
    });
    expect(report).toEqual({ applied: 2, stale: 0 });
    expect(storage.map.size).toBe(0);
  });

  it("does nothing when no other backup exists or every one belongs to an open tab", async () => {
    const { storage, server, loaded, mine, queue, write } = setup();
    const before = docRecords(loaded);
    const args = { store: loaded, boardId: "b1", loadedVersion: 1, backup: mine, queue, cancelled: () => false };
    expect(await restoreDeviceBackups({ ...args, openTabs: async () => new Set<string>() })).toBeNull();
    write("open", strokeBackup(server, "shape:open", 1));
    expect(await restoreDeviceBackups({ ...args, openTabs: async () => new Set(["open"]) })).toBeNull();
    expect(queue.markDirty).not.toHaveBeenCalled();
    expect(docRecords(loaded)).toEqual(before);
    expect(storage.map.has(backupKey("b1", "open"))).toBe(true);
  });

  it("storage full: the replayed backups make room for this tab's own, which then holds their records", async () => {
    const { storage, server, loaded, queue } = setup();
    // Safari-like quota: just room for the two old backups and nothing more.
    const closed = JSON.stringify(strokeBackup(server, "shape:closed", 20));
    const legacy = JSON.stringify(strokeBackup(server, "shape:legacy", 10));
    const quota = closed.length + legacy.length + 100;
    const used = () => [...storage.map].reduce((n, [k, v]) => n + k.length + v.length, 0);
    const setItem = storage.setItem;
    storage.setItem = (k: string, v: string) => {
      if (used() - (storage.map.get(k)?.length ?? 0) + v.length + k.length > quota) throw new DOMException("full", "QuotaExceededError");
      setItem(k, v);
    };
    storage.setItem(backupKey("b1", "closed"), closed);
    storage.setItem(backupKey("b1"), legacy);
    const mine = createLocalStorageBackup(storage, undefined, "mine", () => 100); // the old ones are recent
    let wrote = false;
    queue.writeBackupNow.mockImplementation(() => {
      // what the save queue writes: both restored strokes as this tab's unsaved changes
      const records = Object.fromEntries(["shape:closed", "shape:legacy"].map((id) => [id, loaded.get(id as never)]));
      wrote = mine.write("b1", { snapshot: { store: records, schema: loaded.schema.serialize() } as unknown as BackupPayload["snapshot"], baseVersion: 1, changed: Object.keys(records), removed: [], at: 50 });
      return wrote;
    });

    const report = await restoreDeviceBackups({ store: loaded, boardId: "b1", loadedVersion: 1, backup: mine, queue, cancelled: () => false, openTabs: async () => null });

    expect(report).toEqual({ applied: 2, stale: 0 });
    expect(wrote).toBe(true);
    expect([...storage.map.keys()]).toEqual([backupKey("b1", "mine")]);
    expect(mine.read("b1")?.changed.sort()).toEqual(["shape:closed", "shape:legacy"]);
  });

  it("storage too full even with the replayed backups gone: they stay (put back), to be replayed next time", async () => {
    const { storage, server, loaded, queue } = setup();
    const closed = JSON.stringify(strokeBackup(server, "shape:closed", 20));
    const legacy = JSON.stringify(strokeBackup(server, "shape:legacy", 10));
    storage.setItem(backupKey("b1", "closed"), closed);
    storage.setItem(backupKey("b1"), legacy);
    // This tab's own key never fits (a quota smaller than the backup it would hold).
    const setItem = storage.setItem;
    storage.setItem = (k: string, v: string) => {
      if (k === backupKey("b1", "mine")) throw new DOMException("full", "QuotaExceededError");
      setItem(k, v);
    };
    const mine = createLocalStorageBackup(storage, undefined, "mine", () => 100);
    queue.writeBackupNow.mockImplementation(() => {
      const records = Object.fromEntries(["shape:closed", "shape:legacy"].map((id) => [id, loaded.get(id as never)]));
      return mine.write("b1", { snapshot: { store: records, schema: loaded.schema.serialize() } as unknown as BackupPayload["snapshot"], baseVersion: 1, changed: Object.keys(records), removed: [], at: 50 });
    });

    const report = await restoreDeviceBackups({ store: loaded, boardId: "b1", loadedVersion: 1, backup: mine, queue, cancelled: () => false, openTabs: async () => null });

    expect(report).toEqual({ applied: 2, stale: 0 }); // on screen, and pending a save
    expect(storage.map.get(backupKey("b1", "closed"))).toBe(closed);
    expect(storage.map.get(backupKey("b1"))).toBe(legacy);
    expect(storage.map.has(backupKey("b1", "mine"))).toBe(false);
  });

  it("an unmounted board applies nothing and keeps the keys for the next mount", async () => {
    const { storage, server, loaded, mine, queue, write } = setup();
    write("closed", strokeBackup(server, "shape:closed", 1));
    const before = docRecords(loaded);
    const report = await restoreDeviceBackups({
      store: loaded,
      boardId: "b1",
      loadedVersion: 1,
      backup: mine,
      queue,
      cancelled: () => true,
      openTabs: async () => null,
    });
    expect(report).toBeNull();
    expect(docRecords(loaded)).toEqual(before);
    expect(storage.map.has(backupKey("b1", "closed"))).toBe(true);
  });
});
