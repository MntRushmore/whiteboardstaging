/**
 * Behavioural RLS checks for the Agathon Classroom schema.
 *
 * Every check is a pure async function over a CheckContext made of three tiny
 * clients (anon, user A, user B). It never touches process.env or the network
 * directly, so the same functions run against a live Supabase project
 * (scripts/verify-rls.mjs, src/__tests__/db-rls.integration.test.ts) and
 * against an in-memory fake (src/__tests__/verifyRls.test.ts).
 *
 * @typedef {{ status: number, body: unknown }} HttpResult
 * @typedef {{ query?: Record<string, string>, body?: unknown, prefer?: string }} RestOptions
 * @typedef {{
 *   userId: string | null,
 *   rest: (method: string, table: string, opts?: RestOptions) => Promise<HttpResult>,
 *   upload: (bucket: string, path: string, bytes: Uint8Array, contentType: string) => Promise<HttpResult>,
 *   publicRead: (bucket: string, path: string) => Promise<HttpResult>,
 *   storageDelete: (bucket: string, path: string) => Promise<HttpResult>,
 * }} RlsClient
 * @typedef {{ anon: RlsClient, a: RlsClient, b: RlsClient }} CheckContext
 * @typedef {{ name: string, pass: boolean, detail: string }} CheckResult
 * @typedef {{ name: string, run: (ctx: CheckContext) => Promise<CheckResult[]> }} CheckDef
 */

export const PUBLIC_TABLES = [
  "whiteboards",
  "user_settings",
  "bug_reports",
  "trainers",
  "training_samples",
  "whiteboard_snapshots",
  "board_assets",
];

export const ASSETS_BUCKET = "board-assets";
export const TRAINING_BUCKET = "training-data";

/** 1x1 transparent PNG. */
export const TINY_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------- predicates

/** PostgREST answers 401 for anon and 403 for authenticated on privilege/RLS violations. */
export function isDenied(res) {
  return res.status === 401 || res.status === 403;
}

export function isOk(res) {
  return res.status >= 200 && res.status < 300;
}

/**
 * storage-api reports RLS violations either as HTTP 403 or, on some versions,
 * as HTTP 400 with {"statusCode":"403","code":"AccessDenied"} in the body.
 */
export function isStorageDenied(res) {
  if (isDenied(res)) return true;
  const body = res.body;
  if (!body || typeof body !== "object") return false;
  const code = String(/** @type {any} */ (body).statusCode ?? "");
  const name = String(/** @type {any} */ (body).code ?? /** @type {any} */ (body).error ?? "");
  return code === "401" || code === "403" || /AccessDenied|Unauthorized/i.test(name);
}

/** @returns {Array<Record<string, any>>} */
export function rows(res) {
  return Array.isArray(res.body) ? res.body : [];
}

/** Zero-row 2xx with a representation, i.e. RLS silently filtered everything. */
export function affectedNoRows(res) {
  return isOk(res) && rows(res).length === 0;
}

/** Either the role has no privilege at all, or RLS hides every row. */
export function deniedOrEmpty(res) {
  return isDenied(res) || affectedNoRows(res);
}

/**
 * @param {string} name
 * @param {unknown} pass
 * @param {string} [detail]
 * @returns {CheckResult}
 */
export function result(name, pass, detail = "") {
  return { name, pass: Boolean(pass), detail };
}

/** @param {HttpResult} res */
export function describe(res) {
  const body = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
  return `${res.status} ${body ?? ""}`.slice(0, 200);
}

const uuid = () => globalThis.crypto.randomUUID();

// ---------------------------------------------------------------- fixtures

/**
 * A syntactically valid insert body per table; anon must be rejected before
 * any constraint is evaluated, so the values only need to parse.
 * @param {string} table
 * @param {string} [userId]
 */
