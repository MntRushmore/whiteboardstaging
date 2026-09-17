/**
 * Unit tests for the orchestration in scripts/offload-assets.mjs, driven by an
 * in-memory fake of the admin client. No network.
 */
import { describe, expect, it } from "vitest";
import {
  BUCKET,
  MAX_VERSION_RETRIES,
  createAdminClient,
  formatSummary,
  inferSource,
  offloadBoard,
  offloadBoards,
  parseArgs,
  planBoard,
  publicAssetUrl,
} from "../../scripts/offload-assets.mjs";
import type { AdminClient, BoardRow } from "../../scripts/offload-assets.mjs";
import { findInlineAssets } from "../../scripts/lib/snapshotAssets.mjs";

// A realistic-looking payload: PNG signature followed by 600 bytes of filler (real images are far larger than their URL).
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600, 7)]);
const PNG_URL = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
const USER = "11111111-1111-4111-8111-111111111111";

function asset(id: string, src: string, name = "pasted.png") {
  return { id, typeName: "asset", type: "image", props: { src, name, mimeType: "image/png", w: 1, h: 1 }, meta: {} };
}

function boardData(assets: Record<string, unknown>) {
  return {
    document: { store: { "document:document": { id: "document:document", typeName: "document" }, ...assets }, schema: { v: 2 } },
    session: { currentPageId: "page:page" },
  };
}

interface FakeOptions {
  failUploadPath?: string;
  conflictsBeforeSuccess?: number;
  registerStatus?: number;
}

function makeFake(rows: BoardRow[], opts: FakeOptions = {}) {
  const db = new Map<string, BoardRow>(rows.map((r) => [r.id, structuredClone(r)]));
  const uploads: Array<{ path: string; bytes: number; contentType: string }> = [];
  const registered: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; expectedVersion: number }> = [];
  let conflictsLeft = opts.conflictsBeforeSuccess ?? 0;
  const client: AdminClient = {
    baseUrl: "https://proj.supabase.co",
    async listBoards({ offset, limit, boardId }) {
      const all = [...db.values()].sort((a, b) => a.id.localeCompare(b.id)).filter((r) => !boardId || r.id === boardId);
      return all.slice(offset, offset + limit).map((r) => structuredClone(r));
    },
    async getBoard(id) {
      const r = db.get(id);
      return r ? structuredClone(r) : null;
    },
    async upload(path, bytes, contentType) {
      if (path === opts.failUploadPath) return { status: 413, body: { message: "Payload too large" } };
      uploads.push({ path, bytes: bytes.byteLength, contentType });
      return { status: 200, body: { Key: `${BUCKET}/${path}` } };
    },
    async registerAsset(row) {
      registered.push(row);
      return { status: opts.registerStatus ?? 201, body: null };
    },
    async updateBoard(id, expectedVersion, data) {
      updates.push({ id, expectedVersion });
      const row = db.get(id);
      if (!row) return { updated: false, status: 200, body: [] };
      if (conflictsLeft > 0) {
        conflictsLeft--;
        // Someone else saved in between: bump the version, keep the data inline.
        row.version += 1;
        return { updated: false, status: 200, body: [] };
      }
      if (row.version !== expectedVersion) return { updated: false, status: 200, body: [] };
      row.data = structuredClone(data);
      row.version += 1; // the DB trigger bumps version on data change
      return { updated: true, status: 200, body: [{ id, version: row.version }] };
    },
  };
  return { client, db, uploads, registered, updates };
}

const inlineRow: BoardRow = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  user_id: USER,
  version: 3,
  data: boardData({
    "asset:img1": asset("asset:img1", PNG_URL, "generated-solution.png"),
    "asset:img2": asset("asset:img2", PNG_URL, "worksheet.png"),
    "asset:remote": asset("asset:remote", "https://proj.supabase.co/storage/v1/object/public/board-assets/x/y/z.png"),
  }),
};
const cleanRow: BoardRow = {
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  user_id: USER,
  version: 1,
  data: boardData({ "asset:remote": asset("asset:remote", "https://cdn.example.com/a.png") }),
};

