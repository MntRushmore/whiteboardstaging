# Phone as a pen: plan (build after Type it ships)

Owner's call (2026-10-12): Type it first, then this. A kid on a laptop scans a QR code with a
phone (or an iPad in Safari), writes with a finger or a pencil on that screen, and the ink lands on
the laptop's board. The tutor reads it there and answers there. Typing covers lines of maths;
this covers everything typing can't: drawings, diagrams, long division, a kid who'd rather
write.

An iPad with an Apple Pencil used this way is a cheap "iPad version" until the real one.

## What the kid sees

- **Laptop:** a "Write with your phone" item in the bar's menu (and in the toolbar on a laptop).
  It opens a QR code and a short code (e.g. `pen.agathon.app` + 6 letters for a phone that
  can't scan). Once paired: a "Phone connected" chip with Disconnect, and the bar's ghost caret
  shows where the phone's next line lands.
- **Phone:** a full-screen writing pad, no sign-in, no tldraw. A wide strip for one line at a
  time, big enough for a finger, plus **Next line**, **New problem**, **Undo** and **Help me**.
  Each stroke shows on the laptop as the kid lifts the finger.
- **Laptop board:** the strokes are placed at `typedSpot()` (the current problem's next line),
  scaled so the pad's line height becomes the column's line height. They're the kid's own ink:
  the recognizer reads them, and every tutor mode works.

## Architecture

```
 laptop (signed in)                     server (Vercel, Node)                 phone (no account)
 ─────────────────                      ─────────────────────                 ──────────────────
 POST /api/pen/pair {boardId}  ───────► pen_pairings row (code, board,  ◄──── GET /pen/<code>
   ◄── { code, pairingId }               user, expires 10 min)                POST /api/pen/claim
 shows QR: agathon.app/pen/<code>                                             ◄── { penToken }
                                                                              (code is single-use)
 subscribe Realtime private      ◄────── broadcast "ink" / "line" / ◄──────── POST /api/pen/ink
   channel pen:<pairingId>               "help" (service role,                 { penToken, strokes }
   (RLS: the row is auth.uid()'s)        REST broadcast)                       batched ~150 ms
 inserts ink at typedSpot
```

- **Why relay through the server.** The phone holds only a random pen token (stored hashed), not
  a Supabase session. The server checks it, rate-limits it, caps the payload, logs it in
  `app_events`, and can kill it. The laptop already has a session, so it listens on a PRIVATE
  Realtime channel guarded by an RLS policy on `realtime.messages`. Realtime is enabled in
  `supabase/config.toml`; the app doesn't use it yet. No new vendor.
- **Latency.** One POST per finished stroke (batched while the finger is quick) → broadcast →
  laptop: about 150–400 ms. The phone draws its own ink at once, so the kid never waits.
- **Not chosen:** the phone opening the same board signed in (needs a kid login on the phone,
  and the save queue is debounced and tab-locked, so it isn't live); the phone talking straight to
  Supabase (anonymous auth users, more RLS surface); Vercel WebSocket functions (instances
  still need a pub/sub between them).

## Groundwork already in Type it

- `typedSpot()`: where the next line goes, at what hand size.
- The writer's reusable "put these strokes on the board as the kid's ink, one undo step"
  method, which the phone path feeds with real strokes.
- Fixed line groups: strokes sharing a `typedId` (lead stroke + `typedCount`) are ONE line,
  with no drawing split and no clusterer. With `typedLatex` the line is read as typed; without
  it, the recognizer reads it. A phone line is a group with no `typedLatex`, so the pad's own
  "Next line" decides the line boundaries, not the clusterer.
- The bar's ghost caret and its spot on the board.

## Build (agents, one branch `feat/phone-pen`)

1. **Server + DB:** migration `pen_pairings` (id, code hash, board_id, user_id, created_at,
   claimed_at, pen_token hash, last_seen_at, revoked_at), RLS (owner reads their own), plus a
   `realtime.messages` policy for topic `pen:<id>`. Routes `/api/pen/pair`, `/claim`, `/ink`,
   `/disconnect`: zod, `requireUser` on pair/disconnect, distributed rate limits, a ~32 KB payload
   cap, a claim window of 10 min, a session that ends 2 h after last use. The pg_cron health job
   sweeps old rows.
2. **Phone pad page** `/pen/[code]`: its own light route (no tldraw, no board bundle), a canvas
   with pointer events and pressure, smoothing, the line strip, the buttons, reconnect and retry,
   wake lock, landscape hint, "Connected to the board" state. Kid copy, big targets.
3. **Laptop side:** pairing dialog (QR made in the browser by a small lazy lib, or an SVG from
   the server), the private channel subscription (lazy-loaded with the dialog), stroke
   placement through the writer's method at `typedSpot`, the connected chip, Disconnect, and
   Help me from the phone → `controller.requestHelp()`.
4. **QA:** real phone + laptop over the internet, two phones (the second claim refused),
   expired codes, the laptop reloading mid-session, a flaky network, reading accuracy of finger
   writing vs trackpad writing, and the bundle budget.

## Open questions for the owner

- The phone shows only the pad (v1), or also the problem and the tutor's marks (needs a
  laptop → phone stream: more work)?
- One phone per board, or let a parent's phone and a kid's iPad both write?
- Supabase free tier Realtime: 200 concurrent connections and 2 M messages/month. A 20-min
  session is about 400 messages, so about 5,000 sessions a month before the plan needs a bump.