export function minimalInsert(table, userId = ZERO_UUID) {
  switch (table) {
    case "whiteboards":
      return { title: "rls-verify", data: {}, user_id: userId };
    case "user_settings":
      return { user_id: userId, features: {} };
    case "bug_reports":
      return { user_id: userId, message: "rls-verify" };
    case "trainers":
      return { user_id: userId };
    case "training_samples":
      return {
        id: uuid(),
        created_by: userId,
        subject: "math",
        difficulty: "easy",
        mode: "feedback",
        before_url: "rls-verify/before.png",
        after_full_url: "rls-verify/after.png",
        tldraw_snapshot: {},
      };
    case "whiteboard_snapshots":
      return { whiteboard_id: ZERO_UUID, user_id: userId, version: 1, data: {} };
    case "board_assets":
      return { whiteboard_id: ZERO_UUID, user_id: userId, object_path: `${userId}/x/${uuid()}.png`, mime_type: "image/png" };
    default:
      return {};
  }
}

/**
 * @param {RlsClient} client
 * @param {string} [title]
 */
async function createBoard(client, title = "rls-verify") {
  const res = await client.rest("POST", "whiteboards", {
    body: { title, data: {}, user_id: client.userId },
    prefer: "return=representation",
  });
  const row = rows(res)[0];
  if (!isOk(res) || !row?.id) throw new Error(`could not create whiteboard as ${client.userId}: ${describe(res)}`);
  return row;
}

/**
 * @param {RlsClient} client
 * @param {string} id
 */
async function deleteBoard(client, id) {
  return client.rest("DELETE", "whiteboards", { query: { id: `eq.${id}` }, prefer: "return=representation" });
}

// ---------------------------------------------------------------- checks

/** @param {CheckContext} ctx */
export async function checkAnonDenied({ anon }) {
  /** @type {CheckResult[]} */
  const out = [];
  for (const table of PUBLIC_TABLES) {
    const sel = await anon.rest("GET", table, { query: { select: "*", limit: "1" } });
    out.push(result(`anon: select ${table} denied`, isDenied(sel), describe(sel)));
    const ins = await anon.rest("POST", table, { body: minimalInsert(table), prefer: "return=minimal" });
    out.push(result(`anon: insert ${table} denied`, isDenied(ins), describe(ins)));
  }
  return out;
}

/** @param {CheckContext} ctx */
export async function checkWhiteboardOwnerCrud({ a }) {
  /** @type {CheckResult[]} */
  const out = [];
  const created = await a.rest("POST", "whiteboards", {
    body: { title: "rls-verify owner", data: {}, user_id: a.userId },
    prefer: "return=representation",
  });
  const row = rows(created)[0];
  out.push(
    result(
      "whiteboards: A creates own board (version starts at 1)",
      isOk(created) && row?.user_id === a.userId && row?.version === 1,
      describe(created),
    ),
  );
  if (!row?.id) return out;

  const sel = await a.rest("GET", "whiteboards", { query: { id: `eq.${row.id}`, select: "id,title,user_id" } });
  out.push(
    result("whiteboards: A reads own board", isOk(sel) && rows(sel).length === 1 && rows(sel)[0].id === row.id, describe(sel)),
  );

  const upd = await a.rest("PATCH", "whiteboards", {
    query: { id: `eq.${row.id}` },
    body: { title: "rls-verify owner renamed" },
    prefer: "return=representation",
  });
  out.push(
    result(
      "whiteboards: A updates own board",
      isOk(upd) && rows(upd).length === 1 && rows(upd)[0].title === "rls-verify owner renamed",
      describe(upd),
    ),
  );

  const del = await deleteBoard(a, row.id);
  out.push(result("whiteboards: A deletes own board", isOk(del) && rows(del).length === 1, describe(del)));

  const after = await a.rest("GET", "whiteboards", { query: { id: `eq.${row.id}`, select: "id" } });
  out.push(result("whiteboards: deleted board is gone", affectedNoRows(after), describe(after)));
  return out;
}

