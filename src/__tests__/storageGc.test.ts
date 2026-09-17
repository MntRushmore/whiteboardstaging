/**
 * Storage GC: pure planning (scripts/lib/storageGc.mjs), the fetch-level client,
 * the runGc orchestration over a fake client, the CLI flag parser, and the
 * /api/admin/gc handler with faked env + runner. No network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

import {
  BOARD_ASSETS_BUCKET,
  DEFAULT_MIN_AGE_MS,
  TRAINING_DATA_BUCKET,
  assetSrcsOf,
  chunk,
  createGcClient,
  formatGcSummary,
  objectPathFromRef,
  planGc,
  referencedPaths,
  runGc,
  type GcClient,
  type GcObject,
  type GcSummary,
} from "../../scripts/lib/storageGc.mjs";
import { parseArgs } from "../../scripts/gc-storage.mjs";
import { createGcHandler, isDryRun, isCronRequest, type GcDeps } from "@/app/api/admin/gc/route";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { bearerMatches, readCronSecret, toResponseBody } from "@/lib/server/storageGc";

const UID = "11111111-1111-4111-8111-111111111111";
const BOARD = "aaaaaaaa-0000-4000-8000-000000000001";
const ORIGIN = "https://proj.supabase.co";
const NOW = Date.parse("2026-09-17T12:00:00Z");
const HOUR = 3_600_000;

function obj(bucket: string, name: string, ageHours: number, size = 1000): GcObject {
  return { bucket, name, created_at: new Date(NOW - ageHours * HOUR).toISOString(), size };
}

function publicUrl(path: string, bucket: string = BOARD_ASSETS_BUCKET) {
  return `${ORIGIN}/storage/v1/object/public/${bucket}/${path}`;
}

function snapshot(srcs: string[]) {
  const store: Record<string, unknown> = { "document:document": { id: "document:document", typeName: "document" } };
  srcs.forEach((src, i) => {
    store[`asset:a${i}`] = { id: `asset:a${i}`, typeName: "asset", type: "image", props: { src, name: `a${i}.png`, mimeType: "image/png", w: 1, h: 1 }, meta: {} };
  });
  return { document: { store, schema: { v: 2 } }, session: { currentPageId: "page:page" } };
}

/* ------------------------------------------------------------------------- */
/* planGc                                                                    */
/* ------------------------------------------------------------------------- */

