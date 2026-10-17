# Agathon design system: Blocks

The iPad app's look, built from brand direction **A · Blocks** (the owner's pick, 2026-10-17,
with direction C's sticker book for practice rewards). The brand page is
`docs/brand/directions.html`, section "Blocks". The code is the local Swift package
`ios/Packages/AgathonDesign`, already a dependency of the app target.

**Blocks: Bold, Bright, Clear.** The logo's three parts (a ring, a dot and a bar) become every
card, trail and button. Flat primaries on white and chalk. The tutor writes in cobalt, and only
the tutor does.

## Using it

```swift
import AgathonDesign

Text("Today's practice").dsFont(.title)            // type: Dynamic Type, optical size, tracking
    .foregroundStyle(DS.Color.ink)                 // colour: semantic names, never hex in screens
PillButton("Continue", icon: .play, kind: .sunny, size: .large) { … }
Card(.cobalt, deco: true) { … }
```

- Everything lives under `DS`: `DS.Color`, `DS.Font`, `DS.Space`, `DS.Radius`, `DS.Size`,
  `DS.Stroke`, `DS.Motion`, `DS.Icon`, `DS.KidPen`, `DS.Fill`.
- Fonts register themselves the first time any `DS.Font` or `.dsFont` is used. No setup call.
- **Design Gallery:** run the app with `-designGallery` (Debug) to see every token and component.
  `-designGalleryPage colour|type|shape|controls|feedback|brand|stickers` opens a page,
  `-designGalleryScreen splash|offline` opens a screen, and `-designGalleryAnchor <id>` scrolls to
  a section. Code: `ios/Agathon/Debug/DesignGallery.swift`.
- **Tests:** `cd ios/Packages/AgathonDesign && xcodebuild test -scheme AgathonDesign -destination
  'platform=iOS Simulator,name=iPad mini (A17 Pro)'`.
- **Screenshots:** `docs/qa-screenshots/ipad-design-*.png` (iPad mini, default and large text).

## Tokens

### Colour (`DS.Color`, values in `DS.ColorTokens`, raw `DS.Palette`)

| Name | Hex | Use |
|---|---|---|
| `ground` | #F1F2F6 chalk | behind everything |
| `paper` / `surface` | #FFFFFF | the writing page; cards, tiles, round buttons on the ground |
| `surfaceSunken` | #F1F2F6 | inputs and chips on paper |
| `ink` | #14151F | text, the dock, primary buttons |
| `inkSecondary` | #5B5E6E | secondary text (never on sunny) |
| `onInk` / `onInkSecondary` / `onInkFaint` | #FFFFFF / #BDBDC0 / #3E3F47 | text, quiet text and resting parts on ink |
| `sunny` | #FFD12E | Help me, go buttons, the active tool, stars |
| `tomato` | #FF5A36 | the bar, "now" on the path, avatars, streak |
| `tutorInk` (= `cobalt`) | #2D5BFF | **the tutor only**: ticks, rings, hints, tutor bubbles, Today's card |
| `cobaltDeep` | #2148E3 | deco on a cobalt card, pressed cobalt |
| `tutorInkEmpty` | #D9E1FF | the tutor's ink run dry |
| `success` | #12A150 | "You got it." |
| `tryAgain` | #FFD12E | "Look again." Yellow, like Help me: a nudge, never red |
| `focus` | #2D5BFF | focus rings |
| `line` | #E2E4EB | the one functional hairline (a thumbnail's edge) |

- **Kid pens** (`DS.KidPen.all`): black #14151F, red #E5302A, orange #F58700, green #12A150,
  pink #E9449A. None is blue or purple. Every pen is at least ΔE00 25 from tutor ink (pink is
  the closest at 33) and none has a hue between 250° and 330°. `PenDistanceTests` enforces both.
- **Contrast:** every text pairing in use is listed in `DS.ContrastPair.all` and must pass WCAG
  AA. Text on sunny is always ink; sunny text sits only on ink, or on cobalt at large sizes.
- **Dark mode:** each `ColorToken` has room for a `dark` value. None is designed yet, so the app
  stays light.
- **Flat only.** Anything that would be a transparency on the page (white at 18 % on ink) is a
  real, opaque colour here.

