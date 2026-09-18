#!/usr/bin/env node
/**
 * Admin migration: move inline (data: URL) tldraw assets out of existing
 * whiteboards.data rows into the `board-assets` Storage bucket.
 *
 *   node scripts/offload-assets.mjs [--dry-run] [--board <uuid>] [--limit N] [--page-size N]
 *
 * Env (read from .env.local when not already set):
 *   NEXT_PUBLIC_SUPABASE_URL     project URL
 *   SUPABASE_SERVICE_ROLE_KEY    REQUIRED - the script writes to every user's folder, RLS is bypassed
 *
 * Per board: upload each inline asset to '<user_id>/<boardId>/<assetId>.<ext>'
 * (upsert), register it in public.board_assets, rewrite props.src to the public
 * URL, then PATCH the row with optimistic concurrency (id + version). A version
 * conflict re-reads the row and retries up to 3 times; an upload failure leaves
 * the row untouched. Exit code 0 only when every board succeeded.
 *
 * The HTTP layer is the small `createAdminClient()` below; `offloadBoards()`
 * accepts anything with the same shape so the orchestration is unit-testable.
 */
import { pathToFileURL } from "node:url";
import { loadDotEnvLocal, toResult } from "./lib/supabaseHttp.mjs";
import {
  assetObjectPath,
  findInlineAssets,
  parseDataUrl,
  rewriteAssetSrcs,
  snapshotJsonBytes,
} from "./lib/snapshotAssets.mjs";

export const BUCKET = "board-assets";
export const MAX_VERSION_RETRIES = 3;
export const DEFAULT_PAGE_SIZE = 20;

/**
 * @typedef {{ id: string, user_id: string, version: number, data: unknown }} BoardRow
 * @typedef {{ status: number, body: any }} HttpResult
 * @typedef {{
 *   baseUrl: string,
 *   listBoards(opts: { offset: number, limit: number, boardId?: string | null }): Promise<BoardRow[]>,
 *   getBoard(id: string): Promise<BoardRow | null>,
 *   upload(path: string, bytes: Uint8Array, contentType: string): Promise<HttpResult>,
 *   registerAsset(row: { whiteboard_id: string, user_id: string, object_path: string, mime_type: string, bytes: number, source: string }): Promise<HttpResult>,
 *   updateBoard(id: string, expectedVersion: number, data: unknown): Promise<{ updated: boolean, status: number, body: any }>,
 * }} AdminClient
 * @typedef {{ dryRun?: boolean, boardId?: string | null, limit?: number | null, pageSize?: number, log?: (line: string) => void }} OffloadOptions
 * @typedef {{ id: string, user_id: string, status: 'offloaded'|'skipped'|'failed'|'dry-run', assets: number, bytesBefore: number, bytesAfter: number, attempts: number, error?: string }} BoardReport
 * @typedef {{ scanned: number, offloaded: number, skipped: number, failed: number, dryRun: boolean, boards: BoardReport[] }} Summary
 */

/**
 * board_assets.source from the asset's file name (client naming conventions).
 * @param {string} name
 * @returns {'user'|'ai'|'sticker'|'pdf'|'worksheet'}
 */
export function inferSource(name) {
  const n = String(name || "").toLowerCase();
  if (/worksheet/.test(n)) return "worksheet";
  if (/generated|solution|feedback|(^|[^a-z])ai[-_.]/.test(n)) return "ai";
  if (/sticker/.test(n)) return "sticker";
  if (/\.pdf|-p\d+\.(png|jpe?g|webp)$/.test(n)) return "pdf";
  return "user";
}

/**
 * @param {string} baseUrl
 * @param {string} objectPath
 */
