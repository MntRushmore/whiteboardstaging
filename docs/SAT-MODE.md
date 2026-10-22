# SAT mode (iPad)

2026-10-22, branch `feat/sat-mode` (off `feat/ipad-app` 70ab3bc7). Lanes: `feat/sat-bank`
(server + question bank) and `feat/sat-ios` (the iPad screens), merged back here.

## Why

Desmos is what high schoolers rely on because it's free, it's fast, and it's on test day. SAT mode is
our way in: a free place to practise SAT math, with the question on one side and a real whiteboard on
the other, plus the tutor that teaches instead of handing over answers. It's iPad only (not the web
app).

## The owner's calls (2026-10-22)

- **Free, with a capped tutor.** Questions, the board, the answer check and the written solution are
  free forever with no Unlimited needed. The live tutor (reading lines, ticks, rings, hints, Help me)
  is free for **5 SAT questions a day** (`SAT_FREE_TUTOR_PER_DAY`, default 5). Unlimited lifts the
  cap. After the cap the board keeps working as plain ink, and Graph it still works.
- **Our own bank.** About 600 original SAT-style math questions. No College Board items, wording or
  figures, ever. Every answer is checked by solving it independently.
- **Grown-up Blocks.** The same tokens, fonts and ring/dot/bar as AgathonDesign, but calmer: no
  mascot faces, no stickers, no confetti. It should feel like a serious, friendly study tool for
  15–18 year olds.
- **Math only first.** Reading & Writing could come later as its own mode. ACT is not in scope.

## The SAT math we mirror (public test spec, our own content)

The four domains and their skills (about 35/35/15/15% of the section):

| domain key      | skills |
|-----------------|--------|
| `algebra`       | linear equations in one variable; linear equations in two variables; linear functions; systems of two linear equations; linear inequalities |
| `advanced_math` | equivalent expressions; nonlinear equations and systems; nonlinear functions |
| `psda`          | ratios, rates, proportions, units; percentages; one-variable data (distributions, centre, spread); two-variable data (models, scatterplots); probability; inference from samples and margin of error; evaluating statistical claims |
| `geometry_trig` | area and volume; lines, angles, triangles; right triangles and trigonometry; circles |

The two formats are `mcq` (four choices, A–D) and `spr` (student-produced response, "grid-in"). About
25% of questions are `spr`. SPR rules: a positive answer is at most 5 characters, a negative one at
most 6 including the minus sign. Fractions and decimals are both fine, mixed numbers are not, and a
decimal must be as precise as the space allows. Difficulty is 1 (easy), 2 (medium) or 3 (hard), with
the bank split roughly 1/3 each.

## Contract between the lanes

### Tables (Supabase, migration `2026102200000x_sat_mode.sql`, LOCAL ONLY until the owner OKs prod)

`sat_questions`
- `id text pk`: `<domain>-<skill-slug>-<nnnn>`, stable forever
- `domain text`: one of the four keys above
- `skill text`: the skill name exactly as written in the table above
- `difficulty smallint`: 1–3
- `format text`: `mcq` | `spr`
- `stem text`: Markdown with inline `$…$` / display `$$…$$` LaTeX. Plain enough for SwiftMath:
  `\frac \sqrt ^ _ \cdot \le \ge \ne \pi \theta \sin \cos \tan \circ \overline \angle \triangle`
- `figure jsonb null`: see Figures
- `choices jsonb null` (mcq): `[{"key":"A","text":"…"}, …]`, the same Markdown and LaTeX as `stem`
- `answer jsonb`: mcq `{"key":"C"}`. spr `{"accepted":["3/4","0.75",".75"]}`, which lists every
  form a correct grid-in could take
- `solution jsonb`: `{"steps":[{"text":"…","math":"…"|null}], "desmos_tip":"…"|null}`. That's 2–6
  short steps, and the tip says how to do it on the test-day graphing calculator (Desmos), when that
  really helps
- `status text`: `live` | `draft` | `retired`. The app only ever sees `live`
- `version int`, `created_at`
- RLS: any signed-in user can read `live` rows. Writes come only from the service role.

`sat_attempts`: `id uuid`, `user_id`, `profile_id` (as the rest of the app does it), `question_id`,
`chosen text` (`"B"` or the typed grid-in), `correct bool`, `used_tutor bool`, `seconds int`,
`created_at`. Owner-only RLS.

