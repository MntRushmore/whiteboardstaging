/**
 * Type declarations for scripts/lib/storageGc.mjs (see snapshotAssets.d.mts for why `.d.mts`).
 * Import from src/ as '../../../scripts/lib/storageGc.mjs'.
 */

export interface GcObject {
  bucket: string;
  /** Full object path inside the bucket, e.g. '<uid>/<boardId>/<assetId>.png'. */
  name: string;
  created_at: string | null;
  size: number;
}

export type GcOrphanReason = "unregistered" | "unreferenced";

export interface GcOrphan extends GcObject {
  reason: GcOrphanReason;
}

export interface GcPlan {
  scanned: number;
  orphans: GcOrphan[];
  keep: number;
  /** Unreferenced objects kept only because they are younger than minAgeMs. */
  young: number;
  /** Sum of orphan sizes. */
  bytes: number;
}

export interface PlanGcInput {
  objects: GcObject[];
  registeredPaths?: Iterable<string>;
  referencedUrls?: Iterable<string>;
  trainingRefs?: Iterable<string>;
  now?: number;
  minAgeMs?: number;
}

export interface HttpResult {
  status: number;
  body: unknown;
}

export interface GcClient {
  baseUrl: string;
  listObjects(bucket: string): Promise<GcObject[]>;
  listRegisteredPaths(): Promise<string[]>;
  listBoardAssetSrcs(): Promise<string[]>;
  listTrainingRefs(): Promise<string[]>;
  deleteObjects(bucket: string, names: string[]): Promise<HttpResult>;
}

export interface GcOptions {
  apply?: boolean;
  buckets?: readonly string[];
  minAgeMs?: number;
  now?: number;
  batchSize?: number;
  log?: (line: string) => void;
}

export interface GcFailure {
  bucket: string;
  names: string[];
  error: string;
}

export interface GcBucketSummary {
  scanned: number;
  orphans: number;
  deleted: number;
  bytes: number;
}

export interface GcSummary {
  scanned: number;
  orphans: number;
  deleted: number;
  failed: number;
  bytes: number;
  dryRun: boolean;
  minAgeMs: number;
  buckets: Record<string, GcBucketSummary>;
  items: GcOrphan[];
  failures: GcFailure[];
}

export declare const BOARD_ASSETS_BUCKET: "board-assets";
export declare const TRAINING_DATA_BUCKET: "training-data";
export declare const GC_BUCKETS: readonly string[];
export declare const DEFAULT_MIN_AGE_MS: number;
export declare const DELETE_BATCH_SIZE: number;
export declare const LIST_PAGE_SIZE: number;
export declare const ROWS_PAGE_SIZE: number;

export declare function objectPathFromRef(ref: unknown, bucket: string): string | null;
export declare function referencedPaths(refs: Iterable<unknown>, bucket: string): Set<string>;
export declare function assetSrcsOf(snapshot: unknown): string[];
export declare function isOldEnough(obj: GcObject, now: number, minAgeMs: number): boolean;
export declare function planGc(input: PlanGcInput): GcPlan;
export declare function chunk<T>(items: T[], size: number): T[][];
export declare function fmtBytes(n: number): string;
export declare function createGcClient(cfg: { url: string; serviceKey: string; fetchImpl?: typeof fetch; pageSize?: number }): GcClient;
export declare function runGc(client: GcClient, opts?: GcOptions): Promise<GcSummary>;
export declare function formatGcSummary(s: GcSummary): string;