/** @param {CheckContext} ctx */
export async function checkCrossUserIsolation({ a, b }) {
  /** @type {CheckResult[]} */
  const out = [];
  const board = await createBoard(a, "rls-verify isolation");
  try {
    const bSel = await b.rest("GET", "whiteboards", { query: { id: `eq.${board.id}`, select: "*" } });
    out.push(result("whiteboards: B cannot read A's board (select returns [])", affectedNoRows(bSel), describe(bSel)));

    const bUpd = await b.rest("PATCH", "whiteboards", {
      query: { id: `eq.${board.id}` },
      body: { title: "hijacked" },
      prefer: "return=representation",
    });
    out.push(result("whiteboards: B cannot update A's board (0 rows)", deniedOrEmpty(bUpd), describe(bUpd)));

    const bDel = await b.rest("DELETE", "whiteboards", { query: { id: `eq.${board.id}` }, prefer: "return=representation" });
    out.push(result("whiteboards: B cannot delete A's board (0 rows)", deniedOrEmpty(bDel), describe(bDel)));

    const aSel = await a.rest("GET", "whiteboards", { query: { id: `eq.${board.id}`, select: "id,title" } });
    out.push(
      result(
        "whiteboards: A's board intact after B's attempts",
        isOk(aSel) && rows(aSel).length === 1 && rows(aSel)[0].title === "rls-verify isolation",
        describe(aSel),
      ),
    );
  } finally {
    await deleteBoard(a, board.id);
  }
  return out;
}

/** @param {CheckContext} ctx */
export async function checkUserSettingsIsolation({ a, b }) {
  /** @type {CheckResult[]} */
  const out = [];
  const upsertPrefer = "resolution=merge-duplicates,return=representation";
  const aUp = await a.rest("POST", "user_settings", {
    query: { on_conflict: "user_id" },
    body: { user_id: a.userId, features: { rlsVerify: "a" } },
    prefer: upsertPrefer,
  });
  out.push(result("user_settings: A upserts own row", isOk(aUp) && rows(aUp)[0]?.user_id === a.userId, describe(aUp)));

  const bUp = await b.rest("POST", "user_settings", {
    query: { on_conflict: "user_id" },
    body: { user_id: b.userId, features: { rlsVerify: "b" } },
    prefer: upsertPrefer,
  });
  out.push(result("user_settings: B upserts own row", isOk(bUp) && rows(bUp)[0]?.user_id === b.userId, describe(bUp)));

  const aSel = await a.rest("GET", "user_settings", { query: { select: "user_id,features" } });
  out.push(
    result(
      "user_settings: A sees only own row",
      isOk(aSel) && rows(aSel).length === 1 && rows(aSel)[0].user_id === a.userId && rows(aSel)[0].features?.rlsVerify === "a",
      describe(aSel),
    ),
  );

  const bSel = await b.rest("GET", "user_settings", { query: { select: "user_id,features" } });
  out.push(
    result(
      "user_settings: B sees only own row",
      isOk(bSel) && rows(bSel).length === 1 && rows(bSel)[0].user_id === b.userId,
      describe(bSel),
    ),
  );

  const hijack = await b.rest("POST", "user_settings", {
    query: { on_conflict: "user_id" },
    body: { user_id: a.userId, features: { rlsVerify: "hijacked" } },
    prefer: upsertPrefer,
  });
  out.push(result("user_settings: B cannot upsert A's row", isDenied(hijack), describe(hijack)));

  const aAfter = await a.rest("GET", "user_settings", { query: { select: "features" } });
  out.push(
    result(
      "user_settings: A's features unchanged after B's attempt",
      isOk(aAfter) && rows(aAfter)[0]?.features?.rlsVerify === "a",
      describe(aAfter),
    ),
  );
  return out;
}

/** @param {CheckContext} ctx */
export async function checkBugReports({ a, b }) {
  /** @type {CheckResult[]} */
  const out = [];
  const own = await a.rest("POST", "bug_reports", {
    body: { user_id: a.userId, user_email: "rls-verify@example.com", message: "rls-verify", diagnostics: {}, logs: [] },
    prefer: "return=minimal",
  });
  out.push(result("bug_reports: A inserts report for self", isOk(own), describe(own)));

  const foreign = await a.rest("POST", "bug_reports", {
    body: { user_id: b.userId, message: "rls-verify forged" },
    prefer: "return=minimal",
  });
  out.push(result("bug_reports: A cannot insert report with B's user_id", isDenied(foreign), describe(foreign)));

  const read = await a.rest("GET", "bug_reports", { query: { select: "id", limit: "1" } });
  out.push(result("bug_reports: not readable back by the reporter", deniedOrEmpty(read), describe(read)));
  return out;
}

