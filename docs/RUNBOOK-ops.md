# Runbook: errors, uptime, releases and email

Where a crash shows up, how to know the site is up, and how to tell which commit is live. No third-party service is involved: everything below lands in Vercel's runtime logs as one JSON line per event (pino), and `/api/health` is a plain endpoint any uptime monitor can poll. Design: `docs/ARCHITECTURE.md` (routes table, "Security model").

## 1. What gets logged

| `module` | Written by | When | Fields |
| --- | --- | --- | --- |
| `client-error` | `POST /api/client-errors` (`src/app/api/client-errors/route.ts`) | A student's browser hit an uncaught error, an unhandled promise rejection, or an error boundary (`error.tsx`, `global-error.tsx`, the board's `LiveErrorBoundary`), or the board showed a student an error (`source: live`) | `source` (`error`, `rejection`, `boundary`, `global`, `live`), `kind` and `code` when the client named them (`live.solve`, `timeout`), `message`, `stack` (~4 KB), `path` (never a query string or hash), `boardId` on a board, `release`, `digest` (boundaries), `userAgent`, `userId` when signed in. Level `error`. |
| `app-events` | `src/lib/server/events.ts` | An app event could not be written to `app_events` (at most one line a minute per instance, with how many more failed), an invalid event was dropped, or events were dropped past the per-instance budget (`dropped`) | `status`, `error`, `kind`; `suppressed`. Level `warn`. Section 7. |
| `server-error` | `onRequestError` in `src/instrumentation.ts` | The Next server caught an error nothing else handled: a server component that threw, a route handler's uncaught error, a server action | `route` (the route file, e.g. `/board/[id]`), `routeType` (`render`, `route`, `action`, `proxy`), `method`, `path` (no query string), `digest`, `name`, `error`, `stack`, `release`. Level `error`. Never the request body or headers. |
| `health` | `GET /api/health` | The database did not answer the health probe | `reason` (`timeout`, `status 503 PGRST001`, `network: …`), `ms`, `release`. Level `warn`. |

Route handlers that map their own errors (`errorResponse` in `src/lib/server/request.ts`, the Live routes) keep logging under their own modules (`live`, `storage-gc`, …) as before; each 5xx they answer, each model fallback or failure and each Mathpix failure is also an app event for `/admin` (section 7).

What the browser sends is deliberately thin: per page load each distinct error once, at most 10, and nothing from ResizeObserver loops, aborted fetches, "Script error.", tldraw's "No active pointer" or browser extensions (`src/lib/clientErrors.ts`). The endpoint is rate limited per IP (20 a minute), so a crash loop cannot flood the logs. No board content and nothing the student typed is sent, but an error *message* can quote anything the code put in it; treat the lines as personal data (they carry a user id).

## 2. Finding them

**Dashboard.** Vercel → the project → **Logs** (runtime logs), environment Production. Search `client-error` or `server-error`, or a digest. The level filter *Error* shows both.

**CLI** (from a checkout linked with `vercel link`; `vercel logs -h` lists every flag):

```sh
# browser crashes in production, last 24 hours, full lines
vercel logs --environment production --since 24h --query "client-error" --expand

# unhandled server errors
vercel logs --environment production --since 24h --query "server-error" --expand

# everything at error level, as JSON Lines for jq
vercel logs --environment production --since 6h --level error --json

# live, while reproducing something
vercel logs --environment production --follow
```

**From a student's report.** The error page shows "Reference: 1234567890" for a server-rendered crash. That is the `digest`: search for it, and both the `server-error` line (with the server stack) and the student's `client-error` line (`source: boundary`, with the path and user id) come up.

**From a user.** Search their user id (Supabase → Authentication → Users) to see every crash they hit.

**Retention.** Vercel keeps runtime logs only briefly (about an hour on Hobby and a day on Pro when this was written; check *Settings → Observability* for the current plan). To keep history, add a **Log Drain** (Pro: *Settings → Log Drains*) to a log store, or look at the logs the same day. Locally, `npm run dev` pretty-prints the same lines (`pino-pretty`); `npm run dev:raw` shows the raw JSON.

