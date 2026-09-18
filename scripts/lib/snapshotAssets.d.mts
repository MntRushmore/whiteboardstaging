/**
 * Type declarations for scripts/lib/snapshotAssets.mjs (shared contract).
 * Import from src/ as '../../../scripts/lib/snapshotAssets.mjs'.
 *
 * Named `.d.mts` (not `.d.ts`): TypeScript resolves an import of `x.mjs` to a sibling
 * `x.d.mts`, so this file is what src/ sees; the JSDoc in the .mjs is for node/vitest.
 */

export interface ParsedDataUrl {
  mime: string;
  base64: string;
  bytes: Uint8Array;
}

export interface InlineAsset {
  /** tldraw record id, e.g. 'asset:abc123' */
  id: string;
  /** the full data: URL */
  src: string;
  /** mime from the data URL (falls back to props.mimeType, then '') */
  mimeType: string;
  /** props.name or '' */
  name: string;
  /** decoded payload size in bytes (0 when undecodable) */
  bytes: number;
}

export type AssetExt = "png" | "jpg" | "webp" | "gif" | "svg" | "bin";

export declare const SNAPSHOT_LIMITS: Readonly<{
  softBytes: 1_500_000;
  hardBytes: 4_000_000;
  dbBytes: 8_000_000;
}>;

export declare function parseDataUrl(src: unknown): ParsedDataUrl | null;
export declare function extForMime(mime: string): AssetExt;
export declare function assetObjectPath(userId: string, boardId: string, assetId: string, mime: string): string;
export declare function findInlineAssets(snapshot: unknown): InlineAsset[];
export declare function rewriteAssetSrcs<T>(snapshot: T, srcById: Record<string, string>): T;
export declare function snapshotJsonBytes(snapshot: unknown): number;