/** @param {CheckContext} ctx */
export async function checkTrainersNotWritable({ a }) {
  /** @type {CheckResult[]} */
  const out = [];
  const ins = await a.rest("POST", "trainers", { body: { user_id: a.userId }, prefer: "return=minimal" });
  out.push(result("trainers: self-insert denied", isDenied(ins), describe(ins)));

  const sel = await a.rest("GET", "trainers", { query: { select: "user_id" } });
  out.push(result("trainers: non-trainer sees no rows", affectedNoRows(sel), describe(sel)));

  const upd = await a.rest("PATCH", "trainers", {
    query: { user_id: `eq.${a.userId}` },
    body: { created_at: new Date().toISOString() },
    prefer: "return=representation",
  });
  out.push(result("trainers: update denied or affects 0 rows", deniedOrEmpty(upd), describe(upd)));

  const del = await a.rest("DELETE", "trainers", { query: { user_id: `eq.${a.userId}` }, prefer: "return=representation" });
  out.push(result("trainers: delete denied or affects 0 rows", deniedOrEmpty(del), describe(del)));
  return out;
}

/** @param {CheckContext} ctx */
export async function checkTrainingSamplesDenied({ a }) {
  /** @type {CheckResult[]} */
  const out = [];
  const ins = await a.rest("POST", "training_samples", {
    body: minimalInsert("training_samples", a.userId ?? ZERO_UUID),
    prefer: "return=minimal",
  });
  out.push(result("training_samples: non-trainer insert denied", isDenied(ins), describe(ins)));

  const sel = await a.rest("GET", "training_samples", { query: { select: "id", limit: "1" } });
  out.push(result("training_samples: non-trainer sees no rows", deniedOrEmpty(sel), describe(sel)));
  return out;
}

/** @param {CheckContext} ctx */
export async function checkSnapshots({ a, b }) {
  /** @type {CheckResult[]} */
  const out = [];
  const board = await createBoard(a, "rls-verify snapshots");
  try {
    const bIns = await b.rest("POST", "whiteboard_snapshots", {
      body: { whiteboard_id: board.id, user_id: b.userId, version: 900001, data: {} },
      prefer: "return=minimal",
    });
    out.push(result("whiteboard_snapshots: B cannot insert snapshot for A's board", isDenied(bIns), describe(bIns)));

    const bForged = await b.rest("POST", "whiteboard_snapshots", {
      body: { whiteboard_id: board.id, user_id: a.userId, version: 900002, data: {} },
      prefer: "return=minimal",
    });
    out.push(result("whiteboard_snapshots: B cannot insert snapshot as A", isDenied(bForged), describe(bForged)));

    const aIns = await a.rest("POST", "whiteboard_snapshots", {
      body: { whiteboard_id: board.id, user_id: a.userId, version: 900001, data: {} },
      prefer: "return=minimal",
    });
    out.push(result("whiteboard_snapshots: A inserts snapshot for own board", isOk(aIns), describe(aIns)));

    const bSel = await b.rest("GET", "whiteboard_snapshots", { query: { whiteboard_id: `eq.${board.id}`, select: "id" } });
    out.push(result("whiteboard_snapshots: B cannot read A's snapshots", affectedNoRows(bSel), describe(bSel)));

    const aSel = await a.rest("GET", "whiteboard_snapshots", { query: { whiteboard_id: `eq.${board.id}`, select: "version" } });
    out.push(result("whiteboard_snapshots: A reads own snapshots", isOk(aSel) && rows(aSel).length >= 1, describe(aSel)));
  } finally {
    await deleteBoard(a, board.id);
  }
  return out;
}

