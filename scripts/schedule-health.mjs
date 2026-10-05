#!/usr/bin/env node
/**
 * Schedules the health checks: pg_cron calls GET /api/admin/health every 5 minutes with
 * `Authorization: Bearer <CRON_SECRET>`. Vercel's plan allows only daily crons, so the schedule
 * lives in the Supabase project itself (pg_cron), and the HTTP call goes out through pg_net.
 *
 * Usage
 *   node scripts/schedule-health.mjs --ref <project-ref> --site <https://site> [--env-file <file>] [--dry-run]
 *   node scripts/schedule-health.mjs --ref <project-ref> --unschedule [--dry-run]
 *
 *   --ref <ref>        the Supabase project (else SUPABASE_PROJECT_REF, else the host of NEXT_PUBLIC_SUPABASE_URL)
 *   --site <url>       the deployment pg_cron calls (else NEXT_PUBLIC_SITE_URL)
 *   --secret <value>   CRON_SECRET (else the CRON_SECRET env var; prefer the env: an argument lands in shell history)
 *   --env-file <file>  KEY=VALUE lines to read first (e.g. from `vercel env pull`); never overrides the environment
 *   --dry-run          print the SQL, with the secret redacted, and touch nothing (needs no token, ref or secret)
 *   --unschedule       remove the job (the Vault secret stays; the next schedule updates it)
 *
 * What it runs, in order, through the Management API (`POST /v1/projects/<ref>/database/query`,
 * which runs SQL as postgres):
 *   1. `create extension if not exists` pg_cron (schema pg_catalog, as the dashboard does) and pg_net
 *      (schema extensions);
 *   2. CRON_SECRET into Supabase Vault as `agathon_cron_secret` (update if it exists, else create);
 *      two top-level statements, so pg_stat_statements keeps them with the value normalised away;
 *   3. the job `agathon-health` unscheduled if it exists, then scheduled again (idempotent: run it
 *      after every secret rotation or site change);
 *   4. the job's row, printed as proof.
 * The secret is never in the job's command (cron.job stores it in plain text): the command reads it
 * from vault.decrypted_secrets each time it runs, so rotating it is step 2 alone.
 *
 * The token is SUPABASE_ACCESS_TOKEN, else the macOS keychain item "Supabase CLI" (written by
 * `npx supabase login`: the plain `sbp_…` token, or `go-keyring-base64:<base64>` from older CLIs).
 * Nothing secret is printed: the dry run redacts CRON_SECRET, and an error from the API has it
 * replaced before it is shown.
 *
 * pg_net waits HTTP_TIMEOUT_MS for the answer (its default is 2 s, shorter than one check), and
 * keeps responses 6 hours in net._http_response: docs/RUNBOOK-ops.md has the queries to read them.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnvText } from "./lib/supabaseHttp.mjs";

export const JOB_NAME = "agathon-health";
export const SCHEDULE = "*/5 * * * *";
export const VAULT_SECRET_NAME = "agathon_cron_secret";
export const HEALTH_PATH = "/api/admin/health";
/** Longer than the route's maxDuration (60 s), so pg_net records the real answer. */
export const HTTP_TIMEOUT_MS = 65_000;
export const REDACTED = "<redacted CRON_SECRET>";
export const MANAGEMENT_API = "https://api.supabase.com";
const KEYCHAIN_SERVICE = "Supabase CLI";

const USAGE = `Usage:
  node scripts/schedule-health.mjs --ref <project-ref> --site <https://site> [--env-file <file>] [--dry-run]
  node scripts/schedule-health.mjs --ref <project-ref> --unschedule [--dry-run]
CRON_SECRET comes from the environment (or --env-file, or --secret). See the header of this file.`;

/** A SQL string literal. */
export function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * @param {string[]} argv
 * @returns {{ dryRun: boolean, unschedule: boolean, help: boolean, ref?: string, site?: string, secret?: string, envFile?: string }}
 */
