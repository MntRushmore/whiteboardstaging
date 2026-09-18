import { describe, expect, it } from "vitest";
import { backupKey, createLocalStorageBackup, isBackupPayload } from "../localBackup";
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
  it("writes, reads back and clears under agathon.unsaved.<boardId>", () => {
    const storage = memoryStorage();
    const backup = createLocalStorageBackup(storage);
    expect(backup.write("b1", payload)).toBe(true);
    expect(storage.map.has(backupKey("b1"))).toBe(true);
    expect(backupKey("b1")).toBe("agathon.unsaved.b1");
    expect(backup.read("b1")).toEqual(payload);
    backup.clear("b1");
    expect(backup.read("b1")).toBeNull();
  });

  it("refuses payloads over maxBytes and clears any stale entry", () => {
    const storage = memoryStorage();
    const backup = createLocalStorageBackup(storage, 50);
    storage.setItem(backupKey("b1"), JSON.stringify(payload));
    expect(backup.write("b1", payload)).toBe(false);
    expect(storage.map.has(backupKey("b1"))).toBe(false);
  });

  it("returns false when storage throws (quota) and null for malformed content", () => {
    const storage = memoryStorage({
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    const backup = createLocalStorageBackup(storage);
    expect(backup.write("b1", payload)).toBe(false);
    storage.map.set(backupKey("b2"), "{not json");
    storage.map.set(backupKey("b3"), JSON.stringify({ snapshot: { store: {} }, changed: "nope" }));
    expect(backup.read("b2")).toBeNull();
    expect(backup.read("b3")).toBeNull();
  });

  it("works without any storage at all", () => {
    const backup = createLocalStorageBackup(undefined);
    expect(backup.write("b1", payload)).toBe(false);
    expect(backup.read("b1")).toBeNull();
    expect(() => backup.clear("b1")).not.toThrow();
  });

  it("isBackupPayload validates the shape", () => {
    expect(isBackupPayload(payload)).toBe(true);
    expect(isBackupPayload({ ...payload, baseVersion: null })).toBe(true);
    expect(isBackupPayload({ ...payload, baseVersion: "3" })).toBe(false);
    expect(isBackupPayload({ ...payload, snapshot: { store: [] , schema: {} } })).toBe(false);
    expect(isBackupPayload({ ...payload, removed: [1] })).toBe(false);
    expect(isBackupPayload(null)).toBe(false);
  });
});
