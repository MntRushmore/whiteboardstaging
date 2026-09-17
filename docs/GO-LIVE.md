# Go-live checklist

Everything on `feat/production-hardening` builds, typechecks, lints, and passes 472 unit tests plus the route smoke script against a local Supabase stack. Three things still need a human with account access before production works.

## 1. Database (blocking)

The previous Supabase project was deleted; no cloud project exists yet, so login and saving are broken in production until one does. Follow [`RUNBOOK-supabase.md`](./RUNBOOK-supabase.md) end to end (~30 min): create the project (section 1), `npx supabase login` / `link` / `npm run db:push` (2), dashboard Auth settings that the migration cannot set (3), storage sanity (4), Vercel env vars for all three environments (5), trainer allow-list (6), and verification with `npm run db:verify` + `RUN_DB_TESTS=1 npm test` (7). Turn on backups before the first cohort (10).

## 2. Environment variables

State measured with `vercel env ls` on 2026-09-17 (saved as `src/__tests__/fixtures/vercel-env-ls.txt`). Classification comes from the `# ─── …` section headers in `.env.example`: **Required** keys must be set in every Vercel environment, everything under **Scripts and tests** must never be.

| Variable | Class | Production | Preview | Development | Notes |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | required | present (**replace**, old project deleted) | **MISSING** | **MISSING** | See step 1. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | required | present (**replace**) | **MISSING** | **MISSING** | See step 1. |
| `OPENROUTER_API_KEY` | required | present | present | present | ~$58 of credit remained on 2026-09-11. |
| `MATHPIX_APP_ID` / `MATHPIX_APP_KEY` | optional | present | present | present | Realtime handwriting recognition; verified working. |
| `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` | optional | present | present | absent | Development absent is fine (watermark only). See section 3. |
| `NEXT_PUBLIC_SITE_URL` | optional | present | absent | absent | Referer header for OpenRouter; defaults to `http://localhost:3000`. Add for Preview. |
| `OPENAI_API_KEY` | optional | absent | absent | absent | Only for the voice tutor. The key in the old `.env.local` is revoked (401). Voice returns 503 until a valid key is added. |
| `NEXT_PUBLIC_LIVE_MATH` | optional | absent = on | absent = on | absent = on | Set to `0` to hide Live Math without unregistering its shapes. |
| `LIVE_MODEL_CHECK` / `_SOLVE` / `_VISION` | optional | absent = defaults | absent = defaults | absent = defaults | OpenRouter model overrides for Live routes. |
| `LOG_LEVEL` / `NEXT_PUBLIC_LOG_LEVEL` | optional | absent = `info` | absent = `info` | absent = `info` | Server / browser pino levels. |
| `SUPABASE_SERVICE_ROLE_KEY` | optional | absent | absent | absent | Needed in **Production only** by two non-user-facing routes: `POST /api/billing/webhook` (plan changes) and the storage GC cron `GET /api/admin/gc` (both answer `503` without it). Every user-facing route acts as the user. Keep it out of Preview/Development unless you are testing those two paths. |
| `CRON_SECRET` | optional | absent | absent | absent | Bearer token Vercel sends to `/api/admin/gc` (nightly storage GC, `vercel.json` crons). Random string, >= 16 chars (`openssl rand -hex 24`). Without it the route answers `503` and the cron does nothing. Production only; runbook section 12. |
| `BASE_URL`, `SMOKE_*`, `RUN_DB_TESTS`, `VERIFY_EMAIL_DOMAIN` | scripts-only | absent | absent | absent | Correct: the checker fails if any of these appear in Vercel. |
| `MISTRAL_API_KEY` | removed | absent | absent | absent | Not in `.env.example`; OCR runs on OpenRouter now. |

