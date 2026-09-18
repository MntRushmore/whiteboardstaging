/**
 * Storage garbage collection: find objects in the `board-assets` and
 * `training-data` buckets that nothing references any more.
 *
 * Plain ESM, no dependencies. Shared by:
 *   - scripts/gc-storage.mjs            (operator CLI, service role)
 *   - src/lib/server/storageGc.ts       (GET/POST /api/admin/gc, Vercel cron)
 *   - src/__tests__/storageGc.test.ts
 *
 * Layout
 *   1. planGc() and its helpers are PURE: arrays and Sets in, a plan out.
 *   2. createGcClient() is the only thing that touches the network (service-role
 *      PostgREST + Storage API over the injected fetch), same pattern as
 *      scripts/offload-assets.mjs.
 *   3. runGc() drives 1 with 2 and, with `apply`, deletes in batches. It accepts
 *      anything with the GcClient shape so the orchestration is unit-testable.
 *
 * An object is an orphan when it is older than `minAgeMs` (default 24 h, so an
 * upload whose registry insert / autosave has not landed yet is never collected)
 * AND nothing references it:
 *   board-assets   not in board_assets.object_path and not the src of any asset
 *                  record inside whiteboards.data (URL suffix '/board-assets/<path>')
 *   training-data  not in training_samples.before_url / after_full_url (stored as
 *                  object paths; full URLs are accepted too)
 */

export const BOARD_ASSETS_BUCKET = "board-assets";
export const TRAINING_DATA_BUCKET = "training-data";
export const GC_BUCKETS = Object.freeze([BOARD_ASSETS_BUCKET, TRAINING_DATA_BUCKET]);
export const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** Storage API `DELETE /object/<bucket>` accepts up to ~1000 prefixes; 100 keeps error blast radius small. */
export const DELETE_BATCH_SIZE = 100;
/** Storage list API page size (its hard maximum is 1000). */
export const LIST_PAGE_SIZE = 1000;
/** PostgREST page size when reading whiteboards.data (rows can be MBs). */
export const ROWS_PAGE_SIZE = 50;

/**
 * @typedef {{ bucket: string, name: string, created_at: string | null, size: number }} GcObject
 * @typedef {GcObject & { reason: 'unregistered' | 'unreferenced' }} GcOrphan
 * @typedef {{
 *   scanned: number,
 *   orphans: GcOrphan[],
 *   keep: number,
 *   young: number,
 *   bytes: number,
 * }} GcPlan
 */

// ---------------------------------------------------------------- pure helpers

/**
 * Object path referenced by a Storage URL of the form
 * '<origin>/storage/v1/object/(public|authenticated|sign)/<bucket>/<path>', or by a
 * bare '<bucket>/<path>' / '<path>' string. Returns null when the string points
 * at another bucket (or is a data: URL).
 * @param {unknown} ref
 * @param {string} bucket
 * @returns {string | null}
 */
