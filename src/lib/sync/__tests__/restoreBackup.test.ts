import { describe, expect, it } from "vitest";
import type { TLShapeId, TLStore } from "tldraw";
import { restoreBackupInto, restoreBackups } from "../restoreBackup";
import { cloneStore, docRecords, makeStore, putShape, shapeIds } from "../__fixtures__/store";
import type { BackupPayload } from "../types";

const xOf = (store: TLStore, id: string): number | undefined => (docRecords(store) as Record<string, { x: number }>)[id]?.x;

/** The backup the queue writes: the changed records, and each changed/removed record as the server had it at `baseVersion`. */
function backupOf(
  device: TLStore,
  server: TLStore,
  { changed = [], removed = [], baseVersion = 1, at = 1, sent }: { changed?: string[]; removed?: string[]; baseVersion?: number | null; at?: number; sent?: Record<string, unknown> },
): BackupPayload {
  const local = docRecords(device);
  const atBase = docRecords(server);
  const store: Record<string, unknown> = {};
  const base: Record<string, unknown> = {};
  for (const id of changed) if (local[id]) store[id] = local[id];
  for (const id of [...changed, ...removed]) if (atBase[id]) base[id] = atBase[id];
  return {
    snapshot: { store, schema: device.schema.serialize() } as BackupPayload["snapshot"],
    baseVersion,
    changed,
    removed,
    at,
    base,
    ...(sent ? { sent } : {}),
  };
}

