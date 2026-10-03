# Board reliability — QA report (2026-10-02)

Scope: every way a student can lose work, get stuck, or see a broken or confusing state on the board and around it (sign-in, boards home, account). Interaction and feel (pen, tools, iPad layout, Live/chat UX, performance) and billing were other passes and are only listed where something turned up.

Environment: branch `fix/board-reliability` from `origin/main` 620f11a. `next dev --webpack -p 3001` (and `next build` + `next start -p 3011` for production-only checks), the shared local Supabase stack (API 127.0.0.1:54321), `BILLING_ENFORCE=0`, Live switched off per device for most runs (no Mathpix spend, deterministic stores). Headless Chromium through Playwright, 1280×800, users `qa-reliability@example.com` / `qa-reliability2@example.com` plus throwaway sign-ups. Every check compares the editor's document with the stored row (`whiteboards.data`, read with psql), not just the screen. Scripts and screenshots: the session scratchpad, `reliability/t01…t18-*.mjs` and `reliability/shots/`. The machine's load average was 30+ throughout (other agents), so dev timings are pessimistic.

## Findings

| # | Severity | What | Fixed |
| --- | --- | --- | --- |
| R0 | High (security) | The sign-in form submitted before hydration was a GET: `/login?email=…&password=…` in history and server/Vercel logs (found by the board-feel pass) | Yes (3a9f12f) |
| R1 | High (data loss) | Work drawn after a board passes the 4 MB size cap is lost on reload or close; the pill blames images on a board of ink | Yes (928f164) |
| R2 | High (data loss) | tldraw's crash screen offers "Reset data", which runs `localStorage.clear()` and wipes the unsaved-work backups (and the sign-in) | Yes (041398a) |
| R3 | High (data loss) | A student who writes without a 2 s pause is never saved, and not backed up until a 0.5 s pause | Yes (344009d, a677e93) |
| R4 | Medium-high (data loss, iPad) | Switching app or tab saves and backs up nothing; iPadOS suspends the hidden tab's timers and may discard it | Yes (bb22ba9) |
| R5 | Medium (stuck) | A save request that never answers leaves "Saving…" up forever and blocks every later save | Yes (344009d, 33c0f3c) |
| R6 | Low-medium (confusing) | A signed-out or expired-session visit to a board lands on the boards home after signing in, not the board | Yes (9b1c2b8) |
| R7 | Low (confusing) | A mistyped board link says "Couldn't load this board … check your connection" with a raw Postgres error; missing boards log 406 errors | Yes (ac7c5af) |
| R8 | Low | Backups: "Restored unsaved changes" when nothing needed restoring; records from an older schema not migrated; a window with no backup right after a restore | Yes (fb3ce48) |
| R9 | Polish | Every autosave problem is printed twice in the console (console + logger) | Yes (fba5a4b) |
| R10 | Low-medium (confusing) | With Live on, opening a board and changing nothing saves twice ("Saving…", a new `updated_at` that reorders the boards home) (found by the board-feel pass) | Yes (697a903) |
| N10 | Low | The boards home calls `credit_summary` twice per load and twice per window focus (header and banner each fetch) | No (billing area) |
| N1 | Medium | Two tabs of one board on one device share one backup key | No |
| N2 | Low-medium | An old backup is replayed over newer edits made on another device | No |
| N3 | Info | Two devices: edit beats delete; a tab sees the other's work only after its own next save | No (by design) |
| N4 | Low-medium | The row lags the last ~2 s of ink when a tab is closed; another device opened first does not see it | No |
| N5 | Low | After a Supabase outage the save can wait up to 60 s (backoff); the pill says "offline" when only the server is down | Partly |
| N6 | High (ops) | `whiteboard_snapshots` keeps 20 full copies of every board; heavy boards can fill the free-tier database | No |
| N7 | Env | Storage uploads fail in the shared local stack (42P10), so image upload, offload and cleanup were not verified end to end | No (environment) |
| N8 | Low | tldraw leaves a broken image shape when an upload fails | No |
| N9 | Low (dev only) | Browser back/forward to a board under `next dev --webpack` never hydrates | No (dev only) |

### R0 — The password could land in the URL (High, security) — fixed

Reported by the board-feel pass. The sign-in form is in the server HTML with no `method`, so a submit before React attached `onSubmit` (a slow load, a quick Enter on an iPad) was the browser's own GET: `/login?email=…&password=…`, in history and in the server and Vercel logs.