describe("planGc", () => {
  const registered = `${UID}/${BOARD}/reg.png`;
  const legacy = `${UID}/${BOARD}/legacy.png`;
  const oldOrphan = `${UID}/${BOARD}/gone.png`;
  const youngOrphan = `${UID}/${BOARD}/fresh.png`;
  const sample = `${UID}/s1/before.png`;
  const sampleAfter = `${UID}/s1/after_full.png`;
  const sampleOrphan = `${UID}/s2/before.png`;

  const objects: GcObject[] = [
    obj(BOARD_ASSETS_BUCKET, registered, 48, 100),
    obj(BOARD_ASSETS_BUCKET, legacy, 48, 200),
    obj(BOARD_ASSETS_BUCKET, oldOrphan, 48, 300),
    obj(BOARD_ASSETS_BUCKET, youngOrphan, 1, 400),
    obj(TRAINING_DATA_BUCKET, sample, 48, 500),
    obj(TRAINING_DATA_BUCKET, sampleAfter, 48, 600),
    obj(TRAINING_DATA_BUCKET, sampleOrphan, 48, 700),
  ];
  const input = {
    objects,
    registeredPaths: new Set([registered]),
    referencedUrls: new Set([publicUrl(legacy), "data:image/png;base64,AAAA", "https://cdn.example.com/x.png"]),
    trainingRefs: new Set([sample, publicUrl(sampleAfter, TRAINING_DATA_BUCKET)]),
    now: NOW,
  };

  it("keeps registered, referenced-but-unregistered (legacy) and training-sample objects; collects old orphans; spares young ones", () => {
    const plan = planGc(input);
    expect(plan.scanned).toBe(7);
    expect(plan.orphans.map((o) => o.name).sort()).toEqual([oldOrphan, sampleOrphan].sort());
    expect(plan.orphans.find((o) => o.name === oldOrphan)).toMatchObject({ bucket: BOARD_ASSETS_BUCKET, reason: "unregistered", size: 300 });
    expect(plan.orphans.find((o) => o.name === sampleOrphan)).toMatchObject({ bucket: TRAINING_DATA_BUCKET, reason: "unreferenced", size: 700 });
    expect(plan.bytes).toBe(1000);
    expect(plan.young).toBe(1);
    expect(plan.keep).toBe(5);
  });

  it("minAgeMs 0 collects the young orphan too; a larger minAgeMs spares the old one", () => {
    expect(planGc({ ...input, minAgeMs: 0 }).orphans.map((o) => o.name)).toContain(youngOrphan);
    expect(planGc({ ...input, minAgeMs: 72 * HOUR }).orphans.map((o) => o.name)).not.toContain(oldOrphan);
    expect(planGc({ ...input, minAgeMs: 72 * HOUR }).young).toBe(3);
  });

  it("defaults minAgeMs to 24 h and treats objects without a timestamp as old", () => {
    expect(DEFAULT_MIN_AGE_MS).toBe(24 * HOUR);
    const plan = planGc({ objects: [{ bucket: BOARD_ASSETS_BUCKET, name: "x/y/z.png", created_at: null, size: 5 }], now: NOW });
    expect(plan.orphans).toHaveLength(1);
    const young = planGc({ objects: [obj(BOARD_ASSETS_BUCKET, "x/y/z.png", 23)], now: NOW });
    expect(young.orphans).toHaveLength(0);
    expect(young.young).toBe(1);
  });

  it("never touches objects in unknown buckets and accepts plain iterables for the reference sets", () => {
    const plan = planGc({
      objects: [obj("avatars", "u/a.png", 100), obj(BOARD_ASSETS_BUCKET, registered, 100)],
      registeredPaths: [registered],
      referencedUrls: [],
      now: NOW,
    });
    expect(plan.orphans).toEqual([]);
    expect(plan.keep).toBe(2);
  });

  it("is pure: does not mutate its inputs", () => {
    const copy = structuredClone(objects);
    planGc(input);
    expect(objects).toEqual(copy);
  });
});

describe("reference helpers", () => {
  it("objectPathFromRef extracts the path from public/authenticated/sign URLs of the right bucket only", () => {
    expect(objectPathFromRef(publicUrl("u/b/a.png"), BOARD_ASSETS_BUCKET)).toBe("u/b/a.png");
    expect(objectPathFromRef(`${ORIGIN}/storage/v1/object/authenticated/board-assets/u/b/a.png?token=x`, BOARD_ASSETS_BUCKET)).toBe("u/b/a.png");
    expect(objectPathFromRef(`${ORIGIN}/storage/v1/object/sign/training-data/u/s/before.png?token=abc`, TRAINING_DATA_BUCKET)).toBe("u/s/before.png");
    expect(objectPathFromRef(publicUrl("u/b/a.png", "other"), BOARD_ASSETS_BUCKET)).toBeNull();
    expect(objectPathFromRef(publicUrl("u/b/a%20b.png"), BOARD_ASSETS_BUCKET)).toBe("u/b/a b.png");
    expect(objectPathFromRef("data:image/png;base64,AAAA", BOARD_ASSETS_BUCKET)).toBeNull();
    expect(objectPathFromRef("https://cdn.example.com/x.png", BOARD_ASSETS_BUCKET)).toBeNull();
    expect(objectPathFromRef("", BOARD_ASSETS_BUCKET)).toBeNull();
    expect(objectPathFromRef(42, BOARD_ASSETS_BUCKET)).toBeNull();
  });

  it("objectPathFromRef accepts bare paths and '<bucket>/<path>' (what training_samples stores)", () => {
    expect(objectPathFromRef("u/s/before.png", TRAINING_DATA_BUCKET)).toBe("u/s/before.png");
    expect(objectPathFromRef("training-data/u/s/before.png", TRAINING_DATA_BUCKET)).toBe("u/s/before.png");
  });

  it("referencedPaths de-duplicates and drops foreign refs", () => {
    const set = referencedPaths([publicUrl("u/b/a.png"), publicUrl("u/b/a.png"), publicUrl("x", "avatars"), null], BOARD_ASSETS_BUCKET);
    expect([...set]).toEqual(["u/b/a.png"]);
  });

  it("assetSrcsOf reads both snapshot shapes and ignores garbage", () => {
    const srcs = [publicUrl("u/b/a.png"), "data:image/png;base64,AAAA"];
    expect(assetSrcsOf(snapshot(srcs))).toEqual(srcs);
    expect(assetSrcsOf(snapshot(srcs).document)).toEqual(srcs);
    expect(assetSrcsOf({})).toEqual([]);
    expect(assetSrcsOf(null)).toEqual([]);
    expect(assetSrcsOf({ store: { "shape:1": { typeName: "shape", props: { src: "nope" } }, "asset:e": { typeName: "asset", props: { src: "" } } } })).toEqual([]);
  });

  it("chunk splits into batches and rejects bad sizes", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });
});

