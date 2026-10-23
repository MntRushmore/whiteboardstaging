# SAT mode v2: the question is the page

2026-10-23, branch `feat/sat2` (off main 86dd95d, which has SAT v1 live from PR #53). Lanes:
`feat/sat2-design` (mockups), `feat/sat2-bank` (content + server), `feat/sat2-board` (the iPad),
merged back here. v1's spec is `docs/SAT-MODE.md`. Everything there still holds unless this file
changes it.

## Why

The owner, on v1: "kinda mid … since we kinda fitting the whole whiteboard into a space." v1 puts a
form-like panel on the left and a small lined card on the right. The board, which is what makes us
different, is the smallest thing on screen.

## The owner's calls (2026-10-23)

- **The question is the page.** The board is full screen and the side panel is gone. On each problem
  page:
  - the stem and its figure are printed at the top, as page content, crisp at any zoom;
  - a roomy work area sits below;
  - the answer choices are cards at the bottom of the page (or the grid-in answer box).
  - The top bar shows "Q4 of 10 · skill", Mark, ‹ n/N ›, and the close button. The dock keeps its
    tools, plus Help me and Check.
- **An ink hint ladder.** Help me climbs three rungs, each one tap:
  1. **Nudge:** one short question or pointer in the tutor's voice ("What's the slope between the
     two labeled points?"), shown as a small note near the work. It's free (from the bank) and works
     without a tutor pass.
  2. **One step:** the tutor writes ONE next step in Cobalt ink in the work area, right under the
     student's last line, then hands the pen back ("Your turn: the next line."). It uses the live
     tutor (the existing Help me machinery), so it needs the day's pass. When there's no pass, it
     falls back to the bank's next solution step, written the same way.
  3. **Walk me through it:** the full solution drawn step by step in Cobalt ink, pausing between
     steps (tap to go on). It comes from the bank's steps, so it's free and works capped.
- **Write on the figure.** The figure is a board object the student can write on:
  - circle points, mark angles, sketch a line on the graph;
  - Graph it and the typed "Graph an equation" draw ONTO the question's own plot, in its coordinates,
    when the question has a plot;
  - ink on a plot is understood in graph coordinates ("a mark near (2, 0)") and sent to the tutor as
    context for its checks and hints.
- **Wrong-answer diagnosis.** A wrong choice (or a common wrong grid-in) gets its own "You picked B.
  Looks like you …" note (the bank's past-tense why, its first letter lowercased; a why that starts "You" or "That's" as it is), then "Try again" / "Walk me through it".
- **Mistake deck.** A missed question comes back 1 day later, then 3 days later. Getting it right on
  a review clears it. SAT home shows "N to review today". A set starts with the due reviews.
- **Two ways.** The solution shows the paper way (the steps) and the Desmos way (`desmos_steps`), side
  by side in landscape and as tabs in portrait, when a Desmos way exists.
- **No pencil gestures this round.** Choosing and crossing out stay as taps on the cards.
- **Mockups first.** Real-size iPad mockups go to the owner. The board lane builds the engine now
  and does the visual chrome after the owner reacts.

## Bank additions (contract; `feat/sat2-bank` fills them, the iPad reads them, all optional)

```jsonc
{
  "nudge": "What's the slope between the two labeled points?",   // rung 1, ≤ 120 chars, no answer given away
  "choices": [{"key":"B","text":"…","why":"Swapped rise and run: (2-0)/(0-4)."}],   // why: wrong choices only, ≤ 140 chars
  "common_wrong": [{"answer":"-1/2","why":"…"}],                 // spr only: 0–3 likely wrong answers
  "solution": { "steps":[…], "desmos_tip": "…"|null,
                "desmos_steps": [{"text":"Type y = 4(x-3)+7","math":"y=4(x-3)+7"}] | null }
}
```

- Every `why` must be the mistake that really produces that choice: re-derive it, and drop the note
  rather than guess. A `nudge` never contains the answer.
- The routes pass the fields through unchanged (`/api/sat/next`).

## Mistake deck (server)

- A `sat_reviews` table, `(user_id, question_id)` pk: `due_on date`, `step smallint` (1 = the
  1-day review, 2 = the 3-day review), `cleared_at`. Owner-only RLS. Anonymous users are allowed,
  like the other sat_* tables.
- `POST /api/sat/attempts`: a miss schedules or reschedules the question (due in 1 day, step 1). A
  correct answer on a due review moves step 1 → step 2 (due in 3 more days), and step 2 → cleared. A
  miss on a review goes back to step 1.
- `GET /api/sat/next` puts the reviews due today (in the user's tz) first, then the adaptive pick.
  Each question carries `"review": true|false`.
- `GET /api/sat/progress` adds `reviews_due` (today) and `reviews_waiting`.
- **The user's tz on the two routes that had none (bank lane, 2026-10-23; additive).** The deck's
  days are the student's, so `POST /api/sat/attempts` takes an optional `"tz"` in its body and
  `GET /api/sat/next` an optional `&tz=` (an IANA zone, like `/api/sat/progress`'s). Absent means UTC;
  a zone the server does not know is a `400 invalid_request`. The iPad sends
  `TimeZone.current.identifier` on both.

#### Route details (bank lane, 2026-10-23; additive)

- Day boundaries: "tomorrow" for a miss and "due today" are the student's date in `tz`; an overdue
  review counts as due. A right answer on a review that is not due yet (a retry in the same set)
  changes nothing, so a question missed and then got right on the second try still comes back
  tomorrow. A second miss the same day changes nothing either.
- `POST /api/sat/attempts` still answers `{ok: true, correct}`. The answer is saved first; if the
  deck write fails it is logged and the answer still counts.
- `GET /api/sat/next`: the due reviews follow the set's `domain` / `skill` / `difficulty` filter,
  oldest due first, at most `count` of them; a review of a question that is no longer live is
  skipped. The adaptive pick fills the rest from the other questions.
- `reviews_due` / `reviews_waiting` count live questions only.
- **SAT home (bank lane, 2026-10-23; additive contract change).** `GET /api/sat/progress` adds:
  - `today.correct`: the right answers on the student's date (in `tz`), beside `today.answered`;
  - `reviews_due_skills`: the skill names (exactly as in the skills table) of the reviews due today
    (or overdue), distinct, at most 3, most-missed first: the most due reviews in the skill, then the
    most wrong answers in it (of the answers progress reads), then the skills table's order. `[]` when
    nothing is due.
- The notes: a row without a note has no key for it (never `null`), except `desmos_steps: null`,
  which means "Desmos doesn't really help here". `choices[].why` is on wrong choices only.
- The migration is LOCAL ONLY until the owner OKs production.

## The tutor on an SAT page (contract, bank lane 2026-10-23; additive)

- **The bank's question is the problem.** When a Live call carries `sat_question_id`
  (`/api/live/recognize`, `/reread`, `/setup`, `/check` (Help me and hints included) and `/solve`),
  the server reads that question from `sat_questions` and adds it to the model's system prompt:
  its stem, its choices, its figure as a short text description (axes, functions, points, segments,
  bars, table cells, shape items and labels) and its solution steps. It never uses text the client
  sent as the SAT problem: the page's text lines are treated as the student's own writing. The steps
  are marked as guidance only, so checks, hints and Help me's next step stay on the bank's path; the
  model is told not to show them or the answer unless the student asks for the solution (Solve). In
  `/recognize` only the vision read gets it (Mathpix takes no context).
- **`sat_figure_marks`** (new, optional, top level of the same bodies, next to `sat_question_id`):
  the student's marks on the question's figure as plain text, in the figure's coordinates, e.g.
  `"circled near (2, 31); a line from about (0, 19) to (2, 19)"`. Trimmed; at most 300 characters,
  one line. Longer, non-text, or with control characters: ignored (the call goes on without it), never
  a 400. Ignored without `sat_question_id`. It is added to the context as the student's marks.
- An id that is not a live bank question: no context, the call goes on as on an ordinary board (the
  free-tutor gate still applies). A malformed id: `400 invalid_request`, as before. No id: the
  requests to the models are exactly an ordinary board's.
- The question is read as the student (RLS: live rows only) and kept five minutes per server
  instance. `/ask`, `/chat` and `/proof` are unchanged this round.

## Not this round

Pencil gestures, R&W, ACT, timed modules, teacher classes.

## Deploy checklist (v2; the owner, at merge time; nothing here is applied to production before)

In this order, on the production project:

1. **Migration, before the code**: `20261023000000_sat_reviews.sql` (the `sat_reviews` table and
   its owner-only RLS, `sat_questions.nudge` and `.common_wrong`, and `anonymous_request_guard()`
   replaced with `/sat_reviews` added to what an anonymous SAT session may write). It is idempotent
   and additive. `npx supabase db push --db-url "$POSTGRES_URL_NON_POOLING" --include-all`, or run
   the file with psql. Then check:
   `select count(*) from public.sat_reviews;` (0),
   `select count(*) from public.sat_questions where nudge is not null;` (0 until step 2), and
   `select prosrc like '%/sat_reviews%' from pg_proc where proname = 'anonymous_request_guard';` (t).
   The v2 code reads the new columns, so it must not be deployed before this step.
2. **Reload the bank** (the notes): `data/sat/sat-bank-v2.sql`, written with
   `JITI_ALIAS='{"@/":"'$PWD'/src/"}' npx jiti scripts/sat/upsert.ts --sql data/sat/sat-bank-v2.sql`
   (no database touched). Run it with psql against `$POSTGRES_URL_NON_POOLING` (or paste it in the
   SQL editor). One transaction, idempotent: every row whose content changed gets `version + 1`; the
   ids are v1's, and one v1 question is retired (`advanced_math-equivalent-expressions-0161`, the same
   question as -0156; its students' answers are kept). Check:
   `select count(*) filter (where status = 'live'), count(*) filter (where status = 'live' and nudge is not null) from public.sat_questions;`
   (351 live, and 346 nudges, as in data/sat/notes-report.json's coverage).
3. **Deploy** the code (the routes and the iPad build that reads the notes and sends `tz`). An
   older iPad build keeps working: the new fields are optional and the routes default `tz` to UTC.
4. Check: miss a question on the iPad, then
   `select step, due_on from public.sat_reviews where user_id = '<that user>';` shows step 1 due
   tomorrow in the student's zone, and the next day `GET /api/sat/progress` shows `reviews_due: 1`.

## The iPad (board lane, `feat/sat2-board`)

Built to `docs/sat2/DESIGN-NOTES.md` (feat/sat2-design) with the owner's six calls as recommended and
the 2026-10-23 change: **Help me and Check at the bottom LEFT, the pens at the bottom right.**
Screens: `docs/sat2/screens/sat2-*.png` (the stubbed UI tests' captures, landscape and portrait).

- **The printed question** (`SATPageLayout` in AgathonSATCore: pure, its numbers pinned in
  `PageLayoutTests`; `SATPagePrinter` in AgathonSAT): the number in the margin, the stem (680 beside a
  figure, 1388 alone), the figure at x 880 (≤ 648) or under the stem, the cards (4 × 346, 112 / 132 tall,
  2 × 2 or one under another for long choices) or the grid-in's field and keypad over the dock's lane.
  The page is the window's height in page units (taller for a long question or for ink low on it) and
  is laid out again when the iPad turns; the question never moves. Printed as `PagePrint`
  (AgathonBoard): drawn in the ink's own tiles under the ink, crisp at every zoom, never a record.
  Dotted paper is the problem page's template (`ProblemPage.paper = .dots`, `keepOut`, `workBottom`).
- **The session** (`SATSessionModel` / `SATSessionScreen`): `BoardEditorView(chrome: false)` with a
  fit-width camera (`CameraConstraints.fitsWidth`), SAT's own top bar and bottom row, taps on the
  printed cards and keys through invisible targets (`sat.choice.X`, `sat.strike.X`, `sat.key.N`). v1's
  gate is unchanged: the first ink claims the pass, `sat_question_id` on every live body.
- **Write on the figure:** a stroke over the figure is tagged `figure: plot|shape` as it is committed
  (`BoardController.strokeTagger`), never read as a line; the plane's marks are summarised in graph
  terms (`SATFigureMarks`) and sent as `sat_figure_marks` (≤ 300) beside `sat_question_id`. Graph it and
  Graph an equation draw onto the question's plane (`LiveLoop.questionPlot`).
- **The ladder:** rung 1 the bank's nudge (note beside the last line, its footer names the next tap);
  rung 2 the live Help me (`LiveLoop.helpOneStep`, Next step) when the page has a pass and a read line,
  else (capped, offline, a 402 `sat_tutor`, nothing read, or nothing written in 12 s) the bank's next
  step after the last matching line (`SATHintLadder.nextBankStep`) in the tutor's hand
  (`LiveLoop.writeTutorMath`), then "Your turn: the next line."; rung 3 the walk-through (captions
  typeset in cobalt, each step's maths in the hand, the walk pill in Check's place).
- **Debug:** `-satStub cap=…,used=…,bank=sample,reviews=N`, `-satStubRead "a|b"` (the quiet tutor's
  reads), `-satAutowrite "line|step:0|circle:auto"` (a student's hand through the touch path), `-satLive`
  (no stubs: the end-to-end run, `SATLiveE2ETests`, skipped without `AGATHON_E2E=1`).
