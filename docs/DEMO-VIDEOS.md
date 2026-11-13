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

## The picture tutor's clips (what was shown, 2026-11-13)

The owner's direction moved the demo to the picture tutor (Draw now → the pen reads along → the picture
drawn on as a ghost → Accept → tutor blue; Feedback's arrow and note; checkmarks on right work), in an
OG-style flow: the kid writes the question, the tutor answers on the board in handwriting and pictures.

- **The hand:** `scripts/demo-pen.py` lays a single-line font (EMS Readability Italic, SIL OFL — from
  Inkscape's svg_fonts, kept on this Mac, `--font`) out in the page's units with per-glyph size, slant,
  rotation and baseline variation, a wobbling pen and a writer's pace; `{3/8}` is a stacked fraction,
  `²` a superscript. Debug's `PictureDemoPlayer` (`-pictureDemo <script.json>`) writes it through the
  canvas's touch path at 0.65 of the regular pen width, keeps the kid's answer clear of the tutor's
  picture and above the page's last fifth (the out-of-room tip), holds the tutor's own look off while the
  question is written, and taps Draw now / Accept through the UI test (`testPictureDemo`).
- **The clock:** the simulator's recording stamps frames as they arrive, so the player shows the step it
  is on in a 6-point square in the window's corner (red = step × 6, green flickering every refresh);
  `scripts/demo-picture-cut.py` reads it back (with the recording's colour offset), so every cut is tied
  to the picture, not to wall time.
- **The edit:** the iPad in an Ink bezel on a flat stone background (or full-bleed when zoomed), eased
  zoom on the writing and on the picture with its question, writing ~2.6×, the tutor's reading ~2.4×, the
  picture drawn on at real speed, still waits squeezed; `--no-card --label` for the showcase's segments,
  `scripts/demo-reel.py --open` for the opening card, the segments and the Agathon end card,
  `scripts/demo-finalize.sh` keeps a file under 14 MB.

```
PICTURES="p2-array p3-area" TAKE=h scripts/ios-demo-videos.sh pictures
python3 scripts/demo-picture-cut.py ~/whiteboardstaging/demo-videos-1113 p2-array h --no-card --label "Grade 3 · 6 × 4 as an array"
```

Painter misses seen while recording (never kept): base-ten blocks for 47 + 38 drew 38 as two rods and the
sum as six rods; fraction bars for ½ + ⅓ shaded the sixths bar wrong in three takes; Suggest on 6 × 4 wrote
only words, on 34 × 6 an empty area model and then a second nudge after right work.