`sat_tutor_passes`: `(profile_id, question_id, day date)` pk. One row is one free tutor question
used on that day (the day is in the user's time zone, sent by the client as `tz`).

### Routes (Next.js, `src/app/api/sat/…`, the app's usual auth)

- `GET /api/sat/next?count=10&domain=&skill=&difficulty=` returns `{questions:[SATQuestion]}`
  with the answer and solution included (it's free practice, and that lets checks happen offline and
  instantly). Pick questions adaptively: unseen first, weak skills weighted up, difficulty following
  the last ~10 answers in that domain. Never repeat a question within 30 days unless the bank is
  exhausted.
- `POST /api/sat/attempts {question_id, chosen, correct, seconds, used_tutor}` returns `{ok}`.
- `POST /api/sat/tutor {question_id, tz}` returns
  `{allowed, used_today, cap, unlimited}`. It's idempotent: the same question on the same day
  doesn't use a second pass. When `allowed` is false the app keeps the tutor off for that page.
- `GET /api/sat/progress?tz=` returns
  `{answered, correct, by_domain:[{domain, answered, correct}], by_skill:[…], streak_days,
  today:{answered, tutor_used, cap, unlimited}, estimate:{low, high}|null}`. `estimate` is a
  200–800 math-section band, `null` until 15 questions are answered, and the band narrows as more
  are answered. It must be honest: label it as a rough estimate from practice, never as a score.
- **Server enforcement:** when an SAT page's live calls (recognize/check/hint/Help me) send
  `sat_question_id`, a user without Unlimited is allowed only if a `sat_tutor_passes` row exists for
  today. Otherwise the call returns the usual out-of-ink style refusal. Ordinary boards keep their
  current rules.

#### Route details (bank lane, 2026-10-22; additive to the contract above)

- **`sat_question_id` on the live routes.** Put it at the top level of the JSON body of
  `POST /api/live/recognize`, `/reread`, `/setup`, `/check`, `/solve`, `/ask`, `/chat` and `/proof`
  (the other fields are unchanged). It must be a bank id (`<domain>-<skill-slug>-<nnnn>`): anything
  else is a `400 invalid_request`; absent or `null` is an ordinary board. With it:
  - Unlimited: charged exactly as on any board (no ink, the fair-use count).
  - No Unlimited, and a pass for that question today: the call goes through and spends **no ink**
    (a free student with no ink at all is not refused).
  - No Unlimited and no pass: `402 ink_empty`, the same body as out of ink (`remaining`, `cost`,
    `buyUrl`) plus `reason: "sat_tutor"` and `sat: "no_pass" | "pass_used_up"`.
  - "Today" for a live call is any pass day that is today somewhere on Earth (UTC-12..UTC+14),
    because the live calls send no `tz`.
  - One pass lets through at most 200 ink-priced units of live calls (recognize 1, check 3, solve
    10, ...), far more than one question needs, so a pass can't become a free day of tutoring on other
    boards. Past it the call gets the 402 with `sat: "pass_used_up"`.
- **`POST /api/sat/attempts`** answers `{ok: true, correct}`: the server decides `correct` from the
  bank's answer (an mcq key, or a grid-in in any accepted form or an equal value like `6/8` for
  `3/4`) and stores that, whatever the app sent. `404 not_found` for a question that isn't live.
- **`POST /api/sat/tutor`**: the iPad calls it on the first stroke on a question's page (not when
  the question opens); `tz` must be an IANA zone (`400` otherwise); `404` for a question that
  isn't live; Unlimited is always allowed and its pass is still recorded (so `used_today` counts it).
