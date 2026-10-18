/**
 * The replay's board read (`reportStoreOver(svc).board(id)`, src/lib/report/server.ts) over a fake
 * supabase-js client: it asks for `*` (the iPad's `doc` columns when the database has them, no error
 * when it does not), and answers the board's tldraw snapshot whichever column holds the board — the
 * iPad app's document turned back into tldraw when it is current, else `data` exactly as stored.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

import { agathonDocToTldraw, parseAgathonDoc } from "@/lib/boards/agathonDoc";
import { reportStoreOver } from "../server";

const BOARD = "b1000000-0000-4000-8000-000000000001";
const KID = "00000000-0000-4000-8000-000000000002";
const DATA = { document: { store: { "shape:a": { id: "shape:a", typeName: "shape", type: "draw" } }, schema: { schemaVersion: 2 } }, session: { version: 0 } };
const DOC = JSON.parse(readFileSync(join(__dirname, "../../boards/__fixtures__/agathon/kid-algebra.agathon.json"), "utf8")) as unknown;

/** Just enough of supabase-js for `from(t).select(c).eq(k, v).maybeSingle()`; the selects are recorded. */
function fakeSvc(row: Record<string, unknown> | null) {
  const selects: Array<{ table: string; columns: string }> = [];
  const svc = {
    from: (table: string) => ({
      select: (columns: string) => {
        selects.push({ table, columns });
        return { eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) };
      },
    }),
  };
  return { store: reportStoreOver(svc as unknown as SupabaseClient), selects };
}

const base = { id: BOARD, user_id: KID, title: "Two-step equations", updated_at: "2026-10-17T09:00:00Z", deleted_at: null, data: DATA };

describe("reportStoreOver(svc).board", () => {
  it("a board the iPad app keeps (its doc current): the doc as a tldraw snapshot, read with *", async () => {
    const { store, selects } = fakeSvc({ ...base, version: 7, doc: DOC, doc_version: 7, doc_schema: 1 });
    const board = await store.board(BOARD);
    expect(selects).toEqual([{ table: "whiteboards", columns: "*" }]);
    expect(board).toMatchObject({ id: BOARD, ownerId: KID, title: "Two-step equations", updatedAt: "2026-10-17T09:00:00Z" });
    expect(board!.snapshot).toEqual(agathonDocToTldraw(parseAgathonDoc(DOC)));
    expect(board!.snapshot).not.toBe(DATA);
    // the kid's ink is there, on the doc's screens
    const records = (board!.snapshot as { document: { store: Record<string, { typeName: string; type?: string }> } }).document.store;
    expect(Object.values(records).filter((r) => r.typeName === "page")).toHaveLength(2);
    expect(Object.values(records).filter((r) => r.typeName === "shape" && r.type === "draw").length).toBeGreaterThan(0);
  });

  it("a web board: data unchanged, whether the database has the doc columns or not", async () => {
    for (const row of [
      // a database before 20261017000000_agathon_doc.sql: no doc columns at all
      { ...base, version: 3 },
      // after it, a board the iPad never opened
      { ...base, version: 3, doc: null, doc_version: null, doc_schema: null },
    ]) {
      const board = await fakeSvc(row).store.board(BOARD);
      expect(board!.snapshot).toBe(DATA);
    }
  });

  it("a doc that is not the board (data written after it) or cannot be read (a newer app's): data", async () => {
    const stale = await fakeSvc({ ...base, version: 9, doc: DOC, doc_version: 8 }).store.board(BOARD);
    expect(stale!.snapshot).toBe(DATA);
    const newer = await fakeSvc({ ...base, version: 4, doc: { ...(DOC as object), schema: 99 }, doc_version: 4 }).store.board(BOARD);
    expect(newer!.snapshot).toBe(DATA);
  });

  it("a deleted board, or none: null", async () => {
    expect(await fakeSvc({ ...base, version: 1, deleted_at: "2026-10-16T00:00:00Z" }).store.board(BOARD)).toBeNull();
    expect(await fakeSvc(null).store.board(BOARD)).toBeNull();
  });
});