export function parseArgs(argv) {
  /** @type {{ dryRun: boolean, unschedule: boolean, help: boolean, ref?: string, site?: string, secret?: string, envFile?: string }} */
  const out = { dryRun: false, unschedule: false, help: false };
  const valued = { "--ref": "ref", "--site": "site", "--secret": "secret", "--env-file": "envFile" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (name === "--dry-run") out.dryRun = true;
    else if (name === "--unschedule") out.unschedule = true;
    else if (name === "--help" || name === "-h") out.help = true;
    else if (name in valued) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
      out[valued[/** @type {keyof typeof valued} */ (name)]] = value;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

/** The route pg_cron calls, from a site origin. Throws for anything but an absolute http(s) URL that is safe inside SQL. */
export function healthUrl(site) {
  let url;
  try {
    url = new URL(String(site).trim());
  } catch {
    throw new Error(`--site is not an absolute URL: ${JSON.stringify(site)}`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))) {
    throw new Error(`--site must be https (http only for localhost): ${url.origin}`);
  }
  const base = url.origin + url.pathname.replace(/\/+$/, "");
  const full = `${base}${HEALTH_PATH}`;
  // It goes into SQL inside a dollar-quoted command; the URL parser already percent-encodes quotes.
  if (/['$\\]/.test(full)) throw new Error(`--site has characters that cannot go into the job: ${full}`);
  return full;
}

/**
 * A project ref: 20 lower-case letters and digits (the subdomain of <ref>.supabase.co).
 * @param {string | undefined} explicit
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveRef(explicit, env = process.env) {
  let ref = explicit ?? env.SUPABASE_PROJECT_REF;
  if (!ref && env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
      if (host.endsWith(".supabase.co")) ref = host.split(".")[0];
    } catch {
      /* not a URL */
    }
  }
  if (!ref) throw new Error("no project ref: pass --ref (or set SUPABASE_PROJECT_REF / NEXT_PUBLIC_SUPABASE_URL)");
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error(`not a Supabase project ref: ${JSON.stringify(ref)}`);
  return ref;
}

/**
 * CRON_SECRET, checked: present, not a placeholder, no whitespace or control characters.
 * @param {string | undefined} explicit
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveSecret(explicit, env = process.env) {
  const raw = explicit ?? env.CRON_SECRET;
  if (raw === undefined) throw new Error("CRON_SECRET is not set: export it, pass --env-file, or --secret");
  const secret = String(raw).trim();
  if (!secret) throw new Error("CRON_SECRET is empty (`vercel env pull` writes sensitive values as empty: take it from where it was created, or rotate it)");
  if (/^(your|replace|changeme|xxx|\.\.\.)/i.test(secret)) throw new Error("CRON_SECRET is still a placeholder");
  if (/[\s\x00-\x1f\x7f]/.test(secret)) throw new Error("CRON_SECRET has whitespace or control characters");
  return secret;
}

/** The job's command: an HTTP GET with the bearer read from Vault at run time (never the secret itself). */
export function cronCommand(url) {
  return [
    "select net.http_get(",
    `    url := ${sqlLiteral(url)},`,
    `    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = ${sqlLiteral(VAULT_SECRET_NAME)})),`,
    `    timeout_milliseconds := ${HTTP_TIMEOUT_MS}`,
    "  ) as request_id",
  ].join("\n");
}

/**
 * The statements, in order. `secret` is inlined only in the two Vault statements (pass REDACTED
 * for a dry run).
 * @param {{ unschedule: boolean, url?: string, secret?: string }} opts
 * @returns {Array<{ title: string, sql: string, verify?: boolean }>}
 */
export function buildSteps({ unschedule, url, secret }) {
  const name = sqlLiteral(JOB_NAME);
  const unscheduleStep = { title: `unschedule ${JOB_NAME} if it exists`, sql: `select cron.unschedule(jobid) from cron.job where jobname = ${name};` };
  const verifyStep = { title: "the job now", verify: true, sql: `select jobid, jobname, schedule, active, command from cron.job where jobname = ${name};` };
  if (unschedule) return [unscheduleStep, verifyStep];
  if (!url) throw new Error("no site URL");
  if (!secret) throw new Error("no CRON_SECRET");
  const secretName = sqlLiteral(VAULT_SECRET_NAME);
  return [
    { title: "enable pg_cron", sql: "create extension if not exists pg_cron with schema pg_catalog;" },
    { title: "enable pg_net", sql: "create extension if not exists pg_net with schema extensions;" },
    { title: `update the Vault secret ${VAULT_SECRET_NAME} (if it exists)`, sql: `select vault.update_secret(id, ${sqlLiteral(secret)}) from vault.secrets where name = ${secretName};` },
    {
      title: `create the Vault secret ${VAULT_SECRET_NAME} (if it does not)`,
      sql: `select vault.create_secret(${sqlLiteral(secret)}, ${secretName}, 'CRON_SECRET: pg_cron calls ${HEALTH_PATH} with it') where not exists (select 1 from vault.secrets where name = ${secretName});`,
    },
    unscheduleStep,
    { title: `schedule ${JOB_NAME} (${SCHEDULE})`, sql: `select cron.schedule(${name}, ${sqlLiteral(SCHEDULE)}, $cmd$\n  ${cronCommand(url)}\n$cmd$);` },
    verifyStep,
  ];
}

