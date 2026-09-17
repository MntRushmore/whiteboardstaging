import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSET_COPY } from "@/components/live/copy";
import {
  MAX_PREVIEW_LENGTH,
  blockedMessageFor,
  classifySaveError,
  measureSnapshot,
  resetInlineAssetFallbackWarning,
  runSnapshotSave,
  singleFlight,
  warnInlineAssetFallbackOnce,
  type SaveUpdate,
  type SnapshotSaveDeps,
} from "../useSnapshotSave";
import type { SaveDecision, SaveDecisionInput } from "@/lib/assets/savePolicy";
import { SNAPSHOT_LIMITS } from "../../../scripts/lib/snapshotAssets.mjs";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
// keep pino off stdout; the runner's console.* calls are spied below
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

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
