#!/usr/bin/env node
/**
 * Admin GC: delete Storage objects in `board-assets` / `training-data` that no
 * board_assets row, whiteboards.data asset src, or training_samples row references.
 *
 *   node scripts/gc-storage.mjs [--dry-run] [--apply] [--bucket <name>] [--min-age-hours N] [--json]
 *
 *   --dry-run          (default) list orphans, delete nothing
 *   --apply            delete the orphans in batches of 100
 *   --bucket <name>    only this bucket (board-assets | training-data); repeatable
 *   --min-age-hours N  only collect objects at least N hours old (default 24; 0 = everything)
 *   --json             print the summary as JSON instead of a table
 *
 * Env (read from .env.local when not already set):
 *   NEXT_PUBLIC_SUPABASE_URL     project URL
 *   SUPABASE_SERVICE_ROLE_KEY    REQUIRED - listing and deleting span every user's folder
 *
 * Exit codes: 0 all good (or dry run), 1 some deletes failed / fatal, 2 usage or config error.
 * The same planning + client code runs behind GET/POST /api/admin/gc (Vercel cron).
 */
import { pathToFileURL } from "node:url";
import { loadDotEnvLocal } from "./lib/supabaseHttp.mjs";
import { DEFAULT_MIN_AGE_MS, GC_BUCKETS, createGcClient, formatGcSummary, runGc } from "./lib/storageGc.mjs";

/**
 * Parse CLI flags. Throws on unknown flags or malformed values.
 * @param {string[]} argv
 * @returns {{ apply: boolean, buckets: string[], minAgeMs: number, json: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  const out = { apply: false, buckets: /** @type {string[]} */ ([]), minAgeMs: DEFAULT_MIN_AGE_MS, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.apply = false;
    else if (a === "--apply") out.apply = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--bucket") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error("--bucket requires a bucket name");
      if (!GC_BUCKETS.includes(v)) throw new Error(`--bucket must be one of ${GC_BUCKETS.join(", ")}`);
      if (!out.buckets.includes(v)) out.buckets.push(v);
    } else if (a === "--min-age-hours") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0) throw new Error("--min-age-hours requires a number >= 0");
      out.minAgeMs = Math.round(v * 3600_000);
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (out.buckets.length === 0) out.buckets = [...GC_BUCKETS];
  return out;
}

export const USAGE = "usage: node scripts/gc-storage.mjs [--dry-run] [--apply] [--bucket <name>] [--min-age-hours N] [--json]";

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  loadDotEnvLocal();
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    process.exit(2);
  }
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Refusing to run: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required.\n" +
        "This script lists and deletes objects in every user's storage folder and bypasses RLS, so it only runs with the service role.\n" +
        "Locally: eval \"$(npx supabase status -o env | sed 's/^/export /')\" then SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY NEXT_PUBLIC_SUPABASE_URL=$API_URL node scripts/gc-storage.mjs --dry-run",
    );
    process.exit(2);
  }
  if (!args.json) {
    console.log(
      `Target: ${url} ${args.apply ? "(APPLY: orphans will be deleted)" : "(dry run, no deletes)"} buckets=${args.buckets.join(",")} min-age=${args.minAgeMs / 3600_000}h`,
    );
  }
  const client = createGcClient({ url, serviceKey });
  let summary;
  try {
    summary = await runGc(client, { apply: args.apply, buckets: args.buckets, minAgeMs: args.minAgeMs, log: args.json ? undefined : (line) => console.log(line) });
  } catch (err) {
    console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("");
    console.log(formatGcSummary(summary));
  }
  process.exit(summary.failed === 0 ? 0 : 1);
}
