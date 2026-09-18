/**
 * Unit tests for scripts/check-vercel-env.mjs and scripts/lib/envExample.mjs.
 * Offline: driven by a saved `vercel env ls` output (fixtures/vercel-env-ls.txt) and
 * a synthetic .env.example. Never spawns the vercel CLI.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifySection,
  keysByClassification,
  parseEnvExample,
  parseSectionHeader,
  PREAMBLE_SECTION,
} from "../../scripts/lib/envExample.mjs";
import {
  ENVIRONMENTS,
  buildReport,
  formatReport,
  isPlatformVar,
  main,
  parseArgs,
  parseVercelEnvLs,
} from "../../scripts/check-vercel-env.mjs";

const ROOT = resolve(__dirname, "..", "..");
const FIXTURE_PATH = join(__dirname, "fixtures", "vercel-env-ls.txt");
const fixture = readFileSync(FIXTURE_PATH, "utf8");
const realEnvExample = parseEnvExample(readFileSync(join(ROOT, ".env.example"), "utf8"));

const SYNTHETIC_ENV_EXAMPLE = `# Copy to .env.local.
# ─── Required (the app refuses to serve without these) ───────────────────────
REQ_A=http://127.0.0.1:1
REQ_B="quoted"

# ─── Optional providers ──────────────────────────────────────────────────────
OPT_A=
# OPT_COMMENTED=1

# ─── Logging ─────────────────────────────────────────────────────────────────
LOG_X=info

# ─── Scripts and tests (never needed by the deployed app) ────────────────────
SCRIPT_ONLY=1
`;

/** Mimics the real CLI table: columns are widened to the longest cell, separated by 2+ spaces. */
function vercelTable(rows: Array<[string, string]>): string {
  const nameW = Math.max(4, ...rows.map(([n]) => n.length)) + 2;
  const envW = Math.max(12, ...rows.map(([, e]) => e.length)) + 2;
  const body = rows.map(([name, envs]) => ` ${name.padEnd(nameW)}Encrypted    ${envs.padEnd(envW)}1d ago     `).join("\n");
  return `Vercel CLI 56.3.0 (Node.js 22.14.0)\nRetrieving project…\n> Environment Variables found for x/y [1ms]\n\n name                               value               environments        created     \n${body}\n\nCommon next commands:\n- \`vercel env add\`\n`;
}

describe("envExample: section headers and classification", () => {
  it("extracts the title and drops the parenthetical explainer", () => {
    expect(parseSectionHeader("# ─── Required (the app refuses to serve /api/* without these) ─────")).toBe("Required");
    expect(parseSectionHeader("# ─── Scripts and tests (never needed by the deployed app) ────")).toBe("Scripts and tests");
    expect(parseSectionHeader("# ─── Live Math (realtime math & STEM layer) ──────")).toBe("Live Math");
    expect(parseSectionHeader("# plain comment")).toBeNull();
    expect(parseSectionHeader("FOO=bar")).toBeNull();
  });

  it("classifies by the first word of the title", () => {
    expect(classifySection("Required")).toBe("required-deploy");
    expect(classifySection("Scripts and tests")).toBe("scripts-only");
    expect(classifySection("Optional providers")).toBe("optional-deploy");
    expect(classifySection("Logging")).toBe("optional-deploy");
    expect(classifySection("Live Math")).toBe("optional-deploy");
  });

  it("parses a synthetic .env.example into sections with commented keys and quoted values", () => {
    const parsed = parseEnvExample(SYNTHETIC_ENV_EXAMPLE);
    expect(parsed.sections.map((s) => s.title)).toEqual(["Required", "Optional providers", "Logging", "Scripts and tests"]);
    expect(keysByClassification(parsed, "required-deploy")).toEqual(["REQ_A", "REQ_B"]);
    expect(keysByClassification(parsed, "optional-deploy")).toEqual(["OPT_A", "OPT_COMMENTED", "LOG_X"]);
    expect(keysByClassification(parsed, "scripts-only")).toEqual(["SCRIPT_ONLY"]);
    expect(parsed.keys.get("REQ_B")).toMatchObject({ value: "quoted", commented: false, line: 4 });
    expect(parsed.keys.get("OPT_COMMENTED")).toMatchObject({ commented: true, section: "Optional providers" });
  });

  it("puts keys before any header into an implicit optional preamble section", () => {
    const parsed = parseEnvExample("EARLY=1\n# ─── Required ───\nREQ=1\n");
    expect(parsed.sections[0].title).toBe(PREAMBLE_SECTION);
    expect(parsed.keys.get("EARLY")?.classification).toBe("optional-deploy");
    expect(parsed.keys.get("REQ")?.classification).toBe("required-deploy");
  });

  it("classifies the real .env.example the way the docs describe", () => {
    expect(keysByClassification(realEnvExample, "required-deploy")).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "OPENROUTER_API_KEY",
    ]);
    expect(keysByClassification(realEnvExample, "scripts-only")).toEqual([
      "BASE_URL",
      "SMOKE_EMAIL",
      "SMOKE_PASSWORD",
      "SMOKE_SKIP_LLM",
      "RUN_DB_TESTS",
      "VERIFY_EMAIL_DOMAIN",
    ]);
    expect(keysByClassification(realEnvExample, "optional-deploy")).toContain("NEXT_PUBLIC_TLDRAW_LICENSE_KEY");
    expect(keysByClassification(realEnvExample, "optional-deploy")).toContain("NEXT_PUBLIC_LIVE_MATH");
  });
});