describe("offloadBoards", () => {
  it("offloads rows with inline assets, skips clean rows and rewrites srcs to public URLs", async () => {
    const fake = makeFake([inlineRow, cleanRow]);
    const logs: string[] = [];
    const summary = await offloadBoards(fake.client, { log: (l) => logs.push(l) });

    expect(summary).toMatchObject({ scanned: 2, offloaded: 1, skipped: 1, failed: 0, dryRun: false });
    expect(summary.boards).toHaveLength(1);
    const report = summary.boards[0];
    expect(report.status).toBe("offloaded");
    expect(report.assets).toBe(2);
    expect(report.bytesAfter).toBeLessThan(report.bytesBefore);

    expect(fake.uploads.map((u) => u.path).sort()).toEqual([
      `${USER}/${inlineRow.id}/img1.png`,
      `${USER}/${inlineRow.id}/img2.png`,
    ]);
    expect(fake.uploads.every((u) => u.contentType === "image/png" && u.bytes === PNG_BYTES.byteLength)).toBe(true);
    expect(fake.registered.map((r) => r.source).sort()).toEqual(["ai", "worksheet"]);
    expect(fake.registered[0]).toMatchObject({ whiteboard_id: inlineRow.id, user_id: USER, mime_type: "image/png", bytes: PNG_BYTES.byteLength });

    const saved = fake.db.get(inlineRow.id)!;
    expect(saved.version).toBe(4);
    expect(findInlineAssets(saved.data)).toEqual([]);
    const store = (saved.data as ReturnType<typeof boardData>).document.store as unknown as Record<string, { props: { src: string } }>;
    expect(store["asset:img1"].props.src).toBe(`https://proj.supabase.co/storage/v1/object/public/board-assets/${USER}/${inlineRow.id}/img1.png`);
    expect(store["asset:remote"].props.src).toBe("https://proj.supabase.co/storage/v1/object/public/board-assets/x/y/z.png");
    // the clean row is untouched
    expect(fake.db.get(cleanRow.id)).toEqual(cleanRow);
    expect(fake.updates).toEqual([{ id: inlineRow.id, expectedVersion: 3 }]);
    expect(logs.some((l) => l.includes("uploaded"))).toBe(true);
  });

  it("dry run makes no writes but reports before/after bytes", async () => {
    const fake = makeFake([inlineRow, cleanRow]);
    const summary = await offloadBoards(fake.client, { dryRun: true });
    expect(summary).toMatchObject({ scanned: 2, offloaded: 1, skipped: 1, failed: 0, dryRun: true });
    expect(summary.boards[0].status).toBe("dry-run");
    expect(summary.boards[0].bytesBefore).toBeGreaterThan(summary.boards[0].bytesAfter);
    expect(fake.uploads).toEqual([]);
    expect(fake.registered).toEqual([]);
    expect(fake.updates).toEqual([]);
    expect(fake.db.get(inlineRow.id)).toEqual(inlineRow);
    expect(formatSummary(summary)).toContain("[dry-run]");
    expect(formatSummary(summary)).toContain("DRY-RUN");
  });

  it("an upload failure leaves the row untouched and fails the run", async () => {
    const fake = makeFake([inlineRow], { failUploadPath: `${USER}/${inlineRow.id}/img2.png` });
    const summary = await offloadBoards(fake.client);
    expect(summary).toMatchObject({ scanned: 1, offloaded: 0, failed: 1 });
    expect(summary.boards[0].status).toBe("failed");
    expect(summary.boards[0].error).toMatch(/upload .*img2\.png failed \(413\)/);
    expect(fake.updates).toEqual([]);
    expect(fake.db.get(inlineRow.id)).toEqual(inlineRow);
    expect(formatSummary(summary)).toContain("1 failed");
  });

  it("a registry failure also leaves the row untouched", async () => {
    const fake = makeFake([inlineRow], { registerStatus: 403 });
    const summary = await offloadBoards(fake.client);
    expect(summary.boards[0]).toMatchObject({ status: "failed" });
    expect(summary.boards[0].error).toMatch(/register .* failed \(403\)/);
    expect(fake.updates).toEqual([]);
    expect(fake.db.get(inlineRow.id)).toEqual(inlineRow);
  });

  it("retries a version conflict by re-reading the row, without re-uploading identical payloads", async () => {
    const fake = makeFake([inlineRow], { conflictsBeforeSuccess: 2 });
    const summary = await offloadBoards(fake.client);
    expect(summary).toMatchObject({ offloaded: 1, failed: 0 });
    expect(summary.boards[0]).toMatchObject({ status: "offloaded", attempts: 3 });
    expect(fake.updates.map((u) => u.expectedVersion)).toEqual([3, 4, 5]);
    expect(fake.uploads).toHaveLength(2);
    expect(findInlineAssets(fake.db.get(inlineRow.id)!.data)).toEqual([]);
    expect(formatSummary(summary)).toContain("(3 attempts)");
  });

  it("gives up after MAX_VERSION_RETRIES conflicts and does not overwrite", async () => {
    const fake = makeFake([inlineRow], { conflictsBeforeSuccess: MAX_VERSION_RETRIES });
    const summary = await offloadBoards(fake.client);
    expect(summary.boards[0]).toMatchObject({ status: "failed", attempts: MAX_VERSION_RETRIES });
    expect(summary.boards[0].error).toMatch(/version conflict/);
    expect(findInlineAssets(fake.db.get(inlineRow.id)!.data)).toHaveLength(2);
  });

  it("honours --board and --limit and pages through rows", async () => {
    const rows: BoardRow[] = [];
    for (let i = 0; i < 7; i++) {
      rows.push({ ...inlineRow, id: `cccccccc-0000-4000-8000-00000000000${i}`, data: structuredClone(inlineRow.data) });
    }
    rows.push(cleanRow);
    const single = makeFake(rows);
    const one = await offloadBoards(single.client, { boardId: rows[2].id, pageSize: 2 });
    expect(one).toMatchObject({ scanned: 1, offloaded: 1 });
    expect(single.updates).toEqual([{ id: rows[2].id, expectedVersion: 3 }]);

    const limited = makeFake(rows);
    const two = await offloadBoards(limited.client, { limit: 2, pageSize: 3 });
    expect(two).toMatchObject({ offloaded: 2, failed: 0 });
    expect(limited.updates).toHaveLength(2);

    const all = makeFake(rows);
    const every = await offloadBoards(all.client, { pageSize: 3 });
    expect(every).toMatchObject({ scanned: 8, offloaded: 7, skipped: 1, failed: 0 });
  });
});