Fix: the submit button is disabled until hydration, which also stops Enter (implicit submission does nothing while the default button is disabled), and every form that takes a password (sign-in / sign-up, choose a new password) posts to itself (`AUTH_FORM_METHOD`: `method="post" action="#"`), so even a script forcing `form.submit()` sends the fields in a body nothing reads. Account deletion has no form and no password; the other forms (rename, display name, chat) take no secrets. Verified (`t19-prehydration-login.mjs`) with every JS chunk blocked: Enter and a click do nothing, a forced submit is `POST /login` (200, the page again), no URL carries the credentials; after hydration Enter signs in as before. Test: `src/components/__tests__/authForms.test.tsx`.

### R1 — Work past the size cap is lost, and the message is wrong (High) — fixed

Repro (`t10-big.mjs`): a board of ~2,000 strokes on 10 screens (no images; ~4.3 MB of JSON). The autosave refuses (client hard limit 4 MB) and the pill says "Board too large to save — remove some images". Keep drawing, reload: everything since the cap is gone, and there is no `agathon.unsaved.<id>` backup. Before the fix, 2,000 strokes created in one go reloaded as 0.

Root cause: the unsaved-changes backup stored the whole document and is capped at 2 MB (`BACKUP_MAX_BYTES`); a board too big to save is always too big to back up, so `write` returned false and cleared the old backup. The refusal copy assumed inline images, which a board of ink does not have.

How fast a student gets there: about 2.2 KB per stroke (40-point handwriting strokes; 48-point mouse squiggles 2.1 KB), so ~1,800 strokes, a handful of full screens. Live echoes and the tutor's handwriting add to it.

Fix: the backup now holds only the unsaved records (plus the schema): what a restore reads anyway. Past the cap, 301 new strokes made a 660 KB backup and the reload restored 2,101 of 2,101. A refused board with no inline images says "Board full — new work here isn't saved. Start a new board"; with images it keeps "remove some images". From 80 % of the hard limit (3.2 MB) a saved board shows an amber "Board almost full — start a new board soon".

Not changed: the capacity itself. The client refuses at 4 MB of JSON while the database cap is 8 MB of `jsonb::text`; measured expansion for ink is 1.13× (2,180,994 B JSON → 2,466,830 B stored text), so ~7 MB of JSON would still fit. Raising `SNAPSHOT_LIMITS.hardBytes` for boards without inline images would nearly double what a board holds, at the cost of bigger uploads per save and more history (N6). A product and ops call, not made here.

### R2 — "Reset data" on the crash screen wipes the backups (High) — fixed

Repro (`t12-errors.mjs`): force a render error inside the editor (patched `editor.getPages` to throw). tldraw's default error screen appears: "Something went wrong … you may need to reset the tldraw data stored on your device … Reset data", plus a Discord link. Reset calls `hardReset()`, which runs `localStorage.clear()`: the `agathon.unsaved.*` backups, the Supabase session and every preference go, at the one moment unsaved work most depends on the backup.

Fix: `<Tldraw components={{ ErrorFallback: BoardCrashed }}>`, our own screen in the board-load error layout: "This board needs to reload. Your work is safe: anything not uploaded yet is kept on this device." with Reload and Back to my whiteboards. The editor unmounting has already backed up and flushed. Verified: the unsaved stroke is back after Reload.

### R3 — Steady writing is never saved (High) — fixed