## 3. Uptime monitor on /api/health

`GET /api/health` answers:

- `200 {"ok":true,"db":"up","release":"abc1234"}` when Postgres answered a trivial query (one PostgREST read with the anon key) within 3 s;
- `503 {"ok":false,"db":"down","release":"abc1234"}` otherwise: Supabase unreachable, the project paused (the free plan pauses after a stretch without activity), PostgREST unable to reach Postgres, or the deployment's Supabase env missing. A `health` warn line says which.

It is public, `Cache-Control: no-store`, and rate limited to 30 requests a minute per IP.

Set up a monitor (UptimeRobot, Better Stack, Checkly or similar; any free HTTP check works):

1. URL `https://whiteboard.rushilchopra.com/api/health`, method GET, every 1 to 5 minutes.
2. Alert when the status is not 200 (optionally also when the body lacks `"db":"up"`), after 2 failures in a row so one slow cold start does not page you.
3. Send alerts to email or a phone push, not only to a dashboard.

When it fires: open `/api/health` in a browser. `db: "down"` with Supabase's dashboard showing the project **paused** → *Restore project* there (a few minutes), then consider the Pro plan, which does not pause. Otherwise check status.supabase.com, the `health` warn line's `reason`, and that the Production env still has `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`npm run env:check`).

## 4. Releases: which commit is live, which commit crashed

Every build names itself: `next.config.ts` sets `NEXT_PUBLIC_RELEASE` to the first 7 characters of `VERCEL_GIT_COMMIT_SHA` (the commit Vercel built, as the dashboard and GitHub show it), or the local git HEAD for a local build. It is inlined into both the server and the browser code, so:

- `curl -s https://whiteboard.rushilchopra.com/api/health` tells you the release that is live now;
- every `client-error`, `server-error` and `health` line carries `release`, so a crash points at a commit: `git show <release>`, or find the deployment in Vercel → Deployments by its commit.

A `client-error` with an older `release` than the live one comes from a tab opened before the last deploy. Releases can be pinned by hand with `NEXT_PUBLIC_RELEASE` (e.g. `NEXT_PUBLIC_RELEASE=v1.2.0`); leave it unset normally.

## 5. Checks after a deploy

1. `curl -s https://whiteboard.rushilchopra.com/api/health` → `200`, `"db":"up"`, and the `release` you just shipped.
2. `vercel logs --environment production --since 15m --level error --expand` → nothing new, or only what you expect.
3. Over the next day, a look at `client-error` lines for the new `release`.

## 6. Email

