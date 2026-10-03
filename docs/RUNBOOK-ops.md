# Runbook: errors, uptime and releases

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