export function publicAssetUrl(baseUrl, objectPath) {
  return `${baseUrl.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

/**
 * Parse CLI flags. Throws on unknown flags or malformed values.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {{ dryRun: boolean, boardId: string | null, limit: number | null, pageSize: number, help: boolean }} */
  const out = { dryRun: false, boardId: null, limit: null, pageSize: DEFAULT_PAGE_SIZE, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--board") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error("--board requires a board id");
      out.boardId = v;
    } else if (a === "--limit" || a === "--page-size") {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v <= 0) throw new Error(`${a} requires a positive integer`);
      if (a === "--limit") out.limit = v;
      else out.pageSize = v;
    } else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

// ---------------------------------------------------------------- HTTP client

/**
 * Service-role PostgREST + Storage client (the only thing that touches the network).
 * @param {{ url: string, serviceKey: string, fetchImpl?: typeof fetch }} cfg
 * @returns {AdminClient}
 */
export function createAdminClient(cfg) {
  const base = cfg.url.replace(/\/$/, "");
  const fetchImpl = cfg.fetchImpl ?? fetch;
  /** @param {Record<string, string>} [extra] */
  const headers = (extra = {}) => ({ apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, ...extra });

  /**
   * @param {string} method
   * @param {string} table
   * @param {{ query?: Record<string, string>, body?: unknown, prefer?: string }} [opts]
   */
  async function rest(method, table, opts = {}) {
    const qs = new URLSearchParams(opts.query ?? {}).toString();
    const res = await fetchImpl(`${base}/rest/v1/${table}${qs ? `?${qs}` : ""}`, {
      method,
      headers: headers({
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(opts.prefer ? { Prefer: opts.prefer } : {}),
      }),
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    return toResult(res);
  }

  /** @param {HttpResult} r @param {string} what */
  const ensureOk = (r, what) => {
    if (r.status < 200 || r.status >= 300) throw new Error(`${what} failed (${r.status}): ${JSON.stringify(r.body)}`);
  };

  return {
    baseUrl: base,
    async listBoards({ offset, limit, boardId }) {
      /** @type {Record<string, string>} */
      const query = { select: "id,user_id,version,data", order: "id.asc", limit: String(limit), offset: String(offset) };
      if (boardId) query.id = `eq.${boardId}`;
      const r = await rest("GET", "whiteboards", { query });
      ensureOk(r, "list whiteboards");
      return Array.isArray(r.body) ? r.body : [];
    },
    async getBoard(id) {
      const r = await rest("GET", "whiteboards", { query: { select: "id,user_id,version,data", id: `eq.${id}` } });
      ensureOk(r, `read whiteboard ${id}`);
      return Array.isArray(r.body) && r.body[0] ? r.body[0] : null;
    },
    async upload(path, bytes, contentType) {
      const res = await fetchImpl(`${base}/storage/v1/object/${BUCKET}/${path}`, {
        method: "POST",
        headers: headers({ "Content-Type": contentType, "x-upsert": "true" }),
        body: bytes,
      });
      return toResult(res);
    },
    async registerAsset(row) {
      return rest("POST", "board_assets", {
        query: { on_conflict: "object_path" },
        prefer: "resolution=merge-duplicates,return=minimal",
        body: row,
      });
    },
    async updateBoard(id, expectedVersion, data) {
      const r = await rest("PATCH", "whiteboards", {
        query: { id: `eq.${id}`, version: `eq.${expectedVersion}`, select: "id,version" },
        prefer: "return=representation",
        body: { data },
      });
      if (r.status < 200 || r.status >= 300) return { updated: false, status: r.status, body: r.body };
      return { updated: Array.isArray(r.body) && r.body.length > 0, status: r.status, body: r.body };
    },
  };
}

// ---------------------------------------------------------------- orchestration

/**
 * Build the upload plan for one row without touching the network.
 * @param {AdminClient} client
 * @param {BoardRow} row
 */
export function planBoard(client, row) {
  const inline = findInlineAssets(row.data);
  /** @type {Record<string, string>} */
  const srcById = {};
  const items = [];
  const problems = [];
  for (const asset of inline) {
    const parsed = parseDataUrl(asset.src);
    if (!parsed) {
      problems.push(`${asset.id}: undecodable data URL`);
      continue;
    }
    const objectPath = assetObjectPath(row.user_id, row.id, asset.id, parsed.mime);
    const url = publicAssetUrl(client.baseUrl, objectPath);
    srcById[asset.id] = url;
    items.push({ id: asset.id, objectPath, url, mime: parsed.mime, bytes: parsed.bytes, source: inferSource(asset.name) });
  }
  const nextData = rewriteAssetSrcs(row.data, srcById);
  return {
    items,
    problems,
    nextData,
    bytesBefore: snapshotJsonBytes(row.data),
    bytesAfter: snapshotJsonBytes(nextData),
  };
}

/**
 * Offload one board. Never throws; the report says what happened.
 * @param {AdminClient} client
 * @param {BoardRow} initialRow
 * @param {OffloadOptions} [opts]
 * @returns {Promise<BoardReport>}
 */
export async function offloadBoard(client, initialRow, opts = {}) {
  const log = opts.log ?? (() => {});
  let row = initialRow;
  /** @type {Map<string, string>} src -> public url, so retries do not re-upload identical payloads */
  const uploadedBySrc = new Map();
  let attempts = 0;
  for (;;) {
    attempts++;
    const plan = planBoard(client, row);
    const base = { id: row.id, user_id: row.user_id, attempts, assets: plan.items.length, bytesBefore: plan.bytesBefore, bytesAfter: plan.bytesAfter };
    if (plan.problems.length) {
      return { ...base, status: "failed", error: plan.problems.join("; ") };
    }
    if (plan.items.length === 0) {
      return { ...base, status: "skipped" };
    }
    log(`board ${row.id} (v${row.version}): ${plan.items.length} inline asset(s), ${fmtBytes(plan.bytesBefore)} -> ${fmtBytes(plan.bytesAfter)}`);
    if (opts.dryRun) {
      for (const it of plan.items) log(`  would upload ${it.objectPath} (${it.mime}, ${fmtBytes(it.bytes.byteLength)}, source=${it.source})`);
      return { ...base, status: "dry-run" };
    }
    try {
      for (const it of plan.items) {
        const srcKey = `${it.objectPath}\n${it.bytes.byteLength}`;
        if (!uploadedBySrc.has(srcKey)) {
          const up = await client.upload(it.objectPath, it.bytes, it.mime);
          if (up.status < 200 || up.status >= 300) {
            throw new Error(`upload ${it.objectPath} failed (${up.status}): ${JSON.stringify(up.body)}`);
          }
          const reg = await client.registerAsset({
            whiteboard_id: row.id,
            user_id: row.user_id,
            object_path: it.objectPath,
            mime_type: it.mime,
            bytes: it.bytes.byteLength,
            source: it.source,
          });
          if (reg.status < 200 || reg.status >= 300) {
            throw new Error(`register ${it.objectPath} failed (${reg.status}): ${JSON.stringify(reg.body)}`);
          }
          uploadedBySrc.set(srcKey, it.url);
          log(`  uploaded ${it.objectPath} (${fmtBytes(it.bytes.byteLength)})`);
        }
      }
    } catch (err) {
      return { ...base, status: "failed", error: err instanceof Error ? err.message : String(err) };
    }
    const upd = await client.updateBoard(row.id, row.version, plan.nextData);
    if (upd.updated) {
      log(`  saved board ${row.id} (was v${row.version})`);
      return { ...base, status: "offloaded" };
    }
    if (upd.status < 200 || upd.status >= 300) {
      return { ...base, status: "failed", error: `update failed (${upd.status}): ${JSON.stringify(upd.body)}` };
    }
    if (attempts >= MAX_VERSION_RETRIES) {
      return { ...base, status: "failed", error: `version conflict after ${attempts} attempts` };
    }
    log(`  version conflict on board ${row.id} (expected v${row.version}); re-reading`);
    const fresh = await client.getBoard(row.id);
    if (!fresh) return { ...base, status: "failed", error: "board disappeared during retry" };
    row = fresh;
  }
}

/**
 * Page through whiteboards and offload every row with inline assets.
 * @param {AdminClient} client
 * @param {OffloadOptions} [opts]
 * @returns {Promise<Summary>}
 */
export async function offloadBoards(client, opts = {}) {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const limit = opts.limit ?? null;
  /** @type {Summary} */
  const summary = { scanned: 0, offloaded: 0, skipped: 0, failed: 0, dryRun: Boolean(opts.dryRun), boards: [] };
  let offset = 0;
  outer: for (;;) {
    const rows = await client.listBoards({ offset, limit: pageSize, boardId: opts.boardId ?? null });
    if (rows.length === 0) break;
    for (const row of rows) {
      summary.scanned++;
      const report = await offloadBoard(client, row, opts);
      if (report.status === "skipped") summary.skipped++;
      else {
        summary.boards.push(report);
        if (report.status === "failed") summary.failed++;
        else summary.offloaded++;
        if (limit !== null && summary.offloaded + summary.failed >= limit) break outer;
      }
    }
    if (rows.length < pageSize || opts.boardId) break;
    offset += pageSize;
  }
  return summary;
}

/** @param {number} n */
export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** @param {Summary} s */
export function formatSummary(s) {
  const lines = [];
  for (const b of s.boards) {
    const tag = b.status.toUpperCase().padEnd(9);
    lines.push(`${tag} ${b.id}  ${b.assets} asset(s)  ${fmtBytes(b.bytesBefore)} -> ${fmtBytes(b.bytesAfter)}${b.attempts > 1 ? `  (${b.attempts} attempts)` : ""}${b.error ? `  ${b.error}` : ""}`);
  }
  lines.push("");
  lines.push(
    `${s.dryRun ? "[dry-run] " : ""}scanned ${s.scanned} board(s): ${s.offloaded} ${s.dryRun ? "would be offloaded" : "offloaded"}, ${s.skipped} without inline assets, ${s.failed} failed`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  loadDotEnvLocal();
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  if (args.help) {
    console.log("usage: node scripts/offload-assets.mjs [--dry-run] [--board <uuid>] [--limit N] [--page-size N]");
    process.exit(0);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Refusing to run: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required.\n" +
        "This script writes into every user's storage folder and bypasses RLS, so it only runs with the service role.\n" +
        "Locally: eval \"$(npx supabase status -o env | sed 's/^/export /')\" then SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY NEXT_PUBLIC_SUPABASE_URL=$API_URL node scripts/offload-assets.mjs --dry-run",
    );
    process.exit(2);
  }
  console.log(`Target: ${url}${args.dryRun ? " (dry run, no writes)" : ""}${args.boardId ? ` board=${args.boardId}` : ""}${args.limit ? ` limit=${args.limit}` : ""}`);
  const client = createAdminClient({ url, serviceKey });
  let summary;
  try {
    summary = await offloadBoards(client, { ...args, log: (line) => console.log(line) });
  } catch (err) {
    console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log("");
  console.log(formatSummary(summary));
  process.exit(summary.failed === 0 ? 0 : 1);
}
