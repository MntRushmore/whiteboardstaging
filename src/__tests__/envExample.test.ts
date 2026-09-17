import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keeps .env.example honest:
 *  1. every `process.env.<NAME>` referenced under src/ and scripts/ is documented,
 *  2. the required variables are present, uncommented and non-empty,
 *  3. nothing in the file looks like a real secret.
 */

const ROOT = resolve(__dirname, "..", "..");
const ENV_EXAMPLE_PATH = join(ROOT, ".env.example");

/** Runtime-provided names that must not appear in .env.example. */
const IGNORED = new Set(["NODE_ENV"]);
const IGNORED_PREFIXES = ["VERCEL_"];

const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "OPENROUTER_API_KEY"];

/** The anon JWT every local `supabase start` issues (iss "supabase-demo"). Public by design. */
const LOCAL_DEMO_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "__snapshots__"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (SOURCE_EXTENSIONS.has(full.slice(full.lastIndexOf(".")))) {
      out.push(full);
    }
  }
  return out;
}

/** Same as `grep -rhoE "process\.env\.[A-Z_0-9]+" src scripts`, minus NODE_ENV / VERCEL_*. */
function referencedEnvVars(): Set<string> {
  const names = new Set<string>();
  for (const file of [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts"))]) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
      const name = match[1];
      if (IGNORED.has(name)) continue;
      if (IGNORED_PREFIXES.some((p) => name.startsWith(p))) continue;
      names.add(name);
    }
  }
  return names;
}

type EnvEntry = { name: string; value: string; commented: boolean; line: number };

/** Parses `NAME=value` and `# NAME=value` lines; other comment lines are ignored. */
function parseEnvExample(text: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  text.split("\n").forEach((raw, i) => {
    const m = raw.match(/^(#\s*)?([A-Z][A-Z_0-9]*)=(.*)$/);
    if (!m) return;
    let value = m[3].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries.push({ name: m[2], value, commented: Boolean(m[1]), line: i + 1 });
  });
  return entries;
}

const SECRET_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "OpenRouter key", re: /sk-or-v1-[0-9a-f]{20,}/ },
  { label: "OpenAI key", re: /sk-(proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/ },
  { label: "Supabase access token", re: /sbp_[0-9a-f]{20,}/ },
  { label: "Supabase secret key", re: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { label: "Vercel token", re: /vercel_[A-Za-z0-9]{20,}/ },
  { label: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
  { label: "Postgres URL with password", re: /postgres(ql)?:\/\/[^:\s]+:[^@\s]+@(?!127\.0\.0\.1|localhost)/ },
  { label: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

const envText = readFileSync(ENV_EXAMPLE_PATH, "utf8");
const entries = parseEnvExample(envText);
const documented = new Set(entries.map((e) => e.name));

describe(".env.example", () => {
  it("documents every process.env variable referenced by src/ and scripts/", () => {
    const referenced = referencedEnvVars();
    expect(referenced.size).toBeGreaterThan(5); // sanity: the scan actually found code
    const missing = [...referenced].filter((name) => !documented.has(name)).sort();
    expect(missing, `add these to .env.example: ${missing.join(", ")}`).toEqual([]);
  });

  it("does not document runtime-provided variables (NODE_ENV, VERCEL_*)", () => {
    const stray = entries
      .map((e) => e.name)
      .filter((name) => IGNORED.has(name) || IGNORED_PREFIXES.some((p) => name.startsWith(p)));
    expect(stray).toEqual([]);
  });

  it("has each variable exactly once", () => {
    const seen = new Map<string, number>();
    for (const e of entries) seen.set(e.name, (seen.get(e.name) ?? 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([name]) => name);
    expect(dupes).toEqual([]);
  });

  it.each(REQUIRED)("lists required %s uncommented with a non-empty value", (name) => {
    const entry = entries.find((e) => e.name === name);
    expect(entry, `${name} is missing`).toBeDefined();
    expect(entry?.commented, `${name} must not be commented out`).toBe(false);
    expect(entry?.value ?? "", `${name} needs a default or placeholder value`).not.toBe("");
  });

  it("marks the required variables as required in a comment header", () => {
    expect(envText).toMatch(/^# ─── Required/m);
  });

  it("contains no real secrets", () => {
    for (const { label, re } of SECRET_PATTERNS) {
      expect(envText, `looks like a ${label}`).not.toMatch(re);
    }
    const jwts = envText.match(JWT_RE) ?? [];
    const suspicious = jwts.filter((jwt) => jwt.length > 60 && jwt !== LOCAL_DEMO_ANON_KEY);
    expect(suspicious, "a JWT other than the local demo anon key is present").toEqual([]);
  });

  it("only uses the local demo anon key for the anon variable", () => {
    for (const e of entries) {
      if (e.value === LOCAL_DEMO_ANON_KEY) expect(e.name).toBe("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
  });

  it("uses local/placeholder values for provider keys", () => {
    const placeholder = /^(|your-.*|sk-or-\.\.\.|sk-\.\.\.|\.\.\.)$/;
    for (const name of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "MATHPIX_APP_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
      const entry = entries.find((e) => e.name === name);
      expect(entry, `${name} is missing`).toBeDefined();
      expect(entry?.value ?? "", `${name} must be a placeholder`).toMatch(placeholder);
    }
    const url = entries.find((e) => e.name === "NEXT_PUBLIC_SUPABASE_URL");
    expect(url?.value).toBe("http://127.0.0.1:54321");
  });
});
