# Architecture

Agathon Classroom is a single Next.js 16 App Router app. The browser talks to Supabase directly for auth and board persistence (protected by RLS), and to Next.js route handlers for anything that needs a provider API key. No key other than the Supabase anon key ever reaches the browser.

## Components

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Canvas | tldraw 4 (`src/app/board/[id]/page.tsx`) | Drawing, viewport capture, overlay of AI images, autosave |
| Client API helper | `src/lib/api-client.ts` | `authedFetch` attaches the Supabase access token; `apiJson` parses the error contract into `ApiError` |
| Route handlers | `src/app/api/**` (Node runtime) | JWT verification, rate limiting, zod validation, provider calls, logging |
| Server helpers | `src/lib/server/**`, `src/lib/env.ts` | `requireUser`, rate limiter, env validation, provider clients |
| Data | Supabase Postgres + Auth + Storage | Boards, settings, bug reports, training samples, buckets |
| Providers | OpenRouter (image + vision models), Mathpix (handwriting OCR), OpenAI (Realtime voice) | Model inference |

## Request flows

### 1. Draw -> AI feedback (core loop)

1. `useDebounceActivity` watches the tldraw store for user-sourced changes; after ~2 s of idle it fires.
2. The client renders the current viewport to PNG (`editor.toImage`), excluding pending AI overlays and protected shapes, and downscales it per the AI performance settings.
3. `apiJson("/api/generate-solution", { image, mode, model, ... })` is sent with `Authorization: Bearer <access token>`.
4. The route verifies the JWT, applies the per-user rate limit, validates the body, optionally runs Mathpix on the image to obtain LaTeX for the prompt, then calls an OpenRouter image-output model.
5. The response image is inserted as a locked, semi-transparent image shape. In suggest/answer modes the student accepts or rejects it; in feedback mode it stays.

### 2. Autosave

Every change schedules a save ~2 s later: the whole tldraw snapshot is written to `whiteboards.data` via Supabase JS. RLS restricts the write to the owner. A trigger bumps `version` and copies the snapshot into `whiteboard_snapshots` (last 20 kept). A thumbnail is written to `preview` only when small enough.

### 3. Voice tutor

`POST /api/voice/token` (JWT + rate limit) mints a short-lived OpenAI Realtime client secret and returns it; the browser opens a WebRTC session directly with OpenAI. Tool calls from the model (`analyze_workspace`, `draw_on_canvas`) are executed by the browser, which calls `/api/voice/analyze-workspace` and `/api/generate-solution` with the same auth. Without `OPENAI_API_KEY` the token route returns `503 voice_unavailable`.

### 4. Worksheets, credits, training

- `/api/generate-worksheet`: same pipeline as (1) with a text prompt instead of a canvas image.
- `/api/credits`: reads the OpenRouter balance for the low-credit banner.
- `/train`: trainer-only; before/after PNGs go to the `training-data` bucket and metadata to `training_samples`, both gated by `is_trainer()` in RLS.

## Error contract

Every route returns JSON `{ error: <code>, message: <text> }` on failure:

| Status | `error` |
| --- | --- |
| 400 | `invalid_request` |
| 401 | `unauthorized` |
| 402 | `credits_exhausted` |
| 429 | `rate_limited` (+ `Retry-After` header) |
| 502 | `upstream_error` |
| 503 | `voice_unavailable`, `feature_unavailable` |
| 500 | `internal_error` |

The client maps `unauthorized` to a redirect to `/login`, `rate_limited` to a retry hint, and `credits_exhausted` to the credits banner.

## Security model

- **Server-side JWT verification on every route.** `authedFetch` sends the Supabase access token; each handler calls `requireUser`, which verifies the token against the project's Supabase Auth (`auth.getUser(token)`) and rejects with `401 unauthorized` otherwise. Route handlers never trust user ids from the body.
- **Per-user rate limits.** Each route has a sliding-window limit keyed by user id; exceeding it returns `429` with `Retry-After`. This bounds provider spend per account.
- **Input validation.** Request bodies are parsed with zod; image payloads have size caps; unknown models are rejected.
- **Provider keys stay on the server.** Only `NEXT_PUBLIC_*` variables are exposed to the bundle. `SUPABASE_SERVICE_ROLE_KEY` is reserved for future admin jobs and is never used in request paths.
- **Row Level Security.** All tables have RLS enabled, `anon` has no grants, and policies compare `user_id` with `auth.uid()`. Storage policies restrict writes to the caller's own folder (`<uid>/...`). Trainer features are gated by the `trainers` table via `is_trainer()`, not by client-side checks.
- **Boundaries.** `error.tsx` / `global-error.tsx` catch render errors without leaking stack traces; `X-Powered-By` is disabled; the site is `noindex` while in staging.

## Known limitations

- **In-memory rate limiter per instance.** Limits live in the Node process. On Vercel each function instance has its own counters, so the effective limit is `limit x instances` and resets on cold start. Move to Upstash/Redis or Supabase before relying on it for cost control.
- **Snapshots store base64 assets.** Pasted and AI-generated images are embedded as data URLs inside `whiteboards.data`, so rows grow to multiple MB and saves can hit the PostgREST statement timeout (`57014`). The `board-assets` bucket and `board_assets` table exist in the schema; the client-side `TLAssetStore` offload has not shipped yet.
- **Voice depends on `OPENAI_API_KEY`.** No key (or a revoked one) disables the voice tutor entirely; the rest of the app is unaffected.
- **Handwriting OCR is optional.** Without Mathpix the vision model reads the raw image, which is noticeably worse on dense handwriting.
- **Single-user boards.** There is no sharing or realtime collaboration; a board has exactly one owner and the last writer wins across tabs (the `version` column enables optimistic concurrency but the client does not use it yet).

## Live Math flow

```
pen-up (draw.isComplete false→true, source 'user')
  → quiet gate 600 ms (450 ms on rewrite)      src/lib/live/liveLoop.ts
  → clusterLines → InkLine[]                    strokeClusters.ts (union-find, fraction bars, columns)
  → buildPayload → normalized ints + sha-1      strokePayload.ts (cache hit → skip network)
  → POST /api/live/recognize                    Mathpix v3/strokes ▸ vision fallback
  → engine.analyzeLine (mathjs, offline)        src/lib/live/engine/**
  → policy.decide(mode, verdict, voice, idle)   policy.ts (silence rules, hint ladder)
  → placement → scheduleLiveWrite(createShapes) math / graph shapes with meta.live
  → (ladder permits) POST /api/live/check|solve SSE: meta → annotation*/step* → done
```

All Live writes go through `editor.store.mergeRemoteChanges` (source `remote`): they are not in the undo stack and invisible to the legacy `source:'user'` listeners; the autosave listener uses `source:'all'` so they persist. The legacy image pipeline skips bursts that Live handled (`legacyShouldSkip`) and excludes `meta.live` shapes from its capture.

Live routes reuse the shared preamble (`requireUser` → `checkRateLimit` → zod) and add `X-Request-Id`. Streams are `text/event-stream` with `: ping` keepalives; model output is JSON Lines validated per line with zod before it is forwarded, and `expected` claims are re-verified by the local engine before an annotation is shown.
