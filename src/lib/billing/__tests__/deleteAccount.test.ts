import { describe, expect, it } from "vitest";
import {
  BOARD_ASSETS_BUCKET,
  REMOVE_BATCH_SIZE,
  deleteOwnAccount,
  removeOwnBoardAssets,
  type DeleteAccountClient,
} from "@/lib/billing/deleteAccount";

type Calls = { removed: string[][]; buckets: string[]; rpc: string[] };

function fakeClient(opts: {
  rows?: Array<{ object_path: string | null }> | null;
  selectError?: string;
  removeError?: (batch: string[]) => string | null;
  rpcError?: string;
}): { client: DeleteAccountClient; calls: Calls } {
  const calls: Calls = { removed: [], buckets: [], rpc: [] };
  const client: DeleteAccountClient = {
    from: () => ({
      select: () =>
        Promise.resolve(
          opts.selectError ? { data: null, error: { message: opts.selectError } } : { data: opts.rows ?? [], error: null },
        ),
    }),
    storage: {
      from: (bucket) => {
        calls.buckets.push(bucket);
        return {
          remove: (paths) => {
            calls.removed.push(paths);
            const msg = opts.removeError?.(paths) ?? null;
            return Promise.resolve({ data: null, error: msg ? { message: msg } : null });
          },
        };
      },
    },
    rpc: (fn) => {
      calls.rpc.push(fn);
      return Promise.resolve({ data: null, error: opts.rpcError ? { message: opts.rpcError } : null });
    },
  };
  return { client, calls };
}

describe("removeOwnBoardAssets", () => {
  it("removes every registered path from the board-assets bucket", async () => {
    const { client, calls } = fakeClient({ rows: [{ object_path: "u/b/1.png" }, { object_path: "u/b/2.png" }] });
    await expect(removeOwnBoardAssets(client)).resolves.toEqual({ found: 2, removed: 2, error: null });
    expect(calls.buckets).toEqual([BOARD_ASSETS_BUCKET]);
    expect(calls.removed).toEqual([["u/b/1.png", "u/b/2.png"]]);
  });

  it("does not call Storage when the registry is empty and skips null paths", async () => {
    const { client, calls } = fakeClient({ rows: [{ object_path: null }, { object_path: "" }] });
    await expect(removeOwnBoardAssets(client)).resolves.toEqual({ found: 0, removed: 0, error: null });
    expect(calls.removed).toEqual([]);
  });

  it("batches large registries and keeps going after a failed batch", async () => {
    const rows = Array.from({ length: REMOVE_BATCH_SIZE + 5 }, (_, i) => ({ object_path: `u/b/${i}.png` }));
    const { client, calls } = fakeClient({ rows, removeError: (batch) => (batch.length === REMOVE_BATCH_SIZE ? "boom" : null) });
    await expect(removeOwnBoardAssets(client)).resolves.toEqual({ found: REMOVE_BATCH_SIZE + 5, removed: 5, error: "boom" });
    expect(calls.removed.map((b) => b.length)).toEqual([REMOVE_BATCH_SIZE, 5]);
  });

  it("reports a registry read failure without touching Storage", async () => {
    const { client, calls } = fakeClient({ selectError: "permission denied" });
    await expect(removeOwnBoardAssets(client)).resolves.toEqual({ found: 0, removed: 0, error: "permission denied" });
    expect(calls.removed).toEqual([]);
  });
});

describe("deleteOwnAccount", () => {
  it("removes assets first, then calls the RPC", async () => {
    const { client, calls } = fakeClient({ rows: [{ object_path: "u/b/1.png" }] });
    await expect(deleteOwnAccount(client)).resolves.toEqual({ assets: { found: 1, removed: 1, error: null } });
    expect(calls.removed).toHaveLength(1);
    expect(calls.rpc).toEqual(["delete_own_account"]);
  });

  it("still calls the RPC when asset removal fails, and throws the RPC error", async () => {
    const { client, calls } = fakeClient({ rows: [{ object_path: "u/b/1.png" }], removeError: () => "storage down", rpcError: "not authenticated" });
    await expect(deleteOwnAccount(client)).rejects.toEqual({ message: "not authenticated" });
    expect(calls.rpc).toEqual(["delete_own_account"]);
  });
});
