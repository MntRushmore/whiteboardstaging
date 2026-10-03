import { describe, expect, it } from "vitest";
import {
  BOARD_ASSETS_BUCKET,
  PLAN_STILL_ACTIVE_HINT,
  PlanStillActiveError,
  REMOVE_BATCH_SIZE,
  clearLocalSession,
  deleteOwnAccount,
  isPlanStillActiveError,
  planBlocksDeletion,
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
  /** the RPC's refusal as PostgREST sends it (code, message, hint) */
  rpcErrorBody?: { message: string; code?: string; hint?: string };
  /** the caller's unlimited_subscriptions rows (RLS: own rows) */
  plan?: Array<Record<string, unknown>>;
  planError?: string;
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
    from: (table) => ({
      select: () => {
        if (table === "unlimited_subscriptions") {
          calls.order.push("plan");
          return Promise.resolve(opts.planError ? { data: null, error: { message: opts.planError } } : { data: opts.plan ?? [], error: null });
        }
        return Promise.resolve(
          opts.selectError ? { data: null, error: { message: opts.selectError } } : { data: opts.rows ?? [], error: null },
        );
      },
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
      return Promise.resolve({ data: null, error: opts.rpcErrorBody ?? (opts.rpcError ? { message: opts.rpcError } : null) });
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
    expect(calls.order).toEqual(["plan", "remove", "rpc", "signOut:local"]);
    expect(calls.rpc).toEqual(["delete_own_account"]);
    expect([...storage.data.keys()]).toEqual(["theme"]);
  });

  it("works without any storage (SSR / blocked) and still settles the client", async () => {
    const { client, calls } = fakeClient({ rows: [] });
    await expect(deleteOwnAccount(client, { storage: null })).resolves.toEqual({
      assets: { found: 0, removed: 0, error: null },
      clearedKeys: [],
    });
    expect(calls.order).toEqual(["plan", "rpc", "signOut:local"]);
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
    expect(calls.order).toEqual(["plan", "remove", "rpc"]);
    expect(storage.removed).toEqual([]);
    expect(storage.data.has("sb-abc-auth-token")).toBe(true);
  });

  describe("Agathon Unlimited: the plan is cancelled first", () => {
    it("refuses while the plan would charge again, before ANY image is removed or the RPC is called", async () => {
      for (const status of ["trialing", "active", "past_due", "unpaid"]) {
        const { client, calls } = fakeClient({ rows: [{ object_path: "u/b/1.png" }], plan: [{ status, cancel_at_period_end: false, cancel_at: null }] });
        const err = await deleteOwnAccount(client, { storage: null }).catch((e: unknown) => e);
        expect(err, status).toBeInstanceOf(PlanStillActiveError);
        expect(isPlanStillActiveError(err)).toBe(true);
        expect(calls.order, status).toEqual(["plan"]);
        expect(calls.removed).toEqual([]);
      }
    });

    it("goes ahead once the plan is set to cancel, or has ended, or never started", async () => {
      for (const plan of [
        [{ status: "trialing", cancel_at_period_end: true, cancel_at: null }],
        [{ status: "active", cancel_at_period_end: false, cancel_at: "2026-11-10T00:00:00Z" }],
        [{ status: "canceled", cancel_at_period_end: false, cancel_at: null }],
        [{ status: "incomplete_expired" }, { status: "paused" }, { status: null }],
        [],
      ]) {
        const { client, calls } = fakeClient({ rows: [], plan });
        await deleteOwnAccount(client, { storage: null });
        expect(calls.order, JSON.stringify(plan)).toEqual(["plan", "rpc", "signOut:local"]);
      }
    });

    it("never deletes unchecked: a failed plan read stops it; a database without the plan's table does not", async () => {
      const failed = fakeClient({ rows: [{ object_path: "u/b/1.png" }], planError: "JWT expired" });
      await expect(deleteOwnAccount(failed.client, { storage: null })).rejects.toEqual({ message: "JWT expired" });
      expect(failed.calls.order).toEqual(["plan"]);
      const older = fakeClient({ rows: [], planError: "Could not find the table 'public.unlimited_subscriptions' in the schema cache" });
      await deleteOwnAccount(older.client, { storage: null });
      expect(older.calls.order).toEqual(["plan", "rpc", "signOut:local"]);
    });

    it("the database's own refusal (a plan started in another tab meanwhile) comes back as PlanStillActiveError, session kept", async () => {
      const { client } = fakeClient({ rows: [], rpcErrorBody: { code: "P0001", message: "Cancel Agathon Unlimited before deleting your account", hint: PLAN_STILL_ACTIVE_HINT } });
      const storage = fakeStorage({ "sb-abc-auth-token": "{}" });
      await expect(deleteOwnAccount(client, { storage })).rejects.toBeInstanceOf(PlanStillActiveError);
      expect(storage.removed).toEqual([]);
    });

    it("planBlocksDeletion is delete_own_account()'s rule", () => {
      expect(planBlocksDeletion([{ status: "trialing", cancel_at_period_end: false, cancel_at: null }])).toBe(true);
      expect(planBlocksDeletion([{ status: "canceled" }, { status: "active" }])).toBe(true);
      expect(planBlocksDeletion([{ status: "active", cancel_at_period_end: true }])).toBe(false);
      expect(planBlocksDeletion(null)).toBe(false);
      expect(isPlanStillActiveError({ hint: "something_else" })).toBe(false);
      expect(isPlanStillActiveError(new Error("x"))).toBe(false);
    });
  });
});