- **`GET /api/sat/progress`**: `tz` defaults to UTC. `estimate` is `{low, high, note}` or null;
  `note` is the honest label to show with it ("A rough estimate from practice questions, not an SAT
  score."). The model (src/lib/sat/estimate.ts): each answer is a Rasch item with difficulty 1/2/3 at
  -1/0/+1 logits; ability is the MAP estimate under a standard normal prior from the newest 120
  answers; centre 500 + 120·θ, half-width 120·SE + 20, rounded out to tens, kept in 200..800. With 15
  answers the band is about 150 wide, about 90 at 120 answers. `streak_days` counts days in a row with
  an answer, ending today (or yesterday, when nothing is answered yet today).
- **`GET /api/sat/next`**: `difficulty` is 1, 2 or 3; `skill` is a skill name exactly as in the
  table (URL-encoded). Errors are `400` (bad query) and `502` (the bank couldn't be read).
- Every SAT route is no-store and carries `X-Request-Id`. Rate limits per user: next/progress 60 a
  minute, attempts 60, tutor 30.
- **Figures, exactly.** Only the keys shown below exist. A plot `function`'s `expr` uses numbers, `x`,
  `+ - * /`, parentheses and `**` for powers (never `^`, never a unary minus right before `**`: the
  bank writes `9-(x-1)**2`). `arc_angle`'s `from`/`to` are the directions of its two rays, in degrees
  counter-clockwise from +x, swept from `from` to `to`. Labels may hold inline `$…$` LaTeX.
- The sample: `docs/sat/sample-20.json` (20 hand-checked questions, both formats, all four domains,
  every figure kind and item).

### Figures (`figure` jsonb, drawn natively by the iPad with Canvas, never an image)

```jsonc
{ "kind": "table", "headers": ["x","f(x)"], "rows": [["0","3"],["1","5"]] }
{ "kind": "plot",                        // a coordinate plane, line/scatter/bar data
  "x": {"min":-5,"max":5,"step":1,"label":"x"}, "y": {"min":-5,"max":5,"step":1,"label":"y"},
  "grid": true,
  "items": [
    {"type":"function","expr":"2*x+1"},            // JS-style expression in x
    {"type":"segment","from":[0,0],"to":[3,4]},
    {"type":"point","at":[2,5],"label":"(2, 5)"},
    {"type":"bar","x":1,"height":12,"label":"Mon"}
  ] }
{ "kind": "shape",                        // geometry, its own units, y up
  "items": [
    {"type":"polygon","points":[[0,0],[4,0],[0,3]]},
    {"type":"circle","center":[0,0],"r":2},
    {"type":"segment","from":[0,0],"to":[2,0],"dashed":true},
    {"type":"label","at":[2,-0.3],"text":"4"},
    {"type":"right_angle","at":[0,0],"dirs":[[1,0],[0,1]]},
    {"type":"arc_angle","at":[4,0],"from":180,"to":143,"label":"$x^\\circ$"}
  ],
  "note": "Note: Figure not drawn to scale." }
```

## The iPad screens

- **Entry:** a "SAT practice" card on Home, for every profile with no subscription needed. In phase 2,
  onboarding gets a "I'm studying for the SAT (13+)" path where the student makes their own account
  and lands in SAT mode.
- **SAT home:** today (answered, free tutor questions left out of 5), a domain/skill picker,
  "Practice 10" (mixed and adaptive), "Pick a skill", and progress (by domain, then skill, and the
  estimate once there is one).
- **The session (split view, landscape first):**
  - **Left, the question panel** (~38%, a draggable divider, collapsible to a tab): "Question 3 of
    10", the skill chip, Mark for review, the stem and its figure, then either
    - mcq: four choices with tap to choose and a Bluebook-style eliminator (strike a choice out), or
    - spr: a grid-in field that follows the SPR rules.
    Then a Check button.
  - **Right, the board:** the real `BoardEditorView`. A session is one board, and each question gets
    its own problem page. The page's problem is the SAT question, so the tutor judges the student's
    ink against it. The page header is small (`Q3 · Linear functions`), because the question itself
    lives in the panel.
  - **Tutor:** the student's FIRST STROKE on a question's page calls `POST /api/sat/tutor` (owner,
    2026-10-22: "we just want ppl to use it"). Opening, browsing, choosing or checking an answer
    without writing on the board uses no pass. Asking again for the same question the same day is
    free (the pass is idempotent per question per day). If it's allowed, the live tutor is on for
    that page from that stroke. If not, it shows a quiet line ("Free tutor used up for today: 5 of
    5. The board still works. Unlimited lifts it.") and the tutor stays off.
  - **Check:** right turns green and shows "See the solution". Wrong lets them try again once, then
    offers the solution. The solution shows its steps, plus the Desmos tip when there is one. Every
    answer posts an attempt.
  - **End of set:** score n/10, each question's result, review the missed ones, "Practice 10 more".
- **Portrait:** the panel sits on top (resizable), with the board below.

## Not now

Reading & Writing, ACT, full timed practice tests (two adaptive modules, 22 questions each), an
in-app Desmos (its API licence needs a deal), teacher classes.
