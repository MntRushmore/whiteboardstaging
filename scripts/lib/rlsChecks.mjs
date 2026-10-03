/**
 * Behavioural RLS checks for the Agathon schema.
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
 *   storageList: (bucket: string, prefix: string) => Promise<HttpResult>,
 *   storageDelete: (bucket: string, path: string) => Promise<HttpResult>,
 * }} RlsClient
 * `newUser` provisions one more throwaway user (needed by the delete_own_account
 * check, which destroys the account it runs as). Optional: without it that check fails.
 * `service` is a client bound to the service role (RLS bypassed). Optional: only the
 * refund check's "row older than 15 minutes" case needs it (nothing reachable with a
 * user token can back-date a ledger row); without it that single case is reported as
 * skipped.
 * @typedef {{ anon: RlsClient, a: RlsClient, b: RlsClient, newUser?: () => Promise<RlsClient>, service?: RlsClient }} CheckContext
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
  // accounts & billing (20260917020000_accounts_billing.sql)
  "plans",
  "profiles",
  "usage_events",
  "credit_grants",
  "billing_events",
  // refunds & rate limits (20260917030000_refunds_ratelimit.sql)
  "rate_limit_counters",
  // ink (20261002000000_ink.sql)
  "ink_packs",
  "ink_grants",
  "ink_purchases",
  "ink_checkout_reviews",
  // transactional email (20261003030000_email_log.sql)
  "email_log",
  // Agathon Unlimited (20261003020000_unlimited.sql)
  "unlimited_subscriptions",
  "unlimited_usage",
];

/** Keys every rate_limit_hit() payload must carry. */
export const RATE_LIMIT_KEYS = ["allowed", "remaining", "retry_after_ms", "backend"];

/** Keys every ink_summary() payload must carry (20261002000000_ink.sql). */
export const INK_SUMMARY_KEYS = ["balance", "granted", "purchased", "refunded", "used", "starter", "starter_at", "purchases", "last_purchase"];

/** The packs the migration seeds: [id, ink, price_cents]. */
export const INK_PACKS = [
  ["small", 1000, 500],
  ["medium", 5000, 2000],
  ["large", 14000, 5000],
];

/** Keys every credit_summary() / credit_balance() payload must carry. */
export const CREDIT_SUMMARY_KEYS = [
  "plan_id",
  "plan_name",
  "monthly_credits",
  "used",
  "granted",
  "remaining",
  "period_start",
  "period_end",
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
    case "plans":
      return { id: "rls-verify", name: "rls-verify", monthly_credits: 1 };
    case "profiles":
      return { user_id: userId, display_name: "rls-verify" };
    case "usage_events":
      return { user_id: userId, route: "rls-verify", units: 1 };
    case "credit_grants":
      return { user_id: userId, units: 1, reason: "rls-verify" };
    case "billing_events":
      return { id: `rls-verify-${uuid()}`, type: "rls-verify", payload: {} };
    case "rate_limit_counters":
      return { user_id: userId, bucket: "rls-verify", window_start: new Date().toISOString(), hits: 1, expires_at: new Date().toISOString() };
    case "ink_packs":
      return { id: "rls-verify", name: "rls-verify", ink: 1, price_cents: 1 };
    case "ink_grants":
      return { user_id: userId, units: 1000000, kind: "manual", reason: "rls-verify" };
    case "ink_purchases":
      return { user_id: userId, pack_id: "large", ink: 14000, amount_cents: 0, checkout_session_id: `cs_rls_verify_${uuid()}` };
    case "ink_checkout_reviews":
      return { checkout_session_id: `cs_rls_verify_${uuid()}`, reason: "rls-verify", user_id: userId };
    case "email_log":
      return { user_id: userId, kind: "welcome", ref: "" };
    case "unlimited_subscriptions":
      return { stripe_subscription_id: `sub_rls_verify_${uuid()}`, user_id: userId, status: "active" };
    case "unlimited_usage":
      return { user_id: userId, route: "rls-verify", units: 1 };
    default:
      return {};
  }
}

/**
 * PostgREST RPC helper: POST /rest/v1/rpc/<fn> with named arguments.
 * @param {RlsClient} client
 * @param {string} fn
 * @param {Record<string, unknown>} [args]
 */
export async function rpc(client, fn, args = {}) {
  return client.rest("POST", `rpc/${fn}`, { body: args });
}

/** @param {unknown} body */
function asObject(body) {
  return body && typeof body === "object" && !Array.isArray(body) ? /** @type {Record<string, any>} */ (body) : null;
}

/** True when `body` looks like a credit_summary() payload with consistent numbers. */
export function isCreditSummary(body) {
  const o = asObject(body);
  if (!o) return false;
  if (!CREDIT_SUMMARY_KEYS.every((k) => k in o)) return false;
  const nums = ["monthly_credits", "used", "granted", "remaining"];
  if (!nums.every((k) => Number.isInteger(o[k]))) return false;
  if (o.remaining !== Math.max(0, o.monthly_credits + o.granted - o.used)) return false;
  return typeof o.plan_id === "string" && typeof o.period_start === "string" && typeof o.period_end === "string";
}

/**
 * True when `body` looks like an ink_summary() payload: every key present, whole non-negative
 * numbers, and used = granted - balance (the ledger's own arithmetic).
 * @param {unknown} body
 */
export function isInkSummary(body) {
  const o = asObject(body);
  if (!o) return false;
  if (!INK_SUMMARY_KEYS.every((k) => k in o)) return false;
  const nums = ["balance", "granted", "purchased", "refunded", "used", "starter", "purchases"];
  if (!nums.every((k) => Number.isInteger(o[k]) && o[k] >= 0)) return false;
  if (o.used !== Math.max(0, o.granted - o.balance)) return false;
  return o.last_purchase === null || typeof o.last_purchase === "object";
}

/**
 * True when `body` looks like a rate_limit_hit() payload: every key present,
 * integers where expected, `backend` = 'db', and retry_after_ms consistent with
 * `allowed` (0 when allowed; in (0, windowMs] when denied).
 * @param {unknown} body
 * @param {number} windowMs
 */
