/**
 * Server side of Storage garbage collection (GET/POST /api/admin/gc).
 *
 * Planning, listing and deleting live in scripts/lib/storageGc.mjs so the
 * operator CLI (scripts/gc-storage.mjs) and the cron route run identical code.
 * This module only adds the env plumbing the route is not allowed to do itself
 * (routeProtection.test.ts forbids `process.env` in route files).
 */
import { getServerEnv, isPlaceholderValue } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  DEFAULT_MIN_AGE_MS,
  createGcClient,
  runGc,
  type GcClient,
  type GcSummary,
} from "../../../scripts/lib/storageGc.mjs";

export const gcLogger = logger.child({ module: "storage-gc" });

export type GcEnv = {
  /** Project URL (always set: the app refuses to start without it). */
  url: string;
  /** Service role key; the route answers 503 without it. */
  serviceKey: string | undefined;
  /** Shared secret Vercel sends as `Authorization: Bearer <CRON_SECRET>`; 503 without it. */
  cronSecret: string | undefined;
};

/**
 * Normalise a raw `CRON_SECRET` value: empty / placeholder (`your-...`) counts as unset,
 * surrounding whitespace is dropped. The zod schema in src/lib/env.ts already applies the
 * placeholder rule; this keeps the trim for values passed straight from tests.
 */
export function readCronSecret(raw: string | undefined): string | undefined {
  if (raw === undefined || isPlaceholderValue(raw)) return undefined;
  return raw.trim();
}

export function getGcEnv(): GcEnv {
  const env = getServerEnv();
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    cronSecret: readCronSecret(env.CRON_SECRET),
  };
}

/**
 * Constant-time comparison of the presented bearer token with the configured secret.
 * Both are short ASCII strings; compare code units after padding to equal length so
 * the loop count never depends on the secret.
 */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const presented = m[1].trim();
  const len = Math.max(presented.length, secret.length);
  let diff = presented.length ^ secret.length;
  for (let i = 0; i < len; i++) {
    diff |= (presented.charCodeAt(i) || 0) ^ (secret.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export type RunStorageGcOptions = {
  url: string;
  serviceKey: string;
  dryRun: boolean;
  minAgeMs?: number;
  /** Tests only: bypass the network. */
  client?: GcClient;
  fetchImpl?: typeof fetch;
};

/** Run one GC pass with the service role. Throws when references or listings cannot be loaded. */
export async function runStorageGc(opts: RunStorageGcOptions): Promise<GcSummary> {
  const client = opts.client ?? createGcClient({ url: opts.url, serviceKey: opts.serviceKey, fetchImpl: opts.fetchImpl });
  return runGc(client, {
    apply: !opts.dryRun,
    minAgeMs: opts.minAgeMs ?? DEFAULT_MIN_AGE_MS,
    log: (line) => gcLogger.debug(line),
  });
}

/** Public shape of the route's 200 body (additive fields allowed). */
export type GcResponseBody = {
  scanned: number;
  orphans: number;
  deleted: number;
  bytes: number;
  dryRun: boolean;
  failed: number;
  buckets: GcSummary["buckets"];
};

export function toResponseBody(summary: GcSummary): GcResponseBody {
  return {
    scanned: summary.scanned,
    orphans: summary.orphans,
    deleted: summary.deleted,
    bytes: summary.bytes,
    dryRun: summary.dryRun,
    failed: summary.failed,
    buckets: summary.buckets,
  };
}
