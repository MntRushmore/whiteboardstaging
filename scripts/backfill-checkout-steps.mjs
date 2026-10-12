#!/usr/bin/env node
/**
 * One-time back-fill of the funnel's `checkout_opened` step from Stripe (2026-10-12). The app
 * records the step itself since the funnel steps shipped (src/lib/funnel/record.ts); the checkouts
 * opened before that exist only in Stripe, as Checkout Sessions of the plan's Payment Links, each
 * with the account's checkout reference as `client_reference_id` (`profiles.checkout_ref`).
 *
 * This reads those sessions from files and prints ONE idempotent SQL statement that gives each
 * account whose checkout reference opened a checkout a `checkout_opened` row in `funnel_steps`:
 * first_at its earliest session, last_at its latest, times how many, meta {"source":"stripe"}
 * (which admin_funnel()'s "tracking since" leaves out). An account that already has the row keeps
 * its meta and gets the wider of the two: the earlier first_at, the later last_at, the larger
 * times (never the sum: a session after the app began recording is in both). The SQL joins the
 * references to `profiles` itself, so this needs no database credentials and prints nothing about
 * anyone but the opaque references and the times.
 *
 * Usage
 *   1. Every Checkout Session of each Payment Link (the monthly one and the referral one; their
 *      plink_… ids from `stripe payment_links list --live`), 100 a page, into files. A page whose
 *      answer says "has_more": true goes on after its last session's id:
 *
 *        stripe checkout sessions list --live --limit 100 --payment-link plink_… > sessions-1.json
 *        stripe checkout sessions list --live --limit 100 --payment-link plink_… --starting-after cs_live_… > sessions-2.json
 *
 *   2. The SQL (what was read goes to stderr, the statement to stdout):
 *
 *        node scripts/backfill-checkout-steps.mjs sessions-*.json > backfill-checkout-steps.sql
 *
 *   3. Run it on the project through the Management API (it runs as postgres), with a personal
 *      access token in SUPABASE_ACCESS_TOKEN (the `sbp_…` one `npx supabase login` keeps in the
 *      macOS keychain as "Supabase CLI" will do, as for scripts/schedule-health.mjs):
 *
 *        jq -Rs '{query: .}' backfill-checkout-steps.sql | curl -sS -X POST \
 *          "https://api.supabase.com/v1/projects/<project-ref>/database/query" \
 *          -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @-
 *
 *      It answers how many accounts got a new row (`inserted`) and how many had one already,
 *      widened where Stripe saw more (`existing`). Running it again changes nothing.
 *
 * A session listed twice (overlapping pages) counts once; one without a uuid client_reference_id
 * (a link opened outside the app) is skipped. Exit codes: 0 printed, 1 nothing to back-fill, 2 usage
 * or an unreadable file.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const USAGE = "usage: node scripts/backfill-checkout-steps.mjs <sessions.json> [more.json …] > backfill.sql";

/** The meta of every back-filled row: admin_funnel() tells these apart by it. */
export const BACKFILL_META = '{"source":"stripe"}';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The table's cap on `times` (funnel_steps_times_range). */
const MAX_TIMES = 10_000;

/**
 * The sessions in one `stripe checkout sessions list` answer: its `data` (a bare list is taken
 * too); nothing for anything else.
 * @param {unknown} json
 * @returns {unknown[]}
 */
export function sessionsOf(json) {
  if (Array.isArray(json)) return json;
  const data = json && typeof json === "object" ? /** @type {{ data?: unknown }} */ (json).data : undefined;
  return Array.isArray(data) ? data : [];
}

/**
 * One row per session that names an account: its checkout reference (lower case) and when it was
 * created (ISO, UTC). A session seen twice counts once (by its id); one without a uuid
 * `client_reference_id` or a creation time is skipped.
 * @param {unknown[]} sessions
 * @returns {{ rows: Array<{ ref: string, created: string }>, skipped: number }}
 */