describe("restoreBackups", () => {
  it("restores what only this device changed, even when the row moved on through other records", () => {
    const atBase = makeStore();
    putShape(atBase, "shape:a", 1);
    putShape(atBase, "shape:b", 1);

    // The crashed tab: moved a, added d, deleted b.
    const crashed = cloneStore(atBase);
    putShape(crashed, "shape:a", 500);
    putShape(crashed, "shape:d", 7);
    crashed.remove(["shape:b" as TLShapeId]);
    const backup = backupOf(crashed, atBase, { changed: ["shape:a", "shape:d"], removed: ["shape:b"] });

    // What the server has now (v5): another device added c and touched nothing else.
    const loaded = cloneStore(atBase);
    putShape(loaded, "shape:c", 1);

    expect(restoreBackupInto(loaded, backup, 5)).toEqual({ applied: 3, stale: 0 });
    expect(shapeIds(loaded)).toEqual(["shape:a", "shape:c", "shape:d"]);
    expect(xOf(loaded, "shape:a")).toBe(500);
    expect(xOf(loaded, "shape:c")).toBe(1);
    expect(xOf(loaded, "shape:d")).toBe(7);
  });

  it("a stale backup never overwrites a record the server changed since (N2): the server's stays, the student is told", () => {
    const atBase = makeStore();
    putShape(atBase, "shape:a", 1);
    putShape(atBase, "shape:b", 1);
    const ipad = cloneStore(atBase);
    putShape(ipad, "shape:a", 111); // edited on the iPad, never saved
    putShape(ipad, "shape:b", 222);
    const backup = backupOf(ipad, atBase, { changed: ["shape:a", "shape:b"] });

    // Days later: the laptop moved a; b is as it was.
    const loaded = cloneStore(atBase);
    putShape(loaded, "shape:a", 999);

    expect(restoreBackupInto(loaded, backup, 9)).toEqual({ applied: 1, stale: 1 });
    expect(xOf(loaded, "shape:a")).toBe(999);
    expect(xOf(loaded, "shape:b")).toBe(222);
  });

  it("deleted on the server vs edited locally: it stays deleted (both changed it; the server's change wins)", () => {
    const atBase = makeStore();
    putShape(atBase, "shape:a", 1);
    const device = cloneStore(atBase);
    putShape(device, "shape:a", 40);
    const backup = backupOf(device, atBase, { changed: ["shape:a"] });
    const loaded = cloneStore(atBase);
    loaded.remove(["shape:a" as TLShapeId]);

    expect(restoreBackupInto(loaded, backup, 2)).toEqual({ applied: 0, stale: 1 });
    expect(shapeIds(loaded)).toEqual([]);
  });

  it("edited on the server vs deleted locally: the server's edit stays", () => {
    const atBase = makeStore();
    putShape(atBase, "shape:a", 1);
    const device = cloneStore(atBase);
    device.remove(["shape:a" as TLShapeId]);
    const backup = backupOf(device, atBase, { removed: ["shape:a"] });
    const loaded = cloneStore(atBase);
    putShape(loaded, "shape:a", 77);

    expect(restoreBackupInto(loaded, backup, 2)).toEqual({ applied: 0, stale: 1 });
    expect(xOf(loaded, "shape:a")).toBe(77);
  });

  it("a backup newer than the server (the row never moved past its base) is restored in full", () => {
    const atBase = makeStore();
    putShape(atBase, "shape:a", 1);
    putShape(atBase, "shape:b", 1);
    const device = cloneStore(atBase);
    putShape(device, "shape:a", 5);
    putShape(device, "shape:n", 6);
    device.remove(["shape:b" as TLShapeId]);
    const backup = backupOf(device, atBase, { changed: ["shape:a", "shape:n"], removed: ["shape:b"], baseVersion: 4 });
    const loaded = cloneStore(atBase);

    expect(restoreBackupInto(loaded, backup, 4)).toEqual({ applied: 3, stale: 0 });
    expect(shapeIds(loaded)).toEqual(["shape:a", "shape:n"]);
    expect(xOf(loaded, "shape:a")).toBe(5);
  });

  it("this device's own write that landed as the tab died is not mistaken for another device's change", () => {
    const atBase = makeStore();
    putShape(atBase, "shape:a", 1);
    const device = cloneStore(atBase);
    const sentA = putShape(device, "shape:a", 50); // the write in flight sent this...
    putShape(device, "shape:a", 60); // ...and the stroke went on
    const backup = backupOf(device, atBase, { changed: ["shape:a"], sent: { "shape:a": sentA } });
    const loaded = cloneStore(atBase);
    loaded.put([sentA]); // the write landed (v2)

    expect(restoreBackupInto(loaded, backup, 2)).toEqual({ applied: 1, stale: 0 });
    expect(xOf(loaded, "shape:a")).toBe(60);
  });

  it("replays several tabs' backups oldest first; a newer one's record wins", () => {
    const atBase = makeStore();
    putShape(atBase, "shape:a", 1);
    const tab1 = cloneStore(atBase);
    putShape(tab1, "shape:a", 100);
    putShape(tab1, "shape:one", 1);
    const tab2 = cloneStore(atBase);
    putShape(tab2, "shape:a", 200);
    putShape(tab2, "shape:two", 2);
    const older = backupOf(tab1, atBase, { changed: ["shape:a", "shape:one"], at: 10 });
    const newer = backupOf(tab2, atBase, { changed: ["shape:a", "shape:two"], at: 20 });
    const loaded = cloneStore(atBase);

    expect(restoreBackups(loaded, [newer, older], 1)).toEqual({ applied: 3, stale: 0 });
    expect(xOf(loaded, "shape:a")).toBe(200);
    expect(shapeIds(loaded)).toEqual(["shape:a", "shape:one", "shape:two"]);
  });

  it("applies nothing when the save landed before the tab closed (the board already has every record)", () => {
    const loaded = makeStore();
    const a = putShape(loaded, "shape:a", 9);
    const backup: BackupPayload = {
      snapshot: { store: { "shape:a": a }, schema: loaded.schema.serialize() } as BackupPayload["snapshot"],
      baseVersion: 1,
      changed: ["shape:a"],
      removed: ["shape:gone"],
      at: 1,
      base: {},
    };
    expect(restoreBackupInto(loaded, backup, 2)).toEqual({ applied: 0, stale: 0 });
  });

  describe("backups written before base records existed (2026-10-02 and earlier)", () => {
    function legacy() {
      const atBase = makeStore();
      putShape(atBase, "shape:a", 1);
      putShape(atBase, "shape:b", 1);
      const crashed = cloneStore(atBase);
      putShape(crashed, "shape:a", 500);
      putShape(crashed, "shape:d", 7);
      crashed.remove(["shape:b" as TLShapeId]);
      const { base: _base, ...backup } = backupOf(crashed, atBase, { changed: ["shape:a", "shape:d"], removed: ["shape:b"], baseVersion: 3 });
      void _base;
      return { atBase, backup };
    }

    it("restore every change when the row is still at the backup's version", () => {
      const { atBase, backup } = legacy();
      const loaded = cloneStore(atBase);
      expect(restoreBackupInto(loaded, backup, 3)).toEqual({ applied: 3, stale: 0 });
      expect(shapeIds(loaded)).toEqual(["shape:a", "shape:d"]);
    });

    it("once the row moved on, keep every record the server has as the server has it; restore only new records", () => {
      const { atBase, backup } = legacy();
      const loaded = cloneStore(atBase);
      expect(restoreBackupInto(loaded, backup, 7)).toEqual({ applied: 1, stale: 2 });
      expect(shapeIds(loaded)).toEqual(["shape:a", "shape:b", "shape:d"]);
      expect(xOf(loaded, "shape:a")).toBe(1);
    });
  });

  it("migrates records a previous deploy backed up (older schema) before restoring them", () => {
    const loaded = makeStore();
    const schema = loaded.schema.serialize() as { sequences: Record<string, number> };
    const older = { ...schema, sequences: { ...schema.sequences, "com.tldraw.shape.draw": 1 } };
    const { scale: _scale, ...propsWithoutScale } = putShape(cloneStore(loaded), "shape:old", 5).props;
    void _scale;
    const record = { ...putShape(cloneStore(loaded), "shape:old", 5), props: propsWithoutScale };
    const backup: BackupPayload = {
      snapshot: { store: { "shape:old": record }, schema: older } as unknown as BackupPayload["snapshot"],
      baseVersion: 1,
      changed: ["shape:old"],
      removed: [],
      at: 1,
      base: {},
    };
    expect(restoreBackupInto(loaded, backup, 1)).toEqual({ applied: 1, stale: 0 });
    expect((docRecords(loaded) as Record<string, { props: { scale: number } }>)["shape:old"].props.scale).toBe(1);
  });

  it("is a no-op when the backup has nothing pending", () => {
    const loaded = makeStore();
    putShape(loaded, "shape:a");
    const before = docRecords(loaded);
    const backup: BackupPayload = { snapshot: loaded.getStoreSnapshot("document"), baseVersion: null, changed: [], removed: [], at: 1 };
    expect(restoreBackupInto(loaded, backup, null)).toEqual({ applied: 0, stale: 0 });
    expect(docRecords(loaded)).toEqual(before);
  });
});
