import { describe, expect, it } from "vitest";
import { backupKey, createLocalStorageBackup, isBackupPayload, newTabId } from "../localBackup";
import type { BackupPayload } from "../types";

function memoryStorage(overrides: Partial<Storage> = {}): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  const storage = {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
    ...overrides,
  };
  return storage as Storage & { map: Map<string, string> };
}

const payload: BackupPayload = {
  snapshot: { store: { "shape:a": { id: "shape:a", typeName: "shape" } }, schema: { schemaVersion: 2, sequences: {} } } as unknown as BackupPayload["snapshot"],
  baseVersion: 3,
  changed: ["shape:a"],
  removed: [],
  at: 1000,
};

describe("createLocalStorageBackup", () => {
  it("writes, reads back and clears under agathon.unsaved.<boardId>.<tabId>", () => {
    const storage = memoryStorage();
    const backup = createLocalStorageBackup(storage, undefined, "tab1");
    expect(backup.tabId).toBe("tab1");
    expect(backup.write("b1", payload)).toBe(true);
    expect(backupKey("b1", "tab1")).toBe("agathon.unsaved.b1.tab1");
    expect(backupKey("b1")).toBe("agathon.unsaved.b1"); // the key every tab shared before
    expect([...storage.map.keys()]).toEqual(["agathon.unsaved.b1.tab1"]);
    expect(backup.read("b1")).toEqual(payload);
    backup.clear("b1");
    expect(backup.read("b1")).toBeNull();
  });

  it("two tabs of one board keep separate backups: a save in one never clears the other's (N1)", () => {
    const storage = memoryStorage();
    const tabA = createLocalStorageBackup(storage, undefined, "a");
    const tabB = createLocalStorageBackup(storage, undefined, "b");
    tabA.write("b1", { ...payload, changed: ["shape:a"] });
    tabB.write("b1", { ...payload, changed: ["shape:b"], snapshot: { ...payload.snapshot, store: {} } });
    tabA.clear("b1"); // tab A saved
    expect(tabA.read("b1")).toBeNull();
    expect(tabB.read("b1")?.changed).toEqual(["shape:b"]);
  });

  it("lists every backup of a board on the device (other tabs, the old shared key), never another board's", () => {
    const storage = memoryStorage();
    const mine = createLocalStorageBackup(storage, undefined, "mine");
    mine.write("b1", payload);
    createLocalStorageBackup(storage, undefined, "other").write("b1", { ...payload, at: 5 });
    createLocalStorageBackup(storage, undefined, "x").write("b10", payload);
    storage.setItem(backupKey("b1"), JSON.stringify({ ...payload, at: 1 }));
    storage.setItem(backupKey("b1", "broken"), "{not json");
    storage.setItem("agathon.unsaved.b1x.t", JSON.stringify(payload));

    const found = mine.list("b1").sort((p, q) => p.key.localeCompare(q.key));
    expect(found.map((f) => [f.key, f.tabId, f.payload?.at ?? null])).toEqual([
      ["agathon.unsaved.b1", null, 1],
      ["agathon.unsaved.b1.broken", "broken", null],
      ["agathon.unsaved.b1.mine", "mine", 1000],
      ["agathon.unsaved.b1.other", "other", 5],
    ]);
    mine.remove("agathon.unsaved.b1.other");
    expect(mine.list("b1").map((f) => f.tabId)).not.toContain("other");
  });

  it("drops the base copies before giving up on a backup over maxBytes", () => {
    const storage = memoryStorage();
    const plainSize = JSON.stringify(payload).length;
    const backup = createLocalStorageBackup(storage, plainSize + 10, "t");
    const withBase = { ...payload, base: { "shape:a": { id: "shape:a", typeName: "shape", padding: "x".repeat(200) } } };
    expect(backup.write("b1", withBase)).toBe(true);
    expect(backup.read("b1")).toEqual(payload); // the unsaved records survive, the base does not
  });

  it("refuses payloads over maxBytes and clears any stale entry", () => {
    const storage = memoryStorage();
    const backup = createLocalStorageBackup(storage, 50, "t");
    storage.setItem(backupKey("b1", "t"), JSON.stringify(payload));
    expect(backup.write("b1", payload)).toBe(false);
    expect(storage.map.has(backupKey("b1", "t"))).toBe(false);
  });

  it("returns false when storage throws (quota) and null for malformed content", () => {
    const storage = memoryStorage({
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    const backup = createLocalStorageBackup(storage, undefined, "t");
    expect(backup.write("b1", payload)).toBe(false);
    storage.map.set(backupKey("b2", "t"), "{not json");
    storage.map.set(backupKey("b3", "t"), JSON.stringify({ snapshot: { store: {} }, changed: "nope" }));
    expect(backup.read("b2")).toBeNull();
    expect(backup.read("b3")).toBeNull();
  });

  it("works without any storage at all", () => {
    const backup = createLocalStorageBackup(undefined);
    expect(backup.write("b1", payload)).toBe(false);
    expect(backup.read("b1")).toBeNull();
    expect(backup.list("b1")).toEqual([]);
    expect(() => backup.clear("b1")).not.toThrow();
  });

  it("gives every mount its own tab id", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newTabId()));
    expect(ids.size).toBe(50);
    expect([...ids].every((id) => /^[\w-]{6,}$/.test(id) && !id.includes("."))).toBe(true);
  });

  it("isBackupPayload validates the shape", () => {
    expect(isBackupPayload(payload)).toBe(true);
    expect(isBackupPayload({ ...payload, baseVersion: null })).toBe(true);
    expect(isBackupPayload({ ...payload, base: {}, sent: { "shape:a": null } })).toBe(true);
    expect(isBackupPayload({ ...payload, baseVersion: "3" })).toBe(false);
    expect(isBackupPayload({ ...payload, snapshot: { store: [], schema: {} } })).toBe(false);
    expect(isBackupPayload({ ...payload, removed: [1] })).toBe(false);
    expect(isBackupPayload({ ...payload, base: [] })).toBe(false);
    expect(isBackupPayload({ ...payload, sent: "x" })).toBe(false);
    expect(isBackupPayload(null)).toBe(false);
  });
});
