/**
 * Unit tests for scripts/lib/rlsChecks.mjs and scripts/lib/supabaseHttp.mjs.
 * No network: every check runs against an in-memory fake that models the
 * intended RLS behaviour, with named "leaks" that switch individual
 * protections off so each check's fail decision can be exercised.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_CHECKS,
  CREDIT_SUMMARY_KEYS,
  INK_PACKS,
  INK_SUMMARY_KEYS,
  PUBLIC_TABLES,
  RATE_LIMIT_KEYS,
  affectedNoRows,
  checkAnonDenied,
  checkBillingTables,
  checkBoardAssets,
  checkBugReports,
  checkCreditsConsumption,
  checkCrossUserIsolation,
  checkDeleteOwnAccount,
  checkInkPurchases,
  checkInkTables,
  checkOnboarding,
  checkRateLimit,
  checkRefunds,
  checkSnapshots,
  checkStorage,
  checkTrainersNotWritable,
  checkTrainingSamplesDenied,
  checkUsageByDay,
  checkUserSettingsIsolation,
  checkVersionTrigger,
  checkWhiteboardOwnerCrud,
  deniedOrEmpty,
  formatResults,
  isCreditSummary,
  isDenied,
  isInkSummary,
  isRateLimitResult,
  isStorageDenied,
  isUsageByDay,
  minimalInsert,
  rpc,
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
  | "noSnapshotHistory"
  // accounts & billing
  | "plansWritable"
  | "profileCrossRead"
  | "planIdUpdatable"
  | "usageInsertable"
  | "grantInsertable"
  | "billingEventsReadable"
  | "consumeChargesOther"
  | "overspendAllowed"
  | "summaryMissingField"
  | "anonRpc"
  | "deleteNoop"
  // refunds & rate limits
  | "refundUserCallable"
  | "refundOthers"
  | "refundStale"
  | "refundKeepsRow"
  | "rateLimitNeverDenies"
  | "rateLimitShared"
  | "rateLimitBadRetry"
  | "countersReadable"
  // usage by day
  | "usageByDayForeign"
  // onboarding
  | "onboardingPatchable"
  | "onboardingForeign"
  | "onboardingAnyCourse"
  // ink
  | "inkPacksWritable"
  | "inkSelfGrant"
  | "inkGrantsCrossRead"
  | "inkBalancePatchable"
  | "inkPurchaseRpcOpen"
  | "inkPurchaseReplay"
  | "inkPurchaseCrossRead"
  | "inkReverseNegative"
  | "inkNoStarter"
  | "inkAmountUnchecked"
  | "inkReviewsReadable"
  | "inkLedgerDeletable";

const USER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";
/** Pseudo identity for the service-role client (RLS bypassed in the fake). */
const SERVICE = "service-role";
const REFUND_WINDOW_MS = 15 * 60_000;
const FILTER_KEYS = new Set(["select", "limit", "order", "on_conflict"]);
const PLANS: Row[] = [
  { id: "free", name: "Free", monthly_credits: 300, price_cents: 0, sort: 0, active: true },
  { id: "plus", name: "Plus", monthly_credits: 3000, price_cents: 1200, sort: 1, active: false },
  { id: "pro", name: "Pro", monthly_credits: 12000, price_cents: 3900, sort: 2, active: false },
];
const PACKS: Row[] = INK_PACKS.map(([id, ink, price], i) => ({ id, name: String(id), ink, price_cents: price, sort: i + 1, active: true }));
const STARTER_INK = 300;

