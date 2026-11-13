# Demo videos: real maths on the real board, K–8 and real life

For the school demo (2026-11-13): screen recordings of the iPad app's real board on production, a
synthetic kid's hand doing real maths across the grades, and the tutor's real reads, ticks, rings,
hints and written steps. Built on the kid sessions' machinery (docs/KID-SESSIONS.md).

Nothing in them is a real child's writing: the glyphs are the synthetic hands (`StudentHand`), tidy
(`DemoSessions.neat` / `.young`, `KidMess` turned right down).

## The clips

`DemoSessions.all` (AgathonLive/Training/DemoSession.swift):

| id | what it shows |
|---|---|
| dK-add | K: 3 + 4 on a problem page, the answer ticked |
| d1-subtract | Grade 1: 15 − 8 by making ten |
| d2-carry | Grade 2: 47 + 38 stacked, a carry over the tens |
| d3-multiply | Grade 3: 23 × 4 split into tens and ones |
| d4-divide | Grade 4: 156 ÷ 12 in chunks |
| d5-fractions | Grade 5: ½ + ⅓ over sixths |
| d6-equation | Grade 6: x − 7 = 15 |
| d7-slip-fix | Grade 7: 3x + 5 = 20 — a slip (3x = 25), Check rings it with a hint, Got it, crossed out and fixed, ticked |
| d8-help-me | Grade 8: −2x + 7 = −5 — Help me, Show me: the tutor writes −2x = −12 in cobalt, the kid finishes |
| w1-pizza … w5-sale | word problems on the page (pizza, store change, a recipe doubled, miles per hour, 25% off) |

## Running it

```
scripts/ios-demo-videos.sh                                  # build, record all fourteen, cut
DEMOS="d2-carry d7-slip-fix" TAKE=b scripts/ios-demo-videos.sh run cut
```

- Production as qa-bench@agathon.app (Keychain "Agathon QA bench"; an admin, so the training flag spends
  no ink), on "iPad Air 11-inch (M4)" through `~/whiteboardstaging/sim-run.sh`, four takes per hold, the
  status bar at 9:41 and full.
- `-demoRecording` (Debug only) shows the board as a kid's account has it: no Flag a bug, and the player
  takes no pictures of the screen while recording.
- `scripts/demo-video-cut.py` cuts a take to the session's own span (the player's `startedAt` /
  `endedAt`), turns it to landscape, cuts still stretches over 3 s down to about a second, and puts a
  2 s title card (Ink on Paper, Bricolage Grotesque) in front. Frames for review land in
  `<out>/frames/<id>/`.
- Output in `~/whiteboardstaging/demo-videos-1113/` (never committed).
