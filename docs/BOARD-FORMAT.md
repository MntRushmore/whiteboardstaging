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

**The kid's palette:** `black`, `red`, `green`, `violet` (the web's `KID_COLORS`).

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

**Phase 1** builds the autosave on these pieces, with the web's guarantees: a version-checked
write, a record-level merge on conflict, a device backup of unsaved records, and waiting for the
pen to lift.

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

## Converting a tldraw board (first cut, `TldrawImporter`)

It accepts both stored forms: `{document: {store, schema}, session}`, and a bare `{store, schema}`.
The original is never changed.

| tldraw | Agathon |
|---|---|
| `page` (by `index`) | `screen`: `rect` from `meta.screen`; a page without one gets the screen the web grows around its content (`screenForContent`: pad 40, keep 16:9, measured by stroke centre lines as tldraw measures them) |
| `draw` | `stroke`. Points of every segment in order; a `straight` segment is interpolated as tldraw draws it. `isPen` → `real`. `size` and `scale` → `width`. `meta.t` / `t1` → `start` plus point times spread by length. The tutor's `createdAt` → `start`. `meta.live` → `author: tutor`, and tldraw `blue` → `tutor` only then |
| `highlight` | `stroke` with `meta.highlight` (drawn at 35 %) |
| shapes inside a `group` or `frame` | flattened, with the parent's position and rotation applied; the frame's own box is dropped |
| `geo` rectangle / ellipse | `shape`; other `geo` kinds become `rect`, with `meta.geo` keeping the original |
| `line`, `arrow` | `shape` (arrow bindings are not kept) |
| `image` + its `asset` | `image` with `asset.src` |
| `math` | `math`: `echo` → `readback`, `ai` → `answer`, `student` → `note`, and `size` → `fontSize` |
| an `echo` math's `anchorIds`, `lineId`, `status` | a `line` over those strokes, its verdict the echo's status |
| tutor strokes with `meta.mark` (`check:` / `circle:` / `question:`) | a `mark` over those strokes, aimed at `line:<lineId>`, `why` from `meta.markWhy` |
| `graph` | `graph` |
| fills | tldraw's `semi` → `paper`, `solid` → `semi`, `fill` → `solid` (tldraw's names mean other things) |
| z-order | tldraw's index order, groups inline, re-keyed with fresh fractional keys |

**Checked against tldraw's own renderer.** The reference PNGs come from
`ios/Packages/AgathonBoard/Tools/fixtures/tldraw-reference.mjs`, which uses tldraw's own `svgInk`
(read-only, for the comparison). Against them:

- **kid-algebra, screens 1 and 2:** 100 % of our ink is where tldraw's is, at 0.97× and 0.99× its
  weight.
- **The legacy board:** 96 % of our ink is where tldraw's is, at 1.04× its weight.

These are the `RenderComparisonTests`. See `docs/qa-screenshots/ipad-board-vs-tldraw.png`.

**Left for Phase 1 (the full converter):**

- **Not converted yet** (counted in the report): `text`, `note`, `embed`, `bookmark`, `video`, arrow
  bindings, and a `frame`'s own box.
- **Converted but not drawn faithfully yet:**
  - dashed and dotted `dash` (kept in `meta.dash`, drawn solid);
  - tldraw's highlighter colours and its double pass;
  - `geo` shapes other than rectangle and ellipse;
  - a `geo` shape's label (`richText`);
  - the `rng(id)` width bump tldraw gives a one-point mouse stroke;
  - tldraw dropping a pen stroke's leading points under z 0.025.
- **Other old-board leftovers:**
  - the AI overlays of the removed image pipeline (`meta.aiOverlay`);
  - `data:` URL assets (reported, not offloaded);
  - a `math` shape's `resultLatex` and `note`;
  - `problem` records from the Live loop's state, which is not in the snapshot.
- **The trip back:** writing an Agathon board back to tldraw, if the web must keep editing a board
  the iPad has touched.