export function checkoutRows(sessions) {
  /** @type {Array<{ ref: string, created: string }>} */
  const rows = [];
  const seen = new Set();
  let skipped = 0;
  for (const s of sessions) {
    const session = s && typeof s === "object" ? /** @type {Record<string, unknown>} */ (s) : {};
    const id = typeof session.id === "string" ? session.id : null;
    if (id !== null && seen.has(id)) continue;
    if (id !== null) seen.add(id);
    const ref = typeof session.client_reference_id === "string" ? session.client_reference_id.trim().toLowerCase() : "";
    const created = typeof session.created === "number" && Number.isFinite(session.created) && session.created > 0 ? new Date(session.created * 1000) : null;
    if (!UUID_RE.test(ref) || !created || Number.isNaN(created.getTime())) {
      skipped += 1;
      continue;
    }
    rows.push({ ref, created: created.toISOString() });
  }
  return { rows, skipped };
}

/**
 * The back-fill as one statement, or null with no rows. Safe to run again (see the file's top).
 * Every value in it is a checked uuid or an ISO time, so nothing in it needs quoting beyond the
 * literal's own quotes.
 * @param {Array<{ ref: string, created: string }>} rows
 * @returns {string | null}
 */
export function backfillSql(rows) {
  const valid = rows.filter((r) => UUID_RE.test(r.ref) && !Number.isNaN(Date.parse(r.created)));
  if (valid.length === 0) return null;
  const refs = new Set(valid.map((r) => r.ref.toLowerCase())).size;
  const values = valid.map((r) => `    ('${r.ref.toLowerCase()}'::uuid, '${new Date(r.created).toISOString()}'::timestamptz)`).join(",\n");
  return `-- funnel_steps: checkout_opened back-filled from Stripe's Checkout Sessions (scripts/backfill-checkout-steps.mjs)
-- ${valid.length} sessions, ${refs} checkout references. Idempotent: running it again changes nothing.
with sessions (ref, created) as (
  values
${values}
),
opened as (
  select p.user_id,
         min(s.created) as first_at,
         max(s.created) as last_at,
         least(count(*), ${MAX_TIMES})::integer as times
    from sessions s
    join public.profiles p on p.checkout_ref = s.ref
   group by p.user_id
),
written as (
  insert into public.funnel_steps as f (user_id, step, first_at, last_at, times, meta)
  select o.user_id, 'checkout_opened', o.first_at, o.last_at, o.times, '${BACKFILL_META}'::jsonb
    from opened o
  on conflict (user_id, step) do update
    set first_at = least(f.first_at, excluded.first_at),
        last_at = greatest(f.last_at, excluded.last_at),
        times = greatest(f.times, excluded.times)
  returning (xmax = 0) as inserted
)
select count(*) filter (where inserted) as inserted,
       count(*) filter (where not inserted) as existing
  from written;
`;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const files = process.argv.slice(2);
  if (files.includes("--help") || files.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  if (files.length === 0 || files.some((f) => f.startsWith("-"))) {
    console.error(USAGE);
    process.exit(2);
  }
  /** @type {unknown[]} */
  const sessions = [];
  for (const file of files) {
    /** @type {unknown} */
    let json;
    try {
      json = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      console.error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }
    const page = sessionsOf(json);
    sessions.push(...page);
    const last = /** @type {{ id?: unknown } | undefined} */ (page[page.length - 1]);
    if (json && typeof json === "object" && /** @type {{ has_more?: unknown }} */ (json).has_more === true && typeof last?.id === "string") {
      console.error(`note: ${file} has more after it (--starting-after ${last.id}), unless another file is that page`);
    }
  }
  const { rows, skipped } = checkoutRows(sessions);
  const sql = backfillSql(rows);
  console.error(`${sessions.length} sessions read from ${files.length} file(s): ${rows.length} with a checkout reference, ${skipped} skipped`);
  if (!sql) {
    console.error("Nothing to back-fill.");
    process.exit(1);
  }
  process.stdout.write(sql);
}