Repro (`t14-continuous.mjs`): a stroke about every second with gaps under 2 s, for 25 s. Before: no write to the row at all, the first backup at 23.9 s. A crash, a killed tab or a dead battery in that window loses everything since the last pause. Anything that changes the store continuously (the tutor's hand drawing, lecture sketches) starves the save the same way.

Root cause: the save (2 s) and backup (0.5 s) debounces restart on every change, with no maximum wait.

Fix: `MAX_SAVE_WAIT_MS` (10 s) and `MAX_BACKUP_WAIT_MS` (2 s) cap how long a burst waits. After: first save at 10.5 s, first backup at 2.4 s.

Follow-on, caught in the re-run before it shipped: with saves now firing during activity, the queue's old "one immediate follow-up save for edits made while saving" chained writes back to back for as long as the student kept going (typing one line of text made ~20 writes and 20 history rows in two seconds, `t02`). Edits made during a save now join the next burst: saved after the debounce, at most 10 s after the first of them (2–4 writes in 30 s of continuous typing in the unit test; the `t02` board went from v34 to v3). Unmount and hiding the tab still flush at once.

### R4 — Nothing is saved when the tab is hidden (Medium-high, iPad) — fixed

Root cause: only `pagehide`/`beforeunload` wrote the backup. On iPad, switching app or tab fires `visibilitychange` and often nothing else: the hidden tab's timers are suspended (so neither the debounced save nor the backup runs) and the tab may be discarded later without `pagehide`.

Fix: on `visibilitychange` → hidden, write the backup synchronously and start the save at once; on → visible, retry a save that is waiting out a backoff. Verified (`t15-visibility.mjs`, simulated visibility): backup written synchronously, the save landed 1.06 s after hiding (dev), and a backed-off save retried 162 ms after the tab came back instead of waiting up to 60 s.

### R5 — A hung save request blocks saving forever (Medium) — fixed

Repro (`t07-supabase-down.mjs`, "hanging" phase): Supabase REST requests are held without an answer. The pill shows "Saving…" for the whole outage, never an error, and no later edit is saved (one save cycle runs at a time). On flaky school Wi-Fi a stalled connection can sit for minutes.

Fix: the queue aborts a write (and the conflict fetch) with no answer after 30 s plus 1 ms per 20 bytes written (a 4 MB board gets ~230 s, i.e. a 20 KB/s link), reports "Couldn't save · Retry" ("Save timed out. Retrying…" on hover) and retries with the usual backoff. The Supabase calls take the abort signal. A save that is itself a retry now reads "Retrying…" rather than "Saving…", so a hang that keeps timing out never looks like an ordinary save (the first re-run sampled "Saving…" during the second attempt). Verified: error, then "Retrying…" during the outage; saved within a second of it ending.

### R6 — Sign-in after a signed-out board visit goes home (Low-medium) — fixed

Repro (`t09-home.mjs`, `t08-auth.mjs`): open a board URL signed out, or let the session die on a board (revoked refresh token): the page goes to `/login`, and after signing in the student is on the boards home, not their board. Unsaved strokes were safe in the backup (verified: 4 of 4 back after signing in).

Fix: the board sends a signed-out visit to `/login?next=/board/<id>`; the sign-in form returns there (`afterSignInPath`, which honours only `/board/<id>` paths, never an absolute or `//host` URL).

### R7 — A mistyped board link looks like a network problem (Low) — fixed

Repro: `/board/not-a-uuid` showed "Couldn't load this board. Your work is still saved. Check your connection and try again." with `invalid input syntax for type uuid: "not-a-uuid"`. Deleted boards and other accounts' boards correctly said "This board doesn't exist or you don't have access", but each logged a 406 from `.single()`.

Fix: Postgres 22P02 maps to not-found; the load uses `.maybeSingle()` (a missing row is null, not an error).

### R8 — Backup restore details (Low) — fixed

- The "Restored unsaved changes from this device" toast showed whenever a backup existed, including after closing a tab whose save had in fact landed (the backup equals the row). It now counts only records that differ.
- A backup written before a deploy is now migrated through the store schema before it is replayed (tldraw or our shape props may have moved on); before, such records failed validation and were silently skipped.
- The restore cleared the backup and relied on the next backup 0.5 s later: the backup is now rewritten at once from what is still unsaved.

### R9 — Doubled console output (Polish) — fixed

`buildSnapshotUpdate` printed each problem with `console.*` and again through `logger` (which also writes to the console): a refused save logged four lines per attempt. The `console.*` duplicates are gone.

### R10 — Opening a board saves it (Low-medium) — fixed

Reported by the board-feel pass. With Live on, opening a board with echoes and touching nothing made two writes (`t20-open-nochange.mjs`): the data was identical (no new version) but the row got a fresh `updated_at` (the board jumps to the top of "Recently edited"), a re-rendered thumbnail, and the pill flashed "Saving…"/"Saved". With Live off nothing was written. Live re-renders its echoes on load and rewrites records with content equal to what they hold (a Live-area cause, not changed here).

Fix (in the queue, so any such writer is covered): it keeps the document as last persisted (or loaded) and, before a save, checks whether every pending change leaves its record as it was; if so there is no write, no "Saving…", and the backup is cleared. Also covers a change undone before the save and a shape drawn then erased. After: 0 writes on open.

### Not fixed

- **N10 — duplicate `credit_summary` calls (Low).** `AppHeader` (the credits badge) and `CreditsBanner` each call `useCreditSummary` (`src/lib/billing/useCreditSummary.ts`), and each instance reads on mount and on every window focus: 2 calls per home load and per focus in production; dev's StrictMode makes it 4 after signing in (measured: 4 after sign-in, 2 on reload, 2 per focus). Fix: one shared in-flight read (or a few seconds' cache) inside the hook. Left to the Ink pass, which is replacing that billing code.
- **N1 — two tabs, one device, one backup key (Medium).** Both tabs write `agathon.unsaved.<boardId>`; the last writer wins, and a successful save in one tab clears the other tab's backup. Two tabs of the same board, both offline and both closed, keep only one tab's unsaved strokes. Fix: a key per tab (`…<boardId>.<tabId>`) and a restore that replays every key for the board. Left out to keep this pass small.
- **N2 — stale backups win (Low-medium).** A backup is replayed over the row "regardless of how far the server moved on" (`restoreBackupInto`). If the student closed an iPad tab mid-save, worked on a laptop, and opens the board on the iPad days later, records in the old backup overwrite the laptop's edits to them, and strokes erased on the laptop come back. A real fix is a three-way merge against `whiteboard_snapshots` at `baseVersion`.
- **N3 — two devices (by design).** Verified with two browser contexts (`t04-two-tabs.mjs`): concurrent adds merge (both in the row, versions conflict-checked), a delete in one survives an unrelated edit in the other, rapid alternating edits lose nothing (13 of 13). Edit beats delete: an edit to a shape the other device deleted brings it back. A device sees the other's work only after its own next save (there is no realtime).
- **N4 — closing a tab (Low-medium).** Rapid edits then closing the tab (`t03-close-fast.mjs`): the row misses the last ~2 s of ink; the backup has it and the next open on that device restores and saves it (verified). Opened first on another device, those strokes are not there yet. `fetch(..., { keepalive: true })` cannot carry more than 64 KB, smaller than most boards. Possible next step: a `beforeunload` prompt while the queue is pending (not done: it would also block every automated QA script that navigates right after drawing).
- **N5 — outages (Partly).** With Supabase refusing connections or answering 503 (`t07`), the failure is visible ("Unsaved changes — offline" / "Couldn't save · Retry") and every stroke reaches the row after it ends, but the backoff (2, 5, 15, 60 s) means up to 60 s before the next try and the device fires no `online` event. Coming back into view now retries at once (R4). The "offline" wording is used even when only the server is unreachable.
- **N6 — history growth (High, ops).** The `whiteboards_record_snapshot` trigger copies the whole row into `whiteboard_snapshots` on every save (every 2–10 s of drawing) and keeps 20 per board. TOAST compresses ink about 3.4× (2.47 MB → 0.74 MB), so a heavy board holds 15–30 MB of history; the shared local stack's history table is already 248 MB. On the free plan (500 MB) a few dozen heavy boards can push the project into read-only, and then every save for every student fails. Recommend keeping fewer versions or thinning them by time (e.g. one per 10 minutes), as a migration the owner applies.
- **N7 — Storage in the local stack (environment).** Every upload to the `board-assets` bucket fails with 500 / `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification`: the storage schema is at migration 72 (`drop-bucketid-objname-index`, 2026-09-29) while the running container is `storage-api:v1.77.0`. Not an app bug (production storage is managed), and not touched here because the stack is shared. Consequences for this pass: image upload, the 8 MB cap with real images, board and account deletion removing Storage objects were not verified end to end (the code paths have unit tests; deletion of rows, snapshots and the account was verified). The lazy offloader (below) was verified to load and run on a legacy board; its uploads fail for the same reason.
- **N8 — failed upload leaves a broken image (Low).** tldraw's default file handler deletes the asset on upload failure but keeps the image shape, which shows as a broken image and is saved. Needs a custom external-content handler.
- **N9 — dev-only back/forward.** Under `next dev --webpack`, browser back then forward between full page loads re-serves the cached HTML and React never hydrates ("Loading your canvas…" forever, no requests). The production build hydrates normally (checked on `next start`). Not a product bug.