Fix the four failures (each `vercel env add` takes one environment and reads the value from stdin; use the new project's values from step 1):

```bash
URL=https://<project-ref>.supabase.co
ANON=<anon or sb_publishable_ key>
for env in preview development; do
  printf '%s' "$URL"  | vercel env add NEXT_PUBLIC_SUPABASE_URL      "$env"
  printf '%s' "$ANON" | vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY "$env"
done
# Production: replace the values that point at the deleted project
vercel env rm NEXT_PUBLIC_SUPABASE_URL production -y      && printf '%s' "$URL"  | vercel env add NEXT_PUBLIC_SUPABASE_URL      production
vercel env rm NEXT_PUBLIC_SUPABASE_ANON_KEY production -y && printf '%s' "$ANON" | vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
# Optional but recommended for Preview (Referer sent to OpenRouter):
printf '%s' "https://staging.whiteboard.rushilchopra.com" | vercel env add NEXT_PUBLIC_SITE_URL preview
```

Verify with `npm run env:check` (runs `node scripts/check-vercel-env.mjs`, which calls the read-only `vercel env ls` and compares it with `.env.example`). It exits 0 only when every required key is set in all three environments, no scripts-only key is deployed, and every Vercel key is documented. Current output ends with `FAILED: 4 failure(s)` (the two Supabase keys in Preview and Development); `--env Production` passes today. Use `--json` for machine output and `--from <saved vercel env ls output>` offline. Redeploy after changing env vars: existing deployments keep their old values.

Full per-variable notes: `.env.example` (kept in sync with the code by `src/__tests__/envExample.test.ts`; its section headers drive `scripts/check-vercel-env.mjs`, tested by `src/__tests__/checkVercelEnv.test.ts`).

## 3. tldraw license hosts

The license key covers `*.whiteboard.rushilchopra.com`, `*.agathon.app`, and an old `*.whiteboard-delta-wine.vercel.app`. It does **not** cover this project's `whiteboardstaging-*.vercel.app` preview URLs, so tldraw hides the editor there after a few seconds. Pick one:

- Add `whiteboardstaging-*.vercel.app` (or `*.vercel.app`) to the license at <https://tldraw.dev/dashboard>, or
- Point a covered hostname at previews: create a CNAME `staging.whiteboard.rushilchopra.com` → `cname.vercel-dns.com` at your DNS provider, then `vercel alias <preview-url> staging.whiteboard.rushilchopra.com`.

Localhost and the production domain are unaffected.

## 4. Ship

```bash
git push -u origin feat/production-hardening
gh pr create --fill --base main
# after review
vercel --prod
```

Note: production is currently aliased to a deployment of the `cursor/realtime-math-tutor-engine-5707` demo branch (no login, 12 fixed problems). Promoting this branch replaces it with the authenticated dashboard + boards + Live Math.

## 5. First-run verification on production

1. Sign up, create a board, handwrite `2x + 3 = 11`, then `2x = 8`, then `x = 4`: gray echoes within ~1.5 s, green checks on lines 2–3, "Solved" on line 3.
2. Write `x = 5` instead: amber dot; in Suggest, a hint card with a question.
3. Write `y = x^2 - 4`: a graph card.
4. `curl -X POST https://<host>/api/live/recognize` without a token → `401 {"error":"unauthorized"}`.
5. Reload the board: shapes persist; the dashboard thumbnail updates.

## Known follow-ups (not blocking)

- Images now go to the `board-assets` bucket (`docs/ARCHITECTURE.md` flow 2b). If the new project is restored from a backup that contains boards saved by the old client, run `node scripts/offload-assets.mjs --dry-run` then without the flag (runbook section 12) once, with the service role key, before students open those boards. A fresh project has nothing to migrate.
- Storage garbage collection ships in three layers (runbook section 12): board delete removes the board's own objects, `node scripts/gc-storage.mjs` is the operator tool, and the Vercel cron `0 4 * * *` -> `/api/admin/gc` runs nightly once `CRON_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` are set in Production. The nightly cron **collects** (Vercel's own invocation is recognised by its `vercel-cron/1.0` user agent and `x-vercel-cron-schedule` header; a manual `curl` to the same URL only reports unless you pass `?dryRun=0`). Before the first cohort, run `node scripts/gc-storage.mjs` once and read the table, then watch a few nightly `storage gc summary` log lines; pause collection by setting the cron path to `/api/admin/gc?dryRun=1`.
- Rate limits are database-backed (`rate_limit_hit()` RPC, fixed window in `rate_limit_counters`), so they hold across instances and regions; the in-memory limiter remains the automatic fallback when the RPC is unavailable and can be forced with `RATE_LIMIT_BACKEND=memory`. A 429 body reports which backend answered. Public/IP-keyed buckets (`/api/config/status`, `/api/billing/webhook`, `/api/admin/gc`) stay in memory by design.
- Credits are refunded when a paid provider call fails (`refund_credits()`, 15-minute window). Exception: a streaming check or solve that fails *after* its first annotation or step keeps the charge, since the student already received part of the answer.
- Wire the Live voice tools (`read_live_math`, `place_math`, `plot_function`) into the Realtime session once a valid OpenAI key exists.
- Systems of equations, summations, and limits go to the LLM path today; a local `lusolve` path is a small addition.