/* ------------------------------------------------------------------------- */
/* runGc over a fake client                                                  */
/* ------------------------------------------------------------------------- */

interface FakeState {
  objects: GcObject[];
  registered: string[];
  srcs: string[];
  training: string[];
  failDeleteContaining?: string;
  throwOnDelete?: boolean;
}

function fakeClient(state: FakeState) {
  const deletes: Array<{ bucket: string; names: string[] }> = [];
  const client: GcClient = {
    baseUrl: ORIGIN,
    async listObjects(bucket) {
      return state.objects.filter((o) => o.bucket === bucket).map((o) => ({ ...o }));
    },
    async listRegisteredPaths() {
      return [...state.registered];
    },
    async listBoardAssetSrcs() {
      return [...state.srcs];
    },
    async listTrainingRefs() {
      return [...state.training];
    },
    async deleteObjects(bucket, names) {
      deletes.push({ bucket, names });
      if (state.throwOnDelete) throw new Error("socket hang up");
      if (state.failDeleteContaining && names.some((n) => n.includes(state.failDeleteContaining!))) {
        return { status: 500, body: { message: "storage exploded" } };
      }
      state.objects = state.objects.filter((o) => !(o.bucket === bucket && names.includes(o.name)));
      return { status: 200, body: names.map((n) => ({ name: n })) };
    },
  };
  return { client, deletes, state };
}

function baseState(): FakeState {
  const registered = `${UID}/${BOARD}/reg.png`;
  const legacy = `${UID}/${BOARD}/legacy.png`;
  return {
    objects: [
      obj(BOARD_ASSETS_BUCKET, registered, 48),
      obj(BOARD_ASSETS_BUCKET, legacy, 48),
      obj(BOARD_ASSETS_BUCKET, `${UID}/${BOARD}/orphan1.png`, 48, 10),
      obj(BOARD_ASSETS_BUCKET, `${UID}/${BOARD}/orphan2.png`, 48, 20),
      obj(BOARD_ASSETS_BUCKET, `${UID}/${BOARD}/orphan3.png`, 48, 30),
      obj(BOARD_ASSETS_BUCKET, `${UID}/${BOARD}/young.png`, 2, 40),
      obj(TRAINING_DATA_BUCKET, `${UID}/s1/before.png`, 48),
      obj(TRAINING_DATA_BUCKET, `${UID}/s9/before.png`, 48, 50),
    ],
    registered: [registered],
    srcs: [publicUrl(legacy)],
    training: [`${UID}/s1/before.png`],
  };
}