/** @param {CheckContext} ctx */
export async function checkBoardAssets({ a, b }) {
  /** @type {CheckResult[]} */
  const out = [];
  const board = await createBoard(a, "rls-verify assets");
  try {
    const aIns = await a.rest("POST", "board_assets", {
      body: { whiteboard_id: board.id, user_id: a.userId, object_path: `${a.userId}/${board.id}/${uuid()}.png`, mime_type: "image/png" },
      prefer: "return=representation",
    });
    const asset = rows(aIns)[0];
    out.push(result("board_assets: A registers asset on own board", isOk(aIns) && Boolean(asset?.id), describe(aIns)));

    const bSel = await b.rest("GET", "board_assets", { query: { whiteboard_id: `eq.${board.id}`, select: "id" } });
    out.push(result("board_assets: B cannot read A's assets", affectedNoRows(bSel), describe(bSel)));

    const bOwn = await b.rest("POST", "board_assets", {
      body: { whiteboard_id: board.id, user_id: b.userId, object_path: `${b.userId}/${board.id}/${uuid()}.png`, mime_type: "image/png" },
      prefer: "return=minimal",
    });
    out.push(result("board_assets: B cannot register asset on A's board", isDenied(bOwn), describe(bOwn)));

    const bForged = await b.rest("POST", "board_assets", {
      body: { whiteboard_id: board.id, user_id: a.userId, object_path: `${a.userId}/${board.id}/${uuid()}.png`, mime_type: "image/png" },
      prefer: "return=minimal",
    });
    out.push(result("board_assets: B cannot register asset as A", isDenied(bForged), describe(bForged)));

    if (asset?.id) {
      const bUpd = await b.rest("PATCH", "board_assets", {
        query: { id: `eq.${asset.id}` },
        body: { mime_type: "image/jpeg" },
        prefer: "return=representation",
      });
      out.push(result("board_assets: B cannot update A's asset (0 rows)", deniedOrEmpty(bUpd), describe(bUpd)));

      const bDel = await b.rest("DELETE", "board_assets", { query: { id: `eq.${asset.id}` }, prefer: "return=representation" });
      out.push(result("board_assets: B cannot delete A's asset (0 rows)", deniedOrEmpty(bDel), describe(bDel)));

      const aSel = await a.rest("GET", "board_assets", { query: { id: `eq.${asset.id}`, select: "id,mime_type" } });
      out.push(
        result(
          "board_assets: A's asset intact",
          isOk(aSel) && rows(aSel).length === 1 && rows(aSel)[0].mime_type === "image/png",
          describe(aSel),
        ),
      );
    }
  } finally {
    await deleteBoard(a, board.id);
  }
  return out;
}

/** @param {CheckContext} ctx */
export async function checkStorage({ a, b, anon }) {
  /** @type {CheckResult[]} */
  const out = [];
  const folder = uuid();
  const pathA = `${a.userId}/${folder}/a.png`;

  const up = await a.upload(ASSETS_BUCKET, pathA, TINY_PNG, "image/png");
  out.push(result("storage: A uploads into board-assets/<A>/...", isOk(up), describe(up)));

  const foreign = await b.upload(ASSETS_BUCKET, `${a.userId}/${folder}/b.png`, TINY_PNG, "image/png");
  out.push(result("storage: B cannot upload into A's board-assets folder", isStorageDenied(foreign), describe(foreign)));

  const pub = await anon.publicRead(ASSETS_BUCKET, pathA);
  out.push(result("storage: board-assets object is publicly readable", pub.status === 200, describe(pub)));

  const bDel = await b.storageDelete(ASSETS_BUCKET, pathA);
  const pubAfter = await anon.publicRead(ASSETS_BUCKET, pathA);
  out.push(
    result(
      "storage: B cannot delete A's board-assets object",
      !isOk(bDel) && pubAfter.status === 200,
      `delete ${describe(bDel)}; read-after ${pubAfter.status}`,
    ),
  );

  const train = await a.upload(TRAINING_BUCKET, `${a.userId}/${folder}/before.png`, TINY_PNG, "image/png");
  out.push(result("storage: non-trainer cannot upload to training-data", isStorageDenied(train), describe(train)));

  const aDel = await a.storageDelete(ASSETS_BUCKET, pathA);
  out.push(result("storage: A deletes own board-assets object", isOk(aDel), describe(aDel)));
  return out;
}