describe("parseVercelEnvLs", () => {
  it("parses the saved `vercel env ls` fixture (name + environments), skipping banner and trailer", () => {
    const parsed = parseVercelEnvLs(fixture);
    expect([...parsed.keys()].sort()).toEqual([
      "MATHPIX_APP_ID",
      "MATHPIX_APP_KEY",
      "NEXT_PUBLIC_SITE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_TLDRAW_LICENSE_KEY",
      "OPENROUTER_API_KEY",
    ]);
    expect([...parsed.get("OPENROUTER_API_KEY")!].sort()).toEqual(["Development", "Preview", "Production"]);
    expect([...parsed.get("NEXT_PUBLIC_SUPABASE_URL")!]).toEqual(["Production"]);
    expect([...parsed.get("NEXT_PUBLIC_SITE_URL")!]).toEqual(["Production"]);
  });

  it("expands comma-separated environments and strips preview branch suffixes", () => {
    const parsed = parseVercelEnvLs(vercelTable([
      ["MULTI", "Production, Preview"],
      ["BRANCHED", "Preview (feat/x)"],
      ["VERCEL_OIDC_TOKEN", "Development"],
    ]));
    expect([...parsed.get("MULTI")!]).toEqual(["Production", "Preview"]);
    expect([...parsed.get("BRANCHED")!]).toEqual(["Preview"]);
    expect(parsed.has("VERCEL_OIDC_TOKEN")).toBe(true);
  });

  it("returns an empty map for unrelated text", () => {
    expect(parseVercelEnvLs("nothing here\nname value environments created\n").size).toBe(0);
  });
});

describe("buildReport", () => {
  it("reports the real fixture against the real .env.example exactly as measured", () => {
    const report = buildReport(realEnvExample, parseVercelEnvLs(fixture));
    const by = Object.fromEntries(report.environments.map((r) => [r.environment, r]));
    expect(by.Production.missingRequired).toEqual([]);
    expect(by.Preview.missingRequired).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    expect(by.Development.missingRequired).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    expect(by.Preview.missingOptional).toContain("NEXT_PUBLIC_SITE_URL");
    expect(by.Production.missingOptional).not.toContain("NEXT_PUBLIC_SITE_URL");
    expect(by.Production.missingOptional).toContain("NEXT_PUBLIC_LIVE_MATH");
    expect(by.Production.missingOptional).toContain("LOG_LEVEL");
    for (const r of report.environments) expect(r.scriptsOnlyPresent).toEqual([]);
    expect(report.undocumented).toEqual([]);
    expect(report.ok).toBe(false);
    expect(report.failures).toBe(4);
  });

  it("fails on scripts-only vars deployed and on undocumented vars, ignoring platform vars", () => {
    const example = parseEnvExample(SYNTHETIC_ENV_EXAMPLE);
    const vercel = parseVercelEnvLs(vercelTable([
      ["REQ_A", "Production, Preview, Development"],
      ["REQ_B", "Production, Preview, Development"],
      ["SCRIPT_ONLY", "Preview"],
      ["MYSTERY_KEY", "Production"],
      ["VERCEL_ANALYTICS_ID", "Production"],
      ["TURBO_TOKEN", "Production"],
      ["NX_CLOUD", "Production"],
    ]));
    const report = buildReport(example, vercel);
    const by = Object.fromEntries(report.environments.map((r) => [r.environment, r]));
    expect(by.Preview.scriptsOnlyPresent).toEqual(["SCRIPT_ONLY"]);
    expect(by.Production.scriptsOnlyPresent).toEqual([]);
    expect(report.undocumented).toEqual(["MYSTERY_KEY"]);
    expect(report.ignoredPlatform).toEqual(["NX_CLOUD", "TURBO_TOKEN", "VERCEL_ANALYTICS_ID"]);
    expect(report.failures).toBe(2);
    expect(report.ok).toBe(false);
    expect(isPlatformVar("VERCEL_ENV")).toBe(true);
    expect(isPlatformVar("OPENROUTER_API_KEY")).toBe(false);
  });

  it("is ok when every required key is set everywhere and nothing else is wrong", () => {
    const example = parseEnvExample(SYNTHETIC_ENV_EXAMPLE);
    const vercel = parseVercelEnvLs(vercelTable([
      ["REQ_A", "Production, Preview, Development"],
      ["REQ_B", "Production, Preview, Development"],
    ]));
    const report = buildReport(example, vercel);
    expect(report.ok).toBe(true);
    expect(report.failures).toBe(0);
    expect(report.environments.map((r) => r.missingOptional)).toEqual(Array(3).fill(["OPT_A", "OPT_COMMENTED", "LOG_X"]));
  });

  it("restricts to a single environment when asked", () => {
    const report = buildReport(realEnvExample, parseVercelEnvLs(fixture), { environments: ["Production"] });
    expect(report.environments.map((r) => r.environment)).toEqual(["Production"]);
    expect(report.ok).toBe(true);
  });
});