### Checked and fine

- Persistence (`t02`): draw, type, three screens; the row equals the editor record for record; reload, a second tab, and sign-out/sign-in show the identical document; a reload writes no new version, with Live on too (`t16b`).
- Offline for a minute while drawing (`t05`): "Unsaved changes — offline" the whole time, every stroke saved 96 ms after reconnecting; offline → close → reconnect → reopen restores from the backup and saves.
- Slow 3G via CDP (2 s RTT, 50 KB/s) (`t06`): saves keep up (settled 2.2 s after the last stroke), nothing lost.
- Session expiry (`t08`): an expired access token is refreshed and the save lands; a revoked refresh token signs the student out to `/login?next=…` with the work kept on the device and restored after signing in.
- Boards home (`t09`): 70 boards render in under a second; rename (200-character limit) and delete persist; a deleted board's URL and another account's board say "doesn't exist or you don't have access"; unknown routes get the 404 page.
- A corrupt snapshot (unknown shape type) shows "Couldn't restore this board's contents" and the row is never overwritten.
- Sign-up of a new student shows the welcome; password reset through Mailpit works end to end and the new password signs in (`t13`).
- Account deletion removes the user, boards and snapshots (`t11`); Storage objects: see N7.

## Other areas (not changed here)

- Live: `/api/live/recognize` answered "invalid request body" three times for synthetic zig-zag strokes in the first smoke run (Live on); not investigated.
- Live: `npm run typecheck` fails while `next dev` has generated `.next/dev/types`, because `src/app/api/live/recognize/route.ts` exports `recognizeFailureHints` (a route file may only export handlers and config). Clean without `.next/dev`.
- An image whose URL cannot be fetched produced an unhandled "Failed to fetch" page error while the board saved (likely the thumbnail export); seen with a synthetic URL only.
- Boards home downloads every board's preview (up to 20 KB each) on each visit.
- Sign-out and account deletion leave `agathon.unsaved.*` backups (board content) in `localStorage` on shared devices.

