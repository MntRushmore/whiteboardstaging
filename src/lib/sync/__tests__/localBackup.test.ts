import { describe, expect, it } from "vitest";
import { backupKey, createLocalStorageBackup, isBackupPayload, isQuotaError, newTabId, storedBytes } from "../localBackup";
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

  it("refuses payloads over maxBytes and keeps the previous, smaller backup (older unsaved work beats none)", () => {
    const storage = memoryStorage();
    const backup = createLocalStorageBackup(storage, 50, "t");
    storage.setItem(backupKey("b1", "t"), "previous");
    expect(backup.write("b1", payload)).toBe(false);
    expect(storage.map.get(backupKey("b1", "t"))).toBe("previous");
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

/**
 * localStorage as WebKit (Safari) meters it: every key and value costs 1 byte per character when
 * all its characters are Latin-1 and 2 bytes per character once any is above U+00FF, and a write
 * that would take the origin past `quota` bytes throws QuotaExceededError and changes nothing.
 */
function safariStorage(quota: number): Storage & { map: Map<string, string>; used(): number } {
  const map = new Map<string, string>();
  const cost = (s: string) => (/[Ā-￿]/.test(s) ? 2 : 1) * s.length;
  const used = () => [...map].reduce((n, [k, v]) => n + cost(k) + cost(v), 0);
  const storage = {
    map,
    used,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => {
      const next = used() - (map.has(k) ? cost(k) + cost(map.get(k)!) : 0) + cost(k) + cost(v);
      if (next > quota) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      map.set(k, v);
    },
  };
  return storage as Storage & { map: Map<string, string>; used(): number };
}

/** A backup of about `chars` characters of JSON; `wide` puts one "√" in it (a recognized line). */
function sized(chars: number, { wide = false, at = 1000, base = 0 } = {}): BackupPayload {
  const text = (wide ? "√" : "x") + "x".repeat(Math.max(0, chars - 200));
  return {
    ...payload,
    snapshot: { ...payload.snapshot, store: { "shape:a": { id: "shape:a", typeName: "shape", text } } } as unknown as BackupPayload["snapshot"],
    at,
    ...(base ? { base: { "shape:a": { id: "shape:a", typeName: "shape", text: "y".repeat(base) } } } : {}),
  };
}

describe("backup size and Safari's storage quota", () => {
  it("storedBytes: 1 byte per character for Latin-1, 2 for the whole string once any character is wider", () => {
    expect(storedBytes("abc")).toBe(3);
    expect(storedBytes("é±ÿ")).toBe(3); // Latin-1 stays 8-bit in WebKit
    expect(storedBytes("x".repeat(999) + "√")).toBe(2000);
    expect(storedBytes("😀")).toBe(4); // a surrogate pair is two UTF-16 units
    expect(storedBytes("")).toBe(0);
  });

  it("isQuotaError tells a full storage from a blocked one", () => {
    expect(isQuotaError(new DOMException("full", "QuotaExceededError"))).toBe(true);
    expect(isQuotaError({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError(new DOMException("blocked", "SecurityError"))).toBe(false);
    expect(isQuotaError(new Error("QuotaExceededError"))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it("budgets a backup holding one '√' at 2 bytes per character", () => {
    const backup = createLocalStorageBackup(safariStorage(1_000_000), 2_000, "t");
    expect(backup.write("b1", sized(1_500))).toBe(true); // 1.5 KB
    expect(backup.write("b2", sized(1_500, { wide: true }))).toBe(false); // 3 KB in Safari: over the 2 KB budget
    expect(backup.write("b3", sized(990, { wide: true }))).toBe(true); // 2 KB
  });

  it("two boards' largest backups fit in Safari's quota together (5 MB, scaled down 1000x)", () => {
    // Before: the cap counted characters, so a 1.9 M-character backup with one "√" took 3.8 MB of
    // Safari's 5 MB and the second board's large backup could not be stored at all.
    const storage = safariStorage(5_000);
    storage.setItem("sb-127-auth-token", "t".repeat(400)); // the session and the rest
    const tabA = createLocalStorageBackup(storage, 2_000, "a");
    const tabB = createLocalStorageBackup(storage, 2_000, "b");
    expect(tabA.write("boardA", sized(990, { wide: true }))).toBe(true);
    expect(tabB.write("boardB", sized(990, { wide: true }))).toBe(true);
    expect(tabA.read("boardA")).not.toBeNull();
    expect(tabB.read("boardB")).not.toBeNull();
    expect(storage.used()).toBeLessThanOrEqual(5_000);
  });

  it("when storage is full, drops the base copies before anything else", () => {
    const storage = safariStorage(2_500);
    const other = createLocalStorageBackup(storage, 2_000, "other");
    expect(other.write("b2", sized(1_000))).toBe(true);
    const backup = createLocalStorageBackup(storage, 2_000, "t");
    // ~1.9 KB with its base copy, ~0.9 KB without it; ~1.5 KB left
    expect(backup.write("b1", sized(900, { base: 1_000 }))).toBe(true);
    expect(backup.read("b1")?.base).toBeUndefined();
    expect(backup.read("b1")?.changed).toEqual(["shape:a"]);
    expect(other.read("b2")).not.toBeNull();
  });

  it("when storage is full and nothing may go, keeps this tab's previous backup and every other tab's", () => {
    const storage = safariStorage(4_200);
    const now = () => 10_000;
    const otherBoard = createLocalStorageBackup(storage, 2_000, "x", now);
    const otherTab = createLocalStorageBackup(storage, 2_000, "y", now);
    const backup = createLocalStorageBackup(storage, 2_000, "t", now);
    expect(otherBoard.write("b2", sized(1_500, { at: 9_000 }))).toBe(true);
    expect(otherTab.write("b1", sized(1_500, { at: 9_500 }))).toBe(true);
    expect(backup.write("b1", sized(500, { at: 9_900 }))).toBe(true); // the previous backup
    const before = new Map(storage.map);

    expect(backup.write("b1", sized(1_900, { at: 10_000 }))).toBe(false);
    expect(storage.map).toEqual(before);
    expect(backup.read("b1")?.at).toBe(9_900); // not cleared
    expect(otherBoard.read("b2")?.at).toBe(9_000);
    expect(otherTab.read("b1")?.at).toBe(9_500);
  });

  it("makes room by evicting restored, then unreadable, then week-old backups, oldest first", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = 30 * DAY;
    const storage = safariStorage(5_000); // 4.6 KB in use
    const put = (board: string, tab: string, at: number, chars = 1_000) =>
      storage.setItem(backupKey(board, tab), JSON.stringify(sized(chars, { at })));
    put("b1", "replayed", now - DAY, 1_200); // restored by this tab (absorbed)
    put("b2", "recent", now - DAY); // another board's backup from yesterday: never evicted
    put("b3", "old", now - 9 * DAY); // stale
    put("b4", "older", now - 20 * DAY); // stale, older
    storage.setItem(backupKey("b5", "junk"), "{not json");
    storage.setItem("sb-127-auth-token", "t".repeat(300)); // not a backup: never touched

    const backup = createLocalStorageBackup(storage, 2_000, "t", () => now);
    backup.absorb([backupKey("b1", "replayed")]);
    const keys = () => [...storage.map.keys()].sort();

    expect(backup.write("b1", sized(1_100, { at: now }))).toBe(true); // the replayed backup goes
    expect(keys()).not.toContain(backupKey("b1", "replayed"));
    expect(keys()).toContain(backupKey("b5", "junk"));
    expect(keys()).toContain(backupKey("b4", "older"));

    const second = createLocalStorageBackup(storage, 2_000, "u", () => now);
    expect(second.write("b6", sized(1_400, { at: now }))).toBe(true); // junk, then the oldest stale one
    expect(keys()).not.toContain(backupKey("b5", "junk"));
    expect(keys()).not.toContain(backupKey("b4", "older"));
    expect(keys()).toContain(backupKey("b3", "old"));
    expect(keys()).toContain(backupKey("b2", "recent"));
    expect(keys()).toContain("sb-127-auth-token");

    const third = createLocalStorageBackup(storage, 2_000, "v", () => now);
    expect(third.write("b7", sized(1_900, { at: now }))).toBe(false); // only recent backups left
    expect(keys()).toContain(backupKey("b2", "recent"));
    expect(keys()).not.toContain(backupKey("b3", "old")); // evicted on the way, as stale
    expect(backup.read("b1")?.at).toBe(now);
    expect(second.read("b6")?.at).toBe(now);
  });

  it("evicts nothing when storage is blocked rather than full", () => {
    const storage = memoryStorage({
      setItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    storage.map.set(backupKey("b2", "old"), "{not json");
    const backup = createLocalStorageBackup(storage, undefined, "t");
    expect(backup.write("b1", payload)).toBe(false);
    expect(storage.map.has(backupKey("b2", "old"))).toBe(true);
  });
});
