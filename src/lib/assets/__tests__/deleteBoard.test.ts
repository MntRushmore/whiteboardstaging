import { describe, expect, it } from "vitest";
import { DELETE_BATCH_SIZE, deleteBoardWithAssets, type DeleteBoardSupabase } from "../deleteBoard";

const BOARD = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const UID = "11111111-2222-3333-4444-555555555555";

// Compile-time assignability of the real SupabaseClient to DeleteBoardSupabase is
// checked at the production call site (src/app/page.tsx passes `supabase` straight
// in); an untyped `createClient()` here trips TS2589 on the generic `select`.

interface FakeOptions {
  paths?: string[];
  selectError?: { message: string } | null;
  selectThrows?: boolean;
  removeError?: { message: string } | null;
  removeThrows?: boolean;
  /** Fail only the batch containing this path. */
  removeFailFor?: string;
  deleteError?: { message: string } | null;
}

function fakeSupabase(opts: FakeOptions = {}) {
  const calls = {
    selects: [] as Array<{ table: string; columns: string; column: string; value: string }>,
    removes: [] as Array<{ bucket: string; paths: string[] }>,
    deletes: [] as Array<{ table: string; column: string; value: string }>,
  };
  const order: string[] = [];
  const client: DeleteBoardSupabase = {
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            order.push("remove");
            calls.removes.push({ bucket, paths });
            if (opts.removeThrows) throw new Error("network down");
            if (opts.removeFailFor && paths.includes(opts.removeFailFor)) return { error: { message: "storage exploded" } };
            return { error: opts.removeError ?? null };
          },
        };
      },
    },
    from(table) {
      return {
        select(columns) {
          return {
            async eq(column, value) {
              order.push("select");
              calls.selects.push({ table, columns, column, value });
              if (opts.selectThrows) throw new Error("select exploded");
              if (opts.selectError) return { data: null, error: opts.selectError };
              return { data: (opts.paths ?? []).map((object_path) => ({ object_path })), error: null };
            },
          };
        },
        delete() {
          return {
            async eq(column, value) {
              order.push("delete");
              calls.deletes.push({ table, column, value });
              return { error: opts.deleteError ?? null };
            },
          };
        },
      };
    },
  };
  return { client, calls, order };
}

const path = (n: number) => `${UID}/${BOARD}/a${n}.png`;

describe("deleteBoardWithAssets", () => {
  it("reads the registry, deletes the row, then removes every object in one batch", async () => {
    const { client, calls, order } = fakeSupabase({ paths: [path(1), path(2), path(1)] });
    const result = await deleteBoardWithAssets(client, BOARD);
    expect(result).toEqual({ assetsFound: 2, assetsRemoved: 2, assetErrors: [] });
    expect(calls.selects).toEqual([{ table: "board_assets", columns: "object_path", column: "whiteboard_id", value: BOARD }]);
    expect(calls.deletes).toEqual([{ table: "whiteboards", column: "id", value: BOARD }]);
    expect(calls.removes).toEqual([{ bucket: "board-assets", paths: [path(1), path(2)] }]);
    expect(order).toEqual(["select", "delete", "remove"]);
  });

  it("a board without images only deletes the row", async () => {
    const { client, calls } = fakeSupabase({ paths: [] });
    const result = await deleteBoardWithAssets(client, BOARD);
    expect(result).toEqual({ assetsFound: 0, assetsRemoved: 0, assetErrors: [] });
    expect(calls.removes).toEqual([]);
    expect(calls.deletes).toHaveLength(1);
  });

  it("removes in batches of DELETE_BATCH_SIZE (100) and honours a custom batch size / bucket", async () => {
    const many = Array.from({ length: 250 }, (_, i) => path(i));
    const a = fakeSupabase({ paths: many });
    expect((await deleteBoardWithAssets(a.client, BOARD)).assetsRemoved).toBe(250);
    expect(a.calls.removes.map((r) => r.paths.length)).toEqual([DELETE_BATCH_SIZE, DELETE_BATCH_SIZE, 50]);

    const b = fakeSupabase({ paths: many.slice(0, 5) });
    await deleteBoardWithAssets(b.client, BOARD, { batchSize: 2, bucket: "other" });
    expect(b.calls.removes.map((r) => [r.bucket, r.paths.length])).toEqual([["other", 2], ["other", 2], ["other", 1]]);
  });

  it("a failing batch is reported, the other batches still run, and the row is gone", async () => {
    const { client, calls } = fakeSupabase({ paths: [path(1), path(2), path(3)], removeFailFor: path(2) });
    const result = await deleteBoardWithAssets(client, BOARD, { batchSize: 1 });
    expect(result.assetsFound).toBe(3);
    expect(result.assetsRemoved).toBe(2);
    expect(result.assetErrors).toEqual(["could not remove 1 image(s): storage exploded"]);
    expect(calls.removes).toHaveLength(3);
    expect(calls.deletes).toHaveLength(1);
  });

  it("a remove that throws is reported, not thrown", async () => {
    const { client } = fakeSupabase({ paths: [path(1)], removeThrows: true });
    const result = await deleteBoardWithAssets(client, BOARD);
    expect(result.assetsRemoved).toBe(0);
    expect(result.assetErrors).toEqual(["could not remove 1 image(s): network down"]);
  });

  it("a registry read error is reported and the row is still deleted (nothing to remove)", async () => {
    const errored = fakeSupabase({ selectError: { message: "permission denied for table board_assets" } });
    const result = await deleteBoardWithAssets(errored.client, BOARD);
    expect(result).toEqual({ assetsFound: 0, assetsRemoved: 0, assetErrors: ["could not list images: permission denied for table board_assets"] });
    expect(errored.calls.deletes).toHaveLength(1);
    expect(errored.calls.removes).toEqual([]);

    const thrown = fakeSupabase({ selectThrows: true });
    expect((await deleteBoardWithAssets(thrown.client, BOARD)).assetErrors).toEqual(["could not list images: select exploded"]);
    expect(thrown.calls.deletes).toHaveLength(1);
  });

  it("throws when the row delete fails and removes nothing", async () => {
    const { client, calls } = fakeSupabase({ paths: [path(1)], deleteError: { message: "row level security" } });
    await expect(deleteBoardWithAssets(client, BOARD)).rejects.toMatchObject({ message: "row level security" });
    expect(calls.removes).toEqual([]);
  });

  it("rejects an empty board id before touching the client", async () => {
    const { client, calls } = fakeSupabase();
    await expect(deleteBoardWithAssets(client, "")).rejects.toThrow(/boardId is required/);
    expect(calls.selects).toEqual([]);
  });
});
