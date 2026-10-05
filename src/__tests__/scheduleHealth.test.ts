/**
 * scripts/schedule-health.mjs without a project: the SQL it would run (the secret only ever in
 * the Vault statements, never in the job), its argument and env handling, and a full run against
 * a fake Management API. Nothing here reaches Supabase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSteps,
  cronCommand,
  decodeKeychainToken,
  healthUrl,
  HTTP_TIMEOUT_MS,
  JOB_NAME,
  main,
  parseArgs,
  REDACTED,
  redact,
  resolveRef,
  resolveSecret,
  resolveToken,
  SCHEDULE,
  sqlLiteral,
  VAULT_SECRET_NAME,
} from "../../scripts/schedule-health.mjs";

const SECRET = "s3cret-value-0123456789abcdef";
const REF = "abcdefghijklmnopqrst";
const URL_ = "https://whiteboard.example.com/api/admin/health";

describe("building the SQL", () => {
  it("schedules every 5 minutes, idempotently, with the secret only in Vault", () => {
    const steps = buildSteps({ unschedule: false, url: URL_, secret: SECRET });
    const sql = steps.map((s) => s.sql);
    expect(sql[0]).toBe("create extension if not exists pg_cron with schema pg_catalog;");
    expect(sql[1]).toBe("create extension if not exists pg_net with schema extensions;");
    const withSecret = steps.filter((s) => s.sql.includes(SECRET)).map((s) => s.title);
    expect(withSecret).toEqual([`update the Vault secret ${VAULT_SECRET_NAME} (if it exists)`, `create the Vault secret ${VAULT_SECRET_NAME} (if it does not)`]);
    const unscheduleAt = sql.findIndex((s) => s.startsWith("select cron.unschedule("));
    const scheduleAt = sql.findIndex((s) => s.startsWith("select cron.schedule("));
    expect(unscheduleAt).toBeGreaterThan(-1);
    expect(scheduleAt).toBeGreaterThan(unscheduleAt);
    expect(sql[scheduleAt]).toContain(`'${JOB_NAME}', '${SCHEDULE}'`);
    expect(sql[scheduleAt]).not.toContain(SECRET);
    expect(steps.at(-1)?.verify).toBe(true);
  });

  it("the job's command reads the bearer from Vault each run and waits long enough", () => {
    const cmd = cronCommand(URL_);
    expect(cmd).toContain(`url := '${URL_}'`);
    expect(cmd).toContain(`'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${VAULT_SECRET_NAME}')`);
    expect(cmd).toContain(`timeout_milliseconds := ${HTTP_TIMEOUT_MS}`);
    expect(HTTP_TIMEOUT_MS).toBeGreaterThan(60_000); // the route's maxDuration
  });

  it("vault statements are top-level and idempotent (update if present, create if absent)", () => {
    const [update, create] = buildSteps({ unschedule: false, url: URL_, secret: SECRET }).slice(2, 4).map((s) => s.sql);
    expect(update).toBe(`select vault.update_secret(id, '${SECRET}') from vault.secrets where name = '${VAULT_SECRET_NAME}';`);
    expect(create).toMatch(/^select vault\.create_secret\(.+\) where not exists \(select 1 from vault\.secrets where name = 'agathon_cron_secret'\);$/);
  });

  it("escapes quotes in literals", () => {
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(buildSteps({ unschedule: false, url: URL_, secret: "a'b" })[2].sql).toContain("'a''b'");
  });

  it("--unschedule only removes the job and shows what is left", () => {
    const steps = buildSteps({ unschedule: true });
    expect(steps.map((s) => s.sql)).toEqual([
      "select cron.unschedule(jobid) from cron.job where jobname = 'agathon-health';",
      "select jobid, jobname, schedule, active, command from cron.job where jobname = 'agathon-health';",
    ]);
  });
});

describe("inputs", () => {
  it("parseArgs", () => {
    expect(parseArgs(["--dry-run", "--ref", REF, "--site=https://x.example.com"])).toEqual({ dryRun: true, unschedule: false, help: false, ref: REF, site: "https://x.example.com" });
    expect(() => parseArgs(["--ref"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
  });

  it("healthUrl: https only (http for localhost), path appended once, nothing unsafe for SQL", () => {
    expect(healthUrl("https://whiteboard.example.com/")).toBe(URL_);
    expect(healthUrl("http://localhost:3000")).toBe("http://localhost:3000/api/admin/health");
    expect(() => healthUrl("http://whiteboard.example.com")).toThrow(/https/);
    expect(() => healthUrl("whiteboard.example.com")).toThrow(/absolute/);
    expect(() => healthUrl("https://example.com/$cmd$")).toThrow(/cannot go into the job/);
  });

  it("resolveRef: flag, env, or the Supabase URL's subdomain", () => {
    expect(resolveRef(REF, {})).toBe(REF);
    expect(resolveRef(undefined, { NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co` })).toBe(REF);
    expect(() => resolveRef(undefined, {})).toThrow(/no project ref/);
    expect(() => resolveRef("Prod!", {})).toThrow(/not a Supabase project ref/);
  });

  it("resolveSecret refuses missing, empty (a sensitive `vercel env pull`), placeholder and spaced values", () => {
    expect(resolveSecret(undefined, { CRON_SECRET: ` ${SECRET} ` })).toBe(SECRET);
    expect(() => resolveSecret(undefined, {})).toThrow(/not set/);
    expect(() => resolveSecret(undefined, { CRON_SECRET: "" })).toThrow(/empty/);
    expect(() => resolveSecret("your-secret", {})).toThrow(/placeholder/);
    expect(() => resolveSecret("a b", {})).toThrow(/whitespace/);
  });

  it("the token: env first, else the keychain (plain or go-keyring-base64)", () => {
    expect(resolveToken({ SUPABASE_ACCESS_TOKEN: "sbp_env" }, () => "sbp_keychain")).toBe("sbp_env");
    expect(resolveToken({}, () => "sbp_keychain")).toBe("sbp_keychain");
    expect(() => resolveToken({}, () => null)).toThrow(/no Management API token/);
    expect(decodeKeychainToken("sbp_plain\n")).toBe("sbp_plain");
    expect(decodeKeychainToken(`go-keyring-base64:${Buffer.from("sbp_old").toString("base64")}`)).toBe("sbp_old");
    expect(decodeKeychainToken("")).toBeNull();
  });

  it("redact", () => {
    expect(redact(`ERROR near '${SECRET}'`, SECRET)).toBe(`ERROR near '${REDACTED}'`);
    expect(redact("nothing", undefined)).toBe("nothing");
  });
});

describe("main", () => {
  // The operator's shell, emptied per test (vi.stubEnv restores it afterwards).
  const VARS = ["CRON_SECRET", "SUPABASE_ACCESS_TOKEN", "NEXT_PUBLIC_SITE_URL", "SUPABASE_PROJECT_REF", "NEXT_PUBLIC_SUPABASE_URL"];
  beforeEach(() => {
    for (const k of VARS) vi.stubEnv(k, undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { log: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
  }

  it("--dry-run prints the SQL with the secret redacted and sends nothing", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const fetchImpl = vi.fn();
    const { out, io } = capture();
    const code = await main(["--dry-run", "--ref", REF, "--site", "https://whiteboard.example.com"], { ...io, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(code).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    const printed = out.join("\n");
    expect(printed).not.toContain(SECRET);
    expect(printed).toContain(`vault.update_secret(id, '${REDACTED}')`);
    expect(printed).toContain("select cron.schedule('agathon-health', '*/5 * * * *'");
  });

  it("a real run posts each statement to the Management API with the token", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("SUPABASE_ACCESS_TOKEN", "sbp_test");
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(`https://api.supabase.com/v1/projects/${REF}/database/query`);
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sbp_test");
      const query = (JSON.parse(String(init.body)) as { query: string }).query;
      bodies.push(query);
      const rows = query.startsWith("select jobid") ? [{ jobid: 7, jobname: JOB_NAME, schedule: SCHEDULE, active: true }] : [];
      return new Response(JSON.stringify(rows), { status: 201 });
    });
    const { out, io } = capture();
    const code = await main(["--ref", REF, "--site", "https://whiteboard.example.com"], { ...io, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(code).toBe(0);
    expect(bodies).toHaveLength(7);
    expect(out.join("\n")).not.toContain(SECRET);
    expect(out.join("\n")).toContain('"jobid":7');
  });

  it("an API error is reported with the secret redacted, exit 1", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("SUPABASE_ACCESS_TOKEN", "sbp_test");
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => new Response(`{"message":"syntax error in ${String(init.body)}"}`, { status: 400 }));
    const { err, io } = capture();
    const code = await main(["--ref", REF, "--site", "https://whiteboard.example.com"], { ...io, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/Management API 400/);
    // The first statement has no secret; make one that does fail.
    const failOnVault = vi.fn(async (_url: string, init: RequestInit) =>
      String(init.body).includes("vault.update_secret") ? new Response(`{"message":"bad ${String(init.body)}"}`, { status: 400 }) : new Response("[]", { status: 201 }),
    );
    const second = capture();
    expect(await main(["--ref", REF, "--site", "https://whiteboard.example.com"], { ...second.io, fetchImpl: failOnVault as unknown as typeof fetch })).toBe(1);
    expect(second.err.join("\n")).not.toContain(SECRET);
    expect(second.err.join("\n")).toContain(REDACTED);
  });

  it("refuses to run without a site, or without a secret", async () => {
    vi.stubEnv("SUPABASE_ACCESS_TOKEN", "sbp_test");
    const a = capture();
    expect(await main(["--ref", REF], a.io)).toBe(1);
    expect(a.err.join("\n")).toMatch(/no site/);
    const b = capture();
    expect(await main(["--ref", REF, "--site", "https://whiteboard.example.com"], b.io)).toBe(1);
    expect(b.err.join("\n")).toMatch(/CRON_SECRET is not set/);
  });

  it("bad arguments: usage, exit 2", async () => {
    const c = capture();
    expect(await main(["--frobnicate"], c.io)).toBe(2);
    expect(c.err.join("\n")).toMatch(/Usage/);
  });
});
