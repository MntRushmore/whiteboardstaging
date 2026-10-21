# The Agathon board format (schema v1)

Started 2026-10-17 by the board lane of the iPad app (docs/IPAD-NATIVE.md). This is the document the
native board (`ios/Packages/AgathonBoard`) reads and writes. It is Agathon's own format, not tldraw's.

The plan keeps it in a new `whiteboards` column next to the tldraw `data`. The server's board
readers move to it in Phase 1: the report replay, the admin viewer, the gc job and `report/server.ts`.
This page is the contract they read.

## The idea

A board is a **flat table of typed records keyed by a stable id**, the same shape as tldraw's store.
That shape gives four things:

- **Save, merge, undo and sync all work on records.** Two copies merge record by record, and the
  local edit wins (the web's `mergeDocumentRecords`).
- **Every change is a diff** of records added, updated and removed (`ChangeSet`).
- **The records are Agathon's own:** screens, the kid's and the tutor's ink, and what the tutor
  read and marked. These are first-class records, not `meta` hung on generic shapes.
- **`meta` on every record** carries extra data without a schema change.

## Coordinates

- Everything is in **page units**. A screen is 1600 × 900, the web's `SCREEN`.
- Each screen has its own page space. Its `rect` is where the 16:9 screen sits in that space:
  - every new screen is `{0, 0, 1600, 900}`;
  - a page converted from an older board can have a bigger rect, grown around its ink (below).
- `y` points down.
- Rotation is in radians, clockwise on screen, about the record's `x, y`.

## The envelope

```json
{
  "format": "agathon.board",
  "schema": 1,
  "records": { "<id>": { "id": "<id>", "type": "<type>", … }, … },
  "meta": { … }
}
```

- `records` is keyed by id, and each record repeats its own `id`.
- `meta` is optional, for document-level extras.
- Keys are written sorted (`JSONEncoder.sortedKeys`), so the same document always gives the same bytes.
- Fields at their default value are left out (see each table).

**Readers:**

- **Newer schema.** A reader refuses a document whose `schema` is newer than it knows
  (`newerSchema`). An older app must never save over a newer app's board.
- **Older schema.** It is migrated first, on the raw JSON, one step per version (below).
- **Unknown record `type`.** Kept whole and written back unchanged (`UnknownRecord`).

## Ids and order

**Ids** are `<type>:<key>`, for example `stroke:k3VbQ8wZp2Lr`:

- a fresh key is 12 random base-62 characters;
- a converted record keeps the tldraw key (`shape:abc` → `stroke:abc`, `page:xyz` → `screen:xyz`),
  so converting the same board twice gives the same ids;
- ids never change and are never reused.

**Order** is a fractional index (`order`, a string):

- the same scheme as tldraw's `index` (`a0`, `a1`, `a1V`, …, Greenspan's `fractional-indexing`);
- keys compare **by UTF-8 bytes**, so uppercase sorts before lowercase;
- a record goes between two others without renumbering anything.

What `order` means depends on the record:

- **Screens:** their order on the board.
- **Drawn records** (`stroke`, `shape`, `image`, `math`, `graph`): their z-order on their screen,
  later on top. New ink goes on top, after the screen's last key. Ties break by id.
- **`mark`, `line` and `problem`:** these are not drawn and have no `order`.

## Records

Every record has `id`, `type` and optional `meta` (an object; left out when empty). An `author` is
`"kid"` or `"tutor"`.

### `screen`: a 16:9 page of the board

| field | type | notes |
|---|---|---|
| `order` | order key | the screens' order |
| `rect` | `{x, y, w, h}` | the screen in its page space; `{0,0,1600,900}` for every new screen |
| `name` | string? | |