Agathon sends two transactional emails through [Resend](https://resend.com), from `Agathon <hello@mail.agathon.app>` (`EMAIL_FROM`; the domain `mail.agathon.app` is verified in Resend). Code: `src/lib/email/` (templates, the Resend client, the log). Password-reset and other auth emails are Supabase's own, sent through Resend SMTP; they are configured in the Supabase dashboard, not here.

| Email | Sent by | When | To |
| --- | --- | --- | --- |
| Welcome (`kind = 'welcome'`, `ref = ''`) | `POST /api/email/welcome`, which the app calls at the end of the guided first board (`sendWelcomeEmail` in `src/lib/email/client.ts`) | Once per account, only when `profiles.onboarded_at` is set and less than 7 days old | The account's own address (Supabase Auth); the request has no body |
| Free week ending (`kind = 'trial_reminder'`, `ref = <Stripe subscription id>`) | `GET /api/cron/trial-reminders`, a Vercel cron (`vercel.json`, `0 15 * * *`, i.e. 15:00 UTC, within the hour on Hobby) | Once per Agathon Unlimited subscription that is `trialing` with `trial_end` 24 to 72 hours away, so 2 to 3 days before the first charge; not when it is set to cancel by then, or has no user | The subscribing account's address (`auth.admin.getUserById`) |

**The log.** `public.email_log` (migration `20261003030000_email_log.sql`; service role only, no user can read or write it) has one row per email: `user_id, kind, ref, resend_id, claimed_at, sent_at`, unique on `(user_id, kind, ref)`. The server claims the row first, sends, then stores Resend's id; a failed send deletes its claim so the next attempt retries. A row with `sent_at` null is a claim whose send was never recorded (the function died in between): it counts as sent and is not retried by itself. Each send also carries a Resend `Idempotency-Key` (`welcome/<user id>`, `trial-reminder/<subscription>/<trial end>`), so a retry within 24 hours cannot send twice.

```sql
-- what went out lately
select kind, ref, user_id, resend_id, claimed_at, sent_at from public.email_log order by claimed_at desc limit 50;
-- claims that never got an id (look the address up in Resend before resending)
select * from public.email_log where sent_at is null and claimed_at < now() - interval '10 minutes';
```

**Logs.** Module `email`: `welcome email sent` / `welcome email not sent`, `trial reminder sent` / `trial reminder not sent; ...`, and one `trial reminders summary` per cron run with `found, due, alreadySent, sent, failed, skipped, deferred`. A run sends at most 50 (spaced for Resend's 2 requests a second); the rest go the next day, still inside the window.

**Checking the cron by hand** (production, needs `CRON_SECRET`):

```bash
# what it would send now, sending nothing
curl -sS -H "Authorization: Bearer $CRON_SECRET" "https://whiteboard.rushilchopra.com/api/cron/trial-reminders?dryRun=1" | jq
# a real run: safe to repeat, every reminder goes at most once
curl -sS -H "Authorization: Bearer $CRON_SECRET" https://whiteboard.rushilchopra.com/api/cron/trial-reminders | jq
```

**Resending.** Delete the email's row, then trigger it again. A trial reminder: `delete from public.email_log where kind = 'trial_reminder' and ref = 'sub_...';`, then the next daily run (or the `curl` above) sends it while the trial is still 24 hours or more away. A welcome is only asked for at the end of the tour: deleting its row (`... where kind = 'welcome' and user_id = '<uuid>'`) lets the next request send it, but nothing in the app asks again by itself, and there is no operator command for it (a missed welcome is not worth one). Within 24 hours of the first send Resend answers a repeat with the same `Idempotency-Key` with the first email instead of a new one.

**Testing a send** without emailing anyone: use Resend's test inbox `delivered@resend.dev` (also `bounced@resend.dev`, `complained@resend.dev`), then `curl -sS -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/emails/<id> | jq .last_event` shows `"delivered"`.

**Going live.**
1. Apply `supabase/migrations/20261003030000_email_log.sql` to production (before or with the deploy; without the table the routes answer 500 and send nothing). Then `node scripts/verify-rls.mjs` against production: the `email_log` checks must pass.
2. Set the variables in Vercel Production: `RESEND_API_KEY` (sensitive), `EMAIL_FROM` (optional), `NEXT_PUBLIC_BILLING_PORTAL_URL` (the Stripe customer portal login link; without it the reminder links `/account`). `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are already there.
   ```bash
   printf '%s' "$(cat ~/.config/agathon-classroom/resend-api-key)" | vercel env add RESEND_API_KEY production --sensitive
   printf '%s' 'Agathon <hello@mail.agathon.app>' | vercel env add EMAIL_FROM production
   ```
3. Deploy. In Vercel → Settings → Cron Jobs, `/api/cron/trial-reminders` is listed next to `/api/admin/gc`. Run the dry run above once.
4. Ship the app change that calls `sendWelcomeEmail()` after the tour saves `onboarded_at`.

Without `RESEND_API_KEY` (local development, previews) nothing is sent and nothing breaks: the welcome route answers `503 feature_unavailable`, the cron too (except `?dryRun=1`), and `sendEmail` returns `{ ok: false, error: "not configured" }` with one log line.

## 7. Admin: the error log and who may see it

`/admin` shows what students saw go wrong and whether each service is up (design: `docs/ARCHITECTURE.md`, "Admin"). Its data is in four service-role-only tables (migration `supabase/migrations/20261005000000_admin.sql`): `admins`, `app_events`, `health_checks`, `alert_state`. Unlike the log lines above, app events stay 30 days (health checks 14), whatever the Vercel plan keeps.

**Making the owner an admin.** The migration names nobody; once per project, after the account has signed up:

```bash
# local stack (no .env.local, or one pointing at it)
node scripts/make-admin.mjs rushilchopra@gmail.com

# production: the URL and service role key on the command line win over .env.local
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> \
  node scripts/make-admin.mjs rushilchopra@gmail.com
```

It prints the project it acts on first (`(local)` or `(NOT local)`), finds the account by email in Supabase Auth, and adds the row; repeating it changes nothing. `--remove` takes admin away. Each server instance remembers the answer for 60 s, so a change takes up to a minute. Anyone else who opens an admin route gets a 404 (a `warn` line, module `admin`, `admin route refused: not an admin`).

**What is in app_events.** One row per event: `client.*` (a browser crash), `live.*` (an error a student saw on the board), `route.*` (a route answered 5xx), `model.*` (a model fell back, code `fallback`, level `warn`, or failed: `timeout`, `upstream`, `invalid`, `credits`), `mathpix`, `health.*`. Repeats of the same event for the same user within 30 s are written once, and each server instance writes at most 60 a minute, so counts under a flood are a floor, not exact. Straight from the database (SQL editor):

```sql
-- the last hour, newest first
select at, source, level, kind, code, message, route, user_id, request_id from public.app_events
 where at > now() - interval '1 hour' order by at desc limit 100;
-- what students hit most today, and how many of them
select kind, code, message, count(*), count(distinct user_id) as users from public.app_events
 where level = 'error' and at > now() - interval '24 hours' group by 1, 2, 3 order by 4 desc limit 30;
-- one student's errors (their id: Authentication -> Users)
select at, kind, code, message, route, board_id from public.app_events where user_id = '<uuid>' order by at desc limit 50;
-- the model fallbacks: which primary keeps failing
select meta->>'primary' as primary, meta->>'reason' as why, count(*) from public.app_events
 where code = 'fallback' and at > now() - interval '24 hours' group by 1, 2 order by 3 desc;
```

A `request_id` finds the same request's log lines in Vercel (search it), and the event's `release` the commit.

**When nothing is recorded.** Events need `SUPABASE_SERVICE_ROLE_KEY` on the deployment (without it the writer does nothing, silently) and the migration applied (without the table every write fails: an `app-events` warn line, `app event not recorded`, `status: 404` and `42P01`). Recording never slows or breaks a response either way. Check with `npm run env:check`, and apply the migration with `npx supabase db push` (then `npm run db:verify`: the `admin:` checks must pass).

**Retention.** `prune_admin_rows()` (service role) deletes events older than 30 days and checks older than 14; the health run calls it. By hand: `select public.prune_admin_rows();`.

## Health checks and alerts

Every 5 minutes the Supabase project's own scheduler (pg_cron, through pg_net) calls `GET /api/admin/health` with `Authorization: Bearer <CRON_SECRET>`. Vercel's plan allows only daily crons, so the schedule lives in the database. The route checks every service Agathon depends on, keeps the results, and emails the owner when something is down or students are hitting errors. Code: `src/app/api/admin/health/route.ts`, `src/lib/server/health/` (checks, alerts, tables), `src/lib/email/alerts.ts` (the emails), `scripts/schedule-health.mjs` (the schedule). Rules: `ALERT_RULES` in `src/lib/admin/contracts.ts`.

### What is checked

All six run in parallel, each with its own 8-second limit. None costs money or calls a model.

| Service | What it asks | Fails when |
| --- | --- | --- |
| `app` | `GET <NEXT_PUBLIC_SITE_URL>/api/health` (the public URL) | Anything but `200 {"ok":true}`. A `503 {"db":"down"}` also fails, but while the database check fails too it does not alert separately (one outage, one email). |
| `database` | `profiles?select=user_id&limit=1` with the service role | PostgREST errors, times out or is unreachable. |
| `openrouter` | `GET https://openrouter.ai/api/v1/key` (free; the key's own limit) and `GET /api/v1/credits` (the account balance; OpenRouter documents it as management-key only, so a refusal just means "unknown") | The key is rejected, OpenRouter errors, or credit left is $0 or less. `detail` is `$12.40 credit left` (the lower of the two known values). |
| `mathpix` | `POST https://api.mathpix.com/v3/app-tokens` with `{"expires":30}`: mints a short-lived token, which Mathpix documents as "free of charge"; no ink is read and no strokes session is opened | The keys are rejected (401/403) or Mathpix errors. |
| `email` | `GET https://api.resend.com/domains` with `RESEND_API_KEY` | The key is rejected, or the domain of `EMAIL_FROM` (`mail.agathon.app`) is missing or not `verified`. A sending-only key (401 `restricted_api_key`) passes: it proves the key works, but the domain is not checked. |
| `stripe` | `STRIPE_WEBHOOK_SECRET` is set; `billing_events` (the latest) and `app_events` at level error naming the webhook in the last 30 minutes | The secret is unset, or a webhook failure was recorded in the last 30 minutes. No events at all is **not** a failure (a quiet day has no purchases); `detail` says when the last one came. Stripe itself emails the account when an endpoint keeps failing. |

Each run writes one `health_checks` row per service (kept 14 days) and, for each failure, an `app_events` row with `source = 'health'`, `kind = 'health.<service>'`, a `code` (`timeout`, `network`, `unauthorized`, `upstream`, `unconfigured`, `unverified`, `out_of_credit`, `failures`, …) and the detail as `message`. The `/admin` page reads both. Once a day, in the run between 08:00 and 08:05 UTC, it calls `prune_admin_rows()` to apply the retention (`RETENTION_DAYS`).

An admin's **Check now** on `/admin` calls the same route with their own token. It runs the checks, writes the rows and records the events, but never decides an alert: the down rule counts failures 5 minutes apart, and two clicks must not page anyone. The next scheduled run (at most 5 minutes later) judges the alerts.

### When an email goes out

To `ALERT_EMAIL` (one address), from `EMAIL_FROM` through Resend. The state of each alert lives in `alert_state` (`down:<service>`, `spike:errors`, `credits:openrouter`).

| Alert | Fires | Repeats | Ends |
| --- | --- | --- | --- |
| Service down | 2 failed checks in a row (`downAfterFailures`): "Mathpix is down: keys rejected (401)" | "Mathpix is still down (1 h 5 min): …" every 60 minutes (`repeatAfterMin`) | "Mathpix is back up (down 12 min)" on the first passing check, only if the owner was told it was down |
| Error spike | At least 10 errors (`level = 'error'`, source `live`, `client` or `server`) from at least 3 distinct users in the last 15 minutes: "Errors spiking: 42 in 15 min from 7 people", with the top 3 groups (kind, code, message, count) | Every 60 minutes while it lasts | "Errors are back to normal (spike lasted 35 min)" |
| Low OpenRouter credit | Credit left under $5 (`lowCreditsUsd`): "OpenRouter credit is low: $4.20 left", with the top-up link | Never: once per episode | Re-arms silently when credit is back at $5 or more (at $0 the OpenRouter check fails, and the down alert takes over) |

Every email links `/admin`. Throttle: a firing email (down, still down, spike, low credit) goes at most once per 60 minutes per alert, even across a quick recovery and relapse. A firing email that could not be sent (no `ALERT_EMAIL`, no `RESEND_API_KEY`, Resend refused) is retried on the next run. Each send carries a Resend `Idempotency-Key` (`alert/<key>/<down|still|spike|up|over|low|stateless>/<hour bucket or episode start>`), so if `alert_state` cannot be saved after a send, the next run's identical decision does not email twice.

If `alert_state` cannot be read at all and the database check failed, one "The database is down" email goes out per hour without the two-in-a-row rule (nothing else is decided that run).

Logs (module `admin-health`): one `health checks summary` line per run (`trigger`, `failing`, `alerts.firing/sent/skipped/failed`), `alert sent` / `alert not sent`, and `ALERT_EMAIL is not set: alert not sent` when unconfigured.

### Going live

1. Apply the admin migration (`20261005000000_admin.sql`: `health_checks`, `alert_state`, `app_events`, `prune_admin_rows()`).
2. Vercel Production: add `ALERT_EMAIL` (`printf '%s' 'rushil.chopra@alpha.school' | vercel env add ALERT_EMAIL production`). `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `MATHPIX_APP_ID`/`MATHPIX_APP_KEY` and `NEXT_PUBLIC_SITE_URL` are already there. Deploy.
3. Run it once by hand (it answers the six results; it may email if something is already down twice):
   ```bash
   curl -sS -H "Authorization: Bearer $CRON_SECRET" https://whiteboard.rushilchopra.com/api/admin/health | jq
   ```
4. Schedule it. The script needs the Management API token (`SUPABASE_ACCESS_TOKEN`, or the macOS keychain item "Supabase CLI" from `npx supabase login`) and the same `CRON_SECRET` as Vercel. `vercel env pull` writes sensitive values as empty strings, so take the secret from where it was made, or rotate it (below).
   ```bash
   # what it will run, secret redacted, nothing sent
   CRON_SECRET=... node scripts/schedule-health.mjs --ref sgolkponjdkphndosrea --site https://whiteboard.rushilchopra.com --dry-run
   # do it: enables pg_cron and pg_net, stores the secret in Vault, (re)schedules agathon-health
   CRON_SECRET=... node scripts/schedule-health.mjs --ref sgolkponjdkphndosrea --site https://whiteboard.rushilchopra.com
   ```
   It is idempotent: run it again after changing the site or the secret. The secret goes into Supabase Vault (`agathon_cron_secret`), never into the job's command (which `cron.job` stores in plain text); the job reads it from `vault.decrypted_secrets` at each run. `--env-file <file>` reads `KEY=VALUE` lines first; `--secret` works too but lands in shell history.

**Is it running?** In the Supabase SQL editor:

```sql
-- the job
select jobid, schedule, active from cron.job where jobname = 'agathon-health';
-- its last runs (did pg_cron fire the request?)
select status, return_message, start_time from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'agathon-health') order by start_time desc limit 10;
-- the route's answers (pg_net keeps them 6 hours): 200 is good; 401 means the Vault secret and Vercel's CRON_SECRET differ
select id, status_code, timed_out, error_msg, left(content, 200), created from net._http_response order by id desc limit 10;
-- the results themselves
select at, service, ok, latency_ms, detail from public.health_checks order by at desc limit 12;
select key, status, since, last_sent_at, failures from public.alert_state order by key;
```

**Rotating `CRON_SECRET`.** Set the new value in Vercel (it is shared with the GC and trial-reminder crons), redeploy, then run the script again with the new value: it updates the Vault secret in place. Between the deploy and the script, the scheduled calls answer 401 (no alert is lost for more than those minutes).

**Snoozing.** To silence an alert for an hour: `update public.alert_state set last_sent_at = now() where key = 'down:mathpix';`. To stop all alert email, remove `ALERT_EMAIL` from Vercel (the checks keep running and logging). To stop the checks: `node scripts/schedule-health.mjs --ref sgolkponjdkphndosrea --unschedule` (the Vault secret stays).

**Limits.** pg_cron runs inside the database: if the project is paused or Postgres is down, nothing calls the route and no alert goes out. The external uptime monitor on `/api/health` (section 3) is what catches that. The database alert covers the cases pg_cron survives: PostgREST or the pooler failing while Postgres runs. The Mathpix and Resend checks prove the keys and the service answer, not that every request succeeds; the error-spike alert covers what students actually hit.