/** `text` with every occurrence of `secret` replaced (API errors can echo the statement). */
export function redact(text, secret) {
  return secret ? String(text).split(secret).join(REDACTED) : String(text);
}

/** The keychain item's value as the CLI wrote it: plain, or `go-keyring-base64:<base64>`. */
export function decodeKeychainToken(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const prefix = "go-keyring-base64:";
  return value.startsWith(prefix) ? Buffer.from(value.slice(prefix.length), "base64").toString("utf8").trim() || null : value;
}

function readKeychain() {
  if (process.platform !== "darwin") return null;
  const proc = spawnSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], { encoding: "utf8" });
  return proc.status === 0 ? decodeKeychainToken(proc.stdout) : null;
}

/**
 * SUPABASE_ACCESS_TOKEN, else the "Supabase CLI" keychain item.
 * @param {Record<string, string | undefined>} [env]
 * @param {() => string | null} [keychain]
 */
export function resolveToken(env = process.env, keychain = readKeychain) {
  const token = env.SUPABASE_ACCESS_TOKEN?.trim() || keychain();
  if (!token) throw new Error('no Management API token: set SUPABASE_ACCESS_TOKEN or run `npx supabase login` (keychain item "Supabase CLI")');
  return token;
}

/** One statement through the Management API. Answers the rows; throws with the secret redacted. */
export async function runQuery({ ref, token, sql, secret, fetchImpl = fetch }) {
  const res = await fetchImpl(`${MANAGEMENT_API}/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(redact(`Management API ${res.status}: ${text.slice(0, 500)}`, secret));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function loadEnvFile(path) {
  const text = readFileSync(resolve(path), "utf8");
  for (const [key, value] of Object.entries(parseEnvText(text))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** The script. Answers the exit code. */
export async function main(argv = process.argv.slice(2), { log = console.log, err = console.error, fetchImpl = fetch } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(`${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    log(USAGE);
    return 0;
  }
  try {
    if (args.envFile) loadEnvFile(args.envFile);
    const site = args.site ?? process.env.NEXT_PUBLIC_SITE_URL;
    if (!args.unschedule && !site) throw new Error("no site: pass --site (or set NEXT_PUBLIC_SITE_URL)");
    const url = args.unschedule ? undefined : healthUrl(site);

    if (args.dryRun) {
      const ref = (() => {
        try {
          return resolveRef(args.ref);
        } catch {
          return "<ref>";
        }
      })();
      log(`-- dry run: nothing is sent. Project ${ref}; ${args.unschedule ? `unschedule ${JOB_NAME}` : `${JOB_NAME} ${SCHEDULE} -> ${url}`}`);
      for (const step of buildSteps({ unschedule: args.unschedule, url, secret: REDACTED })) log(`\n-- ${step.title}\n${step.sql}`);
      return 0;
    }

    const ref = resolveRef(args.ref);
    const secret = args.unschedule ? undefined : resolveSecret(args.secret);
    const token = resolveToken();
    log(args.unschedule ? `Project ${ref}: removing ${JOB_NAME}` : `Project ${ref}: ${JOB_NAME} every 5 minutes -> ${url}`);
    for (const step of buildSteps({ unschedule: args.unschedule, url, secret })) {
      const rows = await runQuery({ ref, token, sql: step.sql, secret, fetchImpl });
      if (step.verify) {
        const jobs = Array.isArray(rows) ? rows : [];
        if (args.unschedule) log(jobs.length ? `  still scheduled: ${JSON.stringify(jobs)}` : `  ${JOB_NAME} is not scheduled`);
        else if (!jobs.length) throw new Error(`${JOB_NAME} is not in cron.job after scheduling`);
        else log(`  ${redact(JSON.stringify({ jobid: jobs[0].jobid, schedule: jobs[0].schedule, active: jobs[0].active }), secret)}`);
      } else {
        log(`  ok: ${step.title}`);
      }
    }
    log(args.unschedule ? "Done." : "Done. The first call lands within 5 minutes: docs/RUNBOOK-ops.md, \"Health checks and alerts\", shows how to see it.");
    return 0;
  } catch (e) {
    err(`schedule-health: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code));
}