A board has 1 to 50 screens (`ScreenRecord.maxScreens`, the web's `MAX_SCREENS`). The camera stays
on the current one.

**A problem page** (docs/PROBLEM-PAGES.md) is a screen with `meta.page`: `kind` (`problem` | `done`),
`set`, `index`, `count`, `problem` (its `problem` record), `origin`, `workTop`, `answer` (false: no
answer spot). A problem that needed more room ("More room", 2026-10-21) spreads over more screens:

| `meta.page` key | on | meaning |
|---|---|---|
| `continues` | every page of the problem after its first | the problem's first page (a screen id) |
| `more` | every page of the problem but its last | the problem goes on on the next page: no answer spot here (it is on the last page) |

The pages of a problem are its first page and every screen whose `continues` names it, in the screens'
order (they are kept next to each other). A page whose first page is gone stands on its own. Its
`set`, `index`, `count`, `problem` and `origin` are the first page's. The problem again, small, at the
top of each later page is ordinary tutor ink (or a typeset `math` / an `image`) with
`meta.reminder: "<first page id>"` and `locked: true`. The problem's `problem` record stays on its
first page and its `lines` list its lines on every page, in order.

These are meta keys: no schema bump, no migration (an older reader shows the pages as plain pages of
the set).

### `stroke`: one pen-down … pen-up of ink, the kid's or the tutor's

| field | type | default | notes |
|---|---|---|---|
| `screen` | id | | |
| `order` | order key | | z-order |
| `author` | `kid` \| `tutor` | | |
| `color` | colour token | | see Colours |
| `width` | number | | the pen's base width; see The pen |
| `pressure` | `real` \| `simulated` | | `real`: a Pencil's force, or the tutor's pen hint; `simulated`: a finger or mouse |
| `x`, `y` | number | | the stroke's origin; points are relative to it |
| `rotation` | number | 0 | about the origin |
| `points` | string | | compact points (below) |
| `start` | number? | | pen down, ms since the Unix epoch; absent on old ink that was never timed |
| `closed` | bool | false | the outline is a closed shape |
| `fill` | `none` \| `semi` \| `solid` \| `paper` | `none` | painted inside a `closed` stroke: a tint, the colour, opaque paper white |

**Replay timing.** Each point has its own time, in ms after `start`. Pen up is `start + last.t`. The
replay plays a stroke as fast as it was drawn.

**The tutor's handwriting** is ordinary strokes with `author: "tutor"`:

- each point is timed at the pace it was revealed;
- `meta` carries the web's keys: `live: true`, `source`, `lineId`, `createdAt`, `handBlock` (one
  written block) and `handLine` (the LaTeX of its line).

### `shape`: the Shapes tool

| field | type | default | notes |
|---|---|---|---|
| `screen`, `order` | | | |
| `author` | | | |
| `kind` | `rect` \| `ellipse` \| `line` \| `arrow` | | |
| `x`, `y`, `rotation` | number | rotation 0 | |
| `w`, `h` | number | 0 | `rect`, `ellipse`: the box from `x, y` |
| `points` | `[{x, y}]` | `[]` | `line`, `arrow`: relative to `x, y`, first to last; an arrow's head is at the last |
| `color`, `width` | | | |
| `fill` | as `stroke` | `none` | |

### `image`: a picture or a PDF page

| field | type | default | notes |
|---|---|---|---|
| `screen`, `order` | | | |
| `author` | | `kid` | |
| `x`, `y`, `w`, `h`, `rotation` | number | rotation 0 | |
| `asset` | `{src, mime?, w?, h?}` | | `src`: the `board-assets` public URL, never a `data:` URL in a saved board; `w, h`: the image's own pixels |

A PDF page put on the board (the page picker) carries `meta`: `locked: true` (Select and the eraser
leave it alone; it is the worksheet), `protected: true` (kept from the tutor), `kind: "pdf"`,
`fileName` and `page` (1-based), as the web's PDF upload does. The eraser never takes a picture.

### `math`: typeset maths

