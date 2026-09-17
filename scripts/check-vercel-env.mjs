#!/usr/bin/env node
/**
 * Compares the Vercel project's environment variables against .env.example.
 *
 *   node scripts/check-vercel-env.mjs                 # runs `vercel env ls` (needs a logged-in CLI)
 *   node scripts/check-vercel-env.mjs --from out.txt  # offline: parse saved `vercel env ls` output
 *   node scripts/check-vercel-env.mjs --env Production --json
 *
 * Per environment (Production / Preview / Development) it reports:
 *   FAIL  required key (".env.example" `# ─── Required` section) missing in Vercel
 *   info  optional key missing (defaults apply)
 *   FAIL  scripts-only key (`# ─── Scripts and tests` section) present in Vercel
 *   FAIL  Vercel key not documented in .env.example (VERCEL_* / NX_* / TURBO_* platform vars ignored)
 *
 * Exit codes: 0 clean, 1 at least one FAIL, 2 usage / could not obtain Vercel state.
 * Never mutates anything: it only ever runs `vercel env ls`.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvExample } from "./lib/envExample.mjs";

export const ENVIRONMENTS = /** @type {const} */ (["Production", "Preview", "Development"]);
/** @typedef {(typeof ENVIRONMENTS)[number]} VercelEnvironment */

/** Vars Vercel injects itself; never expected in .env.example. */
export const PLATFORM_PREFIXES = ["VERCEL_", "NX_", "TURBO_"];

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isPlatformVar(name) {
  return PLATFORM_PREFIXES.some((p) => name.startsWith(p));
}

const ROW_RE = /^\s*([A-Z][A-Z0-9_]*)\s{2,}(\S.*?)\s{2,}((?:Production|Preview|Development)[^]*?)\s{2,}(\S.*?)\s*$/;

/**
 * Normalises one entry of the "environments" column: "Preview (feat/x)" -> "Preview".
 * @param {string} raw
 * @returns {VercelEnvironment | null}
 */
function normaliseEnvironment(raw) {
  const name = raw.replace(/\s*\(.*\)\s*$/, "").trim();
  return ENVIRONMENTS.includes(/** @type {VercelEnvironment} */ (name)) ? /** @type {VercelEnvironment} */ (name) : null;
}

/**
 * Parses the human-readable table `vercel env ls` prints. Tolerates the CLI banner,
 * the "Retrieving project…" line, the column header and the "Common next commands" trailer.
 * Multi-environment rows ("Production, Preview") are expanded.
 *
 * @param {string} text
 * @returns {Map<string, Set<VercelEnvironment>>}  key name -> environments it is set in
 */
export function parseVercelEnvLs(text) {
  /** @type {Map<string, Set<VercelEnvironment>>} */
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(ROW_RE);
    if (!m) continue;
    const [, name, , environments] = m;
    if (name === "NAME") continue;
    const set = out.get(name) ?? new Set();
    for (const part of environments.split(",")) {
      const env = normaliseEnvironment(part);
      if (env) set.add(env);
    }
    if (set.size > 0) out.set(name, set);
  }
  return out;
}

/**
 * @typedef {object} EnvironmentReport
 * @property {VercelEnvironment} environment
 * @property {string[]} missingRequired      FAIL
 * @property {string[]} missingOptional      info
 * @property {string[]} scriptsOnlyPresent   FAIL
 * @property {string[]} present              documented deploy keys that are set
 */

/**
 * @typedef {object} Report
 * @property {EnvironmentReport[]} environments
 * @property {string[]} undocumented   Vercel keys absent from .env.example (FAIL), platform vars excluded
 * @property {string[]} ignoredPlatform Vercel keys skipped because they are platform-provided
 * @property {boolean} ok
 * @property {number} failures
 */

/**
 * @param {import("./lib/envExample.mjs").ParsedEnvExample} example
 * @param {Map<string, Set<VercelEnvironment>>} vercel
 * @param {{ environments?: readonly VercelEnvironment[] }} [options]
 * @returns {Report}
 */