describe("offloadBoard / planBoard", () => {
  it("fails a board whose data URL cannot be decoded instead of writing garbage", async () => {
    const fake = makeFake([]);
    const row: BoardRow = { ...inlineRow, data: boardData({ "asset:bad": asset("asset:bad", "data:image/png;base64,!!") }) };
    const report = await offloadBoard(fake.client, row);
    expect(report.status).toBe("failed");
    expect(report.error).toMatch(/undecodable/);
    expect(fake.uploads).toEqual([]);
    expect(fake.updates).toEqual([]);
  });

  it("planBoard predicts the rewritten snapshot and sizes", () => {
    const fake = makeFake([]);
    const plan = planBoard(fake.client, inlineRow);
    expect(plan.items.map((i) => i.objectPath)).toEqual([`${USER}/${inlineRow.id}/img1.png`, `${USER}/${inlineRow.id}/img2.png`]);
    expect(plan.items[0].url).toBe(publicAssetUrl("https://proj.supabase.co/", plan.items[0].objectPath));
    expect(plan.bytesAfter).toBeLessThan(plan.bytesBefore);
    expect(findInlineAssets(plan.nextData)).toEqual([]);
    expect(findInlineAssets(inlineRow.data)).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("inferSource follows the client naming conventions", () => {
    expect(inferSource("generated-solution.png")).toBe("ai");
    expect(inferSource("worksheet.png")).toBe("worksheet");
    expect(inferSource("smiley-sticker.png")).toBe("sticker");
    expect(inferSource("homework-p3.png")).toBe("pdf");
    expect(inferSource("notes.pdf-page.png")).toBe("pdf");
    expect(inferSource("pasted image.png")).toBe("user");
    expect(inferSource("")).toBe("user");
  });

  it("publicAssetUrl builds the storage public URL", () => {
    expect(publicAssetUrl("https://p.supabase.co", "u/b/a.png")).toBe("https://p.supabase.co/storage/v1/object/public/board-assets/u/b/a.png");
  });

  it("parseArgs handles flags and rejects junk", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, boardId: null, limit: null, pageSize: 20, help: false });
    expect(parseArgs(["--dry-run", "--board", "abc", "--limit", "5", "--page-size", "50"])).toMatchObject({
      dryRun: true,
      boardId: "abc",
      limit: 5,
      pageSize: 50,
    });
    expect(() => parseArgs(["--limit", "0"])).toThrow();
    expect(() => parseArgs(["--limit", "x"])).toThrow();
    expect(() => parseArgs(["--board"])).toThrow();
    expect(() => parseArgs(["--wat"])).toThrow();
  });
});