export function objectPathFromRef(ref, bucket) {
  if (typeof ref !== "string" || ref.length === 0 || ref.startsWith("data:")) return null;
  const marker = `/${bucket}/`;
  const objectIdx = ref.indexOf("/object/");
  if (objectIdx >= 0) {
    const idx = ref.indexOf(marker, objectIdx);
    if (idx < 0) return null;
    return decodePath(ref.slice(idx + marker.length));
  }
  if (/^https?:\/\//i.test(ref)) return null;
  if (ref.startsWith(`${bucket}/`)) return decodePath(ref.slice(bucket.length + 1));
  // A bare object path (what train/page.tsx stores in training_samples).
  return decodePath(ref);
}

/** @param {string} raw */
function decodePath(raw) {
  const clean = raw.split(/[?#]/)[0];
  if (!clean) return null;
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

/**
 * Normalise a collection of references (URLs or paths) into the object paths
 * they point at inside `bucket`. Strings for other buckets are dropped.
 * @param {Iterable<unknown>} refs
 * @param {string} bucket
 * @returns {Set<string>}
 */
export function referencedPaths(refs, bucket) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const ref of refs) {
    const path = objectPathFromRef(ref, bucket);
    if (path) out.add(path);
  }
  return out;
}

/**
 * Locate the record map inside either tldraw snapshot shape
 * (TLEditorSnapshot { document: { store } } or TLStoreSnapshot { store }).
 * @param {any} snapshot
 * @returns {Record<string, any> | null}
 */
function storeOf(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const doc = snapshot.document;
  if (doc && typeof doc === "object" && doc.store && typeof doc.store === "object") return doc.store;
  if (snapshot.store && typeof snapshot.store === "object") return snapshot.store;
  return null;
}

/**
 * Every non-empty `props.src` of every asset record in a snapshot (data: URLs included;
 * callers filter). Tolerates `{}` and garbage.
 * @param {unknown} snapshot
 * @returns {string[]}
 */
export function assetSrcsOf(snapshot) {
  const store = storeOf(snapshot);
  if (!store) return [];
  /** @type {string[]} */
  const out = [];
  for (const record of Object.values(store)) {
    if (!record || typeof record !== "object" || record.typeName !== "asset") continue;
    const props = record.props;
    const src = props && typeof props === "object" ? props.src : undefined;
    if (typeof src === "string" && src.length > 0) out.push(src);
  }
  return out;
}

/**
 * @param {GcObject} obj
 * @param {number} now
 * @param {number} minAgeMs
 */
export function isOldEnough(obj, now, minAgeMs) {
  if (!obj.created_at) return true; // no timestamp: cannot be a fresh upload we are racing
  const t = Date.parse(obj.created_at);
  if (!Number.isFinite(t)) return true;
  return now - t >= minAgeMs;
}

/**
 * Decide which objects are garbage. Pure.
 *
 * @param {{
 *   objects: GcObject[],
 *   registeredPaths?: Set<string> | Iterable<string>,
 *   referencedUrls?: Set<string> | Iterable<string>,
 *   trainingRefs?: Set<string> | Iterable<string>,
 *   now?: number,
 *   minAgeMs?: number,
 * }} input
 * @returns {GcPlan}
 */
export function planGc(input) {
  const now = input.now ?? Date.now();
  const minAgeMs = input.minAgeMs ?? DEFAULT_MIN_AGE_MS;
  const registered = new Set(input.registeredPaths ?? []);
  const referenced = referencedPaths(input.referencedUrls ?? [], BOARD_ASSETS_BUCKET);
  const training = referencedPaths(input.trainingRefs ?? [], TRAINING_DATA_BUCKET);

  /** @type {GcPlan} */
  const plan = { scanned: 0, orphans: [], keep: 0, young: 0, bytes: 0 };
  for (const obj of input.objects) {
    plan.scanned++;
    /** @type {GcOrphan['reason'] | null} */
    let reason = null;
    if (obj.bucket === BOARD_ASSETS_BUCKET) {
      // Registered (board_assets) or referenced by a live snapshot (legacy rows that
      // predate the registry, or a registry insert that failed) both mean "keep".
      reason = registered.has(obj.name) || referenced.has(obj.name) ? null : "unregistered";
    } else if (obj.bucket === TRAINING_DATA_BUCKET) {
      reason = training.has(obj.name) ? null : "unreferenced";
    } else {
      // Unknown bucket: never touch it.
      reason = null;
    }
    if (!reason) {
      plan.keep++;
      continue;
    }
    if (!isOldEnough(obj, now, minAgeMs)) {
      plan.young++;
      plan.keep++;
      continue;
    }
    plan.orphans.push({ ...obj, reason });
    plan.bytes += Number.isFinite(obj.size) ? obj.size : 0;
  }
  return plan;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
export function chunk(items, size) {
  if (!Number.isInteger(size) || size <= 0) throw new Error("chunk: size must be a positive integer");
  /** @type {T[][]} */
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** @param {number} n */
export function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ---------------------------------------------------------------- HTTP client

/**
 * @typedef {{ status: number, body: any }} HttpResult
 * @typedef {{
 *   baseUrl: string,
 *   listObjects(bucket: string): Promise<GcObject[]>,
 *   listRegisteredPaths(): Promise<string[]>,
 *   listBoardAssetSrcs(): Promise<string[]>,
 *   listTrainingRefs(): Promise<string[]>,
 *   deleteObjects(bucket: string, names: string[]): Promise<HttpResult>,
 * }} GcClient
 */

/**
 * @param {Response} res
 * @returns {Promise<HttpResult>}
 */
async function toResult(res) {
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  return { status: res.status, body };
}

/**
 * Service-role PostgREST + Storage client. Refuses to be built without a key: every
 * call reads or deletes across all users' folders and bypasses RLS.
 * @param {{ url: string, serviceKey: string, fetchImpl?: typeof fetch, pageSize?: number }} cfg
 * @returns {GcClient}
 */
export function createGcClient(cfg) {
  if (!cfg.url || !cfg.serviceKey) throw new Error("createGcClient: url and serviceKey are required");
  const base = cfg.url.replace(/\/$/, "");
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const rowsPageSize = cfg.pageSize ?? ROWS_PAGE_SIZE;
  /** @param {Record<string, string>} [extra] */
  const headers = (extra = {}) => ({ apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, ...extra });

  /** @param {HttpResult} r @param {string} what */
  const ensureOk = (r, what) => {
    if (r.status < 200 || r.status >= 300) throw new Error(`${what} failed (${r.status}): ${JSON.stringify(r.body)}`);
  };

  /**
   * @param {string} table
   * @param {string} select
   * @param {(row: any) => void} onRow
   */
  async function eachRow(table, select, onRow) {
    let offset = 0;
    for (;;) {
      const qs = new URLSearchParams({ select, order: "id.asc", limit: String(rowsPageSize), offset: String(offset) });
      const res = await fetchImpl(`${base}/rest/v1/${table}?${qs}`, { headers: headers({ Accept: "application/json" }) });
      const r = await toResult(res);
      ensureOk(r, `list ${table}`);
      const rows = Array.isArray(r.body) ? r.body : [];
      for (const row of rows) onRow(row);
      if (rows.length < rowsPageSize) return;
      offset += rowsPageSize;
    }
  }

  /**
   * The list endpoint is one level deep: entries without an `id` are folders whose
   * `name` is the next path segment. Recurse and page through each level.
   * @param {string} bucket
   * @param {string} prefix
   * @param {GcObject[]} out
   */
  async function listLevel(bucket, prefix, out) {
    let offset = 0;
    for (;;) {
      const res = await fetchImpl(`${base}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json", Accept: "application/json" }),
        body: JSON.stringify({ prefix, limit: LIST_PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } }),
      });
      const r = await toResult(res);
      ensureOk(r, `list storage ${bucket}/${prefix}`);
      const entries = Array.isArray(r.body) ? r.body : [];
      for (const e of entries) {
        if (!e || typeof e.name !== "string" || e.name === ".emptyFolderPlaceholder") continue;
        const full = `${prefix}${e.name}`;
        if (e.id === null || e.id === undefined) {
          await listLevel(bucket, `${full}/`, out);
          continue;
        }
        const size = Number(e.metadata?.size ?? e.metadata?.contentLength ?? 0);
        out.push({ bucket, name: full, created_at: typeof e.created_at === "string" ? e.created_at : null, size: Number.isFinite(size) ? size : 0 });
      }
      if (entries.length < LIST_PAGE_SIZE) return;
      offset += LIST_PAGE_SIZE;
    }
  }

  return {
    baseUrl: base,
    async listObjects(bucket) {
      /** @type {GcObject[]} */
      const out = [];
      await listLevel(bucket, "", out);
      return out;
    },
    async listRegisteredPaths() {
      /** @type {string[]} */
      const out = [];
      await eachRow("board_assets", "id,object_path", (row) => {
        if (typeof row?.object_path === "string") out.push(row.object_path);
      });
      return out;
    },
    async listBoardAssetSrcs() {
      /** @type {string[]} */
      const out = [];
      await eachRow("whiteboards", "id,data", (row) => out.push(...assetSrcsOf(row?.data)));
      return out;
    },
    async listTrainingRefs() {
      /** @type {string[]} */
      const out = [];
      await eachRow("training_samples", "id,before_url,after_full_url", (row) => {
        if (typeof row?.before_url === "string") out.push(row.before_url);
        if (typeof row?.after_full_url === "string") out.push(row.after_full_url);
      });
      return out;
    },
    async deleteObjects(bucket, names) {
      const res = await fetchImpl(`${base}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: headers({ "Content-Type": "application/json", Accept: "application/json" }),
        body: JSON.stringify({ prefixes: names }),
      });
      return toResult(res);
    },
  };
}

// ---------------------------------------------------------------- orchestration

/**
 * @typedef {{
 *   apply?: boolean,
 *   buckets?: readonly string[],
 *   minAgeMs?: number,
 *   now?: number,
 *   batchSize?: number,
 *   log?: (line: string) => void,
 * }} GcOptions
 * @typedef {{ bucket: string, names: string[], error: string }} GcFailure
 * @typedef {{
 *   scanned: number,
 *   orphans: number,
 *   deleted: number,
 *   failed: number,
 *   bytes: number,
 *   dryRun: boolean,
 *   minAgeMs: number,
 *   buckets: Record<string, { scanned: number, orphans: number, deleted: number, bytes: number }>,
 *   items: GcOrphan[],
 *   failures: GcFailure[],
 * }} GcSummary
 */

/**
 * Load references, list every bucket, plan, and (with `apply`) delete in batches.
 * Never throws for a failed delete batch: it is counted in `failed` / `failures`.
 * Reference loading and listing errors DO throw (deleting against a partial
 * reference set would collect live images).
 * @param {GcClient} client
 * @param {GcOptions} [opts]
 * @returns {Promise<GcSummary>}
 */
export async function runGc(client, opts = {}) {
  const log = opts.log ?? (() => {});
  const buckets = opts.buckets ?? GC_BUCKETS;
  const minAgeMs = opts.minAgeMs ?? DEFAULT_MIN_AGE_MS;
  const batchSize = opts.batchSize ?? DELETE_BATCH_SIZE;
  const apply = Boolean(opts.apply);

  const [registeredPaths, referencedUrls, trainingRefs] = await Promise.all([
    buckets.includes(BOARD_ASSETS_BUCKET) ? client.listRegisteredPaths() : Promise.resolve([]),
    buckets.includes(BOARD_ASSETS_BUCKET) ? client.listBoardAssetSrcs() : Promise.resolve([]),
    buckets.includes(TRAINING_DATA_BUCKET) ? client.listTrainingRefs() : Promise.resolve([]),
  ]);
  log(`references: ${registeredPaths.length} board_assets row(s), ${referencedUrls.length} asset src(s) in whiteboards.data, ${trainingRefs.length} training url(s)`);

  /** @type {GcSummary} */
  const summary = {
    scanned: 0,
    orphans: 0,
    deleted: 0,
    failed: 0,
    bytes: 0,
    dryRun: !apply,
    minAgeMs,
    buckets: {},
    items: [],
    failures: [],
  };

  for (const bucket of buckets) {
    const objects = await client.listObjects(bucket);
    const plan = planGc({ objects, registeredPaths, referencedUrls, trainingRefs, now: opts.now, minAgeMs });
    log(`${bucket}: ${plan.scanned} object(s), ${plan.orphans.length} orphan(s) (${fmtBytes(plan.bytes)}), ${plan.young} too young to collect`);
    const perBucket = { scanned: plan.scanned, orphans: plan.orphans.length, deleted: 0, bytes: plan.bytes };
    summary.scanned += plan.scanned;
    summary.orphans += plan.orphans.length;
    summary.bytes += plan.bytes;
    summary.items.push(...plan.orphans);

    if (apply && plan.orphans.length > 0) {
      for (const batch of chunk(plan.orphans, batchSize)) {
        const names = batch.map((o) => o.name);
        try {
          const r = await client.deleteObjects(bucket, names);
          if (r.status < 200 || r.status >= 300) throw new Error(`delete failed (${r.status}): ${JSON.stringify(r.body)}`);
          perBucket.deleted += names.length;
          log(`${bucket}: deleted ${names.length} object(s)`);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          summary.failed += names.length;
          summary.failures.push({ bucket, names, error });
          log(`${bucket}: FAILED to delete ${names.length} object(s): ${error}`);
        }
      }
    }
    summary.deleted += perBucket.deleted;
    summary.buckets[bucket] = perBucket;
  }
  return summary;
}

/**
 * Human-readable table + totals for the CLI.
 * @param {GcSummary} s
 */
export function formatGcSummary(s) {
  const lines = [];
  if (s.items.length > 0) {
    const width = Math.min(90, Math.max(...s.items.map((o) => o.name.length)));
    lines.push(`${"BUCKET".padEnd(14)} ${"OBJECT".padEnd(width)} ${"SIZE".padStart(10)}  ${"CREATED".padEnd(20)} REASON`);
    for (const o of s.items) {
      const created = o.created_at ? o.created_at.slice(0, 19).replace("T", " ") : "-";
      lines.push(`${o.bucket.padEnd(14)} ${o.name.padEnd(width)} ${fmtBytes(o.size).padStart(10)}  ${created.padEnd(20)} ${o.reason}`);
    }
    lines.push("");
  }
  for (const f of s.failures) lines.push(`FAILED ${f.bucket}: ${f.names.length} object(s): ${f.error}`);
  if (s.failures.length) lines.push("");
  const verb = s.dryRun ? "would be deleted" : "deleted";
  lines.push(
    `${s.dryRun ? "[dry-run] " : ""}scanned ${s.scanned} object(s) in ${Object.keys(s.buckets).join(", ") || "no buckets"}: ` +
      `${s.orphans} orphan(s) (${fmtBytes(s.bytes)}) ${verb}` +
      (s.dryRun ? "" : ` - ${s.deleted} deleted, ${s.failed} failed`) +
      ` (min age ${Math.round(s.minAgeMs / 3600000 * 10) / 10} h)`,
  );
  return lines.join("\n");
}