describe("runGc", () => {
  it("dry run (default) plans across both buckets and deletes nothing", async () => {
    const { client, deletes } = fakeClient(baseState());
    const logs: string[] = [];
    const summary = await runGc(client, { now: NOW, log: (l) => logs.push(l) });
    expect(summary).toMatchObject({ scanned: 8, orphans: 4, deleted: 0, failed: 0, bytes: 110, dryRun: true, minAgeMs: DEFAULT_MIN_AGE_MS });
    expect(summary.buckets).toEqual({
      "board-assets": { scanned: 6, orphans: 3, deleted: 0, bytes: 60 },
      "training-data": { scanned: 2, orphans: 1, deleted: 0, bytes: 50 },
    });
    expect(deletes).toEqual([]);
    expect(summary.items.map((o) => o.name)).not.toContain(`${UID}/${BOARD}/young.png`);
    expect(logs.some((l) => l.includes("references:"))).toBe(true);
    expect(formatGcSummary(summary)).toContain("[dry-run]");
    expect(formatGcSummary(summary)).toContain("4 orphan(s)");
  });

  it("apply deletes orphans per bucket in batches and leaves everything else", async () => {
    const fake = fakeClient(baseState());
    const summary = await runGc(fake.client, { now: NOW, apply: true, batchSize: 2 });
    expect(summary).toMatchObject({ orphans: 4, deleted: 4, failed: 0, dryRun: false });
    expect(fake.deletes.map((d) => [d.bucket, d.names.length])).toEqual([
      ["board-assets", 2],
      ["board-assets", 1],
      ["training-data", 1],
    ]);
    expect(fake.state.objects.map((o) => o.name).sort()).toEqual(
      [`${UID}/${BOARD}/reg.png`, `${UID}/${BOARD}/legacy.png`, `${UID}/${BOARD}/young.png`, `${UID}/s1/before.png`].sort(),
    );
    expect(formatGcSummary(summary)).toContain("4 deleted, 0 failed");
  });

  it("a failed batch is counted, reported and does not stop the other batches", async () => {
    const fake = fakeClient({ ...baseState(), failDeleteContaining: "orphan2" });
    const summary = await runGc(fake.client, { now: NOW, apply: true, batchSize: 1 });
    expect(summary).toMatchObject({ orphans: 4, deleted: 3, failed: 1 });
    expect(summary.failures).toEqual([{ bucket: "board-assets", names: [`${UID}/${BOARD}/orphan2.png`], error: expect.stringMatching(/delete failed \(500\)/) }]);
    expect(fake.state.objects.map((o) => o.name)).toContain(`${UID}/${BOARD}/orphan2.png`);
    expect(formatGcSummary(summary)).toContain("FAILED board-assets");
  });

  it("a delete that throws is a failure, not a crash", async () => {
    const fake = fakeClient({ ...baseState(), throwOnDelete: true });
    const summary = await runGc(fake.client, { now: NOW, apply: true });
    expect(summary.failed).toBe(4);
    expect(summary.failures.every((f) => /socket hang up/.test(f.error))).toBe(true);
  });

  it("--bucket restricts the pass and skips loading references it does not need", async () => {
    const fake = fakeClient(baseState());
    const spy = vi.spyOn(fake.client, "listTrainingRefs");
    const summary = await runGc(fake.client, { now: NOW, buckets: [BOARD_ASSETS_BUCKET] });
    expect(Object.keys(summary.buckets)).toEqual([BOARD_ASSETS_BUCKET]);
    expect(summary.orphans).toBe(3);
    expect(spy).not.toHaveBeenCalled();
  });

  it("propagates reference-loading errors instead of planning against a partial set", async () => {
    const fake = fakeClient(baseState());
    fake.client.listBoardAssetSrcs = async () => {
      throw new Error("list whiteboards failed (500)");
    };
    await expect(runGc(fake.client, { now: NOW, apply: true })).rejects.toThrow(/list whiteboards failed/);
    expect(fake.deletes).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/* createGcClient (fetch level)                                              */
/* ------------------------------------------------------------------------- */

describe("createGcClient", () => {
  type Handler = (url: URL, init: RequestInit) => { status: number; body?: unknown };
  function fakeFetch(handler: Handler) {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, init: init ?? {} });
      const out = handler(url, init ?? {});
      return new Response(out.body === undefined ? null : JSON.stringify(out.body), { status: out.status });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("refuses to build without a service key", () => {
    expect(() => createGcClient({ url: ORIGIN, serviceKey: "" })).toThrow(/serviceKey/);
  });

  it("lists objects recursively (folders have no id), prefixes names, reads size + created_at, and pages", async () => {
    const { fetchImpl, calls } = fakeFetch((url, init) => {
      if (!url.pathname.endsWith("/storage/v1/object/list/board-assets")) return { status: 404 };
      const body = JSON.parse(String(init.body)) as { prefix: string; offset: number; limit: number };
      if (body.prefix === "") return { status: 200, body: [{ name: UID, id: null, metadata: null }, { name: ".emptyFolderPlaceholder", id: "p", metadata: { size: 0 } }] };
      if (body.prefix === `${UID}/`) return { status: 200, body: [{ name: BOARD, id: null }] };
      if (body.prefix === `${UID}/${BOARD}/`) {
        // Simulate paging: the first page is "full" (limit entries) when limit is small; we cannot
        // change LIST_PAGE_SIZE here, so return fewer than the limit and assert one call per level.
        return {
          status: 200,
          body: [
            { name: "a.png", id: "1", created_at: "2026-09-01T00:00:00.000Z", metadata: { size: 123 } },
            { name: "b.png", id: "2", created_at: "2026-09-02T00:00:00.000Z", metadata: { size: "456" } },
          ],
        };
      }
      return { status: 200, body: [] };
    });
    const client = createGcClient({ url: `${ORIGIN}/`, serviceKey: "svc", fetchImpl });
    expect(client.baseUrl).toBe(ORIGIN);
    const objects = await client.listObjects(BOARD_ASSETS_BUCKET);
    expect(objects).toEqual([
      { bucket: BOARD_ASSETS_BUCKET, name: `${UID}/${BOARD}/a.png`, created_at: "2026-09-01T00:00:00.000Z", size: 123 },
      { bucket: BOARD_ASSETS_BUCKET, name: `${UID}/${BOARD}/b.png`, created_at: "2026-09-02T00:00:00.000Z", size: 456 },
    ]);
    expect(calls).toHaveLength(3);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer svc");
    expect(headers.apikey).toBe("svc");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ prefix: "", offset: 0, sortBy: { column: "name", order: "asc" } });
  });

  it("pages through PostgREST rows for registry paths, snapshot srcs and training urls", async () => {
    const { fetchImpl, calls } = fakeFetch((url) => {
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      if (url.pathname.endsWith("/rest/v1/board_assets")) {
        // 2 full pages then a short one
        if (offset < 2 * limit) return { status: 200, body: Array.from({ length: limit }, (_, i) => ({ id: `${offset + i}`, object_path: `p/${offset + i}.png` })) };
        return { status: 200, body: [{ id: "last", object_path: "p/last.png" }] };
      }
      if (url.pathname.endsWith("/rest/v1/whiteboards")) {
        return { status: 200, body: [{ id: "b1", data: snapshot([publicUrl("u/b/x.png")]) }, { id: "b2", data: {} }] };
      }
      if (url.pathname.endsWith("/rest/v1/training_samples")) {
        return { status: 200, body: [{ id: "s", before_url: "u/s/before.png", after_full_url: "u/s/after_full.png" }] };
      }
      return { status: 500, body: { message: "boom" } };
    });
    const client = createGcClient({ url: ORIGIN, serviceKey: "svc", fetchImpl, pageSize: 3 });
    const paths = await client.listRegisteredPaths();
    expect(paths).toHaveLength(7);
    expect(paths.at(-1)).toBe("p/last.png");
    expect(calls.filter((c) => c.url.pathname.endsWith("/board_assets")).map((c) => c.url.searchParams.get("offset"))).toEqual(["0", "3", "6"]);
    expect(calls[0].url.searchParams.get("select")).toBe("id,object_path");

    expect(await client.listBoardAssetSrcs()).toEqual([publicUrl("u/b/x.png")]);
    expect(await client.listTrainingRefs()).toEqual(["u/s/before.png", "u/s/after_full.png"]);
  });

  it("deleteObjects sends DELETE /object/<bucket> with prefixes and surfaces HTTP errors from listings", async () => {
    const { fetchImpl, calls } = fakeFetch((url, init) => {
      if (init.method === "DELETE") return { status: 200, body: [{ name: "a" }] };
      return { status: 500, body: { message: "boom" } };
    });
    const client = createGcClient({ url: ORIGIN, serviceKey: "svc", fetchImpl });
    const r = await client.deleteObjects(BOARD_ASSETS_BUCKET, ["a", "b"]);
    expect(r.status).toBe(200);
    expect(calls[0].url.pathname).toBe("/storage/v1/object/board-assets");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ prefixes: ["a", "b"] });
    await expect(client.listRegisteredPaths()).rejects.toThrow(/list board_assets failed \(500\)/);
    await expect(client.listObjects(BOARD_ASSETS_BUCKET)).rejects.toThrow(/list storage board-assets\/ failed \(500\)/);
  });
});