## Bundle

`/board/[id]` first-load JS (gzip): 1,059,085 B on `origin/main` → 1,059,239 B (+154 B, 761 B under the 1,060,000 budget). The fixes cost about 880 B; to pay for them, the inline-image offloader (`offloadSnapshotAssets`) and the retired AI-overlay cleanup (`useAiOverlayShapes`) now load only for the old boards that need them (which also spares every board open a full `JSON.stringify` of the document just to report "nothing to move"), the duplicate console logging went, and the unused `blockedMessage`/`flush` left the autosave hook's result. `/login` +87 B, `/reset-password` +52 B, `/` −21 B.

## Verification

- `npm run typecheck`: exit 0 (without `.next/dev/types`; see "Other areas" for the dev-types failure).
- `npm run lint`: 0 errors, 4 warnings (pre-existing `<img>` warnings).
- `npm test`: 213 files passed, 7 skipped; 4,705 tests passed, 51 skipped (run with `--maxWorkers=4`: with the default worker count two eval files timed out under the machine's load of 30–100; they pass alone).
- `next build`: exit 0; `npm run bundle:check`: all budgets ok; `.next` deleted.
- New regression tests: `src/lib/sync/__tests__/saveQueue.test.ts` (max wait, hung write and hung conflict fetch, changed-only backup, notice, no chained saves, nothing to save), `restoreBackup.test.ts` (changed-only backup, no-op restore, schema migration), `src/hooks/__tests__/useSnapshotSave.test.ts` (board-full vs. images copy, nearly-full notice, lazy offloader), `saveStatus.test.ts` (notice, "Retrying…"), `src/components/__tests__/boardCrashed.test.tsx`, `boardLoadState.test.ts` (22P02), `authForms.test.tsx` (password forms post, submit disabled before hydration), `src/lib/__tests__/loginForm.test.ts` (`afterSignInPath`). Each new queue test was checked to fail on the code before its fix.
- Browser re-run on the fixed code (dev server, `t02`–`t21`): every check passes except the two known N4 cases in `t03` (the row lags a tab closed within the debounce; reopening restores it) and `t03`'s back/forward step (N9, dev only). Production build (`next start`, `prod-smoke.mjs`, run on the build before the last four commits a677e93…697a903, which were verified on the dev server only): a signed-out board link returns to the board after sign-in, strokes are saved, a hidden tab saves before the debounce, a reload shows 4 of 4 shapes in 0.4 s, back/forward re-opens the board, a mistyped link says not found, a 4.4 MB board shows its first shapes in 2.0 s.
- Not verified: anything involving Storage uploads (N7); real iPad Safari (visibility was simulated in Chromium); a real multi-minute TCP stall (simulated by holding requests in Playwright).

## Follow-ups (2026-10-03)

Branch `fix/sync-followups` from `release/ink-and-board` (`ce2b2f7`). Same environment as above (dev server on 3001, shared local stack, Live off, user `qa-sync@example.com`). Scripts and screenshots: the session scratchpad, `sync/s01…s04-*.mjs` and `sync/shots/`.

| # | What | Status | Commit |
| --- | --- | --- | --- |
| N6 | History growth | Fixed: time-based history, 4 MB per board | dbe846a |
| N1 | Two tabs share one backup key | Fixed: a key per tab, replay of gone tabs' keys | d9164b0, 589604b |
| N2 | A stale backup overwrites newer edits | Fixed: record-level, base-aware restore | d9164b0 |
| N8 | A failed image upload leaves a broken shape | Fixed: own `files` handler | 1641698 |
| N10 | Duplicate `credit_summary` / `ink_summary` reads | Fixed: one shared read per page | 96a3105 |
| — | `tsc` fails once `next dev` compiled the recognize route ("Other areas") | Fixed for that route | 92d8682 |
| F1 | New, High (data loss): another tab of the app makes an open board overwrite newer work | Fixed | 04225d6 |

### N6 — history (High, ops) — fixed

Readers of `whiteboard_snapshots`, checked first: nothing in the app (no restore UI; the conflict merge works from the client's dirty sets; account and board deletion are FK cascades; storage GC reads `whiteboards.data` and `board_assets` only); `scripts/verify-rls.mjs` (insert policy and a "versions 2 and 3" check); the operator, by hand. So history is the operator's undo after a wipe or a mess-up, and the design keeps what that needs (`supabase/migrations/20261003000000_snapshot_retention.sql`, `docs/RUNBOOK-supabase.md` 10.1):

- A history row is the state a save replaced (`old.version`, `old.data`), so the row and its newest copy are never the same thing, and the state a session ended in is kept when the next one starts. One is written when the board has none younger than 10 minutes (first save of a session, then at most one per 10 minutes), and before any save that drops more than half of a board of 16 KB or more (stored size), whatever the 10-minute rule says. A new board's empty `{}` is never kept.
- `prune_whiteboard_snapshots(board)` runs after each write: candidates are the newest 8 and the newest of each UTC day for the last 7 days; in order of value (newest; each earlier day's newest; the rest) they are kept up to 4 MB of stored size, never fewer than 2. A one-time pass prunes what the old rule stored.
- Only the trigger writes history: `authenticated` lost INSERT (and the owner-insert policy), which also closes a way for a user to store unbounded 8 MB rows or plant a future-dated row that stops their history. The prune is service-role only.

Size per heavy board (stored, i.e. TOAST-compressed; ink compresses 2.2–3.4×):

| Board (JSON → stored) | Before: 20 copies | After: at most | Why |
| --- | --- | --- | --- |
| 2.47 MB → 0.74 MB (QA ink board) | 14.8 MB | 3.7 MB (5 copies) | budget |
| ~4 MB → ~1.2 MB (the client's cap, ink) | ~24 MB | 3.6 MB (3) | budget |
| 3.86 MB → 1.76 MB (heaviest local board) | 35 MB (measured 32.9 MB) | 3.5 MB (2) | the 2 always kept |
| 110 KB → ~33 KB (a page of handwriting) | 0.66 MB | 0.5 MB (15), usually 2–6 | count |

A board drawn on once for 20 minutes keeps 2 copies (was 20). History writes drop from one per save (every 2–10 s of drawing) to one per 10 minutes. With the row itself, a heavy board now costs about 4.5–5.5 MB of the free plan's 500 MB instead of 15–37 MB.

On the shared local stack the one-time prune took 3.2 s: 1,226 → 880 rows, 192 MB → 91 MB of stored data; the heaviest board went from 20 rows / 32.9 MB to 2 / 3.5 MB. The table file stays at 248 MB until `vacuum (full, analyze) public.whiteboard_snapshots` (not run on the shared stack; the runbook says when to run it in production).

### N1 — two tabs, one backup key — fixed

Each mount of a board backs up to `agathon.unsaved.<boardId>.<tabId>` and holds the Web Lock `agathon.tab.<tabId>` while its queue lives (released after the unmount flush). On open, the board lists every backup key of the board on the device (other tabs, earlier page loads, the old shared key), asks Web Locks which tabs are still open, replays the keys of the gone ones oldest first (record by record, below), writes its own backup at once and only then removes the replayed keys. An open tab's backup is left to that tab: replaying it would make its records this tab's local changes and could later win a merge over the open tab's newer edit. Without Web Locks (Safari before 15.4) every other key counts as gone, which is the old behaviour. The restore module is fetched only when such a key exists.

Browser (`s01-two-tabs.mjs`, tabs in one context, tab B's saves aborted): B's stroke is backed up under its own key; A's successful saves leave it alone; a tab opened while B is open does not replay it; B's backup survives B closing; the next open replays it, saves it (row has 3 of 3), removes the key and says "Restored unsaved changes from this device". 9 of 9.

### N2 — stale backups — fixed

The backup now carries, for each changed or removed record, the record as the server had it at the backup's base version (`base`; from the queue's view of the server's document, which now also follows a conflict merge), and for ids edited again while a write was in flight, what that write sent (`sent`). The restore (`restoreBackups`) decides per record against the row it loaded: the server still has the base → only this device changed it → restored (put or removed); the server holds exactly this device's own unacknowledged write → restored; the server changed it too (edited or deleted) → the server's record stays, the local change is dropped, and the student sees "Some unsaved changes from this device were older than the board and weren't restored". Several backups are replayed oldest first; a newer backup's decision about a record wins. Backups written before this change have no `base`: at the same version everything is restored; once the row moved on, records the server has are kept as the server has them and only records it lacks (new strokes) are restored. If `base` would push a backup past its 2 MB cap it is dropped (that backup then restores by the version rule).

Browser (`s02-stale-backup.mjs`, two contexts as two devices): the iPad moves S and draws N with its saves failing and closes; the laptop moves S; the iPad reopens: N restored and saved, S stays where the laptop put it (777 on screen and in the row), the warning is shown. A backup newer than the row (nobody else touched it) is restored in full with the plain toast. 7 of 7. Unit tests: stale vs newer server, deleted on the server vs edited here, edited on the server vs deleted here, newer than the server, own landed write, several tabs, legacy backups.

### N8 — broken image after a failed upload — fixed

The board registers its own `files` external-content handler (`src/lib/assets/addImageFiles.ts`, fetched on the first paste or drop). Same flow as tldraw's (preview while the board asset store uploads), but a failed upload removes the image shape again (and the placeholder asset unless another shape uses it), without an undo entry, and toasts "Couldn't add that image. Try again." Files the bucket would refuse (not PNG/JPEG/GIF/WebP/SVG, over 10 MB) are refused before anything is created. Tested on a real tldraw `Editor` (headless in node) with a failing asset store. Not browser-checked (Storage uploads fail in the local stack, N7). Left as is: an undo followed by a redo right after a failed upload brings the empty shape back (rewinding the paste's history entry could also take strokes drawn during the upload).

### N10 — duplicate ink reads — fixed

`useInkSummary` now reads from one module-level store per page (`createInkStore`): one request in flight, one cached answer, one set of window listeners while any surface is mounted. A mount, focus or tab-visible within 5 s of the last answer reads nothing; a balance change (ink-changed event, another tab's ping, paid calls, the checkout watch, reload()) always reads, once more after a read already in flight. Browser (`s03-ink-reads.mjs`, dev with StrictMode): sign-in → boards home 1 read (was 4), reload 1 (was 2), back to the tab right after a read 0, later 1 for focus + visibilitychange together (was 2 per surface per event), ink changed 1, board 1, account page 1.

### Typecheck with `.next/dev/types` — fixed for the recognize route

`recognizeFailureHints` moved to `src/lib/server/recognizeHints.ts`; a test pins the route's exports. `npm run typecheck` passes with a fresh dev server's `.next` (board page and recognize route compiled). Not fixed: `src/app/api/admin/gc/route.ts` (`isCronRequest`, `isDryRun`, `createGcHandler`) and `src/app/api/billing/webhook/route.ts` (`APP_TAG`, `HANDLED_EVENTS`, `mapBillingEvent`, …) export helpers the same way, so `tsc` fails again once `next dev` has compiled either of those routes (verified). Moving them out means teaching `routeProtection.test.ts`, which greps those route files for their auth checks, to read the helper module too; left for the owner of those routes. Fixed later (`fix/followups-ipad`, `0f9694d`): the helpers moved to `src/lib/server/storageGc.ts` and `src/lib/server/billingWebhook.ts`, the handlers and their checks stayed in the route files, and `routeProtection.test.ts` now also pins every route file's exports to handlers and segment config (`docs/QA-2026-10-03-webkit.md`, Follow-ups 5).

### F1 — another tab of the app makes an open board overwrite newer work (High, data loss) — fixed

Found while checking N1. The board page re-read its row whenever the AuthProvider's `user` object changed, and supabase-js hands out a new session object on every auth event, including another tab of the app starting up. The re-read did not reload the editor but changed `initialVersion`, so the autosave rebuilt its queue at the row's newest version on top of the document still on screen: that tab's next save passed the version check and replaced the row with its stale document, and the tab's own unsaved edits stopped being tracked. Repro (`s04-other-tab-reload.mjs`): board open in tabs A and B; A draws and saves; the boards home opens in tab C; B draws and saves: A's stroke is gone from the row (4 of 5). Fix: the load is keyed on the user's id, and the autosave pins the version the editor was loaded at for the life of the mount. After: B does not reload, its save conflicts and merges, the row keeps every stroke (7 of 7, then 4 of 4 on the final code).

### Verification

- `npm run typecheck`: exit 0 with no `.next`, and exit 0 with a fresh dev server's `.next/dev/types` (board page and recognize route compiled; see above for gc/webhook).
- `npm run lint`: 0 errors, 4 warnings (the pre-existing `<img>` warnings).
- `npx vitest run --maxWorkers=4`: 229 files passed, 8 skipped; 4,921 tests passed, 62 skipped.
- `RUN_DB_TESTS=1`: `src/__tests__/db-history.integration.test.ts` 5 of 5 (recording rules, 10-minute spacing via back-dated rows, wipe, daily retention, the 4 MB budget, cascade on delete); `db-rls.integration.test.ts` 24 of 25, the failure being the storage policies (42P10, N7).
- `node scripts/verify-rls.mjs`: 210 of 214; the 4 failures are storage only (42P10, N7): A uploads into board-assets, the object is publicly readable, B cannot delete A's object, A deletes own object.
- `next build`: exit 0; `npm run bundle:check`: all budgets ok. First-load JS (gzip) against a build of `ce2b2f7`: `/board/[id]` 1,054,882 → 1,056,203 B (+1,321; 3,797 B under the 1,060,000 budget), `/` +321, `/account` +303, `/train` +285, other routes unchanged. `.next` deleted.
- Browser (dev server): `s01` 9/9, `s02` 7/7, `s03` 4/4, `s04` row keeps every stroke.
- Later, on `fix/followups-ipad` (details in `docs/QA-2026-10-03-webkit.md`, Follow-ups): the backup cap is counted in Safari's bytes and a full storage evicts restored or week-old backups instead of clearing the tab's own (`98d02bd`); Safari's 7-day eviction of a site's storage (ITP) was checked rather than changed: a change is on the server about 2 s after it is made, a hidden tab saves at once, and while a save cannot land the pill says "Unsaved changes — offline" / "Couldn't save" in words, so a backup is only the sole copy when the bar already says so; repeat "Restored" toasts collapse into one (`71b7e44`).
- Environment notes: the migration was applied to the shared stack with `psql --single-transaction` and is not recorded in `supabase_migrations.schema_migrations`, because `supabase migration up` refuses while the stack holds versions this branch lacks (`20261003010000`, `20261003010100` from another branch); it is idempotent, so a later `migration up` re-applies it harmlessly. That other branch's sign-up trigger refuses accounts without `user_metadata.terms_version`, so the DB tests and verify-rls here ran with that branch's `scripts/lib/supabaseHttp.mjs` change applied locally and not committed. Until this branch is merged, other branches' verify-rls against the shared stack will fail "A inserts snapshot for own board" and "snapshot history recorded for versions 2 and 3".