function makeWorld(leaks: Leak[] = []) {
  const leak = (l: Leak) => leaks.includes(l);
  const boards = new Map<string, Row>();
  const settings = new Map<string, Row>();
  const bugReports: Row[] = [];
  const snapshots: Row[] = [];
  const assets: Row[] = [];
  const objects = new Map<string, string>(); // "bucket/path" -> owner
  const users = new Set<string>([USER_A, USER_B]); // auth.users
  const profiles = new Map<string, Row>();
  for (const u of users) profiles.set(u, { user_id: u, plan_id: "free", display_name: null, course: null, onboarded_at: null });
  const usage: Row[] = [];
  const grants: Row[] = [];
  const billingEvents: Row[] = [];
  // ink (20261002000000_ink.sql): the grant ledger and the purchases; the balance is grants - usage
  const inkGrants: Row[] = [];
  const purchases: Row[] = [];
  const reviews: Row[] = []; // ink_checkout_reviews: service role only
  const grantStarter = (uid: string) => {
    if (!leak("inkNoStarter")) inkGrants.push({ id: inkGrants.length + 1, user_id: uid, kind: "starter", units: STARTER_INK, created_at: new Date().toISOString() });
  };
  for (const u of users) grantStarter(u);
  // "<uid>:<bucket>:<windowStartMs>" -> counter row (public.rate_limit_counters)
  const counters = new Map<string, { user_id: string; bucket: string; window_start: number; hits: number; expires_at: number }>();
  const uuid = () => globalThis.crypto.randomUUID();

  const ok = (body: unknown, status = 200): HttpResult => ({ status, body });
  const denied = (uid: string | null): HttpResult => ({
    status: uid ? 403 : 401,
    body: { code: "42501", message: "permission denied" },
  });

  const sumUnits = (list: Row[], uid: string) => list.filter((r) => r.user_id === uid).reduce((n, r) => n + Number(r.units), 0);
  /** The ink model: all ink granted minus all ink used (credit_summary keeps the old keys, monthly_credits 0). */
  function balance(uid: string) {
    const plan = PLANS[0];
    const used = sumUnits(usage, uid);
    const granted = sumUnits(inkGrants, uid);
    return { plan, monthly: 0, used, granted, remaining: Math.max(0, granted - used) };
  }
  function summary(uid: string): Row {
    const b = balance(uid);
    const body: Row = {
      plan_id: b.plan.id,
      plan_name: b.plan.name,
      monthly_credits: b.monthly,
      used: b.used,
      granted: b.granted,
      remaining: b.remaining,
      balance: b.remaining,
      period_start: "2026-10-01T00:00:00+00:00",
      period_end: "2026-11-01T00:00:00+00:00",
    };
    if (leak("summaryMissingField")) delete body.granted;
    return body;
  }
  function inkSummary(uid: string): Row {
    const own = inkGrants.filter((g) => g.user_id === uid);
    const sum = (kind: string) => own.filter((g) => g.kind === kind).reduce((n, g) => n + Number(g.units), 0);
    const b = balance(uid);
    const mine = purchases.filter((p) => p.user_id === uid);
    const last = mine.at(-1);
    return {
      balance: b.remaining,
      granted: b.granted,
      purchased: sum("purchase"),
      refunded: -sum("refund"),
      used: Math.max(0, b.granted - b.remaining),
      starter: sum("starter"),
      starter_at: own.find((g) => g.kind === "starter")?.created_at ?? null,
      purchases: mine.length,
      last_purchase: last ? { pack_id: last.pack_id, pack_name: last.pack_id, ink: last.ink, status: last.status, created_at: last.created_at } : null,
    };
  }
  /** The service-role RPCs of 20261002000000_ink.sql (and, with a leak, callable by a user). */
  function recordReview(args: Row, reason: string): HttpResult {
    const existing = reviews.find((r) => r.checkout_session_id === args.p_checkout_session_id);
    if (existing) return ok({ recorded: false, duplicate: true, review_id: existing.id });
    const ref = String(args.p_client_reference_id ?? args.p_user_id ?? "");
    const row: Row = {
      id: reviews.length + 1,
      checkout_session_id: args.p_checkout_session_id,
      reason,
      status: "open",
      user_id: users.has(ref) ? ref : null,
      pack_id: args.p_pack_id ?? null,
      payment_intent_id: args.p_payment_intent_id ?? null,
      amount_cents: args.p_amount_cents ?? null,
      currency: args.p_currency ?? null,
    };
    reviews.push(row);
    return ok({ recorded: true, duplicate: false, review_id: row.id });
  }
  /** refund_ink_for(p_user_id, p_request_id): the given user's own recent rows for that request. */
  function refundFor(uid: string, requestId: unknown): HttpResult {
    if (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 100) {
      return { status: 400, body: { code: "22023", message: "p_request_id must be 1..100 characters" } };
    }
    const cutoff = Date.now() - REFUND_WINDOW_MS;
    let refunded = 0;
    for (let i = usage.length - 1; i >= 0; i--) {
      const r = usage[i];
      if (r.request_id !== requestId) continue;
      if (r.user_id !== uid && !leak("refundOthers")) continue;
      if (Date.parse(String(r.created_at)) <= cutoff && !leak("refundStale")) continue;
      refunded += Number(r.units);
      if (!leak("refundKeepsRow")) usage.splice(i, 1);
    }
    return ok({ refunded, remaining: balance(uid).remaining });
  }
  function inkRpc(fn: string, args: Row): HttpResult | null {
    switch (fn) {
      case "refund_ink_for":
        return refundFor(String(args.p_user_id), args.p_request_id);
      case "record_ink_checkout_review":
        return recordReview(args, String(args.p_reason ?? "unknown"));
      case "resolve_ink_checkout_review": {
        const review = reviews.find((r) => r.id === args.p_review_id && r.status === "open");
        const uid = String(args.p_user_id ?? review?.user_id ?? "");
        const pack = PACKS.find((p) => p.id === (args.p_pack_id ?? review?.pack_id));
        if (!review || !users.has(uid) || !pack) return { status: 400, body: { code: "22023", message: "cannot resolve" } };
        review.status = "resolved";
        inkGrants.push({ id: inkGrants.length + 1, user_id: uid, kind: "purchase", units: pack.ink });
        return ok({ granted: pack.ink, user_id: uid, balance: balance(uid).remaining });
      }
      case "grant_ink_purchase": {
        const uid = String(args.p_user_id);
        const existing = purchases.find((p) => p.checkout_session_id === args.p_checkout_session_id);
        if (existing && !leak("inkPurchaseReplay")) return ok({ granted: 0, duplicate: true, purchase_id: existing.id, balance: balance(uid).remaining });
        if (reviews.some((r) => r.checkout_session_id === args.p_checkout_session_id)) return ok({ granted: 0, duplicate: true, review: true });
        const pack = PACKS.find((p) => p.id === args.p_pack_id);
        const currency = typeof args.p_currency === "string" ? args.p_currency.toLowerCase() : null;
        const amount = typeof args.p_amount_cents === "number" ? args.p_amount_cents : null;
        const reason = !pack
          ? `unknown pack ${String(args.p_pack_id)}`
          : !users.has(uid)
            ? "no account for this user"
            : leak("inkAmountUnchecked")
              ? null
              : amount === null || currency === null
                ? "no amount on the session"
                : currency !== "usd"
                  ? `paid in ${currency}`
                  : amount < Number(pack.price_cents)
                    ? `paid ${amount} cents`
                    : null;
        if (reason || !pack) {
          const recorded = recordReview(args, reason ?? "unknown pack");
          return ok({ granted: 0, duplicate: false, review: true, reason, review_id: (recorded.body as Row).review_id });
        }
        const purchase: Row = {
          id: purchases.length + 1,
          user_id: uid,
          pack_id: pack.id,
          ink: pack.ink,
          amount_cents: args.p_amount_cents ?? pack.price_cents,
          checkout_session_id: args.p_checkout_session_id,
          payment_intent_id: args.p_payment_intent_id ?? null,
          status: "paid",
          refunded_cents: 0,
          refunded_ink: 0,
          refund_unrecovered_ink: 0,
          created_at: new Date().toISOString(),
        };
        purchases.push(purchase);
        inkGrants.push({ id: inkGrants.length + 1, user_id: uid, kind: "purchase", units: pack.ink, purchase_id: purchase.id });
        return ok({ granted: pack.ink, duplicate: false, purchase_id: purchase.id, balance: balance(uid).remaining });
      }
      case "reverse_ink_purchase": {
        const p = purchases.find((x) => x.payment_intent_id === args.p_payment_intent_id);
        if (!p) {
          const reviewed = reviews.filter((r) => r.payment_intent_id === args.p_payment_intent_id);
          for (const r of reviewed) r.status = "refunded";
          return ok(reviewed.length ? { found: true, review: true, reversed: 0, requested: 0 } : { found: false, reversed: 0 });
        }
        const base = Number(p.amount_cents);
        const cum = args.p_fully_refunded ? base : Math.min(Number(args.p_amount_refunded_cents), base);
        if (cum <= Number(p.refunded_cents)) return ok({ found: true, duplicate: true, reversed: 0, requested: 0 });
        const target = cum >= base ? Number(p.ink) : Math.round((Number(p.ink) * cum) / base);
        const owed = target - Number(p.refunded_ink) - Number(p.refund_unrecovered_ink);
        const have = balance(String(p.user_id)).remaining;
        const reversed = leak("inkReverseNegative") ? owed : Math.min(owed, have);
        if (reversed > 0) inkGrants.push({ id: inkGrants.length + 1, user_id: p.user_id, kind: "refund", units: -reversed, purchase_id: p.id });
        Object.assign(p, {
          refunded_cents: cum,
          refunded_ink: Number(p.refunded_ink) + reversed,
          refund_unrecovered_ink: Number(p.refund_unrecovered_ink) + owed - reversed,
          status: cum >= base ? "refunded" : "partially_refunded",
        });
        return ok({ found: true, duplicate: false, reversed, requested: owed, balance: have - reversed, status: p.status });
      }
      case "grant_ink": {
        const uid = String(args.p_user_id);
        const units = Number(args.p_units);
        inkGrants.push({ id: inkGrants.length + 1, user_id: uid, kind: "manual", units });
        return ok({ granted: units, balance: balance(uid).remaining });
      }
    }
    return null;
  }
  function deleteBoardRows(id: string) {
    boards.delete(id);
    for (let i = snapshots.length - 1; i >= 0; i--) if (snapshots[i].whiteboard_id === id) snapshots.splice(i, 1);
    for (let i = assets.length - 1; i >= 0; i--) if (assets[i].whiteboard_id === id) assets.splice(i, 1);
  }

  function rpcCall(uid: string, fn: string, args: Row): HttpResult {
    if (["grant_ink_purchase", "reverse_ink_purchase", "grant_ink", "record_ink_checkout_review", "resolve_ink_checkout_review"].includes(fn)) {
      return leak("inkPurchaseRpcOpen") ? (inkRpc(fn, args) as HttpResult) : denied(uid);
    }
    // Refunds of failed calls are the server's (service role): a user holding a request id must
    // not be able to get that call's ink back.
    if (fn === "refund_credits") return leak("refundUserCallable") ? refundFor(uid, args.p_request_id) : denied(uid);
    if (fn === "refund_ink_for") return leak("refundUserCallable") ? refundFor(String(args.p_user_id), args.p_request_id) : denied(uid);
    switch (fn) {
      case "credit_summary":
        return ok(summary(uid));
      case "ink_summary":
        return ok(inkSummary(uid));
      case "consume_credits": {
        const units = Number(args.p_units);
        if (!Number.isInteger(units) || units < 1 || units > 1000) {
          return { status: 400, body: { code: "22023", message: "p_units must be between 1 and 1000" } };
        }
        if (!users.has(uid)) return denied(uid); // auth.users row gone -> 'account not found' (42501)
        const { remaining } = balance(uid);
        if (remaining < units && !leak("overspendAllowed")) return ok({ ok: false, remaining, reason: "insufficient_credits" });
        const row: Row = {
          id: usage.length + 1,
          user_id: uid,
          route: args.p_route,
          units,
          model: args.p_model ?? null,
          request_id: args.p_request_id ?? null,
          created_at: new Date().toISOString(),
        };
        usage.push(row);
        if (leak("consumeChargesOther")) for (const other of users) if (other !== uid) usage.push({ ...row, id: usage.length + 1, user_id: other });
        return ok({ ok: true, remaining: remaining - units, reason: null });
      }
      case "rate_limit_hit": {
        const bucket = args.p_bucket;
        const limit = Number(args.p_limit);
        const windowMs = Number(args.p_window_ms);
        if (typeof bucket !== "string" || bucket.length < 1 || bucket.length > 100) {
          return { status: 400, body: { code: "22023", message: "p_bucket must be 1..100 characters" } };
        }
        if (!Number.isInteger(limit) || limit < 1 || limit > 1_000_000) {
          return { status: 400, body: { code: "22023", message: "p_limit must be between 1 and 1000000" } };
        }
        if (!Number.isInteger(windowMs) || windowMs < 1 || windowMs > 86_400_000) {
          return { status: 400, body: { code: "22023", message: "p_window_ms must be between 1 and 86400000" } };
        }
        const now = Date.now();
        const windowStart = now - (now % windowMs);
        const owner = leak("rateLimitShared") ? "shared" : uid;
        for (const [k, c] of counters) if (c.user_id === owner && c.bucket === bucket && c.expires_at <= now) counters.delete(k);
        const key = `${owner}:${bucket}:${windowStart}`;
        const row = counters.get(key) ?? { user_id: owner, bucket, window_start: windowStart, hits: 0, expires_at: windowStart + 2 * windowMs };
        row.hits += 1;
        counters.set(key, row);
        const allowed = leak("rateLimitNeverDenies") || row.hits <= limit;
        const retryAfter = allowed ? 0 : leak("rateLimitBadRetry") ? windowMs + 1 : windowStart + windowMs - now;
        return ok({ allowed, remaining: Math.max(0, limit - row.hits), retry_after_ms: retryAfter, backend: "db" });
      }
      case "usage_by_day": {
        const zone = typeof args.p_time_zone === "string" && args.p_time_zone ? args.p_time_zone : "UTC";
        // p_days (20261002000000_ink.sql): null = this month, else 1..366 days back; every fake row is from today
        if (args.p_days !== undefined && args.p_days !== null && !(Number(args.p_days) >= 1 && Number(args.p_days) <= 366)) {
          return { status: 400, body: { code: "22023", message: "p_days must be between 1 and 366" } };
        }
        let format: Intl.DateTimeFormat;
        try {
          format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
        } catch {
          return { status: 400, body: { code: "22023", message: `time zone "${zone}" not recognized` } };
        }
        const groups = new Map<string, Row>();
        for (const r of usage) {
          if (r.user_id !== uid && !leak("usageByDayForeign")) continue;
          const day = format.format(new Date(String(r.created_at)));
          const key = `${day}|${r.route}`;
          const g = groups.get(key) ?? { day, route: r.route, events: 0, credits: 0 };
          g.events = Number(g.events) + 1;
          g.credits = Number(g.credits) + Number(r.units);
          groups.set(key, g);
        }
        return ok([...groups.values()].sort((x, y) => String(y.day).localeCompare(String(x.day))));
      }
      case "save_onboarding": {
        const course = args.p_course ?? null;
        const known = ["algebra1", "geometry", "algebra2", "precalc_calc", "other"];
        if (course !== null && !known.includes(String(course)) && !leak("onboardingAnyCourse")) {
          return { status: 400, body: { code: "22023", message: "unknown course" } };
        }
        const targets = leak("onboardingForeign") ? [...profiles.values()] : [profiles.get(uid)].filter((r): r is Row => Boolean(r));
        if (!targets.some((r) => r.user_id === uid)) return denied(uid);
        for (const r of targets) {
          if (course !== null) r.course = course;
          if (args.p_complete === true && !r.onboarded_at) r.onboarded_at = new Date().toISOString();
        }
        const own = profiles.get(uid) as Row;
        return ok({ course: own.course, onboarded_at: own.onboarded_at });
      }
      case "delete_own_account": {
        if (leak("deleteNoop")) return ok(null, 204);
        users.delete(uid);
        profiles.delete(uid);
        settings.delete(uid);
        for (const b of [...boards.values()]) if (b.user_id === uid) deleteBoardRows(b.id as string);
        for (let i = usage.length - 1; i >= 0; i--) if (usage[i].user_id === uid) usage.splice(i, 1);
        for (let i = grants.length - 1; i >= 0; i--) if (grants[i].user_id === uid) grants.splice(i, 1);
        for (let i = inkGrants.length - 1; i >= 0; i--) if (inkGrants[i].user_id === uid) inkGrants.splice(i, 1);
        for (let i = purchases.length - 1; i >= 0; i--) if (purchases[i].user_id === uid) purchases.splice(i, 1);
        // Storage rows are NOT removed by the RPC (storage.protect_delete forbids direct deletes); they
        // stay until the client / operator removes them through the Storage API - mirror that here.
        return ok(null, 204);
      }
    }
    return { status: 404, body: { code: "42883", message: `fake: unknown function ${fn}` } };
  }
  // Mirrors what storage-api actually returns on this stack (HTTP 400, statusCode "403").
  const storageDenied = (): HttpResult => ({
    status: 400,
    body: { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy", code: "AccessDenied" },
  });

  function matches(row: Row, query: Record<string, string>) {
    for (const [key, value] of Object.entries(query)) {
      if (FILTER_KEYS.has(key)) continue;
      if (value.startsWith("like.")) {
        // PostgREST `like.` with `*` as the wildcard; everything else is literal.
        const [head, ...rest] = value.slice(5).split("*");
        const text = String(row[key]);
        if (!text.startsWith(head)) return false;
        let at = head.length;
        for (const part of rest) {
          const found = text.indexOf(part, at);
          if (found < 0) return false;
          at = found + part.length;
        }
        if (rest.length > 0 && !text.endsWith(rest[rest.length - 1])) return false;
        if (rest.length === 0 && text !== head) return false;
        continue;
      }
      if (!value.startsWith("eq.")) throw new Error(`fake only supports eq. and like. filters, got ${key}=${value}`);
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
      if (table.startsWith("rpc/")) return leak("anonRpc") ? ok({ ok: true, remaining: 0, reason: null }) : denied(null);
      if (method === "GET") return leak("anonSelect") ? ok([]) : denied(null);
      return leak("anonInsert") ? ok(null, 201) : denied(null);
    }
    if (uid === SERVICE) return serviceRest(method, table, query, body);
    if (table.startsWith("rpc/")) return rpcCall(uid, table.slice(4), body);

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
      case "plans": {
        if (method === "GET") return ok(ordered(PLANS.filter((r) => matches(r, query)), query));
        return leak("plansWritable") ? ok(rep ? [] : null, method === "POST" ? 201 : 200) : denied(uid);
      }
      case "profiles": {
        if (method === "POST") return denied(uid); // no insert grant; the sign-up trigger creates rows
        if (method === "DELETE") return denied(uid);
        const visible = [...profiles.values()].filter((r) => (r.user_id === uid || leak("profileCrossRead")) && matches(r, query));
        if (method === "GET") return ok(visible);
        if (method === "PATCH") {
          // Column-level grant: only display_name is updatable -> 42501 before RLS.
          const updatable = (k: string) =>
            k === "display_name" ||
            (leak("planIdUpdatable") && k === "plan_id") ||
            (leak("onboardingPatchable") && (k === "course" || k === "onboarded_at")) ||
            (leak("inkBalancePatchable") && k === "ink_balance");
          if (Object.keys(body).some((k) => !updatable(k))) return denied(uid);
          const own = visible.filter((r) => r.user_id === uid);
          for (const r of own) Object.assign(r, body);
          return ok(rep ? own : null);
        }
        break;
      }
      case "usage_events": {
        if (method === "POST") {
          if (!leak("usageInsertable")) return denied(uid);
          usage.push({ id: usage.length + 1, ...body });
          return ok(null, 201);
        }
        if (method === "GET") return ok(usage.filter((r) => r.user_id === uid && matches(r, query)));
        return denied(uid);
      }
      case "credit_grants": {
        if (method === "POST") {
          if (!leak("grantInsertable")) return denied(uid);
          grants.push({ id: grants.length + 1, ...body });
          return ok(null, 201);
        }
        if (method === "GET") return ok(grants.filter((r) => r.user_id === uid && matches(r, query)));
        return denied(uid);
      }
      case "billing_events": {
        if (method === "GET") return leak("billingEventsReadable") ? ok(billingEvents) : denied(uid);
        return denied(uid);
      }
      case "ink_packs": {
        if (method === "GET") return ok(ordered(PACKS.filter((r) => matches(r, query)), query));
        return leak("inkPacksWritable") ? ok(rep ? [] : null, method === "POST" ? 201 : 200) : denied(uid);
      }
      case "ink_grants": {
        if (method === "POST") {
          if (!leak("inkSelfGrant")) return denied(uid);
          inkGrants.push({ id: inkGrants.length + 1, ...body });
          return ok(null, 201);
        }
        if (method === "GET") return ok(ordered(inkGrants.filter((r) => (r.user_id === uid || leak("inkGrantsCrossRead")) && matches(r, query)), query));
        return denied(uid);
      }
      case "ink_purchases": {
        if (method === "POST") return denied(uid);
        if (method === "GET") return ok(purchases.filter((r) => (r.user_id === uid || leak("inkPurchaseCrossRead")) && matches(r, query)));
        return denied(uid);
      }
      case "ink_checkout_reviews": {
        if (method === "GET" && leak("inkReviewsReadable")) return ok(reviews.filter((r) => matches(r, query)));
        return denied(uid);
      }
      case "rate_limit_counters": {
        // Function-only table: no grants for authenticated at all.
        if (method === "GET" && leak("countersReadable")) return ok([...counters.values()].filter((c) => c.user_id === uid));
        return denied(uid);
      }
    }
    return { status: 404, body: { message: `fake: unsupported ${method} ${table}` } };
  }

  /** The service role bypasses RLS and holds every grant; only what the checks use is modelled. */
  function serviceRest(method: string, table: string, query: Record<string, string>, body: Row): HttpResult {
    if (table.startsWith("rpc/")) {
      const res = inkRpc(table.slice(4), body);
      if (res) return res;
    }
    // The ledgers are append-only even for the service role (delete-guard triggers, 42501):
    // corrections are inserts. With the leak, a delete goes through and the balance drifts.
    if (method === "DELETE" && (table === "ink_grants" || table === "ink_purchases" || table === "usage_events")) {
      if (!leak("inkLedgerDeletable")) return denied(SERVICE);
      const list = table === "ink_grants" ? inkGrants : table === "ink_purchases" ? purchases : usage;
      const gone = list.filter((r) => matches(r, query));
      for (const r of gone) list.splice(list.indexOf(r), 1);
      return ok(gone);
    }
    switch (table) {
      case "usage_events": {
        if (method === "POST") {
          usage.push({ id: usage.length + 1, created_at: new Date().toISOString(), ...body });
          return ok(null, 201);
        }
        if (method === "GET") return ok(usage.filter((r) => matches(r, query)));
        break;
      }
      case "ink_checkout_reviews": {
        if (method === "GET") return ok(reviews.filter((r) => matches(r, query)));
        if (method === "DELETE") {
          const gone = reviews.filter((r) => matches(r, query));
          for (const r of gone) reviews.splice(reviews.indexOf(r), 1);
          return ok(gone);
        }
        break;
      }
      case "rate_limit_counters": {
        if (method === "GET") {
          const list: Row[] = [...counters.values()].map((c) => ({ ...c, window_start: new Date(c.window_start).toISOString() }));
          return ok(list.filter((r) => matches(r, query)));
        }
        break;
      }
    }
    return { status: 404, body: { message: `fake: unsupported service ${method} ${table}` } };
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

  const newUser = async (): Promise<RlsClient> => {
    const uid = uuid();
    users.add(uid);
    profiles.set(uid, { user_id: uid, plan_id: "free", display_name: null, course: null, onboarded_at: null });
    grantStarter(uid);
    return client(uid);
  };

  const ctx: CheckContext = { anon: client(null), a: client(USER_A), b: client(USER_B), newUser, service: client(SERVICE) };
  return { ctx, state: { boards, settings, bugReports, snapshots, assets, objects, users, profiles, usage, grants, counters, inkGrants, purchases, reviews } };
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
    expect(PUBLIC_TABLES).toHaveLength(17);
    for (const table of ["plans", "profiles", "usage_events", "credit_grants", "billing_events", "rate_limit_counters", "ink_packs", "ink_grants", "ink_purchases", "ink_checkout_reviews"]) {
      expect(PUBLIC_TABLES).toContain(table);
    }
  });

  it("removes every whiteboard and storage object it created", async () => {
    const { ctx, state } = makeWorld();
    await runAllChecks(ctx);
    expect(state.boards.size).toBe(0);
    expect(state.objects.size).toBe(0);
    expect(state.snapshots).toEqual([]);
    expect(state.assets).toEqual([]);
  });

  it("the delete_own_account check leaves only the two fixed users behind", async () => {
    const { ctx, state } = makeWorld();
    await checkDeleteOwnAccount(ctx);
    expect([...state.users].sort()).toEqual([USER_A, USER_B].sort());
    expect(state.profiles.size).toBe(2);
    expect(state.usage.filter((r) => r.user_id !== USER_A && r.user_id !== USER_B)).toEqual([]);
  });

  it("consume_credits only ever writes usage rows for the caller", async () => {
    const { ctx, state } = makeWorld();
    await checkCreditsConsumption(ctx);
    expect(state.usage.length).toBeGreaterThan(0);
    expect(state.usage.every((r) => r.user_id === USER_A)).toBe(true);
  });

  it("the refund check leaves A's un-refundable rows (foreign attempt, stale) in the ledger and nothing of B's", async () => {
    const { ctx, state } = makeWorld();
    const results = await checkRefunds(ctx);
    expect(failures(results)).toEqual([]);
    expect(results.map((r) => r.name)).toContain("refund_ink_for: a row older than 15 minutes refunds 0 and stays");
    expect(results.map((r) => r.name)).toContain("refund_credits: A cannot refund own request (users have no refunds)");
    const requestIds = state.usage.map((r) => String(r.request_id));
    expect(requestIds.some((id) => id.endsWith("-foreign"))).toBe(true);
    expect(requestIds.some((id) => id.endsWith("-stale"))).toBe(true);
    expect(requestIds.some((id) => id.endsWith("-own"))).toBe(false);
    expect(state.usage.every((r) => r.user_id === USER_A)).toBe(true);
  });

  it("without a service client the refund check still proves a user cannot refund, and skips the service half", async () => {
    const { ctx, state } = makeWorld();
    const results = await checkRefunds({ anon: ctx.anon, a: ctx.a, b: ctx.b });
    expect(failures(results)).toEqual([]);
    expect(results.map((r) => r.name)).toContain("refund_credits: A cannot refund own request (users have no refunds)");
    expect(results.map((r) => r.name)).toContain("refund_ink_for with the service role (skipped: no service role client)");
    expect(results.map((r) => r.name)).not.toContain("refund_ink_for: a row older than 15 minutes refunds 0 and stays");
    // the spend stays: nothing refunded it
    expect(state.usage.filter((r) => String(r.request_id).endsWith("-own"))).toHaveLength(1);
  });

  it("the rate limit check keeps counters per user and never lets a user token read them", async () => {
    const { ctx, state } = makeWorld();
    const results = await checkRateLimit(ctx);
    expect(failures(results)).toEqual([]);
    const owners = new Set([...state.counters.values()].map((c) => c.user_id));
    expect(owners).toEqual(new Set([USER_A, USER_B]));
    const aRows = [...state.counters.values()].filter((c) => c.user_id === USER_A);
    // other bucket: 1 hit; main bucket: 3 allowed + 2 denied + 1 after the delete attempt = 6
    expect(aRows.map((c) => c.hits).sort((x, y) => x - y)).toEqual([1, 6]);
  });

  it("the ink checks pass on their own and only ever add ink through the service role", async () => {
    const { ctx, state } = makeWorld();
    expect(failures(await checkInkTables(ctx))).toEqual([]);
    expect(failures(await checkInkPurchases(ctx))).toEqual([]);
    expect(state.inkGrants.filter((g) => g.kind === "manual")).toEqual([]);
    expect(state.purchases).toHaveLength(1);
    expect(state.purchases[0]).toMatchObject({ user_id: USER_A, pack_id: "medium", status: "refunded" });
    // the underpaid and the euro checkouts went to review with no ink, and the check removed its rows again
    expect(state.reviews).toEqual([]);
    expect(state.inkGrants.filter((g) => g.user_id === USER_B && g.kind !== "starter")).toEqual([]);
  });

  it("the ink purchase check reports its service-role part as skipped (still passing) without a service client", async () => {
    const { ctx, state } = makeWorld();
    const results = await checkInkPurchases({ anon: ctx.anon, a: ctx.a, b: ctx.b });
    expect(failures(results)).toEqual([]);
    expect(results.map((r) => r.name)).toContain("grant_ink_purchase / reverse_ink_purchase with the service role (skipped: no service role client)");
    expect(state.purchases).toEqual([]);
  });

  it("the usage_by_day check spends only as A and passes on its own", async () => {
    const { ctx, state } = makeWorld();
    const results = await checkUsageByDay(ctx);
    expect(failures(results)).toEqual([]);
    expect(state.usage.length).toBe(1);
    expect(state.usage[0]).toMatchObject({ user_id: USER_A, units: 3 });
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
    // accounts & billing
    ["anonSelect", checkAnonDenied, "anon: select profiles denied"],
    ["anonInsert", checkAnonDenied, "anon: insert credit_grants denied"],
    ["plansWritable", checkBillingTables, "plans: A cannot insert a plan"],
    ["plansWritable", checkBillingTables, "plans: A cannot update a plan"],
    ["profileCrossRead", checkBillingTables, "profiles: A cannot read B's profile (select returns [])"],
    ["planIdUpdatable", checkBillingTables, "profiles: A cannot update own plan_id (42501)"],
    ["planIdUpdatable", checkBillingTables, "profiles: A's profile intact (plan unchanged) after the attempts"],
    ["usageInsertable", checkBillingTables, "usage_events: A cannot insert directly"],
    ["grantInsertable", checkBillingTables, "credit_grants: A cannot insert (nothing lets a user add credits)"],
    ["billingEventsReadable", checkBillingTables, "billing_events: not readable by authenticated users"],
    ["consumeChargesOther", checkCreditsConsumption, "credit_summary: B's balance unchanged by A's consumption"],
    ["overspendAllowed", checkCreditsConsumption, "consume_credits: spending beyond remaining returns ok:false insufficient_credits"],
    ["overspendAllowed", checkCreditsConsumption, "consume_credits: refused spend writes no usage row and leaves the balance"],
    ["summaryMissingField", checkCreditsConsumption, "credit_summary: A gets a well-formed summary"],
    ["anonRpc", checkCreditsConsumption, "consume_credits: anon cannot call it"],
    ["deleteNoop", checkDeleteOwnAccount, "delete_own_account: C's profile is gone"],
    ["deleteNoop", checkDeleteOwnAccount, "delete_own_account: deleted user's JWT cannot spend (auth.users row gone)"],
    // refunds & rate limits
    ["anonSelect", checkAnonDenied, "anon: select rate_limit_counters denied"],
    ["anonInsert", checkAnonDenied, "anon: insert rate_limit_counters denied"],
    ["refundUserCallable", checkRefunds, "refund_credits: A cannot refund own request (users have no refunds)"],
    ["refundUserCallable", checkRefunds, "refund_ink_for: A cannot call it"],
    ["refundUserCallable", checkRefunds, "refund: A's charge and usage row stay after the attempts"],
    ["refundOthers", checkRefunds, "refund_ink_for: another user's id with A's request id refunds 0; A's row and both balances untouched"],
    ["refundStale", checkRefunds, "refund_ink_for: a row older than 15 minutes refunds 0 and stays"],
    ["refundKeepsRow", checkRefunds, "refund_ink_for: the refunded usage row is deleted"],
    ["refundKeepsRow", checkRefunds, "refund_ink_for: refunding the same request again refunds 0"],
    ["anonRpc", checkRefunds, "refund_credits: anon cannot call it"],
    ["rateLimitNeverDenies", checkRateLimit, "rate_limit_hit: next hit denied with retry_after_ms in (0, window]"],
    ["rateLimitNeverDenies", checkRateLimit, "rate_limit_hit: A is still denied after the delete attempt"],
    ["rateLimitShared", checkRateLimit, "rate_limit_hit: B has an independent counter for the same bucket"],
    ["rateLimitBadRetry", checkRateLimit, "rate_limit_hit: next hit denied with retry_after_ms in (0, window]"],
    ["anonRpc", checkRateLimit, "rate_limit_hit: anon cannot call it"],
    ["countersReadable", checkRateLimit, "rate_limit_counters: not readable by authenticated users"],
    // usage by day
    ["usageByDayForeign", checkUsageByDay, "usage_by_day: B does not see A's usage"],
    ["usageByDayForeign", checkUsageByDay, "usage_by_day: B's rows add up to B's own credit_summary().used"],
    ["anonRpc", checkUsageByDay, "usage_by_day: anon cannot call it"],
    // onboarding
    ["onboardingPatchable", checkOnboarding, "onboarding: A cannot PATCH own onboarded_at (42501, RPC only)"],
    ["onboardingPatchable", checkOnboarding, "onboarding: A cannot PATCH own course (42501, RPC only)"],
    ["onboardingForeign", checkOnboarding, "onboarding: B's profile unchanged by A's calls"],
    ["onboardingAnyCourse", checkOnboarding, "onboarding: an unknown course is rejected (400)"],
    ["anonRpc", checkOnboarding, "onboarding: anon cannot call save_onboarding"],
    // ink
    ["anonSelect", checkAnonDenied, "anon: select ink_grants denied"],
    ["anonInsert", checkAnonDenied, "anon: insert ink_purchases denied"],
    ["inkPacksWritable", checkInkTables, "ink_packs: A cannot insert a pack"],
    ["inkPacksWritable", checkInkTables, "ink_packs: A cannot update a pack"],
    ["inkSelfGrant", checkInkTables, "ink_grants: A cannot grant themselves ink (insert denied)"],
    ["inkSelfGrant", checkInkTables, "ink: A's balance unchanged by all of the attempts above"],
    ["inkGrantsCrossRead", checkInkTables, "ink_grants: A cannot read B's grants (select returns [])"],
    ["inkBalancePatchable", checkInkTables, "profiles: A cannot set own ink_balance (42501)"],
    ["inkNoStarter", checkInkTables, "ink_grants: A reads own ledger, which starts with the 300-ink starter (sign-up trigger)"],
    ["inkNoStarter", checkInkPurchases, "ink_summary: a new account starts with its 300 starter ink"],
    ["inkPurchaseRpcOpen", checkInkPurchases, "grant_ink_purchase: A cannot call it"],
    ["inkPurchaseRpcOpen", checkInkPurchases, "grant_ink: A cannot call it"],
    ["inkPurchaseRpcOpen", checkInkPurchases, "ink: A's balance unchanged after the denied calls"],
    ["inkPurchaseReplay", checkInkPurchases, "grant_ink_purchase: the same Checkout Session again grants nothing (duplicate)"],
    ["inkPurchaseCrossRead", checkInkPurchases, "ink_purchases: B cannot see A's purchase"],
    ["inkReverseNegative", checkInkPurchases, "reverse_ink_purchase: a full refund takes the pack's ink back, at most what is left (A spent 1,000 first; never below zero)"],
    ["anonSelect", checkAnonDenied, "anon: select ink_checkout_reviews denied"],
    ["inkAmountUnchecked", checkInkPurchases, "grant_ink_purchase: an underpaid session ($5 for the $50 Large) grants nothing and goes to review"],
    ["inkAmountUnchecked", checkInkPurchases, "grant_ink_purchase: a session in another currency goes to review"],
    ["inkReviewsReadable", checkInkTables, "ink_checkout_reviews: A cannot read the review queue"],
    ["inkReviewsReadable", checkInkPurchases, "ink_checkout_reviews: B cannot read even their own review"],
    ["inkPurchaseRpcOpen", checkInkTables, "record_ink_checkout_review: A cannot call it"],
    ["inkPurchaseRpcOpen", checkInkTables, "resolve_ink_checkout_review: A cannot call it"],
    ["inkLedgerDeletable", checkInkPurchases, "ink_grants: even the service role cannot delete a grant (delete guard, 42501)"],
    ["inkLedgerDeletable", checkInkPurchases, "usage_events: even the service role cannot delete usage outside a refund (delete guard)"],
    ["inkLedgerDeletable", checkInkPurchases, "ink: A's balance and ledger unchanged by the denied deletes"],
    ["anonRpc", checkInkPurchases, "ink_summary: anon cannot call it"],
    ["anonRpc", checkInkPurchases, "grant_ink_purchase: anon cannot call it"],
  ];

  it.each(cases)("leak %s makes '%s' fail", async (leak, check, failingName) => {
    const results = await check(makeWorld([leak]).ctx);
    expect(failures(results)).toContain(failingName);
  });

  it("delete_own_account check fails loudly when the context cannot provision a user", async () => {
    const { ctx } = makeWorld();
    const results = await checkDeleteOwnAccount({ anon: ctx.anon, a: ctx.a, b: ctx.b });
    expect(failures(results)).toEqual(["delete_own_account: context provides newUser()"]);
  });

  it("refund check fails when refund_ink_for reports the ink but does not restore remaining", async () => {
    const { ctx } = makeWorld();
    const service = ctx.service!;
    const real = service.rest;
    service.rest = async (method, table, opts) => {
      const res = await real(method, table, opts);
      if (table === "rpc/refund_ink_for" && res.status === 200) {
        return { status: 200, body: { ...(res.body as Row), remaining: 0 } };
      }
      return res;
    };
    const results = await checkRefunds(ctx);
    expect(failures(results)).toContain("refund_ink_for: the service role refunds A's request (refunded 5, remaining restored)");
    expect(failures(results)).toContain("refund_ink_for: refunding the same request again refunds 0");
  });

  it("refund check fails when a user's refund call is answered 200 with nothing refunded (it must be denied outright)", async () => {
    const { ctx } = makeWorld();
    const real = ctx.a.rest;
    ctx.a.rest = async (method, table, opts) => {
      if (table === "rpc/refund_credits") return { status: 200, body: { refunded: 0, remaining: 0 } };
      return real(method, table, opts);
    };
    const results = await checkRefunds(ctx);
    expect(failures(results)).toEqual(["refund_credits: A cannot refund own request (users have no refunds)"]);
  });

  it("rate limit check fails when the backend is not 'db' or remaining does not count down", async () => {
    const { ctx } = makeWorld();
    const real = ctx.a.rest;
    ctx.a.rest = async (method, table, opts) => {
      const res = await real(method, table, opts);
      if (table === "rpc/rate_limit_hit" && res.status === 200) {
        return { status: 200, body: { ...(res.body as Row), backend: "memory" } };
      }
      return res;
    };
    const results = await checkRateLimit(ctx);
    expect(failures(results)).toContain("rate_limit_hit: first 3 hits allowed with remaining 2..0 (backend 'db')");
    expect(failures(results)).toContain("rate_limit_hit: next hit denied with retry_after_ms in (0, window]");
  });

  it("credits check fails when consume_credits does not decrement remaining", async () => {
    const { ctx } = makeWorld();
    const real = ctx.a.rest;
    ctx.a.rest = async (method, table, opts) => {
      const res = await real(method, table, opts);
      if (table === "rpc/consume_credits" && res.status === 200 && (res.body as Row)?.ok === true) {
        return { status: 200, body: { ...(res.body as Row), remaining: 999999 } };
      }
      return res;
    };
    const results = await checkCreditsConsumption(ctx);
    expect(failures(results)).toContain("consume_credits: A spends 2 units (ok:true, remaining decremented)");
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

  it("isCreditSummary requires every key and consistent arithmetic", () => {
    const good = {
      plan_id: "free",
      plan_name: "Free",
      monthly_credits: 300,
      used: 10,
      granted: 5,
      remaining: 295,
      period_start: "2026-09-01T00:00:00+00:00",
      period_end: "2026-10-01T00:00:00+00:00",
    };
    expect(CREDIT_SUMMARY_KEYS).toHaveLength(8);
    expect(isCreditSummary(good)).toBe(true);
    expect(isCreditSummary({ ...good, used: 400, remaining: 0 })).toBe(true); // clamped at 0
    expect(isCreditSummary({ ...good, remaining: 296 })).toBe(false);
    expect(isCreditSummary({ ...good, used: "10" })).toBe(false);
    const missing: Partial<typeof good> = { ...good };
    delete missing.granted;
    expect(isCreditSummary(missing)).toBe(false);
    expect(isCreditSummary([good])).toBe(false);
    expect(isCreditSummary(null)).toBe(false);
  });

  it("isInkSummary requires every key, whole non-negative numbers and used = granted - balance", () => {
    const good = { balance: 250, granted: 300, purchased: 0, refunded: 0, used: 50, starter: 300, starter_at: "2026-10-02T00:00:00+00:00", purchases: 0, last_purchase: null };
    expect(INK_SUMMARY_KEYS).toHaveLength(9);
    expect(isInkSummary(good)).toBe(true);
    expect(isInkSummary({ ...good, used: 49 })).toBe(false);
    expect(isInkSummary({ ...good, balance: -1, used: 301 })).toBe(false);
    expect(isInkSummary({ ...good, balance: "250" })).toBe(false);
    expect(isInkSummary({ ...good, last_purchase: { pack_id: "small" } })).toBe(true);
    const missing: Partial<typeof good> = { ...good };
    delete missing.starter;
    expect(isInkSummary(missing)).toBe(false);
    expect(isInkSummary(null)).toBe(false);
  });

  it("isRateLimitResult ties retry_after_ms to `allowed` and the window", () => {
    expect(RATE_LIMIT_KEYS).toEqual(["allowed", "remaining", "retry_after_ms", "backend"]);
    const ok = { allowed: true, remaining: 2, retry_after_ms: 0, backend: "db" };
    const denied = { allowed: false, remaining: 0, retry_after_ms: 1500, backend: "db" };
    expect(isRateLimitResult(ok, 60_000)).toBe(true);
    expect(isRateLimitResult(denied, 60_000)).toBe(true);
    expect(isRateLimitResult(denied, 1_000)).toBe(false); // retry beyond the window
    expect(isRateLimitResult({ ...denied, retry_after_ms: 0 }, 60_000)).toBe(false);
    expect(isRateLimitResult({ ...denied, remaining: 1 }, 60_000)).toBe(false);
    expect(isRateLimitResult({ ...ok, retry_after_ms: 5 }, 60_000)).toBe(false);
    expect(isRateLimitResult({ ...ok, backend: "memory" }, 60_000)).toBe(false);
    expect(isRateLimitResult({ ...ok, remaining: "2" }, 60_000)).toBe(false);
    expect(isRateLimitResult({ ...ok, remaining: -1 }, 60_000)).toBe(false);
    const missing: Partial<typeof ok> = { ...ok };
    delete missing.backend;
    expect(isRateLimitResult(missing, 60_000)).toBe(false);
    expect(isRateLimitResult([ok], 60_000)).toBe(false);
    expect(isRateLimitResult(null, 60_000)).toBe(false);
  });

  it("isUsageByDay wants an array of { day: YYYY-MM-DD, route, events > 0, credits } rows", () => {
    const row = { day: "2026-09-27", route: "live/recognize", events: 3, credits: 3 };
    expect(isUsageByDay([])).toBe(true);
    expect(isUsageByDay([row])).toBe(true);
    expect(isUsageByDay(row)).toBe(false);
    expect(isUsageByDay([{ ...row, day: "2026-09-27T00:00:00Z" }])).toBe(false);
    expect(isUsageByDay([{ ...row, events: 0 }])).toBe(false);
    expect(isUsageByDay([{ ...row, credits: "3" }])).toBe(false);
    expect(isUsageByDay(null)).toBe(false);
  });

  it("rpc posts to /rest/v1/rpc/<fn> with the arguments as the body", async () => {
    const calls: Array<{ method: string; table: string; opts?: RestOptions }> = [];
    const client: RlsClient = {
      userId: "u",
      rest: async (method, table, opts) => {
        calls.push({ method, table, opts });
        return { status: 200, body: { ok: true } };
      },
      upload: async () => ({ status: 200, body: null }),
      publicRead: async () => ({ status: 200, body: null }),
      storageDelete: async () => ({ status: 200, body: null }),
    };
    await rpc(client, "consume_credits", { p_route: "x", p_units: 1 });
    await rpc(client, "credit_summary");
    expect(calls[0]).toEqual({ method: "POST", table: "rpc/consume_credits", opts: { body: { p_route: "x", p_units: 1 } } });
    expect(calls[1]).toEqual({ method: "POST", table: "rpc/credit_summary", opts: { body: {} } });
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