/** @param {CheckContext} ctx */
export async function checkVersionTrigger({ a }) {
  /** @type {CheckResult[]} */
  const out = [];
  const board = await createBoard(a, "rls-verify versions");
  try {
    const q = { id: `eq.${board.id}` };
    const u1 = await a.rest("PATCH", "whiteboards", { query: q, body: { data: { v: 1 } }, prefer: "return=representation" });
    out.push(result("version: data update bumps version 1 -> 2", isOk(u1) && rows(u1)[0]?.version === 2, describe(u1)));

    const u2 = await a.rest("PATCH", "whiteboards", { query: q, body: { title: "rls-verify versions 2" }, prefer: "return=representation" });
    out.push(result("version: title-only update keeps version 2", isOk(u2) && rows(u2)[0]?.version === 2, describe(u2)));

    const same = await a.rest("PATCH", "whiteboards", { query: q, body: { data: { v: 1 } }, prefer: "return=representation" });
    out.push(result("version: identical data keeps version 2", isOk(same) && rows(same)[0]?.version === 2, describe(same)));

    const stale = await a.rest("PATCH", "whiteboards", {
      query: { ...q, version: "eq.1" },
      body: { data: { v: 2 } },
      prefer: "return=representation",
    });
    out.push(result("version: stale optimistic update (version=1) affects 0 rows", affectedNoRows(stale), describe(stale)));

    const fresh = await a.rest("PATCH", "whiteboards", {
      query: { ...q, version: "eq.2" },
      body: { data: { v: 2 } },
      prefer: "return=representation",
    });
    out.push(result("version: fresh optimistic update (version=2) -> 3", isOk(fresh) && rows(fresh)[0]?.version === 3, describe(fresh)));

    const snaps = await a.rest("GET", "whiteboard_snapshots", {
      query: { whiteboard_id: `eq.${board.id}`, select: "version", order: "version.asc" },
    });
    const versions = rows(snaps).map((r) => Number(r.version));
    out.push(
      result(
        "version: snapshot history recorded for versions 2 and 3",
        isOk(snaps) && versions.length === 2 && versions[0] === 2 && versions[1] === 3,
        describe(snaps),
      ),
    );
  } finally {
    await deleteBoard(a, board.id);
  }
  return out;
}

// ---------------------------------------------------------------- registry / runner

/** @type {CheckDef[]} */
export const ALL_CHECKS = [
  { name: "anon has no access to any public table", run: checkAnonDenied },
  { name: "owner can CRUD own whiteboard", run: checkWhiteboardOwnerCrud },
  { name: "whiteboards are isolated between users", run: checkCrossUserIsolation },
  { name: "user_settings upsert is isolated per user", run: checkUserSettingsIsolation },
  { name: "bug_reports: insert-only for self", run: checkBugReports },
  { name: "trainers is read-only", run: checkTrainersNotWritable },
  { name: "training_samples denied for non-trainers", run: checkTrainingSamplesDenied },
  { name: "whiteboard_snapshots follow board ownership", run: checkSnapshots },
  { name: "board_assets are isolated", run: checkBoardAssets },
  { name: "storage bucket policies", run: checkStorage },
  { name: "version trigger and optimistic concurrency", run: checkVersionTrigger },
];

/**
 * Run one check, converting a thrown error into a single failing result.
 * @param {CheckDef} check
 * @param {CheckContext} ctx
 * @returns {Promise<CheckResult[]>}
 */
export async function runCheck(check, ctx) {
  try {
    return await check.run(ctx);
  } catch (err) {
    return [result(`${check.name} (threw)`, false, err instanceof Error ? err.message : String(err))];
  }
}

/**
 * @param {CheckContext} ctx
 * @param {CheckDef[]} [checks]
 * @returns {Promise<CheckResult[]>}
 */
export async function runAllChecks(ctx, checks = ALL_CHECKS) {
  /** @type {CheckResult[]} */
  const all = [];
  for (const check of checks) all.push(...(await runCheck(check, ctx)));
  return all;
}

/**
 * @param {CheckResult[]} results
 * @returns {string}
 */
export function formatResults(results) {
  const width = Math.max(5, ...results.map((r) => r.name.length));
  const lines = results.map((r) => {
    const status = r.pass ? "PASS" : "FAIL";
    const detail = r.pass ? "" : `  ${r.detail}`;
    return `${status}  ${r.name.padEnd(width)}${detail}`;
  });
  const failed = results.filter((r) => !r.pass).length;
  lines.push("");
  lines.push(`${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ""}`);
  return lines.join("\n");
}
