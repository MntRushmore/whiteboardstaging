import { describe, expect, it, vi } from "vitest";
import type { TLStore } from "tldraw";
import { restoreDeviceBackups } from "../useSnapshotSave";
import { createLocalStorageBackup, backupKey } from "@/lib/sync/localBackup";
import { restoreBackups } from "@/lib/sync/restoreBackup";
import { cloneStore, docRecords, makeStore, putShape, shapeIds } from "@/lib/sync/__fixtures__/store";
import type { BackupPayload } from "@/lib/sync";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

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
      restore: async () => restoreBackups,
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
      restore: async () => restoreBackups,
    });
    expect(report).toEqual({ applied: 2, stale: 0 });
    expect(storage.map.size).toBe(0);
  });

  it("does nothing, and loads nothing, when no other backup exists or every one belongs to an open tab", async () => {
    const { server, loaded, mine, queue, write } = setup();
    const restore = vi.fn(async () => restoreBackups);
    const args = { store: loaded, boardId: "b1", loadedVersion: 1, backup: mine, queue, cancelled: () => false, restore };
    expect(await restoreDeviceBackups({ ...args, openTabs: async () => new Set<string>() })).toBeNull();
    write("open", strokeBackup(server, "shape:open", 1));
    expect(await restoreDeviceBackups({ ...args, openTabs: async () => new Set(["open"]) })).toBeNull();
    expect(restore).not.toHaveBeenCalled();
    expect(queue.markDirty).not.toHaveBeenCalled();
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
      restore: async () => restoreBackups,
    });
    expect(report).toBeNull();
    expect(docRecords(loaded)).toEqual(before);
    expect(storage.map.has(backupKey("b1", "closed"))).toBe(true);
  });
});