export function buildReport(example, vercel, options = {}) {
  const environments = options.environments ?? ENVIRONMENTS;
  const documented = example.keys;

  /** @type {string[]} */
  const undocumented = [];
  /** @type {string[]} */
  const ignoredPlatform = [];
  for (const name of [...vercel.keys()].sort()) {
    if (documented.has(name)) continue;
    if (isPlatformVar(name)) ignoredPlatform.push(name);
    else undocumented.push(name);
  }

  const envReports = environments.map((environment) => {
    /** @type {EnvironmentReport} */
    const r = { environment, missingRequired: [], missingOptional: [], scriptsOnlyPresent: [], present: [] };
    for (const key of documented.values()) {
      const isSet = vercel.get(key.name)?.has(environment) ?? false;
      switch (key.classification) {
        case "required-deploy":
          (isSet ? r.present : r.missingRequired).push(key.name);
          break;
        case "optional-deploy":
          (isSet ? r.present : r.missingOptional).push(key.name);
          break;
        case "scripts-only":
          if (isSet) r.scriptsOnlyPresent.push(key.name);
          break;
      }
    }
    return r;
  });

  const failures =
    undocumented.length + envReports.reduce((n, r) => n + r.missingRequired.length + r.scriptsOnlyPresent.length, 0);
  return { environments: envReports, undocumented, ignoredPlatform, ok: failures === 0, failures };
}

/**
 * @param {Report} report
 * @returns {string}
 */
export function formatReport(report) {
  /** @type {string[]} */
  const lines = [];
  for (const r of report.environments) {
    lines.push(`${r.environment}:`);
    for (const k of r.missingRequired) lines.push(`  FAIL  missing required   ${k}`);
    for (const k of r.scriptsOnlyPresent) lines.push(`  FAIL  scripts-only set   ${k}  (remove: vercel env rm ${k} ${r.environment.toLowerCase()})`);
    for (const k of r.missingOptional) lines.push(`  info  missing optional   ${k}  (default applies)`);
    lines.push(`  ok    present            ${r.present.length ? r.present.join(", ") : "(none)"}`);
  }
  for (const k of report.undocumented) lines.push(`FAIL  undocumented in .env.example   ${k}`);
  if (report.ignoredPlatform.length) lines.push(`info  platform vars ignored   ${report.ignoredPlatform.join(", ")}`);
  lines.push(report.ok ? "OK: no failures" : `FAILED: ${report.failures} failure(s)`);
  return lines.join("\n");
}

/**
 * @param {string[]} argv
 * @returns {{ from: string | null, json: boolean, env: VercelEnvironment | null, envExample: string | null, help: boolean }}
 */
export function parseArgs(argv) {
  const opts = { from: /** @type {string | null} */ (null), json: false, env: /** @type {VercelEnvironment | null} */ (null), envExample: /** @type {string | null} */ (null), help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--from") opts.from = argv[++i] ?? null;
    else if (a === "--env-example") opts.envExample = argv[++i] ?? null;
    else if (a === "--env") {
      const raw = argv[++i] ?? "";
      const env = normaliseEnvironment(raw[0]?.toUpperCase() + raw.slice(1).toLowerCase());
      if (!env) throw new Error(`--env must be one of ${ENVIRONMENTS.join("|")}, got "${raw}"`);
      opts.env = env;
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (opts.from === null && argv.includes("--from")) throw new Error("--from needs a file path");
  return opts;
}

/**
 * Runs `vercel env ls` (read-only) and returns its stdout+stderr.
 * @returns {string}
 */
export function runVercelEnvLs() {
  const res = spawnSync("vercel", ["env", "ls"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (res.error) throw new Error(`could not run vercel CLI: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`vercel env ls exited ${res.status}:\n${res.stderr}${res.stdout}`);
  // Vercel prints the table on stdout and the banner on stderr; the parser tolerates both.
  return `${res.stderr}\n${res.stdout}`;
}

/**
 * @param {string[]} argv
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, vercelOutput?: () => string }} [io]
 * @returns {number} exit code
 */
export function main(argv, io = {}) {
  const stdout = io.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  const stderr = io.stderr ?? ((s) => process.stderr.write(`${s}\n`));
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    stderr(String(err instanceof Error ? err.message : err));
    return 2;
  }
  if (opts.help) {
    stdout("usage: node scripts/check-vercel-env.mjs [--from <vercel-env-ls.txt>] [--env Production|Preview|Development] [--json] [--env-example <path>]");
    return 0;
  }

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const examplePath = opts.envExample ?? join(root, ".env.example");
  let vercelText;
  try {
    vercelText = opts.from ? readFileSync(opts.from, "utf8") : (io.vercelOutput ?? runVercelEnvLs)();
  } catch (err) {
    stderr(String(err instanceof Error ? err.message : err));
    return 2;
  }

  const example = parseEnvExample(readFileSync(examplePath, "utf8"));
  const vercel = parseVercelEnvLs(vercelText);
  if (vercel.size === 0) {
    stderr("no environment variables parsed from vercel env ls output (wrong file, or CLI output format changed)");
    return 2;
  }
  const report = buildReport(example, vercel, { environments: opts.env ? [opts.env] : ENVIRONMENTS });
  stdout(opts.json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
