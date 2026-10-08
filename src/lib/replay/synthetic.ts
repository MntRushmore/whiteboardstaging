/**
 * A made-up board for the replay's tests, its performance check and the admin viewer's dev fixture
 * (`/api/dev/replay-fixture`, never in production): lines of the student's "handwriting" (squiggles
 * the size of digits), each answered by the tutor's echo (a `math` shape) and a tick, or a ring every
 * fourth line, screen after screen. Deterministic for a seed. Stored the way the board stores itself
 * (`{document:{store}, session}`), with no `schema`: its records are already today's.
 *
 * No real student's work is in it, so it can be committed and shared.
 */

export interface SyntheticOptions {
  /** the student's strokes, about (default 200) */
  strokes?: number;
  /** strokes per screen before the next screen starts (default 400) */
  perPage?: number;
  /** stamp the student's strokes with `t` / `t1` (a board drawn after 2026-10-08); else they have none (default true) */
  timed?: boolean;
  /** the first stroke's real time (default Tue 2026-10-06 16:04 in New York) */
  start?: number;
  /** points per stroke, about (default 24) */
  points?: number;
  seed?: number;
}

type Rec = Record<string, unknown> & { id: string; typeName: string };

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** The n-th fractional index key, in order ("c000", "c001"…): valid tldraw index keys for up to 238,328 shapes. */
export function nthIndex(n: number): string {
  let s = "";
  let v = n;
  for (let i = 0; i < 3; i++) {
    s = DIGITS[v % 62] + s;
    v = Math.floor(v / 62);
  }
  return `c${s}`;
}

function drawProps(points: { x: number; y: number; z: number }[], color = "black", size = "m") {
  return { color, fill: "none", dash: "draw", size, segments: [{ type: "free", points }], isComplete: true, isClosed: false, isPen: true, scale: 1 };
}

function shape(id: string, type: string, parentId: string, index: string, x: number, y: number, props: unknown, meta: Record<string, unknown>): Rec {
  return { id, typeName: "shape", type, parentId, index, x, y, rotation: 0, isLocked: false, opacity: 1, props, meta };
}

/** A stroke the size of a digit: a wobbly curve, `n` points. */
function squiggle(rand: () => number, n: number): { x: number; y: number; z: number }[] {
  const w = 14 + rand() * 16;
  const h = 24 + rand() * 18;
  const phase = rand() * Math.PI * 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const f = i / Math.max(1, n - 1);
    pts.push({ x: +(w * f + Math.sin(f * 6 + phase) * 4).toFixed(2), y: +(h * (0.5 + 0.5 * Math.sin(f * 3.2 + phase))).toFixed(2), z: 0.5 });
  }
  return pts;
}

export function syntheticBoard(options: SyntheticOptions = {}): { document: { store: Record<string, Rec> }; session: { currentPageId: string } } {
  const { strokes = 200, perPage = 400, timed = true, start = Date.UTC(2026, 9, 6, 20, 4), points = 24, seed = 1 } = options;
  const rand = rng(seed);
  const store: Record<string, Rec> = {};
  const put = (r: Rec) => (store[r.id] = r);
  put({ id: "document:document", typeName: "document", gridSize: 10, name: "", meta: {} });

  let n = 0;
  let index = 0;
  let clock = start;
  let pageNo = 0;
  let pageId = "";
  let line = 0;
  let row = 0;
  while (n < strokes) {
    if (n >= pageNo * perPage) {
      pageNo++;
      pageId = pageNo === 1 ? "page:page" : `page:synthetic${pageNo}`;
      put({ id: pageId, typeName: "page", name: pageNo === 1 ? "Page 1" : `Screen ${pageNo}`, index: nthIndex(pageNo), meta: { screen: { x: 0, y: 0, w: 1600, h: 900 } } });
      row = 0;
    }
    // one line of maths: 6–12 strokes left to right
    const lineId = `ln_syn${line++}`;
    const y = 70 + (row % 11) * 74;
    const col = Math.floor(row / 11) % 2;
    row++;
    let x = 80 + col * 780;
    const count = Math.min(strokes - n, 6 + Math.floor(rand() * 7));
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const pts = squiggle(rand, Math.max(3, Math.round(points * (0.6 + rand() * 0.8))));
      const drawMs = 180 + pts.length * 14;
      const id = `shape:syn${n}`;
      ids.push(id);
      const meta = timed ? { t: Math.round(clock), t1: Math.round(clock + drawMs) } : {};
      put(shape(id, "draw", pageId, nthIndex(index++), x, y, drawProps(pts), meta));
      clock += drawMs + 90 + rand() * 260;
      x += 22 + rand() * 18;
      n++;
    }
    // the tutor reads it: an echo and a mark, a second or so after the pen lifts
    clock += 1100 + rand() * 600;
    const createdAt = Math.round(clock);
    const ring = line % 4 === 0;
    put(
      shape(`shape:synecho${line}`, "math", pageId, nthIndex(index++), x + 40, y - 4, {
        w: 120, h: 44, latex: "=12", source: "echo", status: ring ? "warn" : "ok", resultLatex: "", note: "", anchorIds: ids, lineId, size: "m", tone: "muted",
      }, { live: true, source: "echo", lineId, createdAt, edited: false }),
    );
    const markX = x + 170;
    const lineStart = 80 + col * 780;
    // a ring round the line's ink; a tick past its echo
    const rw = x - lineStart + 36;
    const mark = ring ? `circle:${Math.round(lineStart / 4)},${Math.round(y / 4)},${Math.round((x - lineStart) / 4)},10` : `check:${Math.round(markX / 4)},${Math.round(y / 4)},8,8`;
    const markPts = ring
      ? Array.from({ length: 32 }, (_, i) => ({ x: +((rw / 2) * (1 + Math.cos((i / 30) * Math.PI * 2 + 2.2))).toFixed(2), y: +(29 * (1 + Math.sin((i / 30) * Math.PI * 2 + 2.2))).toFixed(2), z: 0.5 }))
      : [{ x: 0, y: 14, z: 0.5 }, { x: 6, y: 22, z: 0.5 }, { x: 12, y: 28, z: 0.5 }, { x: 20, y: 14, z: 0.5 }, { x: 28, y: 0, z: 0.5 }];
    put(
      shape(`shape:synmark${line}`, "draw", pageId, nthIndex(index++), ring ? lineStart - 18 : markX, ring ? y - 8 : y, drawProps(markPts, ring ? "red" : "green"), {
        live: true, source: "ai", lineId, createdAt: createdAt + 200, mark, handLine: ring ? "circle" : "check", handBlock: `hb_syn${line}`,
      }),
    );
    // now and then the student stops to think
    clock += rand() < 0.15 ? 20_000 + rand() * 60_000 : 900 + rand() * 1500;
  }
  return { document: { store }, session: { currentPageId: pageId || "page:page" } };
}
