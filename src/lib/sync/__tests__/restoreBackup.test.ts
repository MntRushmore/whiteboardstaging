import { describe, expect, it } from "vitest";
import type { TLShapeId } from "tldraw";
import { restoreBackupInto } from "../restoreBackup";
import { cloneStore, docRecords, makeStore, putShape, shapeIds } from "../__fixtures__/store";
import type { BackupPayload } from "../types";

describe("restoreBackupInto", () => {
  it("applies only the backup's changed records and removals over the loaded store", () => {
    // What the server has now: a, b, c (c was added by another tab after the backup).
    const loaded = makeStore();
    putShape(loaded, "shape:a", 1);
    putShape(loaded, "shape:b", 1);
    putShape(loaded, "shape:c", 1);

    // The crashed tab: moved a, added d, deleted b, and had a stale copy of c... which it never touched.
    const crashed = cloneStore(loaded);
    putShape(crashed, "shape:a", 500);
    putShape(crashed, "shape:d", 7);
    crashed.remove(["shape:b" as TLShapeId]);
    putShape(crashed, "shape:c", 999); // untouched per the tracker (not in `changed`) -> must not be restored
    const backup: BackupPayload = {
      snapshot: crashed.getStoreSnapshot("document"),
      baseVersion: 1,
      changed: ["shape:a", "shape:d"],
      removed: ["shape:b"],
      at: 1,
    };

    const { applied } = restoreBackupInto(loaded, backup, 5);
    expect(applied).toBe(3);
    expect(shapeIds(loaded)).toEqual(["shape:a", "shape:c", "shape:d"]);
    const records = docRecords(loaded) as Record<string, { x: number }>;
    expect(records["shape:a"].x).toBe(500);
    expect(records["shape:c"].x).toBe(1);
    expect(records["shape:d"].x).toBe(7);
  });

  it("restores a backup that holds only the changed records (the format the queue writes)", () => {
    const loaded = makeStore();
    putShape(loaded, "shape:a", 1);
    putShape(loaded, "shape:b", 1);
    const crashed = cloneStore(loaded);
    const moved = putShape(crashed, "shape:a", 300);
    const added = putShape(crashed, "shape:new", 4);
    const backup: BackupPayload = {
      snapshot: { store: { "shape:a": moved, "shape:new": added }, schema: crashed.schema.serialize() } as BackupPayload["snapshot"],
      baseVersion: 2,
      changed: ["shape:a", "shape:new"],
      removed: ["shape:b"],
      at: 1,
    };
    expect(restoreBackupInto(loaded, backup, 2)).toEqual({ applied: 3 });
    expect(shapeIds(loaded)).toEqual(["shape:a", "shape:new"]);
    expect((docRecords(loaded) as Record<string, { x: number }>)["shape:a"].x).toBe(300);
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
    };
    expect(restoreBackupInto(loaded, backup, 2)).toEqual({ applied: 0 });
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
    };
    expect(restoreBackupInto(loaded, backup, 1)).toEqual({ applied: 1 });
    expect((docRecords(loaded) as Record<string, { props: { scale: number } }>)["shape:old"].props.scale).toBe(1);
  });

  it("is a no-op when the backup has nothing pending", () => {
    const loaded = makeStore();
    putShape(loaded, "shape:a");
    const before = docRecords(loaded);
    const backup: BackupPayload = { snapshot: loaded.getStoreSnapshot("document"), baseVersion: null, changed: [], removed: [], at: 1 };
    expect(restoreBackupInto(loaded, backup, null)).toEqual({ applied: 0 });
    expect(docRecords(loaded)).toEqual(before);
  });
});
