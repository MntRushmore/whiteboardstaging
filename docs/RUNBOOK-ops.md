# Runbook: errors, uptime, releases and email

Where a crash shows up, how to know the site is up, and how to tell which commit is live. No third-party service is involved: everything below lands in Vercel's runtime logs as one JSON line per event (pino), and `/api/health` is a plain endpoint any uptime monitor can poll. Design: `docs/ARCHITECTURE.md` (routes table, "Security model").

## 1. What gets logged

| `module` | Written by | When | Fields |
| --- | --- | --- | --- |
| `client-error` | `POST /api/client-errors` (`src/app/api/client-errors/route.ts`) | A student's browser hit an uncaught error, an unhandled promise rejection, or an error boundary (`error.tsx`, `global-error.tsx`, the board's `LiveErrorBoundary`) | `source` (`error`, `rejection`, `boundary`, `global`, `live`), `message`, `stack` (~4 KB), `path` (never a query string or hash), `boardId` on a board, `release`, `digest` (boundaries), `userAgent`, `userId` when signed in. Level `error`. |
| `server-error` | `onRequestError` in `src/instrumentation.ts` | The Next server caught an error nothing else handled: a server component that threw, a route handler's uncaught error, a server action | `route` (the route file, e.g. `/board/[id]`), `routeType` (`render`, `route`, `action`, `proxy`), `method`, `path` (no query string), `digest`, `name`, `error`, `stack`, `release`. Level `error`. Never the request body or headers. |
| `health` | `GET /api/health` | The database did not answer the health probe | `reason` (`timeout`, `status 503 PGRST001`, `network: …`), `ms`, `release`. Level `warn`. |

Route handlers that map their own errors (`errorResponse` in `src/lib/server/request.ts`, the Live routes) keep logging under their own modules (`live`, `storage-gc`, …) as before.

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
