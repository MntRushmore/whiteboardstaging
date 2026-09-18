import { describe, expect, it } from "vitest";
import { mergeDocumentRecords } from "../mergeDocumentRecords";

type Rec = { id: string; typeName: string; x?: number; props?: Record<string, unknown> };
const rec = (id: string, x: number, typeName = "shape"): Rec => ({ id, typeName, x, props: { nested: [x] } });
const ids = (list: unknown[]) => list.map((r) => (r as Rec).id).sort();

describe("mergeDocumentRecords", () => {
  const page = rec("page:page", 0, "page");

  it("both tabs edit different shapes: both survive, remote add is planned as a put", () => {
    const local = { "page:page": page, "shape:a": rec("shape:a", 1) };
    const remote = { "page:page": page, "shape:b": rec("shape:b", 2) };
    const out = mergeDocumentRecords({ local, remote, changed: new Set(["shape:a"]), removed: new Set() });
    expect(Object.keys(out.merged).sort()).toEqual(["page:page", "shape:a", "shape:b"]);
    expect(ids(out.put)).toEqual(["shape:b"]);
    expect(out.remove).toEqual([]);
  });

  it("same shape edited in both: the local record wins and nothing is put", () => {
    const local = { "shape:a": rec("shape:a", 10) };
    const remote = { "shape:a": rec("shape:a", 20) };
    const out = mergeDocumentRecords({ local, remote, changed: new Set(["shape:a"]), removed: new Set() });
    expect(out.merged["shape:a"]).toBe(local["shape:a"]);
    expect(out.put).toEqual([]);
    expect(out.remove).toEqual([]);
  });

  it("local delete vs remote edit: stays deleted and the remote copy is removed", () => {
    const local = { "page:page": page };
    const remote = { "page:page": page, "shape:a": rec("shape:a", 99) };
    const out = mergeDocumentRecords({ local, remote, changed: new Set(), removed: new Set(["shape:a"]) });
    expect(out.merged["shape:a"]).toBeUndefined();
    expect(out.remove).toEqual(["shape:a"]);
    expect(out.put).toEqual([]);
  });

  it("remote delete vs local untouched: removed locally", () => {
    const local = { "page:page": page, "shape:a": rec("shape:a", 1) };
    const remote = { "page:page": page };
    const out = mergeDocumentRecords({ local, remote, changed: new Set(), removed: new Set() });
    expect(out.merged["shape:a"]).toBeUndefined();
    expect(out.remove).toEqual(["shape:a"]);
  });

  it("remote delete vs local edit: the local edit wins (kept as a local add)", () => {
    const local = { "shape:a": rec("shape:a", 1) };
    const remote = {};
    const out = mergeDocumentRecords({ local, remote, changed: new Set(["shape:a"]), removed: new Set() });
    expect(out.merged["shape:a"]).toBe(local["shape:a"]);
    expect(out.put).toEqual([]);
    expect(out.remove).toEqual([]);
  });

  it("remote edit of a locally untouched record: remote wins via put; deep-equal records are not put", () => {
    const local = { "shape:a": rec("shape:a", 1), "shape:same": rec("shape:same", 5) };
    const remote = { "shape:a": rec("shape:a", 2), "shape:same": rec("shape:same", 5) };
    const out = mergeDocumentRecords({ local, remote, changed: new Set(), removed: new Set() });
    expect(out.merged["shape:a"]).toBe(remote["shape:a"]);
    expect(ids(out.put)).toEqual(["shape:a"]);
  });

  it("ignores session records on both sides", () => {
    const local = {
      "instance:instance": rec("instance:instance", 1, "instance"),
      "camera:page:page": rec("camera:page:page", 1, "camera"),
      "pointer:pointer": rec("pointer:pointer", 1, "pointer"),
    };
    const remote = {
      "instance_page_state:page:page": rec("instance_page_state:page:page", 2, "instance_page_state"),
      "instance_presence:x": rec("instance_presence:x", 2, "instance_presence"),
      "camera:page:page": rec("camera:page:page", 9, "camera"),
    };
    const out = mergeDocumentRecords({ local, remote, changed: new Set(), removed: new Set() });
    expect(out.merged).toEqual({});
    expect(out.put).toEqual([]);
    expect(out.remove).toEqual([]);
  });

  it("an id flagged changed but absent locally is treated as a local removal", () => {
    const remote = { "shape:a": rec("shape:a", 1) };
    const out = mergeDocumentRecords({ local: {}, remote, changed: new Set(["shape:a"]), removed: new Set() });
    expect(out.remove).toEqual(["shape:a"]);
    expect(out.merged).toEqual({});
  });

  it("never mutates its inputs", () => {
    const local = { "shape:a": rec("shape:a", 1), "shape:gone": rec("shape:gone", 3) };
    const remote = { "shape:a": rec("shape:a", 2), "shape:b": rec("shape:b", 2), "shape:del": rec("shape:del", 4) };
    const changed = new Set(["shape:a"]);
    const removed = new Set(["shape:del"]);
    const snapshot = JSON.stringify({ local, remote, changed: [...changed], removed: [...removed] });
    const out = mergeDocumentRecords({ local, remote, changed, removed });
    out.merged["shape:new"] = rec("shape:new", 0);
    expect(JSON.stringify({ local, remote, changed: [...changed], removed: [...removed] })).toBe(snapshot);
    expect(out.remove.sort()).toEqual(["shape:del", "shape:gone"]);
    expect(ids(out.put)).toEqual(["shape:b"]);
  });
});
