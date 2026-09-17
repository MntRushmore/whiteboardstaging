import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSET_COPY } from "@/components/live/copy";
import {
  MAX_PREVIEW_LENGTH,
  SAVE_COPY,
  blockedMessageFor,
  blockedMessageForSync,
  buildSnapshotUpdate,
  classifySaveError,
  idleSyncState,
  isNetworkFailure,
  measureSnapshot,
  persistErrorResult,
  persistResultFromThrown,
  resetInlineAssetFallbackWarning,
  resolvePersistResult,
  runSnapshotSave,
  singleFlight,
  storeSnapshotOf,
  toBuildResult,
  warnInlineAssetFallbackOnce,
  type SaveUpdate,
  type SnapshotSaveDeps,
} from "../useSnapshotSave";
import type { SyncState } from "@/lib/sync";
import type { SaveDecision, SaveDecisionInput } from "@/lib/assets/savePolicy";
import { SNAPSHOT_LIMITS } from "../../../scripts/lib/snapshotAssets.mjs";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
// keep pino off stdout; the runner's console.* calls are spied below
vi.mock("@/lib/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function asset(id: string, src: string) {
  return {
    id,
    typeName: "asset",
    type: "image",
    props: { name: `${id}.png`, src, w: 1, h: 1, mimeType: "image/png", isAnimated: false },
    meta: {},
  };
}

function editorSnapshot(assets: Array<ReturnType<typeof asset>>) {
  const store: Record<string, unknown> = { "document:document": { id: "document:document", typeName: "document" } };
  for (const a of assets) store[a.id] = a;
  return { document: { store, schema: { schemaVersion: 2 } }, session: {} };
}

type Persisted = { update: SaveUpdate };

const ok = (action: SaveDecision["action"], level: SaveDecision["level"] = "ok"): SaveDecision => ({
  action,
  level,
  reason: `test:${action}`,
});

function fakeDeps(over: Partial<SnapshotSaveDeps> = {}) {
  const persisted: Persisted[] = [];
  let snapshot: unknown = editorSnapshot([asset("asset:inline", PNG_1x1)]);
  const deps: SnapshotSaveDeps & { persisted: Persisted[]; setSnapshot: (s: unknown) => void } = {
    boardId: "board-1",
    isOnline: () => true,
    takeSnapshot: () => snapshot,
    offload: vi.fn(async () => {
      // the offload rewrites the store: the next snapshot has an https src
      snapshot = editorSnapshot([asset("asset:inline", "https://x.test/storage/v1/object/public/board-assets/u/b/inline.png")]);
    }),
    makePreview: async () => "data:image/jpeg;base64,AAAA",
    persist: vi.fn(async (update: SaveUpdate) => {
      persisted.push({ update });
      return { error: null, rowCount: 1 };
    }),
    decide: () => ok("save"),
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    persisted,
    setSnapshot: (s) => {
      snapshot = s;
    },
    ...over,
  };
  return deps;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  resetInlineAssetFallbackWarning();
});

describe("classifySaveError", () => {
  it("maps statement timeouts (57014 or message) to timeout", () => {
    expect(classifySaveError({ code: "57014", message: "canceling statement" })).toBe("timeout");
    expect(classifySaveError({ code: null, message: "canceling statement due to statement timeout" })).toBe("timeout");
  });

  it("maps a check-constraint violation (23514) to too-large", () => {
    expect(classifySaveError({ code: "23514", message: 'new row violates check constraint "whiteboards_data_size"' })).toBe(
      "too-large",
    );
  });

  it("everything else is other", () => {
    expect(classifySaveError({ code: "42501", message: "permission denied" })).toBe("other");
    expect(classifySaveError(null)).toBe("other");
    expect(classifySaveError({})).toBe("other");
  });
});

describe("measureSnapshot", () => {
  it("reports JSON bytes and the number of inline data: assets", () => {
    const snap = editorSnapshot([asset("asset:a", PNG_1x1), asset("asset:b", "https://cdn.test/b.png")]);
    const m = measureSnapshot(snap);
    expect(m.inlineAssets).toBe(1);
    expect(m.bytes).toBe(Buffer.byteLength(JSON.stringify(snap), "utf8"));
  });
});