| field | type | default | notes |
|---|---|---|---|
| `screen`, `order` | | | |
| `author` | | `tutor` | |
| `role` | `readback` \| `answer` \| `note` | | `readback`: the grey echo of what was read; `answer`: typeset maths the tutor wrote |
| `latex` | string | | |
| `x`, `y`, `w`, `h` | number | | |
| `fontSize` | number | 24 | the web's `s` 18, `m` 24, `l` 32 |
| `line` | id? | | the `line` it reads back or answers |

### `graph`: a plotted graph

| field | type | default | notes |
|---|---|---|---|
| `screen`, `order` | | | |
| `author` | | `tutor` | |
| `x`, `y`, `w`, `h` | number | | |
| `functions` | `[{id, expr, latex, color}]` | | `expr`: the engine's (mathjs) expression |
| `points` | `[{x, y, label}]` | `[]` | |
| `window` | `{xMin, xMax, yMin, yMax, autoY}` | | |
| `grid` | bool | true | |
| `title` | string | `""` | |
| `line` | id? | | |

### `mark`: the tutor's tick, ring or question mark

| field | type | notes |
|---|---|---|
| `screen` | id | |
| `kind` | `tick` \| `ring` \| `question` | |
| `target` | id? | the `line` it marks |
| `strokes` | `[id]` | the tutor strokes that draw it, in the tutor's hand |
| `why` | string? | the web's `meta.markWhy`: `unread`, `unjudged`, … |

The mark's ink is ordinary tutor strokes; this record says what they mean.

- If the kid erases those strokes, the mark loses its ink but stays.
- A reader must accept a `strokes` entry that no longer exists.

### `line`: a line of the kid's work, as read

| field | type | default | notes |
|---|---|---|---|
| `screen` | id | | |
| `strokes` | `[id]` | | the kid's strokes the recognizer read together |
| `latex` | string | `""` | what it says |
| `verdict` | `none` \| `pending` \| `ok` \| `warn` \| `unknown` \| `solved` | `none` | the web's `LiveVerdict` |
| `problem` | id? | | |

### `problem`: a problem being worked

| field | type | notes |
|---|---|---|
| `screen` | id | |
| `lines` | `[id]` | in order; the statement first, when there is one |
| `latex` | string? | the problem, when known (one the tutor wrote) |
| `origin` | string? | `student`, `chat`, `practice`, `nowYouTry`, `tour`, `taught` |

`mark`, `line` and `problem` refer to other records by id. A reader must accept a reference to a
record that is gone; ink can always be erased.

## Points: the compact encoding ("p1")

A stroke's points are one base64 string, which keeps the board small.

| | bytes a point |
|---|---|
| tldraw's `{"x":…,"y":…,"z":…}` objects | ~33, and ~66 a point in a whole board |
| this encoding, a Pencil stroke | 4–5 before base64 |

Bytes, before base64 (all integers little-endian varints, LEB128):

```
u8      version = 1
u8      flags: 1 = pressure, 2 = tilt, 4 = time
varint  point count
per point:
  zigzag varint  x − previous x, in 1/16 page unit (the first from 0)
  zigzag varint  y − previous y, in 1/16 page unit
  u8             pressure × 255                                (if flags & 1)
  u8, u8         altitude ÷ (π/2) × 255, azimuth ÷ 2π × 256    (if flags & 2)
  varint         ms since the previous point's time            (if flags & 4)
```

**Rules:**

- **Positions** are quantized absolutely (`round(x × 16)`), and the deltas are taken between
  quantized values, so nothing drifts along a long stroke. The worst error is 1/32 page unit,
  invisible even at 4× zoom.
- **A channel that is left out** takes its default. Without flag 1 every pressure is 0.5 (a finger
  stroke); without flag 4 every time is 0; without flag 2 there is no tilt.
- **Tilt is off by default** (`BoardController.storesTilt`). Nothing draws with it yet, and it costs
  2 bytes a point.