describe("formatReport", () => {
  it("prints FAIL/info/ok lines per environment and a summary", () => {
    const text = formatReport(buildReport(realEnvExample, parseVercelEnvLs(fixture)));
    expect(text).toMatch(/^Production:\n/);
    expect(text).toContain("Preview:\n  FAIL  missing required   NEXT_PUBLIC_SUPABASE_URL");
    expect(text).toContain("info  missing optional   NEXT_PUBLIC_LIVE_MATH  (default applies)");
    expect(text).toMatch(/FAILED: 4 failure\(s\)$/);
    expect(text).not.toContain("undocumented");
  });
});

describe("parseArgs", () => {
  it("parses --from, --json, --env (case-insensitive) and --env-example", () => {
    expect(parseArgs(["--from", "x.txt", "--json", "--env", "preview", "--env-example", "e"])).toEqual({
      from: "x.txt",
      json: true,
      env: "Preview",
      envExample: "e",
      help: false,
    });
    expect(parseArgs([])).toEqual({ from: null, json: false, env: null, envExample: null, help: false });
  });

  it("rejects unknown flags, bad --env values and a dangling --from", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--env", "staging"])).toThrow(/--env must be one of/);
    expect(() => parseArgs(["--from"])).toThrow(/--from needs a file path/);
  });
});

describe("main (offline)", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-vercel-env-"));
  const synthPath = join(dir, ".env.example");
  writeFileSync(synthPath, SYNTHETIC_ENV_EXAMPLE);

  function run(argv: string[], vercelOutput?: string) {
    const out: string[] = [];
    const err: string[] = [];
    const code = main(argv, {
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      vercelOutput: () => vercelOutput ?? "",
    });
    return { code, out: out.join("\n"), err: err.join("\n") };
  }

  it("exits 1 with the human report for the real fixture", () => {
    const { code, out } = run(["--from", FIXTURE_PATH]);
    expect(code).toBe(1);
    expect(out).toContain("FAILED: 4 failure(s)");
  });

  it("exits 0 and prints JSON for the passing environment", () => {
    const { code, out } = run(["--from", FIXTURE_PATH, "--env", "Production", "--json"]);
    expect(code).toBe(0);
    const json = JSON.parse(out);
    expect(json.ok).toBe(true);
    expect(json.environments).toHaveLength(1);
  });

  it("uses injected vercel output instead of spawning the CLI, and honours --env-example", () => {
    const table = vercelTable([
      ["REQ_A", "Production, Preview, Development"],
      ["REQ_B", "Production, Preview, Development"],
    ]);
    const { code, out } = run(["--env-example", synthPath], table);
    expect(code).toBe(0);
    expect(out).toContain("OK: no failures");
  });

  it("exits 2 on bad arguments, a missing --from file and unparsable output", () => {
    expect(run(["--nope"]).code).toBe(2);
    expect(run(["--from", join(dir, "missing.txt")]).code).toBe(2);
    const { code, err } = run(["--env-example", synthPath], "garbage");
    expect(code).toBe(2);
    expect(err).toMatch(/no environment variables parsed/);
  });

  it("prints usage for --help", () => {
    const { code, out } = run(["--help"]);
    expect(code).toBe(0);
    expect(out).toMatch(/^usage:/);
  });

  it("exposes the three Vercel environments", () => {
    expect([...ENVIRONMENTS]).toEqual(["Production", "Preview", "Development"]);
  });
});