describe("runSnapshotSave", () => {
  it("skips while offline without touching Supabase", async () => {
    const deps = fakeDeps({ isOnline: () => false });
    expect(await runSnapshotSave(deps)).toEqual({ kind: "skipped", reason: "offline" });
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("'save' writes the serialized snapshot, updated_at and the preview", async () => {
    const deps = fakeDeps();
    const outcome = await runSnapshotSave(deps);
    expect(outcome.kind).toBe("saved");
    expect(deps.offload).not.toHaveBeenCalled();
    expect(deps.persisted).toHaveLength(1);
    const update = deps.persisted[0].update;
    expect(update.updated_at).toBe("2026-09-17T10:00:00.000Z");
    expect(update.preview).toBe("data:image/jpeg;base64,AAAA");
    // payload is a JSON round-trip of the snapshot (what Supabase receives)
    expect(update.data).toEqual(deps.takeSnapshot());
  });

  it("drops an oversized preview but still saves", async () => {
    const deps = fakeDeps({ makePreview: async () => "x".repeat(MAX_PREVIEW_LENGTH + 1) });
    expect((await runSnapshotSave(deps)).kind).toBe("saved");
    expect(deps.persisted[0].update.preview).toBeUndefined();
  });

  it("continues without a preview when thumbnail generation throws", async () => {
    const deps = fakeDeps({
      makePreview: async () => {
        throw new Error("canvas exploded");
      },
    });
    expect((await runSnapshotSave(deps)).kind).toBe("saved");
    expect(deps.persisted[0].update.preview).toBeUndefined();
  });

  it("'offload-then-save' offloads once, re-snapshots and saves the rewritten data", async () => {
    const deps = fakeDeps({ decide: ({ inlineAssets }) => ok(inlineAssets > 0 ? "offload-then-save" : "save", "warn") });
    const outcome = await runSnapshotSave(deps);
    expect(outcome).toMatchObject({ kind: "saved", offloaded: true });
    expect(deps.offload).toHaveBeenCalledTimes(1);
    const saved = deps.persisted[0].update.data as ReturnType<typeof editorSnapshot>;
    const rec = saved.document.store["asset:inline"] as ReturnType<typeof asset>;
    expect(rec.props.src.startsWith("https://")).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("data:image");
  });

  it("still saves when the offload itself fails", async () => {
    const deps = fakeDeps({
      decide: () => ok("offload-then-save", "error"),
      offload: vi.fn(async () => {
        throw new Error("storage 403");
      }),
    });
    const outcome = await runSnapshotSave(deps);
    expect(outcome).toMatchObject({ kind: "saved", offloaded: false });
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it("refuses after the offload when the snapshot is still over the hard limit", async () => {
    const tooBig = SNAPSHOT_LIMITS.hardBytes + 1;
    const deps = fakeDeps({
      decide: () => ok("offload-then-save", "error"),
      // the offload could not shrink the board (uploads failed / bulk is not inline images)
      offload: vi.fn(async () => {}),
      measure: () => ({ bytes: tooBig, inlineAssets: 3 }),
    });
    const outcome = await runSnapshotSave(deps);
    expect(outcome).toEqual({ kind: "refused", bytes: tooBig, inlineAssets: 3 });
    expect(deps.offload).toHaveBeenCalledTimes(1);
    expect(deps.persist).not.toHaveBeenCalled();
    expect(blockedMessageFor(outcome, null)).toBe(ASSET_COPY.boardTooLarge);
  });

  it("saves after the offload when it brought the snapshot back under the hard limit", async () => {
    let calls = 0;
    const deps = fakeDeps({
      decide: () => ok("offload-then-save", "error"),
      measure: () => (calls++ === 0 ? { bytes: SNAPSHOT_LIMITS.hardBytes + 1, inlineAssets: 1 } : { bytes: 1000, inlineAssets: 0 }),
    });
    const outcome = await runSnapshotSave(deps);
    expect(outcome).toMatchObject({ kind: "saved", offloaded: true, bytes: 1000 });
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  it("'refuse' never calls Supabase and reports the measurement", async () => {
    const deps = fakeDeps({ decide: () => ok("refuse", "error") });
    const outcome = await runSnapshotSave(deps);
    expect(outcome).toMatchObject({ kind: "refused", inlineAssets: 1 });
    expect((outcome as { bytes: number }).bytes).toBeGreaterThan(0);
    expect(deps.persist).not.toHaveBeenCalled();
    expect(deps.offload).not.toHaveBeenCalled();
  });

  it("feeds the real measurement plus the offload flag into the decision", async () => {
    const seen: SaveDecisionInput[] = [];
    const deps = fakeDeps({
      isOffloadInFlight: () => true,
      decide: (m) => {
        seen.push(m);
        return ok("save");
      },
    });
    await runSnapshotSave(deps);
    expect(seen).toEqual([{ ...measureSnapshot(deps.takeSnapshot()), offloadInFlight: true }]);
  });

  it("uses the shared decideSave policy by default (small board -> plain save)", async () => {
    const deps = fakeDeps({ decide: undefined });
    expect((await runSnapshotSave(deps)).kind).toBe("saved");
    expect(deps.offload).not.toHaveBeenCalled();
  });

  it("maps a 57014 from Supabase to a quiet timeout outcome", async () => {
    const deps = fakeDeps({
      persist: async () => ({ error: { code: "57014", message: "canceling statement due to statement timeout" }, rowCount: 0 }),
    });
    expect(await runSnapshotSave(deps)).toEqual({ kind: "timeout" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("maps a 23514 from Supabase to too-large", async () => {
    const deps = fakeDeps({
      persist: async () => ({ error: { code: "23514", message: "new row violates check constraint" }, rowCount: 0 }),
    });
    expect(await runSnapshotSave(deps)).toEqual({ kind: "too-large" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs and returns error for any other Supabase failure", async () => {
    const deps = fakeDeps({ persist: async () => ({ error: { code: "42501", message: "permission denied" }, rowCount: 0 }) });
    const outcome = await runSnapshotSave(deps);
    expect(outcome.kind).toBe("error");
    expect((outcome as { error: Error }).error.message).toContain("42501");
    expect(console.error).toHaveBeenCalled();
  });

  it("skips when the editor yields no snapshot or an unserializable one", async () => {
    expect(await runSnapshotSave(fakeDeps({ takeSnapshot: () => null }))).toEqual({ kind: "skipped", reason: "no-snapshot" });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(await runSnapshotSave(fakeDeps({ takeSnapshot: () => cyclic }))).toEqual({
      kind: "skipped",
      reason: "unserializable",
    });
  });
});

describe("blockedMessageFor", () => {
  it("shows the too-large badge on refuse/23514 and clears it on the next save", () => {
    expect(blockedMessageFor({ kind: "refused", bytes: 1, inlineAssets: 0 }, null)).toBe(ASSET_COPY.boardTooLarge);
    expect(blockedMessageFor({ kind: "too-large" }, null)).toBe(ASSET_COPY.boardTooLarge);
    expect(blockedMessageFor({ kind: "saved", bytes: 1, offloaded: false }, ASSET_COPY.boardTooLarge)).toBeNull();
  });

  it("keeps the previous state on offline/timeout/other errors", () => {
    for (const outcome of [
      { kind: "skipped", reason: "offline" } as const,
      { kind: "timeout" } as const,
      { kind: "error", error: new Error("x") } as const,
    ]) {
      expect(blockedMessageFor(outcome, ASSET_COPY.boardTooLarge)).toBe(ASSET_COPY.boardTooLarge);
      expect(blockedMessageFor(outcome, null)).toBeNull();
    }
  });
});

describe("singleFlight", () => {
  it("shares one in-flight promise and allows a fresh run afterwards", async () => {
    let resolve!: (v: number) => void;
    let calls = 0;
    const flight = singleFlight(
      () =>
        new Promise<number>((r) => {
          calls += 1;
          resolve = r;
        }),
    );
    expect(flight.isRunning()).toBe(false);
    const a = flight.run();
    const b = flight.run();
    expect(a).toBe(b);
    expect(flight.isRunning()).toBe(true);
    resolve(1);
    expect(await a).toBe(1);
    expect(flight.isRunning()).toBe(false);
    expect(calls).toBe(1);
    const c = flight.run();
    expect(c).not.toBe(a);
    resolve(2);
    expect(await c).toBe(2);
    expect(calls).toBe(2);
  });
});

describe("warnInlineAssetFallbackOnce", () => {
  it("toasts only once per page load", async () => {
    const { toast } = await import("sonner");
    expect(warnInlineAssetFallbackOnce()).toBe(true);
    expect(warnInlineAssetFallbackOnce()).toBe(false);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(ASSET_COPY.inlineFallback);
  });
});

describe("buildSnapshotUpdate", () => {
  it("returns the row update plus the snapshot it was built from, without persisting", async () => {
    const deps = fakeDeps();
    const built = await buildSnapshotUpdate(deps);
    expect(built.kind).toBe("update");
    if (built.kind !== "update") return;
    expect(built.update.updated_at).toBe("2026-09-17T10:00:00.000Z");
    expect(built.update.preview).toBe("data:image/jpeg;base64,AAAA");
    expect(built.update.data).toEqual(deps.takeSnapshot());
    expect(built.snapshot).toEqual(deps.takeSnapshot());
    expect(built.offloaded).toBe(false);
    expect(built.bytes).toBe(measureSnapshot(deps.takeSnapshot()).bytes);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("does not consult isOnline: the queue decides that before building", async () => {
    const deps = fakeDeps({ isOnline: () => false });
    expect((await buildSnapshotUpdate(deps)).kind).toBe("update");
  });

  it("refuses over the hard limit and reports skipped for a missing snapshot", async () => {
    expect(await buildSnapshotUpdate(fakeDeps({ decide: () => ok("refuse", "error") }))).toMatchObject({
      kind: "refused",
      inlineAssets: 1,
    });
    expect(await buildSnapshotUpdate(fakeDeps({ takeSnapshot: () => undefined }))).toEqual({
      kind: "skipped",
      reason: "no-snapshot",
    });
  });

  it("offloads then re-snapshots (the update carries the rewritten data)", async () => {
    const deps = fakeDeps({ decide: ({ inlineAssets }) => ok(inlineAssets > 0 ? "offload-then-save" : "save", "warn") });
    const built = await buildSnapshotUpdate(deps);
    expect(built).toMatchObject({ kind: "update", offloaded: true });
    expect(JSON.stringify((built as { update: SaveUpdate }).update.data)).not.toContain("data:image");
  });

  it("never throws: a crashing takeSnapshot becomes an error outcome", async () => {
    const built = await buildSnapshotUpdate(
      fakeDeps({
        takeSnapshot: () => {
          throw new Error("store gone");
        },
      }),
    );
    expect(built.kind).toBe("error");
  });
});

describe("toBuildResult / storeSnapshotOf", () => {
  it("hands the queue the document half of an editor snapshot", () => {
    const editorSnap = editorSnapshot([]);
    const built = { kind: "update", update: { data: editorSnap, updated_at: "t" }, snapshot: editorSnap, bytes: 1, offloaded: false } as const;
    const result = toBuildResult(built);
    expect(result.kind).toBe("update");
    if (result.kind !== "update") return;
    expect(result.snapshot).toBe(editorSnap.document);
    // the row still stores the full editor snapshot (format unchanged)
    expect(result.update.data).toBe(editorSnap);
  });

  it("passes a bare store snapshot through unchanged", () => {
    const bare = { store: {}, schema: { schemaVersion: 2 } };
    expect(storeSnapshotOf(bare)).toBe(bare);
    expect(storeSnapshotOf(null)).toBeNull();
  });

  it("maps refused to the too-large copy and skipped/error to the cannot-prepare copy", () => {
    expect(toBuildResult({ kind: "refused", bytes: 1, inlineAssets: 0 })).toEqual({
      kind: "refused",
      message: ASSET_COPY.boardTooLarge,
    });
    expect(toBuildResult({ kind: "skipped", reason: "unserializable" })).toEqual({
      kind: "refused",
      message: SAVE_COPY.cannotPrepare,
    });
    expect(toBuildResult({ kind: "error", error: new Error("x") })).toEqual({
      kind: "refused",
      message: SAVE_COPY.cannotPrepare,
    });
  });
});

describe("isNetworkFailure", () => {
  it("recognises fetch TypeErrors, supabase-js wrapped fetch failures and PGRST0xx", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure({ message: "TypeError: Failed to fetch", details: "TypeError: Failed to fetch", hint: "", code: "" })).toBe(true);
    expect(isNetworkFailure({ name: "TypeError", message: "Load failed" })).toBe(true);
    expect(isNetworkFailure({ code: "PGRST000", message: "could not connect to the database" })).toBe(true);
    expect(isNetworkFailure({ code: "PGRST003", message: "timed out acquiring connection" })).toBe(true);
  });

  it("does not treat request-level errors as network problems", () => {
    expect(isNetworkFailure({ code: "PGRST301", message: "JWT expired" })).toBe(false);
    expect(isNetworkFailure({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" })).toBe(false);
    expect(isNetworkFailure({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isNetworkFailure(new Error("boom"))).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure("string")).toBe(false);
  });
});

describe("persistErrorResult / persistResultFromThrown", () => {
  it("maps 57014 to timeout and 23514 to too-large", () => {
    expect(persistErrorResult({ code: "57014", message: "canceling statement due to statement timeout" }, true)).toEqual({
      ok: false,
      kind: "timeout",
    });
    expect(persistErrorResult({ code: "23514", message: "violates check constraint" }, true)).toEqual({
      ok: false,
      kind: "too-large",
    });
  });

  it("maps transport failures and navigator.onLine === false to offline", () => {
    expect(persistErrorResult({ code: "", message: "TypeError: Failed to fetch" }, true)).toEqual({ ok: false, kind: "offline" });
    expect(persistErrorResult({ code: "42501", message: "permission denied" }, false)).toEqual({ ok: false, kind: "offline" });
    expect(persistResultFromThrown(new TypeError("Failed to fetch"), true)).toEqual({ ok: false, kind: "offline" });
    expect(persistResultFromThrown(new Error("anything"), false)).toEqual({ ok: false, kind: "offline" });
  });

  it("everything else is other, with the message and code kept", () => {
    expect(persistErrorResult({ code: "42501", message: "permission denied" }, true)).toEqual({
      ok: false,
      kind: "other",
      message: "permission denied (code: 42501)",
    });
    expect(persistErrorResult({}, true)).toEqual({ ok: false, kind: "other", message: "Unknown error" });
    expect(persistResultFromThrown(new Error("bug"), true)).toEqual({ ok: false, kind: "other", message: "bug" });
    expect(persistResultFromThrown("weird", true)).toEqual({ ok: false, kind: "other", message: "weird" });
  });
});

describe("resolvePersistResult", () => {
  const ctx = (over: Partial<Parameters<typeof resolvePersistResult>[1]> = {}) => ({
    expectedVersion: 7 as number | null,
    online: true,
    exists: async () => true,
    ...over,
  });

  it("returns the version the trigger bumped to", async () => {
    expect(await resolvePersistResult({ error: null, rows: [{ version: 8 }] }, ctx())).toEqual({ ok: true, version: 8 });
    // PostgREST may serialize bigint as a string in some configurations
    expect(await resolvePersistResult({ error: null, rows: [{ version: "9" }] }, ctx())).toEqual({ ok: true, version: 9 });
  });

  it("zero rows with a version filter -> conflict when the row still exists, gone when it does not", async () => {
    expect(await resolvePersistResult({ error: null, rows: [] }, ctx())).toEqual({ ok: false, kind: "conflict" });
    expect(await resolvePersistResult({ error: null, rows: [] }, ctx({ exists: async () => false }))).toEqual({
      ok: false,
      kind: "gone",
    });
    expect(await resolvePersistResult({ error: null, rows: null }, ctx())).toEqual({ ok: false, kind: "conflict" });
  });

  it("zero rows without a version filter can only mean the row is gone (no existence probe)", async () => {
    const exists = vi.fn(async () => true);
    expect(await resolvePersistResult({ error: null, rows: [] }, ctx({ expectedVersion: null, exists }))).toEqual({
      ok: false,
      kind: "gone",
    });
    expect(exists).not.toHaveBeenCalled();
  });

  it("a failing existence probe is treated as a conflict so the queue re-fetches", async () => {
    expect(
      await resolvePersistResult(
        { error: null, rows: [] },
        ctx({
          exists: async () => {
            throw new TypeError("Failed to fetch");
          },
        }),
      ),
    ).toEqual({ ok: false, kind: "conflict" });
  });

  it("errors take precedence over rows and go through the error mapping", async () => {
    expect(await resolvePersistResult({ error: { code: "57014", message: "statement timeout" }, rows: null }, ctx())).toEqual({
      ok: false,
      kind: "timeout",
    });
    expect(await resolvePersistResult({ error: { code: "42501", message: "denied" }, rows: null }, ctx({ online: false }))).toEqual({
      ok: false,
      kind: "offline",
    });
  });

  it("a row without a version is reported instead of pretending success", async () => {
    expect(await resolvePersistResult({ error: null, rows: [{}] }, ctx())).toMatchObject({ ok: false, kind: "other" });
  });
});

describe("blockedMessageForSync / idleSyncState", () => {
  const base: SyncState = { status: "saved", message: null, lastSavedAt: null, version: 3, pending: false, attempt: 0 };

  it("only refused blocks; the queue's message wins over the default copy", () => {
    expect(blockedMessageForSync({ ...base, status: "refused", message: null })).toBe(ASSET_COPY.boardTooLarge);
    expect(blockedMessageForSync({ ...base, status: "refused", message: SAVE_COPY.cannotPrepare })).toBe(SAVE_COPY.cannotPrepare);
    for (const status of ["saved", "dirty", "saving", "offline", "merging", "error"] as const) {
      expect(blockedMessageForSync({ ...base, status, message: "x" })).toBeNull();
    }
  });

  it("idle state carries the loaded version and no lastSavedAt", () => {
    expect(idleSyncState(42)).toEqual({ status: "saved", message: null, lastSavedAt: null, version: 42, pending: false, attempt: 0 });
    expect(idleSyncState(null).version).toBeNull();
  });
});
