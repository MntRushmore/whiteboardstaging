import { describe, expect, it } from "vitest";
import {
  BOARD_ASSETS_BUCKET,
  REMOVE_BATCH_SIZE,
  clearLocalSession,
  deleteOwnAccount,
  readStorageKey,
  removeOwnBoardAssets,
  selectAuthStorageKeys,
  type DeleteAccountClient,
  type KeyValueStorage,
} from "@/lib/billing/deleteAccount";

/** Ordered log of every side effect so tests can assert sequencing. */
type Calls = { removed: string[][]; buckets: string[]; rpc: string[]; order: string[] };

function fakeStorage(initial: Record<string, string>): KeyValueStorage & { data: Map<string, string>; removed: string[] } {
  const data = new Map(Object.entries(initial));
  const removed: string[] = [];
  return {
    data,
    removed,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => {
      removed.push(k);
      data.delete(k);
    },
  };
}

function fakeClient(opts: {
  rows?: Array<{ object_path: string | null }> | null;
  selectError?: string;
  removeError?: (batch: string[]) => string | null;
  rpcError?: string;
  storageKey?: string;
  signOutError?: string;
}): { client: DeleteAccountClient; calls: Calls } {
  const calls: Calls = { removed: [], buckets: [], rpc: [], order: [] };
  const client: DeleteAccountClient & { storageKey?: string } = {
    storageKey: opts.storageKey,
    auth: {
      signOut: (o: { scope: "local" }) => {
        calls.order.push(`signOut:${o.scope}`);
        if (opts.signOutError) return Promise.reject(new Error(opts.signOutError));
        return Promise.resolve({ error: null });
      },
      getSession: () => {
        calls.order.push("getSession");
        return Promise.resolve({ data: { session: null }, error: null });
      },
    },
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
            calls.order.push("remove");
            const msg = opts.removeError?.(paths) ?? null;
            return Promise.resolve({ data: null, error: msg ? { message: msg } : null });
          },
        };
      },
    },
    rpc: (fn) => {
      calls.rpc.push(fn);
      calls.order.push("rpc");
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

describe("selectAuthStorageKeys", () => {
  const keys = [
    "theme",
    "sb-abc-auth-token",
    "sb-abc-auth-token-code-verifier",
    "sb-abc-auth-token-user",
    "sb-other-auth-token",
    "custom-key",
    "custom-key-user",
    "custom-key-code-verifier",
    "custom-key-extra",
    "prefix-sb-abc-auth-token",
  ];

  it("selects exactly the client's storage key and its auth-js companions when known", () => {
    expect(selectAuthStorageKeys(keys, "custom-key")).toEqual(["custom-key", "custom-key-user", "custom-key-code-verifier"]);
    expect(selectAuthStorageKeys(keys, "sb-abc-auth-token")).toEqual([
      "sb-abc-auth-token",
      "sb-abc-auth-token-code-verifier",
      "sb-abc-auth-token-user",
    ]);
  });

  it("falls back to every sb-*-auth-token* key when the storage key is unknown", () => {
    const expected = ["sb-abc-auth-token", "sb-abc-auth-token-code-verifier", "sb-abc-auth-token-user", "sb-other-auth-token"];
    expect(selectAuthStorageKeys(keys)).toEqual(expected);
    expect(selectAuthStorageKeys(keys, null)).toEqual(expected);
    expect(selectAuthStorageKeys(keys, "")).toEqual(expected);
  });

  it("returns nothing for an empty or unrelated key list", () => {
    expect(selectAuthStorageKeys([])).toEqual([]);
    expect(selectAuthStorageKeys(["theme", "draft"], "sb-abc-auth-token")).toEqual([]);
  });
});

describe("readStorageKey", () => {
  it("reads a non-empty string storageKey and ignores anything else", () => {
    expect(readStorageKey({ storageKey: "sb-abc-auth-token" })).toBe("sb-abc-auth-token");
    expect(readStorageKey({ storageKey: "" })).toBeNull();
    expect(readStorageKey({ storageKey: 42 })).toBeNull();
    expect(readStorageKey({})).toBeNull();
  });
});

describe("clearLocalSession", () => {
  it("removes the session keys and then signs out locally, without throwing", async () => {
    const { client, calls } = fakeClient({ storageKey: "sb-abc-auth-token" });
    const storage = fakeStorage({ "sb-abc-auth-token": "{}", "sb-abc-auth-token-user": "{}", theme: "dark" });
    await expect(clearLocalSession(client, storage)).resolves.toEqual(["sb-abc-auth-token", "sb-abc-auth-token-user"]);
    expect([...storage.data.keys()]).toEqual(["theme"]);
    // Keys are dropped BEFORE the sign-out, so auth-js finds no access token and never
    // posts to /auth/v1/logout — but it still emits SIGNED_OUT for AuthProvider.
    expect(calls.order).toEqual(["signOut:local"]);
  });

  it("still settles the client when storage is unavailable or throws", async () => {
    const { client, calls } = fakeClient({});
    await expect(clearLocalSession(client, null)).resolves.toEqual([]);
    const broken: KeyValueStorage = {
      get length(): number {
        throw new Error("blocked");
      },
      key: () => null,
      removeItem: () => undefined,
    };
    await expect(clearLocalSession(client, broken)).resolves.toEqual([]);
    expect(calls.order).toEqual(["signOut:local", "signOut:local"]);
  });

  it("falls back to getSession when signOut throws", async () => {
    const { client, calls } = fakeClient({ signOutError: "boom" });
    await expect(clearLocalSession(client, fakeStorage({}))).resolves.toEqual([]);
    expect(calls.order).toEqual(["signOut:local", "getSession"]);
  });

  it("swallows a failure from both settle paths", async () => {
    const client = {
      auth: {
        signOut: () => Promise.reject(new Error("boom")),
        getSession: () => Promise.reject(new Error("boom")),
      },
    };
    await expect(clearLocalSession(client, fakeStorage({}))).resolves.toEqual([]);
  });
});

describe("deleteOwnAccount", () => {
  it("removes assets, then calls the RPC, then clears the local session", async () => {
    const { client, calls } = fakeClient({ rows: [{ object_path: "u/b/1.png" }], storageKey: "sb-abc-auth-token" });
    const storage = fakeStorage({ "sb-abc-auth-token": "{}", "sb-abc-auth-token-code-verifier": "x", theme: "dark" });
    await expect(deleteOwnAccount(client, { storage })).resolves.toEqual({
      assets: { found: 1, removed: 1, error: null },
      clearedKeys: ["sb-abc-auth-token", "sb-abc-auth-token-code-verifier"],
    });
    expect(calls.order).toEqual(["remove", "rpc", "signOut:local"]);
    expect(calls.rpc).toEqual(["delete_own_account"]);
    expect([...storage.data.keys()]).toEqual(["theme"]);
  });

  it("works without any storage (SSR / blocked) and still settles the client", async () => {
    const { client, calls } = fakeClient({ rows: [] });
    await expect(deleteOwnAccount(client, { storage: null })).resolves.toEqual({
      assets: { found: 0, removed: 0, error: null },
      clearedKeys: [],
    });
    expect(calls.order).toEqual(["rpc", "signOut:local"]);
  });

  it("still calls the RPC when asset removal fails, throws the RPC error and keeps the session", async () => {
    const { client, calls } = fakeClient({
      rows: [{ object_path: "u/b/1.png" }],
      removeError: () => "storage down",
      rpcError: "not authenticated",
      storageKey: "sb-abc-auth-token",
    });
    const storage = fakeStorage({ "sb-abc-auth-token": "{}" });
    await expect(deleteOwnAccount(client, { storage })).rejects.toEqual({ message: "not authenticated" });
    expect(calls.order).toEqual(["remove", "rpc"]);
    expect(storage.removed).toEqual([]);
    expect(storage.data.has("sb-abc-auth-token")).toBe(true);
  });
});
