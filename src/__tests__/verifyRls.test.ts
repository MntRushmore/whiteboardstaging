/**
 * Unit tests for scripts/lib/rlsChecks.mjs and scripts/lib/supabaseHttp.mjs.
 * No network: every check runs against an in-memory fake that models the
 * intended RLS behaviour, with named "leaks" that switch individual
 * protections off so each check's fail decision can be exercised.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_CHECKS,
  PUBLIC_TABLES,
  affectedNoRows,
  checkAnonDenied,
  checkBoardAssets,
  checkBugReports,
  checkCrossUserIsolation,
  checkSnapshots,
  checkStorage,
  checkTrainersNotWritable,
  checkTrainingSamplesDenied,
  checkUserSettingsIsolation,
  checkVersionTrigger,
  checkWhiteboardOwnerCrud,
  deniedOrEmpty,
  formatResults,
  isDenied,
  isStorageDenied,
  minimalInsert,
  runAllChecks,
  runCheck,
} from "../../scripts/lib/rlsChecks.mjs";
import type { CheckContext, CheckResult, HttpResult, RestOptions, RlsClient } from "../../scripts/lib/rlsChecks.mjs";
import {
  createSupabaseHttp,
  isLoopbackUrl,
  parseEnvText,
  provisionUser,
  resolveSupabaseEnv,
  toResult,
  waitForHealth,
} from "../../scripts/lib/supabaseHttp.mjs";

// ---------------------------------------------------------------- fake world

type Row = Record<string, unknown>;

type Leak =
  | "anonSelect"
  | "anonInsert"
  | "crossSelect"
  | "crossUpdate"
  | "crossDelete"
  | "settingsHijack"
  | "bugReportForeign"
  | "bugReportRead"
  | "trainersInsert"
  | "trainingInsert"
  | "snapshotForeign"
  | "assetForeignBoard"
  | "assetCrossRead"
  | "storageForeignUpload"
  | "storagePublicRead"
  | "storageForeignDelete"
  | "trainingUpload"
  | "noVersionBump"
  | "staleUpdateApplies"
  | "noSnapshotHistory";

const USER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";
const FILTER_KEYS = new Set(["select", "limit", "order", "on_conflict"]);

function makeWorld(leaks: Leak[] = []) {
  const leak = (l: Leak) => leaks.includes(l);
  const boards = new Map<string, Row>();
  const settings = new Map<string, Row>();
  const bugReports: Row[] = [];
  const snapshots: Row[] = [];
  const assets: Row[] = [];
  const objects = new Map<string, string>(); // "bucket/path" -> owner
  const uuid = () => globalThis.crypto.randomUUID();

  const ok = (body: unknown, status = 200): HttpResult => ({ status, body });
  const denied = (uid: string | null): HttpResult => ({
    status: uid ? 403 : 401,
    body: { code: "42501", message: "permission denied" },
  });
  // Mirrors what storage-api actually returns on this stack (HTTP 400, statusCode "403").
  const storageDenied = (): HttpResult => ({
    status: 400,
    body: { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy", code: "AccessDenied" },
  });

  function matches(row: Row, query: Record<string, string>) {
    for (const [key, value] of Object.entries(query)) {
      if (FILTER_KEYS.has(key)) continue;
      if (!value.startsWith("eq.")) throw new Error(`fake only supports eq. filters, got ${key}=${value}`);
      if (String(row[key]) !== value.slice(3)) return false;
    }
    return true;
  }

  function ordered(list: Row[], query: Record<string, string>) {
    if (!query.order) return list;
    const [field, dir] = query.order.split(".");
    return [...list].sort((x, y) => (Number(x[field]) - Number(y[field])) * (dir === "desc" ? -1 : 1));
  }

  function rest(uid: string | null, method: string, table: string, opts: RestOptions = {}): HttpResult {
    const query = { ...(opts.query ?? {}) };
    const body = (opts.body ?? {}) as Row;
    const rep = (opts.prefer ?? "").includes("return=representation");

    if (!uid) {
      if (method === "GET") return leak("anonSelect") ? ok([]) : denied(null);
      return leak("anonInsert") ? ok(null, 201) : denied(null);
    }

    switch (table) {
      case "whiteboards": {
        if (method === "POST") {
          if (body.user_id !== uid) return denied(uid);
          const row: Row = { id: uuid(), user_id: uid, title: body.title ?? "Untitled Whiteboard", data: body.data ?? {}, version: 1 };
          boards.set(row.id as string, row);
          return ok(rep ? [row] : null, 201);
        }
        const crossLeak = method === "GET" ? leak("crossSelect") : method === "PATCH" ? leak("crossUpdate") : leak("crossDelete");
        if (method === "PATCH" && leak("staleUpdateApplies")) delete query.version;
        const visible = [...boards.values()].filter((r) => (r.user_id === uid || crossLeak) && matches(r, query));
        if (method === "GET") return ok(visible);
        if (method === "PATCH") {
          for (const r of visible) {
            const dataChanged = "data" in body && JSON.stringify(body.data) !== JSON.stringify(r.data);
            Object.assign(r, body);
            if (dataChanged && !leak("noVersionBump")) {
              r.version = (r.version as number) + 1;
              if (!leak("noSnapshotHistory")) {
                snapshots.push({ id: snapshots.length + 1, whiteboard_id: r.id, user_id: r.user_id, version: r.version, data: r.data });
              }
            }
          }
          return ok(rep ? visible : null);
        }
        if (method === "DELETE") {
          for (const r of visible) {
            boards.delete(r.id as string);
            for (let i = snapshots.length - 1; i >= 0; i--) if (snapshots[i].whiteboard_id === r.id) snapshots.splice(i, 1);
            for (let i = assets.length - 1; i >= 0; i--) if (assets[i].whiteboard_id === r.id) assets.splice(i, 1);
          }
          return ok(rep ? visible : null);
        }
        break;
      }
      case "user_settings": {
        if (method === "POST") {
          if (body.user_id !== uid && !leak("settingsHijack")) return denied(uid);
          const row: Row = { user_id: body.user_id, features: body.features ?? {} };
          settings.set(row.user_id as string, row);
          return ok(rep ? [row] : null, 201);
        }
        if (method === "GET") return ok([...settings.values()].filter((r) => r.user_id === uid && matches(r, query)));
        return ok(rep ? [] : null);
      }
      case "bug_reports": {
        if (method === "POST") {
          if (body.user_id != null && body.user_id !== uid && !leak("bugReportForeign")) return denied(uid);
          bugReports.push({ id: uuid(), ...body });
          return ok(null, 201);
        }
        if (method === "GET") return leak("bugReportRead") ? ok(bugReports) : denied(uid);
        return denied(uid);
      }
      case "trainers": {
        if (method === "POST") return leak("trainersInsert") ? ok(null, 201) : denied(uid);
        if (method === "GET") return ok([]);
        return ok(rep ? [] : null);
      }
      case "training_samples": {
        if (method === "POST") return leak("trainingInsert") ? ok(null, 201) : denied(uid);
        return ok([]);
      }
      case "whiteboard_snapshots": {
        if (method === "POST") {
          const owns = boards.get(body.whiteboard_id as string)?.user_id === uid;
          if ((body.user_id !== uid || !owns) && !leak("snapshotForeign")) return denied(uid);
          snapshots.push({ id: snapshots.length + 1, ...body });
          return ok(null, 201);
        }
        if (method === "GET") return ok(ordered(snapshots.filter((r) => r.user_id === uid && matches(r, query)), query));
        return ok(rep ? [] : null);
      }
      case "board_assets": {
        if (method === "POST") {
          if (body.user_id !== uid) return denied(uid);
          const owns = boards.get(body.whiteboard_id as string)?.user_id === uid;
          if (!owns && !leak("assetForeignBoard")) return denied(uid);
          const row: Row = { id: uuid(), ...body };
          assets.push(row);
          return ok(rep ? [row] : null, 201);
        }
        const visible = assets.filter((r) => (r.user_id === uid || leak("assetCrossRead")) && matches(r, query));
        if (method === "GET") return ok(visible);
        if (method === "PATCH") {
          for (const r of visible) Object.assign(r, body);
          return ok(rep ? visible : null);
        }
        if (method === "DELETE") {
          for (const r of visible) assets.splice(assets.indexOf(r), 1);
          return ok(rep ? visible : null);
        }
        break;
      }
    }
    return { status: 404, body: { message: `fake: unsupported ${method} ${table}` } };
  }

  function upload(uid: string | null, bucket: string, path: string): HttpResult {
    if (!uid) return denied(null);
    const folder = path.split("/")[0];
    if (bucket === "training-data") return leak("trainingUpload") ? ok({ Key: `${bucket}/${path}` }) : storageDenied();
    if (bucket === "board-assets") {
      if (folder !== uid && !leak("storageForeignUpload")) return storageDenied();
      objects.set(`${bucket}/${path}`, uid);
      return ok({ Key: `${bucket}/${path}` });
    }
    return { status: 404, body: { message: "Bucket not found" } };
  }

  function publicRead(bucket: string, path: string): HttpResult {
    if (leak("storagePublicRead")) return { status: 400, body: null };
    return bucket === "board-assets" && objects.has(`${bucket}/${path}`) ? ok(null) : { status: 404, body: null };
  }

  function storageDelete(uid: string | null, bucket: string, path: string): HttpResult {
    const key = `${bucket}/${path}`;
    const owner = objects.get(key);
    if (owner === undefined || (owner !== uid && !leak("storageForeignDelete"))) {
      return { status: 404, body: { statusCode: "404", error: "not_found", message: "Object not found" } };
    }
    objects.delete(key);
    return ok({ message: "Successfully deleted" });
  }

  const client = (uid: string | null): RlsClient => ({
    userId: uid,
    rest: async (method, table, opts) => rest(uid, method, table, opts),
    upload: async (bucket, path) => upload(uid, bucket, path),
    publicRead: async (bucket, path) => publicRead(bucket, path),
    storageDelete: async (bucket, path) => storageDelete(uid, bucket, path),
  });

  const ctx: CheckContext = { anon: client(null), a: client(USER_A), b: client(USER_B) };
  return { ctx, state: { boards, settings, bugReports, snapshots, assets, objects } };
}

const failures = (results: CheckResult[]) => results.filter((r) => !r.pass).map((r) => r.name);

// ---------------------------------------------------------------- checks

describe("rlsChecks against a correctly secured fake", () => {
  it("every check passes", async () => {
    const { ctx } = makeWorld();
    const results = await runAllChecks(ctx);
    expect(results.length).toBeGreaterThanOrEqual(50);
    expect(failures(results)).toEqual([]);
  });

  it("covers select+insert for every public table under anon", async () => {
    const results = await checkAnonDenied(makeWorld().ctx);
    for (const table of PUBLIC_TABLES) {
      expect(results.map((r) => r.name)).toContain(`anon: select ${table} denied`);
      expect(results.map((r) => r.name)).toContain(`anon: insert ${table} denied`);
    }
    expect(PUBLIC_TABLES).toHaveLength(7);
  });

  it("removes every whiteboard and storage object it created", async () => {
    const { ctx, state } = makeWorld();
    await runAllChecks(ctx);
    expect(state.boards.size).toBe(0);
    expect(state.objects.size).toBe(0);
    expect(state.snapshots).toEqual([]);
    expect(state.assets).toEqual([]);
  });
});

describe("rlsChecks detect individual leaks", () => {
  const cases: Array<[Leak, (ctx: CheckContext) => Promise<CheckResult[]>, string]> = [
    ["anonSelect", checkAnonDenied, "anon: select whiteboards denied"],
    ["anonInsert", checkAnonDenied, "anon: insert bug_reports denied"],
    ["crossSelect", checkCrossUserIsolation, "whiteboards: B cannot read A's board (select returns [])"],
    ["crossUpdate", checkCrossUserIsolation, "whiteboards: B cannot update A's board (0 rows)"],
    ["crossDelete", checkCrossUserIsolation, "whiteboards: B cannot delete A's board (0 rows)"],
    ["settingsHijack", checkUserSettingsIsolation, "user_settings: B cannot upsert A's row"],
    ["settingsHijack", checkUserSettingsIsolation, "user_settings: A's features unchanged after B's attempt"],
    ["bugReportForeign", checkBugReports, "bug_reports: A cannot insert report with B's user_id"],
    ["bugReportRead", checkBugReports, "bug_reports: not readable back by the reporter"],
    ["trainersInsert", checkTrainersNotWritable, "trainers: self-insert denied"],
    ["trainingInsert", checkTrainingSamplesDenied, "training_samples: non-trainer insert denied"],
    ["snapshotForeign", checkSnapshots, "whiteboard_snapshots: B cannot insert snapshot for A's board"],
    ["assetForeignBoard", checkBoardAssets, "board_assets: B cannot register asset on A's board"],
    ["assetCrossRead", checkBoardAssets, "board_assets: B cannot read A's assets"],
    ["storageForeignUpload", checkStorage, "storage: B cannot upload into A's board-assets folder"],
    ["storagePublicRead", checkStorage, "storage: board-assets object is publicly readable"],
    ["storageForeignDelete", checkStorage, "storage: B cannot delete A's board-assets object"],
    ["trainingUpload", checkStorage, "storage: non-trainer cannot upload to training-data"],
    ["noVersionBump", checkVersionTrigger, "version: data update bumps version 1 -> 2"],
    ["staleUpdateApplies", checkVersionTrigger, "version: stale optimistic update (version=1) affects 0 rows"],
    ["noSnapshotHistory", checkVersionTrigger, "version: snapshot history recorded for versions 2 and 3"],
  ];

  it.each(cases)("leak %s makes '%s' fail", async (leak, check, failingName) => {
    const results = await check(makeWorld([leak]).ctx);
    expect(failures(results)).toContain(failingName);
  });

  it("a leak in one area does not fail unrelated checks", async () => {
    const results = await runAllChecks(makeWorld(["bugReportRead"]).ctx);
    expect(failures(results)).toEqual(["bug_reports: not readable back by the reporter"]);
  });

  it("owner CRUD fails when the insert does not echo version 1", async () => {
    const { ctx } = makeWorld();
    const real = ctx.a.rest;
    ctx.a.rest = async (method, table, opts) => {
      const res = await real(method, table, opts);
      if (method === "POST" && table === "whiteboards" && Array.isArray(res.body)) {
        return { status: res.status, body: res.body.map((r) => ({ ...(r as Row), version: 7 })) };
      }
      return res;
    };
    const results = await checkWhiteboardOwnerCrud(ctx);
    expect(failures(results)).toEqual(["whiteboards: A creates own board (version starts at 1)"]);
  });
});

describe("runner helpers", () => {
  it("runCheck converts a thrown error into a failing result", async () => {
    const results = await runCheck({ name: "boom", run: async () => { throw new Error("network down"); } }, makeWorld().ctx);
    expect(results).toEqual([{ name: "boom (threw)", pass: false, detail: "network down" }]);
  });

  it("runAllChecks keeps going after a throwing check", async () => {
    const results = await runAllChecks(makeWorld().ctx, [
      { name: "first", run: async () => { throw new Error("x"); } },
      ALL_CHECKS[1],
    ]);
    expect(results[0].pass).toBe(false);
    expect(results.slice(1).every((r) => r.pass)).toBe(true);
  });

  it("formatResults prints PASS/FAIL rows and a summary", () => {
    const text = formatResults([
      { name: "ok thing", pass: true, detail: "200 []" },
      { name: "bad thing", pass: false, detail: "201 null" },
    ]);
    expect(text).toMatch(/^PASS {2}ok thing/m);
    expect(text).toMatch(/^FAIL {2}bad thing.*201 null/m);
    expect(text).toContain("1/2 checks passed, 1 FAILED");
    expect(text).not.toContain("200 []"); // details only for failures
  });

  it("ALL_CHECKS has unique names and covers every area", () => {
    const names = ALL_CHECKS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.join(" ")).toMatch(/anon/);
    expect(names.join(" ")).toMatch(/storage/);
    expect(names.join(" ")).toMatch(/version/);
  });
});

describe("predicates", () => {
  it("isDenied accepts 401 and 403 only", () => {
    expect(isDenied({ status: 401, body: null })).toBe(true);
    expect(isDenied({ status: 403, body: null })).toBe(true);
    expect(isDenied({ status: 400, body: null })).toBe(false);
    expect(isDenied({ status: 200, body: [] })).toBe(false);
  });

  it("isStorageDenied reads storage-api's 400/statusCode 403 shape", () => {
    expect(isStorageDenied({ status: 400, body: { statusCode: "403", code: "AccessDenied" } })).toBe(true);
    expect(isStorageDenied({ status: 403, body: null })).toBe(true);
    expect(isStorageDenied({ status: 400, body: { statusCode: "400", code: "InvalidRequest" } })).toBe(false);
    expect(isStorageDenied({ status: 200, body: { Key: "x" } })).toBe(false);
    expect(isStorageDenied({ status: 400, body: "text" })).toBe(false);
  });

  it("deniedOrEmpty / affectedNoRows distinguish [] from rows", () => {
    expect(affectedNoRows({ status: 200, body: [] })).toBe(true);
    expect(affectedNoRows({ status: 200, body: [{ id: 1 }] })).toBe(false);
    expect(affectedNoRows({ status: 200, body: null })).toBe(true);
    expect(deniedOrEmpty({ status: 403, body: null })).toBe(true);
    expect(deniedOrEmpty({ status: 200, body: [{ id: 1 }] })).toBe(false);
  });

  it("minimalInsert returns a body for every public table", () => {
    for (const table of PUBLIC_TABLES) {
      expect(Object.keys(minimalInsert(table)).length).toBeGreaterThan(0);
    }
    expect(minimalInsert("nope")).toEqual({});
  });
});

// ---------------------------------------------------------------- supabaseHttp

type FakeFetch = typeof fetch & { calls: Array<{ url: string; init: RequestInit | undefined }> };

function fakeFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as FakeFetch;
  fn.calls = calls;
  return fn;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("supabaseHttp", () => {
  it("parseEnvText handles quotes, comments and blanks", () => {
    expect(parseEnvText('A=1\n# c\n\nB="two words"\nC=\'x\'\nBAD\nD=a=b')).toEqual({ A: "1", B: "two words", C: "x", D: "a=b" });
  });

  it("isLoopbackUrl only accepts local hosts", () => {
    expect(isLoopbackUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLoopbackUrl("http://localhost:54321")).toBe(true);
    expect(isLoopbackUrl("https://abc.supabase.co")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });

  it("resolveSupabaseEnv prefers env and reports the source", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "http://x", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" };
    expect(resolveSupabaseEnv(env, { allowLocalFallback: false })).toEqual({ url: "http://x", anonKey: "k", serviceKey: undefined, source: "env" });
    expect(resolveSupabaseEnv({}, { allowLocalFallback: false }).source).toBe("none");
  });

  it("toResult parses JSON and falls back to text", async () => {
    expect(await toResult(json({ a: 1 }, 201))).toEqual({ status: 201, body: { a: 1 } });
    expect(await toResult(new Response("plain", { status: 500 }))).toEqual({ status: 500, body: "plain" });
    expect(await toResult(new Response(null, { status: 204 }))).toEqual({ status: 204, body: null });
  });

  it("waitForHealth resolves true on 200 and false after the timeout", async () => {
    let n = 0;
    const flaky = fakeFetch(() => (++n < 3 ? new Response("", { status: 503 }) : new Response("", { status: 200 })));
    expect(await waitForHealth("http://x", { fetchImpl: flaky, intervalMs: 1, timeoutMs: 5_000 })).toBe(true);
    expect(flaky.calls[0].url).toBe("http://x/auth/v1/health");

    const down = fakeFetch(() => { throw new Error("ECONNREFUSED"); });
    expect(await waitForHealth("http://x", { fetchImpl: down, intervalMs: 1, timeoutMs: 10 })).toBe(false);
  });

  it("createSupabaseHttp builds PostgREST requests with the right headers", async () => {
    const f = fakeFetch(() => json([{ id: 1 }]));
    const client = createSupabaseHttp({ url: "http://x/", anonKey: "anon", accessToken: "tok", userId: "u1", fetchImpl: f });
    const res = await client.rest("PATCH", "whiteboards", { query: { id: "eq.1", version: "eq.2" }, body: { title: "t" }, prefer: "return=representation" });
    expect(res).toEqual({ status: 200, body: [{ id: 1 }] });
    const call = f.calls[0];
    expect(call.url).toBe("http://x/rest/v1/whiteboards?id=eq.1&version=eq.2");
    expect(call.init?.method).toBe("PATCH");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.apikey).toBe("anon");
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers.Prefer).toBe("return=representation");
    expect(call.init?.body).toBe(JSON.stringify({ title: "t" }));
  });

  it("anon client uses the anon key as bearer and sends no body on GET", async () => {
    const f = fakeFetch(() => json([]));
    const client = createSupabaseHttp({ url: "http://x", anonKey: "anon", fetchImpl: f });
    await client.rest("GET", "trainers");
    expect(client.userId).toBeNull();
    expect((f.calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer anon");
    expect(f.calls[0].init?.body).toBeUndefined();
    expect(f.calls[0].url).toBe("http://x/rest/v1/trainers");
  });

  it("upload records successful keys only; publicRead sends no credentials", async () => {
    const f = fakeFetch((url) => (url.includes("/denied.png") ? json({ statusCode: "403" }, 400) : json({ Key: "k" })));
    const client = createSupabaseHttp({ url: "http://x", anonKey: "anon", accessToken: "tok", userId: "u1", fetchImpl: f });
    await client.upload("board-assets", "u1/b/ok.png", new Uint8Array([1]), "image/png");
    await client.upload("board-assets", "u2/b/denied.png", new Uint8Array([1]), "image/png");
    expect(client.uploaded).toEqual(["board-assets/u1/b/ok.png"]);
    expect(f.calls[0].url).toBe("http://x/storage/v1/object/board-assets/u1/b/ok.png");
    expect((f.calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe("image/png");

    await client.publicRead("board-assets", "u1/b/ok.png");
    expect(f.calls[2].url).toBe("http://x/storage/v1/object/public/board-assets/u1/b/ok.png");
    expect(f.calls[2].init).toBeUndefined();

    await client.storageDelete("board-assets", "u1/b/ok.png");
    expect(f.calls[3].init?.method).toBe("DELETE");
  });

  it("provisionUser: signup returns a session", async () => {
    const f = fakeFetch(() => json({ access_token: "t", user: { id: "u1" } }));
    const s = await provisionUser({ url: "http://x", anonKey: "anon", email: "e@example.com", password: "p", fetchImpl: f });
    expect(s).toEqual({ accessToken: "t", userId: "u1", email: "e@example.com" });
    expect(f.calls[0].url).toBe("http://x/auth/v1/signup");
  });

  it("provisionUser: explains how to fix disabled signups and pending confirmations", async () => {
    const disabled = fakeFetch(() => json({ code: 422, error_code: "signup_disabled", msg: "Signups not allowed for this instance" }, 422));
    await expect(provisionUser({ url: "http://x", anonKey: "anon", email: "e@example.com", password: "p", fetchImpl: disabled })).rejects.toThrow(
      /Signups are disabled[\s\S]*SUPABASE_SERVICE_ROLE_KEY/,
    );
    const pending = fakeFetch(() => json({ id: "u1", confirmation_sent_at: "now" }));
    await expect(provisionUser({ url: "http://x", anonKey: "anon", email: "e@example.com", password: "p", fetchImpl: pending })).rejects.toThrow(
      /confirmations are enabled/,
    );
  });

  it("provisionUser: uses the admin API when a service key is present, then signs in", async () => {
    const f = fakeFetch((url) =>
      url.endsWith("/auth/v1/admin/users") ? json({ id: "u9" }) : json({ access_token: "tok9", user: { id: "u9" } }),
    );
    const s = await provisionUser({ url: "http://x", anonKey: "anon", serviceKey: "svc", email: "e@example.com", password: "p", fetchImpl: f });
    expect(s.userId).toBe("u9");
    expect(s.accessToken).toBe("tok9");
    expect((f.calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer svc");
    expect(JSON.parse(String(f.calls[0].init?.body))).toMatchObject({ email_confirm: true });
    expect(f.calls[1].url).toBe("http://x/auth/v1/token?grant_type=password");
  });
});
