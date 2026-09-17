# Go-live checklist

Everything on `feat/production-hardening` builds, typechecks, lints, and passes 472 unit tests plus the route smoke script against a local Supabase stack. Three things still need a human with account access before production works.

## 1. Database (blocking)

The previous Supabase project was deleted; no cloud project exists yet, so login and saving are broken in production until one does. Follow [`RUNBOOK-supabase.md`](./RUNBOOK-supabase.md) end to end (~30 min): create the project (section 1), `npx supabase login` / `link` / `npm run db:push` (2), dashboard Auth settings that the migration cannot set (3), storage sanity (4), Vercel env vars for all three environments (5), trainer allow-list (6), and verification with `npm run db:verify` + `RUN_DB_TESTS=1 npm test` (7). Turn on backups before the first cohort (10).

## 2. Environment variables

| Variable | Production | Preview / Development | Notes |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | present | present | Required. ~$58 of credit remained on 2026-09-11. |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | **replace** | **add** | See step 1. |
| `MATHPIX_APP_ID` / `MATHPIX_APP_KEY` | present | present | Realtime handwriting recognition; verified working. |
| `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` | present | present | See section 3. |
| `NEXT_PUBLIC_SITE_URL` | present | add (optional) | Referer header for OpenRouter. |
| `OPENAI_API_KEY` | absent | absent | Only for the voice tutor. The key in the old `.env.local` is revoked (401). Voice returns 503 until a valid key is added. |
| `MISTRAL_API_KEY` | not needed | not needed | Removed; OCR runs on OpenRouter now. |
| `NEXT_PUBLIC_LIVE_MATH` | optional | optional | Set to `0` to hide Live Math without unregistering its shapes. |
| `LIVE_MODEL_CHECK` / `_SOLVE` / `_VISION` | optional | optional | OpenRouter model overrides for Live routes. |
| `LOG_LEVEL` / `NEXT_PUBLIC_LOG_LEVEL` | optional | optional | Server / browser pino levels, default `info`. |
| `SUPABASE_SERVICE_ROLE_KEY` | do not add | do not add | Read by nothing today; keep it out of Vercel (runbook section 5). |

Full per-variable notes: `.env.example` (kept in sync with the code by `src/__tests__/envExample.test.ts`).

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

- Store generated images and PDF pages in the `board-assets` bucket instead of base64 inside the snapshot (design in `docs/LIVE-MATH-SPEC.md` §8.6; bucket + policies already in the migration).
- Rate limiter is per-instance in memory; swap in Upstash Redis for multi-region.
- Wire the Live voice tools (`read_live_math`, `place_math`, `plot_function`) into the Realtime session once a valid OpenAI key exists.
- Systems of equations, summations, and limits go to the LLM path today; a local `lusolve` path is a small addition.
