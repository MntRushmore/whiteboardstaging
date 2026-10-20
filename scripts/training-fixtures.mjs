#!/usr/bin/env node
/**
 * Pull the Training Center's regression cases into the iPad app's test suite: every training_cases
 * row with `regression = true` and a `fixture` (supabase/migrations/20261020000000_training_center.sql)
 * becomes one JSON file, the fixture verbatim (pretty-printed), at
 *
 *   ios/Packages/AgathonLive/Tests/AgathonLiveTests/Fixtures/training/<case_key>-<first 8 of id>.json
 *
 *   npm run training:fixtures [-- --out <dir>] [-- --prod]
 *
 *   --out <dir>   write somewhere else (relative to the repo root, or absolute)
 *   --prod        read a project that is not on this machine (see below)
 *
 * Which project. By default the local stack only: NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY from the environment or .env.local (`npx supabase status` fills in what
 * is missing), and anything but a localhost / 127.0.0.1 URL is refused. The table is readable only
 * with the service role or an admin's token, and the service role reads everything, so production
 * takes both a flag and the key given on purpose: `--prod` with SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY set in the environment itself (.env.local is not read then):
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> \
 *     node scripts/training-fixtures.mjs --prod
 *
 * It only reads. A file already there for the same case is overwritten (same name: same case); a
 * case no longer marked leaves its old file behind, for git to show and the owner to delete. A
 * case_key is cut to letters, digits, `.`, `_` and `-` in the file name, so a key can never name a
 * path outside the folder.
 *
 * Exit codes: 0 done (also with nothing to write), 1 the read or a write failed, 2 usage or config.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isLoopbackUrl, loadDotEnvLocal, resolveSupabaseEnv, toResult } from "./lib/supabaseHttp.mjs";

export const USAGE = "usage: node scripts/training-fixtures.mjs [--out <dir>] [--prod]";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the iPad app's tests read the training fixtures (repo-relative). */
export const DEFAULT_OUT = "ios/Packages/AgathonLive/Tests/AgathonLiveTests/Fixtures/training";

/** Rows per request (PostgREST's own cap on a hosted project is 1000). */
export const PAGE = 200;
/** Pages read at most: a guard against an API that never ends its list. */
const MAX_PAGES = 1000;

/**
 * Parse CLI arguments. Throws on an unknown flag or a `--out` without a folder.
 * @param {string[]} argv
 * @returns {{ out: string, prod: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  let out = DEFAULT_OUT;
  let prod = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--prod") prod = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--out") {
      const next = argv[++i];
      if (!next || next.startsWith("-")) throw new Error("--out needs a folder");
      out = next;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return { out, prod, help };
}

/**
 * The project to read and the key to read it with, or why not.
 * Without `prod`: the resolved local settings, refused unless the URL is on this machine.
 * With `prod`: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from `env` (the real environment), both required.
 * @param {{ prod: boolean, env: Record<string, string | undefined>, local: { url?: string, serviceKey?: string } }} cfg
 * @returns {{ url: string, serviceKey: string } | { error: string }}
 */
export function resolveTarget({ prod, env, local }) {
  if (prod) {
    const url = env.SUPABASE_URL?.trim();
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !serviceKey) return { error: "--prod needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in the environment itself (.env.local is not read for --prod)." };
    return { url, serviceKey };
  }
  if (!local.url || !local.serviceKey) {
    return { error: "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: set them in .env.local, or start the local stack with `npx supabase start`." };
  }
  if (!isLoopbackUrl(local.url)) {
    return { error: `Refusing ${local.url}: not the local stack. To read another project on purpose, pass --prod with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.` };
  }
  return { url: local.url, serviceKey: local.serviceKey };
}

/**
 * `<case_key>-<first 8 of id>.json`, the key cut to a safe file name (letters, digits, `.`, `_`, `-`;
 * anything else a `-`; no leading dot), so no key can reach outside the folder.
 * @param {{ id: string, case_key: string }} row
 */
export function fixtureFileName(row) {
  const key = String(row.case_key).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 120) || "case";
  const id = String(row.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
  return `${key}-${id}.json`;
}

/**
 * Every regression case with a fixture, oldest first, page by page with the service role.
 * @param {{ url: string, serviceKey: string, fetchImpl?: typeof fetch }} cfg
 * @returns {Promise<Array<{ id: string, case_key: string, fixture: unknown }>>}
 */
export async function fetchFixtureRows({ url, serviceKey, fetchImpl = fetch }) {
  const base = `${url.replace(/\/+$/, "")}/rest/v1/training_cases`;
  /** @type {Array<{ id: string, case_key: string, fixture: unknown }>} */
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      select: "id,case_key,fixture",
      regression: "is.true",
      fixture: "not.is.null",
      order: "created_at.asc,id.asc",
      limit: String(PAGE),
      offset: String(page * PAGE),
    });
    const res = await fetchImpl(`${base}?${query}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" },
    });
    const out = await toResult(res);
    if (out.status !== 200 || !Array.isArray(out.body)) {
      throw new Error(`reading training_cases failed (${out.status}): ${JSON.stringify(out.body).slice(0, 200)}`);
    }
    rows.push(...out.body);
    if (out.body.length < PAGE) return rows;
  }
  return rows;
}

/**
 * Write each row's fixture, verbatim and pretty-printed, into `dir` (created when missing).
 * @param {Array<{ id: string, case_key: string, fixture: unknown }>} rows
 * @param {string} dir
 * @returns {string[]} the files written
 */
export function writeFixtures(rows, dir) {
  mkdirSync(dir, { recursive: true });
  return rows.map((row) => {
    const file = join(dir, fixtureFileName(row));
    writeFileSync(file, `${JSON.stringify(row.fixture, null, 2)}\n`);
    return file;
  });
}

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  /** @type {{ out: string, prod: boolean, help: boolean }} */
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    process.exit(2);
  }
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  // read before .env.local can fill them in: --prod takes the key only from the real environment
  const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  /** @type {{ url?: string, serviceKey?: string }} */
  let local = {};
  if (!args.prod) {
    loadDotEnvLocal(REPO_ROOT);
    const resolved = resolveSupabaseEnv(process.env);
    local = { url: resolved.url, serviceKey: resolved.serviceKey };
  }
  const target = resolveTarget({ prod: args.prod, env, local });
  if ("error" in target) {
    console.error(target.error);
    process.exit(2);
  }
  const outDir = isAbsolute(args.out) ? args.out : join(REPO_ROOT, args.out);
  console.log(`Source: ${target.url}${isLoopbackUrl(target.url) ? " (local)" : " (NOT local)"}`);

  try {
    const rows = await fetchFixtureRows(target);
    if (rows.length === 0) {
      console.log("No regression cases with a fixture: nothing written.");
      process.exit(0);
    }
    const files = writeFixtures(rows, outDir);
    for (const file of files) console.log(`wrote ${file}`);
    console.log(`${files.length} fixture${files.length === 1 ? "" : "s"} in ${outDir}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