- **Zigzag** maps n to `(n << 1) ^ (n >> 63)`, so 0, −1, 1, −2 become 0, 1, 2, 3.
- **The app normalizes** each stroke to exactly what this encoding gives back
  (`PointCodec.normalize`) when the stroke enters the store. The document in memory then equals the
  document read back, and a diff never sees a change that is only rounding.

**Worked example (pinned in `PointCodecTests.knownEncoding`).** Three points:

| x | y | pressure | t |
|---|---|---|---|
| 0 | 0 | 0.5 | 0 |
| 1.5 | −2 | 1 | 4.2 |
| 3.0625 | −2 | 0.25 | 9 |

They encode to `AQUDAACAADA//wQyAEAF`, which is these bytes:

```
01 05 03 | 00 00 80 00 | 30 3F FF 04 | 32 00 40 05
```

Reading them back, pressure comes out as 128/255 and 64/255, and time as 0, 4 and 9.

A reference decoder for the server and the brain (JavaScript):

```js
export function decodePoints(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  let i = 0;
  const varint = () => {
    let result = 0, mul = 1, c;
    do { c = bytes[i++]; if (c === undefined) throw new Error("truncated"); result += (c & 0x7f) * mul; mul *= 128; } while (c & 0x80);
    return result;
  };
  const zigzag = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);
  if (bytes[i++] !== 1) throw new Error("unknown points version");
  const flags = bytes[i++];
  const count = varint();
  const out = [];
  let qx = 0, qy = 0, qt = 0;
  for (let k = 0; k < count; k++) {
    qx += zigzag(varint());
    qy += zigzag(varint());
    const p = { x: qx / 16, y: qy / 16, pressure: 0.5, t: 0 };
    if (flags & 1) p.pressure = bytes[i++] / 255;
    if (flags & 2) { p.altitude = (bytes[i++] / 255) * (Math.PI / 2); p.azimuth = (bytes[i++] / 256) * 2 * Math.PI; }
    if (flags & 4) { qt += varint(); p.t = qt; }
    out.push(p);
  }
  return out;
}
```

A point in page space is `(x, y) + rotate(point, rotation)`.

## Colours

Records store a **token**, never a hex value, so the brand lane can retune the palette without
touching saved boards.