### Type (`.dsFont(_:)`, or `Font.ds(_:)` where only a `Font` fits)

| Style | Font | Size | Notes |
|---|---|---|---|
| `display` | Bricolage Grotesque ExtraBold | 64 | −0.045 em, capped at 1.6× |
| `title` | Bricolage ExtraBold | 32 | −0.035 em |
| `headline` | Bricolage ExtraBold | 24 | −0.03 em; card heads, board title, sheet title |
| `bigNumber` | Bricolage ExtraBold | 46 | streaks, counts |
| `heading` | Lexend SemiBold | 22 | |
| `body` | Lexend Regular | 19 | line height 1.4 |
| `callout` | Lexend Regular | 17 | chat |
| `button` | Lexend SemiBold | 19 | |
| `caption` | Lexend Regular | 14 | |
| `label` | Lexend SemiBold | 14 | capitals, +0.1 em |
| `numeral` | Lexend SemiBold | 30 | tabular digits |
| `tutorHand` | Kalam Bold | 30 | the tutor's hand, in tutor ink only |

Every style follows Dynamic Type. `.dsFont` also sets Bricolage's optical size to the point size,
which is what the brand page does; Core Text doesn't do this by itself. Fonts: unmodified OFL
files from google/fonts with their licences, in `Sources/AgathonDesign/Resources/Fonts`.

### Space, shape, motion

- **Space:** 4 · 8 · 12 · 16 · 20 · 28 (inside a card) · 40 (screen margin) · 64.
- **Radii:** cards 28, big Home cards 32, tiles 24, page 18, thumbnails 16, swatch 14, bubble 22
  (tail 6). Buttons and chips are capsules. Tools are circles.
- **Borders:** none. **Shadows:** none. Depth is a change of colour.
- **Targets:** every kid control is at least **56 pt** (the floor is 52). Tools 56, main buttons
  64, Help me 72 tall and the biggest thing on the board. A pen swatch looks 42 pt and has a
  56 pt target.
- **Motion, "snap":** `DS.Motion.snap` (about 220 ms, one small overshoot). A press shrinks to
  96 % and darkens. The tutor's tick draws in one stroke (`DS.Motion.draw`). The mark assembles:
  ring, then bar, then the dot drops in. Use `withDSAnimation` / `.dsAnimation`: under Reduce
  Motion they become instant changes, and the shapes and stickers hold still.

## Components

| Component | What it is |
|---|---|
| `PillButton`, `.buttonStyle(.pill(…))` | `primary` (ink), `sunny` (go), `secondary` (paper on ground), `secondaryOnPaper` (chalk), `quiet`; optional icon badge; `regular` 56 / `large` 64 |
| `HelpMeButton` | sunny, 72 pt, the mark in ink. One per board, and the board's only yellow |
| `RoundButton` | icon in a circle (back, more, close, mic) |
| `ToolButton`, `PenSwatch`, `Dock`, `DockSeparator` | kid tools, on the ink dock (`.dock`) or the ground (`.light`) |
| `IconCircle`, `DSIcon`, `DS.Icon` | the icon set: SF Symbols named by meaning |
| `Card`, `CardDeco` | flat cards: paper, chalk, cobalt, sunny, ink; `deco` adds the mark's ring and dot |
| `Chip`, `Tag`, `StatusPill` | tappable suggestion chips (52 pt), labels ("NEXT UP"), "Checking…" |
| `Avatar`, `ProfileChip` | a kid's initial; the name chip |
| `ChatBubble` | tutor bubbles are cobalt, kid bubbles chalk |
| `SegmentedPicker` | ink pill snaps between segments; scrolls at big text sizes |
| `PillField` | text field (with secure mode and a focus ring) |
| `PinPad`, `PinKey`, `PinDots` | the grown-ups' PIN |
| `SheetHeader` | Bricolage title, a tag, chalk round buttons |
| `Banner`, `CheerPill` | success / look again / tutor / paused / offline; "Nailed it." |
| `EmptyState` | big icon (or the shapes), title, one kind line, one action |
| `ProgressRing`, `SkillPathNode`, `SkillTrail` | the path is the logo: done is a dot, now is the ring |
| `StarRow`, `StreakBadge`, `WeekDots` | stars, streak, this week |
| `InkMeter` | the tutor's ink as the mark's bar laid down, in words ("Ink is low"), never numbers or prices |
| `CelebrationBurst` | flat confetti made of rings, bars, dots and stars |
| `Sticker`, `StickerBook` | die-cut practice rewards |
| `FlowStack` | wraps chips and buttons onto new lines |
| `AgathonMark`, `Wordmark`, `AgathonLogo`, `AppIconArt` | the brand |
| `TheShapes` | the character (below) |