describe("createAdminClient (fetch-level)", () => {
  function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      const out = handler(url, init ?? {});
      return new Response(out.body === undefined ? null : JSON.stringify(out.body), { status: out.status });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("sends service-role headers, optimistic-concurrency filters and upsert flags", async () => {
    const { fetchImpl, calls } = fakeFetch((url, init) => {
      if (url.includes("/rest/v1/whiteboards") && init.method === "PATCH") return { status: 200, body: [{ id: "b", version: 2 }] };
      if (url.includes("/rest/v1/whiteboards")) return { status: 200, body: [{ id: "b", user_id: "u", version: 1, data: {} }] };
      if (url.includes("/storage/v1/object/board-assets/")) return { status: 200, body: { Key: "k" } };
      if (url.includes("/rest/v1/board_assets")) return { status: 201 };
      return { status: 404, body: { message: "nope" } };
    });
    const client = createAdminClient({ url: "https://p.supabase.co/", serviceKey: "svc", fetchImpl });
    expect(client.baseUrl).toBe("https://p.supabase.co");

    const rows = await client.listBoards({ offset: 20, limit: 10, boardId: null });
    expect(rows).toHaveLength(1);
    expect(calls[0].url).toBe("https://p.supabase.co/rest/v1/whiteboards?select=id%2Cuser_id%2Cversion%2Cdata&order=id.asc&limit=10&offset=20");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer svc");
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe("svc");

    await client.listBoards({ offset: 0, limit: 5, boardId: "b" });
    expect(calls[1].url).toContain("id=eq.b");

    expect(await client.getBoard("b")).toMatchObject({ id: "b", version: 1 });

    const up = await client.upload("u/b/a.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(up.status).toBe(200);
    const upCall = calls[3];
    expect(upCall.url).toBe("https://p.supabase.co/storage/v1/object/board-assets/u/b/a.png");
    expect(upCall.init.method).toBe("POST");
    expect((upCall.init.headers as Record<string, string>)["x-upsert"]).toBe("true");
    expect((upCall.init.headers as Record<string, string>)["Content-Type"]).toBe("image/png");

    await client.registerAsset({ whiteboard_id: "b", user_id: "u", object_path: "u/b/a.png", mime_type: "image/png", bytes: 3, source: "user" });
    expect(calls[4].url).toContain("/rest/v1/board_assets?on_conflict=object_path");
    expect((calls[4].init.headers as Record<string, string>).Prefer).toContain("resolution=merge-duplicates");

    const upd = await client.updateBoard("b", 1, { x: 1 });
    expect(upd.updated).toBe(true);
    expect(calls[5].url).toContain("id=eq.b");
    expect(calls[5].url).toContain("version=eq.1");
    expect(calls[5].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[5].init.body))).toEqual({ data: { x: 1 } });
  });

  it("reports zero-row updates as not updated and surfaces HTTP errors", async () => {
    const { fetchImpl } = fakeFetch((url, init) => {
      if (init.method === "PATCH") return { status: 200, body: [] };
      if (url.includes("/rest/v1/whiteboards")) return { status: 500, body: { message: "boom" } };
      return { status: 404 };
    });
    const client = createAdminClient({ url: "https://p.supabase.co", serviceKey: "svc", fetchImpl });
    expect(await client.updateBoard("b", 1, {})).toMatchObject({ updated: false, status: 200 });
    await expect(client.getBoard("b")).rejects.toThrow(/read whiteboard b failed \(500\)/);
    await expect(client.listBoards({ offset: 0, limit: 1 })).rejects.toThrow(/list whiteboards failed/);
  });
});