export function isRateLimitResult(body, windowMs) {
  const o = asObject(body);
  if (!o) return false;
  if (!RATE_LIMIT_KEYS.every((k) => k in o)) return false;
  if (typeof o.allowed !== "boolean" || !Number.isInteger(o.remaining) || !Number.isInteger(o.retry_after_ms)) return false;
  if (o.backend !== "db" || o.remaining < 0) return false;
  if (o.allowed) return o.retry_after_ms === 0;
  return o.remaining === 0 && o.retry_after_ms > 0 && o.retry_after_ms <= windowMs;
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

/**
 * History rows are written by the whiteboards trigger only (20261003000000_snapshot_retention.sql):
 * nobody inserts them through the API, owners read their own, and the pruning function is not a
 * user RPC.
 * @param {CheckContext} ctx
 */
export async function checkSnapshots({ anon, a, b }) {
  /** @type {CheckResult[]} */
  const out = [];
  const board = await createBoard(a, "rls-verify snapshots");
  try {
    // Two changes: the second keeps the version the first produced.
    for (const v of [1, 2]) await a.rest("PATCH", "whiteboards", { query: { id: `eq.${board.id}` }, body: { data: { v } } });

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
    out.push(result("whiteboard_snapshots: A cannot insert history for own board either (only the trigger writes it)", isDenied(aIns), describe(aIns)));

    const bSel = await b.rest("GET", "whiteboard_snapshots", { query: { whiteboard_id: `eq.${board.id}`, select: "id" } });
    out.push(result("whiteboard_snapshots: B cannot read A's snapshots", affectedNoRows(bSel), describe(bSel)));

    const aSel = await a.rest("GET", "whiteboard_snapshots", { query: { whiteboard_id: `eq.${board.id}`, select: "version" } });
    out.push(result("whiteboard_snapshots: A reads own snapshots", isOk(aSel) && rows(aSel).length >= 1, describe(aSel)));

    for (const [who, client] of /** @type {const} */ ([["A", a], ["anon", anon]])) {
      const prune = await rpc(client, "prune_whiteboard_snapshots", { p_whiteboard_id: board.id });
      out.push(result(`prune_whiteboard_snapshots: ${who} cannot call it`, isDenied(prune), describe(prune)));
    }
    const aAfter = await a.rest("GET", "whiteboard_snapshots", { query: { whiteboard_id: `eq.${board.id}`, select: "version" } });
    out.push(result("whiteboard_snapshots: A's history unchanged by the attempts", rows(aAfter).length === rows(aSel).length, describe(aAfter)));
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

  // Readable by URL is not listable: a listing would hand out every user's id, board ids and
  // file names (20261003100000_board_assets_no_listing.sql). Storage answers a list it may not
  // show with 200 [] (or an error): either way, no names.
  const listed = (/** @type {HttpResult} */ r) => (isOk(r) && Array.isArray(r.body) ? r.body.map((o) => String(o?.name ?? "")) : []);
  const anonRoot = await anon.storageList(ASSETS_BUCKET, "");
  out.push(result("storage: anon cannot list board-assets (no user folders)", listed(anonRoot).length === 0, describe(anonRoot)));
  const anonFolder = await anon.storageList(ASSETS_BUCKET, `${a.userId}/${folder}`);
  out.push(result("storage: anon cannot list A's board-assets folder", listed(anonFolder).length === 0, describe(anonFolder)));
  const bRoot = await b.storageList(ASSETS_BUCKET, "");
  out.push(result("storage: B cannot list A's user folder at the bucket root", !listed(bRoot).includes(String(a.userId)), describe(bRoot)));
  const bFolder = await b.storageList(ASSETS_BUCKET, `${a.userId}/${folder}`);
  out.push(result("storage: B cannot list A's board-assets folder", listed(bFolder).length === 0, describe(bFolder)));
  const aFolder = await a.storageList(ASSETS_BUCKET, `${a.userId}/${folder}`);
  out.push(result("storage: A lists own board-assets folder", listed(aFolder).includes("a.png"), describe(aFolder)));

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

    // History (20261003000000_snapshot_retention.sql): a row holds the state a write replaced, kept
    // when the board has none younger than 10 minutes or the write drops more than half the board;
    // a new board's empty start is never kept.
    const history = async () => {
      const snaps = await a.rest("GET", "whiteboard_snapshots", {
        query: { whiteboard_id: `eq.${board.id}`, select: "version", order: "version.asc" },
      });
      return { snaps, versions: rows(snaps).map((r) => Number(r.version)).join(",") };
    };
    const first = await history();
    out.push(
      result(
        "history: the empty start is not kept; the next change keeps the version it replaced (2), not 3",
        isOk(first.snaps) && first.versions === "2",
        describe(first.snaps),
      ),
    );

    // A board big enough to count (the shrink rule ignores boards under 16 KB stored), random so
    // compression cannot shrink it below that.
    const big = { strokes: Array.from({ length: 2000 }, () => uuid()) };
    const grow = await a.rest("PATCH", "whiteboards", { query: { ...q, version: "eq.3" }, body: { data: big }, prefer: "return=representation" });
    const afterGrow = await history();
    out.push(
      result(
        "history: a change within 10 minutes of the last kept version keeps nothing",
        isOk(grow) && rows(grow)[0]?.version === 4 && afterGrow.versions === "2",
        `${describe(grow)} / ${afterGrow.versions}`,
      ),
    );

    const wipe = await a.rest("PATCH", "whiteboards", { query: { ...q, version: "eq.4" }, body: { data: { v: "wiped" } }, prefer: "return=representation" });
    const afterWipe = await history();
    out.push(
      result(
        "history: a change that drops more than half the board keeps the version before it (4), even within 10 minutes",
        isOk(wipe) && rows(wipe)[0]?.version === 5 && afterWipe.versions === "2,4",
        `${describe(wipe)} / ${afterWipe.versions}`,
      ),
    );
  } finally {
    await deleteBoard(a, board.id);
  }
  return out;
}

/**
 * Accounts & billing tables: plans are read-only, a profile is visible and
 * (display_name only) editable by its owner, ledgers are read-only for owners,
 * billing_events is invisible to every authenticated user.
 * @param {CheckContext} ctx
 */
export async function checkBillingTables({ a, b }) {
  /** @type {CheckResult[]} */
  const out = [];

  const plans = await a.rest("GET", "plans", { query: { select: "id,monthly_credits,active", order: "sort.asc" } });
  out.push(
    result(
      "plans: A reads the catalogue (includes 'free')",
      isOk(plans) && rows(plans).length >= 1 && rows(plans).some((p) => p.id === "free"),
      describe(plans),
    ),
  );
  const planIns = await a.rest("POST", "plans", { body: minimalInsert("plans"), prefer: "return=minimal" });
  out.push(result("plans: A cannot insert a plan", isDenied(planIns), describe(planIns)));
  const planUpd = await a.rest("PATCH", "plans", {
    query: { id: "eq.free" },
    body: { monthly_credits: 999999 },
    prefer: "return=representation",
  });
  out.push(result("plans: A cannot update a plan", isDenied(planUpd), describe(planUpd)));

  const own = await a.rest("GET", "profiles", { query: { select: "user_id,plan_id,display_name" } });
  out.push(
    result(
      "profiles: A sees exactly own profile (auto-created on sign-up)",
      isOk(own) && rows(own).length === 1 && rows(own)[0].user_id === a.userId && typeof rows(own)[0].plan_id === "string",
      describe(own),
    ),
  );
  const other = await a.rest("GET", "profiles", { query: { user_id: `eq.${b.userId}`, select: "user_id" } });
  out.push(result("profiles: A cannot read B's profile (select returns [])", affectedNoRows(other), describe(other)));

  const rename = await a.rest("PATCH", "profiles", {
    query: { user_id: `eq.${a.userId}` },
    body: { display_name: "rls-verify" },
    prefer: "return=representation",
  });
  out.push(
    result(
      "profiles: A updates own display_name",
      isOk(rename) && rows(rename).length === 1 && rows(rename)[0].display_name === "rls-verify",
      describe(rename),
    ),
  );
  const planChange = await a.rest("PATCH", "profiles", {
    query: { user_id: `eq.${a.userId}` },
    body: { plan_id: "pro" },
    prefer: "return=representation",
  });
  const code = String(asObject(planChange.body)?.code ?? "");
  out.push(result("profiles: A cannot update own plan_id (42501)", isDenied(planChange) && code === "42501", describe(planChange)));
  const foreignRename = await a.rest("PATCH", "profiles", {
    query: { user_id: `eq.${b.userId}` },
    body: { display_name: "hijacked" },
    prefer: "return=representation",
  });
  out.push(result("profiles: A cannot update B's display_name (denied or 0 rows)", deniedOrEmpty(foreignRename), describe(foreignRename)));
  const profIns = await a.rest("POST", "profiles", { body: minimalInsert("profiles", a.userId ?? ZERO_UUID), prefer: "return=minimal" });
  out.push(result("profiles: A cannot insert a profile", isDenied(profIns), describe(profIns)));
  const profDel = await a.rest("DELETE", "profiles", { query: { user_id: `eq.${a.userId}` }, prefer: "return=representation" });
  out.push(result("profiles: A cannot delete own profile", deniedOrEmpty(profDel), describe(profDel)));
  const still = await a.rest("GET", "profiles", { query: { select: "user_id,plan_id" } });
  out.push(
    result(
      "profiles: A's profile intact (plan unchanged) after the attempts",
      isOk(still) && rows(still).length === 1 && rows(still)[0].plan_id !== "pro",
      describe(still),
    ),
  );

  const usageIns = await a.rest("POST", "usage_events", { body: minimalInsert("usage_events", a.userId ?? ZERO_UUID), prefer: "return=minimal" });
  out.push(result("usage_events: A cannot insert directly", isDenied(usageIns), describe(usageIns)));
  const grantIns = await a.rest("POST", "credit_grants", { body: minimalInsert("credit_grants", a.userId ?? ZERO_UUID), prefer: "return=minimal" });
  out.push(result("credit_grants: A cannot insert (nothing lets a user add credits)", isDenied(grantIns), describe(grantIns)));
  const usageSel = await a.rest("GET", "usage_events", { query: { select: "id", limit: "1" } });
  out.push(result("usage_events: A may read own ledger", isOk(usageSel), describe(usageSel)));
  const grantSel = await a.rest("GET", "credit_grants", { query: { select: "id", limit: "1" } });
  out.push(result("credit_grants: A may read own grants", isOk(grantSel), describe(grantSel)));

  const billing = await a.rest("GET", "billing_events", { query: { select: "id", limit: "1" } });
  out.push(result("billing_events: not readable by authenticated users", isDenied(billing), describe(billing)));
  const billingIns = await a.rest("POST", "billing_events", { body: minimalInsert("billing_events"), prefer: "return=minimal" });
  out.push(result("billing_events: not writable by authenticated users", isDenied(billingIns), describe(billingIns)));
  return out;
}

/**
 * consume_credits()/credit_summary(): a user spends only their own credits,
 * cannot overspend, and B's balance never moves when A consumes.
 * @param {CheckContext} ctx
 */
export async function checkCreditsConsumption({ a, b, anon }) {
  /** @type {CheckResult[]} */
  const out = [];
  const route = `rls-verify-${uuid().slice(0, 8)}`;

  const sumA0 = await rpc(a, "credit_summary");
  out.push(result("credit_summary: A gets a well-formed summary", isOk(sumA0) && isCreditSummary(sumA0.body), describe(sumA0)));
  const sumB0 = await rpc(b, "credit_summary");
  out.push(result("credit_summary: B gets a well-formed summary", isOk(sumB0) && isCreditSummary(sumB0.body), describe(sumB0)));
  const a0 = asObject(sumA0.body);
  const b0 = asObject(sumB0.body);
  if (!a0 || !b0) return out;

  const spend = await rpc(a, "consume_credits", { p_route: route, p_units: 2, p_request_id: "rls-verify", p_model: "rls-verify" });
  const spent = asObject(spend.body);
  out.push(
    result(
      "consume_credits: A spends 2 units (ok:true, remaining decremented)",
      isOk(spend) && spent?.ok === true && spent.remaining === a0.remaining - 2,
      describe(spend),
    ),
  );

  const sumA1 = await rpc(a, "credit_summary");
  const a1 = asObject(sumA1.body);
  out.push(
    result(
      "credit_summary: A's used +2 and remaining -2 after consuming",
      isOk(sumA1) && a1?.used === a0.used + 2 && a1.remaining === a0.remaining - 2,
      describe(sumA1),
    ),
  );
  const sumB1 = await rpc(b, "credit_summary");
  const b1 = asObject(sumB1.body);
  out.push(
    result(
      "credit_summary: B's balance unchanged by A's consumption",
      isOk(sumB1) && b1?.used === b0.used && b1.remaining === b0.remaining,
      describe(sumB1),
    ),
  );

  const aUsage = await a.rest("GET", "usage_events", { query: { route: `eq.${route}`, select: "user_id,route,units" } });
  out.push(
    result(
      "usage_events: A sees the usage row written by consume_credits",
      isOk(aUsage) && rows(aUsage).length === 1 && rows(aUsage)[0].user_id === a.userId && rows(aUsage)[0].units === 2,
      describe(aUsage),
    ),
  );
  const bUsage = await b.rest("GET", "usage_events", { query: { route: `eq.${route}`, select: "id" } });
  out.push(result("usage_events: B cannot see A's usage rows", affectedNoRows(bUsage), describe(bUsage)));

  const remaining = a1?.remaining ?? a0.remaining - 2;
  const over = await rpc(a, "consume_credits", { p_route: route, p_units: Math.min(1000, remaining + 1) });
  const overBody = asObject(over.body);
  out.push(
    result(
      "consume_credits: spending beyond remaining returns ok:false insufficient_credits",
      isOk(over) && overBody?.ok === false && overBody.reason === "insufficient_credits" && overBody.remaining === remaining,
      describe(over),
    ),
  );
  const afterOver = await a.rest("GET", "usage_events", { query: { route: `eq.${route}`, select: "id" } });
  const sumA2 = await rpc(a, "credit_summary");
  out.push(
    result(
      "consume_credits: refused spend writes no usage row and leaves the balance",
      isOk(afterOver) && rows(afterOver).length === 1 && asObject(sumA2.body)?.remaining === remaining,
      `${describe(afterOver)} / ${describe(sumA2)}`,
    ),
  );

  const zero = await rpc(a, "consume_credits", { p_route: route, p_units: 0 });
  out.push(result("consume_credits: p_units 0 is rejected", !isOk(zero), describe(zero)));
  const huge = await rpc(a, "consume_credits", { p_route: route, p_units: 1001 });
  out.push(result("consume_credits: p_units 1001 is rejected", !isOk(huge), describe(huge)));

  const anonSpend = await rpc(anon, "consume_credits", { p_route: route, p_units: 1 });
  out.push(result("consume_credits: anon cannot call it", isDenied(anonSpend), describe(anonSpend)));
  const anonSum = await rpc(anon, "credit_summary");
  out.push(result("credit_summary: anon cannot call it", isDenied(anonSum), describe(anonSum)));
  return out;
}

/**
 * delete_own_account(): a throwaway user C deletes itself; the profile, boards
 * and ledger rows vanish and the (still signature-valid) JWT can no longer spend.
 * Storage objects are out of scope here: the RPC cannot remove them (see the
 * migration); the integration test covers the Storage-API garbage collection.
 * @param {CheckContext} ctx
 */
export async function checkDeleteOwnAccount(ctx) {
  /** @type {CheckResult[]} */
  const out = [];
  if (!ctx.newUser) {
    out.push(result("delete_own_account: context provides newUser()", false, "CheckContext.newUser is missing"));
    return out;
  }
  const c = await ctx.newUser();
  await createBoard(c, "rls-verify delete-account");
  const spend = await rpc(c, "consume_credits", { p_route: "rls-verify-delete", p_units: 1 });
  out.push(result("delete_own_account: C can spend before deleting", isOk(spend) && asObject(spend.body)?.ok === true, describe(spend)));

  const del = await rpc(c, "delete_own_account");
  out.push(result("delete_own_account: C deletes own account", isOk(del), describe(del)));

  const prof = await c.rest("GET", "profiles", { query: { select: "user_id" } });
  out.push(result("delete_own_account: C's profile is gone", affectedNoRows(prof), describe(prof)));
  const boards = await c.rest("GET", "whiteboards", { query: { select: "id" } });
  out.push(result("delete_own_account: C's boards are gone", affectedNoRows(boards), describe(boards)));
  const usage = await c.rest("GET", "usage_events", { query: { select: "id" } });
  out.push(result("delete_own_account: C's usage rows are gone", affectedNoRows(usage), describe(usage)));
  const after = await rpc(c, "consume_credits", { p_route: "rls-verify-delete", p_units: 1 });
  out.push(result("delete_own_account: deleted user's JWT cannot spend (auth.users row gone)", isDenied(after), describe(after)));

  const aProf = await ctx.a.rest("GET", "profiles", { query: { select: "user_id" } });
  const bProf = await ctx.b.rest("GET", "profiles", { query: { select: "user_id" } });
  out.push(
    result(
      "delete_own_account: only the caller is affected (A and B still have profiles)",
      isOk(aProf) && rows(aProf).length === 1 && isOk(bProf) && rows(bProf).length === 1,
      `${describe(aProf)} / ${describe(bProf)}`,
    ),
  );
  return out;
}

/**
 * Refunds of failed calls (20261002000000_ink.sql): a user can NOT refund anything (not through
 * refund_credits, not through refund_ink_for), because every 2xx hands them its request id and a
 * self-refund would make ink free. With the service role, refund_ink_for gives back exactly what
 * one of the user's own recent requests charged, once; another user's id and rows older than 15
 * minutes refund nothing and touch nothing. Without a service client that half is skipped.
 * @param {CheckContext} ctx
 */
export async function checkRefunds({ a, b, anon, service }) {
  /** @type {CheckResult[]} */
  const out = [];
  const tag = uuid().slice(0, 8);
  const route = `rls-verify-refund-${tag}`;
  const reqOwn = `rls-verify-req-${tag}-own`;
  const reqForeign = `rls-verify-req-${tag}-foreign`;
  const reqStale = `rls-verify-req-${tag}-stale`;

  const a0 = asObject((await rpc(a, "credit_summary")).body);
  const spend = await rpc(a, "consume_credits", { p_route: route, p_units: 5, p_request_id: reqOwn });
  if (!a0 || !isOk(spend) || asObject(spend.body)?.ok !== true) {
    out.push(result("refund: setup spend of 5 units succeeded", false, `${describe(spend)}`));
    return out;
  }

  const self = await rpc(a, "refund_credits", { p_request_id: reqOwn });
  out.push(result("refund_credits: A cannot refund own request (users have no refunds)", isDenied(self), describe(self)));
  const direct = await rpc(a, "refund_ink_for", { p_user_id: a.userId, p_request_id: reqOwn });
  out.push(result("refund_ink_for: A cannot call it", isDenied(direct), describe(direct)));
  const anonRefund = await rpc(anon, "refund_credits", { p_request_id: reqOwn });
  out.push(result("refund_credits: anon cannot call it", isDenied(anonRefund), describe(anonRefund)));
  const kept = asObject((await rpc(a, "credit_summary")).body);
  const row = await a.rest("GET", "usage_events", { query: { request_id: `eq.${reqOwn}`, select: "units" } });
  out.push(
    result(
      "refund: A's charge and usage row stay after the attempts",
      kept?.remaining === a0.remaining - 5 && isOk(row) && rows(row).length === 1,
      `${JSON.stringify(kept)} / ${describe(row)}`.slice(0, 200),
    ),
  );

  if (!service) {
    out.push(result("refund_ink_for with the service role (skipped: no service role client)", true));
    return out;
  }

  const refund = await rpc(service, "refund_ink_for", { p_user_id: a.userId, p_request_id: reqOwn });
  const r = asObject(refund.body);
  out.push(
    result(
      "refund_ink_for: the service role refunds A's request (refunded 5, remaining restored)",
      isOk(refund) && r?.refunded === 5 && r.remaining === a0.remaining,
      describe(refund),
    ),
  );
  const gone = await a.rest("GET", "usage_events", { query: { request_id: `eq.${reqOwn}`, select: "id" } });
  out.push(result("refund_ink_for: the refunded usage row is deleted", affectedNoRows(gone), describe(gone)));
  const again = await rpc(service, "refund_ink_for", { p_user_id: a.userId, p_request_id: reqOwn });
  const r2 = asObject(again.body);
  out.push(result("refund_ink_for: refunding the same request again refunds 0", isOk(again) && r2?.refunded === 0 && r2.remaining === a0.remaining, describe(again)));

  // A spends again; a refund naming B with A's request id refunds nothing.
  await rpc(a, "consume_credits", { p_route: route, p_units: 3, p_request_id: reqForeign });
  const b0 = asObject((await rpc(b, "credit_summary")).body);
  const foreign = await rpc(service, "refund_ink_for", { p_user_id: b.userId, p_request_id: reqForeign });
  const rf = asObject(foreign.body);
  const still = await a.rest("GET", "usage_events", { query: { request_id: `eq.${reqForeign}`, select: "units" } });
  const sumA2 = asObject((await rpc(a, "credit_summary")).body);
  out.push(
    result(
      "refund_ink_for: another user's id with A's request id refunds 0; A's row and both balances untouched",
      isOk(foreign) && rf?.refunded === 0 && rf.remaining === b0?.remaining && rows(still).length === 1 && sumA2?.remaining === a0.remaining - 3,
      `${describe(foreign)} / ${describe(still)}`,
    ),
  );

  const old = new Date(Date.now() - 16 * 60_000).toISOString();
  const planted = await service.rest("POST", "usage_events", {
    body: { user_id: a.userId, route, units: 4, request_id: reqStale, created_at: old },
    prefer: "return=minimal",
  });
  const before = asObject((await rpc(a, "credit_summary")).body);
  const stale = await rpc(service, "refund_ink_for", { p_user_id: a.userId, p_request_id: reqStale });
  const rs = asObject(stale.body);
  const staleRow = await service.rest("GET", "usage_events", { query: { request_id: `eq.${reqStale}`, select: "units" } });
  out.push(
    result(
      "refund_ink_for: a row older than 15 minutes refunds 0 and stays",
      isOk(planted) && isOk(stale) && rs?.refunded === 0 && rs.remaining === before?.remaining && rows(staleRow).length === 1,
      `${describe(planted)} / ${describe(stale)} / ${describe(staleRow)}`,
    ),
  );

  const empty = await rpc(service, "refund_ink_for", { p_user_id: a.userId, p_request_id: "" });
  out.push(result("refund_ink_for: an empty p_request_id is rejected", !isOk(empty), describe(empty)));
  return out;
}

/**
 * rate_limit_hit(): p_limit hits per window are allowed, the next is denied
 * with a retry hint inside the window, users do not share counters, and the
 * backing table is reachable through the function only.
 * @param {CheckContext} ctx
 */
export async function checkRateLimit({ a, b, anon }) {
  /** @type {CheckResult[]} */
  const out = [];
  const bucket = `rls-verify-${uuid().slice(0, 8)}`;
  const limit = 3;
  const windowMs = 60_000; // long enough that the window cannot roll over mid-check
  const args = { p_bucket: bucket, p_limit: limit, p_window_ms: windowMs };

  /** @type {Array<Record<string, any> | null>} */
  const hits = [];
  /** @type {HttpResult[]} */
  const raw = [];
  for (let i = 0; i < limit; i++) {
    const res = await rpc(a, "rate_limit_hit", args);
    raw.push(res);
    hits.push(asObject(res.body));
  }
  out.push(
    result(
      `rate_limit_hit: first ${limit} hits allowed with remaining ${limit - 1}..0 (backend 'db')`,
      raw.every(isOk) &&
        hits.every((h, i) => h && isRateLimitResult(h, windowMs) && h.allowed === true && h.remaining === limit - 1 - i),
      raw.map(describe).join(" | "),
    ),
  );

  const denied = await rpc(a, "rate_limit_hit", args);
  const d = asObject(denied.body);
  out.push(
    result(
      "rate_limit_hit: next hit denied with retry_after_ms in (0, window]",
      isOk(denied) && d?.allowed === false && isRateLimitResult(d, windowMs),
      describe(denied),
    ),
  );
  const deniedAgain = await rpc(a, "rate_limit_hit", args);
  const d2 = asObject(deniedAgain.body);
  out.push(result("rate_limit_hit: stays denied within the window", isOk(deniedAgain) && d2?.allowed === false && d2.remaining === 0, describe(deniedAgain)));

  const bHit = await rpc(b, "rate_limit_hit", args);
  const bh = asObject(bHit.body);
  out.push(
    result(
      "rate_limit_hit: B has an independent counter for the same bucket",
      isOk(bHit) && bh?.allowed === true && bh.remaining === limit - 1,
      describe(bHit),
    ),
  );

  const otherBucket = await rpc(a, "rate_limit_hit", { ...args, p_bucket: `${bucket}-other` });
  const ob = asObject(otherBucket.body);
  out.push(result("rate_limit_hit: A's other bucket is not affected", isOk(otherBucket) && ob?.allowed === true, describe(otherBucket)));

  const badLimit = await rpc(a, "rate_limit_hit", { ...args, p_limit: 0 });
  out.push(result("rate_limit_hit: p_limit 0 is rejected", !isOk(badLimit), describe(badLimit)));
  const badWindow = await rpc(a, "rate_limit_hit", { ...args, p_window_ms: 0 });
  out.push(result("rate_limit_hit: p_window_ms 0 is rejected", !isOk(badWindow), describe(badWindow)));

  const anonHit = await rpc(anon, "rate_limit_hit", args);
  out.push(result("rate_limit_hit: anon cannot call it", isDenied(anonHit), describe(anonHit)));

  const sel = await a.rest("GET", "rate_limit_counters", { query: { select: "hits", limit: "1" } });
  out.push(result("rate_limit_counters: not readable by authenticated users", isDenied(sel), describe(sel)));
  const ins = await a.rest("POST", "rate_limit_counters", { body: minimalInsert("rate_limit_counters", a.userId ?? ZERO_UUID), prefer: "return=minimal" });
  out.push(result("rate_limit_counters: not writable by authenticated users", isDenied(ins), describe(ins)));
  const del = await a.rest("DELETE", "rate_limit_counters", { query: { user_id: `eq.${a.userId}` }, prefer: "return=representation" });
  out.push(result("rate_limit_counters: A cannot reset own counters by deleting rows", isDenied(del), describe(del)));
  const afterDel = await rpc(a, "rate_limit_hit", args);
  out.push(result("rate_limit_hit: A is still denied after the delete attempt", isOk(afterDel) && asObject(afterDel.body)?.allowed === false, describe(afterDel)));
  return out;
}

/** True when `body` is a usage_by_day() result: an array of { day: 'YYYY-MM-DD', route, events, credits } rows. */
export function isUsageByDay(body) {
  if (!Array.isArray(body)) return false;
  return body.every((row) => {
    const o = asObject(row);
    return (
      !!o &&
      typeof o.day === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(o.day) &&
      typeof o.route === "string" &&
      Number.isInteger(o.events) &&
      o.events > 0 &&
      Number.isInteger(o.credits)
    );
  });
}

/** @param {HttpResult} res */
const creditsTotal = (res) => rows(res).reduce((n, r) => n + Number(r.credits), 0);

/**
 * usage_by_day(): the caller's own spend this month, grouped by day and route.
 * It is SECURITY INVOKER, so the usage_events owner policy decides what it sees:
 * A's rows add up to A's credit_summary().used, B never sees A's route, an
 * unknown time zone is rejected and anon cannot call it.
 * @param {CheckContext} ctx
 */
export async function checkUsageByDay({ a, b, anon }) {
  /** @type {CheckResult[]} */
  const out = [];
  const route = `rls-verify-usage-${uuid().slice(0, 8)}`;

  const spend = await rpc(a, "consume_credits", { p_route: route, p_units: 3, p_request_id: `${route}-req` });
  out.push(result("usage_by_day: A spends 3 units to have a row to group", isOk(spend) && asObject(spend.body)?.ok === true, describe(spend)));

  const aDays = await rpc(a, "usage_by_day", { p_time_zone: "UTC" });
  const mine = rows(aDays).filter((r) => r.route === route);
  out.push(result("usage_by_day: A gets well-formed rows", isOk(aDays) && isUsageByDay(aDays.body), describe(aDays)));
  out.push(
    result(
      "usage_by_day: A sees one row for the new route (1 event, 3 credits)",
      mine.length === 1 && mine[0].events === 1 && mine[0].credits === 3,
      describe(aDays),
    ),
  );
  const sumA = await rpc(a, "credit_summary");
  out.push(
    result(
      "usage_by_day: A's rows add up to A's credit_summary().used",
      isOk(sumA) && asObject(sumA.body)?.used === creditsTotal(aDays),
      `${describe(aDays)} / ${describe(sumA)}`,
    ),
  );
  const aZoned = await rpc(a, "usage_by_day", { p_time_zone: "America/New_York" });
  out.push(
    result(
      "usage_by_day: another time zone regroups the days, not the credits",
      isOk(aZoned) && isUsageByDay(aZoned.body) && creditsTotal(aZoned) === creditsTotal(aDays),
      describe(aZoned),
    ),
  );

  const bDays = await rpc(b, "usage_by_day", { p_time_zone: "UTC" });
  out.push(
    result("usage_by_day: B does not see A's usage", isOk(bDays) && rows(bDays).every((r) => r.route !== route), describe(bDays)),
  );
  const sumB = await rpc(b, "credit_summary");
  out.push(
    result(
      "usage_by_day: B's rows add up to B's own credit_summary().used",
      isOk(bDays) && isOk(sumB) && asObject(sumB.body)?.used === creditsTotal(bDays),
      `${describe(bDays)} / ${describe(sumB)}`,
    ),
  );

  const lastDays = await rpc(a, "usage_by_day", { p_time_zone: "UTC", p_days: 30 });
  out.push(
    result(
      "usage_by_day: the last 30 days (the ink page's window) include today's row",
      isOk(lastDays) && isUsageByDay(lastDays.body) && rows(lastDays).some((r) => r.route === route && r.credits === 3),
      describe(lastDays),
    ),
  );
  const badDays = await rpc(a, "usage_by_day", { p_time_zone: "UTC", p_days: 0 });
  out.push(result("usage_by_day: p_days outside 1..366 is rejected", !isOk(badDays), describe(badDays)));

  const badZone = await rpc(a, "usage_by_day", { p_time_zone: "Not/AZone" });
  out.push(result("usage_by_day: an unknown time zone is rejected", !isOk(badZone), describe(badZone)));
  const anonDays = await rpc(anon, "usage_by_day", { p_time_zone: "UTC" });
  out.push(result("usage_by_day: anon cannot call it", isDenied(anonDays), describe(anonDays)));
  return out;
}

/**
 * First-run onboarding (migration 20260928100000_onboarding.sql): profiles.course and
 * profiles.onboarded_at are readable by their owner and written only through the
 * save_onboarding() RPC, which acts on the caller alone, validates the course and stamps
 * onboarded_at once. Runs on the throwaway users, which are new accounts (not backfilled).
 * @param {CheckContext} ctx
 */
export async function checkOnboarding({ a, b, anon }) {
  /** @type {CheckResult[]} */
  const out = [];
  const select = "user_id,course,onboarded_at";

  const fresh = await a.rest("GET", "profiles", { query: { select } });
  out.push(
    result(
      "onboarding: A reads own course and onboarded_at (a new account starts not onboarded)",
      isOk(fresh) && rows(fresh).length === 1 && rows(fresh)[0].course === null && rows(fresh)[0].onboarded_at === null,
      describe(fresh),
    ),
  );

  const patchAt = await a.rest("PATCH", "profiles", {
    query: { user_id: `eq.${a.userId}` },
    body: { onboarded_at: new Date().toISOString() },
    prefer: "return=representation",
  });
  out.push(
    result(
      "onboarding: A cannot PATCH own onboarded_at (42501, RPC only)",
      isDenied(patchAt) && String(asObject(patchAt.body)?.code ?? "") === "42501",
      describe(patchAt),
    ),
  );
  const patchCourse = await a.rest("PATCH", "profiles", {
    query: { user_id: `eq.${a.userId}` },
    body: { course: "geometry" },
    prefer: "return=representation",
  });
  out.push(
    result(
      "onboarding: A cannot PATCH own course (42501, RPC only)",
      isDenied(patchCourse) && String(asObject(patchCourse.body)?.code ?? "") === "42501",
      describe(patchCourse),
    ),
  );

  const course = await rpc(a, "save_onboarding", { p_course: "geometry" });
  out.push(
    result(
      "onboarding: save_onboarding stores A's course (not yet onboarded)",
      isOk(course) && asObject(course.body)?.course === "geometry" && asObject(course.body)?.onboarded_at === null,
      describe(course),
    ),
  );
  const unknown = await rpc(a, "save_onboarding", { p_course: "astrology" });
  out.push(result("onboarding: an unknown course is rejected (400)", unknown.status === 400, describe(unknown)));

  const done = await rpc(a, "save_onboarding", { p_complete: true });
  const doneAt = asObject(done.body)?.onboarded_at;
  out.push(
    result(
      "onboarding: save_onboarding(p_complete) stamps onboarded_at and keeps the course",
      isOk(done) && typeof doneAt === "string" && asObject(done.body)?.course === "geometry",
      describe(done),
    ),
  );
  const again = await rpc(a, "save_onboarding", { p_complete: true });
  out.push(
    result(
      "onboarding: completing again keeps the first onboarded_at",
      isOk(again) && typeof doneAt === "string" && asObject(again.body)?.onboarded_at === doneAt,
      describe(again),
    ),
  );
  const readBack = await a.rest("GET", "profiles", { query: { select } });
  out.push(
    result(
      "onboarding: A reads back course and onboarded_at",
      isOk(readBack) && rows(readBack).length === 1 && rows(readBack)[0].course === "geometry" && typeof rows(readBack)[0].onboarded_at === "string",
      describe(readBack),
    ),
  );

  const other = await b.rest("GET", "profiles", { query: { select } });
  out.push(
    result(
      "onboarding: B's profile unchanged by A's calls",
      isOk(other) && rows(other).length === 1 && rows(other)[0].user_id === b.userId && rows(other)[0].course === null && rows(other)[0].onboarded_at === null,
      describe(other),
    ),
  );

  const anonCall = await rpc(anon, "save_onboarding", { p_complete: true });
  out.push(result("onboarding: anon cannot call save_onboarding", isDenied(anonCall), describe(anonCall)));
  return out;
}

/**
 * Ink tables (migration 20261002000000_ink.sql): the pack catalogue is read-only, a user reads
 * only their own grants and purchases, and nothing a user token can reach adds ink: not a grant
 * row, not a purchase row, not the stored balance on the profile.
 * @param {CheckContext} ctx
 */
export async function checkInkTables({ a, b }) {
  /** @type {CheckResult[]} */
  const out = [];

  const packs = await a.rest("GET", "ink_packs", { query: { select: "id,ink,price_cents,active", order: "sort.asc" } });
  const active = rows(packs).filter((p) => p.active);
  out.push(
    result(
      "ink_packs: A reads the catalogue (small 1,000 / $5, medium 5,000 / $20, large 14,000 / $50)",
      isOk(packs) && JSON.stringify(active.map((p) => [p.id, p.ink, p.price_cents])) === JSON.stringify(INK_PACKS),
      describe(packs),
    ),
  );
  const packIns = await a.rest("POST", "ink_packs", { body: minimalInsert("ink_packs"), prefer: "return=minimal" });
  out.push(result("ink_packs: A cannot insert a pack", isDenied(packIns), describe(packIns)));
  const packUpd = await a.rest("PATCH", "ink_packs", { query: { id: "eq.large" }, body: { ink: 999999 }, prefer: "return=representation" });
  out.push(result("ink_packs: A cannot update a pack", isDenied(packUpd), describe(packUpd)));
  const packDel = await a.rest("DELETE", "ink_packs", { query: { id: "eq.small" }, prefer: "return=representation" });
  out.push(result("ink_packs: A cannot delete a pack", isDenied(packDel), describe(packDel)));

  const own = await a.rest("GET", "ink_grants", { query: { select: "user_id,kind,units", order: "id.asc" } });
  const starter = rows(own).find((g) => g.kind === "starter");
  out.push(
    result(
      "ink_grants: A reads own ledger, which starts with the 300-ink starter (sign-up trigger)",
      isOk(own) && rows(own).every((g) => g.user_id === a.userId) && starter?.units === 300,
      describe(own),
    ),
  );
  const foreign = await a.rest("GET", "ink_grants", { query: { user_id: `eq.${b.userId}`, select: "id" } });
  out.push(result("ink_grants: A cannot read B's grants (select returns [])", affectedNoRows(foreign), describe(foreign)));

  const before = asObject((await rpc(a, "ink_summary")).body);
  const grantIns = await a.rest("POST", "ink_grants", { body: minimalInsert("ink_grants", a.userId ?? ZERO_UUID), prefer: "return=minimal" });
  out.push(result("ink_grants: A cannot grant themselves ink (insert denied)", isDenied(grantIns), describe(grantIns)));
  const grantUpd = await a.rest("PATCH", "ink_grants", { query: { kind: "eq.starter" }, body: { units: 1000000 }, prefer: "return=representation" });
  out.push(result("ink_grants: A cannot raise own starter (update denied)", isDenied(grantUpd), describe(grantUpd)));
  const grantDel = await a.rest("DELETE", "ink_grants", { query: { user_id: `eq.${a.userId}` }, prefer: "return=representation" });
  out.push(result("ink_grants: A cannot delete own grants", deniedOrEmpty(grantDel), describe(grantDel)));

  const purchaseIns = await a.rest("POST", "ink_purchases", { body: minimalInsert("ink_purchases", a.userId ?? ZERO_UUID), prefer: "return=minimal" });
  out.push(result("ink_purchases: A cannot record a purchase (insert denied)", isDenied(purchaseIns), describe(purchaseIns)));
  const purchaseSel = await a.rest("GET", "ink_purchases", { query: { select: "id" } });
  out.push(result("ink_purchases: A may read own purchases (none yet)", isOk(purchaseSel) && rows(purchaseSel).length === 0, describe(purchaseSel)));

  // Checkouts waiting for review carry payer emails and amounts: the service role's alone.
  const reviewSel = await a.rest("GET", "ink_checkout_reviews", { query: { select: "id" } });
  out.push(result("ink_checkout_reviews: A cannot read the review queue", isDenied(reviewSel), describe(reviewSel)));
  const reviewIns = await a.rest("POST", "ink_checkout_reviews", { body: minimalInsert("ink_checkout_reviews", a.userId ?? ZERO_UUID), prefer: "return=minimal" });
  out.push(result("ink_checkout_reviews: A cannot add to it", isDenied(reviewIns), describe(reviewIns)));
  const reviewRpc = await rpc(a, "record_ink_checkout_review", { p_checkout_session_id: `cs_rls_verify_${uuid()}`, p_reason: "rls-verify" });
  out.push(result("record_ink_checkout_review: A cannot call it", isDenied(reviewRpc), describe(reviewRpc)));
  const resolveRpc = await rpc(a, "resolve_ink_checkout_review", { p_review_id: 1, p_user_id: a.userId, p_pack_id: "large" });
  out.push(result("resolve_ink_checkout_review: A cannot call it", isDenied(resolveRpc), describe(resolveRpc)));

  const balancePatch = await a.rest("PATCH", "profiles", { query: { user_id: `eq.${a.userId}` }, body: { ink_balance: 1000000 }, prefer: "return=representation" });
  out.push(
    result(
      "profiles: A cannot set own ink_balance (42501)",
      isDenied(balancePatch) && String(asObject(balancePatch.body)?.code ?? "") === "42501",
      describe(balancePatch),
    ),
  );
  const after = asObject((await rpc(a, "ink_summary")).body);
  out.push(
    result(
      "ink: A's balance unchanged by all of the attempts above",
      !!before && !!after && after.balance === before.balance && after.granted === before.granted,
      `${JSON.stringify(before)} / ${JSON.stringify(after)}`.slice(0, 200),
    ),
  );
  return out;
}

/**
 * ink_summary(): the caller's own ink, consistent with credit_summary() (the shape main's code
 * reads), and the service-role-only RPCs that add ink: a user (or anon) can call none of them.
 * With the service role, a purchase grants once per Checkout Session and a refund takes back at
 * most the unspent ink.
 * @param {CheckContext} ctx
 */
export async function checkInkPurchases({ a, b, anon, service }) {
  /** @type {CheckResult[]} */
  const out = [];
  const sumA = await rpc(a, "ink_summary");
  const a0 = asObject(sumA.body);
  out.push(result("ink_summary: A gets a well-formed summary", isOk(sumA) && isInkSummary(sumA.body), describe(sumA)));
  out.push(result("ink_summary: a new account starts with its 300 starter ink", a0?.starter === 300 && typeof a0.starter_at === "string", describe(sumA)));
  const credit = asObject((await rpc(a, "credit_summary")).body);
  out.push(
    result(
      "ink_summary: agrees with credit_summary (remaining = balance, used and granted alike)",
      !!a0 && credit?.remaining === a0.balance && credit.used === a0.used && credit.granted === a0.granted && credit.monthly_credits === 0,
      JSON.stringify(credit).slice(0, 200),
    ),
  );
  const anonSum = await rpc(anon, "ink_summary");
  out.push(result("ink_summary: anon cannot call it", isDenied(anonSum), describe(anonSum)));

  const tag = uuid().slice(0, 8);
  const session = `cs_rls_verify_${tag}`;
  const intent = `pi_rls_verify_${tag}`;
  const grantArgs = { p_user_id: a.userId, p_pack_id: "medium", p_checkout_session_id: session, p_payment_intent_id: intent, p_amount_cents: 2000, p_currency: "usd" };
  const reverseArgs = { p_payment_intent_id: intent, p_amount_refunded_cents: 2000, p_charge_amount_cents: 2000, p_fully_refunded: true };
  for (const [who, client] of /** @type {const} */ ([["A", a], ["anon", anon]])) {
    const g = await rpc(client, "grant_ink_purchase", grantArgs);
    out.push(result(`grant_ink_purchase: ${who} cannot call it`, isDenied(g), describe(g)));
    const r = await rpc(client, "reverse_ink_purchase", reverseArgs);
    out.push(result(`reverse_ink_purchase: ${who} cannot call it`, isDenied(r), describe(r)));
    const m = await rpc(client, "grant_ink", { p_user_id: a.userId, p_units: 1000000, p_reason: "rls-verify" });
    out.push(result(`grant_ink: ${who} cannot call it`, isDenied(m), describe(m)));
  }
  const still = asObject((await rpc(a, "ink_summary")).body);
  out.push(result("ink: A's balance unchanged after the denied calls", !!a0 && still?.balance === a0.balance, JSON.stringify(still).slice(0, 200)));

  if (!service) {
    out.push(result("grant_ink_purchase / reverse_ink_purchase with the service role (skipped: no service role client)", true));
    return out;
  }

  const b0 = asObject((await rpc(b, "ink_summary")).body);
  const granted = await rpc(service, "grant_ink_purchase", grantArgs);
  const g = asObject(granted.body);
  const a1 = asObject((await rpc(a, "ink_summary")).body);
  out.push(
    result(
      "grant_ink_purchase: the service role grants a Medium pack (+5,000) to A",
      isOk(granted) && g?.granted === 5000 && g.duplicate === false && a1?.balance === (a0?.balance ?? 0) + 5000 && a1?.purchased === (a0?.purchased ?? 0) + 5000,
      `${describe(granted)} / ${JSON.stringify(a1)}`.slice(0, 200),
    ),
  );
  const replay = await rpc(service, "grant_ink_purchase", grantArgs);
  const a2 = asObject((await rpc(a, "ink_summary")).body);
  out.push(
    result(
      "grant_ink_purchase: the same Checkout Session again grants nothing (duplicate)",
      isOk(replay) && asObject(replay.body)?.granted === 0 && asObject(replay.body)?.duplicate === true && a2?.balance === a1?.balance,
      describe(replay),
    ),
  );
  const mine = await a.rest("GET", "ink_purchases", { query: { checkout_session_id: `eq.${session}`, select: "user_id,pack_id,ink,status" } });
  out.push(
    result(
      "ink_purchases: A sees the purchase",
      isOk(mine) && rows(mine).length === 1 && rows(mine)[0].pack_id === "medium" && rows(mine)[0].ink === 5000 && rows(mine)[0].status === "paid",
      describe(mine),
    ),
  );
  const theirs = await b.rest("GET", "ink_purchases", { query: { checkout_session_id: `eq.${session}`, select: "id" } });
  out.push(result("ink_purchases: B cannot see A's purchase", affectedNoRows(theirs), describe(theirs)));
  const bAfter = asObject((await rpc(b, "ink_summary")).body);
  out.push(result("ink: B's balance unchanged by A's purchase", bAfter?.balance === b0?.balance, JSON.stringify(bAfter).slice(0, 200)));

  // A spends some of the pack, then the payment is refunded in full: only what is left comes back out.
  const spend = await rpc(a, "consume_credits", { p_route: `rls-verify-ink-${tag}`, p_units: 1000 });
  const before = asObject((await rpc(a, "ink_summary")).body);
  const reversed = await rpc(service, "reverse_ink_purchase", reverseArgs);
  const r = asObject(reversed.body);
  const a3 = asObject((await rpc(a, "ink_summary")).body);
  const takeable = Math.min(5000, before?.balance ?? 0);
  out.push(
    result(
      "reverse_ink_purchase: a full refund takes the pack's ink back, at most what is left (A spent 1,000 first; never below zero)",
      isOk(spend) && isOk(reversed) && r?.reversed === takeable && r?.requested === 5000 && a3?.balance === (before?.balance ?? 0) - takeable && a3?.balance >= 0,
      `${describe(reversed)} / ${JSON.stringify(a3)}`.slice(0, 200),
    ),
  );
  const again = await rpc(service, "reverse_ink_purchase", reverseArgs);
  const a4 = asObject((await rpc(a, "ink_summary")).body);
  out.push(
    result(
      "reverse_ink_purchase: the same refund again reverses nothing (duplicate)",
      isOk(again) && asObject(again.body)?.reversed === 0 && a4?.balance === a3?.balance,
      describe(again),
    ),
  );
  const unknown = await rpc(service, "reverse_ink_purchase", { ...reverseArgs, p_payment_intent_id: `pi_not_ours_${tag}` });
  out.push(result("reverse_ink_purchase: a payment that is not an ink purchase is not found and changes nothing", isOk(unknown) && asObject(unknown.body)?.found === false, describe(unknown)));
  const refunded = await a.rest("GET", "ink_purchases", { query: { checkout_session_id: `eq.${session}`, select: "status,refunded_ink,refund_unrecovered_ink" } });
  const row = rows(refunded)[0];
  out.push(
    result(
      "ink_purchases: the purchase reads refunded, recording what was taken back and what was already spent",
      isOk(refunded) && row?.status === "refunded" && row?.refunded_ink === takeable && row?.refund_unrecovered_ink === 5000 - takeable,
      describe(refunded),
    ),
  );

  // The money has to cover the pack: $5 for a Large ($50) is recorded for review, with no ink.
  const lowSession = `cs_rls_verify_${tag}_low`;
  const lowIntent = `pi_rls_verify_${tag}_low`;
  const b1 = asObject((await rpc(b, "ink_summary")).body);
  const under = await rpc(service, "grant_ink_purchase", {
    p_user_id: b.userId,
    p_pack_id: "large",
    p_checkout_session_id: lowSession,
    p_payment_intent_id: lowIntent,
    p_amount_cents: 500,
    p_currency: "usd",
  });
  const u = asObject(under.body);
  const b2 = asObject((await rpc(b, "ink_summary")).body);
  out.push(
    result(
      "grant_ink_purchase: an underpaid session ($5 for the $50 Large) grants nothing and goes to review",
      isOk(under) && u?.granted === 0 && u.review === true && b2?.balance === b1?.balance && b2?.purchased === b1?.purchased,
      `${describe(under)} / ${JSON.stringify(b2)}`.slice(0, 200),
    ),
  );
  const euro = await rpc(service, "grant_ink_purchase", { ...grantArgs, p_user_id: b.userId, p_checkout_session_id: `${lowSession}_eur`, p_payment_intent_id: null, p_currency: "eur" });
  out.push(result("grant_ink_purchase: a session in another currency goes to review", isOk(euro) && asObject(euro.body)?.granted === 0 && asObject(euro.body)?.review === true, describe(euro)));
  const queued = await service.rest("GET", "ink_checkout_reviews", { query: { checkout_session_id: `eq.${lowSession}`, select: "status,user_id,pack_id,amount_cents" } });
  const q = rows(queued)[0];
  out.push(
    result(
      "ink_checkout_reviews: the underpaid checkout is listed (open, B's, large, 500 cents)",
      isOk(queued) && q?.status === "open" && q.user_id === b.userId && q.pack_id === "large" && q.amount_cents === 500,
      describe(queued),
    ),
  );
  const bReads = await b.rest("GET", "ink_checkout_reviews", { query: { select: "id" } });
  out.push(result("ink_checkout_reviews: B cannot read even their own review", isDenied(bReads), describe(bReads)));
  const lowRefund = await rpc(service, "reverse_ink_purchase", { p_payment_intent_id: lowIntent, p_amount_refunded_cents: 500, p_charge_amount_cents: 500, p_fully_refunded: true });
  const lr = asObject(lowRefund.body);
  const closed = await service.rest("GET", "ink_checkout_reviews", { query: { checkout_session_id: `eq.${lowSession}`, select: "status" } });
  const b3 = asObject((await rpc(b, "ink_summary")).body);
  out.push(
    result(
      "reverse_ink_purchase: refunding a reviewed checkout takes no ink and marks the review refunded",
      isOk(lowRefund) && lr?.found === true && lr.review === true && lr.reversed === 0 && rows(closed)[0]?.status === "refunded" && b3?.balance === b1?.balance,
      `${describe(lowRefund)} / ${describe(closed)}`,
    ),
  );

  // Ledgers are append-only, even for the service role: a deleted grant or purchase would leave
  // the stored balance wrong, and a deleted usage row would mint ink. Corrections are inserts.
  const a5 = asObject((await rpc(a, "ink_summary")).body);
  const delGrant = await service.rest("DELETE", "ink_grants", { query: { user_id: `eq.${a.userId}`, kind: "eq.starter" }, prefer: "return=representation" });
  out.push(result("ink_grants: even the service role cannot delete a grant (delete guard, 42501)", isDenied(delGrant), describe(delGrant)));
  const delPurchase = await service.rest("DELETE", "ink_purchases", { query: { checkout_session_id: `eq.${session}` }, prefer: "return=representation" });
  out.push(result("ink_purchases: even the service role cannot delete a purchase (delete guard)", isDenied(delPurchase), describe(delPurchase)));
  const delUsage = await service.rest("DELETE", "usage_events", { query: { user_id: `eq.${a.userId}` }, prefer: "return=representation" });
  out.push(result("usage_events: even the service role cannot delete usage outside a refund (delete guard)", isDenied(delUsage), describe(delUsage)));
  const a6 = asObject((await rpc(a, "ink_summary")).body);
  out.push(
    result(
      "ink: A's balance and ledger unchanged by the denied deletes",
      !!a5 && a6?.balance === a5.balance && a6?.granted === a5.granted && a6?.used === a5.used,
      `${JSON.stringify(a5)} / ${JSON.stringify(a6)}`.slice(0, 200),
    ),
  );

  // Leave no review rows behind: they outlive the throwaway users and would sit in the owner's
  // queue (this check also runs against production).
  const cleared = await service.rest("DELETE", "ink_checkout_reviews", { query: { checkout_session_id: `like.cs_rls_verify_${tag}_*` }, prefer: "return=representation" });
  out.push(result("ink_checkout_reviews: the check's own review rows are removed again", isOk(cleared) && rows(cleared).length === 2, describe(cleared)));
  return out;
}

/**
 * Agathon Unlimited (migration 20261003020000_unlimited.sql). Nothing a user token can reach
 * gives anyone the plan: the subscription rows are the webhook's (service role) and readable only
 * by their owner, the fair-use record is written only by consume_credits(), and the plan's RPCs
 * (link_unlimited_checkout, apply_unlimited_subscription, has_unlimited) are not callable by users.
 * With the service role: a linked trialing plan makes A's help free (no ink spent, no usage row,
 * one fair-use row per request id), a refund of such a call gives back nothing (no ink minted), an
 * older event never overwrites a newer one, account deletion waits until the plan is set to cancel,
 * and a cancelled plan spends ink again. The check's subscription rows are removed at the end
 * (they outlive the throwaway users, and this also runs against production).
 * @param {CheckContext} ctx
 */
export async function checkUnlimited({ a, b, anon, service, newUser }) {
  /** @type {CheckResult[]} */
  const out = [];
  const tag = uuid().slice(0, 8);
  const subA = `sub_rls_verify_${tag}_a`;

  const none = await a.rest("GET", "unlimited_subscriptions", { query: { select: "id" } });
  out.push(result("unlimited_subscriptions: A has none to begin with (select returns [])", affectedNoRows(none), describe(none)));
  const forged = await a.rest("POST", "unlimited_subscriptions", { body: { stripe_subscription_id: subA, user_id: a.userId, status: "active" }, prefer: "return=minimal" });
  out.push(result("unlimited_subscriptions: A cannot give themselves the plan (insert denied)", isDenied(forged), describe(forged)));
  const usageIns = await a.rest("POST", "unlimited_usage", { body: minimalInsert("unlimited_usage", a.userId ?? ZERO_UUID), prefer: "return=minimal" });
  out.push(result("unlimited_usage: A cannot write the fair-use record (insert denied)", isDenied(usageIns), describe(usageIns)));

  const applyArgs = (status, at, extra = {}) => ({
    p_subscription_id: subA,
    p_customer_id: `cus_rls_verify_${tag}`,
    p_status: status,
    p_trial_end: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    p_current_period_end: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    p_cancel_at_period_end: false,
    p_livemode: false,
    p_event_at: new Date(at).toISOString(),
    ...extra,
  });
  const t0 = Date.now() - 60_000;
  for (const [who, client] of /** @type {const} */ ([["A", a], ["anon", anon]])) {
    const link = await rpc(client, "link_unlimited_checkout", { p_subscription_id: subA, p_user_id: a.userId });
    out.push(result(`link_unlimited_checkout: ${who} cannot call it`, isDenied(link), describe(link)));
    const apply = await rpc(client, "apply_unlimited_subscription", applyArgs("active", t0));
    out.push(result(`apply_unlimited_subscription: ${who} cannot call it`, isDenied(apply), describe(apply)));
  }
  const probe = await rpc(a, "has_unlimited", { p_uid: b.userId });
  out.push(result("has_unlimited: A cannot call it (nobody asks about another account's plan)", isDenied(probe), describe(probe)));

  const a0 = asObject((await rpc(a, "ink_summary")).body);
  out.push(
    result(
      "ink_summary: A's plan reads none (no subscription, help spends ink)",
      a0?.unlimited?.status === "none" && a0?.unlimited?.unlimited === false,
      JSON.stringify(a0?.unlimited ?? null).slice(0, 200),
    ),
  );

  if (!service) {
    out.push(result("Agathon Unlimited with the service role (skipped: no service role client)", true));
    return out;
  }

  // The subscription's own event first (no user yet), then the checkout links it: either order works.
  const applied = await rpc(service, "apply_unlimited_subscription", applyArgs("trialing", t0));
  const linked = await rpc(service, "link_unlimited_checkout", { p_subscription_id: subA, p_user_id: a.userId, p_checkout_session_id: `cs_rls_verify_${tag}` });
  const a1 = asObject((await rpc(a, "ink_summary")).body);
  out.push(
    result(
      "apply + link (service role): A's free week is on (ink_summary reads trialing, unlimited)",
      isOk(applied) && isOk(linked) && asObject(linked.body)?.linked === true && a1?.unlimited?.status === "trialing" && a1?.unlimited?.unlimited === true,
      `${describe(linked)} / ${JSON.stringify(a1?.unlimited ?? null)}`.slice(0, 200),
    ),
  );
  const own = await a.rest("GET", "unlimited_subscriptions", { query: { stripe_subscription_id: `eq.${subA}`, select: "user_id,status" } });
  out.push(result("unlimited_subscriptions: A reads own subscription", isOk(own) && rows(own).length === 1 && rows(own)[0].user_id === a.userId, describe(own)));
  const theirs = await b.rest("GET", "unlimited_subscriptions", { query: { stripe_subscription_id: `eq.${subA}`, select: "id" } });
  out.push(result("unlimited_subscriptions: B cannot read A's subscription", affectedNoRows(theirs), describe(theirs)));
  const hijack = await b.rest("PATCH", "unlimited_subscriptions", { query: { stripe_subscription_id: `eq.${subA}` }, body: { user_id: b.userId }, prefer: "return=representation" });
  out.push(result("unlimited_subscriptions: B cannot move A's plan to themselves (update denied)", isDenied(hijack), describe(hijack)));

  const request = `rls-verify-unlimited-${tag}`;
  const spend = await rpc(a, "consume_credits", { p_route: "rls-verify-unlimited", p_units: 10, p_request_id: request });
  const again = await rpc(a, "consume_credits", { p_route: "rls-verify-unlimited", p_units: 10, p_request_id: request });
  const a2 = asObject((await rpc(a, "ink_summary")).body);
  out.push(
    result(
      "consume_credits: on Unlimited, A's help spends no ink (ok, unlimited, balance unchanged)",
      isOk(spend) && asObject(spend.body)?.ok === true && asObject(spend.body)?.unlimited === true && a2?.balance === a1?.balance && a2?.used === a1?.used,
      `${describe(spend)} / ${JSON.stringify(a2)}`.slice(0, 200),
    ),
  );
  const ledger = await a.rest("GET", "usage_events", { query: { request_id: `eq.${request}`, select: "id" } });
  out.push(result("usage_events: no ink ledger row for a subscriber's call", affectedNoRows(ledger), describe(ledger)));
  const counted = await a.rest("GET", "unlimited_usage", { query: { request_id: `eq.${request}`, select: "units" } });
  out.push(
    result(
      "unlimited_usage: the call is recorded once for fair use, even when its request id comes again",
      isOk(again) && asObject(again.body)?.ok === true && isOk(counted) && rows(counted).length === 1 && rows(counted)[0].units === 10,
      describe(counted),
    ),
  );
  const peek = await b.rest("GET", "unlimited_usage", { query: { request_id: `eq.${request}`, select: "id" } });
  out.push(result("unlimited_usage: B cannot read A's record", affectedNoRows(peek), describe(peek)));

  const refund = await rpc(service, "refund_ink_for", { p_user_id: a.userId, p_request_id: request });
  const a3 = asObject((await rpc(a, "ink_summary")).body);
  const recount = await a.rest("GET", "unlimited_usage", { query: { request_id: `eq.${request}`, select: "id" } });
  out.push(
    result(
      "refund_ink_for: a subscriber's failed call gives back 0 ink (none was spent, none minted) and its fair-use count",
      isOk(refund) && asObject(refund.body)?.refunded === 0 && a3?.balance === a1?.balance && affectedNoRows(recount),
      `${describe(refund)} / ${JSON.stringify(a3)}`.slice(0, 200),
    ),
  );

  const stale = await rpc(service, "apply_unlimited_subscription", applyArgs("incomplete", t0 - 3_600_000));
  const a4 = asObject((await rpc(a, "ink_summary")).body);
  out.push(
    result(
      "apply_unlimited_subscription: an older event arriving late changes nothing (stale)",
      isOk(stale) && asObject(stale.body)?.stale === true && a4?.unlimited?.status === "trialing",
      describe(stale),
    ),
  );

  if (newUser) {
    const c = await newUser();
    const subC = `sub_rls_verify_${tag}_c`;
    await rpc(service, "apply_unlimited_subscription", { ...applyArgs("trialing", t0), p_subscription_id: subC });
    await rpc(service, "link_unlimited_checkout", { p_subscription_id: subC, p_user_id: c.userId });
    const blocked = await rpc(c, "delete_own_account");
    const still = await c.rest("GET", "profiles", { query: { select: "user_id" } });
    out.push(
      result(
        "delete_own_account: refused while the plan will charge again (P0001, hint unlimited_active); C's account stays",
        !isOk(blocked) && String(asObject(blocked.body)?.hint ?? "") === "unlimited_active" && rows(still).length === 1,
        describe(blocked),
      ),
    );
    await rpc(service, "apply_unlimited_subscription", { ...applyArgs("trialing", t0 + 1000, { p_cancel_at_period_end: true }), p_subscription_id: subC });
    const allowed = await rpc(c, "delete_own_account");
    out.push(result("delete_own_account: allowed once the plan is set to cancel", isOk(allowed), describe(allowed)));
  } else {
    out.push(result("delete_own_account with a plan (skipped: the context cannot provision a user)", true));
  }

  const ended = await rpc(service, "apply_unlimited_subscription", applyArgs("canceled", t0 + 2000, { p_ended_at: new Date().toISOString() }));
  const revived = await rpc(service, "apply_unlimited_subscription", applyArgs("trialing", t0 + 3000));
  const a5 = asObject((await rpc(a, "ink_summary")).body);
  const paid = await rpc(a, "consume_credits", { p_route: "rls-verify-unlimited", p_units: 1, p_request_id: `${request}-after` });
  const a6 = asObject((await rpc(a, "ink_summary")).body);
  const p = asObject(paid.body);
  // The ink path again: one ink spent, or (the earlier checks may have left A with none) refused as
  // out of ink with nothing written. Either way no `unlimited` in the answer.
  const inkPath =
    p?.unlimited === undefined &&
    (p?.ok === true ? a6?.balance === (a5?.balance ?? 0) - 1 : p?.reason === "insufficient_credits" && a6?.balance === a5?.balance);
  out.push(
    result(
      "apply_unlimited_subscription: a cancelled plan stays cancelled (a late trialing event cannot revive it)",
      isOk(ended) && asObject(revived.body)?.stale === true && a5?.unlimited?.status === "canceled" && a5?.unlimited?.unlimited === false,
      `${describe(revived)} / ${JSON.stringify(a5?.unlimited ?? null)}`.slice(0, 200),
    ),
  );
  out.push(
    result(
      "consume_credits: after the plan ends, A's help spends ink again",
      isOk(paid) && inkPath,
      `${describe(paid)} / ${JSON.stringify(a6)}`.slice(0, 200),
    ),
  );

  // Leave nothing behind: the rows outlive the throwaway users (user_id becomes null).
  const cleared = await service.rest("DELETE", "unlimited_subscriptions", { query: { stripe_subscription_id: `like.sub_rls_verify_${tag}_*` }, prefer: "return=representation" });
  out.push(result("unlimited_subscriptions: the check's own rows are removed again", isOk(cleared) && rows(cleared).length === (newUser ? 2 : 1), describe(cleared)));
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
  { name: "whiteboard_snapshots: owners read their history, only the trigger writes it", run: checkSnapshots },
  { name: "board_assets are isolated", run: checkBoardAssets },
  { name: "storage bucket policies", run: checkStorage },
  { name: "version trigger, optimistic concurrency and history retention", run: checkVersionTrigger },
  { name: "accounts & billing tables (plans, profiles, ledgers, billing_events)", run: checkBillingTables },
  { name: "credits: consume_credits / credit_summary spend only the caller's balance", run: checkCreditsConsumption },
  { name: "refunds of failed calls: service role only (refund_ink_for), never by the user", run: checkRefunds },
  { name: "rate_limit_hit: per-user fixed window, function-only table", run: checkRateLimit },
  { name: "usage_by_day: the caller's own spend this month, by day and route", run: checkUsageByDay },
  { name: "onboarding: course and onboarded_at written only through save_onboarding", run: checkOnboarding },
  { name: "ink tables: packs read-only, own grants and purchases only, no way to add ink", run: checkInkTables },
  { name: "ink: summary, purchases/refunds/reviews only through the service role, append-only ledgers", run: checkInkPurchases },
  { name: "Agathon Unlimited: only the webhook grants the plan; subscribers spend no ink and refunds mint none", run: checkUnlimited },
  { name: "sign-up consent: the Terms version is on the profile, readable, never writable", run: checkSignupConsent },
  { name: "email_log: the service role's alone, each email claimed once", run: checkEmailLog },
  { name: "delete_own_account removes the caller's account and data", run: checkDeleteOwnAccount },
];

/**
 * Sign-up consent (migration 20261003010000_signup_consent.sql): every account made since then
 * carries the Terms version it agreed to (the database refuses one without it), and its owner can
 * read that record but never rewrite it. The throwaway users here are made after the migration, so
 * theirs is set.
 * @param {CheckContext} ctx
 */
export async function checkSignupConsent({ a }) {
  /** @type {CheckResult[]} */
  const out = [];
  const select = "accepted_terms_at,terms_version";
  const own = await a.rest("GET", "profiles", { query: { select } });
  const row = rows(own)[0] ? { ...rows(own)[0] } : undefined;
  out.push(
    result(
      "consent: A's profile records the Terms version and when it was accepted",
      isOk(own) && !!row && /^\d{4}-\d{2}-\d{2}$/.test(String(row.terms_version ?? "")) && !Number.isNaN(Date.parse(String(row.accepted_terms_at ?? ""))),
      describe(own),
    ),
  );
  const forged = await a.rest("PATCH", "profiles", {
    query: { user_id: `eq.${a.userId}` },
    body: { accepted_terms_at: "2020-01-01T00:00:00Z", terms_version: "2020-01-01" },
    prefer: "return=representation",
  });
  out.push(
    result(
      "consent: A cannot rewrite own Terms acceptance (42501)",
      isDenied(forged) && String(asObject(forged.body)?.code ?? "") === "42501",
      describe(forged),
    ),
  );
  const after = rows(await a.rest("GET", "profiles", { query: { select } }))[0];
  out.push(
    result(
      "consent: A's Terms acceptance unchanged after the attempt",
      !!row && !!after && after.terms_version === row.terms_version && after.accepted_terms_at === row.accepted_terms_at,
      JSON.stringify(after ?? null).slice(0, 200),
    ),
  );
  return out;
}

/**
 * Email log (migration 20261003030000_email_log.sql): the record of which transactional emails
 * went out (the welcome, the Unlimited trial reminders), written only by the server with the
 * service role. No user may read it (it says who got which email), insert into it (a forged
 * "already sent" would stop their own reminder before a charge), change or delete it (a deleted
 * row would send the email again). With the service role: a claim works once, a second claim of
 * the same email conflicts (409, the unique key sendOnce relies on), and the check removes its own
 * row. A user is only ever denied, so these run on A's real account without side effects.
 * @param {CheckContext} ctx
 */
export async function checkEmailLog({ a, b, service }) {
  /** @type {CheckResult[]} */
  const out = [];
  const sel = await a.rest("GET", "email_log", { query: { select: "id" } });
  out.push(result("email_log: A cannot read it", isDenied(sel), describe(sel)));
  const ins = await a.rest("POST", "email_log", { body: minimalInsert("email_log", a.userId ?? ZERO_UUID), prefer: "return=minimal" });
  out.push(result("email_log: A cannot mark an email as sent (insert denied)", isDenied(ins), describe(ins)));
  const upd = await a.rest("PATCH", "email_log", { query: { user_id: `eq.${a.userId}` }, body: { resend_id: "rls-verify" }, prefer: "return=representation" });
  out.push(result("email_log: A cannot update it", isDenied(upd), describe(upd)));
  const del = await a.rest("DELETE", "email_log", { query: { user_id: `eq.${a.userId}` }, prefer: "return=representation" });
  out.push(result("email_log: A cannot delete from it", isDenied(del), describe(del)));

  if (!service) {
    out.push(result("email_log with the service role (skipped: no service role client)", true));
    return out;
  }
  const ref = `rls-verify-${uuid()}`;
  const row = { user_id: a.userId, kind: "rls_verify", ref };
  const claim = await service.rest("POST", "email_log", { body: row, prefer: "return=representation" });
  out.push(result("email_log: the service role claims an email for A", isOk(claim) && rows(claim).length === 1, describe(claim)));
  const again = await service.rest("POST", "email_log", { body: row, prefer: "return=minimal" });
  out.push(result("email_log: a second claim of the same email conflicts (409: sent at most once)", again.status === 409, describe(again)));
  const aSees = await a.rest("GET", "email_log", { query: { ref: `eq.${ref}`, select: "id" } });
  out.push(result("email_log: A still cannot read the row about them", isDenied(aSees), describe(aSees)));
  const bSees = await b.rest("GET", "email_log", { query: { ref: `eq.${ref}`, select: "id" } });
  out.push(result("email_log: B cannot read it either", isDenied(bSees), describe(bSees)));
  const cleared = await service.rest("DELETE", "email_log", { query: { ref: `eq.${ref}` }, prefer: "return=representation" });
  out.push(result("email_log: the check's own row is removed again", isOk(cleared) && rows(cleared).length === 1, describe(cleared)));
  return out;
}

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