**The kid's palette:** the Blocks pens `black`, `red`, `orange`, `green`, `pink` (`InkColor.kidPalette`,
`DS.KidPen.all`; tools lane, 2026-10-17). `pink` is a new token in schema 1 (nothing had shipped
yet). The web's fourth colour, `violet` (`KID_COLORS`), stays a valid token for old boards but is
no longer a pen: Blocks has no blue or purple pen. The pens and `tutor` render in the Blocks values
(`tutor` is cobalt #2D5BFF); the other tokens keep tldraw's values.

**The tutor:** `tutor` (tldraw `blue`, #4465e9). The rule is that **the kid's colours are never the
tutor's**:

- the kid's palette never offers `tutor`;
- the store turns a kid stroke in `tutor` into `blue` (`StrokeRecord.normalized`);
- the controller refuses to pick it.

**The rest** are tldraw's names, kept so a converted board keeps its colours: `blue`, `grey`,
`orange`, `yellow`, `white`, `light-blue`, `light-green`, `light-red`, `light-violet`.

- A kid's old `blue` (the classic board offered it) is `blue`, rendered #1971c2, a different blue
  from the tutor's.
- The brand lane may change both values.

## The pen

Strokes are drawn as variable-width freehand outlines: perfect-freehand (MIT), ported to Swift, with
**tldraw's draw-shape options**. A converted board therefore looks as it did, and new ink matches
old.

**`width` is the base width** (tldraw's `(STROKE_SIZES[size] + 1) × scale`):

| pen | width | tldraw size |
|---|---|---|
| the kid's regular pen | 6 | `l` (the web's simple board) |
| the kid's fine pen | 4.5 | `m` (the classic board) |
| the tutor's hand | 3 × the stroke's weight | `s` |
| a tldraw highlighter | `FONT_SIZES[size] × 1.12 × scale`, with `meta.highlight` | |

**`pressure: real`** uses size `1 + 1.2·width`, thinning 0.62, streamline 0.62, smoothing 0.62 and
the pen easing. Real pressure is rate-limited from point to point.

**`pressure: simulated`** uses size `width`, thinning 0.5, streamline 0.64–0.74 and easeOutSine,
with the pressure made up from the speed.

**A Pencil's pressure** is stored the way tldraw stores a pointer's: `min(1, force / maxForce × 1.25)`.

## Changes, undo and saving (the store)

**Transactions.** Every change is one transaction and produces one `ChangeSet`: records added,
updated (before and after) and removed. Within one change set a record appears at most once:

- added then updated is `added`;
- added then removed is not there at all;
- updated then removed is `removed`;
- removed then added again is `updated`.

**Origins.** Each change carries one:

| origin | undoable by the kid | marks the board unsaved |
|---|---|---|
| `kid` | yes | yes |
| `tutor` | never | yes |
| `system` | | yes |
| `history` (undo / redo) | | yes |
| `remote` (merged from the server) | | no |
| `load` | | no |

**Undo and redo.**

- Undo groups make one drag one step: an eraser stroke is one undo.
- Undo never overwrites someone else's change. A record the tutor or another device changed since
  the kid's step is left as it is now.

**Dirty sets** follow the web's `DirtyTracker`:

- `takeDirty()` hands the changed and removed ids to a save and starts fresh sets;
- `restoreDirty(token)` puts a failed save's ids back under anything newer.

**The change log** is numbered by `seq`. `changes(since:)` returns the change sets since a number,
or nil once the log no longer reaches back (send the whole document instead). It is the hook for
live sync later: phone as pen, a parent watching.

**Phase 1** builds the autosave on these pieces (`ios/Packages/AgathonSync`, below).

## Where a board is kept, and how it is saved (AgathonSync, 2026-10-17)

**The row.** `whiteboards.doc` (jsonb) holds this document, beside the tldraw `data`
(supabase/migrations/20261017000000_agathon_doc.sql). The trigger keeps `doc_schema` (the
document's `schema`) and `doc_version` (the row `version` it was written at). The doc **is the
board** when `doc is not null and doc_version = version`: any later `data` write bumps `version`
past it. Once a row has a doc, the database refuses a write that changes `data` alone
(`board_edited_on_ipad`), so the web never overwrites an iPad board. History keeps the doc a write
replaced (`whiteboard_snapshots.doc`), with the same 10-minute / pre-drop rule and retention as
`data`; the first doc of a board replaces nothing and is not kept.

**Opening** (`BoardSession.open`):

| the row | the board on screen | written |
|---|---|---|
| a current doc | the doc | on the first edit |
| no doc (an old web board) | `data` converted (`TldrawImporter`), its inline pictures uploaded | on the first edit: the whole converted document. Until then nothing is written and `data` is never touched |
| `data` is `{}` (a new board) | one screen, id `screen:<board id>` (the same on every open) | on the first edit |
| a doc of a newer schema | refused: "update the app" | never |
| a database without the doc columns (production before the migration) | `data` converted, inline pictures kept inline | **never**: the queue is local-only, the indicator says "Not saved yet", edits are backed up on the device and saved on the first open after the migration |

Then the device backup, if any, is put back record by record (below).

**Saving** (`BoardSaveQueue`, a port of the web's `src/lib/sync/saveQueue.ts`):

- 2 s after the last edit, never more than 10 s into a burst; the build waits up to 2 s for the
  pen to lift (twice: before encoding, before the thumbnail).
- The write is the whole document plus the thumbnail: `PATCH whiteboards?id=eq.<id>&version=eq.<v>`
  with `{doc, preview, updated_at}`, the document's bytes spliced in as they are. A write with no
  answer after 30 s + 1 ms per 20 bytes is cancelled and retried.
- No row matched: if the board still exists it is a **conflict**: fetch the row (the doc, or `data`
  converted), merge record by record (`RecordMerge`, the web's `mergeDocumentRecords`: this device's
  dirty records win, the other device's adds and changes come in, its removals go out), write again;
  after 3 rounds, "reload". Gone: stop.
- Offline, timeout, any other failure: the dirty sets go back; retry after 2, 5, 15, 60, 60… s.
  Too large (the 8 MB check, or above 4 MB here): refused until the board shrinks. The column
  missing (PGRST204): local-only.
- Nothing to save (every dirty record is as the server has it): no write.
- **The backup:** the unsaved records, as a file per board in Application Support
  (`AgathonBoardBackups/<user id>/<board id>.json`), written 0.5 s after an edit (2 s at most into a
  burst) and at once when the app leaves the screen; cleared when a save lands. Each record carries
  the server's copy at the backup's base (`base`) and what an unanswered write sent (`sent`), so a
  restore keeps a record the server changed since (counted as stale) and restores the rest.
- Leaving the screen saves at once (a background task); closing the board saves and stops.

**The thumbnail.** The current screen, the typeset maths left out when there is ink beside it, on
white, as `data:image/jpeg;base64,…` within `whiteboards.preview`'s 20,000 characters: 640, 480,
then 320 px wide at quality 0.7 then 0.5 (iOS cannot encode WebP), starting at the rung that fitted
last time (from the top again every minute). An empty board clears it; an empty current screen
keeps the stored one.

**Pictures** (`SupabaseBoardAssetStore`, the `BoardAssetStore` protocol): the public `board-assets`
bucket at `<user id>/<board id>/<sha-256 of the bytes>.<ext>` (the same picture is one object; an
upload that finds it there is a success) and a `board_assets` row for the GC; read back through a
disk cache (`Caches/AgathonBoardAssets`), `data:` URLs decoded in place.

## Changing the schema

1. Bump `BoardDocument.currentSchema`.
2. Add a step to `BoardMigrations.standard` (`steps[n]` turns schema n's raw JSON into n + 1; the
   migrator writes `schema`).
3. Document it here.
4. Keep a fixture of the old schema in the tests.

**When to bump.** Any new or renamed field means a new schema. A new key in `meta` does not.

**Unknown record types** survive a round trip. A field this build does not know, on a type it does
know, does not survive; that is why new fields bump the schema.

## Sizes (measured 2026-10-17, synthetic Pencil ink, `SerializationTests.denseScreenSize`)

| what | records | points | Agathon | same strokes as tldraw JSON |
|---|---|---|---|---|
| a full screen of Pencil writing | 600 strokes | 32,777 | **312 KB** (9.5 B a point) | 2,180 KB (66.5 B a point): 7.0× bigger |
| 5,000 strokes on one screen | 5,000 | 277,590 | **2.63 MB** | 18.4 MB |
| the same with tilt kept | 5,000 | 277,736 | 3.37 MB (12.1 B a point) | 18.5 MB |
| 5,000 finger strokes | 5,000 | 277,960 | 2.28 MB (8.2 B a point) | 15.2 MB |
| the web's synthetic replay board, converted | 2,897 | | 915 KB | 2,484 KB (the fixture itself) |

**What that means for the 4 MB autosave cap:** it holds about 12 screens of dense Pencil writing in
this format, against about 2 in tldraw's.

**Per stroke**, about 230 bytes are record fields (id, screen, order, author, colour, width, origin,
start). The rest is points.

## Converting a tldraw board (`TldrawImporter`, complete since 2026-10-17)

It accepts both stored forms: `{document: {store, schema}, session}`, and a bare `{store, schema}`.
The original is never changed: it stays in `whiteboards.data`, and the app writes only `doc`. Converting
the same board twice gives the same document, byte for byte (`ConverterTests`, `TldrawImportTests`).

**What every converted record keeps.** Its tldraw `meta`, whole (the tutor's keys: `live`, `source`,
`lineId`, `createdAt`, `mark`, `markWhy`, `handBlock`, `handLine`, `handPart`, `graphFor`, `figure`,
`chatModel`, `proofTable`, `proofRows`, `chatProblem`, `chatBlock`, …), except a stroke's `t` / `t1`,
which become its `start` and point times. Besides:

| meta key | when |
|---|---|
| `opacity` | the shape's opacity was below 1 |
| `locked` | the shape was locked (never a retired AI overlay: the web unlocks those) |
| `parent` | the shape was inside a group or a frame (its id); the record is flattened to the page |
| `dash` | tldraw's `dash` was not `draw` |
| `label` | a geo shape's, an arrow's or a note's text, or a frame's name (plain text) |
| `rotation` | a `math` or `graph` record that was rotated (they have no rotation field) |
| `tldraw` | `{type, props, asset?, assetId?}`: what the board does not model yet (a label's rich text, an arrow's bend and heads, a crop, a text's font…), so the trip back to tldraw loses nothing |

| tldraw | Agathon |
|---|---|
| `page` (by `index`) | `screen`: `rect` from `meta.screen`; a page without one gets the screen the web grows around its content (`screenForContent`: pad 40, keep 16:9, measured by stroke centre lines as tldraw measures them) |
| `draw` | `stroke`. Points of every segment in order; a `straight` segment is interpolated as tldraw draws it. `isPen` → `real`. `size` and `scale` → `width`. `meta.t` / `t1` → `start` plus point times spread by length. The tutor's `createdAt` → `start`. `meta.live` → `author: tutor`, and tldraw `blue` → `tutor` only then |
| `highlight` | `stroke` with `meta.highlight` (drawn at 35 %) |
| `geo` rectangle, ellipse | `shape` `rect`, `ellipse`; `w`, `h` (+ `growY`); `width` = STROKE_SIZES[size] × scale |
| `geo` oval, cloud | `shape` `ellipse`, `meta.geo` |
| `geo` x-box, check-box | `shape` `rect`, `meta.geo` |
| `geo` triangle, diamond, pentagon, hexagon, octagon, star, rhombus, rhombus-2, trapezoid, arrow-right / left / up / down, heart | `shape` `line`: a closed outline (tldraw 4.2's own geometry, the heart's curves sampled) through the box `w` × `h`; `meta.geo` |
| `line` | `shape` `line` through its handles (in index order); a cubic spline in `meta.spline` |
| `arrow` | `shape` `arrow`, start to end; a bent arrow's arc sampled (17 points); its heads, kind, label in `meta.tldraw` |
| arrow `binding`s | the end where tldraw draws it (the target's anchor, or its centre when not precise, clipped to its outline unless exact), and `meta.attach.start` / `.end`: `{to: <record id>, anchor: {x, y}, precise?, exact?, binding: <binding id>, snap?}` |
| `note` | `shape` `rect` (200 × scale, grown by `growY`), `fill: semi` in the note's colour; `meta.note`, its text in `meta.label` |
| `frame` | its own box: `shape` `rect`, `width` 1, `meta.frame`, its name in `meta.label`; its children flattened, above it |
| `group` | flattened (its children carry the group's position and rotation, and `meta.parent`) |
| `text` | `math`, role `note`, author as the shape's: `latex` is the text in LaTeX text mode (`\text{…}` a line, joined by `\\`), the plain text in `meta.text`; `fontSize` = FONT_SIZES[size] × scale, `w` = w × scale, `h` from its lines |
| `image` + its `asset` | `image` with `asset.src` (an inline `data:` picture is uploaded through the `BoardAssetStore`, see below) |
| the retired pipeline's AI overlays (`meta.aiOverlay`) | a suggest / answer overlay nobody accepted is left out, as the web drops it on load; the others are ordinary images (unlocked) |
| `video` + asset | `image` placeholder: the video's URL in `asset.src`, `meta.video` |
| `embed` | `image` placeholder with no picture (`asset.src` ""), the URL in `meta.link` |
| `bookmark` + asset | `image` placeholder showing its preview picture, `meta.link`, `meta.title` |
| `math` | `math`: `echo` → `readback`, `ai` → `answer`, `student` → `note`, and `size` → `fontSize`; `status`, `resultLatex`, `note`, `tone`, `anchorIds` in `meta.tldraw.props` |
| an `echo` math's `anchorIds`, `lineId`, `status` | a `line` over those strokes, its verdict the echo's status |
| tutor strokes with `meta.mark` (`check:` / `circle:` / `question:`) | a `mark` over those strokes, aimed at `line:<lineId>`, `why` from `meta.markWhy` |
| `graph` | `graph`; the web's hex colours (GRAPH_COLORS) become palette tokens, the hex kept in `meta.fnColors` by function id |
| any other shape type | kept whole: an `UnknownRecord` `tldraw:<key>`, type `tldraw.shape`, `{screen, x, y, rotation, shape}` |
| any other record (a binding that is not an arrow's, an asset nothing uses, a custom record) | kept whole: `tldraw:<id>`, type `tldraw.record`, `{record}` (an unused inline asset is left in the original) |
| the `document` record and the snapshot's `schema` | the document's `meta.convertedFrom` (`{format: "tldraw", schema, document}`) |
| fills | tldraw's `semi` → `paper`, `solid` → `semi`, `fill` → `solid` (tldraw's names mean other things) |
| z-order | tldraw's index order, groups and frames inline, re-keyed with fresh fractional keys |

**Inline pictures.** Boards saved before the web's asset store hold pictures as `data:` URLs.
`TldrawImporter.importSnapshot(_:boardId:assets:)` uploads each (once per picture) through the board's
`BoardAssetStore` and points the record at its URL; one that fails stays inline (`failedUploads`) and the
autosave tries again before every write, so nothing is lost.

**The trip back.** `src/lib/boards/agathonDoc.ts` turns a document back into a tldraw snapshot in memory
(never written): the web's read-only view of an iPad board, the replay, the weekly report and the admin
viewer read boards through `loadBoardSnapshot(row)`. It uses the record's fields first and `meta.tldraw`
for the rest; strokes get `meta.t` / `t1` back from `start` and their last point's time.

**Checked against tldraw's own renderer.** The reference PNGs come from
`ios/Packages/AgathonBoard/Tools/fixtures/tldraw-reference.mjs`, which uses tldraw's own `svgInk`
(read-only, for the comparison). Against them:

- **kid-algebra, screens 1 and 2:** 100 % of our ink is where tldraw's is, at 0.97× and 0.99× its
  weight.
- **The legacy board:** 96 % of our ink is where tldraw's is, at 1.04× its weight.

These are the `RenderComparisonTests`. See `docs/qa-screenshots/ipad-board-vs-tldraw.png`.

**Fixtures** (all synthetic, `Tools/fixtures/make-fixtures.mjs`): kid-algebra, legacy-noscreen,
legacy-small, synthetic-2000 and **all-shapes** (every shape kind above, bound / bent / elbow arrows,
inline and cropped pictures, the AI overlays, video, embed, bookmark, the tutor's meta keys, a page from
before screens). Their conversions are committed as Agathon JSON in `src/lib/boards/__fixtures__/agathon/`
for the TypeScript reader (`AgathonFixtureExportTests`; regenerate with `WRITE_AGATHON_FIXTURES=1`).

**Drawn faithfully later (the board lane's renderer):** dashed and dotted `dash` (kept), tldraw's
highlighter colours and double pass, a label's text on a shape, a note's text, a cubic line's curve, a
crop, a video's frame, the `rng(id)` width bump of a one-point mouse stroke, and tldraw dropping a pen
stroke's leading points under z 0.025. `problem` records from the Live loop's state are not in a
snapshot, so there are none to convert.