/* ------------------------------------------------------------------------- */
/* CLI flags                                                                 */
/* ------------------------------------------------------------------------- */

describe("gc-storage.mjs parseArgs", () => {
  it("defaults to a dry run over both buckets with a 24 h minimum age", () => {
    expect(parseArgs([])).toEqual({ apply: false, buckets: ["board-assets", "training-data"], minAgeMs: DEFAULT_MIN_AGE_MS, json: false, help: false });
  });

  it("parses --apply, --bucket (repeatable, validated), --min-age-hours (0 allowed, fractional ok), --json", () => {
    expect(parseArgs(["--apply", "--bucket", "training-data", "--min-age-hours", "0", "--json"])).toEqual({
      apply: true,
      buckets: ["training-data"],
      minAgeMs: 0,
      json: true,
      help: false,
    });
    expect(parseArgs(["--bucket", "board-assets", "--bucket", "board-assets", "--min-age-hours", "1.5"])).toMatchObject({ buckets: ["board-assets"], minAgeMs: 1.5 * HOUR });
    expect(parseArgs(["--apply", "--dry-run"]).apply).toBe(false);
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  it("rejects junk", () => {
    expect(() => parseArgs(["--bucket", "avatars"])).toThrow(/must be one of/);
    expect(() => parseArgs(["--bucket"])).toThrow();
    expect(() => parseArgs(["--min-age-hours", "-1"])).toThrow();
    expect(() => parseArgs(["--min-age-hours", "x"])).toThrow();
    expect(() => parseArgs(["--wat"])).toThrow(/unknown argument/);
  });
});

/* ------------------------------------------------------------------------- */
/* Route handler                                                             */
/* ------------------------------------------------------------------------- */

describe("server helpers", () => {
  it("readCronSecret treats empty and placeholder values as unset", () => {
    expect(readCronSecret(undefined)).toBeUndefined();
    expect(readCronSecret("")).toBeUndefined();
    expect(readCronSecret("   ")).toBeUndefined();
    expect(readCronSecret("your-cron-secret")).toBeUndefined();
    expect(readCronSecret(" test-secret ")).toBe("test-secret");
  });

  it("bearerMatches requires an exact Bearer token", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("Bearer s3cret2", "s3cret")).toBe(false);
    expect(bearerMatches("Bearer s3cre", "s3cret")).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
    expect(bearerMatches(null, "s3cret")).toBe(false);
    expect(bearerMatches("Basic s3cret", "s3cret")).toBe(false);
  });

  it("isDryRun: explicit 0/false/no collect, anything else reports", () => {
    const req = (q: string) => new Request(`http://localhost/api/admin/gc${q}`);
    expect(isDryRun(req("?dryRun=1"))).toBe(true);
    expect(isDryRun(req("?dryRun=true"))).toBe(true);
    expect(isDryRun(req("?dryRun="))).toBe(true);
    expect(isDryRun(req("?dryRun=0"))).toBe(false);
    expect(isDryRun(req("?dryRun=false"))).toBe(false);
    expect(isDryRun(req("?dryRun=no"))).toBe(false);
  });

  it("isDryRun without the parameter: a manual request reports, a Vercel cron collects", () => {
    const bare = new Request("http://localhost/api/admin/gc");
    expect(isDryRun(bare)).toBe(true);

    const byHeader = new Request("http://localhost/api/admin/gc", {
      headers: { "x-vercel-cron-schedule": "0 4 * * *" },
    });
    const byAgent = new Request("http://localhost/api/admin/gc", {
      headers: { "user-agent": "vercel-cron/1.0" },
    });
    expect(isCronRequest(byHeader)).toBe(true);
    expect(isCronRequest(byAgent)).toBe(true);
    expect(isDryRun(byHeader)).toBe(false);
    expect(isDryRun(byAgent)).toBe(false);

    // An explicit dryRun=1 still wins for a cron invocation (operator override).
    const cronDry = new Request("http://localhost/api/admin/gc?dryRun=1", {
      headers: { "x-vercel-cron-schedule": "0 4 * * *" },
    });
    expect(isDryRun(cronDry)).toBe(true);

    // A browser or curl is never mistaken for the cron.
    const curl = new Request("http://localhost/api/admin/gc", { headers: { "user-agent": "curl/8.7.1" } });
    expect(isCronRequest(curl)).toBe(false);
    expect(isDryRun(curl)).toBe(true);
  });
});