## The shapes (the character)

Blocks has no mascot. The ring, the bar and the dot get eyes **only for big moments**.

- **Poses:** `.hello` (first run, a new kid profile), `.thinking` (a long wait for the tutor),
  `.celebrate` (a finished set, a new streak, a skill mastered), `.outOfInk` (help is paused; always
  with "Ask a grown-up to switch it back on").
- **Never:** on the board while the kid is writing, next to a mistake, or as decoration on
  ordinary screens. An empty state uses an icon, not the shapes.
- **Size:** 24 to 200 pt wide (`TheShapes.aspectRatio` is 220:130). Under about 72 pt the eyes
  grow and the extras (thought dots, confetti, z's) drop out.
- **Motion:** blink every 4.2 s and a small idle bob. `animated: false` and Reduce Motion hold it
  still.

## Stickers

Stickers are for **practice wins only**: never on the board, never in Ask.

- `star`: a problem done on your own.
- `ring`: one done with a hint.
- `flame`: a streak.
- `perfect`: 5 for 5.
- `mark`: a skill mastered (rare).

They read best on ink or another colour, where the white edge shows. `StickerBook` defaults to an
ink page.

## Logo

- The mark: a cobalt ring, a sunny dot and a tomato bar (`MarkGeometry`). Use the one-colour ink
  version on Help me.
- The lockup is `AgathonLogo`: a 76 pt mark box to 58 pt type.
- The app icon is the mark on ink. Regenerate `AppIcon.png` and `Logo.png` with
  `swift ios/Packages/AgathonDesign/Scripts/render-brand-assets.swift ios/Agathon/Resources/Assets.xcassets`.

## Do and don't

- **Do** use `DS.Color` names. **Don't** write hex in screens.
- **Don't** use gradients, shadows or borders. `FlatColourTests` fails the build if a gradient or
  shadow shows up in the package.
- **Don't** use cobalt for anything the kid makes or controls. **Don't** add a blue or purple pen.
- **Don't** use red for a mistake. Use "Look again" (yellow). The word "wrong" never appears.
- **Do** keep copy short and sure, like a coach: full stops, few exclamation marks. US English.
- **Don't** show prices to kids. Out of ink sends them to a grown-up.
- **Do** keep controls at 56 pt and up, and check new screens at large Dynamic Type sizes.

## Where we differ from the brand page, and why

- **"Today's practice" label:** the page sets it in sunny on cobalt. At 14 pt that's 3.6:1, which
  fails AA, so the label is white. Sunny stays for stars, the flame and big numbers on cobalt.
- **Bigger targets:** pen swatches keep the page's 42 pt look with a 56 pt target. Sheet buttons
  grow from 48 to 52 pt (56 target). Chips grow from about 44 to 52 pt. These follow the page's own
  56 pt rule.
- **Poses:** the page shows the shapes once. The four poses use its geometry and palette.
  Out-of-ink adds a flat pale cobalt (`tutorInkEmpty`).
- **Stickers:** Sticker Book's stickers are redrawn in Blocks shapes and colours. The lift under
  each one is a flat shape in a solid colour, not a blurred shadow.
- **Ink meter:** the page has none. It is the mark's bar, in tutor ink.
- **Icons:** SF Symbols at semibold stand in for the page's hand-drawn 2.6 pt set, which is close.
  `DS.Icon` names them by meaning, so a custom set can replace them in one file.
- **Flattened colours:** the page's translucent overlays (white at 18–40 % on ink or cobalt) are
  opaque mixed colours.
- **Accent colour:** the app's `AccentColor` is now cobalt #2D5BFF (it was the old site blue
  #2563EB), matching the page's focus colour.
