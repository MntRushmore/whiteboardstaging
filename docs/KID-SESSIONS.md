# Kid sessions: messy homework, end to end

The owner, 2026-10-22: test the iPad app "like a real human doing math — it will be a little messy and
not all in 1 line". The Training Center's bench writes one tidy case per page; a kid session is a whole
homework sitting on the **real board** (the board a kid opens from Home, saved like theirs), written
the way kids write, with the tutor's real routes on production.

Nothing here is a real child's writing. The glyphs are the synthetic hands (`StudentHand`, the web
scoreboard's), moved by `KidMess`. The repo is public: never put a real user's ink in it.

## What a session does

`KidSessions.all` (AgathonLive/Training/KidSession.swift): twelve sessions, grades 2–8.

| id | grade | work | the mess |
|---|---|---|---|
| s01-carry | 2 | 47 + 38 stacked | a carry over the tens, big hand, slow |
| s02-borrow | 2 | 52 − 27 stacked | the 5 crossed out, a 4 over it, a 1 before the 2 |
| s03-wander | 3 | 23 × 4 split up | lines wander right and grow, the answer off to the side |
| s04-slip-help | 3 | 34 × 6 | a slip → ring → Help me → Got it → crossed out, fixed → Now you try one → its problem solved |
| s05-long-division | 4 | 156 ÷ 12 in chunks | tilt and slope |
| s06-side-by-side | 4 | two problems side by side | → New page for this one |
| s07-fractions | 5 | ½ + ⅓ | a leaning, sloping hand |
| s08-decimals-scratch | 5 | 4.5 × 2.3 | a line scribbled out and written again |
| s09-long-think | 6 | x − 7 = 15 | a 22-second think in the middle |
| s10-staircase-keep | 7 | 3x + 5 = 20, then 2x − 4 = 10 under it | a staircase that shrinks → Keep it here |
| s11-negatives-erase | 8 | −2x + 7 = −5 | a sign slip → ring → rubbed out, redone; closed and opened again |
| s12-word-edge | 4 | a word problem | big writing down to the page's edge |

The pen: each stroke through the canvas's own touch path (`simulateStroke`), with a kid's pauses
(`KidPace`: inside a glyph, between glyphs, before the answer, between lines) and a pen of its own
(`KidPen`: slow to start and lift, pressing in and easing off, some strokes quicker or slower).

## What it checks

The player (`ios/Agathon/Debug/KidSessionPlayer.swift`) watches the board four times a second and
judges each line with the Training Center's own code (`TrainingBench.observe`, `TrainingJudge`):

- **no ring on right work** — and **ring on the slip** where there is one;
- **every line as a teacher would mark it** (the catalogue's tick / calm / quiet / ring);
- **reads** (a note: how many lines read as written);
- **kind words** — everything said to the kid (hint cards, notes, cheers) without "wrong", "incorrect",
  "bad", "fail";
- **checks when done** — no mark while the kid is still writing (not within the 9 s pause of their last
  ink, unless they wrote in the answer spot, tapped Check or Help me, or stopped to think);
- **tutor ink clear of the kid's** — the tutor's writing (not its marks, not the problem it gave) not
  on top of a kid's line;
- **what the kid sees** at each `expect` step (the problem page, New page for this one, Keep it here,
  a hint card, Now you try one);
- **the buttons** — the UI test taps the board's real ones; a missing one fails;
- **saved** (s04, s11) — closed and opened again with every stroke (`debug.live`'s `ink N`).

## Running it

```
scripts/ios-kid-sessions.sh                 # build, run all twelve, report
SESSIONS="04 11" scripts/ios-kid-sessions.sh run report
```

Production as qa-bench@agathon.app (Keychain "Agathon QA bench"; an admin, so the training flag spends
no ink), on "iPad Air 11-inch (M4)" through `~/whiteboardstaging/sim-run.sh`, four sessions per hold of
the simulator. About 12–20 tutor calls a session (budgets in `KidSession.budget`, ≤ 250 in all). Each
session opens a new board on the QA account. Output in `~/whiteboardstaging/qa-sessions/<date>/`
(never committed): `report.html`, the player's results and screenshots, the UI test's screenshots and a
screen recording per session.

One session by hand: a Debug build, signed in, launched with
`-kidSession s06-side-by-side -liveTraining 20`; open a new board and it plays (the Check / New page
taps wait 40 s for someone to answer `debug.session.ack`, then the player does them itself and fails
the button check).
