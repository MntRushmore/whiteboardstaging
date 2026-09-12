# Agathon Classroom

> **Bring your own keys.** No AI credentials ship with this source; whoever runs an instance supplies their own keys (see [SETUP.md](./SETUP.md)).
>
> **License:** FSL-1.1-ALv2. Read, modify and self-host freely; do not offer it as a competing service. Each version becomes Apache-2.0 two years after release. See [LICENSE](./LICENSE), [NOTICE](./NOTICE), [CONTRIBUTING.md](./CONTRIBUTING.md) and [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md). The tldraw SDK is licensed separately and needs its own key in production.

An AI whiteboard that tutors students in real time. Students draw on a tldraw canvas; after a short idle pause the app captures the viewport, sends it to a vision model and draws feedback, hints or a worked solution back onto the canvas. Handwritten math is recognised with Mathpix, and an optional voice tutor (OpenAI Realtime) can look at the workspace and talk the student through it.

## Architecture

```
browser (Next.js App Router, React 19, tldraw 4)
  |  Supabase JS: email/password auth, whiteboards/user_settings/bug_reports via RLS
  |  authedFetch(): POST /api/* with Authorization: Bearer <supabase access token>
  v
Next.js route handlers (src/app/api/**, Node runtime on Vercel)
  |  verify JWT -> rate limit -> validate body (zod) -> call provider
  +-> OpenRouter   image + vision models (solutions, feedback, worksheets, workspace analysis, credits)
  +-> Mathpix      handwritten math -> LaTeX (optional)
  +-> OpenAI       Realtime voice token (optional)
  v
Supabase: Postgres (RLS) + Auth + Storage (board-assets, training-data)
```

Key directories:

| Path | What |
| --- | --- |
| `src/app/page.tsx` | Dashboard: list / create / rename / delete boards |
| `src/app/board/[id]/page.tsx` | The canvas, AI loop, autosave, voice tutor |
| `src/app/train/page.tsx` | Trainer-only page that records before/after samples |
| `src/app/api/**` | Route handlers (all require a Supabase JWT) |
| `src/lib/api-client.ts` | `authedFetch` / `apiJson` / `ApiError` used by the client |
| `src/lib/server/**` | Auth, env, rate limiting and provider helpers for routes |
| `supabase/migrations` | Database schema (see below) |
| `docs/ARCHITECTURE.md` | Request flows, security model, known limitations |

## Data model

Defined in `supabase/migrations/20260911000000_init.sql`. Every table has RLS enabled, `anon` has no grants, and `authenticated` users can only see rows where `user_id = auth.uid()`.

| Table | Purpose |
| --- | --- |
| `whiteboards` | One row per board: `title`, `data` (tldraw snapshot jsonb), `preview` thumbnail, `version`, `deleted_at` (soft delete). Owner CRUD. |
| `whiteboard_snapshots` | Last 20 versions of each board's `data`, written by trigger on every data change. Owner read. |
| `board_assets` | Registry of objects in the `board-assets` bucket, for garbage collection. Owner CRUD. |
| `user_settings` | `features` jsonb (feature-lab toggles). Owner read/insert/update. |
| `bug_reports` | Insert-only from the app (message, screenshot, diagnostics, client log ring buffer). Read via the dashboard/service role. |
| `trainers` | Allow-list of user ids who may use `/train`. `is_trainer()` is used by RLS. Self read only. |
| `training_samples` | Before/after samples recorded by trainers (append-only). |

Storage buckets:

- `board-assets` (public read, 15 MB, images): owner writes only under `<uid>/<boardId>/...`. Target home for canvas images so `whiteboards.data` stops carrying base64.
- `training-data` (private, 10 MB, PNG): trainers write/read only under `<uid>/<sampleId>/...`.

## Local development

```bash
npm install
npx supabase start          # needs Docker; prints API URL + anon key
npm run db:reset            # applies supabase/migrations from scratch
cp .env.example .env.local  # fill in the keys below
npm run dev                 # http://localhost:3000 (pretty pino logs)
```