describe("GET|POST /api/admin/gc", () => {
  const SECRET = "test-secret";
  const summary = (dryRun: boolean): GcSummary => ({
    scanned: 5,
    orphans: 2,
    deleted: dryRun ? 0 : 2,
    failed: 0,
    bytes: 2048,
    dryRun,
    minAgeMs: DEFAULT_MIN_AGE_MS,
    buckets: { "board-assets": { scanned: 5, orphans: 2, deleted: dryRun ? 0 : 2, bytes: 2048 } },
    items: [],
    failures: [],
  });

  function build(envOverrides: Partial<ReturnType<GcDeps["getEnv"]>> = {}, runImpl?: GcDeps["run"]) {
    const runs: Array<{ url: string; serviceKey: string; dryRun: boolean }> = [];
    const deps: GcDeps = {
      getEnv: () => ({ url: ORIGIN, serviceKey: "service-role", cronSecret: SECRET, ...envOverrides }),
      run:
        runImpl ??
        (async (opts) => {
          runs.push(opts);
          return summary(opts.dryRun);
        }),
    };
    return { handler: createGcHandler(deps), runs };
  }

  const request = (opts: { auth?: string; method?: string; query?: string; ip?: string } = {}) =>
    new Request(`http://localhost/api/admin/gc${opts.query ?? ""}`, {
      method: opts.method ?? "GET",
      headers: {
        ...(opts.auth ? { Authorization: opts.auth } : {}),
        "x-forwarded-for": opts.ip ?? "203.0.113.9",
      },
    });

  beforeEach(() => resetRateLimits());

  it("401 unauthorized without the header, with a wrong secret, or with the right secret in the wrong scheme", async () => {
    const { handler, runs } = build();
    for (const auth of [undefined, "Bearer nope", `Basic ${SECRET}`, SECRET]) {
      const res = await handler(request({ auth }));
      expect(res.status, String(auth)).toBe(401);
      expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
    }
    expect(runs).toEqual([]);
  });

  it("503 feature_unavailable when CRON_SECRET is unset (even with some header), and when the service role key is unset (after auth)", async () => {
    const noSecret = build({ cronSecret: undefined });
    const a = await noSecret.handler(request({ auth: "Bearer whatever" }));
    expect(a.status).toBe(503);
    expect(((await a.json()) as { error: string }).error).toBe("feature_unavailable");

    const noService = build({ serviceKey: undefined });
    expect((await noService.handler(request())).status).toBe(401); // still authenticates first
    const b = await noService.handler(request({ auth: `Bearer ${SECRET}` }));
    expect(b.status).toBe(503);
    expect(((await b.json()) as { message: string }).message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(noService.runs).toEqual([]);
  });

  it("200 with the right secret: dry run by default, body { scanned, orphans, deleted, bytes, dryRun }", async () => {
    const { handler, runs } = build();
    const res = await handler(request({ auth: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ scanned: 5, orphans: 2, deleted: 0, bytes: 2048, dryRun: true, failed: 0 });
    expect(runs).toEqual([{ url: ORIGIN, serviceKey: "service-role", dryRun: true }]);
  });

  it("?dryRun=0 applies (POST works the same as GET)", async () => {
    const { handler, runs } = build();
    const res = await handler(request({ auth: `Bearer ${SECRET}`, method: "POST", query: "?dryRun=0" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ dryRun: false, deleted: 2 });
    expect(runs[0].dryRun).toBe(false);
  });

  it("500 internal_error when the run throws", async () => {
    const { handler } = build({}, async () => {
      throw new Error("list storage failed (500)");
    });
    const res = await handler(request({ auth: `Bearer ${SECRET}` }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe("internal_error");
  });

  it("500 internal_error when the env itself is invalid", async () => {
    const handler = createGcHandler({
      getEnv: () => {
        throw new Error("Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL");
      },
      run: async () => summary(true),
    });
    expect((await handler(request())).status).toBe(500);
  });

  it("rate limits per IP at 10/min, before any auth work", async () => {
    const { handler, runs } = build();
    for (let i = 0; i < 10; i++) expect((await handler(request({ ip: "198.51.100.1" }))).status).toBe(401);
    const limited = await handler(request({ auth: `Bearer ${SECRET}`, ip: "198.51.100.1" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(runs).toEqual([]);
    expect((await handler(request({ auth: `Bearer ${SECRET}`, ip: "198.51.100.2" }))).status).toBe(200);
  });

  it("toResponseBody keeps the contract fields and drops the item list", () => {
    const body = toResponseBody({ ...summary(false), items: [{ bucket: "b", name: "n", created_at: null, size: 1, reason: "unregistered" }] });
    expect(Object.keys(body).sort()).toEqual(["buckets", "bytes", "deleted", "dryRun", "failed", "orphans", "scanned"]);
  });
});
