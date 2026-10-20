/**
 * The Training Center's tables (supabase/migrations/20261020000000_training_center.sql) against a
 * LIVE Supabase (normally the local stack, with the migration applied), through PostgREST with
 * real tokens. Opt-in:
 *
 *   RUN_DB_TESTS=1 npx vitest run src/lib/server/__tests__/training.integration.test.ts
 *
 *  - an admin (a row in `admins`, written with the service role) inserts, reads, updates and
 *    deletes their own runs and cases, and every row they write is their own;
 *  - the guard: no case in another owner's run, no row changing hands;
 *  - a signed-in non-admin reads nothing and writes nothing; anon has no access at all; an admin
 *    taken out of `admins` sees nothing from then on;
 *  - the fixtures script's read (scripts/training-fixtures.mjs) finds a regression case's fixture
 *    with the service role, and writes it verbatim (to a temp folder here, never the iOS tree).
 * Its own users (training-*-<tag>@example.com) are deleted at the end; their rows go with them.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDeleteUser, createSupabaseHttp, provisionUser, resolveSupabaseEnv, waitForHealth } from "../../../../scripts/lib/supabaseHttp.mjs";
import { fetchFixtureRows, fixtureFileName, writeFixtures } from "../../../../scripts/training-fixtures.mjs";

const enabled = process.env.RUN_DB_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const title = enabled
  ? "training center tables (live Supabase)"
  : "training center tables — skipped: set RUN_DB_TESTS=1 with the local stack running (and the migration applied) to enable";

type Http = ReturnType<typeof createSupabaseHttp>;
type Row = Record<string, unknown> & { id: string };

suite(title, () => {
  let url: string;
  let serviceKey: string;
  let service: Http;
  let anon: Http;
  let admin: Http;
  let student: Http;
  let adminId: string;
  let studentId: string;
  const made: string[] = [];
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let scratch: string | null = null;

  const RETURN = "return=representation";

  /** The one row a `return=representation` write answered, after checking its status. */
  function one(res: { status: number; body: unknown }, status: number): Row {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(Array.isArray(res.body) && res.body.length === 1, JSON.stringify(res.body)).toBe(true);
    return (res.body as Row[])[0];
  }

  const list = (res: { status: number; body: unknown }): Row[] => {
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Row[];
  };

  async function newRun(who: Http, extra: Record<string, unknown> = {}): Promise<Row> {
    return one(await who.rest("POST", "training_runs", { body: { kind: "bench", target: "grade 3 addition", app_build: "1.0 (42)", config: { pace: "kid" }, ...extra }, prefer: RETURN }), 201);
  }

  const caseBody = (runId: string, extra: Record<string, unknown> = {}) => ({
    run_id: runId,
    kind: "bench",
    case_key: `add-2-digit-${tag}`,
    category: "addition",
    grade: "3",
    topic: "two-digit sums",
    hand: "kid-neat",
    problem: ["23+45"],
    expected: ["68"],
    lines: [{ id: "l1", latex: "23+45=68" }],
    strokes: [{ x: [1, 2, 3], y: [4, 5, 6] }],
    reads: [{ lineId: "l1", latex: "23+45=68", provider: "mathpix" }],
    ...extra,
  });

  /** The row as the service role (RLS bypassed) sees it, or undefined. */
  async function asStored(table: string, id: string): Promise<Row | undefined> {
    return list(await service.rest("GET", table, { query: { id: `eq.${id}`, select: "*" } }))[0];
  }

  beforeAll(async () => {
    const env = resolveSupabaseEnv(process.env);
    if (!env.url || !env.anonKey || !env.serviceKey) throw new Error("RUN_DB_TESTS=1 needs the local stack (url, anon and service keys).");
    if (!(await waitForHealth(env.url, { timeoutMs: 180_000, anonKey: env.anonKey }))) throw new Error(`Supabase at ${env.url} is not healthy`);
    url = env.url.replace(/\/$/, "");
    serviceKey = env.serviceKey;
    const anonKey = env.anonKey;
    service = createSupabaseHttp({ url, anonKey, accessToken: serviceKey });
    anon = createSupabaseHttp({ url, anonKey });

    const person = async (role: string) => {
      const session = await provisionUser({ url, anonKey, serviceKey, email: `training-${role}-${tag}@example.com`, password: `Training-${crypto.randomUUID()}` });
      made.push(session.userId);
      return session;
    };
    const a = await person("admin");
    const s = await person("student");
    adminId = a.userId;
    studentId = s.userId;
    admin = createSupabaseHttp({ url, anonKey, accessToken: a.accessToken, userId: a.userId });
    student = createSupabaseHttp({ url, anonKey, accessToken: s.accessToken, userId: s.userId });

    const added = await service.rest("POST", "admins", { body: { user_id: adminId }, prefer: "return=minimal" });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
  }, 240_000);

  afterAll(async () => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    if (!service) return;
    if (adminId) await service.rest("DELETE", "admins", { query: { user_id: `eq.${adminId}` } });
    // the accounts' runs and cases cascade with them
    for (const id of made) await adminDeleteUser(url, serviceKey, id);
  });

  it("an admin inserts, reads, updates and deletes their own runs and cases; each row is theirs", async () => {
    const run = await newRun(admin);
    expect(run).toMatchObject({ created_by: adminId, status: "running", kind: "bench", totals: {}, finished_at: null });

    const created = one(await admin.rest("POST", "training_cases", { body: caseBody(run.id), prefer: RETURN }), 201);
    expect(created).toMatchObject({ created_by: adminId, run_id: run.id, pass: null, regression: false, fixture: null });

    expect(list(await admin.rest("GET", "training_runs", { query: { id: `eq.${run.id}` } }))).toHaveLength(1);
    expect(list(await admin.rest("GET", "training_cases", { query: { run_id: `eq.${run.id}` } })).map((r) => r.id)).toEqual([created.id]);

    const fixture = { schema: 1, problem: "23+45", strokes: [[[1, 4], [2, 5]]], expect: { latex: "23+45=68" } };
    const judged = one(
      await admin.rest("PATCH", "training_cases", { query: { id: `eq.${created.id}` }, body: { pass: true, ms: 1234, regression: true, fixture }, prefer: RETURN }),
      200,
    );
    expect(judged).toMatchObject({ pass: true, ms: 1234, regression: true, fixture });
    expect(judged.updated_at, "set_updated_at keeps updated_at").not.toBe(created.updated_at);

    const finished = one(
      await admin.rest("PATCH", "training_runs", { query: { id: `eq.${run.id}` }, body: { status: "done", finished_at: new Date().toISOString(), totals: { cases: 1, pass: 1 } }, prefer: RETURN }),
      200,
    );
    expect(finished).toMatchObject({ status: "done", totals: { cases: 1, pass: 1 } });

    // the fixtures script's read, with the service role, finds the regression case's fixture
    const rows = await fetchFixtureRows({ url, serviceKey });
    const mine = rows.filter((r) => r.id === created.id);
    expect(mine).toEqual([{ id: created.id, case_key: `add-2-digit-${tag}`, fixture }]);
    scratch = mkdtempSync(join(tmpdir(), "training-fixtures-"));
    const [file] = writeFixtures(mine, scratch);
    expect(file).toBe(join(scratch, fixtureFileName(mine[0])));
    expect(file.endsWith(`add-2-digit-${tag}-${created.id.slice(0, 8)}.json`)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(fixture);

    expect((await admin.rest("DELETE", "training_cases", { query: { id: `eq.${created.id}` } })).status).toBeLessThan(300);
    expect(await asStored("training_cases", created.id)).toBeUndefined();
    expect((await admin.rest("DELETE", "training_runs", { query: { id: `eq.${run.id}` } })).status).toBeLessThan(300);
    expect(await asStored("training_runs", run.id)).toBeUndefined();
  });

  it("an admin's writes are their own: no row in someone else's name, no case in another's run, no row changing hands", async () => {
    // a row in someone else's name: the policy's with check
    expect((await admin.rest("POST", "training_runs", { body: { kind: "bench", target: "x", created_by: studentId } })).status).toBe(403);

    // a run of another owner (written with the service role): the guard refuses a case in it
    const theirs = one(await service.rest("POST", "training_runs", { body: { kind: "pencil", target: "someone else's", created_by: studentId }, prefer: RETURN }), 201);
    const intoTheirs = await admin.rest("POST", "training_cases", { body: caseBody(theirs.id) });
    expect(intoTheirs.status, JSON.stringify(intoTheirs.body)).toBe(409);
    expect(list(await service.rest("GET", "training_cases", { query: { run_id: `eq.${theirs.id}` } }))).toEqual([]);

    // no row changes hands, and a case does not move to a run that is not its owner's
    const run = await newRun(admin);
    const handOver = await admin.rest("PATCH", "training_runs", { query: { id: `eq.${run.id}` }, body: { created_by: studentId } });
    expect(handOver.status, JSON.stringify(handOver.body)).toBe(403);
    expect((await asStored("training_runs", run.id))?.created_by).toBe(adminId);
    const kase = one(await admin.rest("POST", "training_cases", { body: caseBody(run.id), prefer: RETURN }), 201);
    expect((await admin.rest("PATCH", "training_cases", { query: { id: `eq.${kase.id}` }, body: { run_id: theirs.id } })).status).toBe(409);
    expect((await asStored("training_cases", kase.id))?.run_id).toBe(run.id);

    // the table's own checks
    expect((await admin.rest("POST", "training_runs", { body: { kind: "quiz", target: "x" } })).status).toBe(400);
    expect((await admin.rest("POST", "training_cases", { body: caseBody(run.id, { snapshot: "a".repeat(600_001) }) })).status).toBe(400);
  });

  it("a signed-in non-admin reads nothing and writes nothing", async () => {
    const run = await newRun(admin, { note: "the admin's" });
    const kase = one(await admin.rest("POST", "training_cases", { body: caseBody(run.id), prefer: RETURN }), 201);

    expect(list(await student.rest("GET", "training_runs", { query: { select: "id" } }))).toEqual([]);
    expect(list(await student.rest("GET", "training_cases", { query: { select: "id" } }))).toEqual([]);

    // a run of their own: the policy
    expect((await student.rest("POST", "training_runs", { body: { kind: "bench", target: "mine" } })).status).toBe(403);
    // a case in the admin's run: refused (the guard sees no run of theirs), and nothing stored
    const sneaked = await student.rest("POST", "training_cases", { body: caseBody(run.id, { case_key: `sneaked-${tag}` }) });
    expect(sneaked.status).toBeGreaterThanOrEqual(400);
    expect(list(await service.rest("GET", "training_cases", { query: { case_key: `eq.sneaked-${tag}` } }))).toEqual([]);

    // updates and deletes find no row to touch
    expect(list(await student.rest("PATCH", "training_runs", { query: { id: `eq.${run.id}` }, body: { note: "changed" }, prefer: RETURN }))).toEqual([]);
    expect(list(await student.rest("PATCH", "training_cases", { query: { id: `eq.${kase.id}` }, body: { pass: false }, prefer: RETURN }))).toEqual([]);
    expect(list(await student.rest("DELETE", "training_cases", { query: { id: `eq.${kase.id}` }, prefer: RETURN }))).toEqual([]);
    expect(list(await student.rest("DELETE", "training_runs", { query: { id: `eq.${run.id}` }, prefer: RETURN }))).toEqual([]);
    expect(await asStored("training_runs", run.id)).toMatchObject({ note: "the admin's" });
    expect(await asStored("training_cases", kase.id)).toMatchObject({ pass: null });
  });

  it("anon has no access at all", async () => {
    const run = await newRun(admin);
    for (const table of ["training_runs", "training_cases"]) {
      expect((await anon.rest("GET", table, { query: { select: "id" } })).status, table).toBe(401);
    }
    expect((await anon.rest("POST", "training_runs", { body: { kind: "bench", target: "anon" } })).status).toBe(401);
    expect((await anon.rest("POST", "training_cases", { body: caseBody(run.id) })).status).toBe(401);
    expect((await anon.rest("DELETE", "training_runs", { query: { id: `eq.${run.id}` } })).status).toBe(401);
    expect(await asStored("training_runs", run.id)).toBeDefined();
  });

  it("is_admin() is the key: an admin taken out of `admins` sees nothing from then on", async () => {
    await newRun(admin);
    expect(list(await admin.rest("GET", "training_runs", { query: { select: "id", created_by: `eq.${adminId}` } })).length).toBeGreaterThan(0);
    expect((await service.rest("DELETE", "admins", { query: { user_id: `eq.${adminId}` } })).status).toBeLessThan(300);
    try {
      expect(list(await admin.rest("GET", "training_runs", { query: { select: "id" } }))).toEqual([]);
      expect((await admin.rest("POST", "training_runs", { body: { kind: "bench", target: "after" } })).status).toBe(403);
    } finally {
      expect((await service.rest("POST", "admins", { body: { user_id: adminId }, prefer: "return=minimal" })).status).toBe(201);
    }
  });
});