Other scripts: `npm run typecheck`, `npm run lint`, `npm test` (vitest), `npm run build`, `npm run db:push`.

### Environment variables (`.env.local`)

| Name | Required? | Used for |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL (client + server JWT verification) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon key (client + server) |
| `OPENROUTER_API_KEY` | yes | All image/vision model calls and the credits banner |
| `OPENAI_API_KEY` | no | Voice tutor (Realtime API). Missing -> `/api/voice/token` returns 503 |
| `MATHPIX_APP_ID` / `MATHPIX_APP_KEY` | no | Handwritten math -> LaTeX. Missing -> vision-only fallback |
| `SUPABASE_SERVICE_ROLE_KEY` | no | Server-only; reserved for future admin jobs, unused today |
| `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` | no | Removes the tldraw watermark |
| `NEXT_PUBLIC_SITE_URL` | no | Sent as `HTTP-Referer` to OpenRouter |
| `LOG_LEVEL` | no | Pino level, default `info` |

`MISTRAL_API_KEY` is no longer used: `/api/ocr` now runs on OpenRouter (Gemini Flash) because Mistral retired the Pixtral model. Delete it from any environment.

## Creating a new Supabase project

The previous project was deleted, so production needs a fresh one:

1. Create a project at https://supabase.com/dashboard (any region; note the project ref from the URL and the database password).
2. Link the repo to it:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   ```
3. Apply the schema:
   ```bash
   npm run db:push
   ```
   This creates all tables, policies, triggers and both storage buckets. Re-running is safe.
4. Auth settings: Authentication -> URL Configuration -> set Site URL to the production origin and add `http://localhost:3000` to redirect URLs. Email/password sign-in is the only provider used.
5. Put the new URL and anon key into Vercel for every environment:
   ```bash
   vercel env add NEXT_PUBLIC_SUPABASE_URL production
   vercel env add NEXT_PUBLIC_SUPABASE_URL preview
   vercel env add NEXT_PUBLIC_SUPABASE_URL development
   vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
   vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview
   vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY development
   ```
   Repeat for `OPENROUTER_API_KEY`, and for `OPENAI_API_KEY` / `MATHPIX_*` if you want voice and handwriting OCR. `vercel env pull .env.local` syncs the development values locally.

### Trainer allow-list

`/train` is gated server-side by the `public.trainers` table (the page also hides itself for non-trainers). After the trainer has signed up once, run in the SQL editor:

```sql
insert into public.trainers (user_id)
select id from auth.users where lower(email) = lower('trainer@example.com')
on conflict do nothing;
```

## Deploying

The app runs on Vercel (project `whiteboardstaging`). `vercel.json` is intentionally minimal; the Next.js preset handles everything.

```bash
vercel            # preview deployment
vercel --prod     # production
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests and a build on every push and PR to `main` with dummy env values, so no secrets are needed in GitHub.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Every `/api/*` call returns `401 unauthorized` | The Supabase session expired or the token is for a different project. Sign out and back in; check `NEXT_PUBLIC_SUPABASE_URL` matches the project that issued the token. |
| `402 credits_exhausted` | The OpenRouter account is out of credit. Top up at https://openrouter.ai/credits; the dashboard banner shows the balance. |
| `429 rate_limited` | Per-user limit hit; the response carries `Retry-After`. Limits are per server instance. |
| `503 voice_unavailable` | `OPENAI_API_KEY` is missing or invalid in that environment. Voice is optional; everything else keeps working. |
| `503 feature_unavailable` | The route's optional provider (e.g. Mathpix) is not configured in this environment. |
| `502 upstream_error` | OpenRouter/Mathpix/OpenAI returned an error; check server logs (`LOG_LEVEL=debug`). |
| Board save fails with a timeout (Postgres `57014`) | The snapshot is too large because images are still stored as base64 in `whiteboards.data`. Delete large pasted images, or ship the `board-assets` offload. |
| `npx supabase start` fails | Docker is not running, or ports 54321-54329 are taken (`npx supabase stop --no-backup` then retry). |

All error responses from `/api/*` have the shape `{ "error": "<code>", "message": "<human text>" }`.
