/**
 * Pure helpers for moving inline (data: URL) tldraw assets out of whiteboard
 * snapshots and into Supabase Storage.
 *
 * Plain ESM, no dependencies, no I/O. Shared by:
 *   - scripts/offload-assets.mjs        (admin migration of existing rows)
 *   - src/ (board page / asset store)   via '../../../scripts/lib/snapshotAssets.mjs'
 *
 * Snapshot shapes handled everywhere:
 *   TLEditorSnapshot  { document: { store, schema }, session }
 *   TLStoreSnapshot   { store, schema }
 */

/** Byte budgets for a serialized whiteboards.data snapshot. */
export const SNAPSHOT_LIMITS = Object.freeze({
  /** Warn / start offloading above this. */
  softBytes: 1_500_000,
  /** Client refuses to autosave above this until assets are offloaded. */
  hardBytes: 4_000_000,
  /** Matches the DB check constraint whiteboards_data_size (8 MB = 8_388_608). */
  dbBytes: 8_000_000,
});

const DATA_URL_RE = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s;

/**
 * Parse a base64 data: URL.
 * @param {unknown} src
 * @returns {{ mime: string, base64: string, bytes: Uint8Array } | null}
 */
export function parseDataUrl(src) {
  if (typeof src !== "string") return null;
  const m = DATA_URL_RE.exec(src.trim());
  if (!m) return null;
  const mime = (m[1] || "").trim().toLowerCase();
  const params = m[2].split(";").filter(Boolean).map((p) => p.trim().toLowerCase());
  if (!mime || !mime.includes("/")) return null;
  if (!params.includes("base64")) return null;
  const base64 = m[3].replace(/\s+/g, "");
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) return null;
  let bytes;
  try {
    bytes = base64ToBytes(base64);
  } catch {
    return null;
  }
  return { mime, base64, bytes };
}

/**
 * @param {string} base64
 * @returns {Uint8Array}
 */
function base64ToBytes(base64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(base64, "base64"));
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @param {string} mime
 * @returns {'png'|'jpg'|'webp'|'gif'|'svg'|'bin'}
 */
export function extForMime(mime) {
  switch (String(mime || "").toLowerCase().split(";")[0].trim()) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
}

const SAFE_SEGMENT_RE = /[^A-Za-z0-9_-]/g;

/**
 * Reduce an arbitrary string to a single safe path segment (no slashes, dots, spaces).
 * @param {string} value
 */
function safeSegment(value) {
  const cleaned = String(value).replace(SAFE_SEGMENT_RE, "_");
  return cleaned.replace(/^_+|_+$/g, "") || "_";
}

/**
 * Storage object path for one asset: '<userId>/<boardId>/<assetId>.<ext>'.
 * The 'asset:' prefix tldraw puts on ids is dropped; every segment is reduced to
 * [A-Za-z0-9_-] so path traversal ('..', '/') is impossible.
 * @param {string} userId
 * @param {string} boardId
 * @param {string} assetId
 * @param {string} mime
 * @returns {string}
 */
export function assetObjectPath(userId, boardId, assetId, mime) {
  if (!userId || !boardId || !assetId) throw new Error("assetObjectPath: userId, boardId and assetId are required");
  const bareId = String(assetId).replace(/^asset:/, "");
  return `${safeSegment(userId)}/${safeSegment(boardId)}/${safeSegment(bareId)}.${extForMime(mime)}`;
}

/**
 * Locate the record map inside either snapshot shape.
 * @param {any} snapshot
 * @returns {Record<string, any> | null}
 */
function storeOf(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  if (snapshot.document && typeof snapshot.document === "object" && snapshot.document.store && typeof snapshot.document.store === "object") {
    return snapshot.document.store;
  }
  if (snapshot.store && typeof snapshot.store === "object") return snapshot.store;
  return null;
}

/**
 * @typedef {{ id: string, src: string, mimeType: string, name: string, bytes: number }} InlineAsset
 */

/**
 * Every asset record whose props.src is an inline data: URL.
 * `bytes` is the decoded payload size (0 when the URL cannot be decoded);
 * `mimeType` prefers the data URL's own mime, then props.mimeType.
 * @param {unknown} snapshot
 * @returns {InlineAsset[]}
 */
export function findInlineAssets(snapshot) {
  const store = storeOf(snapshot);
  if (!store) return [];
  /** @type {InlineAsset[]} */
  const out = [];
  for (const [key, record] of Object.entries(store)) {
    if (!record || typeof record !== "object" || record.typeName !== "asset") continue;
    const props = record.props;
    const src = props && typeof props === "object" ? props.src : undefined;
    if (typeof src !== "string" || !src.startsWith("data:")) continue;
    const parsed = parseDataUrl(src);
    out.push({
      id: typeof record.id === "string" ? record.id : key,
      src,
      mimeType: parsed?.mime || (typeof props.mimeType === "string" ? props.mimeType : "") || "",
      name: typeof props.name === "string" ? props.name : "",
      bytes: parsed ? parsed.bytes.byteLength : 0,
    });
  }
  return out;
}

/**
 * Return a snapshot whose asset records listed in `srcById` have props.src replaced.
 * Pure: the input is never mutated, untouched records keep their identity, and
 * unknown ids are ignored.
 * @template T
 * @param {T} snapshot
 * @param {Record<string, string>} srcById
 * @returns {T}
 */
export function rewriteAssetSrcs(snapshot, srcById) {
  const store = storeOf(snapshot);
  if (!store || !srcById) return snapshot;
  let changed = false;
  /** @type {Record<string, any>} */
  const nextStore = {};
  for (const [key, record] of Object.entries(store)) {
    const id = record && typeof record === "object" && typeof record.id === "string" ? record.id : key;
    const next = srcById[id] ?? srcById[key];
    if (record && typeof record === "object" && record.typeName === "asset" && typeof next === "string" && record.props?.src !== next) {
      nextStore[key] = { ...record, props: { ...record.props, src: next } };
      changed = true;
    } else {
      nextStore[key] = record;
    }
  }
  if (!changed) return snapshot;
  const s = /** @type {any} */ (snapshot);
  if (s.document && s.document.store === store) {
    return { ...s, document: { ...s.document, store: nextStore } };
  }
  return { ...s, store: nextStore };
}

/**
 * UTF-8 byte length of JSON.stringify(snapshot) — what Postgres' octet_length(data::text) sees (approximately).
 * @param {unknown} snapshot
 * @returns {number}
 */
export function snapshotJsonBytes(snapshot) {
  const json = JSON.stringify(snapshot);
  if (json === undefined) return 0;
  if (typeof Buffer !== "undefined") return Buffer.byteLength(json, "utf8");
  return new TextEncoder().encode(json).byteLength;
}
